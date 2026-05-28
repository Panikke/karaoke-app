import { useState, useRef, useCallback } from 'react';
import { X, Images, CheckCircle, AlertCircle, Link2 } from 'lucide-react';
import type { Song } from '../App';

interface BulkImageDialogProps {
  songs: Song[];
  onClose: () => void;
  onApply: (songId: string, imageFile: File) => Promise<void>;
  mode?: 'cover' | 'lyrics';
}

const SKIP = '__skip__';

interface ImageMatch {
  file: File;
  previewUrl: string;
  matchedSongId: string | null;
  manualSongId: string | null;
}

function normalize(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

function stripExt(name: string) {
  return name.replace(/\.[^/.]+$/, '');
}

function leadingNumber(name: string) {
  return name.match(/^(\d+)/)?.[1] ?? null;
}

function normalizeNum(s: string | null | undefined): string | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : String(n);
}

// Number embedded in the filename (leading digits)
function fNum(file: File): string | null {
  return normalizeNum(leadingNumber(stripExt(file.name)));
}

// Text after stripping the leading number — used to match title / artist
function fText(file: File): string {
  return normalize(stripExt(file.name)).replace(/^\d+\s*/, '').trim();
}

/**
 * Multi-pass matching: most-specific criteria run first so the file that
 * matches on more criteria (number+title+artist) always beats one that
 * only matches on fewer (number alone). Each pass assigns unclaimed
 * files to unclaimed songs.
 */
function matchAll(files: File[], songs: Song[]): Array<string | null> {
  const result = new Array<string | null>(files.length).fill(null);
  const usedSongs = new Set<string>();

  function pass(test: (f: File, s: Song) => boolean) {
    for (let i = 0; i < files.length; i++) {
      if (result[i] !== null) continue;
      for (const s of songs) {
        if (usedSongs.has(s.id)) continue;
        if (test(files[i], s)) { result[i] = s.id; usedSongs.add(s.id); break; }
      }
    }
  }

  // Pass 1 — number + title + artist (most specific)
  pass((f, s) => {
    const n = fNum(f), t = fText(f);
    if (!n || !t) return false;
    const nt = normalize(s.title), na = normalize(s.artist);
    return normalizeNum(s.trackNumber) === n
      && (nt.includes(t) || t.includes(nt))
      && t.includes(na);
  });

  // Pass 2 — number + title
  pass((f, s) => {
    const n = fNum(f), t = fText(f);
    if (!n || !t) return false;
    const nt = normalize(s.title);
    return normalizeNum(s.trackNumber) === n && (nt.includes(t) || t.includes(nt));
  });

  // Pass 3 — number + artist
  pass((f, s) => {
    const n = fNum(f), t = fText(f);
    if (!n || !t) return false;
    return normalizeNum(s.trackNumber) === n && normalize(s.artist).includes(t);
  });

  // Pass 4 — number only
  pass((f, s) => {
    const n = fNum(f);
    return !!n && normalizeNum(s.trackNumber) === n;
  });

  // Pass 5 — leading number in song title / artist field
  pass((f, s) => {
    const n = fNum(f);
    if (!n) return false;
    const sn = normalizeNum(leadingNumber(s.title)) ?? normalizeNum(leadingNumber(s.artist));
    return sn === n;
  });

  // Pass 6 — exact title (whole filename)
  pass((f, s) => normalize(stripExt(f.name)) === normalize(s.title));

  // Pass 7 — substring title / artist
  pass((f, s) => {
    const fn = normalize(stripExt(f.name));
    const nt = normalize(s.title), na = normalize(s.artist);
    return fn.includes(nt) || nt.includes(fn) || fn.includes(na);
  });

  return result;
}

export function BulkImageDialog({ songs, onClose, onApply, mode = 'cover' }: BulkImageDialogProps) {
  const [matches, setMatches] = useState<ImageMatch[]>([]);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f =>
      /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(f.name)
    );
    const songIds = matchAll(files, songs);
    const newMatches: ImageMatch[] = files.map((file, i) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      matchedSongId: songIds[i],
      manualSongId: null,
    }));
    setMatches(newMatches);
  }, [songs]);

  const setManual = (i: number, songId: string) => {
    setMatches(prev => prev.map((m, idx) =>
      idx === i ? { ...m, manualSongId: songId || null } : m,
    ));
  };

  // SKIP sentinel overrides the auto-match; empty string clears manual override only
  const effectiveSongId = (m: ImageMatch) =>
    m.manualSongId === SKIP ? null : (m.manualSongId ?? m.matchedSongId);

  const handleApply = async () => {
    setSaving(true);
    // Deduplicate: last assignment for each song wins
    const seen = new Map<string, ImageMatch>();
    for (const m of matches) {
      const id = effectiveSongId(m);
      if (id) seen.set(id, m);
    }
    const toApply = Array.from(seen.values());
    for (const m of toApply) {
      await onApply(effectiveSongId(m)!, m.file);
    }
    setSaving(false);
    onClose();
  };

  const matchCount = matches.filter(m => effectiveSongId(m)).length;

  // Songs assigned to more than one image — highlight as conflicts
  const songIdCount = new Map<string, number>();
  matches.forEach(m => { const id = effectiveSongId(m); if (id) songIdCount.set(id, (songIdCount.get(id) ?? 0) + 1); });
  const conflictSongIds = new Set([...songIdCount.entries()].filter(([, c]) => c > 1).map(([id]) => id));

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-white/20 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        <div className="border-b border-white/10 px-6 py-5 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-2xl font-bold">{mode === 'lyrics' ? 'Bulk Add Lyrics Images' : 'Bulk Add Cover Images'}</h2>
            <p className="text-sm text-gray-400 mt-1">
              {mode === 'lyrics'
                ? 'Upload lyrics screenshots — matched to songs by track number (e.g. 042.jpg → track 42)'
                : 'Upload JPEG / PNG files — automatically matched to songs by filename'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* File picker */}
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.gif,.svg,image/*"
            multiple
            onChange={handleFiles}
            className="hidden"
          />
          <button
            onClick={() => inputRef.current?.click()}
            className="w-full flex items-center justify-center gap-3 px-4 py-5 bg-black/30 border-2 border-dashed border-white/20 rounded-xl hover:border-emerald-400 transition-colors"
          >
            <Images className="w-6 h-6 text-emerald-400" />
            <span className="text-gray-300">
              {matches.length ? `${matches.length} images selected — click to change` : 'Select JPEG / PNG / WebP images'}
            </span>
          </button>

          {matches.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">
                {matchCount} of {matches.length} images matched to songs.
                {matchCount < matches.length && ' Use the dropdowns to assign unmatched ones manually.'}
              </p>

              {matches.map((m, i) => {
                const resolved = effectiveSongId(m);
                const song = songs.find(s => s.id === resolved);
                const isSkipped = m.manualSongId === SKIP;
                const isConflict = !!resolved && conflictSongIds.has(resolved);
                const dropdownValue = isSkipped ? SKIP : (m.manualSongId ?? m.matchedSongId ?? '');
                return (
                  <div key={i} className={`flex items-center gap-4 border rounded-xl p-3 transition-colors ${
                    isSkipped ? 'bg-black/20 border-white/5 opacity-50'
                    : isConflict ? 'bg-yellow-900/20 border-yellow-500/30'
                    : 'bg-black/30 border-white/10'
                  }`}>
                    <img src={m.previewUrl} alt={m.file.name} className="w-14 h-14 object-cover rounded-lg flex-shrink-0" />

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.file.name}</p>
                      {isSkipped ? (
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-xs text-gray-500">Skipped — will not be applied</span>
                        </div>
                      ) : resolved ? (
                        <div className="flex items-center gap-1.5 mt-1">
                          <CheckCircle className={`w-3.5 h-3.5 flex-shrink-0 ${isConflict ? 'text-yellow-400' : 'text-green-400'}`} />
                          <span className={`text-xs truncate ${isConflict ? 'text-yellow-400' : 'text-green-400'}`}>→ {song?.title} – {song?.artist}</span>
                          {m.matchedSongId && !m.manualSongId && <span className="text-xs text-gray-500">(auto)</span>}
                          {isConflict && <span className="text-xs text-yellow-500 font-medium">duplicate — last wins</span>}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 mt-1">
                          <AlertCircle className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
                          <span className="text-xs text-yellow-400">No match — assign manually or skip</span>
                        </div>
                      )}
                    </div>

                    {/* Manual assignment / skip */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Link2 className="w-4 h-4 text-gray-500" />
                      <select
                        value={dropdownValue}
                        onChange={e => setManual(i, e.target.value)}
                        className="text-sm px-3 py-1.5 bg-black/40 border border-white/20 rounded-lg text-white focus:outline-none focus:border-purple-500 max-w-[200px]"
                      >
                        <option value="">— assign to song —</option>
                        <option value={SKIP}>✕ Skip this image</option>
                        {songs.map(s => (
                          <option key={s.id} value={s.id}>{s.title} – {s.artist}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {songs.length === 0 && (
            <p className="text-center text-gray-400 py-8">Upload some songs first before adding cover images.</p>
          )}
        </div>

        <div className="border-t border-white/10 px-6 py-4 flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="flex-1 px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={saving || matchCount === 0}
            className="flex-1 px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed rounded-lg transition-all font-medium"
          >
            {saving ? 'Saving...' : `Apply ${matchCount} Image${matchCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
