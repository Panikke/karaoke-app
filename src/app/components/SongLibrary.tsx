import { useState, useMemo } from 'react';
import Fuse from 'fuse.js';
import {
  Search, Play, Trash2, Music2, Pencil, ListMusic, ListX,
  CheckSquare, Square, RefreshCw, Loader2, AlertTriangle,
} from 'lucide-react';
import type { Song } from '../App';
import { MissingLyricsPanel } from './MissingLyricsPanel';
import { ManualLyricsDialog } from './ManualLyricsDialog';
import type { LyricLine } from '../../utils/lrcParser';

interface SongLibraryProps {
  songs: Song[];
  canEdit: boolean;
  onSelectSong:        (song: Song) => void;
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
  if (song.lyrics.trim())           return { label: 'Lyrics', cls: 'bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/20' };
  if (song.lyricsImageUrl)          return { label: 'Image',  cls: 'bg-[#a855f7]/10 text-[#a855f7] border border-[#a855f7]/20' };
  return { label: 'No lyrics', cls: 'bg-[#333]/60 text-[#666] border border-[#333]' };
};

export function SongLibrary({
  songs, canEdit, onSelectSong, onDeleteSong, onEditSong,
  onTogglePlaylist, onSearchLyrics, onClearLibrary, onUpdateLyrics, onAssignLyricsImage,
}: SongLibraryProps) {
  const [query, setQuery]             = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchingLyrics, setSearchingLyrics] = useState(false);
  const [searchProgress, setSearchProgress]   = useState<{ done: number; total: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [manualSong, setManualSong]     = useState<Song | null>(null);
  const [busyId, setBusyId]             = useState<string | null>(null);

  const missingSongs = songs.filter(s => s.syncedLyrics.length === 0 && !s.lyrics.trim() && !s.lyricsImageUrl);

  // ── Fuse.js fuzzy search ──────────────────────────────────────────────────
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

  const selectedCount = Array.from(selectedIds).filter(id => filtered.some(s => s.id === id)).length;

  return (
    <div className="flex-1 overflow-hidden flex flex-col p-4 gap-3 bg-[#080808]">

      {/* ── Search + bulk action bar ── */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#444] pointer-events-none" />
          <input
            type="text"
            placeholder="Search songs, artists, track numbers…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-[#111] border border-[#222] rounded-xl text-white placeholder-[#444] focus:outline-none focus:border-[#ff2d78]/50 transition-colors text-sm"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#444] hover:text-white text-lg leading-none"
            >×</button>
          )}
        </div>

        {query && filtered.length > 0 && (
          <span className="text-xs text-[#444] font-mono hidden sm:block">
            {filtered.length} found
          </span>
        )}

        {canEdit && (
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-2 px-4 py-3 bg-[#111] border border-[#222] hover:border-[#ff2d78]/40 rounded-xl text-sm transition-colors"
          >
            {allFilteredSelected
              ? <CheckSquare className="w-4 h-4 text-[#ff2d78]" />
              : <Square className="w-4 h-4 text-[#555]" />
            }
            <span className="text-[#888] hidden sm:inline">
              {allFilteredSelected ? 'Deselect All' : 'Select All'}
            </span>
          </button>
        )}

        {canEdit && selectedCount > 0 && (
          <button
            onClick={handleBulkSearchLyrics}
            disabled={searchingLyrics}
            className="flex items-center gap-2 px-4 py-3 bg-[#ff2d78]/10 hover:bg-[#ff2d78]/20 border border-[#ff2d78]/30 hover:border-[#ff2d78]/60 disabled:opacity-40 rounded-xl text-sm text-[#ff2d78] transition-colors"
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
            <div className="flex items-center gap-2 px-4 py-3 bg-red-900/20 border border-red-500/30 rounded-xl text-sm">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-red-300 hidden sm:inline">Delete all {songs.length} songs?</span>
              <button onClick={handleClearLibrary} className="px-2 py-0.5 bg-red-500 hover:bg-red-600 rounded text-white text-xs font-medium">Yes</button>
              <button onClick={() => setConfirmClear(false)} className="px-2 py-0.5 bg-[#222] hover:bg-[#333] rounded text-white text-xs">No</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              className="flex items-center gap-2 px-4 py-3 bg-[#111] border border-[#222] hover:border-red-500/40 hover:text-red-400 rounded-xl text-sm text-[#444] transition-colors"
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
          <div className="h-full flex flex-col items-center justify-center gap-4 text-[#333]">
            <Music2 className="w-16 h-16 opacity-20" />
            <p className="text-lg font-light tracking-wide text-[#555]">
              {songs.length === 0
                ? 'No songs yet — sign in and upload to start'
                : query ? `No matches for "${query}"` : 'No results'
              }
            </p>
            {query && (
              <button onClick={() => setQuery('')} className="text-sm text-[#ff2d78]/70 hover:text-[#ff2d78]">
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-4">
            {filtered.map(song => {
              const badge      = lyricsBadge(song);
              const isSelected = selectedIds.has(song.id);
              const inPlaylist = song.inPlaylist;
              const isBusy     = busyId === song.id;

              return (
                <div
                  key={song.id}
                  className={`bg-[#0f0f0f] border rounded-xl transition-all group cursor-pointer relative overflow-hidden ${
                    isSelected
                      ? 'border-[#ff2d78]/60 shadow-[0_0_20px_rgba(255,45,120,0.1)]'
                      : inPlaylist
                      ? 'border-[#1f1f1f] hover:border-[#ff2d78]/30 hover:shadow-[0_0_20px_rgba(255,45,120,0.07)]'
                      : 'border-[#1a1a1a] opacity-50 hover:opacity-70 hover:border-[#2a2a2a]'
                  }`}
                  onClick={() => onSelectSong(song)}
                >
                  {canEdit && (
                    <button
                      onClick={e => { e.stopPropagation(); toggleSelect(song.id); }}
                      className="absolute top-2 left-2 z-10 p-1"
                    >
                      {isSelected
                        ? <CheckSquare className="w-4 h-4 text-[#ff2d78]" />
                        : <Square className="w-4 h-4 text-[#444] opacity-0 group-hover:opacity-100 transition-opacity" />
                      }
                    </button>
                  )}

                  <div className="relative h-40 bg-[#0a0a0a] flex items-center justify-center overflow-hidden">
                    {song.coverArtUrl
                      ? <img src={song.coverArtUrl} alt={song.title} className="w-full h-full object-cover" />
                      : song.lyricsImageUrl
                      ? <img src={song.lyricsImageUrl} alt={song.title} className="w-full h-full object-contain p-1 opacity-70" />
                      : <span className="text-4xl opacity-10">♪</span>
                    }

                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="w-12 h-12 bg-[#ff2d78] rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(255,45,120,0.5)]">
                        <Play className="w-5 h-5 text-white ml-0.5" />
                      </div>
                    </div>

                    <span className={`absolute bottom-2 left-2 text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>

                    {!inPlaylist && (
                      <span className="absolute bottom-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-[#111] text-[#444] border border-[#222]">
                        off
                      </span>
                    )}

                    {canEdit && (
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        <button
                          onClick={e => { e.stopPropagation(); onEditSong(song); }}
                          className="p-1.5 bg-black/80 hover:bg-[#00d4ff]/20 border border-transparent hover:border-[#00d4ff]/40 rounded-lg transition-colors"
                          title="Edit song info"
                        >
                          <Pencil className="w-3.5 h-3.5 text-[#888] hover:text-[#00d4ff]" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleTogglePlaylist(song.id); }}
                          disabled={isBusy}
                          className={`p-1.5 rounded-lg transition-colors border ${inPlaylist ? 'bg-black/80 hover:bg-yellow-500/20 border-transparent hover:border-yellow-500/40' : 'bg-[#00ff88]/20 border-[#00ff88]/30 hover:bg-[#00ff88]/30'}`}
                          title={inPlaylist ? 'Remove from playlist' : 'Add to playlist'}
                        >
                          {isBusy
                            ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                            : inPlaylist
                            ? <ListX className="w-3.5 h-3.5 text-[#888]" />
                            : <ListMusic className="w-3.5 h-3.5 text-[#00ff88]" />
                          }
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDeleteSong(song.id); }}
                          disabled={isBusy}
                          className="p-1.5 bg-black/80 hover:bg-red-500/20 border border-transparent hover:border-red-500/40 rounded-lg transition-colors"
                          title="Delete song"
                        >
                          {isBusy
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[#888]" />
                            : <Trash2 className="w-3.5 h-3.5 text-[#888]" />
                          }
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="p-3">
                    <h3 className="font-semibold truncate text-sm text-white">
                      {song.trackNumber && (
                        <span className="font-mono text-[#ff2d78]/60 mr-1.5 text-xs">{song.trackNumber}</span>
                      )}
                      {song.title}
                    </h3>
                    <p className="text-xs text-[#555] truncate mt-0.5">{song.artist}</p>
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
