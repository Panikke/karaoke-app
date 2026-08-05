# Putting the Karaoke app on your tablet

This guide is for **using** the app, not building it. It walks through getting
the Karaoke app onto an Android tablet (like the Honor Pad 9) and singing from
it — including how to make songs work with no internet.

No technical knowledge needed. Follow the steps in order.

> **Building** the app file from scratch is a separate, much more technical job.
> That's in [ANDROID.md](ANDROID.md).

---

## What you need before you start

- An Android tablet or phone.
- The app file, called **`karaoke.apk`**. On the computer that built it, this
  lives in the `Downloads` folder.
- A WiFi connection (only for the first setup and for downloading songs).

**What's an APK?** It's just what an Android app file is called, the same way a
document might be a `.pdf`. Ours is named `karaoke.apk`.

---

## Part 1 — Copy the app file to the tablet

Pick **one** of these. The USB way is fastest; the cloud way needs no cable.

### Option A — With a USB cable

1. Plug the tablet into the computer with a USB cable.
2. On the tablet, a notification appears about the USB connection. Tap it and
   choose **File transfer** (it may say "Transferring files" or "MTP").
3. On the computer, open **File Explorer**. The tablet shows up in the sidebar
   like a USB stick.
4. Open the tablet → **Internal storage** → **Download**.
5. Drag `karaoke.apk` into that folder.
6. Unplug the tablet.

### Option B — Through the internet (no cable)

1. On the computer, upload `karaoke.apk` to Google Drive, OneDrive, or email it
   to yourself.
2. On the tablet, open that same Drive / OneDrive / email.
3. Download `karaoke.apk` onto the tablet.

> Most chat apps (WhatsApp etc.) refuse to send APK files. Use Drive, OneDrive,
> or email instead.

---

## Part 2 — Install the app

1. On the tablet, open the **Files** app (sometimes called "File Manager").
2. Go to the **Download** folder.
3. Tap **`karaoke.apk`**.
4. A message appears saying you can't install apps from this source. **This is
   normal** — Android is careful about apps that don't come from the Play Store.
   Tap **Settings** in that message.
5. Turn on the switch called **Allow from this source**.
6. Press the **back** arrow. You'll return to the install screen.
7. Tap **Install**.
8. You may see a warning from **Play Protect** saying the app wasn't checked or
   is from an unknown developer. This is expected — it says that about *every*
   app not downloaded from the Play Store. Tap **Install anyway** (you might
   need to tap **More details** first to find that button).
9. Wait a few seconds, then tap **Open**.

You should now see the Karaoke app with your song library.

> **Where do I find the app later?** It's on the tablet's home screen or app
> drawer, named **Karaoke**, with a music-note icon.

> **Menu names vary.** Honor tablets run MagicOS, which renames some menus. If
> step 4 looks different, the setting you want is under
> **Settings → Apps → Special access → Install unknown apps** — then pick the
> Files app and allow it.

---

## Part 3 — Using the app

### Playing a song

Tap any song card. The player opens and the song starts.

### Adding songs to the queue

While a song is playing, tap a **different** song. It doesn't interrupt — it
joins the queue and gets an orange **Queued** label. When the current song
finishes, the queued one plays next.

### Getting back to the player

When you go back to the library while music is playing, a **bar appears at the
bottom** showing what's playing. Tap it to return to the player. The playing
song's card also shows a green **Playing** label.

---

## Part 4 — Making songs work without internet

Normally the app streams songs from the server at danserv.co.uk. If that server
or your internet goes down mid-party, the music stops. Downloading songs to the
tablet first prevents that.

### Downloading songs

- **One song:** tap the **download arrow** in the corner of its card. It spins
  while working, then turns into a **green tick** when the song is safely on the
  tablet.
- **All your playlist songs:** tap **Download playlist** at the top. It works
  through them one at a time, showing progress like *"Downloading 12 of 96…"*.
  When it's done, the button disappears.

You'll see something like **"1.2 GB on device"** at the top — that's how much
tablet storage the downloaded songs are using.

### Checking it actually worked

1. Download a couple of songs (wait for the green ticks).
2. Turn on **aeroplane mode** on the tablet.
3. Close the app fully and open it again.
4. You should see an orange bar: **"Offline — downloaded songs only"**.
   Downloaded songs still play; the rest are greyed out.

### Freeing up space

Tap the **green tick** on a song to delete its download from the tablet. The
song stays in your library — it just streams again instead of playing locally.

### Roughly how much space?

Songs are about **5 MB each**, so around **200 songs per gigabyte**. A tablet
with plenty of free space can hold a big library comfortably. (Songs uploaded as
uncompressed WAV files are much larger.)

---

## If something goes wrong

| What you see | What to do |
|---|---|
| **"App not installed"** | The old version was signed differently. Uninstall the existing Karaoke app, then install again. |
| **"Can't open file"** | The copy didn't finish. Copy `karaoke.apk` across again. |
| **App opens but no songs** | The tablet has no internet, and nothing is downloaded yet. Connect to WiFi and reopen. |
| **A red error bar when downloading** | Read the message — it names the real problem. Send that text to whoever maintains the app. |
| **Songs won't play in aeroplane mode** | They weren't downloaded. Check for green ticks, turn WiFi back on, download, then retry. |
| **Play Protect won't let you install** | Tap **More details** → **Install anyway**. |

---

## Installing a newer version later

When an updated `karaoke.apk` is built:

1. Copy the new file to the tablet (Part 1).
2. Tap it and choose **Update** instead of Install.

You **don't** need to uninstall first, and you **don't** need to redo the
"allow from this source" permission. Your downloaded songs stay where they are.

> Make sure you copy the **new** file across — an old copy sitting in the
> tablet's Download folder will just reinstall the old version. Check the file's
> date if you're unsure.
