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
