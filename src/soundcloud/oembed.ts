/**
 * Limited, key-less fallback using SoundCloud's documented oEmbed endpoint
 * (https://developers.soundcloud.com/docs/oembed). It only returns display
 * metadata (title, author, thumbnail, embed HTML): no BPM, license,
 * downloadable flag, search or playlist contents.
 */
import { USER_AGENT } from "../config.js";
import { NotFoundError, SoundCloudError, truncate, describeNetworkError } from "./errors.js";
import type { FetchLike, OEmbedResponse } from "./types.js";
import { API_HOST, type ResourceType } from "./urls.js";

export const OEMBED_URL = "https://soundcloud.com/oembed";

export class OEmbedClient {
  private readonly fetchFn: FetchLike;

  constructor(opts: { fetch?: FetchLike } = {}) {
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  /** `publicUrl` must already be validated with parsePublicUrl(). */
  async lookup(publicUrl: string): Promise<OEmbedResponse> {
    const url = new URL(OEMBED_URL);
    url.searchParams.set("format", "json");
    url.searchParams.set("url", publicUrl);

    let res: Response;
    try {
      res = await this.fetchFn(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      });
    } catch (err) {
      throw new SoundCloudError(`Could not reach SoundCloud oEmbed: ${describeNetworkError(err)}`);
    }
    if (res.status === 404) throw new NotFoundError("SoundCloud oEmbed found nothing at that URL (private or deleted?).");
    if (!res.ok) {
      let text = "";
      try {
        text = await res.text();
      } catch {
        /* ignore */
      }
      throw new SoundCloudError(`SoundCloud oEmbed error (HTTP ${res.status}): ${truncate(text)}`, res.status);
    }
    try {
      return (await res.json()) as OEmbedResponse;
    } catch {
      throw new SoundCloudError("SoundCloud oEmbed returned invalid JSON.");
    }
  }
}

/**
 * The oEmbed `html` field is an <iframe> whose src carries the API resource
 * URL, e.g. ...?url=https%3A//api.soundcloud.com/tracks/123. This reads the
 * id from that documented response field only; it is best-effort.
 */
export function idFromEmbedHtml(html: string | undefined): { type: ResourceType; id: string } | undefined {
  if (!html) return undefined;
  const srcMatch = /src="([^"]+)"/i.exec(html);
  if (!srcMatch?.[1]) return undefined;
  let src: URL;
  try {
    src = new URL(srcMatch[1].replace(/&amp;/g, "&"));
  } catch {
    return undefined;
  }
  const inner = src.searchParams.get("url");
  if (!inner) return undefined;
  let innerUrl: URL;
  try {
    innerUrl = new URL(inner);
  } catch {
    return undefined;
  }
  if (innerUrl.hostname.toLowerCase() !== API_HOST) return undefined;
  const m = /^\/(tracks|playlists|users)\/(?:soundcloud:(?:tracks|playlists|users):)?(\d+)/.exec(innerUrl.pathname);
  if (!m || !m[1] || !m[2]) return undefined;
  const type: ResourceType = m[1] === "tracks" ? "track" : m[1] === "playlists" ? "playlist" : "user";
  return { type, id: m[2] };
}
