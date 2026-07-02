/**
 * Runtime config for where the app's backend lives.
 *
 * Web build (served behind nginx on danserv.co.uk): VITE_API_BASE is empty, so
 * all URLs stay relative ("/api/...", "/audio/...") and resolve same-origin.
 *
 * Capacitor/APK build: there is no same-origin server — the webview is served
 * from https://localhost. Build with `--mode capacitor` (loads .env.capacitor)
 * so VITE_API_BASE points at the live server and every call becomes absolute.
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';
