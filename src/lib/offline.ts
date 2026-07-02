/**
 * Offline library — native (APK) only, every export no-ops on the web build.
 *
 * Songs are downloaded into the app's private data directory (survives until
 * the app is uninstalled, never evicted like browser caches):
 *
 *   karaoke/library.json      snapshot of song metadata + download manifest
 *   karaoke/<songId>/audio.*  downloaded media per song
 *   karaoke/<songId>/cover.*
 *   karaoke/<songId>/lyrics.*
 *
 * On launch without network the app loads the snapshot and plays downloaded
 * files via Capacitor.convertFileSrc, so the <audio>/<img> elements work
 * unchanged.
 */

import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { Song } from '../app/App';

export const isNative = Capacitor.isNativePlatform();

const DIR = Directory.Data;
const ROOT = 'karaoke';
const MANIFEST = `${ROOT}/library.json`;

/** Native file URIs for one downloaded song (file:// paths). */
export interface DownloadedFiles {
  audio: string;
  cover?: string;
  lyrics?: string;
}

interface Manifest {
  savedAt: string;
  songs: Song[];
  downloads: Record<string, DownloadedFiles>;
}

async function readManifest(): Promise<Manifest> {
  try {
    const { data } = await Filesystem.readFile({
      path: MANIFEST, directory: DIR, encoding: 'utf8' as any,
    });
    return JSON.parse(data as string) as Manifest;
  } catch {
    return { savedAt: '', songs: [], downloads: {} };
  }
}

async function writeManifest(m: Manifest): Promise<void> {
  await Filesystem.writeFile({
    path: MANIFEST, directory: DIR, encoding: 'utf8' as any,
    data: JSON.stringify(m), recursive: true,
  });
}

/** Persist the song list after a successful online load (downloads preserved). */
export async function saveLibrarySnapshot(songs: Song[]): Promise<void> {
  if (!isNative) return;
  const m = await readManifest();
  await writeManifest({ ...m, savedAt: new Date().toISOString(), songs });
}

/** Load the last-known song list; null if never saved. */
export async function loadLibrarySnapshot(): Promise<Song[] | null> {
  if (!isNative) return null;
  const m = await readManifest();
  return m.songs.length > 0 ? m.songs : null;
}

/** Map of songId → downloaded file URIs. */
export async function getDownloads(): Promise<Record<string, DownloadedFiles>> {
  if (!isNative) return {};
  return (await readManifest()).downloads;
}

const extOf = (url: string) => {
  const m = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i);
  return m ? m[1].toLowerCase() : 'bin';
};

async function downloadOne(url: string, path: string): Promise<string> {
  const res = await Filesystem.downloadFile({
    url, path, directory: DIR, recursive: true,
  });
  if (!res.path) throw new Error(`Download produced no file: ${url}`);
  return res.path;
}

/** Download a song's audio (+ cover, lyrics image) for offline playback. */
export async function downloadSong(song: Song): Promise<DownloadedFiles> {
  if (!isNative) throw new Error('Downloads are only available in the app');

  const base = `${ROOT}/${song.id}`;
  const files: DownloadedFiles = {
    audio: await downloadOne(song.audioUrl, `${base}/audio.${extOf(song.audioUrl)}`),
  };
  // Cover/lyrics are nice-to-have — a failure shouldn't lose the audio
  if (song.coverArtUrl) {
    try { files.cover = await downloadOne(song.coverArtUrl, `${base}/cover.${extOf(song.coverArtUrl)}`); }
    catch { /* audio is what matters */ }
  }
  if (song.lyricsImageUrl) {
    try { files.lyrics = await downloadOne(song.lyricsImageUrl, `${base}/lyrics.${extOf(song.lyricsImageUrl)}`); }
    catch { /* audio is what matters */ }
  }

  const m = await readManifest();
  m.downloads[song.id] = files;
  await writeManifest(m);
  return files;
}

/** Delete a song's downloaded files and forget them. */
export async function removeDownload(songId: string): Promise<void> {
  if (!isNative) return;
  try {
    await Filesystem.rmdir({ path: `${ROOT}/${songId}`, directory: DIR, recursive: true });
  } catch { /* already gone */ }
  const m = await readManifest();
  delete m.downloads[songId];
  await writeManifest(m);
}

/** Total size of all downloads, for a storage-used display. */
export async function downloadsSizeBytes(): Promise<number> {
  if (!isNative) return 0;
  let total = 0;
  const walk = async (path: string) => {
    const { files } = await Filesystem.readdir({ path, directory: DIR });
    for (const f of files) {
      if (f.type === 'directory') await walk(`${path}/${f.name}`);
      else total += f.size;
    }
  };
  try { await walk(ROOT); } catch { /* nothing downloaded yet */ }
  return total;
}

/**
 * Swap a song's remote URLs for local ones when it's downloaded.
 * convertFileSrc turns file:// paths into webview-loadable URLs, so the
 * existing <audio>/<img> elements need no changes.
 */
export function withLocalMedia(song: Song, downloads: Record<string, DownloadedFiles>): Song {
  const files = downloads[song.id];
  if (!files) return song;
  return {
    ...song,
    audioUrl: Capacitor.convertFileSrc(files.audio),
    coverArtUrl: files.cover ? Capacitor.convertFileSrc(files.cover) : song.coverArtUrl,
    lyricsImageUrl: files.lyrics ? Capacitor.convertFileSrc(files.lyrics) : song.lyricsImageUrl,
  };
}
