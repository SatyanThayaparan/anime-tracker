# Website Tracker (Anime Tracker) — Documentation

## What this project is

A Chrome extension (Manifest V3) branded **Anime Tracker**. It detects anime watching on supported streaming sites, records episodes and watch time, and shows daily/weekly/monthly stats in a popup and dashboard.

> GitHub repo: [`anime-tracker`](https://github.com/SatyanThayaparan/anime-tracker). Local folder may still be named `website-tracker`.

## Tech stack

| Layer | Choice | Why it’s used |
| --- | --- | --- |
| Platform | Chrome Extension Manifest V3 | Runs in the browser with service worker + content scripts |
| Logic | Vanilla JavaScript modules | Lightweight, no build toolchain required |
| Storage | `chrome.storage.local` | Keep watch history on the user’s machine |
| APIs used | Chrome `tabs`, `storage`, `idle` | Know what’s active, save data, pause when idle |
| UI | Popup + dashboard HTML/CSS/JS | Quick “now watching” view and deeper stats |

## How the logic works

1. **Background watcher** — `background.js` (service worker) tracks the active tab and idle state so time isn’t counted while you’re away.
2. **Page sensing** — On supported anime sites, `content.js` reads show/episode/video cues from the page and sends heartbeats while you’re actively watching.
3. **Site adapters** — `utils/shows.js` knows how to recognize supported hosts and extract useful viewing details from their DOM.
4. **Session save** — The background script accumulates sessions and stores them by date in `chrome.storage.local`.
5. **Popup** — Shows what you’re currently watching in a compact view.
6. **Dashboard** — Aggregates ranges (day/week/month), charts/summaries, and export options.
7. **Extra categorization** — `utils/categories.js` can classify hostnames into broader buckets (social, entertainment, etc.) for general site context.

## Project map

### Root — extension engine
| Path | Role |
| --- | --- |
| `manifest.json` | Declares permissions, service worker, content scripts, popup, and icons |
| `background.js` | Service worker: watches tabs/idle, owns session timing, writes completed sessions |
| `content.js` | Injected on anime sites: detects activity, extracts show/episode cues, sends heartbeats |
| `DOCUMENTATION.md` | This overview |

### `utils/` — shared helpers
| Path | Role |
| --- | --- |
| `utils/shows.js` | Knows supported sites and how to read show/episode/video details from the page |
| `utils/storage.js` | Read/write/aggregate watch history in `chrome.storage.local` |
| `utils/categories.js` | Maps hostnames into broader categories (social, entertainment, etc.) |

### `popup/` — quick glance UI
| Path | Role |
| --- | --- |
| `popup.html` / `popup.css` / `popup.js` | Small popup showing what’s currently being tracked |

### `dashboard/` — deeper stats UI
| Path | Role |
| --- | --- |
| `dashboard.html` / `dashboard.css` / `dashboard.js` | Full-page stats for day/week/month views, charts/summaries, export |

### `icons/` — extension artwork
Icon assets plus small generators/notes for creating the 16/48/128 sizes Chrome expects.

### Data flow in one line
**Page (`content.js` + `utils/shows.js`) → background timer (`background.js`) → storage (`utils/storage.js`) → popup/dashboard.**

## Mental model

This is a **fitness watch for anime episodes**: the content script notices you’re watching, the background script times the session, and storage keeps the history for the dashboard. Everything stays local in Chrome—no remote server required.
