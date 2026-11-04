import { describe, expect, it } from "vitest";
import { ClientCredentialsAuth } from "../src/soundcloud/auth.js";
import { SoundCloudClient } from "../src/soundcloud/client.js";
import { AuthError, InputError, NotFoundError, RateLimitError, SoundCloudError } from "../src/soundcloud/errors.js";
import { API, json, MockFetch, noSleep, TOKEN_URL, tokenResponse, track } from "./helpers.js";

function setup(opts: { sleep?: (ms: number) => Promise<void> } = {}) {
  const mock = new MockFetch();
  mock.on("POST", TOKEN_URL, tokenResponse("tok"));
  const auth = new ClientCredentialsAuth({ clientId: "id", clientSecret: "secret", fetch: mock.fetch });
  const client = new SoundCloudClient({ auth, fetch: mock.fetch, sleep: opts.sleep ?? noSleep });
  return { mock, client };
}

describe("SoundCloudClient", () => {
  it("searches /tracks with OAuth header, deepObject bpm params and linked partitioning", async () => {
    const { mock, client } = setup();
    mock.on("GET", `${API}/tracks?`, json({ collection: [track()], next_href: null }));

    const page = await client.searchTracks({ q: "deep house", genres: "House", bpmFrom: 120, bpmTo: 126, pageSize: 500 });
    expect(page.collection).toHaveLength(1);

    const call = mock.callsTo(`${API}/tracks`)[0]!;
    expect(call.headers.authorization).toBe("OAuth tok");
    const url = new URL(call.url);
    expect(url.searchParams.get("q")).toBe("deep house");
    expect(url.searchParams.get("genres")).toBe("House");
    expect(url.searchParams.get("bpm[from]")).toBe("120");
    expect(url.searchParams.get("bpm[to]")).toBe("126");
    expect(url.searchParams.get("limit")).toBe("200"); // clamped to API max
    expect(url.searchParams.get("linked_partitioning")).toBe("true");
  });

  it("omits unset parameters", async () => {
    const { mock, client } = setup();
    mock.on("GET", `${API}/tracks?`, json({ collection: [] }));
    await client.searchTracks({ q: "x" });
    const url = new URL(mock.callsTo(`${API}/tracks`)[0]!.url);
    expect([...url.searchParams.keys()].sort()).toEqual(["limit", "linked_partitioning", "q"]);
  });

  it("fetches tracks and playlists by URN", async () => {
    const { mock, client } = setup();
    mock.on("GET", `${API}/tracks/soundcloud%3Atracks%3A42`, json(track({ id: 42 })));
    mock.on("GET", `${API}/playlists/soundcloud%3Aplaylists%3A7?show_tracks=false`, json({ kind: "playlist", urn: "soundcloud:playlists:7" }));
    expect((await client.getTrack("soundcloud:tracks:42")).urn).toBe("soundcloud:tracks:42");
    expect((await client.getPlaylist("soundcloud:playlists:7", false)).urn).toBe("soundcloud:playlists:7");
  });

  it("re-authenticates once on 401", async () => {
    const mock = new MockFetch();
    mock.on("POST", TOKEN_URL, tokenResponse("old"), 1);
    mock.on("POST", TOKEN_URL, tokenResponse("new"));
    mock.on("GET", `${API}/tracks/`, json({ error: "expired" }, 401), 1);
    mock.on("GET", `${API}/tracks/`, json(track({ id: 1 })));
    const auth = new ClientCredentialsAuth({ clientId: "id", clientSecret: "s", fetch: mock.fetch });
    const client = new SoundCloudClient({ auth, fetch: mock.fetch, sleep: noSleep });

    await client.getTrack("soundcloud:tracks:1");
    const apiCalls = mock.callsTo(`${API}/tracks/`);
    expect(apiCalls.map((c) => c.headers.authorization)).toEqual(["OAuth old", "OAuth new"]);
  });

  it("gives up after a second 401", async () => {
    const { mock, client } = setup();
    mock.on("GET", `${API}/tracks/`, json({}, 401));
    await expect(client.getTrack("soundcloud:tracks:1")).rejects.toBeInstanceOf(AuthError);
  });

  it("waits for Retry-After on 429 and retries", async () => {
    const waits: number[] = [];
    const { mock, client } = setup({ sleep: async (ms) => void waits.push(ms) });
    mock.on("GET", `${API}/tracks/`, json({}, 429, { "retry-after": "2" }), 1);
    mock.on("GET", `${API}/tracks/`, json(track({ id: 5 })));
    await expect(client.getTrack("soundcloud:tracks:5")).resolves.toMatchObject({ urn: "soundcloud:tracks:5" });
    expect(waits).toEqual([2000]);
  });

  it("throws RateLimitError when Retry-After is too long or retries are exhausted", async () => {
    const { mock, client } = setup();
    mock.on("GET", `${API}/tracks/`, json({}, 429, { "retry-after": "3600" }));
    const err = await client.getTrack("soundcloud:tracks:5").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterSeconds).toBe(3600);

    const second = setup();
    second.mock.on("GET", `${API}/tracks/`, json({}, 429, { "retry-after": "1" }));
    await expect(second.client.getTrack("soundcloud:tracks:5")).rejects.toBeInstanceOf(RateLimitError);
    expect(second.mock.callsTo(`${API}/tracks/`)).toHaveLength(3); // 1 + 2 retries
  });

  it("maps 404 to NotFoundError and other failures to SoundCloudError", async () => {
    const { mock, client } = setup();
    mock.on("GET", `${API}/tracks/soundcloud%3Atracks%3A404`, json({}, 404));
    mock.on("GET", `${API}/tracks/soundcloud%3Atracks%3A500`, new Response("boom", { status: 500 }));
    mock.on("GET", `${API}/tracks/soundcloud%3Atracks%3A200`, new Response("not json", { status: 200 }));
    await expect(client.getTrack("soundcloud:tracks:404")).rejects.toBeInstanceOf(NotFoundError);
    await expect(client.getTrack("soundcloud:tracks:500")).rejects.toThrow(/HTTP 500/);
    await expect(client.getTrack("soundcloud:tracks:200")).rejects.toBeInstanceOf(SoundCloudError);
  });

  it("follows next_href only on api.soundcloud.com", async () => {
    const { mock, client } = setup();
    mock.on("GET", `${API}/tracks?cursor=abc`, json({ collection: [track()] }));
    await expect(client.nextPage(`${API}/tracks?cursor=abc`)).resolves.toMatchObject({ collection: [expect.any(Object)] });
    await expect(client.nextPage("https://evil.example.com/tracks?cursor=abc")).rejects.toBeInstanceOf(InputError);
    await expect(client.nextPage("http://api.soundcloud.com/tracks")).rejects.toBeInstanceOf(InputError);
    for (const audio of ["/tracks/1/download", "/tracks/1/stream", "/tracks/soundcloud:tracks:1/streams", "/tracks/1/preview"]) {
      await expect(client.nextPage(`${API}${audio}`)).rejects.toBeInstanceOf(InputError);
    }
    expect(mock.calls.some((c) => /download|stream|preview/.test(c.url))).toBe(false);
    expect(mock.calls.some((c) => c.url.includes("evil.example.com"))).toBe(false);
  });

  describe("resolve", () => {
    it("follows a 302 Location to the API resource without auto-redirect", async () => {
      const { mock, client } = setup();
      mock.on(
        "GET",
        `${API}/resolve?url=`,
        new Response(null, { status: 302, headers: { location: `${API}/tracks/soundcloud:tracks:99` } }),
      );
      mock.on("GET", `${API}/tracks/soundcloud:tracks:99`, json(track({ id: 99, title: "Resolved" })));

      const r = await client.resolve("https://soundcloud.com/artist/resolved");
      expect(r).toMatchObject({ type: "track", urn: "soundcloud:tracks:99", id: "99" });
      expect(r.resource).toMatchObject({ title: "Resolved" });

      const resolveCall = mock.callsTo(`${API}/resolve`)[0]!;
      expect(resolveCall.redirect).toBe("manual");
      expect(new URL(resolveCall.url).searchParams.get("url")).toBe("https://soundcloud.com/artist/resolved");
    });

    it("accepts a JSON body with location (Found schema)", async () => {
      const { mock, client } = setup();
      mock.on("GET", `${API}/resolve?url=`, json({ status: "302 - Found", location: `${API}/playlists/soundcloud:playlists:5` }));
      mock.on("GET", `${API}/playlists/soundcloud:playlists:5`, json({ kind: "playlist", urn: "soundcloud:playlists:5", title: "Set" }));
      await expect(client.resolve("https://soundcloud.com/a/sets/set")).resolves.toMatchObject({ type: "playlist", id: "5" });
    });

    it("accepts a resource returned directly", async () => {
      const { mock, client } = setup();
      mock.on("GET", `${API}/resolve?url=`, json({ kind: "user", urn: "soundcloud:users:3", username: "dj" }));
      await expect(client.resolve("https://soundcloud.com/dj")).resolves.toMatchObject({ type: "user", urn: "soundcloud:users:3" });
    });

    it("refuses to follow a redirect off api.soundcloud.com (no token leak)", async () => {
      const { mock, client } = setup();
      mock.on("GET", `${API}/resolve?url=`, new Response(null, { status: 302, headers: { location: "https://evil.example.com/x" } }));
      await expect(client.resolve("https://soundcloud.com/a/b")).rejects.toBeInstanceOf(InputError);
      expect(mock.calls.some((c) => c.url.includes("evil"))).toBe(false);
    });

    it("keeps the secret_token of private resources", async () => {
      const { mock, client } = setup();
      mock.on(
        "GET",
        `${API}/resolve?url=`,
        new Response(null, { status: 302, headers: { location: `${API}/playlists/soundcloud:playlists:12?secret_token=s-AbC12` } }),
      );
      mock.on("GET", `${API}/playlists/soundcloud:playlists:12?secret_token=s-AbC12`, json({ kind: "playlist", urn: "soundcloud:playlists:12" }));
      const r = await client.resolve("https://soundcloud.com/a/sets/promo/s-AbC12");
      expect(r.secretToken).toBe("s-AbC12");
    });

    it("falls back to the s-xxxx segment of the public URL for the secret token", async () => {
      const { mock, client } = setup();
      mock.on("GET", `${API}/resolve?url=`, json({ kind: "playlist", urn: "soundcloud:playlists:12" }));
      await expect(client.resolve("https://soundcloud.com/a/sets/promo/s-XyZ9")).resolves.toMatchObject({ secretToken: "s-XyZ9" });
      await expect(client.resolve("https://soundcloud.com/a/sets/promo")).resolves.not.toHaveProperty("secretToken");
    });

    it("refuses a Location pointing at an audio endpoint", async () => {
      const { mock, client } = setup();
      mock.on("GET", `${API}/resolve?url=`, new Response(null, { status: 302, headers: { location: `${API}/tracks/soundcloud:tracks:1/streams` } }));
      await expect(client.resolve("https://soundcloud.com/a/b")).rejects.toBeInstanceOf(InputError);
      expect(mock.calls.some((c) => c.url.includes("/streams"))).toBe(false);
    });

    it("maps 404 to NotFoundError", async () => {
      const { mock, client } = setup();
      mock.on("GET", `${API}/resolve?url=`, json({}, 404));
      await expect(client.resolve("https://soundcloud.com/a/missing")).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it("never calls stream, preview or download endpoints", async () => {
    const { mock, client } = setup();
    mock.on("GET", `${API}/tracks?`, json({ collection: [track({ downloadable: true })] }));
    mock.on("GET", `${API}/tracks/`, json(track({ downloadable: true })));
    await client.searchTracks({ q: "x" });
    await client.getTrack("soundcloud:tracks:1");
    expect(mock.calls.some((c) => /\/(streams?|preview|download)\b/.test(new URL(c.url).pathname))).toBe(false);
  });
});
