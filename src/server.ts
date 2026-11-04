import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SERVER_NAME, SERVER_VERSION, type Config } from "./config.js";
import { ClientCredentialsAuth } from "./soundcloud/auth.js";
import { SoundCloudClient } from "./soundcloud/client.js";
import { InputError, SoundCloudError } from "./soundcloud/errors.js";
import { OEmbedClient } from "./soundcloud/oembed.js";
import type { FetchLike } from "./soundcloud/types.js";
import {
  getPlaylist,
  getTrack,
  PLAYLIST_DEFAULT_MAX,
  PLAYLIST_HARD_MAX,
  resolveUrl,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  searchTracks,
  type ToolContext,
} from "./tools.js";

export const TOOL_NAMES = ["search_tracks", "get_track", "get_playlist", "resolve_url"] as const;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export interface ServerDeps {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function createContext(config: Config, deps: ServerDeps = {}): ToolContext {
  const oembed = new OEmbedClient({ fetch: deps.fetch });
  if (config.mode === "api" && config.clientId && config.clientSecret) {
    const auth = new ClientCredentialsAuth({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      fetch: deps.fetch,
      now: deps.now,
    });
    const client = new SoundCloudClient({ auth, fetch: deps.fetch, sleep: deps.sleep, now: deps.now });
    return { mode: "api", client, oembed };
  }
  return { mode: "oembed", oembed };
}

function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function fail(err: unknown): CallToolResult {
  let message: string;
  if (err instanceof InputError || err instanceof SoundCloudError) message = err.message;
  else if (err instanceof Error) message = `Unexpected error: ${err.message}`;
  else message = "Unexpected error.";
  return { isError: true, content: [{ type: "text", text: message }] };
}

async function run<T>(fn: () => Promise<T>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

export function createServer(config: Config, deps: ServerDeps = {}): McpServer {
  const ctx = createContext(config, deps);
  const limited = ctx.mode !== "api" ? " [Requires SoundCloud API credentials; unavailable in the current limited mode.]" : "";

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Find SoundCloud tracks whose artists enabled free downloads and gather metadata for DJ sets. " +
        "This server returns metadata and links only: it never downloads, streams or converts audio, and it never bypasses download gates (Hypeddit, follow/e-mail gates). " +
        "'Free download' usually means personal use only: always show the license and remind the user to check it before a public mix.",
    },
  );

  server.registerTool(
    "search_tracks",
    {
      title: "Search SoundCloud tracks",
      description:
        "Search SoundCloud tracks by text and/or genre with an optional BPM range. By default returns only tracks whose artist enabled SoundCloud downloads (downloadable = true). Results include BPM, key (with Camelot code), duration, license guidance and links. BPM is missing for many tracks." +
        limited,
      inputSchema: {
        query: z.string().max(200).optional().describe("Free-text search, e.g. 'melodic techno' or an artist name."),
        genre: z.string().max(100).optional().describe("Genre filter, e.g. 'House' or 'Drum & Bass' (comma-separate several)."),
        bpm_min: z.number().min(20).max(400).optional().describe("Minimum BPM (inclusive)."),
        bpm_max: z.number().min(20).max(400).optional().describe("Maximum BPM (inclusive)."),
        downloadable_only: z
          .boolean()
          .default(true)
          .describe("Only tracks where the artist enabled SoundCloud downloads. Default true."),
        include_free_download_links: z
          .boolean()
          .default(false)
          .describe(
            "With downloadable_only, also keep tracks whose buy link is labelled 'free download' (often a third-party gate; reported, never bypassed).",
          ),
        include_unknown_bpm: z
          .boolean()
          .default(false)
          .describe("When a BPM range is given, also keep tracks that have no BPM metadata."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(SEARCH_MAX_LIMIT)
          .default(SEARCH_DEFAULT_LIMIT)
          .describe(`Maximum results (1-${SEARCH_MAX_LIMIT}).`),
      },
      annotations: READ_ONLY,
    },
    (args) => run(() => searchTracks(ctx, args)),
  );

  server.registerTool(
    "get_track",
    {
      title: "Get SoundCloud track details",
      description:
        "Details for one track: title, artist, genre, BPM, key/Camelot, duration, license (with public-mix guidance), downloadable flag, SoundCloud download link (only when the artist enabled downloads) and the purchase / 'free download' link classified as store, file host or gate. Accepts a soundcloud.com URL, numeric id or URN." +
        (ctx.mode !== "api" ? " [Limited mode: public URL only; returns title/artist without BPM, license or download info.]" : ""),
      inputSchema: {
        track: z.string().min(1).max(500).describe("Track URL (https://soundcloud.com/artist/track), numeric id, or URN soundcloud:tracks:123."),
      },
      annotations: READ_ONLY,
    },
    (args) => run(() => getTrack(ctx, args)),
  );

  server.registerTool(
    "get_playlist",
    {
      title: "Check a SoundCloud playlist for downloadable tracks",
      description:
        "Walk a playlist/album and mark each track as downloadable, free-download link, gated link or not downloadable, with BPM, key and license. Accepts a playlist URL (…/sets/…), numeric id or URN." +
        limited,
      inputSchema: {
        playlist: z.string().min(1).max(500).describe("Playlist URL, numeric id, or URN soundcloud:playlists:123."),
        downloadable_only: z.boolean().default(false).describe("Return only tracks with SoundCloud downloads enabled (summary still counts all)."),
        max_tracks: z
          .number()
          .int()
          .min(1)
          .max(PLAYLIST_HARD_MAX)
          .default(PLAYLIST_DEFAULT_MAX)
          .describe(`Maximum tracks to check (1-${PLAYLIST_HARD_MAX}).`),
      },
      annotations: READ_ONLY,
    },
    (args) => run(() => getPlaylist(ctx, args)),
  );

  server.registerTool(
    "resolve_url",
    {
      title: "Resolve a SoundCloud URL",
      description:
        "Turn a public soundcloud.com (or on.soundcloud.com) link to a track, playlist or profile into its type, id and URN." +
        (ctx.mode !== "api" ? " [Limited mode: uses oEmbed; id may be unavailable for profiles.]" : ""),
      inputSchema: {
        url: z.string().min(1).max(500).describe("Public SoundCloud URL."),
      },
      annotations: READ_ONLY,
    },
    (args) => run(() => resolveUrl(ctx, args)),
  );

  return server;
}
