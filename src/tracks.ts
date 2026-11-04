/**
 * Normalises raw SoundCloud track objects into the compact shape returned by
 * the MCP tools, and classifies "buy / free download" links WITHOUT ever
 * visiting them.
 */
import { toCamelot } from "./camelot.js";
import { describeLicense, type LicenseInfo } from "./licenses.js";
import type { SCTrack } from "./soundcloud/types.js";

/** Third-party download gates (follow / like / e-mail to download). Never followed or bypassed. */
const GATE_HOSTS = [
  "hypeddit.com",
  "toneden.io",
  "gate.fm",
  "show.co",
  "feature.fm",
  "ffm.to",
  "edmdistrict.com",
  "dmgate.com",
  "unlockthemusic.com",
];

const FILE_HOSTS = ["dropbox.com", "drive.google.com", "mega.nz", "wetransfer.com", "we.tl", "mediafire.com", "box.com"];

const STORE_HOSTS = [
  "bandcamp.com",
  "beatport.com",
  "traxsource.com",
  "junodownload.com",
  "itunes.apple.com",
  "music.apple.com",
  "amazon.com",
  "7digital.com",
  "boomkat.com",
];

const FREE_TITLE_RE = /\b(free|gratis|freebie)\b|\bfree\s*(dl|download)\b|\bdownload\b|\bdl\b/i;

export type PurchaseLinkKind = "download_gate" | "file_host" | "store" | "other";

export interface PurchaseLink {
  url: string;
  title: string | null;
  kind: PurchaseLinkKind;
  /** The link text suggests a free download (e.g. "Free Download"). */
  labelled_free: boolean;
  /** Requires a follow / like / e-mail gate on a third-party site. */
  gated: boolean;
  note: string;
}

export interface TrackSummary {
  urn: string | null;
  id: string | null;
  title: string | null;
  artist: string | null;
  uploader: { username: string | null; permalink_url: string | null } | null;
  genre: string | null;
  tags: string | null;
  bpm: number | null;
  key_signature: string | null;
  camelot: string | null;
  duration_ms: number | null;
  duration: string | null;
  license: LicenseInfo;
  /** True only when the uploader enabled SoundCloud's native download. */
  downloadable: boolean;
  /**
   * SoundCloud API download link; null unless `downloadable` is true.
   * OAuth-protected (api.soundcloud.com), so it does not open in a browser:
   * users download from `permalink_url` with SoundCloud's own button.
   */
  download_url: string | null;
  purchase: PurchaseLink | null;
  /** How (if at all) the artist offers a free download. */
  free_download: "soundcloud_download" | "external_link" | "gated_external_link" | "none";
  permalink_url: string | null;
  access: string | null;
  release_year: number | null;
  label_name: string | null;
  artwork_url: string | null;
}

function hostMatches(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Classifies a purchase_url purely from its text. Never fetches it. */
export function classifyPurchaseLink(url: string | null | undefined, title: string | null | undefined): PurchaseLink | null {
  if (!url || !url.trim()) return null;
  const cleanTitle = title?.trim() || null;
  let host = "";
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    host = parsed.hostname;
  } catch {
    return null;
  }
  const labelledFree = cleanTitle ? FREE_TITLE_RE.test(cleanTitle) : false;

  if (hostMatches(host, GATE_HOSTS)) {
    return {
      url: url.trim(),
      title: cleanTitle,
      kind: "download_gate",
      labelled_free: labelledFree,
      gated: true,
      note: "Third-party download gate (follow/like/e-mail). Open it yourself in a browser if you accept its conditions; this tool does not bypass or automate gates.",
    };
  }
  if (hostMatches(host, FILE_HOSTS)) {
    return {
      url: url.trim(),
      title: cleanTitle,
      kind: "file_host",
      labelled_free: labelledFree,
      gated: false,
      note: "External file-hosting link provided by the uploader. Check the track license before public use.",
    };
  }
  if (hostMatches(host, STORE_HOSTS)) {
    return {
      url: url.trim(),
      title: cleanTitle,
      kind: "store",
      labelled_free: labelledFree,
      gated: false,
      note: labelledFree
        ? "Store link labelled as free (often name-your-price). Price and terms are set on the store page."
        : "Store / purchase link.",
    };
  }
  return {
    url: url.trim(),
    title: cleanTitle,
    kind: "other",
    labelled_free: labelledFree,
    gated: false,
    note: "External link set by the uploader. It may lead to a gate or a store; open it yourself to check.",
  };
}

export function formatDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** Strictly true only for an explicit `downloadable: true` from the API. */
export function isDownloadable(track: SCTrack): boolean {
  return track.downloadable === true;
}

export function summarizeTrack(track: SCTrack): TrackSummary {
  const urn = str(track.urn) ?? (typeof track.id === "number" ? `soundcloud:tracks:${track.id}` : null);
  const downloadable = isDownloadable(track);
  const purchase = classifyPurchaseLink(track.purchase_url, track.purchase_title);
  const keySig = str(track.key_signature);
  const camelot = toCamelot(keySig);

  let freeDownload: TrackSummary["free_download"] = "none";
  if (downloadable) freeDownload = "soundcloud_download";
  else if (purchase?.labelled_free) freeDownload = purchase.gated ? "gated_external_link" : "external_link";

  return {
    urn,
    id: urn ? (urn.split(":").pop() ?? null) : null,
    title: str(track.title),
    artist: str(track.metadata_artist) ?? str(track.user?.username),
    uploader: track.user
      ? { username: str(track.user.username), permalink_url: str(track.user.permalink_url) }
      : null,
    genre: str(track.genre),
    tags: str(track.tag_list),
    bpm: num(track.bpm),
    key_signature: keySig,
    camelot: camelot?.code ?? null,
    duration_ms: typeof track.duration === "number" ? track.duration : null,
    duration: formatDuration(track.duration),
    license: describeLicense(track.license),
    downloadable,
    // The API may return a download_url even when downloadable is false
    // (see the official spec example). Only expose it when the artist enabled downloads.
    download_url: downloadable ? str(track.download_url) : null,
    purchase,
    free_download: freeDownload,
    permalink_url: str(track.permalink_url),
    access: str(track.access),
    release_year: num(track.release_year),
    label_name: str(track.label_name),
    artwork_url: str(track.artwork_url),
  };
}
