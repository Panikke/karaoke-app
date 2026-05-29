import { useState, useMemo } from 'react';
import Fuse from 'fuse.js';
import {
  Search, Play, Trash2, Music2, Pencil, ListMusic, ListX,
  CheckSquare, Square, RefreshCw, Loader2, AlertTriangle, Plus,
} from 'lucide-react';
import type { Song } from '../App';
import { MissingLyricsPanel } from './MissingLyricsPanel';
import { ManualLyricsDialog } from './ManualLyricsDialog';
import type { LyricLine } from '../../utils/lrcParser';

interface SongLibraryProps {
  songs: Song[];
  canEdit: boolean;
  queue: Song[];
  onSelectSong:        (song: Song) => void;
  onQueueSong:         (song: Song) => void;
  onDeleteSong:        (id: string) => Promise<void>;
  onEditSong:          (song: Song) => void;
  onTogglePlaylist:    (id: string) => Promise<void>;
  onSearchLyrics:      (ids: string[]) => Promise<void>;
  onClearLibrary:      () => Promise<void>;
  onUpdateLyrics:      (id: string, lyrics: string, synced: LyricLine[], source: Song['lyricsSource']) => Promise<void>;
  onAssignLyricsImage: (songId: string, file: File) => Promise<void>;
}

const lyricsBadge = (song: Song) => {
  if (song.syncedLyrics.length > 0) return { label: 'Synced', cls: 'bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/20' };
  if (song.lyrics.trim())           return { label: 'Lyrics', cls: 'bg-white/5 text-white/50 border border-white/10' };
  if (song.lyricsImageUrl)          return { label: 'Image',  cls: 'bg-[#d4af37]/10 text-[#d4af37] border border-[#d4af37]/20' };
  return { label: 'No lyrics', cls: 'bg-white/5 text-white/20 border border-white/10' };
};

export function SongLibrary({
  songs, canEdit, queue, onSelectSong, onQueueSong, onDeleteSong, onEditSong,
  onTogglePlaylist, onSearchLyrics, onClearLibrary, onUpdateLyrics, onAssignLyricsImage,
}: SongLibraryProps) {
  const [query, setQuery]             = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchingLyrics, setSearchingLyrics]   = useState(false);
  const [searchProgress, setSearchProgress]     = useState<{ done: number; total: number } | null>(null);
  const [confirmClear, setConfirmClear]         = useState(false);
  const [manualSong, setManualSong]             = useState<Song | null>(null);
  const [busyId, setBusyId]                     = useState<string | null>(null);
  const [queuedFeedback, setQueuedFeedback]     = useState<string | null>(null);

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

  const allFilteredSelected = filtered.length > 0 && filtered.every(s => selectedIds.has(s.id));

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => { const n = new Set(prev); filtered.forEach(s => n.delete(s.id)); return n; });
    } else {
      setSelectedIds(prev => { const n = new Set(prev); filtered.forEach(s => n.add(s.id)); return n; });
    }
  };

  const handleBulkSearchLyrics = async () => {
    const ids = Array.from(selectedIds);
    setSearchingLyrics(true);
    setSearchProgress({ done: 0, total: ids.length });
    let done = 0;
    for (const id of ids) {
      await onSearchLyrics([id]);
      done++;
      setSearchProgress({ done, total: ids.length });
    }
    setSearchingLyrics(false);
    setSearchProgress(null);
  };

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

  const handleCardClick = (song: Song) => {
    if (canEdit) {
      onSelectSong(song);
    } else {
      onQueueSong(song);
      setQueuedFeedback(song.id);
      setTimeout(() => setQueuedFeedback(null), 1500);
    }
  };

  const selectedCount = Array.from(selectedIds).filter(id => filtered.some(s => s.id === id)).length;

  return (
    <div className="flex-1 overflow-hidden flex flex-col p-4 gap-3 bg-black">

      {/* ── Search + bulk action bar ── */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 pointer-events-none" />
          <input
            type="text"
            placeholder="Search songs, artists, track numbers…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-black border border-white/10 rounded text-white placeholder-white/20 focus:outline-none focus:border-[#d4af37]/40 transition-colors text-sm"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white text-lg leading-none"
            >×</button>
          )}
        </div>

        {query && filtered.length > 0 && (
          <span className="text-xs text-white/20 font-mono hidden sm:block">
            {filtered.length} found
          </span>
        )}

        {canEdit && (
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-2 px-4 py-3 bg-black border border-white/10 hover:border-white/20 rounded text-sm transition-colors"
          >
            {allFilteredSelected
              ? <CheckSquare className="w-4 h-4 text-[#d4af37]" />
              : <Square className="w-4 h-4 text-white/30" />
            }
            <span className="text-white/40 hidden sm:inline">
              {allFilteredSelected ? 'Deselect All' : 'Select All'}
            </span>
          </button>
        )}

        {canEdit && selectedCount > 0 && (
          <button
            onClick={handleBulkSearchLyrics}
            disabled={searchingLyrics}
            className="flex items-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 disabled:opacity-40 rounded text-sm text-white/60 transition-colors"
          >
            {searchingLyrics ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span>
              {searchingLyrics && searchProgress
                ? `${searchProgress.done}/${searchProgress.total}`
                : `Search Lyrics (${selectedCount})`
              }
            </span>
          </button>
        )}

        {canEdit && songs.length > 0 && (
          confirmClear ? (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-900/20 border border-red-500/30 rounded text-sm">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-red-300 hidden sm:inline">Delete all {songs.length} songs?</span>
              <button onClick={handleClearLibrary} className="px-2 py-0.5 bg-red-500 hover:bg-red-600 rounded text-white text-xs font-medium">Yes</button>
              <button onClick={() => setConfirmClear(false)} className="px-2 py-0.5 bg-white/10 hover:bg-white/20 rounded text-white text-xs">No</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              className="flex items-center gap-2 px-4 py-3 bg-black border border-white/10 hover:border-red-500/40 hover:text-red-400 rounded text-sm text-white/20 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )
        )}
      </div>

      {/* ── Song grid ── */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-white/20">
            <Music2 className="w-16 h-16 opacity-20" />
            <p className="text-lg font-light tracking-wide text-white/30">
              {songs.length === 0
                ? 'No songs yet — sign in and upload to start'
                : query ? `No matches for "${query}"` : 'No results'
              }
            </p>
            {query && (
              <button onClick={() => setQuery('')} className="text-sm text-[#d4af37]/70 hover:text-[#d4af37]">
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-px pb-4 bg-white/5">
            {filtered.map(song => {
              const badge      = lyricsBadge(song);
              const isSelected = selectedIds.has(song.id);
              const inPlaylist = song.inPlaylist;
              const isBusy     = busyId === song.id;
              const isQueued   = queue.some(q => q.id === song.id);
              const justQueued = queuedFeedback === song.id;

              return (
                <div
                  key={song.id}
                  className={`bg-black transition-all group cursor-pointer relative overflow-hidden ${
                    justQueued
                      ? 'outline outline-2 outline-[#d4af37]'
                      : isSelected
                      ? 'outline outline-2 outline-[#d4af37]/60'
                      : isQueued && !canEdit
                      ? 'outline outline-1 outline-[#d4af37]/30'
                      : inPlaylist
                      ? 'hover:outline hover:outline-1 hover:outline-white/20'
                      : 'opacity-50 hover:opacity-70'
                  }`}
                  onClick={() => handleCardClick(song)}
                >
                  {canEdit && (
                    <button
                      onClick={e => { e.stopPropagation(); toggleSelect(song.id); }}
                      className="absolute top-2 left-2 z-10 p-1"
                    >
                      {isSelected
                        ? <CheckSquare className="w-4 h-4 text-[#d4af37]" />
                        : <Square className="w-4 h-4 text-white/30 opacity-0 group-hover:opacity-100 transition-opacity" />
                      }
                    </button>
                  )}

                  <div className="relative h-48 bg-black flex items-center justify-center overflow-hidden">
                    {song.coverArtUrl
                      ? <img src={song.coverArtUrl} alt={song.title} className="w-full h-full object-cover" />
                      : song.lyricsImageUrl
                      ? <img src={song.lyricsImageUrl} alt={song.title} className="w-full h-full object-contain p-1 opacity-70" />
                      : <span className="text-4xl opacity-10">♪</span>
                    }

                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className={`w-12 h-12 flex items-center justify-center shadow-lg ${
                        canEdit ? 'bg-white' : 'bg-[#d4af37]'
                      }`}>
                        {canEdit
                          ? <Play className="w-5 h-5 text-black ml-0.5" />
                          : isQueued
                          ? <span className="text-black text-xs font-bold">✓</span>
                          : <Plus className="w-5 h-5 text-black" />
                        }
                      </div>
                    </div>

                    <span className={`absolute bottom-2 left-2 text-[10px] px-2 py-0.5 font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>

                    {/* Patron queue indicator */}
                    {!canEdit && isQueued && (
                      <span className="absolute bottom-2 right-2 text-[10px] px-2 py-0.5 bg-[#d4af37]/20 text-[#d4af37] border border-[#d4af37]/40 font-medium">
                        Queued
                      </span>
                    )}

                    {/* Off-playlist indicator (editor view) */}
                    {canEdit && !inPlaylist && (
                      <span className="absolute bottom-2 right-2 text-[10px] px-2 py-0.5 bg-black text-white/20 border border-white/10">
                        off
                      </span>
                    )}

                    {canEdit && (
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        <button
                          onClick={e => { e.stopPropagation(); onEditSong(song); }}
                          className="p-1.5 bg-black/80 hover:bg-white/10 border border-transparent hover:border-white/20 rounded transition-colors"
                          title="Edit song info"
                        >
                          <Pencil className="w-3.5 h-3.5 text-white/40 hover:text-white" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleTogglePlaylist(song.id); }}
                          disabled={isBusy}
                          className={`p-1.5 rounded transition-colors border ${inPlaylist ? 'bg-black/80 hover:bg-white/10 border-transparent hover:border-white/20' : 'bg-[#d4af37]/20 border-[#d4af37]/40 hover:bg-[#d4af37]/30'}`}
                          title={inPlaylist ? 'Remove from playlist' : 'Add to playlist'}
                        >
                          {isBusy
                            ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                            : inPlaylist
                            ? <ListX className="w-3.5 h-3.5 text-white/40" />
                            : <ListMusic className="w-3.5 h-3.5 text-[#d4af37]" />
                          }
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDeleteSong(song.id); }}
                          disabled={isBusy}
                          className="p-1.5 bg-black/80 hover:bg-red-500/20 border border-transparent hover:border-red-500/40 rounded transition-colors"
                          title="Delete song"
                        >
                          {isBusy
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-white/40" />
                            : <Trash2 className="w-3.5 h-3.5 text-white/40" />
                          }
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-black">
                    <h3 className="font-semibold truncate text-sm text-white">
                      {song.trackNumber && (
                        <span className="font-mono text-[#d4af37]/50 mr-1.5 text-xs">{song.trackNumber}</span>
                      )}
                      {song.title}
                    </h3>
                    <p className="text-xs text-white/30 truncate mt-0.5">{song.artist}</p>
                    {justQueued && (
                      <p className="text-xs text-[#d4af37] mt-1 font-medium">Added to queue</p>
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
          onSearchOnline={id => onSearchLyrics([id])}
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
