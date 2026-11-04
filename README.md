# SoundCloud DJ Crate: Claude plugin and MCP server

Find SoundCloud tracks that **their artists made free to download** and build DJ crates ordered by BPM and Camelot key.

The plugin has two parts:

- **MCP server (connector)** `soundcloud`: four read-only tools (`search_tracks`, `get_track`, `get_playlist`, `resolve_url`) on top of the **official SoundCloud API**.
- **Skill** `dj-crate`: a workflow that tells Claude how to find candidates, check download flags and licenses, order the tracks by BPM and Camelot key, and present the set with links and license notes.

> Not affiliated with or endorsed by SoundCloud. You need **your own SoundCloud API credentials** and you must follow SoundCloud's terms (see [What this plugin does not do](#what-this-plugin-does-not-do)).

## What this plugin does not do

These limits are deliberate and are enforced in code and tests:

- **It downloads nothing.** The server returns metadata and links only. It never calls SoundCloud's stream, preview or download endpoints. It never records, rips or converts a stream into a file.
- **It returns a download link only when the artist enabled downloads.** `download_url` is returned only when SoundCloud reports `downloadable: true`. The API sometimes includes a `download_url` for tracks that are not downloadable; the server drops it. The server never requests the link itself; you download from the track page with SoundCloud's own Download button.
- **It does not bypass gates.** "Free download" buttons that go to Hypeddit, ToneDen and similar follow/like/e-mail gates are reported as `gated: true`. They are never opened, followed or automated. If you want the track, open the gate yourself.
- **It does not scrape.** The only data sources are the official SoundCloud API with your own credentials and SoundCloud's documented oEmbed endpoint. No HTML pages are scraped.
- **It does not give legal advice.** License hints are a convenience. Read the [license note](#free-download-does-not-mean-free-to-use-in-public).

You are responsible for using the SoundCloud API under the [SoundCloud API Terms of Use](https://developers.soundcloud.com/docs/api/terms-of-use) and the [SoundCloud Terms of Use](https://soundcloud.com/terms-of-use). Don't share your credentials, and credit artists.

## Requirements

- [Claude Code](https://code.claude.com) or any other MCP client
- Node.js **20 or newer**
- **For full functionality:** your own SoundCloud API app (client ID and client secret). Without one, the server runs in a [limited mode](#limited-mode-without-api-keys).

## Get SoundCloud API credentials

As of November 2026, according to SoundCloud's developer docs and [`soundcloud/api`](https://github.com/soundcloud/api):

1. **You need a SoundCloud Artist Pro subscription.** SoundCloud only lets accounts with an active Artist Pro plan register API apps, and has said it will keep checking that the plan is still active.
2. Sign in and open **[soundcloud.com/you/apps](https://soundcloud.com/you/apps)**. Alternatively, use SoundCloud's official [API credentials CLI](https://github.com/soundcloud/api#readme). Register an app with a name and a short description, such as "personal DJ crate tool".
3. Copy the **Client ID** and **Client Secret**.

Things to know:

- SoundCloud currently allows **one app per person**.
- New self-registered apps may run on **lower limits until SoundCloud reviews them manually**. Some developers report `invalid_client` errors on brand-new apps. If that happens, contact SoundCloud support through the help center.
- SoundCloud may **revoke apps that stay unused** for a long time.
- The server uses the **Client Credentials** flow: tokens come from `https://secure.soundcloud.com/oauth/token` and are cached for about an hour. SoundCloud limits how many tokens an app may request (about 50 per 12 hours), so the server reuses its token and doesn't ask for a new one on every call.

### Keep the credentials out of git

Set them as environment variables only:

```bash
export SOUNDCLOUD_CLIENT_ID="your-client-id"
export SOUNDCLOUD_CLIENT_SECRET="your-client-secret"
```

Put these lines in your shell profile, for example `~/.zshrc` or `~/.bashrc`, so they are set before you start Claude Code. [`.env.example`](.env.example) lists the variables. `.env` files are git-ignored, so never commit a filled-in copy.

## Install

### As a Claude Code plugin (recommended)

The repository is also a plugin marketplace. In Claude Code:

```text
/plugin marketplace add AI-Hustler69/-soundcloud-plugin
/plugin install soundcloud-dj@soundcloud-dj-tools
```

Or from your shell:

```bash
claude plugin marketplace add AI-Hustler69/-soundcloud-plugin
```

```bash
claude plugin install soundcloud-dj@soundcloud-dj-tools
```

Restart Claude Code, or run `/reload-plugins`. Then run `/mcp` and check that the `soundcloud` server is connected.

The plugin starts the server with `node ${CLAUDE_PLUGIN_ROOT}/dist/server.js`. `dist/server.js` is a self-contained bundle committed to the repo, so no `npm install` is needed. The server reads `SOUNDCLOUD_CLIENT_ID` and `SOUNDCLOUD_CLIENT_SECRET` from the environment Claude Code was started with.

### As a standalone MCP server

To use the server in another MCP client, or in Claude Code without the plugin, run the bundle directly:

```bash
git clone https://github.com/AI-Hustler69/-soundcloud-plugin.git soundcloud-dj
```

Register it with Claude Code:

```bash
claude mcp add soundcloud -e SOUNDCLOUD_CLIENT_ID="$SOUNDCLOUD_CLIENT_ID" -e SOUNDCLOUD_CLIENT_SECRET="$SOUNDCLOUD_CLIENT_SECRET" -- node "$PWD/soundcloud-dj/dist/server.js"
```

Other clients, such as Claude Desktop, take a `claude_desktop_config.json` entry like this:

```json
{
  "mcpServers": {
    "soundcloud": {
      "command": "node",
      "args": ["/absolute/path/to/soundcloud-dj/dist/server.js"],
      "env": {
        "SOUNDCLOUD_CLIENT_ID": "your-client-id",
        "SOUNDCLOUD_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

The package is also ready to publish on npm as `soundcloud-dj-mcp`. Once it is published, you can use `"command": "npx", "args": ["-y", "soundcloud-dj-mcp"]` instead of a local path.

## Limited mode without API keys

If the credentials are missing, the server still starts but uses only SoundCloud's public [oEmbed endpoint](https://developers.soundcloud.com/docs/oembed):

| Tool | Without keys |
|---|---|
| `resolve_url` | Works. Returns the type (from the oEmbed embed or the URL pattern), the id when the embed exposes it, the title and the author. |
| `get_track` | Works with a public URL only. Returns the title, artist and artwork. BPM, key, genre, license, download flag and links are **not available**. |
| `search_tracks` | Not available. Returns an explanatory error. |
| `get_playlist` | Not available. Returns an explanatory error. |

Finding downloadable tracks and checking their licenses requires the official API.

## Tools

All tools are read-only and return JSON.

### `search_tracks`

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `query` | string | — | Free text. `query` and/or `genre` is required. |
| `genre` | string | — | Passed to the API `genres` filter; separate several genres with commas. |
| `bpm_min`, `bpm_max` | number | — | Inclusive range. Sent to the API as `bpm[from]`/`bpm[to]` and checked again locally. |
| `downloadable_only` | boolean | `true` | Keep only tracks with `downloadable: true`. The API has no such filter, so it is applied locally. |
| `include_free_download_links` | boolean | `false` | With `downloadable_only`, also keep tracks whose buy link is labelled "free download". These are often gated and are flagged as such. |
| `include_unknown_bpm` | boolean | `false` | With a BPM range, keep tracks that have no BPM. SoundCloud has BPM data for only some tracks. |
| `limit` | integer | `20` | 1–50. |

The tool scans at most 5 result pages of 200 tracks. It returns `results`, filter `stats` (scanned, kept, and how many were dropped and why), `more_available`, `notes` and a `license_reminder`.

### `get_track`

Input: `track`, which can be a public URL, a numeric id or a URN such as `soundcloud:tracks:123`. Returns:

- `title`, `artist`, `genre`, `bpm`, `key_signature`, and `camelot` (for example `8A`);
- `duration` and `duration_ms`;
- `license`, with `code`, `label`, `public_mix` guidance and a `note`;
- `downloadable` and `download_url`. The URL is returned only when the track is downloadable. It is an OAuth-protected API link, so give users the track page instead;
- `purchase`, the buy or "free download" link. Its `kind` is `download_gate`, `file_host`, `store` or `other`, with `labelled_free` and `gated` flags. The server never opens this link;
- `free_download`: `soundcloud_download`, `external_link`, `gated_external_link` or `none`;
- `permalink_url` and `access`.

### `get_playlist`

Input: `playlist` (a URL, id or URN), `downloadable_only` (default `false`) and `max_tracks` (default 200, maximum 500). It goes through every page of the playlist and returns the per-track status plus a summary: how many tracks are downloadable, have a free link, are gated or are not downloadable, and whether the list was truncated.

### `resolve_url`

Input: `url`, a public `soundcloud.com` or `on.soundcloud.com` link to a track, playlist or profile. Returns its `type`, `id`, `urn`, title and author. Links that are not on SoundCloud are rejected before any request is made.

## Usage examples

Ask Claude, and the `dj-crate` skill takes over:

- "Build me a 60-minute melodic techno warm-up crate, 120–124 BPM, only free downloads."
- "Find free-download drum & bass tracks around 174 BPM and sort them by Camelot key."
- "Which tracks in https://soundcloud.com/some-label/sets/free-downloads-2026 can I download, and under what license?"
- "Check this track: https://soundcloud.com/artist/track-name. Is it downloadable, and can I use it in a mix I upload to Mixcloud?"

You can also call the skill directly with `/soundcloud-dj:dj-crate`.

The skill returns a numbered table with these columns: Artist – Title, BPM, key (Camelot), length, a transition note, the link (the track page, where SoundCloud's Download button is, or the artist's external link, with gated links marked) and the license verdict. After the table it lists the dropped tracks and repeats the license reminder.

## "Free download" does not mean free to use in public

A free download on SoundCloud usually only lets **you** have the file for **personal use**. Before you publish, stream or monetise a mix (SoundCloud, Mixcloud, YouTube, Twitch, a paid gig):

- check each track's license and description;
- `all-rights-reserved`: get the artist's permission, or rely on a platform licence;
- CC **NC** (NonCommercial): no monetised or commercial use;
- CC **ND** (NoDerivatives): a mix may count as an adaptation, so ask the artist;
- CC BY / BY-SA / no-rights-reserved: generally fine with credit.

The server's `license.public_mix` field is a hint, not legal advice.

## Development

```bash
npm install
```

```bash
npm run build
```

```bash
npm test
```

```bash
npm run list-tools
```

- `npm run build` type-checks the code and bundles `src/` into `dist/server.js` with esbuild. Commit the rebuilt `dist/server.js` together with any source change.
- `npm test` runs the vitest suite. Every test uses a scripted, mocked `fetch`, and a global setup makes any real network call fail. **No test calls the SoundCloud API.**
- `npm run list-tools` starts the bundled server over stdio, does the MCP handshake and prints the tools.

Project layout:

```text
.claude-plugin/plugin.json       plugin manifest
.claude-plugin/marketplace.json  single-plugin marketplace (this repo)
.mcp.json                        starts dist/server.js with your env credentials
skills/dj-crate/SKILL.md         DJ crate workflow
src/
  index.ts                       stdio entry point
  server.ts                      MCP tool registration (zod schemas)
  tools.ts                       tool logic (search paging, playlist walk, fallback)
  config.ts                      environment configuration
  soundcloud/auth.ts             OAuth 2.1 client credentials, token cache
  soundcloud/client.ts           read-only API client (URNs, 401/429 handling)
  soundcloud/oembed.ts           key-less oEmbed fallback
  soundcloud/urls.ts             URL / id / URN parsing and host checks
  tracks.ts                      track normalisation, purchase-link classification
  filters.ts                     downloadable / BPM filters
  licenses.ts                    license guidance
  camelot.ts                     key → Camelot conversion and compatibility
tests/                           vitest suites with mocked API responses
```

## Known limitations

- **BPM and key are often missing.** SoundCloud returns `bpm` and `key_signature` only for tracks where analysis data exists, and many tracks have neither. The server-side BPM filter has also been unreliable in the past, which is why every result is checked again locally.
- **`download_url` is an API link, not a browser link.** It points to `api.soundcloud.com` and works only with an OAuth token, so clicking it in a browser fails even when you are signed in. The server returns it as metadata confirming the artist enabled downloads, and never requests it. To actually download, open the track page (`permalink_url`) and use SoundCloud's own Download button, which is there whenever downloads are enabled.
- **Rate limits:** the server honours `429` and `Retry-After`, waiting briefly once or twice before giving up. Searches scan at most 5 pages.
- **Gate detection is a heuristic** based on a list of known gate domains. An unknown gate shows up as `kind: "other"`; the server still never follows it.
- The API surface was checked against SoundCloud's official OpenAPI spec (`soundcloud/api`, November 2026). If SoundCloud changes the API, open an issue.

## License

[MIT](LICENSE). The code is MIT-licensed. Content you find through SoundCloud stays under its creators' licenses.
