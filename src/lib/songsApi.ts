/**
 * Supabase songs API — frontend reads/updates song metadata directly.
 * Audio file uploads/deletes go via the Express server at /api/songs/...
 */

import { supabase } from './supabase';
import type { Song } from '../app/App';
import type { LyricLine } from '../utils/lrcParser';

// Audio files are served by nginx from the Pi filesystem
const AUDIO_BASE = '/audio';

// ── DB shape ──────────────────────────────────────────────────────────────────
interface DbSong {
  id: string;
  track_number: string | null;
  title: string;
  artist: string;
  language: string;
  lyrics: string;
  synced_lyrics: LyricLine[];
  lyrics_source: Song['lyricsSource'];
  audio_filename: string;
  lyrics_image_filename: string | null;
  cover_art_filename: string | null;
  in_playlist: boolean;
  created_at: string;
}

function dbToSong(row: DbSong): Song {
  return {
    id:             row.id,
    trackNumber:    row.track_number ?? undefined,
    title:          row.title,
    artist:         row.artist,
    language:       row.language,
    lyrics:         row.lyrics,
    syncedLyrics:   Array.isArray(row.synced_lyrics) ? row.synced_lyrics : [],
    lyricsSource:   row.lyrics_source,
    audioUrl:       `${AUDIO_BASE}/${row.audio_filename}`,
    lyricsImageUrl: row.lyrics_image_filename
      ? `${AUDIO_BASE}/${row.lyrics_image_filename}`
      : undefined,
    coverArtUrl:    row.cover_art_filename
      ? `${AUDIO_BASE}/${row.cover_art_filename}`
      : undefined,
    inPlaylist:     row.in_playlist,
  };
}

// ── Read ──────────────────────────────────────────────────────────────────────
export async function fetchAllSongs(): Promise<Song[]> {
  const { data, error } = await supabase
    .from('songs')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data as DbSong[]).map(dbToSong);
}

// ── Lyrics update (direct to Supabase, needs editor RLS) ─────────────────────
export async function updateSongLyrics(
  id: string,
  lyrics: string,
  syncedLyrics: LyricLine[],
  lyricsSource: Song['lyricsSource'],
): Promise<void> {
  const { error } = await supabase
    .from('songs')
    .update({ lyrics, synced_lyrics: syncedLyrics, lyrics_source: lyricsSource })
    .eq('id', id);
  if (error) throw error;
}

// ── Metadata update ───────────────────────────────────────────────────────────
export async function updateSongMeta(
  id: string,
  patch: { title: string; artist: string; language: string },
): Promise<void> {
  const { error } = await supabase.from('songs').update(patch).eq('id', id);
  if (error) throw error;
}

// ── Playlist toggle ───────────────────────────────────────────────────────────
export async function updateSongPlaylist(id: string, inPlaylist: boolean): Promise<void> {
  const { error } = await supabase
    .from('songs')
    .update({ in_playlist: inPlaylist })
    .eq('id', id);
  if (error) throw error;
}

// ── Server API helpers (Express on Pi) ───────────────────────────────────────
async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return session.access_token;
}

/**
 * Upload songs to the Pi.
 * Calls POST /api/songs/upload one song at a time so we can report progress.
 * Returns the created Song objects.
 */
export async function uploadSongToServer(
  payload: {
    trackNumber?: string;
    title: string;
    artist: string;
    language: string;
    lyrics: string;
    syncedLyrics: LyricLine[];
    lyricsSource: Song['lyricsSource'];
    audioFile: File;
    lyricsImageFile?: File;
  },
): Promise<Song> {
  const token = await getToken();

  const form = new FormData();
  form.append('audio', payload.audioFile);
  form.append(
    'metadata',
    JSON.stringify([{
      trackNumber:  payload.trackNumber,
      title:        payload.title,
      artist:       payload.artist,
      language:     payload.language,
      lyrics:       payload.lyrics,
      syncedLyrics: payload.syncedLyrics,
      lyricsSource: payload.lyricsSource,
    }]),
  );

  const res = await fetch('/api/songs/upload', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
    body:    form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Upload failed');
  }

  const { songs } = await res.json();
  const created: Song = dbToSong(songs[0] as DbSong);

  // Upload lyrics image separately if provided
  if (payload.lyricsImageFile) {
    try {
      await uploadLyricsImage(created.id, payload.lyricsImageFile, token);
      const ext = payload.lyricsImageFile.name.replace(/.*(\.[^.]+)$/, '$1').toLowerCase();
      created.lyricsImageUrl = `${AUDIO_BASE}/lyrics_${created.id}${ext}`;
    } catch (e) {
      console.warn('Lyrics image upload failed:', e);
    }
  }

  return created;
}

export async function uploadCoverArt(
  songId: string,
  imageFile: File,
  token?: string,
): Promise<string> {
  const t = token ?? await getToken();
  const form = new FormData();
  form.append('image', imageFile);

  const res = await fetch(`/api/songs/${songId}/cover`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${t}` },
    body:    form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Cover upload failed');
  }
  const { filename } = await res.json();
  return `${AUDIO_BASE}/${filename}`;
}

export async function uploadLyricsImage(
  songId: string,
  imageFile: File,
  token?: string,
): Promise<string> {
  const t = token ?? await getToken();
  const form = new FormData();
  form.append('image', imageFile);

  const res = await fetch(`/api/songs/${songId}/lyrics-image`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${t}` },
    body:    form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Lyrics image upload failed');
  }
  const { filename } = await res.json();
  return `${AUDIO_BASE}/${filename}`;
}

export async function deleteSongFromServer(songId: string): Promise<void> {
  const token = await getToken();
  const res = await fetch(`/api/songs/${songId}`, {
    method:  'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Delete failed');
  }
}

export async function clearLibraryOnServer(): Promise<void> {
  const token = await getToken();
  const res = await fetch('/api/songs', {
    method:  'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Clear failed');
  }
}
