import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Image, Loader2, CheckCircle, Pencil } from 'lucide-react';
import type { Song } from '../App';
import type { LyricLine } from '../../utils/lrcParser';

interface MissingLyricsPanelProps {
  songs: Song[];
  onManualEdit: (song: Song) => void;
  onAssignImage: (songId: string, file: File) => Promise<void>;
}

export function MissingLyricsPanel({ songs, onManualEdit, onAssignImage }: MissingLyricsPanelProps) {
  const [open, setOpen]   = useState(true);
  const [done, setDone]   = useState<Set<string>>(new Set());
  const [busy, setBusy]   = useState<Set<string>>(new Set());
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  if (songs.length === 0) return null;

  const handleFile = async (songId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(prev => new Set(prev).add(songId));
    await onAssignImage(songId, file);
    setBusy(prev => { const n = new Set(prev); n.delete(songId); return n; });
    setDone(prev => new Set(prev).add(songId));
    e.target.value = '';
  };

  return (
    <div className="flex-shrink-0 border-t border-slate-700 bg-slate-800">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-700/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-semibold text-orange-400">Missing Lyrics Image</span>
          <span className="text-xs px-2 py-0.5 bg-orange-500/15 text-orange-400 border border-orange-500/30 rounded-full">{songs.length}</span>
          <span className="text-xs text-slate-500 hidden sm:inline">— upload a screenshot for each song</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />}
      </button>

      {open && (
        <div className="overflow-y-auto max-h-64 px-3 pb-3" style={{ scrollbarWidth: 'thin' }}>
          <div className="space-y-1">
            {songs.map(song => {
              const isDone    = done.has(song.id);
              const isBusy    = busy.has(song.id);
              return (
                <div key={song.id} className="flex items-center gap-3 bg-slate-700/40 hover:bg-slate-700/60 rounded-xl px-3 py-2 transition-colors">
                  {song.coverArtUrl
                    ? <img src={song.coverArtUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                    : <div className="w-10 h-10 rounded-lg bg-slate-600 flex items-center justify-center flex-shrink-0 text-base">♪</div>
                  }

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate text-white">{song.title}</p>
                    <p className="text-xs text-slate-400 truncate">{song.artist}</p>
                  </div>

                  {isDone ? (
                    <CheckCircle className="w-5 h-5 text-orange-400 flex-shrink-0" />
                  ) : (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => fileRefs.current[song.id]?.click()}
                        disabled={isBusy}
                        title="Upload lyrics screenshot"
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/40 disabled:opacity-50 rounded-lg text-xs text-orange-400 transition-colors"
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Image className="w-3.5 h-3.5" />}
                        <span>{isBusy ? 'Uploading…' : 'Upload Image'}</span>
                      </button>
                      <button
                        onClick={() => onManualEdit(song)}
                        title="Add lyrics text manually"
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg text-xs text-slate-300 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Manual</span>
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
