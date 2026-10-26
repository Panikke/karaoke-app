#!/usr/bin/env bash
# Sets up (or updates) the karaoke server on a fresh Ubuntu 24.04 cloud server.
#
#   sudo bash setup-hetzner.sh [branch]
#
# Safe to re-run: run it again after a `git push` to pull, rebuild and restart.
# Installs Node 22, ffmpeg, rclone and cloudflared; builds the site; runs the
# API as a systemd service that starts on boot and restarts if it crashes.
# See CLOUD-SETUP.md for the full walkthrough.
set -euo pipefail

BRANCH="${1:-main}"
REPO=https://github.com/Panikke/karaoke-app.git
APP_DIR=/opt/karaoke-app
DATA_DIR=/var/lib/karaoke
SERVICE=karaoke-api

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

say "Installing system packages"
apt-get update -q
apt-get install -y -q ca-certificates curl git ffmpeg rclone ufw unattended-upgrades

if ! node -v 2>/dev/null | grep -q '^v22\.'; then
  say "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
command -v pnpm >/dev/null || npm install -g pnpm@11

if ! command -v cloudflared >/dev/null; then
  say "Installing cloudflared"
  mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -q
  apt-get install -y -q cloudflared
fi

say "Firewall: allow SSH only (the tunnel is outbound, needs no open ports)"
ufw allow OpenSSH >/dev/null
ufw --force enable >/dev/null

id karaoke >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin karaoke
mkdir -p "$DATA_DIR/audio"
chown -R karaoke:karaoke "$DATA_DIR"

say "Getting the code ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

if [ ! -f "$APP_DIR/.env" ]; then
  cat <<EOF

No settings file yet. Create it, paste in your settings, then run this script again:

    nano $APP_DIR/.env

(CLOUD-SETUP.md, part 3, lists exactly what goes in it.)
EOF
  exit 1
fi
chown root:karaoke "$APP_DIR/.env"
chmod 640 "$APP_DIR/.env"

say "Building the website"
cd "$APP_DIR"
pnpm install --frozen-lockfile
pnpm build

say "Installing API dependencies"
cd "$APP_DIR/server"
npm ci --omit=dev --no-audit --no-fund

say "Installing the $SERVICE service"
cat > /etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=Karaoke API and website
After=network-online.target
Wants=network-online.target

[Service]
User=karaoke
WorkingDirectory=$APP_DIR/server
# These win over anything in .env (e.g. a Windows AUDIO_DIR copied across)
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3001
Environment=AUDIO_DIR=$DATA_DIR/audio
Environment=STATIC_DIR=$APP_DIR/dist
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q $SERVICE
systemctl restart $SERVICE

if ! systemctl is-active -q cloudflared; then
  echo
  echo "Paste the Cloudflare tunnel token (CLOUD-SETUP.md, part 4),"
  read -r -p "or just press Enter to skip for now: " TOKEN
  if [ -n "${TOKEN:-}" ]; then
    cloudflared service install "$TOKEN"
  fi
fi

say "Checking the API"
for _ in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    echo "API is up: $(curl -fsS http://127.0.0.1:3001/api/health)"
    journalctl -u $SERVICE -n 8 --no-pager -o cat
    echo
    systemctl is-active -q cloudflared \
      && echo "Tunnel: running. Try https://danserv.co.uk/api/health from your phone." \
      || echo "Tunnel: not installed yet. Re-run this script with the token when you have it."
    exit 0
  fi
  sleep 2
done
echo "The API didn't start. Last log lines:"
journalctl -u $SERVICE -n 40 --no-pager -o cat
exit 1
