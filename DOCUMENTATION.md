# Shiori (栞) — Documentation

## What this project is

**Shiori** (*bookmark*) is a Chrome extension that tracks watching time on **Netflix**, **Disney+**, **Crunchyroll**, and **Prime Video**. It records titles (and episode labels when available), accumulates watch time with idle awareness, and shows daily/weekly/monthly stats in a popup and dashboard. All data stays local.

> GitHub: [`anime-tracker`](https://github.com/SatyanThayaparan/anime-tracker)

## Tech stack

| Layer | Choice | Why it’s used |
| --- | --- | --- |
| Platform | Chrome Extension Manifest V3 | Service worker + content scripts |
| Logic | Vanilla JS modules | Simple unpacked load; store-friendly |
| Storage | `chrome.storage.local` | On-device history with schema version |
| Timing | Events + `chrome.alarms` | Reliable saves when the service worker sleeps |
| Charts | Vendored Chart.js | No CDN (extension CSP safe) |

## How the logic works

1. **Content script** loads `utils/shows.js` via `chrome.runtime.getURL`, reads title/episode cues, and sends heartbeats.
2. **Background worker** only tracks supported streaming tabs, pauses on idle/blur, and writes time into local day keys.
3. **Platform parsers** extract titles and season/episode text from Netflix, Disney+, Crunchyroll, and Prime Video.
4. **Popup** shows now watching + today’s totals + a debug strip (site / active / last heartbeat).
5. **Dashboard** aggregates ranges, charts, export, and clear.

## Project map

| Path | Role |
| --- | --- |
| `manifest.json` | Narrow host permissions, content scripts, web-accessible utils, CSP |
| `background.js` | Session state, alarms, storage writes |
| `content.js` | Heartbeats + player probing on supported pages |
| `utils/shows.js` | Netflix / Disney+ / Crunchyroll / Prime Video extraction |
| `utils/storage.js` | Local date keys, aggregation, export/clear |
| `popup/` | Now watching UI |
| `dashboard/` | Overview / shows / settings |
| `vendor/chart.umd.min.js` | Local charts |

## Mental model

A **fitness watch for streaming**: the content script senses the page, the background stopwatch respects idle, and storage keeps the workout log for the dashboard. Export JSON is the bridge toward future multi-device sync.
