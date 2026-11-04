/**
 * Helpers for SoundCloud public URLs, numeric ids and URNs.
 * Pure functions: no network access.
 */
import { InputError } from "./errors.js";

export type ResourceType = "track" | "playlist" | "user";

const PUBLIC_HOSTS = new Set(["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com", "on.soundcloud.com"]);
export const API_HOST = "api.soundcloud.com";

/** First path segments that are site sections, not user profiles. */
const RESERVED_ROOTS = new Set([
  "discover",
  "search",
  "stream",
  "you",
  "upload",
  "charts",
  "messages",
  "notifications",
  "settings",
  "pages",
  "terms-of-use",
  "imprint",
  "jobs",
  "mobile",
  "pro",
  "people",
  "tags",
  "popular",
  "feed",
  "signin",
  "signup",
  "logout",
  "creators",
  "artists",
  "go",
  "next",
  "oembed",
]);

/** Sub-pages of a profile (soundcloud.com/<user>/<sub>) that are not tracks. */
const PROFILE_SUBPAGES = new Set([
  "tracks",
  "albums",
  "sets",
  "reposts",
  "likes",
  "followers",
  "following",
  "popular-tracks",
  "comments",
  "spotlight",
]);

/** Parses and validates a public soundcloud.com URL. Throws InputError otherwise. */
export function parsePublicUrl(input: string): URL {
  let raw = input.trim();
  // Accept links pasted without a scheme, e.g. "soundcloud.com/artist/track".
  if (/^(m\.|www\.|on\.)?soundcloud\.com(\/|$)/i.test(raw)) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InputError(`Not a valid URL: ${input}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InputError(`Only http(s) SoundCloud URLs are supported: ${input}`);
  }
  if (!PUBLIC_HOSTS.has(url.hostname.toLowerCase())) {
    throw new InputError(`Not a soundcloud.com URL: ${input}`);
  }
  url.protocol = "https:";
  if (url.hostname.toLowerCase() === "m.soundcloud.com" || url.hostname.toLowerCase() === "www.soundcloud.com") {
    url.hostname = "soundcloud.com";
  }
  return url;
}

/**
 * Rejects soundcloud.com pages that can never be a track, playlist or profile
 * (home page, /discover, /search, /you/…), so users get a clear message
 * instead of a misleading "not found / private".
 */
export function assertContentUrl(url: URL): URL {
  if (isShortLink(url)) return url;
  const first = url.pathname.split("/").filter(Boolean)[0];
  if (!first || RESERVED_ROOTS.has(first.toLowerCase())) {
    throw new InputError(
      `That SoundCloud page is not a track, playlist or profile: ${url.toString()}. Use a link like https://soundcloud.com/artist/track, …/artist/sets/name or …/artist.`,
    );
  }
  return url;
}

export function isShortLink(url: URL): boolean {
  return url.hostname.toLowerCase() === "on.soundcloud.com";
}

/**
 * Best-effort guess of the resource type from the URL path alone.
 * Returns undefined for short links and unknown pages.
 */
export function guessTypeFromUrl(url: URL): ResourceType | undefined {
  if (isShortLink(url)) return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return undefined;
  const [first, second, third] = parts;
  if (!first || RESERVED_ROOTS.has(first.toLowerCase())) return undefined;
  if (parts.length === 1) return "user";
  if (second === "sets" && third) return "playlist";
  if (second && PROFILE_SUBPAGES.has(second.toLowerCase())) return parts.length === 2 ? "user" : undefined;
  // soundcloud.com/<user>/<track>[/s-secret]
  if (parts.length === 2 || (parts.length === 3 && third?.startsWith("s-"))) return "track";
  return undefined;
}

const URN_RE = /^soundcloud:(tracks|playlists|users):(\d+)$/;
const API_PATH_RE = /^\/(tracks|playlists|users)\/(?:soundcloud(?::|%3A)(?:tracks|playlists|users)(?::|%3A))?(\d+)\/?$/i;

const URN_KIND: Record<string, ResourceType> = { tracks: "track", playlists: "playlist", users: "user" };
const TYPE_PLURAL: Record<ResourceType, string> = { track: "tracks", playlist: "playlists", user: "users" };

export function toUrn(type: ResourceType, id: number | string): string {
  return `soundcloud:${TYPE_PLURAL[type]}:${id}`;
}

export function parseUrn(urn: string): { type: ResourceType; id: string } | undefined {
  const m = URN_RE.exec(urn.trim());
  if (!m || !m[1] || !m[2]) return undefined;
  const type = URN_KIND[m[1]];
  return type ? { type, id: m[2] } : undefined;
}

/**
 * Parses an api.soundcloud.com resource URL such as
 * https://api.soundcloud.com/tracks/soundcloud:tracks:123 or /tracks/123.
 */
export function parseApiResourceUrl(input: string): { type: ResourceType; id: string; urn: string } | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  if (url.hostname.toLowerCase() !== API_HOST) return undefined;
  const m = API_PATH_RE.exec(url.pathname);
  if (!m || !m[1] || !m[2]) return undefined;
  const type = URN_KIND[m[1].toLowerCase()];
  if (!type) return undefined;
  return { type, id: m[2], urn: toUrn(type, m[2]) };
}

export type IdInput =
  | { kind: "urn"; urn: string }
  | { kind: "url"; url: URL };

/**
 * Accepts a numeric id, a URN (soundcloud:tracks:123) or a public URL and
 * tells the caller how to look it up. Throws InputError for anything else.
 */
export function parseIdInput(input: string, expected: ResourceType): IdInput {
  const value = input.trim();
  if (/^\d+$/.test(value)) return { kind: "urn", urn: toUrn(expected, value) };
  const urn = parseUrn(value);
  if (urn) {
    if (urn.type !== expected) {
      throw new InputError(`Expected a ${expected} URN but got a ${urn.type} URN: ${value}`);
    }
    return { kind: "urn", urn: value };
  }
  const api = parseApiResourceUrl(value);
  if (api) {
    if (api.type !== expected) throw new InputError(`Expected a ${expected} but got a ${api.type}: ${value}`);
    return { kind: "urn", urn: api.urn };
  }
  return { kind: "url", url: assertContentUrl(parsePublicUrl(value)) };
}

const AUDIO_PATH_RE = /\/(streams?|preview|download)(\/|$)/i;

/** Only follow pagination / resolve links that stay on api.soundcloud.com over https. */
export function assertApiUrl(href: string): URL {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new InputError(`Invalid API URL: ${href}`);
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== API_HOST) {
    throw new InputError(`Refusing to follow a non-SoundCloud-API URL: ${href}`);
  }
  // Defence in depth: never follow a server-supplied link to an audio endpoint.
  if (AUDIO_PATH_RE.test(url.pathname)) {
    throw new InputError(`Refusing to follow a link to an audio endpoint: ${url.pathname}`);
  }
  return url;
}
