# Android app (Capacitor)

The Android app is the **existing React SPA** wrapped in a [Capacitor](https://capacitorjs.com)
webview and packaged as a sideloadable APK. There is no separate codebase — the
APK ships the same `dist/` build the website uses.

> **Just want the app on a tablet?** You don't need any of this — see
> [INSTALL-ANDROID.md](INSTALL-ANDROID.md) for the non-technical install guide.
> This document is for building the APK.

**Status:** working. Built and sideloaded onto an Honor Pad 9. Includes offline
song downloads.

## How it differs from the web build

The website is served behind nginx on `danserv.co.uk`, so it reaches the backend
with **relative** URLs (`/api/...`, `/audio/...`). Inside the APK the webview is
served from `https://localhost`, so those paths would hit the phone, not the Pi.

The fix is a single build-time switch:

- `src/lib/config.ts` exports `API_BASE = import.meta.env.VITE_API_BASE ?? ''`.
- `src/lib/songsApi.ts` prefixes every `/api` and `/audio` URL with `API_BASE`.
- **Web build** (`pnpm build`): `VITE_API_BASE` is empty → URLs stay relative.
- **APK build** (`pnpm build:apk`): `.env.capacitor` sets
  `VITE_API_BASE=https://danserv.co.uk` → URLs become absolute.

Because the APK is now a **cross-origin** client, the Express server
(`server/index.js`) CORS allow-list includes `https://localhost` and
`capacitor://localhost`. Supabase already used an absolute URL, so it needed no
change. Audio/cover `<audio>`/`<img>` tags load cross-origin without CORS headers.

## Offline downloads (native only)

`src/lib/offline.ts` is the whole feature. Every export is a no-op on the web
build, so the browser app is unaffected and no download UI renders there.

Files go to the app's **private data directory** (`Directory.Data`) —
deliberately *not* the browser Cache API, which Android evicts under storage
pressure. That eviction risk is the main reason this is a Capacitor app rather
than a PWA.

```
karaoke/library.json      song metadata snapshot + download manifest
karaoke/<songId>/audio.*  downloaded media
karaoke/<songId>/cover.*
karaoke/<songId>/lyrics.*
```

- **Boot:** a successful `fetchAllSongs()` writes the snapshot. If the request
  fails and a snapshot exists, the app loads it and sets offline mode instead of
  showing the error screen.
- **Playback:** `withLocalMedia()` swaps `audioUrl`/`coverArtUrl`/
  `lyricsImageUrl` for `Capacitor.convertFileSrc()` URLs on downloaded songs, so
  the `<audio>`/`<img>` elements need no changes. Downloaded songs play locally
  even when online.
- **Verification:** after each download the file is `stat`ed and rejected if
  empty, and the stored path comes from `getUri()` rather than the download
  result (whose shape varies by plugin version). The song folder is created with
  `mkdir` first, because `downloadFile`'s `recursive` flag has been unreliable
  on Android.
- **Errors surface in the UI.** An early version logged failures to the console
  and incremented the progress counter anyway, so a run where *every* download
  failed still looked successful. Failures now show a red banner with the real
  message, the counter reports `(N failed)`, and a bulk run aborts after 5
  consecutive failures.

## One-time setup: toolchain

Building an APK needs a **JDK 17** and the **Android SDK**. The easiest way to get
both is [Android Studio](https://developer.android.com/studio) (bundles a JDK,
the SDK, and an emulator). After installing:

1. Open Android Studio once and let it finish the SDK download.
2. Ensure `JAVA_HOME` / the SDK are on your environment (Android Studio sets the
   SDK path in `android/local.properties` automatically when you open the project).

## Build the APK

Android Studio bundles a JDK (its "JBR"), so you don't need a separate one —
just point `JAVA_HOME` at it. This is the command-line route, which is what's
actually used here; you never have to open the Android Studio GUI.

**Windows (PowerShell), from the repo root:**

```powershell
pnpm android:sync
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
cd android
.\gradlew.bat assembleDebug
```

The debug APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.
First build takes several minutes (Gradle downloads its toolchain); later ones
are seconds.

Alternatively `pnpm android:open` builds, syncs, and opens Android Studio, where
**Build → Build Bundle(s) / APK(s) → Build APK(s)** does the same thing.

### Verify the APK actually contains your changes

Gradle can report `BUILD SUCCESSFUL` in ~2s having skipped the asset repackaging.
Confirm the bundle inside the APK matches the one you just built:

```sh
unzip -p android/app/build/outputs/apk/debug/app-debug.apk assets/public/index.html | grep -oE "index-[A-Za-z0-9_-]+\.js"
ls android/app/src/main/assets/public/assets/*.js
```

The hashed filenames must match. If they don't, re-run `pnpm android:sync`.

### Build troubleshooting

Both of these cost real time during the initial setup:

| Symptom | Cause & fix |
|---|---|
| `java.io.IOException: Invalid file path` from `SdkLocator` | `android/local.properties` had Windows **backslashes**. Gradle treats `\` as escapes — use forward slashes: `sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk`. The file is gitignored, so each machine needs its own. |
| `Incompatible magic value 0 in class file`, or `Could not read workspace metadata from …/metadata.bin` | Corrupted Gradle caches, typically after an interrupted first build. Delete `~/.gradle/caches` and `android/.gradle`, then rebuild. (Clearing only `caches/<version>/scripts` is not enough — the compiled scripts also live in `caches/jars-*`.) |

## Handy scripts

| Script | What it does |
| --- | --- |
| `pnpm build:apk` | `vite build --mode capacitor` (loads `.env.capacitor`) |
| `pnpm android:sync` | `build:apk` then `cap sync android` |
| `pnpm android:open` | `android:sync` then open Android Studio |

## After changing app code

Re-run `pnpm android:sync` (or `android:open`) — Capacitor copies the fresh
`dist/` into the native project. No need to re-run `cap add android`.

## Plugins

| Plugin | Used for |
| --- | --- |
| `@capacitor/core` / `@capacitor/android` | The webview shell |
| `@capacitor/filesystem` | Offline downloads (see above) |

After adding any plugin, run `pnpm android:sync` — it registers the native code
in the Gradle project. The sync output lists what it found.

## App identity

- **App ID:** `uk.co.danserv.karaoke` (`capacitor.config.json`)
- **App name:** Karaoke

Debug APKs are signed with the local debug keystore. Keep using the same machine
(or copy the keystore) so updates install **over** the existing app — a different
signature makes Android refuse with "App not installed".

To produce a **release** (signed) APK/AAB for distribution, generate a keystore
and configure signing in `android/app/build.gradle` — see the Capacitor
[Android deployment guide](https://capacitorjs.com/docs/android/deploying-to-google-play).
