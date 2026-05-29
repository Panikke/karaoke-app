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
  audioUrl: string;
  lyrics: string;
  syncedLyrics: LyricLine[];
  lyricsSource: 'manual' | 'api' | 'file' | 'none';
  language: string;
  lyricsImageUrl?: string;
  coverArtUrl?: string;
  inPlaylist: boolean;
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
  const [songs, setSongs]             = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [queue, setQueue]             = useState<Song[]>([]);
  const [showBulkUpload, setShowBulkUpload]           = useState(false);
  const [showBulkImages, setShowBulkImages]           = useState(false);
  const [showBulkLyricsImages, setShowBulkLyricsImages] = useState(false);
  const [showScanLibrary, setShowScanLibrary]         = useState(false);
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [showLogin, setShowLogin]     = useState(false);
  const [showAdmin, setShowAdmin]     = useState(false);

  const { user, profile, loading: authLoading, isAdmin, canEditPlaylist, signOut } = useAuth();

  useEffect(() => {
    fetchAllSongs()
      .then(setSongs)
      .catch(err => setLoadError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  // Patron self-queue: adds to END (FIFO order)
  const addToQueue = useCallback((song: Song) => {
    setQueue(prev => [...prev.filter(q => q.id !== song.id), song]);
  }, []);

  const addSongs = useCallback(async (
    payloads: SongUploadPayload[],
    onProgress?: (done: number, total: number, filePct?: number) => void,
  ) => {
    const CONCURRENCY = 3;
    let done = 0;
    const failures: string[] = [];
    for (let i = 0; i < payloads.length; i += CONCURRENCY) {
      const chunk = payloads.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(async (payload) => {
        try {
          const song = await uploadSongToServer(payload, (pct) => {
            onProgress?.(done, payloads.length, pct);
          });
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

  const deleteSong = useCallback(async (id: string) => {
    await deleteSongFromServer(id);
    setSongs(prev => prev.filter(s => s.id !== id));
    if (currentSong?.id === id) setCurrentSong(null);
  }, [currentSong]);

  const clearLibrary = useCallback(async () => {
    await clearLibraryOnServer();
    setSongs([]);
    setCurrentSong(null);
  }, []);

  const updateCoverArt = useCallback(async (songId: string, imageFile: File) => {
    const coverArtUrl = await uploadCoverArt(songId, imageFile);
    setSongs(prev => prev.map(s => s.id === songId ? { ...s, coverArtUrl } : s));
    setCurrentSong(prev => prev?.id === songId ? { ...prev, coverArtUrl } : prev);
  }, []);

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

  const updateLyricsImageFn = useCallback(async (songId: string, imageFile: File) => {
    const lyricsImageUrl = await uploadLyricsImage(songId, imageFile);
    setSongs(prev => prev.map(s => s.id === songId ? { ...s, lyricsImageUrl } : s));
    setCurrentSong(prev => prev?.id === songId ? { ...prev, lyricsImageUrl } : prev);
  }, []);

  const updateSong = useCallback(async (
    id: string,
    patch: { title: string; artist: string; language: string },
  ) => {
    await updateSongMeta(id, patch);
    setSongs(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    setCurrentSong(prev => prev?.id === id ? { ...prev, ...patch } : prev);
  }, []);

  const togglePlaylist = useCallback(async (id: string) => {
    const song = songs.find(s => s.id === id);
    if (!song) return;
    const next = !song.inPlaylist;
    setSongs(prev => prev.map(s => s.id === id ? { ...s, inPlaylist: next } : s));
    try {
      await updateSongPlaylist(id, next);
    } catch {
      setSongs(prev => prev.map(s => s.id === id ? { ...s, inPlaylist: !next } : s));
    }
  }, [songs]);

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

  if (loading || authLoading) {
    return (
      <div className="size-full bg-black flex items-center justify-center gap-3 text-white">
        <Loader2 className="w-8 h-8 animate-spin text-[#d4af37]" />
        <span className="text-xl font-light tracking-widest uppercase text-white/40">Loading…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="size-full bg-black flex items-center justify-center p-8 text-white">
        <div className="text-center max-w-md">
          <p className="text-xl font-semibold text-red-400 mb-2">Could not load song library</p>
          <p className="text-sm text-white/30 mb-4">{loadError}</p>
          <button
            onClick={() => {
              setLoadError(null);
              setLoading(true);
              fetchAllSongs().then(setSongs).catch(e => setLoadError(String(e))).finally(() => setLoading(false));
            }}
            className="px-6 py-2 bg-[#d4af37] hover:bg-[#c4a030] text-black rounded text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="size-full bg-black text-white">
      {currentSong ? (
        <KaraokePlayer
          song={currentSong}
          playlist={playlist}
          queue={queue}
          onQueueChange={setQueue}
          onSelectSong={setCurrentSong}
          onBack={() => setCurrentSong(null)}
          onUpdateLyrics={updateLyrics}
        />
      ) : (
        <div className="size-full flex flex-col">
          {/* ── Header ── */}
          <header className="bg-black border-b border-white/10 px-6 py-4 flex-shrink-0">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <Music className="w-7 h-7 text-[#d4af37] flex-shrink-0" />
                <h1 className="text-xl font-bold tracking-widest uppercase truncate text-white">Karaoke</h1>
                <span className="text-xs text-white/20 font-mono flex-shrink-0">{songs.length}</span>
                {playlist.length < songs.length && (
                  <span className="text-xs text-[#d4af37]/60 flex-shrink-0 font-mono">
                    {playlist.length} active
                  </span>
                )}
                {queue.length > 0 && (
                  <span className="text-xs text-[#d4af37]/60 flex-shrink-0 font-mono">
                    {queue.length} queued
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                {user && canEditPlaylist && (
                  <>
                    <button
                      onClick={() => setShowScanLibrary(true)}
                      title="Scan files from the Pi incoming folder"
                      className="px-3 py-2 min-h-[40px] bg-[#00d4ff]/10 hover:bg-[#00d4ff]/20 border border-[#00d4ff]/30 hover:border-[#00d4ff]/60 rounded transition-all flex items-center gap-2 text-[#00d4ff] text-xs font-medium"
                    >
                      <FolderSearch className="w-4 h-4" />
                      <span className="hidden md:inline">Scan</span>
                    </button>
                    <button
                      onClick={() => setShowBulkLyricsImages(true)}
                      title="Bulk upload lyrics screenshots"
                      className="px-3 py-2 min-h-[40px] bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all flex items-center gap-2 text-white/40 hover:text-white text-xs font-medium"
                    >
                      <ScrollText className="w-4 h-4" />
                      <span className="hidden md:inline">Bulk Lyrics</span>
                    </button>
                    <button
                      onClick={() => setShowBulkImages(true)}
                      className="px-3 py-2 min-h-[40px] bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all flex items-center gap-2 text-white/40 hover:text-white text-xs font-medium"
                    >
                      <Images className="w-4 h-4" />
                      <span className="hidden md:inline">Bulk Images</span>
                    </button>
                    <button
                      onClick={() => setShowBulkUpload(true)}
                      className="px-3 py-2 min-h-[40px] bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/40 hover:border-[#d4af37]/70 rounded transition-all flex items-center gap-2 text-[#d4af37] text-xs font-medium"
                    >
                      <FolderUp className="w-4 h-4" />
                      <span className="hidden md:inline">Upload</span>
                    </button>
                  </>
                )}

                {user && isAdmin && (
                  <button
                    onClick={() => setShowAdmin(true)}
                    className="px-3 py-2 min-h-[40px] bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-500/50 rounded flex items-center gap-2 text-xs font-medium transition-all text-white/40 hover:text-purple-400"
                  >
                    <Shield className="w-4 h-4" />
                    <span className="hidden sm:inline">Admin</span>
                  </button>
                )}

                {user ? (
                  <div className="flex items-center gap-2 ml-1">
                    <span className="text-xs text-white/25 hidden sm:block truncate max-w-[100px]">
                      {profile?.display_name || user.email?.split('@')[0]}
                    </span>
                    <button
                      onClick={signOut}
                      title="Sign out"
                      className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-colors"
                    >
                      <LogOut className="w-4 h-4 text-white/30 hover:text-white" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowLogin(true)}
                    className="flex items-center gap-2 px-3 py-2 min-h-[40px] bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/40 rounded text-[#d4af37] text-xs font-medium transition-colors"
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
            queue={queue}
            onSelectSong={setCurrentSong}
            onQueueSong={addToQueue}
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
