# Karaoke app

A self-hosted karaoke app: upload songs with cover art and lyrics, build a
playlist, and sing along with synced lyrics. Runs as a website at
**https://danserv.co.uk** and as a sideloaded **Android app** that also works
offline.

Originally generated from
[Figma Make](https://www.figma.com/design/fUdqNIm7F3ppsi5zDqHuLl/Karaoke-app-with-lyrics-upload).

## Which document do I need?

| I want to… | Read |
|---|---|
| Put the app on a tablet and use it | **[INSTALL-ANDROID.md](INSTALL-ANDROID.md)** — no technical knowledge needed |
| Understand how it's built, hosted, and deployed | **[PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)** — the main runbook |
| Build the Android APK | **[ANDROID.md](ANDROID.md)** |
| Set up or fix the server on the Pi | **[server/DEPLOY.md](server/DEPLOY.md)** |
| Bulk-import songs from a folder | **[server/LIBRARY-SCAN-SETUP.md](server/LIBRARY-SCAN-SETUP.md)** |

## How it fits together

- **Frontend** — Vite + React (TypeScript), built to static files in `dist/`.
- **Data & auth** — Supabase (Postgres + Auth); the browser reads and writes song
  metadata directly, protected by row-level security.
- **Upload API** — a small Express server (`server/index.js`) on a Raspberry Pi
  handling uploads, WAV/FLAC→MP3 transcoding, and library imports.
- **Media files** — stored on the Pi, served at `/audio/`.
- **Android** — the same React app wrapped in Capacitor (`android/`), with
  offline song downloads.

Full architecture and request flow: [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md).

## Running locally

```sh
pnpm install
cp .env.example .env     # then fill in your Supabase keys
pnpm dev                 # http://localhost:5173
```

To exercise uploads and library scans you also need the API running:

```sh
cd server && npm install && npm run dev    # http://localhost:3001
```

The dev server proxies `/api` and `/audio` to it, mirroring what nginx does in
production.

### Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server |
| `pnpm build` | Production web build → `dist/` |
| `pnpm build:apk` | Web build for the APK (absolute API URLs) |
| `pnpm android:sync` | `build:apk` + copy into the Android project |
| `pnpm android:open` | `android:sync` + open Android Studio |
