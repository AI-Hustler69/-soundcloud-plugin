/**
 * Minimal read-only client for the official SoundCloud Public API.
 *
 * Deliberately NOT implemented: /streams, /preview, /download or any other
 * endpoint that returns audio. This client only reads metadata.
 */
import { USER_AGENT } from "../config.js";
import type { TokenSource } from "./auth.js";
import { parseRetryAfter } from "./auth.js";
import { AuthError, NotFoundError, RateLimitError, SoundCloudError, truncate } from "./errors.js";
import type { FetchLike, SCCollection, SCPlaylist, SCTrack, SCUser } from "./types.js";
import { API_HOST, assertApiUrl, parseApiResourceUrl, type ResourceType } from "./urls.js";

export const API_BASE = `https://${API_HOST}`;
/** Max page size accepted by the API. */
export const MAX_PAGE_SIZE = 200;

export interface ClientOptions {
  auth: TokenSource;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How many times to retry a 429 after waiting for Retry-After. */
  maxRateLimitRetries?: number;
  /** Never wait longer than this for a single Retry-After. */
  maxRetryWaitMs?: number;
}

export interface TrackSearchQuery {
  q?: string;
  genres?: string;
  bpmFrom?: number;
  bpmTo?: number;
  pageSize?: number;
}

interface ResolvedBase {
  urn: string;
  id: string;
  /** secret_token of a private ("secret link") resource; needed for follow-up requests. */
  secretToken?: string;
}

export type ResolvedResource =
  | (ResolvedBase & { type: "track"; resource: SCTrack })
  | (ResolvedBase & { type: "playlist"; resource: SCPlaylist })
  | (ResolvedBase & { type: "user"; resource: SCUser });

type Query = Record<string, string | number | boolean | undefined>;

export class SoundCloudClient {
  private readonly auth: TokenSource;
  private readonly fetchFn: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxRateLimitRetries: number;
  private readonly maxRetryWaitMs: number;

  constructor(opts: ClientOptions) {
    this.auth = opts.auth;
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = opts.now ?? Date.now;
    this.maxRateLimitRetries = opts.maxRateLimitRetries ?? 2;
    this.maxRetryWaitMs = opts.maxRetryWaitMs ?? 10_000;
  }

  /** GET /tracks: one page of search results (linked partitioning). */
  async searchTracks(query: TrackSearchQuery): Promise<SCCollection<SCTrack>> {
    const params: Query = {
      q: query.q,
      genres: query.genres,
      "bpm[from]": query.bpmFrom,
      "bpm[to]": query.bpmTo,
      limit: clampPageSize(query.pageSize),
      linked_partitioning: true,
    };
    return this.getJson<SCCollection<SCTrack>>(buildUrl("/tracks", params));
  }

  /** Follows a next_href returned by a previous page. Only api.soundcloud.com is allowed. */
  async nextPage<T>(nextHref: string): Promise<SCCollection<T>> {
    return this.getJson<SCCollection<T>>(assertApiUrl(nextHref));
  }

  async getTrack(urn: string): Promise<SCTrack> {
    return this.getJson<SCTrack>(buildUrl(`/tracks/${encodeURIComponent(urn)}`, {}));
  }

  async getPlaylist(urn: string, showTracks = true): Promise<SCPlaylist> {
    return this.getJson<SCPlaylist>(buildUrl(`/playlists/${encodeURIComponent(urn)}`, { show_tracks: showTracks }));
  }

  async getPlaylistTracksPage(
    urn: string,
    pageSize = MAX_PAGE_SIZE,
    secretToken?: string,
  ): Promise<SCCollection<SCTrack>> {
    return this.getJson<SCCollection<SCTrack>>(
      buildUrl(`/playlists/${encodeURIComponent(urn)}/tracks`, {
        limit: clampPageSize(pageSize),
        linked_partitioning: true,
        secret_token: secretToken,
      }),
    );
  }

  /**
   * GET /resolve?url=… The API answers with a 302 to the API resource URL
   * (or, in some clients, a JSON body with `location`). We follow it ourselves
   * so the Authorization header is only ever sent to api.soundcloud.com.
   */
  async resolve(publicUrl: string): Promise<ResolvedResource> {
    const res = await this.request(buildUrl("/resolve", { url: publicUrl }), { redirect: "manual" });

    let location: string | null = null;
    let body: unknown;
    if (res.status >= 300 && res.status < 400) {
      location = res.headers.get("location");
    } else {
      body = await parseJson(res);
      if (body && typeof body === "object" && typeof (body as { location?: unknown }).location === "string") {
        location = (body as { location: string }).location;
      }
    }

    if (location) {
      const target = assertApiUrl(new URL(location, API_BASE).toString());
      const parsed = parseApiResourceUrl(target.toString());
      const resource = await this.getJson<Record<string, unknown>>(target);
      const secretToken = target.searchParams.get("secret_token") ?? secretTokenFromPublicUrl(publicUrl);
      return toResolved(resource, parsed, secretToken);
    }
    if (body && typeof body === "object" && typeof (body as { kind?: unknown }).kind === "string") {
      return toResolved(body as Record<string, unknown>, undefined, secretTokenFromPublicUrl(publicUrl));
    }
    throw new SoundCloudError("SoundCloud /resolve returned neither a redirect nor a resource.", res.status);
  }

  private async getJson<T>(url: URL): Promise<T> {
    const res = await this.request(url);
    return (await parseJson(res)) as T;
  }

  private async request(url: URL, init: RequestInit = {}): Promise<Response> {
    let authRetried = false;
    let rateLimitRetries = 0;

    for (;;) {
      const token = await this.auth.getToken();
      let res: Response;
      try {
        res = await this.fetchFn(url.toString(), {
          ...init,
          method: "GET",
          headers: {
            Authorization: `OAuth ${token}`,
            Accept: "application/json; charset=utf-8",
            "User-Agent": USER_AGENT,
          },
        });
      } catch (err) {
        throw new SoundCloudError(`Could not reach the SoundCloud API: ${(err as Error).message}`);
      }

      if (res.status === 401 && !authRetried) {
        authRetried = true;
        this.auth.invalidate();
        continue;
      }
      if (res.status === 429) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"), this.now());
        const waitMs = (retryAfter ?? 1) * 1000;
        if (rateLimitRetries < this.maxRateLimitRetries && waitMs <= this.maxRetryWaitMs) {
          rateLimitRetries++;
          await this.sleep(waitMs);
          continue;
        }
        throw new RateLimitError(
          `SoundCloud rate limit reached${retryAfter !== undefined ? `; retry after ~${retryAfter}s` : ""}. See https://developers.soundcloud.com/docs/api/rate-limits`,
          retryAfter,
        );
      }
      if (res.ok || (res.status >= 300 && res.status < 400 && init.redirect === "manual")) {
        return res;
      }

      const text = truncate(await safeText(res));
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(`SoundCloud API refused the request (HTTP ${res.status}): ${text}`, res.status);
      }
      if (res.status === 404) {
        throw new NotFoundError(`Not found on SoundCloud (it may be private, deleted or region-blocked).`);
      }
      throw new SoundCloudError(`SoundCloud API error (HTTP ${res.status}): ${text}`, res.status);
    }
  }
}

export function buildUrl(path: string, params: Query): URL {
  const url = new URL(path, API_BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function clampPageSize(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return 50;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(n)));
}

/** Secret-link URLs end with an "s-xxxx" path segment that doubles as the secret_token. */
export function secretTokenFromPublicUrl(publicUrl: string): string | undefined {
  try {
    const last = new URL(publicUrl).pathname.split("/").filter(Boolean).pop();
    return last && /^s-[A-Za-z0-9]+$/.test(last) ? last : undefined;
  } catch {
    return undefined;
  }
}

function toResolved(
  resource: Record<string, unknown>,
  parsed: { type: ResourceType; id: string; urn: string } | undefined,
  secretToken?: string | null,
): ResolvedResource {
  const kind = typeof resource.kind === "string" ? resource.kind : undefined;
  const type: ResourceType | undefined =
    kind === "track" ? "track" : kind === "playlist" ? "playlist" : kind === "user" ? "user" : parsed?.type;
  if (!type) throw new SoundCloudError(`SoundCloud resolved the URL to an unsupported resource kind: ${kind ?? "unknown"}`);

  const urn =
    typeof resource.urn === "string" && resource.urn
      ? resource.urn
      : parsed?.urn ?? (typeof resource.id === "number" ? `soundcloud:${type}s:${resource.id}` : undefined);
  if (!urn) throw new SoundCloudError("SoundCloud resolved the URL but returned no identifier.");
  const id = urn.split(":").pop() ?? urn;

  return { type, urn, id, resource, ...(secretToken ? { secretToken } : {}) } as ResolvedResource;
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await safeText(res);
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new SoundCloudError(`SoundCloud API returned invalid JSON (HTTP ${res.status}).`, res.status);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
