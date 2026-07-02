import { useState, useMemo, useEffect, useRef } from 'react';
import Fuse from 'fuse.js';
import {
  Search, Play, Trash2, Music2, Pencil, ListMusic, ListX,
  Loader2, AlertTriangle, Plus, Download, Check, WifiOff,
} from 'lucide-react';
import type { Song } from '../App';
import { downloadsSizeBytes } from '../../lib/offline';
import { MissingLyricsPanel } from './MissingLyricsPanel';
import { ManualLyricsDialog } from './ManualLyricsDialog';
import type { LyricLine } from '../../utils/lrcParser';

interface SongLibraryProps {
  songs: Song[];
  canEdit: boolean;
  queue: Song[];
  /** Scroll this song into view on mount (set when returning from the player) */
  scrollToSongId?: string | null;
  /** Song currently loaded in the (hidden) player — taps queue instead of replacing it */
  nowPlayingId?: string | null;
  /** True when running from the offline snapshot — only downloaded songs play */
  offline?: boolean;
  downloadedIds?: Set<string>;
  downloadingIds?: Set<string>;
  /** Present only in the native app — their absence hides all download UI */
  onDownloadSong?:  (song: Song) => Promise<void> | void;
  onRemoveDownload?: (id: string) => Promise<void> | void;
  onSelectSong:        (song: Song) => void;
  onQueueSong:         (song: Song) => void;
  onDeleteSong:        (id: string) => Promise<void>;
  onEditSong:          (song: Song) => void;
  onTogglePlaylist:    (id: string) => Promise<void>;
  onClearLibrary:      () => Promise<void>;
  onUpdateLyrics:      (id: string, lyrics: string, synced: LyricLine[], source: Song['lyricsSource']) => Promise<void>;
  onAssignLyricsImage: (songId: string, file: File) => Promise<void>;
}

const fmtBytes = (n: number) =>
  n >= 1_073_741_824 ? `${(n / 1_073_741_824).toFixed(1)} GB`
  : n >= 1_048_576   ? `${Math.round(n / 1_048_576)} MB`
  : `${Math.max(1, Math.round(n / 1024))} KB`;

const lyricsBadge = (song: Song) => {
  if (song.syncedLyrics.length > 0) return { label: 'Synced', cls: 'bg-blue-500/15 text-blue-400 border border-blue-500/30' };
  if (song.lyrics.trim())           return { label: 'Lyrics', cls: 'bg-slate-700/60 text-slate-300 border border-slate-600' };
  if (song.lyricsImageUrl)          return { label: 'Image',  cls: 'bg-orange-500/15 text-orange-400 border border-orange-500/30' };
  return { label: 'No lyrics', cls: 'bg-slate-800 text-slate-500 border border-slate-700' };
};

export function SongLibrary({
  songs, canEdit, queue, scrollToSongId, nowPlayingId = null, offline = false,
  downloadedIds = new Set(), downloadingIds = new Set(),
  onDownloadSong, onRemoveDownload,
  onSelectSong, onQueueSong, onDeleteSong, onEditSong,
  onTogglePlaylist, onClearLibrary, onUpdateLyrics, onAssignLyricsImage,
}: SongLibraryProps) {
  const [query, setQuery]         = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [manualSong, setManualSong]     = useState<Song | null>(null);
  const [busyId, setBusyId]             = useState<string | null>(null);
  const [queuedFeedback, setQueuedFeedback] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // On mount, jump back to the song the user was playing. The library unmounts
  // while the player is open, so scroll position is lost — this restores it.
  useEffect(() => {
    if (!scrollToSongId) return;
    gridRef.current
      ?.querySelector(`[data-song-id="${scrollToSongId}"]`)
      ?.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const missingSongs = songs.filter(s => s.syncedLyrics.length === 0 && !s.lyrics.trim() && !s.lyricsImageUrl);

  const fuse = useMemo(() => new Fuse(songs, {
    keys: [
      { name: 'title',       weight: 0.5  },
      { name: 'artist',      weight: 0.35 },
      { name: 'trackNumber', weight: 0.1  },
      { name: 'language',    weight: 0.05 },
    ],
    threshold:          0.4,
    ignoreLocation:     true,
    includeScore:       true,
    minMatchCharLength: 1,
  }), [songs]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) {
      return [...songs].sort((a, b) => {
        const na = a.trackNumber ? parseInt(a.trackNumber) : Infinity;
        const nb = b.trackNumber ? parseInt(b.trackNumber) : Infinity;
        if (na !== nb) return na - nb;
        return a.title.localeCompare(b.title);
      });
    }
    return fuse.search(q).map(r => r.item);
  }, [songs, query, fuse]);

  const handleClearLibrary = async () => {
    setConfirmClear(false);
    await onClearLibrary();
  };

  const handleDeleteSong = async (id: string) => {
    setBusyId(id);
    try { await onDeleteSong(id); } finally { setBusyId(null); }
  };

  const handleTogglePlaylist = async (id: string) => {
    setBusyId(id);
    try { await onTogglePlaylist(id); } finally { setBusyId(null); }
  };

  const queueWithFeedback = (song: Song) => {
    onQueueSong(song);
    setQueuedFeedback(song.id);
    setTimeout(() => setQueuedFeedback(null), 1500);
  };

  const handleCardClick = (song: Song) => {
    if (offline && !downloadedIds.has(song.id)) return; // not on this device
    // Tapping the playing song reopens the player
    if (nowPlayingId === song.id) {
      onSelectSong(song);
      return;
    }
    // Something else is playing — don't interrupt it, queue this one
    // (the queue is client-side state, so this works offline too)
    if (nowPlayingId) {
      queueWithFeedback(song);
      return;
    }
    // Nothing is playing — a tap always starts playback; queueing into a
    // player that isn't open would just pile up songs nobody can start
    onSelectSong(song);
  };

  // Download every playlist song that isn't already on the device
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const pendingPlaylistCount = songs.filter(s => s.inPlaylist && !downloadedIds.has(s.id)).length;
  const downloadPlaylist = async () => {
    if (!onDownloadSong) return;
    const pending = songs.filter(s => s.inPlaylist && !downloadedIds.has(s.id));
    setBulkProgress({ done: 0, total: pending.length });
    try {
      for (let i = 0; i < pending.length; i++) {
        try { await onDownloadSong(pending[i]); }
        catch (e) { console.warn(`Download failed for "${pending[i].title}":`, e); }
        setBulkProgress({ done: i + 1, total: pending.length });
      }
    } finally {
      setBulkProgress(null);
    }
  };

  // Storage used by downloads — native only, refreshed as downloads change
  const [storageBytes, setStorageBytes] = useState(0);
  useEffect(() => {
    if (onDownloadSong) downloadsSizeBytes().then(setStorageBytes);
  }, [downloadedIds, onDownloadSong]);

  return (
    <div className="flex-1 overflow-hidden flex flex-col p-4 gap-3 bg-slate-900">

      {/* ── Search + action bar ── */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search songs, artists, track numbers…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-slate-800 border border-slate-700 rounded text-white placeholder-slate-500 focus:outline-none focus:border-orange-500/50 transition-colors text-sm"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-lg leading-none"
            >×</button>
          )}
        </div>

        {query && filtered.length > 0 && (
          <span className="text-xs text-slate-500 font-mono hidden sm:block">
            {filtered.length} found
          </span>
        )}

        {offline && (
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-900/20 border border-amber-500/30 rounded text-sm text-amber-300">
            <WifiOff className="w-4 h-4 flex-shrink-0" />
            <span>Offline — downloaded songs only</span>
          </div>
        )}

        {onDownloadSong && !offline && (pendingPlaylistCount > 0 || bulkProgress) && (
          <button
            onClick={downloadPlaylist}
            disabled={!!bulkProgress}
            className="flex items-center gap-2 px-4 py-3 bg-slate-800 border border-slate-700 hover:border-orange-500/40 hover:text-orange-400 rounded text-sm text-slate-400 transition-colors disabled:opacity-60"
          >
            {bulkProgress
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Download className="w-4 h-4" />
            }
            <span>
              {bulkProgress
                ? `Downloading ${bulkProgress.done} of ${bulkProgress.total}…`
                : `Download playlist (${pendingPlaylistCount})`
              }
            </span>
          </button>
        )}

        {onDownloadSong && storageBytes > 0 && (
          <span className="text-xs text-slate-500 font-mono whitespace-nowrap" title="Storage used by downloaded songs">
            {fmtBytes(storageBytes)} on device
          </span>
        )}

        {canEdit && songs.length > 0 && (
          confirmClear ? (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-900/20 border border-red-500/30 rounded text-sm">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-red-300 hidden sm:inline">Delete all {songs.length} songs?</span>
              <button onClick={handleClearLibrary} className="px-2 py-0.5 bg-red-500 hover:bg-red-600 rounded text-white text-xs font-medium">Yes</button>
              <button onClick={() => setConfirmClear(false)} className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-white text-xs">No</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              className="flex items-center gap-2 px-4 py-3 bg-slate-800 border border-slate-700 hover:border-red-500/40 hover:text-red-400 rounded text-sm text-slate-500 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )
        )}
      </div>

      {/* ── Song grid ── */}
      <div ref={gridRef} className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-4">
            <Music2 className="w-16 h-16 text-slate-700" />
            <p className="text-lg font-light tracking-wide text-slate-500">
              {songs.length === 0
                ? 'No songs yet — sign in and upload to start'
                : query ? `No matches for "${query}"` : 'No results'
              }
            </p>
            {query && (
              <button onClick={() => setQuery('')} className="text-sm text-orange-400/70 hover:text-orange-400">
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-4">
            {filtered.map(song => {
              const badge        = lyricsBadge(song);
              const inPlaylist   = song.inPlaylist;
              const isBusy       = busyId === song.id;
              const isQueued     = queue.some(q => q.id === song.id);
              const justQueued   = queuedFeedback === song.id;
              const isDownloaded = downloadedIds.has(song.id);
              const isDownloading = downloadingIds.has(song.id);
              const offlineUnplayable = offline && !isDownloaded;

              return (
                <div
                  key={song.id}
                  data-song-id={song.id}
                  className={`bg-slate-800 border rounded-xl transition-all group relative overflow-hidden ${
                    offlineUnplayable ? 'cursor-default' : 'cursor-pointer'
                  } ${
                    offlineUnplayable
                      ? 'border-slate-700/40 opacity-30'
                      : justQueued
                      ? 'border-orange-500 shadow-[0_0_20px_rgba(249,115,22,0.2)]'
                      : isQueued && !canEdit
                      ? 'border-orange-500/30'
                      : inPlaylist
                      ? 'border-slate-700 hover:border-slate-500'
                      : 'border-slate-700/50 opacity-50 hover:opacity-70'
                  }`}
                  onClick={() => handleCardClick(song)}
                >
                  <div className="relative h-48 bg-slate-900 flex items-center justify-center overflow-hidden">
                    {song.coverArtUrl
                      ? <img src={song.coverArtUrl} alt={song.title} className="w-full h-full object-cover" />
                      : song.lyricsImageUrl
                      ? <img src={song.lyricsImageUrl} alt={song.title} className="w-full h-full object-contain p-1 opacity-70" />
                      : <span className="text-4xl opacity-10">♪</span>
                    }

                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg ${
                        canEdit ? 'bg-white' : 'bg-orange-500'
                      }`}>
                        {canEdit
                          ? <Play className="w-5 h-5 text-slate-900 ml-0.5" />
                          : isQueued
                          ? <span className="text-white text-sm font-bold">✓</span>
                          : <Plus className="w-5 h-5 text-white" />
                        }
                      </div>
                    </div>

                    <span className={`absolute bottom-2 left-2 text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>

                    {onDownloadSong && !offline && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          if (isDownloading) return;
                          if (isDownloaded) onRemoveDownload?.(song.id);
                          else onDownloadSong(song);
                        }}
                        className={`absolute top-2 left-2 w-11 h-11 flex items-center justify-center rounded-lg border transition-colors ${
                          isDownloaded
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                            : 'bg-black/70 border-slate-600 text-slate-300 hover:text-white hover:border-slate-400'
                        }`}
                        title={
                          isDownloading ? 'Downloading…'
                          : isDownloaded ? 'Downloaded — tap to remove from device'
                          : 'Download for offline'
                        }
                      >
                        {isDownloading
                          ? <Loader2 className="w-5 h-5 animate-spin" />
                          : isDownloaded
                          ? <Check className="w-5 h-5" />
                          : <Download className="w-5 h-5" />
                        }
                      </button>
                    )}

                    {offline && isDownloaded && (
                      <span className="absolute top-2 left-2 w-11 h-11 flex items-center justify-center rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-400">
                        <Check className="w-5 h-5" />
                      </span>
                    )}

                    {isQueued && (
                      <span className="absolute bottom-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/40 font-medium">
                        Queued
                      </span>
                    )}
                    {nowPlayingId === song.id && (
                      <span className="absolute bottom-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-medium">
                        Playing
                      </span>
                    )}

                    {canEdit && !inPlaylist && !isQueued && nowPlayingId !== song.id && (
                      <span className="absolute bottom-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-500 border border-slate-700">
                        off
                      </span>
                    )}

                    {canEdit && (
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        <button
                          onClick={e => { e.stopPropagation(); onEditSong(song); }}
                          className="p-1.5 bg-black/80 hover:bg-blue-500/20 border border-transparent hover:border-blue-500/40 rounded-lg transition-colors"
                          title="Edit song info"
                        >
                          <Pencil className="w-3.5 h-3.5 text-slate-400 hover:text-blue-400" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleTogglePlaylist(song.id); }}
                          disabled={isBusy}
                          className={`p-1.5 rounded-lg transition-colors border ${inPlaylist ? 'bg-black/80 hover:bg-orange-500/20 border-transparent hover:border-orange-500/40' : 'bg-orange-500/20 border-orange-500/40 hover:bg-orange-500/30'}`}
                          title={inPlaylist ? 'Remove from playlist' : 'Add to playlist'}
                        >
                          {isBusy
                            ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                            : inPlaylist
                            ? <ListX className="w-3.5 h-3.5 text-slate-300" />
                            : <ListMusic className="w-3.5 h-3.5 text-orange-400" />
                          }
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDeleteSong(song.id); }}
                          disabled={isBusy}
                          className="p-1.5 bg-black/80 hover:bg-red-500/20 border border-transparent hover:border-red-500/40 rounded-lg transition-colors"
                          title="Delete song"
                        >
                          {isBusy
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                            : <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                          }
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="p-3">
                    <h3 className="font-semibold truncate text-sm text-white">
                      {song.trackNumber && (
                        <span className="font-mono text-orange-400/60 mr-1.5 text-xs">{song.trackNumber}</span>
                      )}
                      {song.title}
                    </h3>
                    <p className="text-xs text-slate-400 truncate mt-0.5">{song.artist}</p>
                    {justQueued && (
                      <p className="text-xs text-orange-400 mt-1 font-medium">Added to queue ✓</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {canEdit && (
        <MissingLyricsPanel
          songs={missingSongs}
          onManualEdit={setManualSong}
          onAssignImage={onAssignLyricsImage}
        />
      )}

      {manualSong && (
        <ManualLyricsDialog
          song={manualSong}
          onClose={() => setManualSong(null)}
          onSave={onUpdateLyrics}
        />
      )}
    </div>
  );
}
