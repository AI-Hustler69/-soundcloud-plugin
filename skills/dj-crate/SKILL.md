---
name: dj-crate
description: Build a DJ crate or mix set from SoundCloud tracks that their artists made free to download. Use when the user wants to find free-download / downloadable SoundCloud tracks for a DJ mix, build a set or crate by genre, BPM or key, check which tracks in a SoundCloud playlist can be downloaded, or order tracks by BPM and Camelot key for harmonic mixing.
---

# DJ crate from free SoundCloud downloads

Build a mix-ready crate from SoundCloud tracks whose **artists themselves enabled downloads**, using the `soundcloud` MCP tools (`search_tracks`, `get_track`, `get_playlist`, `resolve_url`). Reply in the user's language.

## Hard rules

- The tools return **metadata and links only**. Never download, record, rip or convert streams, and never suggest stream-ripping tools or websites.
- The link to give the user is always the track page (`permalink_url`). When `downloadable` is `true`, tell them to use SoundCloud's **Download** button there. `download_url` is an OAuth-protected API link that does not open in a browser: treat it only as confirmation that downloads are enabled, and never show it as a clickable link.
- **Never bypass download gates** (Hypeddit, ToneDen, follow/like/repost or e-mail gates). When `purchase.gated` is `true`, say it is a gate and that the user can open it themselves if they accept its conditions.
- Do not invent BPM, key or license data. If a field is `null`, say "unknown".

## Workflow

### 1. Brief

Get (or assume sensible defaults and state them):

- genre / vibe and any reference artists;
- BPM target or range (default: target ±3 BPM);
- set length or number of tracks (default: 10 tracks, about 60 minutes);
- whether the mix will be **public** (streamed, uploaded, played at a paid gig) or **private** practice. This decides how strict the license check must be.

### 2. Find candidates

- Call `search_tracks` with `downloadable_only: true` (the default), the genre and the BPM range. Run 2–4 query variations (genre synonyms, sub-genres, mood words, reference artists) to build a pool of about 2–3× the tracks needed.
- If the pool is thin, try `include_unknown_bpm: true` (then flag those tracks), widen the BPM range, or, if the user agrees, `include_free_download_links: true` to add tracks with external "free download" links (often gated).
- For a playlist or label set the user shares, call `resolve_url` if needed and then `get_playlist`. Use `downloadable_only: true` to list just the downloadable tracks.
- If a tool says credentials are missing (limited oEmbed mode), explain that search, BPM, license and download data need the user's own SoundCloud API keys (see the plugin README). Then continue with whatever URLs the user provides via `get_track`, which returns title and artist only.

### 3. Verify each finalist

For each track you plan to use, check from the tool output:

| Check | Field | Action |
|---|---|---|
| Artist-enabled download | `downloadable` / `free_download` | `soundcloud_download` = OK. `external_link` = mention the link. `gated_external_link` = flag the gate. `none` = drop it unless the user wants it anyway. |
| License | `license.code`, `license.public_mix`, `license.note` | See the license section below. For a public mix, prefer `likely_ok_with_attribution`. |
| Playable | `access` | Drop `blocked`. Note `preview`. |
| Tempo / key | `bpm`, `camelot` | Unknown values are allowed but must be flagged ("analyse in your DJ software after downloading"). |

Call `get_track` for any finalist whose details look incomplete.

### 4. Order the set

1. **Tempo:** sort by BPM so each step changes by at most about 3 BPM (about 2–3 %). Bigger jumps need a breakdown, an echo-out or a deliberate tempo change; mention which.
2. **Key (Camelot):** within a similar tempo, chain compatible keys:
   - same code (8A → 8A): smoothest;
   - ±1 on the wheel with the same letter (8A → 9A or 7A): standard;
   - relative major/minor, same number (8A ↔ 8B): mood change;
   - +2 with the same letter (8A → 10A): "energy boost", use sparingly;
   - anything else is a clash, so mark it and suggest a short blend or a cut.
3. **Energy arc:** warm-up → build → peak → cool-down. Put tracks with unknown BPM or key where a cut or longer blend is acceptable.

### 5. Output

Give a numbered table:

| # | Artist – Title | BPM | Key (Camelot) | Length | Transition | Get it | License |
|---|---|---|---|---|---|---|---|

- **Transition**: e.g. "8A→9A, +1 BPM, long blend" or "clash, cut on the drop".
- **Get it**: the track page `permalink_url`, with "Download button on SoundCloud" when `downloadable` is true; or the artist's external link (`purchase.url`), marked *(gated)* when `purchase.gated` is true.
- **License**: the label and a one-line `public_mix` verdict.

Then add the total runtime, the tracks you dropped and why (one line each), and the license reminder below.

## License reminder (always include)

> "Free download" on SoundCloud usually means **personal use only**. Before you publish, stream or monetise a mix (SoundCloud, Mixcloud, YouTube, Twitch, a paid gig), check each track's license and the artist's description, and ask the artist when in doubt. `all-rights-reserved` tracks need the artist's permission (or a platform licence) for public use. CC "NonCommercial" licences exclude monetised use, and "NoDerivatives" licences may exclude mixes. This is guidance, not legal advice.
