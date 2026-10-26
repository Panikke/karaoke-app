# Moving the karaoke server to the cloud

This moves everything off home computers, so a PC going to sleep can't break
the app:

- **Songs → Cloudflare R2.** Phones stream songs straight from Cloudflare, so
  playback keeps working even if the server has a problem.
- **API and website → a small Hetzner cloud server.** It runs around the clock
  in a data centre and restarts the API automatically if it crashes.

**Cost:** about £4 a month for Hetzner. R2 is free for the first 10 GB, then
about 1.5 US cents per GB a month, so 16 GB of songs costs roughly 7p a month.

**Before you start:** merge the pull request with these changes into `main` on
GitHub. Every command below uses `main`.

Your dad's PC keeps working the whole way through. Nothing is switched over
until part 4, and you can switch back.

Cloudflare and Hetzner move their buttons around now and then, so a menu might
be named slightly differently from what's written here.

---

## Part 1 — Cloudflare R2 (song storage)

Do this in the Cloudflare dashboard you already use for danserv.co.uk:
<https://dash.cloudflare.com>.

1. **Turn on R2.** In the left menu, click **R2 Object Storage** and follow
   the steps to subscribe. Cloudflare asks for a card even on the free plan,
   but you're only charged above 10 GB.
2. **Create a bucket.** Click **Create bucket**:
   - Name: `karaoke-media`
   - Location: Automatic (or "Europe")
   - Click **Create bucket**.
3. **Give it a web address.** In the bucket, open **Settings** → **Custom
   Domains** → **Add**. Enter `media.danserv.co.uk` and confirm. Wait until
   the status says **Active** (usually a minute or two).
4. **Allow the app to load files** (needed for the website). In
   **Settings** → **CORS Policy** → **Add CORS policy**, paste this and save:

   ```json
   [
     {
       "AllowedOrigins": ["https://danserv.co.uk", "https://localhost"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```

5. **Create a key for the server.** Go back to the main **R2 Object Storage**
   page → **Manage API tokens** (also called **API Tokens**) → **Create API
   token**:
   - Permissions: **Object Read & Write**
   - Specify bucket: **Apply to specific buckets only** → `karaoke-media`
   - Click **Create API Token**.

   Copy these into a note **now**, because the secret is only shown once:
   - **Access Key ID**
   - **Secret Access Key**
   - **Account ID**. It's shown on the R2 overview page, and it's also the
     long code in the `https://<account-id>.r2.cloudflarestorage.com` address.

Keep that note private. Anyone with these keys can change your songs.

---

## Part 2 — Copy the songs into R2 (on your dad's PC)

Connect with TeamViewer and open **PowerShell** in the karaoke-app folder.

1. Get the new code and its dependencies:

   ```powershell
   git fetch origin
   git checkout main
   git pull
   cd server
   npm install
   ```

2. Open the `.env` file in the karaoke-app folder (one level above `server`)
   in Notepad. Add these lines at the bottom, using the values from part 1:

   ```ini
   R2_ACCOUNT_ID=paste-account-id
   R2_ACCESS_KEY_ID=paste-access-key-id
   R2_SECRET_ACCESS_KEY=paste-secret-access-key
   R2_BUCKET=karaoke-media
   R2_PUBLIC_URL=https://media.danserv.co.uk
   ```

   Make sure `AUDIO_DIR=` points at the songs folder on his PC.

3. Copy the songs:

   ```powershell
   node migrate-to-r2.mjs
   ```

   It prints progress every 25 files. 16 GB takes roughly 1–3 hours,
   depending on his internet upload speed. If it stops or the PC restarts,
   just run it again. It skips anything already copied. It never deletes
   anything on his PC.

4. When it finishes it should say **"All done — every song's files are in
   R2."** If it lists `MISSING` or `FAILED` files, run it again. If the same
   files keep failing, send me the list.

5. **Check one song.** Copy any song's filename from the songs folder, then
   open `https://media.danserv.co.uk/<that filename>` on your phone. It should
   play or download.

His PC's server now also stores *new* uploads in R2 (after its next restart).
That's fine: it means nothing gets left behind during the move.

---

## Part 3 — Hetzner cloud server

### 3a. Make an SSH key on *your* PC (once)

This is the "key" that lets you log in to the server securely. In PowerShell
on your own PC:

```powershell
ssh-keygen -t ed25519
```

Press Enter at every question. Then show the public half and copy the whole line:

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

### 3b. Create the server

1. Sign up at <https://www.hetzner.com/cloud>. They may ask for ID or a
   small card check the first time.
2. Create a **Project**, e.g. `karaoke`, open it and click **Add Server**:
   - **Location:** Nuremberg, Falkenstein or Helsinki (any is fine from the UK)
   - **Image:** Ubuntu **24.04**
   - **Type:** Shared vCPU → **Arm64 (Ampere) CAX11** (the cheapest; x86
     **CX22** also works)
   - **Networking:** keep **Public IPv4** ticked
   - **SSH keys:** **Add SSH key**, paste the line from 3a
   - **Backups:** optional (about 20% extra). Worth it for peace of mind.
   - **Name:** `karaoke`
   - Click **Create & Buy now**.
3. Copy the server's **IPv4 address** from the server list (e.g. `65.21.x.x`).

### 3c. Install everything

In PowerShell on your PC:

```powershell
ssh root@YOUR-SERVER-IP
```

Type `yes` the first time. You're now typing on the server. Run:

```bash
curl -fsSL https://raw.githubusercontent.com/Panikke/karaoke-app/main/server/setup-hetzner.sh -o setup.sh
bash setup.sh
```

It installs everything, then stops and asks you to create the settings file:

```bash
nano /opt/karaoke-app/.env
```

Paste this, with the real values filled in. Copy the first three from the
`.env` on your dad's PC, and the R2 values from part 1:

```ini
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

VITE_MEDIA_BASE=https://media.danserv.co.uk

R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=karaoke-media
R2_PUBLIC_URL=https://media.danserv.co.uk
```

Save with **Ctrl+O**, **Enter**, then exit with **Ctrl+X**. Run the script
again:

```bash
bash setup.sh
```

It builds the site, starts the service, and asks for a tunnel token. **Press
Enter to skip for now**, because you get the token in part 4. It should end
with `API is up: {"ok":true}` and a line saying `Media: R2 bucket
"karaoke-media"`.

---

## Part 4 — Switch danserv.co.uk over to the cloud server

At the end of this part the site points at Hetzner instead of your dad's PC.
It's down for about a minute in between.

1. In the Cloudflare dashboard, open **Zero Trust** → **Networks** →
   **Tunnels** → **Create a tunnel** → **Cloudflared**. Name it
   `karaoke-cloud` and click **Save**.
2. On the "Install connector" screen, the command contains a long token after
   `service install`. Copy **only the token** (the long string starting with
   `eyJ`).
3. Back in your SSH window, run `bash setup.sh` again and paste the token when
   asked. Back in the browser, the connector should show as **Connected**.
   Click **Next**.
4. **Free up the address.** In a second browser tab, open **danserv.co.uk** →
   **DNS** → **Records**. Find the record named `danserv.co.uk` (type CNAME,
   pointing to `….cfargotunnel.com`) and **delete it**. Leave every other
   record (`flt`, `jellyfin`, `vault`, `media`…) exactly as it is. The site is
   now briefly offline.
5. Back in the tunnel's **Public Hostname** step:
   - Subdomain: *(leave empty)*
   - Domain: `danserv.co.uk`
   - Service type: **HTTP**, URL: `127.0.0.1:3001`
   - **Save**.

### Check it

- `https://danserv.co.uk/api/health` on your phone shows `{"ok":true}`
- `https://danserv.co.uk` loads and you can log in
- A song plays in the app
- Upload a short test song. It plays, and it shows up in the R2 bucket in
  the Cloudflare dashboard.

**To go back to the PC** if something's wrong, repeat step 4–5 in reverse:
delete the new `danserv.co.uk` record, then re-add it to the old tunnel.

---

## Part 5 — Tidy up

- **Phone app:** the app you have installed keeps working as it is. The
  server redirects its song requests to R2. For playback that works even when
  the server is down, rebuild the APK with `VITE_MEDIA_BASE` turned on (one
  line in `.env.capacitor`) and reinstall. Ask me to do this.
- **Your dad's PC:** after a week or so of everything working, disable the
  karaoke task in Task Scheduler and stop the `cloudflared` service there.
  Keep the songs folder as a spare backup copy.

---

## Day-to-day

| I want to… | Do this (in `ssh root@YOUR-SERVER-IP`) |
|---|---|
| Update after code changes | `bash setup.sh` (pulls the latest code, rebuilds, restarts) |
| See what the API is doing | `journalctl -u karaoke-api -f` (Ctrl+C to stop) |
| Restart the API | `systemctl restart karaoke-api` |
| Check the tunnel | `systemctl status cloudflared` |
| Bulk-import songs | Copy files into `/var/lib/karaoke/audio/incoming/` (e.g. with WinSCP), then use **Scan library** in the app |

The API starts on boot and restarts within seconds if it ever crashes.
Ubuntu installs security updates automatically.
