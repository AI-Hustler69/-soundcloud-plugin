import type { FetchLike, SCTrack } from "../src/soundcloud/types.js";

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  redirect?: RequestInit["redirect"];
}

type Handler = (call: RecordedCall) => Response | Promise<Response>;

/**
 * A tiny scripted fetch: each route matches on method + URL (string prefix or
 * predicate). Unmatched requests throw so tests fail loudly.
 */
export class MockFetch {
  readonly calls: RecordedCall[] = [];
  private routes: { match: (c: RecordedCall) => boolean; handler: Handler; times?: number }[] = [];

  on(method: string, url: string | RegExp | ((u: URL) => boolean), handler: Handler | Response, times?: number): this {
    const match = (c: RecordedCall) => {
      if (c.method !== method) return false;
      if (typeof url === "string") return c.url === url || c.url.startsWith(url);
      if (url instanceof RegExp) return url.test(c.url);
      return url(new URL(c.url));
    };
    const h: Handler = handler instanceof Response ? () => handler.clone() : handler;
    this.routes.push({ match, handler: h, times });
    return this;
  }

  readonly fetch: FetchLike = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
      redirect: init?.redirect,
    };
    this.calls.push(call);
    const idx = this.routes.findIndex((r) => r.match(call) && (r.times === undefined || r.times > 0));
    const route = this.routes[idx];
    if (!route) throw new Error(`Unexpected request: ${call.method} ${call.url}`);
    if (route.times !== undefined) route.times--;
    return route.handler(call);
  };

  callsTo(prefix: string): RecordedCall[] {
    return this.calls.filter((c) => c.url.startsWith(prefix));
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export const TOKEN_URL = "https://secure.soundcloud.com/oauth/token";
export const API = "https://api.soundcloud.com";

export function tokenResponse(token = "tok-1", extra: Record<string, unknown> = {}): Response {
  return json({ access_token: token, expires_in: 3599, refresh_token: `refresh-${token}`, token_type: "bearer", ...extra });
}

let seq = 1000;
/** A realistic track object, shaped like the official OpenAPI example. */
export function track(overrides: Partial<SCTrack> = {}): SCTrack {
  const id = overrides.id ?? seq++;
  return {
    kind: "track",
    urn: `soundcloud:tracks:${id}`,
    title: `Track ${id}`,
    artwork_url: "https://i1.sndcdn.com/artworks-large.jpg",
    bpm: null,
    key_signature: null,
    genre: "House",
    tag_list: "",
    duration: 360000,
    license: "all-rights-reserved",
    downloadable: false,
    download_url: `https://api.soundcloud.com/tracks/${id}/download`,
    purchase_url: null,
    purchase_title: null,
    permalink_url: `https://soundcloud.com/artist/track-${id}`,
    metadata_artist: null,
    access: "playable",
    release_year: 2026,
    user: { username: "artist", permalink_url: "https://soundcloud.com/artist" },
    ...overrides,
  };
}

export const noSleep = async () => {};
