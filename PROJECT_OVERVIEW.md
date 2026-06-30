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
- `server/index.js` — the Express API. `server/DEPLOY.md` — deploy steps +
  502 troubleshooting. `server/nginx-snippet.conf` — reference nginx blocks.
- `.env.example` — required env vars.

---

## 4. Deploy / update procedure (on the Pi)

Server-only change (e.g. `server/index.js`):
```bash
cd /var/www/karaoke-app
git checkout main && git pull origin main
pm2 restart karaoke-api
```

Frontend change (anything under `src/`):
```bash
cd /var/www/karaoke-app
git checkout main && git pull origin main
pnpm install        # only if deps changed
pnpm build          # rebuilds dist/
```

Verify health:
```bash
pm2 status                                  # karaoke-api → online
curl -s http://127.0.0.1:3001/api/health    # → {"ok":true}
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

## 8. Open / future work

### Android app (in progress)
- **Decision:** wrap the existing React app with **Capacitor** and **sideload**
  an APK (no Play Store initially). Reuses ~100% of current code.
- **Branch:** `claude/android-app` (created; **no commits yet**).
- **Remaining steps:**
  1. Add a configurable API base: new `src/lib/config.ts` exposing `API_BASE`
     from `VITE_API_BASE` (default `''` = relative for the web build). Replace
     the relative `/api` and `/audio` paths in `src/lib/songsApi.ts` with it.
     For the Android build, set `VITE_API_BASE=https://danserv.co.uk`.
  2. Add the Capacitor app origin (`https://localhost` / `capacitor://localhost`)
     to the Express **CORS allowlist** in `server/index.js` (currently allows
     `danserv.co.uk` + `localhost:5173/4173`).
  3. Add Capacitor deps + `capacitor.config.ts`; run `npx cap add android` to
     generate `android/`.
  4. **Build the APK on a machine with the Android SDK / Android Studio**
     (`./gradlew assembleDebug`) — the cloud dev environment has **no Android
     SDK**, so the final compile must happen locally.

### Cloudflare hardening (dashboard toggles, optional, low priority)
From a Security Insights scan — all "Moderate":
1. **Always Use HTTPS** — SSL/TLS → Edge Certificates (do first, no risk).
2. **SSL/TLS mode → Full (strict)** — SSL/TLS → Overview (mostly moot under a
   tunnel, but correct hygiene).
3. **HSTS** — SSL/TLS → Edge Certificates (enable *after* HTTPS is confirmed;
   start with a 6-month max-age, no subdomains/preload).
4. **Bot Fight Mode** — Security → Bots (optional).

---

## 9. Quick command cheat-sheet

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

# deploy
cd /var/www/karaoke-app && git pull origin main && pm2 restart karaoke-api
```
