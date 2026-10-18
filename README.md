# TubeVault — YouTube Bookmark Manager

Save YouTube videos and Shorts, sort them into categories, and find them again.
All data stays in `chrome.storage.local` on your computer. No server, no accounts, no external requests
(apart from YouTube's own thumbnail images).

## Install (Chrome, Edge, Brave)
1. Unzip this folder somewhere permanent (for example `C:\Users\<you>\TubeVault`).
2. Open `chrome://extensions`, turn on **Developer mode** (top-right).
3. Click **Load unpacked** and choose the folder that contains `manifest.json`.
4. Pin TubeVault from the puzzle-piece menu. Reload any YouTube tabs that were already open.

## Files
- `manifest.json`: Manifest V3, permissions `storage` and `activeTab` only
- `background.js`: service worker (saves videos for the page button, seeds categories)
- `content.js`: the Save button on YouTube watch pages and Shorts
- `popup.html / .css / .js`: toolbar popup
- `dashboard.html / .css / .js`: full-page manager (toolbar popup → Open dashboard)
- `lib/store.js`: all storage logic, `lib/youtube.js`: URL parsing, `lib/ui.js`: DOM helpers, `lib/base.css`: shared styles
