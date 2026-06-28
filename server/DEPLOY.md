# Pi Deployment — Shared Library Server

Run these commands on the Pi (SSH in as `root@dietpi`).

## 1 — Add service role key to .env

Open the Supabase dashboard → Project Settings → API → copy the **service_role** key (the long one labelled "secret").

```bash
nano /var/www/karaoke-app/.env
```

Add this line (keep the existing VITE_ lines):
```
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key-here...
```

Save: Ctrl+O, Enter, Ctrl+X

---

## 2 — Pull latest code

```bash
cd /var/www/karaoke-app
git pull origin main
```

---

## 3 — Install server dependencies

```bash
cd /var/www/karaoke-app/server
npm install
```

---

## 4 — Install PM2 (once only)

```bash
npm install -g pm2
```

---

## 5 — Start the API server with PM2

```bash
cd /var/www/karaoke-app/server
pm2 start index.js --name karaoke-api
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```

Check it's running:
```bash
pm2 status
curl http://127.0.0.1:3001/api/health
# should return {"ok":true}
```

---

## 6 — Create the audio directory

```bash
mkdir -p /var/www/karaoke-app/audio
chmod 755 /var/www/karaoke-app/audio
```

---

## 7 — Update nginx config

Find your site config:
```bash
grep -rl "karaoke" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null
# or check the default:
cat /etc/nginx/sites-enabled/default
```

Add the contents of `server/nginx-snippet.conf` inside the `server { }` block, then:
```bash
nginx -t          # test config
systemctl reload nginx
```

---

## 8 — Build and deploy the frontend

```bash
cd /var/www/karaoke-app
pnpm install      # if not already done
pnpm build
```

---

## Updating after code changes

```bash
cd /var/www/karaoke-app
git pull origin main
pnpm build            # rebuild frontend
cd server
npm install           # if server deps changed
pm2 restart karaoke-api
```

---

## Logs

```bash
pm2 logs karaoke-api        # live tail
pm2 logs karaoke-api --lines 100
```

---

## Troubleshooting "502 Bad Gateway"

A 502 from Cloudflare means nginx (the origin) could not get a valid response
from its upstream. Work down the chain from the inside out.

### 1 — Is the API process alive?

```bash
pm2 status                              # karaoke-api should be "online"
curl -s http://127.0.0.1:3001/api/health   # expect {"ok":true}
```

If `curl` fails or pm2 shows `errored`/`stopped`, the Express server is down —
that is the usual cause of an API 502. Check why it died:

```bash
pm2 logs karaoke-api --lines 100
```

Look for `[FATAL]` lines (added by the process-level guards) or a stack trace.
Restart it:

```bash
pm2 restart karaoke-api
```

If it keeps crash-looping, pm2 shows a climbing **↺ restarts** count in
`pm2 status`. Read the logs for the repeated error before doing anything else.

### 2 — Is nginx up and pointing at the right upstream?

```bash
systemctl status nginx
nginx -t                                # config valid?
curl -sI http://127.0.0.1/api/health    # through nginx, not direct
```

If step 1's direct `curl` works but the nginx one 502s, the problem is in the
nginx proxy config — confirm `proxy_pass http://127.0.0.1:3001;` matches the
port the API actually listens on (see `server/nginx-snippet.conf`).

### 3 — Static page itself 502s (not just /api/)

The frontend is static files served straight from `dist/` by nginx, so it should
never 502 on its own. If it does, nginx is failing to serve the SPA — usually a
bad `root`/`try_files`, or nginx isn't running at all. Check `systemctl status
nginx`, `nginx -t`, and the nginx error log:

```bash
tail -n 50 /var/log/nginx/error.log
```

(If the *whole origin* is unreachable, Cloudflare usually shows 521/522 rather
than 502 — that points at the Pi being offline or nginx stopped, not the API.)
