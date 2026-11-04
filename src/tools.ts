/**
 * Tool implementations, independent of the MCP transport so they can be
 * unit-tested with a mocked SoundCloud API.
 *
 * Hard rules enforced here:
 *  - metadata and links only; nothing is downloaded or streamed;
 *  - download_url is exposed only for tracks the artist marked downloadable;
 *  - third-party download gates are reported, never followed or bypassed.
 */
import { type Mode } from "./config.js";
import { applyFilter, emptyStats, hasBpmRange, type FilterStats, type TrackFilter } from "./filters.js";
import { LICENSE_REMINDER } from "./licenses.js";
import type { SoundCloudClient } from "./soundcloud/client.js";
import { MAX_PAGE_SIZE } from "./soundcloud/client.js";
import { InputError } from "./soundcloud/errors.js";
import { idFromEmbedHtml, type OEmbedClient } from "./soundcloud/oembed.js";
import type { SCPlaylist, SCTrack, SCUser } from "./soundcloud/types.js";
import { assertContentUrl, guessTypeFromUrl, parseIdInput, parsePublicUrl, toUrn, type ResourceType } from "./soundcloud/urls.js";
import { summarizeTrack, type TrackSummary } from "./tracks.js";

export interface ToolContext {
  mode: Mode;
  client?: SoundCloudClient;
  oembed: OEmbedClient;
}

export const LIMITED_MODE_HELP =
  "This needs the official SoundCloud API. Set SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET (register an app at https://soundcloud.com/you/apps; SoundCloud currently requires an Artist Pro subscription for new apps). Without them only resolve_url and get_track (by public URL) work, in a limited oEmbed mode.";

const OEMBED_LIMITATIONS =
  "Limited oEmbed mode (no API credentials): BPM, key, genre, license, downloadable flag and download links are not available.";

function requireClient(ctx: ToolContext): SoundCloudClient {
  if (ctx.mode !== "api" || !ctx.client) throw new InputError(LIMITED_MODE_HELP);
  return ctx.client;
}

// ---------------------------------------------------------------- search_tracks

export interface SearchTracksInput {
  query?: string;
  genre?: string;
  bpm_min?: number;
  bpm_max?: number;
  downloadable_only?: boolean;
  include_free_download_links?: boolean;
  include_unknown_bpm?: boolean;
  limit?: number;
}

export interface SearchTracksResult {
  mode: "api";
  results: TrackSummary[];
  stats: FilterStats & { pages_fetched: number };
  more_available: boolean;
  notes: string[];
  license_reminder: string;
}

export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;
/** Upper bound on API pages per search, to stay polite with rate limits. */
export const SEARCH_MAX_PAGES = 5;

export async function searchTracks(ctx: ToolContext, input: SearchTracksInput): Promise<SearchTracksResult> {
  const client = requireClient(ctx);
  const query = input.query?.trim() || undefined;
  const genre = input.genre?.trim() || undefined;
  if (!query && !genre) throw new InputError("Provide a search query and/or a genre.");
  if (input.bpm_min !== undefined && input.bpm_max !== undefined && input.bpm_min > input.bpm_max) {
    throw new InputError("bpm_min must be less than or equal to bpm_max.");
  }

  const limit = Math.min(SEARCH_MAX_LIMIT, Math.max(1, Math.floor(input.limit ?? SEARCH_DEFAULT_LIMIT)));
  const filter: TrackFilter = {
    downloadableOnly: input.downloadable_only ?? true,
    includeFreeDownloadLinks: input.include_free_download_links ?? false,
    bpmMin: input.bpm_min,
    bpmMax: input.bpm_max,
    includeUnknownBpm: input.include_unknown_bpm ?? false,
  };

  // Ask the API to pre-filter by BPM only when unknown-BPM tracks are not wanted
  // (an API-side bpm filter would drop them). The range is re-checked locally anyway.
  const sendBpmToApi = hasBpmRange(filter) && !filter.includeUnknownBpm;
  // Downloadable tracks are sparse, so scan bigger pages when filtering locally.
  const pageSize = filter.downloadableOnly || hasBpmRange(filter) ? MAX_PAGE_SIZE : Math.max(limit, 10);

  const stats = emptyStats();
  const seen = new Set<string>();
  const results: TrackSummary[] = [];
  let pages = 0;
  let nextHref: string | null | undefined;

  let page = await client.searchTracks({
    q: query,
    genres: genre,
    bpmFrom: sendBpmToApi && filter.bpmMin !== undefined ? Math.floor(filter.bpmMin) : undefined,
    bpmTo: sendBpmToApi && filter.bpmMax !== undefined ? Math.ceil(filter.bpmMax) : undefined,
    pageSize,
  });
  for (;;) {
    pages++;
    const raw = page.collection ?? [];
    results.push(...applyFilter(raw.map(summarizeTrack), filter, stats, seen));
    nextHref = page.next_href;
    if (results.length >= limit || !nextHref || raw.length === 0 || pages >= SEARCH_MAX_PAGES) break;
    page = await client.nextPage<SCTrack>(nextHref);
  }

  const notes: string[] = [];
  if (filter.downloadableOnly) {
    notes.push(
      filter.includeFreeDownloadLinks
        ? "Kept tracks with SoundCloud downloads enabled, plus tracks whose buy link is labelled as a free download (check `purchase.gated`)."
        : "Kept only tracks where the artist enabled SoundCloud downloads (downloadable = true).",
    );
  }
  if (hasBpmRange(filter)) {
    notes.push(
      filter.includeUnknownBpm
        ? "Tracks without BPM metadata were kept (bpm = null); check their tempo manually."
        : "Tracks without BPM metadata were dropped (SoundCloud has BPM for only some tracks). Set include_unknown_bpm to keep them.",
    );
  }
  if (results.length < limit && nextHref && pages >= SEARCH_MAX_PAGES) {
    notes.push(`Stopped after scanning ${pages} pages (${stats.scanned} tracks). Narrow the query or try another genre for more matches.`);
  }

  return {
    mode: "api",
    results: results.slice(0, limit),
    stats: { ...stats, pages_fetched: pages },
    more_available: Boolean(nextHref) || results.length > limit,
    notes,
    license_reminder: LICENSE_REMINDER,
  };
}

// ---------------------------------------------------------------- get_track

export interface LimitedTrack {
  urn: string | null;
  id: string | null;
  title: string | null;
  artist: string | null;
  uploader_url: string | null;
  permalink_url: string;
  artwork_url: string | null;
  bpm: null;
  key_signature: null;
  genre: null;
  license: null;
  downloadable: null;
  download_url: null;
  purchase: null;
}

export type GetTrackResult =
  | { mode: "api"; track: TrackSummary; license_reminder: string }
  | { mode: "oembed_limited"; track: LimitedTrack; limitations: string; license_reminder: string };

export async function getTrack(ctx: ToolContext, input: { track: string }): Promise<GetTrackResult> {
  const value = input.track?.trim();
  if (!value) throw new InputError("Provide a track URL, numeric id or URN.");

  if (ctx.mode !== "api" || !ctx.client) {
    // oEmbed only accepts public URLs; ids and URNs need the API.
    if (!/^https?:\/\//i.test(value) && !/^(m\.|www\.|on\.)?soundcloud\.com\//i.test(value)) {
      throw new InputError(
        `In limited mode (no API credentials) get_track needs a public SoundCloud track URL such as https://soundcloud.com/artist/track; numeric ids and URNs like "${value}" need the API. ${LIMITED_MODE_HELP}`,
      );
    }
    const url = assertContentUrl(parsePublicUrl(value));
    const guessed = guessTypeFromUrl(url);
    if (guessed && guessed !== "track") throw new InputError(`That URL looks like a ${guessed}, not a track.`);
    const o = await ctx.oembed.lookup(url.toString());
    const fromHtml = idFromEmbedHtml(o.html);
    if (fromHtml && fromHtml.type !== "track") throw new InputError(`That URL is a ${fromHtml.type}, not a track.`);
    return {
      mode: "oembed_limited",
      track: {
        urn: fromHtml ? toUrn("track", fromHtml.id) : null,
        id: fromHtml?.id ?? null,
        title: o.title ?? null,
        artist: o.author_name ?? null,
        uploader_url: o.author_url ?? null,
        permalink_url: url.toString(),
        artwork_url: o.thumbnail_url ?? null,
        bpm: null,
        key_signature: null,
        genre: null,
        license: null,
        downloadable: null,
        download_url: null,
        purchase: null,
      },
      limitations: `${OEMBED_LIMITATIONS} ${LIMITED_MODE_HELP}`,
      license_reminder: LICENSE_REMINDER,
    };
  }

  const client = ctx.client;
  const parsed = parseIdInput(value, "track");
  let raw: SCTrack;
  if (parsed.kind === "urn") {
    raw = await client.getTrack(parsed.urn);
  } else {
    const resolved = await client.resolve(parsed.url.toString());
    if (resolved.type !== "track") throw new InputError(`That URL is a ${resolved.type}, not a track.`);
    raw = resolved.resource;
  }
  return { mode: "api", track: summarizeTrack(raw), license_reminder: LICENSE_REMINDER };
}

// ---------------------------------------------------------------- get_playlist

export interface PlaylistTrackEntry extends TrackSummary {
  position: number;
}

export interface GetPlaylistResult {
  mode: "api";
  playlist: {
    urn: string | null;
    title: string | null;
    owner: string | null;
    permalink_url: string | null;
    playlist_type: string | null;
    track_count: number | null;
  };
  summary: {
    tracks_checked: number;
    downloadable: number;
    free_download_links: number;
    gated_links: number;
    not_downloadable: number;
    blocked: number;
    unavailable: number;
    truncated: boolean;
  };
  tracks: PlaylistTrackEntry[];
  license_reminder: string;
}

export const PLAYLIST_DEFAULT_MAX = 200;
export const PLAYLIST_HARD_MAX = 500;

export async function getPlaylist(
  ctx: ToolContext,
  input: { playlist: string; downloadable_only?: boolean; max_tracks?: number },
): Promise<GetPlaylistResult> {
  const client = requireClient(ctx);
  const value = input.playlist?.trim();
  if (!value) throw new InputError("Provide a playlist URL, numeric id or URN.");
  const maxTracks = Math.min(PLAYLIST_HARD_MAX, Math.max(1, Math.floor(input.max_tracks ?? PLAYLIST_DEFAULT_MAX)));

  const parsed = parseIdInput(value, "playlist");
  let meta: SCPlaylist;
  let urn: string;
  let secretToken: string | undefined;
  if (parsed.kind === "urn") {
    urn = parsed.urn;
    meta = await client.getPlaylist(urn, false);
  } else {
    const resolved = await client.resolve(parsed.url.toString());
    if (resolved.type !== "playlist") throw new InputError(`That URL is a ${resolved.type}, not a playlist.`);
    urn = resolved.urn;
    meta = resolved.resource;
    secretToken = resolved.secretToken;
  }

  const rawTracks: SCTrack[] = [];
  let page = await client.getPlaylistTracksPage(urn, Math.min(MAX_PAGE_SIZE, maxTracks), secretToken);
  let truncated = false;
  for (;;) {
    rawTracks.push(...(page.collection ?? []));
    if (rawTracks.length >= maxTracks) {
      truncated = Boolean(page.next_href) || rawTracks.length > maxTracks;
      break;
    }
    if (!page.next_href || (page.collection ?? []).length === 0) break;
    page = await client.nextPage<SCTrack>(page.next_href);
  }

  const all = rawTracks.slice(0, maxTracks).map((t, i) => ({ position: i + 1, ...summarizeTrack(t) }));
  const summary = {
    tracks_checked: all.length,
    downloadable: all.filter((t) => t.downloadable).length,
    free_download_links: all.filter((t) => t.free_download === "external_link").length,
    gated_links: all.filter((t) => t.free_download === "gated_external_link").length,
    not_downloadable: all.filter((t) => t.free_download === "none").length,
    blocked: all.filter((t) => t.access === "blocked").length,
    /** Listed in the playlist's track_count but not returned by the API (private, deleted…). */
    unavailable: !truncated && typeof meta.track_count === "number" ? Math.max(0, meta.track_count - all.length) : 0,
    /** True only when max_tracks cut the list short. */
    truncated,
  };

  return {
    mode: "api",
    playlist: {
      urn: meta.urn ?? urn,
      title: meta.title ?? null,
      owner: meta.user?.username ?? null,
      permalink_url: meta.permalink_url ?? null,
      playlist_type: meta.playlist_type ?? null,
      track_count: typeof meta.track_count === "number" ? meta.track_count : null,
    },
    summary,
    tracks: input.downloadable_only ? all.filter((t) => t.downloadable) : all,
    license_reminder: LICENSE_REMINDER,
  };
}

// ---------------------------------------------------------------- resolve_url

export interface ResolveUrlResult {
  mode: "api" | "oembed_limited";
  type: ResourceType | null;
  id: string | null;
  urn: string | null;
  title: string | null;
  author: string | null;
  permalink_url: string;
  note?: string;
}

export async function resolveUrl(ctx: ToolContext, input: { url: string }): Promise<ResolveUrlResult> {
  const url = assertContentUrl(parsePublicUrl(input.url ?? ""));

  if (ctx.mode === "api" && ctx.client) {
    const r = await ctx.client.resolve(url.toString());
    let title: string | null = null;
    let author: string | null = null;
    let permalink: string | null = null;
    if (r.type === "user") {
      const u = r.resource as SCUser;
      title = u.username ?? null;
      author = u.username ?? null;
      permalink = u.permalink_url ?? null;
    } else {
      const res = r.resource as SCTrack | SCPlaylist;
      title = res.title ?? null;
      author = res.user?.username ?? null;
      permalink = res.permalink_url ?? null;
    }
    return { mode: "api", type: r.type, id: r.id, urn: r.urn, title, author, permalink_url: permalink ?? url.toString() };
  }

  const guessed = guessTypeFromUrl(url);
  const o = await ctx.oembed.lookup(url.toString());
  const fromHtml = idFromEmbedHtml(o.html);
  const type = fromHtml?.type ?? guessed ?? null;
  return {
    mode: "oembed_limited",
    type,
    id: fromHtml?.id ?? null,
    urn: fromHtml ? toUrn(fromHtml.type, fromHtml.id) : null,
    title: o.title ?? null,
    author: o.author_name ?? null,
    permalink_url: url.toString(),
    note: fromHtml
      ? "Resolved via oEmbed (no API credentials)."
      : "Resolved via oEmbed (no API credentials); id unavailable, type inferred from the URL.",
  };
}
