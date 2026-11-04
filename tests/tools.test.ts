import { describe, expect, it } from "vitest";
import { ClientCredentialsAuth } from "../src/soundcloud/auth.js";
import { SoundCloudClient } from "../src/soundcloud/client.js";
import { InputError } from "../src/soundcloud/errors.js";
import { OEmbedClient } from "../src/soundcloud/oembed.js";
import { getPlaylist, getTrack, resolveUrl, SEARCH_MAX_PAGES, searchTracks, type ToolContext } from "../src/tools.js";
import { API, json, MockFetch, noSleep, TOKEN_URL, tokenResponse, track } from "./helpers.js";

function apiCtx() {
  const mock = new MockFetch();
  mock.on("POST", TOKEN_URL, tokenResponse("tok"));
  const auth = new ClientCredentialsAuth({ clientId: "id", clientSecret: "s", fetch: mock.fetch });
  const ctx: ToolContext = {
    mode: "api",
    client: new SoundCloudClient({ auth, fetch: mock.fetch, sleep: noSleep }),
    oembed: new OEmbedClient({ fetch: mock.fetch }),
  };
  return { mock, ctx };
}

function oembedCtx() {
  const mock = new MockFetch();
  const ctx: ToolContext = { mode: "oembed", oembed: new OEmbedClient({ fetch: mock.fetch }) };
  return { mock, ctx };
}

const searchCalls = (mock: MockFetch) => mock.calls.filter((c) => c.url.startsWith(`${API}/tracks`));

describe("search_tracks", () => {
  it("returns only downloadable tracks by default and reports stats", async () => {
    const { mock, ctx } = apiCtx();
    mock.on(
      "GET",
      `${API}/tracks?`,
      json({
        collection: [
          track({ id: 1, downloadable: true, bpm: 124 }),
          track({ id: 2, downloadable: false, bpm: 124 }),
          track({ id: 3, downloadable: true, bpm: 126, license: "cc-by" }),
        ],
        next_href: null,
      }),
    );
    const r = await searchTracks(ctx, { query: "house" });
    expect(r.results.map((t) => t.id)).toEqual(["1", "3"]);
    expect(r.results.every((t) => t.downloadable)).toBe(true);
    expect(r.stats).toMatchObject({ scanned: 3, kept: 2, pages_fetched: 1 });
    expect(r.stats.rejected.not_downloadable).toBe(1);
    expect(r.more_available).toBe(false);
    expect(r.license_reminder).toMatch(/personal use/);
    // Large pages are requested because downloadable tracks are sparse.
    expect(new URL(searchCalls(mock)[0]!.url).searchParams.get("limit")).toBe("200");
  });

  it("paginates via next_href until the limit is reached", async () => {
    const { mock, ctx } = apiCtx();
    mock.on("GET", `${API}/tracks?cursor=2`, json({ collection: [track({ id: 20, downloadable: true }), track({ id: 21, downloadable: true })], next_href: `${API}/tracks?cursor=3` }));
    mock.on("GET", `${API}/tracks?`, json({ collection: [track({ id: 10, downloadable: true }), track({ id: 11 })], next_href: `${API}/tracks?cursor=2` }));
    const r = await searchTracks(ctx, { query: "x", limit: 2 });
    expect(r.results.map((t) => t.id)).toEqual(["10", "20"]);
    expect(searchCalls(mock)).toHaveLength(2);
    expect(r.more_available).toBe(true);
  });

  it(`stops after ${SEARCH_MAX_PAGES} pages and says so`, async () => {
    const { mock, ctx } = apiCtx();
    let n = 0;
    mock.on("GET", `${API}/tracks`, () => {
      n++;
      return json({ collection: [track({ id: 500 + n, downloadable: false })], next_href: `${API}/tracks?cursor=${n + 1}` });
    });
    const r = await searchTracks(ctx, { query: "x" });
    expect(n).toBe(SEARCH_MAX_PAGES);
    expect(r.results).toHaveLength(0);
    expect(r.more_available).toBe(true);
    expect(r.notes.join(" ")).toMatch(/Stopped after scanning 5 pages/);
  });

  it("sends the BPM range to the API and re-checks it locally", async () => {
    const { mock, ctx } = apiCtx();
    mock.on(
      "GET",
      `${API}/tracks?`,
      json({
        collection: [
          track({ id: 1, downloadable: true, bpm: 123.5 }),
          track({ id: 2, downloadable: true, bpm: 140 }), // API filter not honoured
          track({ id: 3, downloadable: true, bpm: null }),
        ],
      }),
    );
    const r = await searchTracks(ctx, { query: "x", bpm_min: 122.5, bpm_max: 125.5 });
    expect(r.results.map((t) => t.id)).toEqual(["1"]);
    const url = new URL(searchCalls(mock)[0]!.url);
    expect(url.searchParams.get("bpm[from]")).toBe("122");
    expect(url.searchParams.get("bpm[to]")).toBe("126");
    expect(r.stats.rejected).toMatchObject({ bpm_out_of_range: 1, bpm_unknown: 1 });
  });

  it("keeps unknown BPM when asked, and then does not send bpm to the API", async () => {
    const { mock, ctx } = apiCtx();
    mock.on("GET", `${API}/tracks?`, json({ collection: [track({ id: 3, downloadable: true, bpm: null }), track({ id: 4, downloadable: true, bpm: 100 })] }));
    const r = await searchTracks(ctx, { query: "x", bpm_min: 120, bpm_max: 128, include_unknown_bpm: true });
    expect(r.results.map((t) => t.id)).toEqual(["3"]);
    expect(new URL(searchCalls(mock)[0]!.url).searchParams.has("bpm[from]")).toBe(false);
  });

  it("can include non-downloadable tracks and free-download links", async () => {
    const { mock, ctx } = apiCtx();
    mock.on(
      "GET",
      `${API}/tracks?`,
      json({
        collection: [
          track({ id: 1 }),
          track({ id: 2, purchase_url: "https://hypeddit.com/x", purchase_title: "Free Download" }),
        ],
      }),
    );
    const all = await searchTracks(ctx, { query: "x", downloadable_only: false });
    expect(all.results).toHaveLength(2);
    const links = await searchTracks(ctx, { query: "x", include_free_download_links: true });
    expect(links.results.map((t) => [t.id, t.free_download, t.purchase?.gated])).toEqual([["2", "gated_external_link", true]]);
  });

  it("passes genre to the API and allows genre-only searches", async () => {
    const { mock, ctx } = apiCtx();
    mock.on("GET", `${API}/tracks?`, json({ collection: [] }));
    await searchTracks(ctx, { genre: "Drum & Bass" });
    const url = new URL(searchCalls(mock)[0]!.url);
    expect(url.searchParams.get("genres")).toBe("Drum & Bass");
    expect(url.searchParams.has("q")).toBe(false);
  });

  it("validates input", async () => {
    const { ctx } = apiCtx();
    await expect(searchTracks(ctx, {})).rejects.toBeInstanceOf(InputError);
    await expect(searchTracks(ctx, { query: "x", bpm_min: 130, bpm_max: 120 })).rejects.toBeInstanceOf(InputError);
  });

  it("is unavailable in oEmbed mode with a helpful message", async () => {
    const { mock, ctx } = oembedCtx();
    await expect(searchTracks(ctx, { query: "x" })).rejects.toThrow(/SOUNDCLOUD_CLIENT_ID.*Artist Pro/s);
    expect(mock.calls).toHaveLength(0);
  });
});

describe("get_track", () => {
  it("fetches by numeric id via URN", async () => {
    const { mock, ctx } = apiCtx();
    mock.on("GET", `${API}/tracks/soundcloud%3Atracks%3A42`, json(track({ id: 42, downloadable: true, download_url: "https://api.soundcloud.com/tracks/42/download", purchase_url: "https://artist.bandcamp.com/track/x", purchase_title: "Free Download" })));
    const r = await getTrack(ctx, { track: "42" });
    expect(r.mode).toBe("api");
    if (r.mode !== "api") throw new Error("unreachable");
    expect(r.track).toMatchObject({
      urn: "soundcloud:tracks:42",
      downloadable: true,
      download_url: "https://api.soundcloud.com/tracks/42/download",
      purchase: { kind: "store", labelled_free: true },
    });
  });

  it("resolves public URLs and rejects non-track resources", async () => {
    const { mock, ctx } = apiCtx();
    mock.on("GET", `${API}/resolve?url=https%3A%2F%2Fsoundcloud.com%2Fa%2Fb`, new Response(null, { status: 302, headers: { location: `${API}/tracks/soundcloud:tracks:8` } }));
    mock.on("GET", `${API}/tracks/soundcloud:tracks:8`, json(track({ id: 8 })));
    mock.on("GET", `${API}/resolve?url=https%3A%2F%2Fsoundcloud.com%2Fa`, json({ kind: "user", urn: "soundcloud:users:1" }));
    await expect(getTrack(ctx, { track: "https://soundcloud.com/a/b" })).resolves.toMatchObject({ track: { id: "8" } });
    await expect(getTrack(ctx, { track: "https://soundcloud.com/a" })).rejects.toThrow(/user, not a track/);
  });

  it("uses oEmbed without credentials and reports limitations", async () => {
    const { mock, ctx } = oembedCtx();
    mock.on(
      "GET",
      "https://soundcloud.com/oembed?",
      json({
        title: "Song by Artist",
        author_name: "Artist",
        author_url: "https://soundcloud.com/artist",
        thumbnail_url: "https://i1.sndcdn.com/a.jpg",
        html: '<iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F31"></iframe>',
      }),
    );
    const r = await getTrack(ctx, { track: "https://soundcloud.com/artist/song" });
    expect(r.mode).toBe("oembed_limited");
    expect(r.track).toMatchObject({ id: "31", title: "Song by Artist", downloadable: null, download_url: null, bpm: null });
    const call = mock.calls[0]!;
    expect(new URL(call.url).searchParams.get("format")).toBe("json");
    expect(new URL(call.url).searchParams.get("url")).toBe("https://soundcloud.com/artist/song");
    expect(call.headers.authorization).toBeUndefined();
  });

  it("requires a URL in oEmbed mode", async () => {
    const { mock, ctx } = oembedCtx();
    await expect(getTrack(ctx, { track: "12345" })).rejects.toThrow(/limited mode.*public SoundCloud track URL.*need the API/s);
    await expect(getTrack(ctx, { track: "soundcloud:tracks:1" })).rejects.toThrow(/need the API/);
    expect(mock.calls).toHaveLength(0);
    await expect(getTrack(ctx, { track: "https://soundcloud.com/artist/sets/x" })).rejects.toThrow(/playlist/);
  });
});

describe("get_playlist", () => {
  it("walks all pages and marks each track", async () => {
    const { mock, ctx } = apiCtx();
    mock.on("GET", `${API}/playlists/soundcloud%3Aplaylists%3A9?show_tracks=false`, json({ kind: "playlist", urn: "soundcloud:playlists:9", title: "Crate", track_count: 4, user: { username: "dj" } }));
    mock.on("GET", `${API}/playlists/soundcloud%3Aplaylists%3A9/tracks?`, json({ collection: [track({ id: 1, downloadable: true }), track({ id: 2 })], next_href: `${API}/playlists/soundcloud:playlists:9/tracks?cursor=2` }));
    mock.on("GET", `${API}/playlists/soundcloud:playlists:9/tracks?cursor=2`, json({ collection: [track({ id: 3, purchase_url: "https://hypeddit.com/x", purchase_title: "Free DL" }), track({ id: 4, purchase_url: "https://dropbox.com/s/x", purchase_title: "Free Download" })], next_href: null }));

    const r = await getPlaylist(ctx, { playlist: "9" });
    expect(r.playlist).toMatchObject({ title: "Crate", owner: "dj", track_count: 4 });
    expect(r.summary).toEqual({
      tracks_checked: 4,
      downloadable: 1,
      free_download_links: 1,
      gated_links: 1,
      not_downloadable: 1,
      blocked: 0,
      unavailable: 0,
      truncated: false,
    });
    // Blocked tracks are requested too, so positions match the real playlist order.
    expect(new URL(mock.callsTo(`${API}/playlists/soundcloud%3Aplaylists%3A9/tracks`)[0]!.url).searchParams.get("access")).toBe(
      "playable,preview,blocked",
    );
    expect(r.tracks.map((t) => [t.position, t.free_download])).toEqual([
      [1, "soundcloud_download"],
      [2, "none"],
      [3, "gated_external_link"],
      [4, "external_link"],
    ]);

    const onlyDl = await getPlaylist(ctx, { playlist: "soundcloud:playlists:9", downloadable_only: true });
    expect(onlyDl.tracks.map((t) => t.id)).toEqual(["1"]);
    expect(onlyDl.summary.tracks_checked).toBe(4);
  });

  it("stops at max_tracks and reports truncation when more pages exist", async () => {
    const { mock, ctx } = apiCtx();
    // track_count is unknown, so only the next_href path can mark truncation.
    mock.on("GET", `${API}/playlists/soundcloud%3Aplaylists%3A9?`, json({ kind: "playlist", track_count: null }));
    mock.on("GET", `${API}/playlists/soundcloud%3Aplaylists%3A9/tracks?`, json({ collection: [track(), track()], next_href: `${API}/playlists/soundcloud:playlists:9/tracks?cursor=2` }));
    const r = await getPlaylist(ctx, { playlist: "9", max_tracks: 2 });
    expect(r.tracks).toHaveLength(2);
    expect(r.summary.truncated).toBe(true);
    expect(mock.calls.some((c) => c.url.includes("cursor=2"))).toBe(false);
    expect(new URL(mock.callsTo(`${API}/playlists/soundcloud%3Aplaylists%3A9/tracks`)[0]!.url).searchParams.get("limit")).toBe("2");
  });

  it("is not truncated when the last page is reached exactly at max_tracks", async () => {
    const { mock, ctx } = apiCtx();
    mock.on("GET", `${API}/playlists/soundcloud%3Aplaylists%3A9?`, json({ kind: "playlist", track_count: 2 }));
    mock.on("GET", `${API}/playlists/soundcloud%3Aplaylists%3A9/tracks?`, json({ collection: [track(), track()], next_href: null }));
    const r = await getPlaylist(ctx, { playlist: "9", max_tracks: 2 });
    expect(r.summary.truncated).toBe(false);
  });

  it("reports blocked and unavailable tracks without claiming truncation", async () => {
    const { mock, ctx } = apiCtx();
    mock.on("GET", `${API}/playlists/soundcloud%3Aplaylists%3A9?`, json({ kind: "playlist", track_count: 30 }));
    mock.on(
      "GET",
      `${API}/playlists/soundcloud%3Aplaylists%3A9/tracks?`,
      json({ collection: [track({ id: 1 }), track({ id: 2, access: "blocked" }), track({ id: 3, downloadable: true })], next_href: null }),
    );
    const r = await getPlaylist(ctx, { playlist: "9" });
    expect(r.summary).toMatchObject({ tracks_checked: 3, blocked: 1, unavailable: 27, truncated: false });
    expect(r.tracks.map((t) => [t.position, t.id, t.access])).toEqual([
      [1, "1", "playable"],
      [2, "2", "blocked"],
      [3, "3", "playable"],
    ]);
  });

  it("passes the secret_token of a secret-link playlist to the tracks request", async () => {
    const { mock, ctx } = apiCtx();
    mock.on(
      "GET",
      `${API}/resolve?`,
      new Response(null, { status: 302, headers: { location: `${API}/playlists/soundcloud:playlists:12?secret_token=s-AbC12` } }),
    );
    mock.on("GET", `${API}/playlists/soundcloud:playlists:12?secret_token=s-AbC12`, json({ kind: "playlist", urn: "soundcloud:playlists:12", title: "Promo" }));
    mock.on("GET", `${API}/playlists/soundcloud%3Aplaylists%3A12/tracks?`, json({ collection: [track({ downloadable: true })] }));
    const r = await getPlaylist(ctx, { playlist: "https://soundcloud.com/a/sets/promo/s-AbC12" });
    expect(r.summary.downloadable).toBe(1);
    const tracksCall = mock.callsTo(`${API}/playlists/soundcloud%3Aplaylists%3A12/tracks`)[0]!;
    expect(new URL(tracksCall.url).searchParams.get("secret_token")).toBe("s-AbC12");
  });

  it("resolves playlist URLs and rejects other types", async () => {
    const { mock, ctx } = apiCtx();
    mock.on("GET", `${API}/resolve?url=https%3A%2F%2Fsoundcloud.com%2Fa%2Fsets%2Fs`, json({ kind: "playlist", urn: "soundcloud:playlists:5", title: "S" }));
    mock.on("GET", `${API}/playlists/soundcloud%3Aplaylists%3A5/tracks?`, json({ collection: [] }));
    mock.on("GET", `${API}/resolve?url=https%3A%2F%2Fsoundcloud.com%2Fa%2Ft`, json({ kind: "track", urn: "soundcloud:tracks:1" }));
    await expect(getPlaylist(ctx, { playlist: "https://soundcloud.com/a/sets/s" })).resolves.toMatchObject({ playlist: { title: "S" } });
    await expect(getPlaylist(ctx, { playlist: "https://soundcloud.com/a/t" })).rejects.toThrow(/track, not a playlist/);
  });
});

describe("resolve_url", () => {
  it("returns type, id and urn via the API", async () => {
    const { mock, ctx } = apiCtx();
    mock.on("GET", `${API}/resolve?`, json({ kind: "user", urn: "soundcloud:users:3", username: "dj", permalink_url: "https://soundcloud.com/dj" }));
    await expect(resolveUrl(ctx, { url: "https://soundcloud.com/dj" })).resolves.toEqual({
      mode: "api",
      type: "user",
      id: "3",
      urn: "soundcloud:users:3",
      title: "dj",
      author: "dj",
      permalink_url: "https://soundcloud.com/dj",
    });
  });

  it("falls back to oEmbed + URL pattern without credentials", async () => {
    const { mock, ctx } = oembedCtx();
    mock.on("GET", "https://soundcloud.com/oembed?", json({ title: "Profile", author_name: "dj", html: "<iframe></iframe>" }));
    const r = await resolveUrl(ctx, { url: "https://soundcloud.com/dj/sets/crate" });
    expect(r).toMatchObject({ mode: "oembed_limited", type: "playlist", id: null, urn: null, title: "Profile" });
  });

  it("rejects site pages that are not content before any request", async () => {
    for (const ctx of [apiCtx(), oembedCtx()]) {
      for (const url of ["https://soundcloud.com/", "https://soundcloud.com/discover", "https://soundcloud.com/search?q=x", "https://soundcloud.com/you/likes"]) {
        await expect(resolveUrl(ctx.ctx, { url })).rejects.toThrow(/not a track, playlist or profile/);
      }
      await expect(getTrack(ctx.ctx, { track: "https://soundcloud.com/discover" })).rejects.toThrow(/not a track, playlist or profile/);
      expect(ctx.mock.calls).toHaveLength(0);
    }
  });

  it("accepts scheme-less soundcloud.com links in oEmbed mode", async () => {
    const { mock, ctx } = oembedCtx();
    mock.on("GET", "https://soundcloud.com/oembed?", json({ title: "T", author_name: "A", html: "" }));
    await expect(getTrack(ctx, { track: "soundcloud.com/artist/song" })).resolves.toMatchObject({ track: { title: "T" } });
  });

  it("rejects non-SoundCloud URLs before any request", async () => {
    const { mock, ctx } = apiCtx();
    await expect(resolveUrl(ctx, { url: "https://example.com/x" })).rejects.toBeInstanceOf(InputError);
    expect(mock.calls).toHaveLength(0);
  });
});
