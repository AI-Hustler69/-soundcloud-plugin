import { describe, expect, it } from "vitest";
import { InputError } from "../src/soundcloud/errors.js";
import { idFromEmbedHtml } from "../src/soundcloud/oembed.js";
import {
  assertApiUrl,
  guessTypeFromUrl,
  parseApiResourceUrl,
  parseIdInput,
  parsePublicUrl,
  parseUrn,
} from "../src/soundcloud/urls.js";

describe("parsePublicUrl", () => {
  it("accepts soundcloud hosts and normalises them", () => {
    expect(parsePublicUrl("http://m.soundcloud.com/a/b").toString()).toBe("https://soundcloud.com/a/b");
    expect(parsePublicUrl(" https://www.soundcloud.com/a ").hostname).toBe("soundcloud.com");
    expect(parsePublicUrl("https://on.soundcloud.com/AbCd").hostname).toBe("on.soundcloud.com");
    expect(parsePublicUrl("soundcloud.com/a/b").toString()).toBe("https://soundcloud.com/a/b");
    expect(parsePublicUrl("m.soundcloud.com/a").toString()).toBe("https://soundcloud.com/a");
    expect(parseIdInput("soundcloud.com/a/b", "track")).toMatchObject({ kind: "url" });
  });

  it.each(["https://evil.com/soundcloud.com/a", "https://soundcloud.com.evil.com/a", "ftp://soundcloud.com/a", "nope", "file:///etc/passwd"])(
    "rejects %s",
    (input) => {
      expect(() => parsePublicUrl(input)).toThrow(InputError);
    },
  );
});

describe("guessTypeFromUrl", () => {
  it.each([
    ["https://soundcloud.com/artist", "user"],
    ["https://soundcloud.com/artist/tracks", "user"],
    ["https://soundcloud.com/artist/my-track", "track"],
    ["https://soundcloud.com/artist/my-track/s-SeCrEt", "track"],
    ["https://soundcloud.com/artist/sets/my-set", "playlist"],
    ["https://soundcloud.com/discover", undefined],
    ["https://soundcloud.com/search?q=x", undefined],
    ["https://on.soundcloud.com/AbCd", undefined],
    ["https://soundcloud.com/artist/sets", "user"],
  ])("%s -> %s", (url, expected) => {
    expect(guessTypeFromUrl(new URL(url))).toBe(expected);
  });
});

describe("ids and URNs", () => {
  it("parses URNs", () => {
    expect(parseUrn("soundcloud:tracks:12")).toEqual({ type: "track", id: "12" });
    expect(parseUrn("soundcloud:tracks:abc")).toBeUndefined();
  });

  it("parses API resource URLs in URN and numeric form", () => {
    expect(parseApiResourceUrl("https://api.soundcloud.com/tracks/soundcloud:tracks:9")).toMatchObject({ type: "track", id: "9" });
    expect(parseApiResourceUrl("https://api.soundcloud.com/playlists/5")).toMatchObject({ urn: "soundcloud:playlists:5" });
    expect(parseApiResourceUrl("https://api.soundcloud.com/users/soundcloud%3Ausers%3A3")).toMatchObject({ type: "user" });
    expect(parseApiResourceUrl("https://evil.com/tracks/1")).toBeUndefined();
  });

  it("parseIdInput handles ids, URNs, API URLs and public URLs", () => {
    expect(parseIdInput("123", "track")).toEqual({ kind: "urn", urn: "soundcloud:tracks:123" });
    expect(parseIdInput("soundcloud:playlists:4", "playlist")).toEqual({ kind: "urn", urn: "soundcloud:playlists:4" });
    expect(parseIdInput("https://api.soundcloud.com/tracks/8", "track")).toEqual({ kind: "urn", urn: "soundcloud:tracks:8" });
    const r = parseIdInput("https://soundcloud.com/a/b", "track");
    expect(r.kind).toBe("url");
    expect(() => parseIdInput("soundcloud:playlists:4", "track")).toThrow(InputError);
    expect(() => parseIdInput("hello", "track")).toThrow(InputError);
  });

  it("assertApiUrl only allows https api.soundcloud.com", () => {
    expect(assertApiUrl("https://api.soundcloud.com/tracks?cursor=1").hostname).toBe("api.soundcloud.com");
    expect(() => assertApiUrl("https://api.soundcloud.com.evil.com/x")).toThrow(InputError);
    expect(() => assertApiUrl("http://api.soundcloud.com/x")).toThrow(InputError);
  });
});

describe("idFromEmbedHtml", () => {
  it("extracts the id from the oEmbed iframe src", () => {
    const html =
      '<iframe width="100%" height="400" scrolling="no" frameborder="no" src="https://w.soundcloud.com/player/?visual=true&url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F293&show_artwork=true"></iframe>';
    expect(idFromEmbedHtml(html)).toEqual({ type: "track", id: "293" });
    const playlist = html.replace("tracks%2F293", "playlists%2F77");
    expect(idFromEmbedHtml(playlist)).toEqual({ type: "playlist", id: "77" });
    const urnForm = html.replace("tracks%2F293", "tracks%2Fsoundcloud%253Atracks%253A55").replace("%253A", ":").replace("%253A", ":");
    expect(idFromEmbedHtml(urnForm)).toEqual({ type: "track", id: "55" });
  });

  it("returns undefined for unexpected html", () => {
    expect(idFromEmbedHtml(undefined)).toBeUndefined();
    expect(idFromEmbedHtml("<div></div>")).toBeUndefined();
    expect(idFromEmbedHtml('<iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fevil.com%2Ftracks%2F1"></iframe>')).toBeUndefined();
  });
});
