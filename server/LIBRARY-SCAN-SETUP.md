# Library Scan + Cloud Sync — Setup Guide

Real music servers (Plex, Navidrome, Subsonic, Jellyfin) don't accept
browser uploads — they scan a folder. This app does the same. For
**remote uploads** (when you're not on the Pi's LAN), the recommended
path is **cloud relay via rclone**: drop files into OneDrive (or any
cloud), the Pi pulls them in, then you click Scan to index them.

## The full flow

```
  Your laptop / phone  ──upload──▶  OneDrive (cloud)
                                        │
                                        │  rclone copy
                                        ▼
                              Pi: audio/incoming/
                                        │
                                        │  "Scan Library" button in app
                                        ▼
                                Pi: audio/<uuid>.mp3  +  Supabase row
```

You upload from anywhere. The Pi does the heavy lifting. Cloudflare
Tunnel is never in the upload path.

---

## One-time Pi setup

### 1. Install rclone

```bash
curl https://rclone.org/install.sh | bash
rclone version    # confirm install
```

### 2. Configure your cloud remote (OneDrive example)

```bash
rclone config
```

Then:
- `n` → new remote
- name: `onedrive`
- storage: `onedrive` (number from the list)
- Accept defaults until it asks for an auth URL
- On the Pi, when prompted, choose **headless auth**: `n` for "Use auto config?"
- It gives you a `rclone authorize "onedrive"` command — run that **on your laptop** (where you have a browser)
- Copy the JSON token from your laptop's terminal back to the Pi when prompted
- Pick your account type (Personal / Business), accept the default drive

Verify:
```bash
rclone lsd onedrive:    # should list your OneDrive folders
```

### 3. Create the OneDrive folder

In OneDrive (any device — web, app, File Explorer), create a folder:

```
Karaoke Incoming
```

(or any name — match it in the .env below).

### 4. Add to Pi's `.env`

```bash
# /var/www/karaoke-app/.env
RCLONE_REMOTE=onedrive:Karaoke Incoming
```

The format is `<remote-name>:<folder-path>`.

### 5. Install the new server dependency and deploy

```bash
cd /var/www/karaoke-app
git pull
cd server && npm install     # picks up music-metadata
cd ..
pnpm build
pm2 restart karaoke-api
```

### 6. Verify

In the karaoke app, click **Scan Library** in the header. You should see:
- A purple **Sync from Cloud (onedrive:Karaoke Incoming)** button at the top
- The instructions panel mentioning your OneDrive folder by name

If the button is missing, the server didn't see `RCLONE_REMOTE` —
double-check the `.env` file and that you restarted PM2 *after* editing it.

---

## Day-to-day use

1. From any device, drop audio files into the OneDrive **Karaoke Incoming** folder
   (Windows File Explorer, OneDrive mobile app, onedrive.live.com, etc.)
2. In the karaoke app on any device, open **Scan Library**
3. Click **Sync from Cloud** — Pi pulls new files in, takes ~5-10 seconds per song
4. The file list refreshes automatically. Pick a language, tick the songs you want, click **Scan & Import**
5. Server reads ID3 tags, moves files into the library with UUID filenames, saves embedded cover art, inserts Supabase rows
6. Failed files (corrupt, unreadable tags, DB error) end up in `audio/failed/`

### Important: rclone `copy` vs `sync`

The server uses `rclone copy` (not `sync`), so files in OneDrive are **not**
deleted after import. This is intentional — OneDrive becomes your backup
of source files. If you want to clear OneDrive, do it manually after a
successful scan.

The downside: re-running Sync from Cloud will *also* pull songs that are
already in your library (since they're still in OneDrive). The Pi-side
files are skipped (`rclone copy` is idempotent), but the Scan step will
try to import them again as duplicates. To avoid that, either:
- Move imported files into a different OneDrive folder once they're indexed, OR
- Delete them from OneDrive after a successful scan

---

## Other cloud providers

rclone supports almost everything. Same flow, different `rclone config`:

| Provider     | rclone "storage" choice | `.env` example                      |
|--------------|------------------------|-------------------------------------|
| OneDrive     | `onedrive`             | `RCLONE_REMOTE=onedrive:Karaoke`    |
| Google Drive | `drive`                | `RCLONE_REMOTE=gdrive:Karaoke`      |
| Dropbox      | `dropbox`              | `RCLONE_REMOTE=dropbox:Karaoke`     |
| pCloud       | `pcloud`               | `RCLONE_REMOTE=pcloud:Karaoke`      |
| S3 / R2      | `s3`                   | `RCLONE_REMOTE=r2:karaoke-bucket`   |

---

## Alternative: SFTP via Cloudflare Tunnel (no cloud relay)

If you don't want a cloud middleman, you can expose the Pi's SSH over
Cloudflare Tunnel and use WinSCP/FileZilla. It's a bit more setup but
no third-party storage involved. See
[Cloudflare's docs for "Connect with SSH"](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/use-cases/ssh/).

---

## Alternative: LAN-only (Samba)

If you ever **are** on the same LAN as the Pi, this is the fastest path:

```bash
apt install -y samba
cat >> /etc/samba/smb.conf <<'EOF'

[karaoke-incoming]
   path = /var/www/karaoke-app/audio/incoming
   browseable = yes
   read only = no
   guest ok = yes
   create mask = 0664
   directory mask = 0775
   force user = www-data
EOF
mkdir -p /var/www/karaoke-app/audio/incoming
chown -R www-data:www-data /var/www/karaoke-app/audio
systemctl restart smbd
```

Then `\\dietpi\karaoke-incoming` in Windows File Explorer.

---

## Filename conventions (used as a fallback when ID3 tags are missing)

- `001 - Title - Artist.mp3`  →  track #001, title, artist
- `42_Title - Artist.mp3`     →  track #42, title, artist
- `Title - Artist.mp3`        →  title, artist (no track number)
- `My Song.mp3`               →  title only; artist falls back to "Unknown Artist"

Proper ID3/Vorbis/MP4 tags win over filename parsing.

---

## Watching it work

```bash
pm2 logs karaoke-api
```

Look for:
- `[SYNC] Pulling from onedrive:... → /var/www/karaoke-app/audio/incoming`
- `[SYNC] Done. N audio file(s) currently in incoming/`
- `[SCAN] Imported "Title" by Artist`
- `[SCAN] Failed "filename": <reason>`
