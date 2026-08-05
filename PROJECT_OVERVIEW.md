# Karaoke App — Project Overview & Runbook

> One-stop reference for how this project is built, deployed, and operated, plus
> every production issue we've hit and how it was fixed. Read this instead of
> digging through old chat history.
>
> Domain: **https://danserv.co.uk** · Host: **Raspberry Pi (DietPi), `root@dietpi`**

---

## 1. What this is

A **karaoke web app with lyrics/audio upload**. Originally generated from Figma
Make, now self-hosted on a Raspberry Pi.

- **Frontend:** Vite + React single-page app (TypeScript). UI built on
  shadcn/Radix + MUI components. Built output goes to `dist/`.
- **Data/Auth:** **Supabase** (Postgres + Auth). The browser reads/writes song
  metadata directly via the Supabase JS client (protected by RLS). Tables:
  `songs` (track metadata, filenames, `in_playlist`, synced lyrics) and
  `profiles` (`role` = admin/dj, `can_edit_playlist`).
- **File/upload API:** a small **Express server** (`server/index.js`) running on
  the Pi. Handles audio/image uploads, WAV/FLAC→MP3 transcoding (ffmpeg),
  filesystem "library scan" imports (music-metadata), and optional rclone cloud
  sync. It uses the Supabase **service-role** key (server-only secret) and
  verifies the user's Supabase token on every request.
- **Audio/cover/lyrics-image files:** stored on the Pi filesystem at
  `/var/www/karaoke-app/audio/`, served to browsers at `/audio/`.

---

## 2. Architecture / request flow

```
Browser
  → Cloudflare edge (danserv.co.uk, proxied/orange-cloud)
    → Cloudflare Tunnel  (cloudflared daemon ON the Pi, outbound-only)
      → nginx (on the Pi, localhost)
          ├─ /              → static SPA from /var/www/karaoke-app/dist  (try_files … /index.html)
          ├─ /api/          → proxy_pass http://127.0.0.1:3001   (Express)
          └─ /audio/        → alias /var/www/karaoke-app/audio/   (static files)
                                   │
        Express (:3001, 127.0.0.1) ┘
          ├─ verifies Supabase JWT, checks editor role
          ├─ writes audio/images to /var/www/karaoke-app/audio/
          └─ inserts/updates rows in Supabase
```

**Key consequence of this topology:** because the site is fronted by a
**Cloudflare Tunnel**, nginx only ever sees connections from localhost. The
nginx server blocks are intentionally locked down with `allow 127.0.0.1; deny
all;` — that is correct *only* because cloudflared connects from localhost. Do
not "fix" that by removing the deny rule.

- The frontend calls the API/audio with **relative paths** (`/api/...`,
  `/audio/...`). This works because nginx serves the app and proxies those paths
  from the same origin. (This matters for the Android port — see §8.)

---

## 3. Where things live

### On the Pi
| Thing | Path |
|---|---|
| Project root (git checkout) | `/var/www/karaoke-app` |
| Built frontend (served by nginx) | `/var/www/karaoke-app/dist` |
| Audio/image files | `/var/www/karaoke-app/audio/` (`incoming/`, `failed/` subdirs) |
| Server env (Supabase keys, etc.) | `/var/www/karaoke-app/.env` |
| nginx site config | `/etc/nginx/sites-enabled/` (danserv.co.uk + others: flt, jellyfin, vault) |
| Cloudflare tunnel config | `/etc/cloudflared/config.yml` |
| Tunnel credentials | `/root/.cloudflared/<tunnel-id>.json` (id `bea57e4c-…0726b`) |
| Network config | `/etc/network/interfaces` (ifupdown), WiFi creds in `/etc/wpa_supplicant/wpa_supplicant.conf` |

### Process management
- The API runs under **pm2** as `karaoke-api`. `pm2 status`, `pm2 logs karaoke-api`.
- `cloudflared`, `nginx` run as **systemd** services.
- Networking is **ifupdown** (`networking.service`); **not** NetworkManager/dhcpcd.

### Repo layout (highlights)
- `src/` — React app. API/audio calls are centralized in `src/lib/songsApi.ts`.
  Supabase client in `src/lib/supabase.ts` (reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`).
  `src/lib/config.ts` — `API_BASE` switch (web vs APK, §8).
  `src/lib/offline.ts` — offline downloads; no-ops outside the native app.
- `server/index.js` — the Express API. `server/DEPLOY.md` — deploy steps +
  502 troubleshooting. `server/nginx-snippet.conf` — reference nginx blocks.
- `android/` — generated Capacitor project. `capacitor.config.json` — app id/name.
- `.env.example` — required env vars. `.env.capacitor` — APK build overrides
  (committed; contains only the public server URL, no secrets).

### Documentation map
| Doc | For |
|---|---|
| `PROJECT_OVERVIEW.md` (this file) | Architecture, ops, deploys, incident history |
| `ANDROID.md` | Building the APK; Capacitor + offline architecture |
| `INSTALL-ANDROID.md` | Non-technical guide to installing/using the app on a tablet |
| `server/DEPLOY.md` | Pi server setup + 502 troubleshooting |
| `server/LIBRARY-SCAN-SETUP.md` | Filesystem "library scan" import setup |

---

## 4. Deploy / update procedure (on the Pi)

> **Current branch on the Pi: `claude/android-app`**, not `main` — that's where
> the Android work, the CORS fix the APK needs, and the newest frontend fixes
> live. `dist/` is committed on that branch, so a plain `git pull` updates the
> website with **no build step**. Once the branch is merged to `main`, switch the
> Pi back and restore `main` in the commands below.

Frontend change (anything under `src/`) — `dist/` comes with the pull:
```bash
cd /var/www/karaoke-app
git pull origin claude/android-app
```
nginx serves the new files immediately; nothing to restart.

Server change (e.g. `server/index.js`):
```bash
cd /var/www/karaoke-app
git pull origin claude/android-app
cd server && npm install    # only if deps changed
pm2 restart karaoke-api
```

Verify health:
```bash
pm2 status                                  # karaoke-api → online
curl -s http://127.0.0.1:3001/api/health    # → {"ok":true}
```

**If `git pull` refuses** with *"local changes would be overwritten"* on `dist/`
or `server/package-lock.json`: those are build artifacts regenerated by running
`pnpm build` / `npm install` on the Pi, and are safe to discard —
```bash
git checkout -- dist/ server/package-lock.json
git pull origin claude/android-app
```

---

## 5. Production issues fixed (root causes + fixes)

### 5.1 Intermittent 502 — API process crashing
- **Symptom:** Cloudflare 502s, often after uploads.
- **Root cause:** Express 4 doesn't catch rejected promises thrown by `async`
  middleware/route handlers. A transient Supabase/DNS error (`EAI_AGAIN`) became
  an **unhandled rejection**, which **crashes Node ≥15** → API down → nginx 502.
- **Fix (merged, PR #13):** added an `asyncHandler()` wrapper around every async
  handler + `requireAuth`/`requireEditor`, forwarding errors to the global error
  handler; plus `process.on('unhandledRejection'|'uncaughtException')` guards
  that log `[FATAL]`. If the API ever dies now, `pm2 logs karaoke-api` shows a
  `[FATAL]` reason instead of a silent death.

### 5.2 Constant 502 — nginx wouldn't start (config typo)
- **Symptom:** Cloudflare diagnostic showed "Host: Error", full-site 502.
- **Root cause:** `/etc/nginx/sites-enabled/flt.danserv.co.uk` line 1 said
  `Server {` (capital **S**) — invalid directive. **One broken file makes the
  entire nginx config invalid, so nginx refuses to start and ALL sites go down.**
- **Fix:** `Server` → `server`, then `nginx -t` (must pass) → `systemctl restart nginx`.
- **Lesson:** always `nginx -t` **before** reloading/restarting nginx.

### 5.3 Cloudflare error 1033 after physically moving the Pi
"1033" = Cloudflare has no connected tunnel for the hostname (the tunnel itself
is down). It was a stack of three separate causes uncovered in order:

1. **Clock not synced.** A wrong clock breaks the TLS handshake to Cloudflare's
   edge → tunnel can't connect. Pis have no battery clock, so a power-off during
   a move drifts it. Fix: `timedatectl set-ntp true` (then `synchronized: yes`).
2. **QUIC/UDP transport unreliable on the new network.** Forced the tunnel onto
   HTTP/2 by adding **`protocol: http2`** to `/etc/cloudflared/config.yml`, then
   `systemctl restart cloudflared`. Healthy logs show `Registered tunnel
   connection` ×4.
3. **No internet at all — wrong default route.** `ip route` showed
   `default via 192.168.10.254 dev eth0 linkdown` — the default route went out
   the **unplugged ethernet port**, while WiFi (`wlan0`) was connected on the
   same subnet but unused. Both 443 and 7844 failed with "no route to host".
   Fix → see §6 (made WiFi-only persistent).

> **Note on tunnel ports:** cloudflared reaches Cloudflare's edge on **port
> 7844** (UDP for QUIC, TCP for the `http2` protocol) — *not* 443. If a network
> blocks 7844 outbound, the tunnel can't connect. The real fix is to allow
> outbound 7844, or use a network that does.

---

## 6. Networking — WiFi-only, persistent (current state)

The Pi is **WiFi-only** at its current location. `ifupdown` had both `eth0` and
`wlan0` as `allow-hotplug`+DHCP, and the dead `eth0` kept stealing the default
route. We disabled `eth0` so WiFi is the only path.

`/etc/network/interfaces` (eth0 commented out):
```
source interfaces.d/*

# Ethernet — DISABLED for WiFi-only setup.
# To go back to wired: uncomment the two lines below and reboot.
#allow-hotplug eth0
#iface eth0 inet dhcp

# WiFi
allow-hotplug wlan0
iface wlan0 inet dhcp
pre-up iw dev wlan0 set power_save off
post-down iw dev wlan0 set power_save on
wpa-conf /etc/wpa_supplicant/wpa_supplicant.conf
```
- WiFi gets its IP + default route from DHCP, so this keeps working even on a
  different WiFi network (3 SSIDs are saved in `wpa_supplicant.conf`).
- **To go wired again:** uncomment the two `eth0` lines and reboot.
- A timestamped backup exists: `/etc/network/interfaces.bak.*`.
- Backstops for remote access if the route ever breaks: **Tailscale**
  (`100.107.242.66`) and the LAN IP.

---

## 7. Troubleshooting decision tree

**See a 502?** Origin reached but upstream failed. Inside-out:
```bash
curl -s http://127.0.0.1:3001/api/health   # API up? ({"ok":true})
pm2 status                                  # crash loop? (restarts climbing)
systemctl is-active nginx && nginx -t       # nginx up + config valid?
tail -n 30 /var/log/nginx/error.log         # exact upstream failure
```
- API down → `pm2 logs karaoke-api` (look for `[FATAL]`), `pm2 restart karaoke-api`.
- `nginx -t` fails → fix the reported file/line, then `systemctl restart nginx`.

**See a 1033 (or whole site unreachable)?** The tunnel is down.
```bash
ip route | grep default                     # default via wlan0? not eth0/linkdown?
curl -sI --max-time 8 https://www.cloudflare.com | head -1   # internet? (HTTP/2 200)
timedatectl | grep -E "Universal|synchronized"               # clock synced?
grep -i protocol /etc/cloudflared/config.yml                 # protocol: http2 present?
systemctl status cloudflared
journalctl -u cloudflared -n 25 --no-pager  # want: "Registered tunnel connection"
```
Common fixes: restore internet/route (§6), `timedatectl set-ntp true`, ensure
`protocol: http2`, then `systemctl restart cloudflared`.

---

## 8. Android app (done)

The React app is wrapped with **Capacitor** and sideloaded as an APK — no Play
Store, no second codebase. Primarily used on an **Honor Pad 9**.

- **Branch:** `claude/android-app`
- **App ID:** `uk.co.danserv.karaoke`
- **Build + architecture:** [ANDROID.md](ANDROID.md)
- **Installing on a tablet (non-technical):** [INSTALL-ANDROID.md](INSTALL-ANDROID.md)

**The one structural change it required.** The web app calls the backend with
relative paths (see §2), which cannot work inside the APK — the webview origin is
`https://localhost`, so `/api/...` would hit the tablet, not the Pi. So:

- `src/lib/config.ts` exports `API_BASE` from `VITE_API_BASE`, and
  `src/lib/songsApi.ts` prefixes every `/api` and `/audio` URL with it.
- Web build → `VITE_API_BASE` empty → URLs stay relative → **nothing changes for
  the website**. APK build (`pnpm build:apk`) → `.env.capacitor` sets
  `https://danserv.co.uk` → URLs become absolute.
- The APK is therefore a **cross-origin** client, so `server/index.js` allows
  `https://localhost` and `capacitor://localhost` in its CORS list. **This must
  be deployed to the Pi** or uploads/edits/scans fail from the tablet (playback
  and Supabase reads work regardless).

**Offline downloads.** Songs can be downloaded to the tablet's private app
storage (`@capacitor/filesystem`) and play with no internet; if the server is
unreachable at launch the app loads a saved metadata snapshot and enters offline
mode. Private app storage is used rather than a browser cache because Android
evicts large browser caches under storage pressure — which would silently break
the exact scenario the feature exists for. Details in ANDROID.md.

**Note for web deploys:** `dist/` is committed on this branch so the Pi can serve
the built app without running a build. Pulling the branch on the Pi therefore
also updates the website.

---

## 9. Open / future work

### Cloudflare hardening (dashboard toggles, optional, low priority)
From a Security Insights scan — all "Moderate":
1. **Always Use HTTPS** — SSL/TLS → Edge Certificates (do first, no risk).
2. **SSL/TLS mode → Full (strict)** — SSL/TLS → Overview (mostly moot under a
   tunnel, but correct hygiene).
3. **HSTS** — SSL/TLS → Edge Certificates (enable *after* HTTPS is confirmed;
   start with a 6-month max-age, no subdomains/preload).
4. **Bot Fight Mode** — Security → Bots (optional).

---

## 10. Quick command cheat-sheet

```bash
# API
pm2 status; pm2 logs karaoke-api --lines 50; pm2 restart karaoke-api
curl -s http://127.0.0.1:3001/api/health

# nginx
nginx -t && systemctl reload nginx
tail -n 50 /var/log/nginx/error.log

# Cloudflare tunnel
systemctl status cloudflared
journalctl -u cloudflared -n 30 --no-pager
systemctl restart cloudflared

# network / clock
ip route | grep default
timedatectl
curl -sI https://www.cloudflare.com | head -1

# deploy (see §4 — Pi currently tracks claude/android-app)
cd /var/www/karaoke-app && git pull origin claude/android-app && pm2 restart karaoke-api
```

On the dev machine (Windows), rebuild the APK — see [ANDROID.md](ANDROID.md):

```powershell
pnpm android:sync
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
cd android; .\gradlew.bat assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```
