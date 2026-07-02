# Android app (Capacitor)

The Android app is the **existing React SPA** wrapped in a [Capacitor](https://capacitorjs.com)
webview and packaged as a sideloadable APK. There is no separate codebase — the
APK ships the same `dist/` build the website uses.

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

## One-time setup: toolchain

Building an APK needs a **JDK 17** and the **Android SDK**. The easiest way to get
both is [Android Studio](https://developer.android.com/studio) (bundles a JDK,
the SDK, and an emulator). After installing:

1. Open Android Studio once and let it finish the SDK download.
2. Ensure `JAVA_HOME` / the SDK are on your environment (Android Studio sets the
   SDK path in `android/local.properties` automatically when you open the project).

## Build the APK

```sh
# from the repo root
pnpm install            # if you haven't already
pnpm android:open       # build web (capacitor mode) → cap sync → open Android Studio
```

Then in Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
The debug APK lands in `android/app/build/outputs/apk/debug/app-debug.apk` —
copy it to the phone and sideload (enable "Install unknown apps").

### Command-line alternative

```sh
pnpm android:sync                       # build web + copy into android/
cd android && ./gradlew assembleDebug   # needs JDK + SDK on PATH
```

## Handy scripts

| Script | What it does |
| --- | --- |
| `pnpm build:apk` | `vite build --mode capacitor` (loads `.env.capacitor`) |
| `pnpm android:sync` | `build:apk` then `cap sync android` |
| `pnpm android:open` | `android:sync` then open Android Studio |

## After changing app code

Re-run `pnpm android:sync` (or `android:open`) — Capacitor copies the fresh
`dist/` into the native project. No need to re-run `cap add android`.

## App identity

- **App ID:** `uk.co.danserv.karaoke` (`capacitor.config.json`)
- **App name:** Karaoke

To produce a **release** (signed) APK/AAB for distribution, generate a keystore
and configure signing in `android/app/build.gradle` — see the Capacitor
[Android deployment guide](https://capacitorjs.com/docs/android/deploying-to-google-play).
