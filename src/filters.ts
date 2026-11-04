/**
 * Client-side filtering. The SoundCloud API has no "downloadable" filter and
 * its bpm filter is unreliable (bpm is null for many tracks), so results are
 * always re-checked here.
 */
import type { TrackSummary } from "./tracks.js";

export interface TrackFilter {
  /** Keep only tracks the artist made downloadable on SoundCloud. */
  downloadableOnly: boolean;
  /** Also keep tracks whose buy link is labelled as a free download (may be gated). */
  includeFreeDownloadLinks: boolean;
  bpmMin?: number;
  bpmMax?: number;
  /** Keep tracks with unknown BPM when a BPM range is given. */
  includeUnknownBpm: boolean;
}

export type RejectReason = "not_downloadable" | "bpm_unknown" | "bpm_out_of_range" | "duplicate";

export function hasBpmRange(f: Pick<TrackFilter, "bpmMin" | "bpmMax">): boolean {
  return f.bpmMin !== undefined || f.bpmMax !== undefined;
}

/** Returns null when the track passes, otherwise the reason it was dropped. */
export function rejectReason(t: TrackSummary, f: TrackFilter): RejectReason | null {
  if (f.downloadableOnly) {
    const viaLink = f.includeFreeDownloadLinks && t.free_download !== "none";
    if (!t.downloadable && !viaLink) return "not_downloadable";
  }
  if (hasBpmRange(f)) {
    if (t.bpm === null) {
      if (!f.includeUnknownBpm) return "bpm_unknown";
    } else {
      if (f.bpmMin !== undefined && t.bpm < f.bpmMin) return "bpm_out_of_range";
      if (f.bpmMax !== undefined && t.bpm > f.bpmMax) return "bpm_out_of_range";
    }
  }
  return null;
}

export interface FilterStats {
  scanned: number;
  kept: number;
  rejected: Record<RejectReason, number>;
}

export function emptyStats(): FilterStats {
  return { scanned: 0, kept: 0, rejected: { not_downloadable: 0, bpm_unknown: 0, bpm_out_of_range: 0, duplicate: 0 } };
}

/** Filters in place order, de-duplicating by URN, and accumulates stats. */
export function applyFilter(
  tracks: TrackSummary[],
  f: TrackFilter,
  stats: FilterStats = emptyStats(),
  seen: Set<string> = new Set(),
): TrackSummary[] {
  const out: TrackSummary[] = [];
  for (const t of tracks) {
    stats.scanned++;
    const key = t.urn ?? t.permalink_url ?? "";
    if (key && seen.has(key)) {
      stats.rejected.duplicate++;
      continue;
    }
    if (key) seen.add(key);
    const reason = rejectReason(t, f);
    if (reason) {
      stats.rejected[reason]++;
      continue;
    }
    stats.kept++;
    out.push(t);
  }
  return out;
}
