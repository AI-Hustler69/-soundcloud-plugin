import { describe, expect, it } from "vitest";
import { describeLicense } from "../src/licenses.js";
import { classifyPurchaseLink, formatDuration, summarizeTrack } from "../src/tracks.js";
import { track } from "./helpers.js";

describe("summarizeTrack", () => {
  it("hides download_url when downloadable is false (official spec example returns one anyway)", () => {
    const s = summarizeTrack(
      track({ id: 1234, downloadable: false, download_url: "https://api.soundcloud.com/tracks/1234/download" }),
    );
    expect(s.downloadable).toBe(false);
    expect(s.download_url).toBeNull();
    expect(s.free_download).toBe("none");
  });

  it("exposes download_url only when downloadable is exactly true", () => {
    const s = summarizeTrack(track({ id: 1, downloadable: true, download_url: "https://api.soundcloud.com/tracks/1/download" }));
    expect(s.downloadable).toBe(true);
    expect(s.download_url).toBe("https://api.soundcloud.com/tracks/1/download");
    expect(s.free_download).toBe("soundcloud_download");

    // Truthy but not boolean true must not count.
    const weird = summarizeTrack(track({ downloadable: "true" as unknown as boolean, download_url: "https://x" }));
    expect(weird.downloadable).toBe(false);
    expect(weird.download_url).toBeNull();
  });

  it("normalises metadata, BPM, key and duration", () => {
    const s = summarizeTrack(
      track({
        id: 77,
        title: "  Night Drive ",
        metadata_artist: "Guest Artist",
        bpm: 124,
        key_signature: "A minor",
        duration: 3_725_000,
        genre: "Tech House",
        license: "cc-by-nc",
      }),
    );
    expect(s).toMatchObject({
      urn: "soundcloud:tracks:77",
      id: "77",
      title: "Night Drive",
      artist: "Guest Artist",
      bpm: 124,
      key_signature: "A minor",
      camelot: "8A",
      duration_ms: 3_725_000,
      duration: "1:02:05",
      genre: "Tech House",
    });
    expect(s.license.public_mix).toBe("non_commercial_only");
  });

  it("treats bpm 0 / missing values as unknown and falls back to uploader name", () => {
    const s = summarizeTrack(track({ bpm: 0, key_signature: "", metadata_artist: null, user: { username: "uploader" } }));
    expect(s.bpm).toBeNull();
    expect(s.key_signature).toBeNull();
    expect(s.camelot).toBeNull();
    expect(s.artist).toBe("uploader");
  });

  it("derives the URN from a numeric id when urn is missing", () => {
    expect(summarizeTrack({ id: 5, title: "x" }).urn).toBe("soundcloud:tracks:5");
    expect(summarizeTrack({ title: "x" }).urn).toBeNull();
  });

  it("marks gated and ungated free-download links", () => {
    const gated = summarizeTrack(track({ purchase_url: "https://hypeddit.com/abc/track", purchase_title: "Free Download" }));
    expect(gated.free_download).toBe("gated_external_link");
    expect(gated.purchase).toMatchObject({ kind: "download_gate", gated: true, labelled_free: true });
    expect(gated.download_url).toBeNull();

    const direct = summarizeTrack(track({ purchase_url: "https://www.dropbox.com/s/x/file.wav", purchase_title: "FREE DL" }));
    expect(direct.free_download).toBe("external_link");
    expect(direct.purchase?.gated).toBe(false);

    const buy = summarizeTrack(track({ purchase_url: "https://www.beatport.com/track/x/1", purchase_title: "Buy" }));
    expect(buy.free_download).toBe("none");
    expect(buy.purchase?.kind).toBe("store");
  });
});

describe("classifyPurchaseLink", () => {
  it("recognises gate hosts including subdomains", () => {
    for (const url of ["https://hypeddit.com/x", "https://www.toneden.io/x/post/y", "https://ffm.to/abc", "https://gate.fm/x"]) {
      expect(classifyPurchaseLink(url, "Free Download")?.kind).toBe("download_gate");
    }
  });

  it("does not match look-alike hosts", () => {
    expect(classifyPurchaseLink("https://nothypeddit.com/x", "Free Download")?.kind).toBe("other");
  });

  it("rejects empty or non-http links", () => {
    expect(classifyPurchaseLink(null, "x")).toBeNull();
    expect(classifyPurchaseLink("   ", "x")).toBeNull();
    expect(classifyPurchaseLink("javascript:alert(1)", "Free")).toBeNull();
    expect(classifyPurchaseLink("not a url", "Free")).toBeNull();
  });

  it("detects free labels", () => {
    expect(classifyPurchaseLink("https://artist.bandcamp.com/track/x", "Free Download")?.labelled_free).toBe(true);
    expect(classifyPurchaseLink("https://example.com", "FREE DL")?.labelled_free).toBe(true);
    expect(classifyPurchaseLink("https://example.com", "Buy on Beatport")?.labelled_free).toBe(false);
    expect(classifyPurchaseLink("https://example.com", null)?.labelled_free).toBe(false);
  });
});

describe("formatDuration", () => {
  it("formats m:ss and h:mm:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(40_000)).toBe("0:40");
    expect(formatDuration(361_000)).toBe("6:01");
    expect(formatDuration(3_600_000)).toBe("1:00:00");
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
  });
});

describe("describeLicense", () => {
  it.each([
    ["all-rights-reserved", "permission_required"],
    ["cc-by", "likely_ok_with_attribution"],
    ["cc-by-sa", "likely_ok_with_attribution"],
    ["cc-by-nc", "non_commercial_only"],
    ["cc-by-nc-sa", "non_commercial_only"],
    ["cc-by-nd", "no_derivatives_check_with_artist"],
    ["cc-by-nc-nd", "no_derivatives_check_with_artist"],
    ["no-rights-reserved", "likely_ok_with_attribution"],
    [null, "unknown"],
    ["something-new", "unknown"],
  ])("%s -> %s", (code, expected) => {
    expect(describeLicense(code).public_mix).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(describeLicense("CC-BY").code).toBe("cc-by");
  });
});
