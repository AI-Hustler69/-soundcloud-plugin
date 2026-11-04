import { describe, expect, it } from "vitest";
import { applyFilter, emptyStats, rejectReason, type TrackFilter } from "../src/filters.js";
import { summarizeTrack } from "../src/tracks.js";
import { track } from "./helpers.js";

const base: TrackFilter = { downloadableOnly: true, includeFreeDownloadLinks: false, includeUnknownBpm: false };

describe("rejectReason", () => {
  const dl = summarizeTrack(track({ downloadable: true, bpm: 124 }));
  const notDl = summarizeTrack(track({ downloadable: false, bpm: 124 }));
  const gated = summarizeTrack(track({ purchase_url: "https://hypeddit.com/x", purchase_title: "Free Download", bpm: 124 }));
  const noBpm = summarizeTrack(track({ downloadable: true, bpm: null }));

  it("keeps only downloadable tracks by default", () => {
    expect(rejectReason(dl, base)).toBeNull();
    expect(rejectReason(notDl, base)).toBe("not_downloadable");
    expect(rejectReason(gated, base)).toBe("not_downloadable");
  });

  it("optionally keeps free-download links", () => {
    expect(rejectReason(gated, { ...base, includeFreeDownloadLinks: true })).toBeNull();
    expect(rejectReason(notDl, { ...base, includeFreeDownloadLinks: true })).toBe("not_downloadable");
  });

  it("keeps everything when downloadableOnly is false", () => {
    expect(rejectReason(notDl, { ...base, downloadableOnly: false })).toBeNull();
  });

  it("applies inclusive BPM bounds", () => {
    expect(rejectReason(dl, { ...base, bpmMin: 124, bpmMax: 124 })).toBeNull();
    expect(rejectReason(dl, { ...base, bpmMin: 125 })).toBe("bpm_out_of_range");
    expect(rejectReason(dl, { ...base, bpmMax: 123.9 })).toBe("bpm_out_of_range");
  });

  it("drops unknown BPM only when a range is set and include_unknown_bpm is false", () => {
    expect(rejectReason(noBpm, base)).toBeNull();
    expect(rejectReason(noBpm, { ...base, bpmMin: 120 })).toBe("bpm_unknown");
    expect(rejectReason(noBpm, { ...base, bpmMin: 120, includeUnknownBpm: true })).toBeNull();
  });
});

describe("applyFilter", () => {
  it("filters, de-duplicates and counts reasons", () => {
    const a = track({ id: 1, downloadable: true, bpm: 122 });
    const tracks = [a, a, track({ id: 2, downloadable: false }), track({ id: 3, downloadable: true, bpm: 140 })].map(
      summarizeTrack,
    );
    const stats = emptyStats();
    const out = applyFilter(tracks, { ...base, bpmMin: 120, bpmMax: 128 }, stats);
    expect(out.map((t) => t.id)).toEqual(["1"]);
    expect(stats).toEqual({
      scanned: 4,
      kept: 1,
      rejected: { not_downloadable: 1, bpm_unknown: 0, bpm_out_of_range: 1, duplicate: 1 },
    });
  });
});
