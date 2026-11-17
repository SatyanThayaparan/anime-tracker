# Anime Tracker

Chrome extension that tracks anime viewing habits — shows watched, episodes, and watch time — with daily, weekly, and monthly stats.

## Features

- Detects viewing on supported anime streaming sites
- Tracks episodes and watch time with idle-aware sessions
- Popup for what’s currently playing
- Dashboard for day / week / month summaries and export
- All data stays local in Chrome storage (no backend)

## Tech stack

- Chrome Extension Manifest V3
- Vanilla JavaScript modules
- `chrome.tabs`, `chrome.storage`, `chrome.idle`

## Setup

1. Clone the repo and enter the project folder:

```bash
git clone https://github.com/SatyanThayaparan/anime-tracker.git
cd anime-tracker
```

2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this project folder.
5. Pin the extension, open an anime streaming site, and use the popup or dashboard to see stats.

## Usage

- Browse supported anime sites as usual — the content script records active watching.
- Open the extension popup for a quick “now watching” view.
- Open the dashboard for longer-range stats and export options.

## Structure

```text
├── background.js   # Service worker: tab/idle timing and session save
├── content.js      # Page sensing and heartbeats on anime sites
├── utils/          # Site adapters, storage helpers, categories
├── popup/          # Compact “currently watching” UI
├── dashboard/      # Aggregated stats UI
└── icons/          # Extension icons
```

## Notes

- Deeper design notes live in [`DOCUMENTATION.md`](./DOCUMENTATION.md).
- Viewing data never leaves your browser unless you export it yourself.
