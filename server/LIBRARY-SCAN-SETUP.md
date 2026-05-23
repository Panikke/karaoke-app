# Library Scan — Setup Guide

The "Scan Library" feature lets you drop audio files into a folder on the Pi
and import them in bulk, the way Plex, Navidrome, and Subsonic do. This is
far more reliable than browser uploads through Cloudflare Tunnel for big
batches (50+ songs).

## How it works

1. Files land in `/var/www/karaoke-app/audio/incoming/` (any way you like)
2. You click **Scan Library** in the app
3. The server reads ID3 tags via `music-metadata`, moves each file into
   `/var/www/karaoke-app/audio/` with a UUID filename, saves embedded
   cover art, and inserts a Supabase row
4. Files that fail (corrupt, unreadable tags, DB error) move to
   `/var/www/karaoke-app/audio/failed/` so they're not retried automatically

## One-time Pi setup

### Option A — Samba share (recommended for Windows users)

Lets you drag-and-drop from Windows File Explorer over the LAN.

```bash
# Install Samba
apt update && apt install -y samba

# Make the incoming directory world-writable so the share works
mkdir -p /var/www/karaoke-app/audio/incoming
chown -R www-data:www-data /var/www/karaoke-app/audio
chmod -R 775 /var/www/karaoke-app/audio

# Add a share block to /etc/samba/smb.conf
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

# Restart Samba
systemctl restart smbd

# Check it's listening
ss -tlnp | grep ':445'
```

On Windows, in File Explorer's address bar, type:
```
\\dietpi\karaoke-incoming
```
(replace `dietpi` with your Pi's hostname or LAN IP). Drag files in.

### Option B — SFTP (built-in, no setup)

If SSH is enabled on the Pi, SFTP just works. From Windows, use
**WinSCP** or **FileZilla**:

- Host: `dietpi` (or LAN IP)
- Username: `root`
- Password: your Pi root password
- Remote path: `/var/www/karaoke-app/audio/incoming/`

Drag files into the remote panel.

### Option C — SCP from command line

```bash
# From your Windows PC (PowerShell with OpenSSH)
scp "C:\path\to\songs\*.mp3" root@dietpi:/var/www/karaoke-app/audio/incoming/
```

## Filename conventions (optional)

If files have proper ID3 tags, those win. If not, the server parses the
filename. These formats work:

- `001 - Title - Artist.mp3`  →  track #001, title, artist
- `42_Title - Artist.mp3`     →  track #42, title, artist
- `Title - Artist.mp3`        →  title, artist (no track number)
- `My Song.mp3`               →  title only, artist falls back to "Unknown Artist"

## Deploying the new code on the Pi

```bash
cd /var/www/karaoke-app
git pull
cd server && npm install   # picks up new music-metadata dependency
cd ..
pnpm build
pm2 restart karaoke-api
```

## Watching the scan

```bash
pm2 logs karaoke-api
```

You'll see `[SCAN]` lines per file:
- `[SCAN] Imported "Title" by Artist` → success
- `[SCAN] Failed "filename":` → moved to failed/ with reason
