import { useState, useEffect, useCallback } from 'react';
import { SongLibrary } from './components/SongLibrary';
import { KaraokePlayer } from './components/KaraokePlayer';
import { BulkUploadDialog } from './components/BulkUploadDialog';
import { BulkImageDialog } from './components/BulkImageDialog';
import { EditSongDialog } from './components/EditSongDialog';
import { LoginPage } from './components/LoginPage';
import { AdminDashboard } from './components/AdminDashboard';
import { ScanLibraryDialog } from './components/ScanLibraryDialog';
import { Music, FolderUp, Images, ScrollText, LogIn, LogOut, Shield, Loader2, FolderSearch } from 'lucide-react';
import type { LyricLine } from '../utils/lrcParser';
import { useAuth } from './hooks/useAuth';
import {
  fetchAllSongs,
  updateSongLyrics,
  updateSongMeta,
  updateSongPlaylist,
  uploadSongToServer,
  uploadCoverArt,
  uploadLyricsImage,
  deleteSongFromServer,
  clearLibraryOnServer,
} from '../lib/songsApi';

export interface Song {
  id: string;
  trackNumber?: string;
  title: string;
  artist: string;
  audioUrl: string;       // /audio/<uuid>.wav  — served by nginx
  lyrics: string;
  syncedLyrics: LyricLine[];
  lyricsSource: 'manual' | 'api' | 'file' | 'none';
  language: string;
  lyricsImageUrl?: string;
  coverArtUrl?: string;
  inPlaylist: boolean;    // stored in Supabase — shared state
}

export interface SongUploadPayload {
  trackNumber?: string;
  title: string;
  artist: string;
  language: string;
  lyrics: string;
  syncedLyrics: LyricLine[];
  lyricsSource: Song['lyricsSource'];
  audioFile: File;
  lyricsImageFile?: File;
}

export default function App() {
  const [songs, setSongs]           = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [showBulkImages, setShowBulkImages] = useState(false);
  const [showBulkLyricsImages, setShowBulkLyricsImages] = useState(false);
  const [showScanLibrary, setShowScanLibrary] = useState(false);
  const [editingSong, setEditingSong]   = useState<Song | null>(null);
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [showLogin, setShowLogin]       = useState(false);
  const [showAdmin, setShowAdmin]       = useState(false);

  const { user, profile, loading: authLoading, isAdmin, canEditPlaylist, signOut } = useAuth();

  // ── Load songs from Supabase on mount ───────────────────────────────────────
  useEffect(() => {
    fetchAllSongs()
      .then(setSongs)
      .catch(err => setLoadError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  // ── Upload ──────────────────────────────────────────────────────────────────
  const addSongs = useCallback(async (
    payloads: SongUploadPayload[],
    onProgress?: (done: number, total: number, filePct?: number) => void,
  ) => {
    const CONCURRENCY = 3; // upload 3 songs at a time
    let done = 0;
    const failures: string[] = [];

    // Process in chunks of CONCURRENCY
    for (let i = 0; i < payloads.length; i += CONCURRENCY) {
      const chunk = payloads.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(async (payload, j) => {
        const idx = i + j;
        try {
          const song = await uploadSongToServer(payload, (pct) => {
            onProgress?.(done, payloads.length, pct);
          });
          // Add each song to library immediately as it finishes
          setSongs(prev => [...prev, song]);
        } catch (err) {
          console.warn(`Failed to upload "${payload.title}":`, err);
          failures.push(payload.title);
        }
        done++;
        onProgress?.(done, payloads.length, 100);
      }));
    }

    if (failures.length > 0) {
      const preview = failures.slice(0, 3).join(', ');
      const more = failures.length > 3 ? ` +${failures.length - 3} more` : '';
      throw new Error(
        `${payloads.length - failures.length} of ${payloads.length} uploaded. ` +
        `Failed: ${preview}${more}`
      );
    }
  }, []);

  // ── Delete ──────────────────────────────────────────────────────────────────
  const deleteSong = useCallback(async (id: string) => {
    await deleteSongFromServer(id);
    setSongs(prev => prev.filter(s => s.id !== id));
    if (currentSong?.id === id) setCurrentSong(null);
  }, [currentSong]);

  // ── Clear library ───────────────────────────────────────────────────────────
  const clearLibrary = useCallback(async () => {
    await clearLibraryOnServer();
    setSongs([]);
    setCurrentSong(null);
  }, []);

  // ── Update cover art ────────────────────────────────────────────────────────
  const updateCoverArt = useCallback(async (songId: string, imageFile: File) => {
    const coverArtUrl = await uploadCoverArt(songId, imageFile);
    setSongs(prev => prev.map(s => s.id === songId ? { ...s, coverArtUrl } : s));
    setCurrentSong(prev => prev?.id === songId ? { ...prev, coverArtUrl } : prev);
  }, []);

  // ── Update lyrics ───────────────────────────────────────────────────────────
  const updateLyrics = useCallback(async (
    songId: string,
    lyrics: string,
    syncedLyrics: LyricLine[],
    source: Song['lyricsSource'],
  ) => {
    await updateSongLyrics(songId, lyrics, syncedLyrics, source);
    setSongs(prev => prev.map(s =>
      s.id === songId ? { ...s, lyrics, syncedLyrics, lyricsSource: source } : s,
    ));
    setCurrentSong(prev =>
      prev?.id === songId ? { ...prev, lyrics, syncedLyrics, lyricsSource: source } : prev,
    );
  }, []);

  // ── Update lyrics image ─────────────────────────────────────────────────────
  const updateLyricsImageFn = useCallback(async (songId: string, imageFile: File) => {
    const lyricsImageUrl = await uploadLyricsImage(songId, imageFile);
    setSongs(prev => prev.map(s => s.id === songId ? { ...s, lyricsImageUrl } : s));
    setCurrentSong(prev => prev?.id === songId ? { ...prev, lyricsImageUrl } : prev);
  }, []);

  // ── Update metadata ─────────────────────────────────────────────────────────
  const updateSong = useCallback(async (
    id: string,
    patch: { title: string; artist: string; language: string },
  ) => {
    await updateSongMeta(id, patch);
    setSongs(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    setCurrentSong(prev => prev?.id === id ? { ...prev, ...patch } : prev);
  }, []);

  // ── Playlist toggle ─────────────────────────────────────────────────────────
  const togglePlaylist = useCallback(async (id: string) => {
    const song = songs.find(s => s.id === id);
    if (!song) return;
    const next = !song.inPlaylist;
    // Optimistic update
    setSongs(prev => prev.map(s => s.id === id ? { ...s, inPlaylist: next } : s));
    try {
      await updateSongPlaylist(id, next);
    } catch (err) {
      // Revert on error
      setSongs(prev => prev.map(s => s.id === id ? { ...s, inPlaylist: !next } : s));
      console.error('Playlist toggle failed:', err);
    }
  }, [songs]);

  // ── Lyrics search ───────────────────────────────────────────────────────────
  const bulkSearchLyrics = useCallback(async (ids: string[]) => {
    const { searchLyrics } = await import('../utils/lyricsApi');
    for (const id of ids) {
      const song = songs.find(s => s.id === id);
      if (!song) continue;
      try {
        const result = await searchLyrics(song.title, song.artist);
        if (result) await updateLyrics(id, result.plain, result.synced, 'api');
      } catch { /* continue */ }
    }
  }, [songs, updateLyrics]);

  const playlist = songs.filter(s => s.inPlaylist);

  // ── Loading / error states ──────────────────────────────────────────────────
  if (loading || authLoading) {
    return (
      <div className="size-full bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center gap-3 text-white">
        <Loader2 className="w-8 h-8 animate-spin text-pink-400" />
        <span className="text-xl">Loading library…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="size-full bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex items-center justify-center p-8 text-white">
        <div className="text-center max-w-md">
          <p className="text-xl font-semibold text-red-400 mb-2">Could not load song library</p>
          <p className="text-sm text-gray-300 mb-4">{loadError}</p>
          <button
            onClick={() => { setLoadError(null); setLoading(true); fetchAllSongs().then(setSongs).catch(e => setLoadError(String(e))).finally(() => setLoading(false)); }}
            className="px-6 py-2 bg-purple-600 hover:bg-purple-700 rounded-xl text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="size-full bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white">
      {currentSong ? (
        <KaraokePlayer
          song={currentSong}
          playlist={playlist}
          onSelectSong={setCurrentSong}
          onBack={() => setCurrentSong(null)}
          onUpdateLyrics={updateLyrics}
        />
      ) : (
        <div className="size-full flex flex-col">
          {/* ── Header ── */}
          <header className="bg-black/30 backdrop-blur-sm border-b border-white/10 px-6 py-4 flex-shrink-0">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <Music className="w-8 h-8 text-pink-400 flex-shrink-0" />
                <h1 className="text-2xl font-bold tracking-tight truncate">Karaoke</h1>
                <span className="text-sm text-gray-400 flex-shrink-0">{songs.length} songs</span>
                {playlist.length < songs.length && (
                  <span className="text-xs text-yellow-400 flex-shrink-0">
                    {playlist.length} in playlist
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {user && canEditPlaylist && (
                  <>
                    <button
                      onClick={() => setShowScanLibrary(true)}
                      title="Scan files from the Pi incoming folder (Plex-style, best for large batches)"
                      className="px-4 py-2.5 min-h-[44px] bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl hover:from-emerald-600 hover:to-teal-600 transition-all flex items-center gap-2 font-medium text-sm"
                    >
                      <FolderSearch className="w-4 h-4" />
                      <span className="hidden md:inline">Scan Library</span>
                    </button>
                    <button
                      onClick={() => setShowBulkLyricsImages(true)}
                      title="Bulk upload lyrics screenshots — matched by track number"
                      className="px-4 py-2.5 min-h-[44px] bg-white/5 hover:bg-white/10 border border-white/20 rounded-xl transition-all flex items-center gap-2 font-medium text-sm"
                    >
                      <ScrollText className="w-4 h-4" />
                      <span className="hidden md:inline">Bulk Lyrics</span>
                    </button>
                    <button
                      onClick={() => setShowBulkImages(true)}
                      className="px-4 py-2.5 min-h-[44px] bg-white/5 hover:bg-white/10 border border-white/20 rounded-xl transition-all flex items-center gap-2 font-medium text-sm"
                    >
                      <Images className="w-4 h-4" />
                      <span className="hidden md:inline">Bulk Images</span>
                    </button>
                    <button
                      onClick={() => setShowBulkUpload(true)}
                      title="HTTP upload (best for 1-5 ad-hoc files)"
                      className="px-4 py-2.5 min-h-[44px] bg-white/5 hover:bg-white/10 border border-white/20 rounded-xl transition-all flex items-center gap-2 font-medium text-sm"
                    >
                      <FolderUp className="w-4 h-4" />
                      <span className="hidden md:inline">Upload Songs</span>
                    </button>
                  </>
                )}

                {user && isAdmin && (
                  <button
                    onClick={() => setShowAdmin(true)}
                    className="px-4 py-2.5 min-h-[44px] bg-purple-600/40 hover:bg-purple-600/60 border border-purple-500/40 rounded-xl flex items-center gap-2 text-sm font-medium transition-all"
                  >
                    <Shield className="w-4 h-4 text-purple-300" />
                    <span className="hidden sm:inline text-purple-300">Admin</span>
                  </button>
                )}

                {user ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 hidden sm:block truncate max-w-[100px]">
                      {profile?.display_name || user.email?.split('@')[0]}
                    </span>
                    <button
                      onClick={signOut}
                      title="Sign out"
                      className="p-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors"
                    >
                      <LogOut className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowLogin(true)}
                    className="flex items-center gap-2 px-4 py-2.5 min-h-[44px] bg-white/5 hover:bg-white/10 border border-white/20 rounded-xl text-sm transition-colors"
                  >
                    <LogIn className="w-4 h-4" />
                    <span className="hidden sm:inline">Sign In</span>
                  </button>
                )}
              </div>
            </div>
          </header>

          <SongLibrary
            songs={songs}
            canEdit={!!canEditPlaylist}
            onSelectSong={setCurrentSong}
            onDeleteSong={deleteSong}
            onEditSong={setEditingSong}
            onTogglePlaylist={togglePlaylist}
            onSearchLyrics={bulkSearchLyrics}
            onClearLibrary={clearLibrary}
            onUpdateLyrics={updateLyrics}
            onAssignLyricsImage={updateLyricsImageFn}
          />
        </div>
      )}

      {showBulkUpload && (
        <BulkUploadDialog onClose={() => setShowBulkUpload(false)} onUpload={addSongs} />
      )}
      {showScanLibrary && (
        <ScanLibraryDialog
          onClose={() => setShowScanLibrary(false)}
          onImported={(newSongs) => setSongs(prev => [...prev, ...newSongs])}
        />
      )}
      {showBulkImages && (
        <BulkImageDialog songs={songs} onClose={() => setShowBulkImages(false)} onApply={updateCoverArt} />
      )}
      {showBulkLyricsImages && (
        <BulkImageDialog songs={songs} onClose={() => setShowBulkLyricsImages(false)} onApply={updateLyricsImageFn} mode="lyrics" />
      )}
      {editingSong && (
        <EditSongDialog
          song={editingSong}
          onClose={() => setEditingSong(null)}
          onSave={updateSong}
          onAssignLyricsImage={updateLyricsImageFn}
          onUpdateLyrics={updateLyrics}
        />
      )}
      {showLogin && (
        <LoginPage onClose={() => setShowLogin(false)} />
      )}
      {showAdmin && isAdmin && (
        <AdminDashboard onClose={() => setShowAdmin(false)} />
      )}
    </div>
  );
}
