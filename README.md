# Shiori (栞)

**Shiori** means *bookmark* in Japanese — a quiet name for keeping your place in the shows you watch.

Chrome extension that tracks watching time on **Netflix**, **Disney+**, **Crunchyroll**, **Prime Video**, **HIDIVE**, and **Hulu**. Stats stay local in your browser (daily / weekly / monthly), with a popup for “now watching” and a full dashboard.

Built for personal unpacked use first, with Web Store–friendly constraints (narrow hosts, no remote scripts). Multi-device sync is planned later via the same exportable schema.

## Features

- Tracks titles on Netflix, Disney+, Crunchyroll, Prime Video, HIDIVE, and Hulu
- Idle-aware timing (pauses when you’re away)
- Episode / subtitle labels when the page exposes them
- Video progress when an HTML5 player is readable
- Popup + dashboard (charts, export, clear)
- Local timezone day buckets

## Setup (unpacked)

1. Clone the repo:

```bash
git clone https://github.com/SatyanThayaparan/anime-tracker.git
cd anime-tracker
```

2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode**
4. **Load unpacked** → select this folder
5. Pin the extension, open a supported streaming site, and check the popup

If you already had an older build loaded, click **Reload** on the extension card after pulling updates.

## Usage

- Watch normally on a supported site
- Popup shows the active title, today’s total, and a small debug strip (site / active / last heartbeat)
- **View Full Dashboard** for ranges, charts, export, and clear

## Permissions

| Permission | Why |
| --- | --- |
| Host access to Netflix / Disney+ / Crunchyroll / Prime Video / HIDIVE / Hulu | Read title metadata and detect watching on those pages only |
| `storage` | Save history locally |
| `tabs` | Know which tab is active |
| `idle` | Pause counting when you’re away |
| `alarms` | Reliable periodic saves under Manifest V3 |

## Structure

```text
├── background.js      # Service worker: sessions, alarms, storage writes
├── content.js         # Page sensing + heartbeats (loads utils via runtime URL)
├── utils/shows.js     # Streaming site parsers (Netflix, Disney+, Crunchyroll, Prime Video, HIDIVE, Hulu)
├── utils/storage.js   # Aggregations, export/clear, local date keys
├── popup/             # Now watching UI
├── dashboard/         # Stats UI
└── vendor/            # Vendored Chart.js (no CDN)
```

## Data across updates

Chrome keeps `chrome.storage.local` when you **update or reload** the extension. History is only wiped if you uninstall the extension or use **Clear All Data**.

On version/schema bumps, a migration runs automatically to repair messy show keys (for example merging `Haikyu!!E6Tempo` into `Haikyu!!` and dropping a bare `Netflix` “show”).

## Version bumping

`package.json` and `manifest.json` versions stay in sync via:

```bash
npm run version:patch   # 1.2.0 → 1.2.1
npm run version:minor   # 1.2.0 → 1.3.0
npm run version:major   # 1.2.0 → 2.0.0
# or exact:
node scripts/bump-version.mjs 1.4.0
```

Then reload the unpacked extension (or zip/publish for Store).

## Notes

- Deeper design notes: [`DOCUMENTATION.md`](./DOCUMENTATION.md)
- Data never leaves your machine unless you export it
- Netflix / Disney+ players are often DRM-heavy — time still tracks; scrubber progress is best-effort
