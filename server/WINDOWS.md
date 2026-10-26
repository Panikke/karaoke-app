# Running the server on Windows

How to run the karaoke server on a Windows PC instead of the Raspberry Pi. The
request path stays the same, but pm2 and systemd are replaced by Task Scheduler:

```
Phone / browser
  → Cloudflare (danserv.co.uk)
    → cloudflared (Windows service on this PC)
      → /api/*, /audio/*  →  Node API  http://127.0.0.1:3001   (this folder)
      → everything else   →  the built site in dist/
```

The Android app always calls `https://danserv.co.uk/api/...` and
`https://danserv.co.uk/audio/...`. Playback and uploads both fail if those two
paths can't reach the Node API, even when the website itself still loads.

## Quick diagnosis

Run these on the **server PC**:

| Check | Expected | If not |
|---|---|---|
| Open `http://127.0.0.1:3001/api/health` in a browser | `{"ok":true}` | The API isn't running. Read `server\logs\api.log` (see below) |
| Open `https://danserv.co.uk/api/health` from any device | `{"ok":true}` | The API is running but the tunnel can't reach it. See [Tunnel](#3--cloudflare-tunnel) |
| `https://danserv.co.uk/audio/<some file>` | file downloads | Check that `AUDIO_DIR` points at the folder holding your songs |

A `502` from danserv.co.uk on `/api` or `/audio` while the home page loads
means the tunnel is up but nothing is answering on the API port.

## 1 — Prerequisites

- **Node.js 20+** (installed for all users, so `node` is on the system PATH).
- **ffmpeg** on the system PATH. Without it, WAV/FLAC uploads are stored
  without being converted to MP3, which is large and slow on phones.
  `winget install Gyan.FFmpeg`, then open a new terminal and run `ffmpeg -version`.
- The repo checked out, e.g. `C:\karaoke-app`, with `cd server && npm install`.

## 2 — `.env`

The server reads `.env` from the **repo root** (one level above `server\`), so
`C:\karaoke-app\.env`. Copy it from the Pi. It needs:

```ini
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# REQUIRED on Windows. The Pi default /var/www/karaoke-app/audio becomes
# C:\var\www\karaoke-app\audio, which is probably not where you copied the songs.
AUDIO_DIR=C:\karaoke-app\audio
```

Copy **every file** from the Pi's `/var/www/karaoke-app/audio/` into `AUDIO_DIR`
and keep the file names exactly as they are. The database refers to each song
by its UUID file name, so a missing file plays as silence.

## 3 — Cloudflare tunnel

Install cloudflared as a Windows service with the existing tunnel (copy
`/etc/cloudflared/config.yml` and the `<tunnel-id>.json` credentials from the
Pi). Then edit `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml`
(or wherever the service reads it from) so `/api` and `/audio` go to the API:

```yaml
tunnel: <tunnel-id>
credentials-file: C:\Windows\System32\config\systemprofile\.cloudflared\<tunnel-id>.json
protocol: http2
ingress:
  - hostname: danserv.co.uk
    path: ^/(api|audio)/
    service: http://127.0.0.1:3001
  - hostname: danserv.co.uk
    service: http://127.0.0.1:8080     # whatever serves dist/ (nginx, caddy…)
  - service: http_status:404
```

Use `127.0.0.1` here, **not** `localhost`. The API listens on IPv4 loopback
only, and on Windows `localhost` can resolve to IPv6 `::1`, which gives a 502.

If you run nginx for Windows in front instead, use the blocks in
[nginx-snippet.conf](nginx-snippet.conf), which already proxy to `127.0.0.1:3001`.
Keep `client_max_body_size 500M`, otherwise large uploads fail with 413.

After editing, restart the service: `Restart-Service cloudflared` (admin PowerShell).

## 4 — Task Scheduler

The Pi used pm2 to restart the API after a crash and to keep logs. Task
Scheduler does neither, so point the task at
[start-windows.cmd](start-windows.cmd). It restarts the API whenever it exits
and writes everything to `server\logs\api.log`.

Create the task (Task Scheduler → Create Task, not "Basic Task"):

- **General:** "Run whether user is logged on or not"; tick "Run with highest
  privileges". Use the **normal user account on the server PC** (the one Node,
  ffmpeg and the songs were set up under), not SYSTEM, so `node`/`ffmpeg` on its
  PATH and the songs folder are visible. Windows asks for that account's password.
- **Triggers:** At startup.
- **Actions:** Program/script `C:\karaoke-app\server\start-windows.cmd`;
  **Start in** `C:\karaoke-app\server`.
- **Settings:** untick "Stop the task if it runs longer than 3 days". Otherwise
  Windows kills the API after 72 hours, and playback stops days later for no
  obvious reason.

If `AUDIO_DIR` is on a **mapped network drive** (`Z:\…`), use the UNC path
(`\\nas\share\audio`) instead. Mapped drives don't exist for a task that runs
while you're logged off.

Check it: right-click the task → Run, then open `server\logs\api.log`. You
should see `Karaoke API listening on http://127.0.0.1:3001` and the audio dir.

## 5 — Firewall / sleep

- cloudflared only makes outbound connections, so no inbound firewall rule is
  needed. If the tunnel won't connect, allow outbound TCP 7844 or keep
  `protocol: http2`, which uses 443.
- Set the PC's power plan to **never sleep**. A sleeping PC gives a Cloudflare
  1033/502 for everything.

## Reading `api.log`

| Line | Meaning |
|---|---|
| `Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY` | `.env` not found or incomplete. It must be in the repo root |
| `node.exe not found on PATH` | Install Node for all users, or run the task as your own account |
| `Could not listen on 127.0.0.1:3001: ... EADDRINUSE` | Another copy is already running. End the extra `node.exe` or the duplicate task |
| `[AUTH] Invalid token` on uploads | Supabase keys in `.env` don't match the project the app uses |
| `Transcode failed` | ffmpeg isn't on PATH for the task's user |
| `API exited with code ... restarting` | Crashed. The lines just before it say why |
