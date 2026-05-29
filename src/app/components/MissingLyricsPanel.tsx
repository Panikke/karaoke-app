import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw, Pencil, Image, Loader2, CheckCircle } from 'lucide-react';
import type { Song } from '../App';
import type { LyricLine } from '../../utils/lrcParser';

interface MissingLyricsPanelProps {
  songs: Song[];
  onSearchOnline: (id: string) => Promise<void>;
  onManualEdit: (song: Song) => void;
  onAssignImage: (songId: string, file: File) => Promise<void>;
}

export function MissingLyricsPanel({ songs, onSearchOnline, onManualEdit, onAssignImage }: MissingLyricsPanelProps) {
  const [open, setOpen] = useState(true);
  const [searching, setSearching] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  if (songs.length === 0) return null;

  const handleSearch = async (id: string) => {
    setSearching(prev => new Set(prev).add(id));
    await onSearchOnline(id);
    setSearching(prev => { const n = new Set(prev); n.delete(id); return n; });
    setDone(prev => new Set(prev).add(id));
  };

  const handleFile = async (songId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await onAssignImage(songId, file);
    setDone(prev => new Set(prev).add(songId));
    e.target.value = '';
  };

  return (
    <div className="flex-shrink-0 border-t border-white/10 bg-black">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-semibold text-[#d4af37]">Missing Lyrics</span>
          <span className="text-xs px-2 py-0.5 bg-[#d4af37]/10 text-[#d4af37] border border-[#d4af37]/20">{songs.length}</span>
          <span className="text-xs text-white/20 hidden sm:inline">— click to search, add manually, or assign an image</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-white/30 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-white/30 flex-shrink-0" />}
      </button>

      {open && (
        <div className="overflow-y-auto max-h-64 px-3 pb-3" style={{ scrollbarWidth: 'thin' }}>
          <div className="space-y-1">
            {songs.map(song => {
              const isSearching = searching.has(song.id);
              const isDone      = done.has(song.id);
              return (
                <div key={song.id} className="flex items-center gap-3 bg-white/5 hover:bg-white/8 px-3 py-2 transition-colors">
                  {song.coverArtUrl
                    ? <img src={song.coverArtUrl} alt="" className="w-10 h-10 object-cover flex-shrink-0" />
                    : <div className="w-10 h-10 bg-white/10 flex items-center justify-center flex-shrink-0 text-base">♪</div>
                  }

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate text-white">{song.title}</p>
                    <p className="text-xs text-white/30 truncate">{song.artist}</p>
                  </div>

                  {isDone ? (
                    <CheckCircle className="w-5 h-5 text-[#d4af37] flex-shrink-0" />
                  ) : (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleSearch(song.id)}
                        disabled={isSearching}
                        title="Search for lyrics online"
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 disabled:bg-white/5 rounded text-xs text-[#d4af37] transition-colors"
                      >
                        {isSearching
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <RefreshCw className="w-3.5 h-3.5" />
                        }
                        <span>{isSearching ? 'Searching…' : 'Search'}</span>
                      </button>

                      <button
                        onClick={() => onManualEdit(song)}
                        title="Add lyrics manually"
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-xs text-white/50 hover:text-white transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Manual</span>
                      </button>

                      <button
                        onClick={() => fileRefs.current[song.id]?.click()}
                        title="Use a lyrics image"
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-xs text-white/50 hover:text-white transition-colors"
                      >
                        <Image className="w-3.5 h-3.5" />
                        <span>Image</span>
                      </button>
                      <input
                        ref={el => { fileRefs.current[song.id] = el; }}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => handleFile(song.id, e)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
