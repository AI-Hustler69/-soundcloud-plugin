/**
 * OAuth 2.1 Client Credentials flow against SoundCloud.
 *
 * - Token endpoint: https://secure.soundcloud.com/oauth/token
 *   (the legacy api.soundcloud.com/oauth2/token endpoint is deprecated).
 * - Credentials are sent with HTTP Basic auth, never in the URL.
 * - Tokens live ~1 hour and SoundCloud rate-limits token issuance
 *   (about 50 tokens / 12 h per app), so tokens are cached in memory and
 *   renewed with the single-use refresh token when possible.
 */
import { USER_AGENT } from "../config.js";
import { AuthError, RateLimitError, truncate, describeNetworkError } from "./errors.js";
import type { FetchLike, SCTokenResponse } from "./types.js";

export const TOKEN_URL = "https://secure.soundcloud.com/oauth/token";

/** Renew this many ms before the token actually expires. */
const EXPIRY_SKEW_MS = 60_000;
const DEFAULT_TTL_SECONDS = 3600;

export interface TokenSource {
  getToken(): Promise<string>;
  /** Drop the cached access token (e.g. after a 401). */
  invalidate(): void;
}

export interface ClientCredentialsOptions {
  clientId: string;
  clientSecret: string;
  fetch?: FetchLike;
  now?: () => number;
  tokenUrl?: string;
}

interface CachedToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export class ClientCredentialsAuth implements TokenSource {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;
  private readonly tokenUrl: string;
  private cached?: CachedToken;
  private inflight?: Promise<string>;

  constructor(opts: ClientCredentialsOptions) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? Date.now;
    this.tokenUrl = opts.tokenUrl ?? TOKEN_URL;
  }

  async getToken(): Promise<string> {
    if (this.cached && this.now() < this.cached.expiresAt - EXPIRY_SKEW_MS) {
      return this.cached.accessToken;
    }
    // Collapse concurrent callers onto one token request.
    if (!this.inflight) {
      this.inflight = this.obtain().finally(() => {
        this.inflight = undefined;
      });
    }
    return this.inflight;
  }

  invalidate(): void {
    if (this.cached) {
      // Keep the refresh token so the next call can renew without a new grant.
      this.cached = { ...this.cached, expiresAt: 0 };
    }
  }

  private async obtain(): Promise<string> {
    const refreshToken = this.cached?.refreshToken;
    if (refreshToken) {
      try {
        return await this.request({ grant_type: "refresh_token", refresh_token: refreshToken });
      } catch (err) {
        if (err instanceof RateLimitError) throw err;
        // Refresh tokens are single-use and may have been revoked; fall back.
        this.cached = undefined;
      }
    }
    return this.request({ grant_type: "client_credentials" });
  }

  private async request(params: Record<string, string>): Promise<string> {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`, "utf8").toString("base64");
    let res: Response;
    try {
      res = await this.fetchFn(this.tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json; charset=utf-8",
          "User-Agent": USER_AGENT,
        },
        body: new URLSearchParams(params).toString(),
      });
    } catch (err) {
      throw new AuthError(`Could not reach the SoundCloud token endpoint: ${describeNetworkError(err)}`);
    }

    if (res.status === 429) {
      throw new RateLimitError(
        "SoundCloud is rate-limiting token requests for this app (roughly 50 tokens per 12 hours). Wait and try again later.",
        retryDelaySeconds(res.headers, this.now()),
      );
    }
    if (!res.ok) {
      const body = truncate(await safeText(res));
      const hint =
        res.status === 401 || res.status === 400
          ? " Check SOUNDCLOUD_CLIENT_ID / SOUNDCLOUD_CLIENT_SECRET. Newly self-registered apps can also be inactive until SoundCloud reviews them."
          : "";
      throw new AuthError(`SoundCloud token request failed (HTTP ${res.status}): ${body}.${hint}`, res.status);
    }

    let data: SCTokenResponse;
    try {
      data = (await res.json()) as SCTokenResponse;
    } catch {
      throw new AuthError("SoundCloud token endpoint returned invalid JSON.");
    }
    if (!data || typeof data.access_token !== "string" || data.access_token === "") {
      throw new AuthError("SoundCloud token endpoint returned no access_token.");
    }
    const ttl = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : DEFAULT_TTL_SECONDS;
    this.cached = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || undefined,
      expiresAt: this.now() + ttl * 1000,
    };
    return data.access_token;
  }
}

/**
 * Seconds to wait after a 429. SoundCloud's gateway sends
 * `x-ratelimit-reset` (Unix epoch seconds) rather than Retry-After, so both
 * are read; Retry-After wins when present.
 */
export function retryDelaySeconds(headers: Headers, nowMs: number = Date.now()): number | undefined {
  const retryAfter = parseRetryAfter(headers.get("retry-after"), nowMs);
  if (retryAfter !== undefined) return retryAfter;
  const reset = headers.get("x-ratelimit-reset")?.trim();
  if (!reset || !/^\d+$/.test(reset)) return undefined;
  const resetSeconds = Number(reset);
  // Small values are a delta, large ones an epoch timestamp.
  if (resetSeconds < 1_000_000_000) return resetSeconds;
  return Math.max(0, Math.ceil(resetSeconds - nowMs / 1000));
}

/** Parses Retry-After as delta-seconds or HTTP-date. Returns seconds or undefined. */
export function parseRetryAfter(value: string | null, nowMs: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.max(0, Number(trimmed));
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - nowMs) / 1000));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
