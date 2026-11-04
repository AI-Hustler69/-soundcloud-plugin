/**
 * Runtime configuration, read from environment variables only.
 * Credentials are never hard-coded and never logged.
 */

export const SERVER_NAME = "soundcloud-dj-mcp";
export const SERVER_VERSION = "0.1.0";
export const USER_AGENT = `${SERVER_NAME}/${SERVER_VERSION}`;

export type Mode = "api" | "oembed";

export interface Config {
  /** "api" when both credentials are present, otherwise the limited "oembed" mode. */
  mode: Mode;
  clientId?: string;
  clientSecret?: string;
  /** Human-readable warnings about the configuration (safe to log: no secrets). */
  warnings: string[];
}

function clean(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  // Unexpanded placeholders such as "${SOUNDCLOUD_CLIENT_ID}" mean "not set".
  if (trimmed === "" || /^\$\{[^}]*\}$/.test(trimmed)) return undefined;
  return trimmed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const clientId = clean(env.SOUNDCLOUD_CLIENT_ID);
  const clientSecret = clean(env.SOUNDCLOUD_CLIENT_SECRET);
  const warnings: string[] = [];

  if (clientId && clientSecret) {
    return { mode: "api", clientId, clientSecret, warnings };
  }

  if (clientId || clientSecret) {
    warnings.push(
      "Only one of SOUNDCLOUD_CLIENT_ID / SOUNDCLOUD_CLIENT_SECRET is set. Both are required for the SoundCloud API; falling back to limited oEmbed mode.",
    );
  } else {
    warnings.push(
      "SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET are not set. Running in limited oEmbed mode: only resolve_url and get_track (by URL) work, without BPM, license or download information.",
    );
  }
  return { mode: "oembed", warnings };
}
