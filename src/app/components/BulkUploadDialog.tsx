import { useState, useRef, useCallback } from 'react';
import { X, FolderUp, CheckCircle, AlertCircle, Loader2, FileText, Music } from 'lucide-react';
import type { SongUploadPayload } from '../App';
import { searchLyrics } from '../../utils/lyricsApi';
import { parseLrc } from '../../utils/lrcParser';

interface BulkUploadDialogProps {
  onClose: () => void;
  onUpload: (songs: SongUploadPayload[], onProgress?: (done: number, total: number, filePct?: number) => void) => Promise<void>;
}

type LyricsStatus = 'pending' | 'searching' | 'found' | 'not-found' | 'manual' | 'file';

interface UploadItem {
  file: File;
  trackNumber?: string;   // preserved from filename, e.g. "001"
  title: string;
  artist: string;
  lyrics: string;
  syncedLyrics: import('../../utils/lrcParser').LyricLine[];
  lyricsSource: SongUploadPayload['lyricsSource'];
  lyricsImageFile?: File;
  status: LyricsStatus;
  editing: boolean;
}

function normalize(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

function leadingNumber(name: string) {
  return name.match(/^(\d+)/)?.[1] ?? null;
}

// Minimal ID3v2 tag reader — no external dependencies
async function readId3Tags(file: File): Promise<{ title?: string; artist?: string }> {
  try {
    const buf = await file.slice(0, 131072).arrayBuffer();
    const b = new Uint8Array(buf);
    if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return {};
    const v = b[3];
    const tagSize = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    const hasExtHeader = !!(b[5] & 0x40);
    let pos = 10;
    if (hasExtHeader) {
      const extSize = v === 4
        ? ((b[10] & 0x7f) << 21) | ((b[11] & 0x7f) << 14) | ((b[12] & 0x7f) << 7) | (b[13] & 0x7f)
        : (b[10] << 24) | (b[11] << 16) | (b[12] << 8) | b[13];
      pos += extSize;
    }
    const result: { title?: string; artist?: string } = {};
    while (pos + 10 < tagSize + 10 && pos + 10 < b.length) {
      const id = String.fromCharCode(b[pos], b[pos+1], b[pos+2], b[pos+3]);
      if (id === '\0\0\0\0') break;
      const fSize = v === 4
        ? ((b[pos+4] & 0x7f) << 21) | ((b[pos+5] & 0x7f) << 14) | ((b[pos+6] & 0x7f) << 7) | (b[pos+7] & 0x7f)
        : (b[pos+4] << 24) | (b[pos+5] << 16) | (b[pos+6] << 8) | b[pos+7];
      if (fSize <= 0 || fSize > 8192) { pos += 10 + Math.max(fSize, 0); continue; }
      if (id === 'TIT2' || id === 'TPE1') {
        const enc = b[pos + 10];
        const raw = b.slice(pos + 11, pos + 10 + fSize);
        let text = '';
        if (enc === 1 || enc === 2) {
          text = new TextDecoder('utf-16le').decode(raw[0] === 0xff ? raw.slice(2) : raw);
        } else {
          text = new TextDecoder(enc === 3 ? 'utf-8' : 'latin1').decode(raw);
        }
        text = text.replace(/\0/g, '').trim();
        if (id === 'TIT2') result.title = text;
        else result.artist = text;
        if (result.title && result.artist) break;
      }
      pos += 10 + fSize;
    }
    return result;
  } catch { return {}; }
}

function stripExt(name: string) {
  return name.replace(/\.[^/.]+$/, '');
}

/**
 * Parse a filename like "001_Title - Artist.wav" or "42 - Title - Artist.wav"
 * Returns { trackNumber, title, artist }.
 * Format: NUMBER[_\s\-\.]+Title - Artist
 *         or just Title - Artist (no number)
 */
function parseFilename(filename: string): { trackNumber?: string; title: string; artist: string } {
  const base = stripExt(filename);

  // Extract leading number prefix: digits followed by _ or spaces/dashes
  const numMatch = base.match(/^(\d+)[_\s\-\.]+(.+)$/);
  const trackNumber = numMatch ? numMatch[1] : undefined;
  const remainder = numMatch ? numMatch[2] : base;

  // Split "Title - Artist" on ` - ` or ` – `
  const parts = remainder.split(/\s[-–]\s/).map(p => p.trim());
  if (parts.length >= 2) {
    return {
      trackNumber,
      title: parts[0],
      artist: parts.slice(1).join(' - '),
    };
  }
  return { trackNumber, title: remainder, artist: 'Unknown Artist' };
}

async function readMetadata(file: File): Promise<{ trackNumber?: string; title: string; artist: string }> {
  const tags = await readId3Tags(file);
  if (tags.title) {
    // ID3 tags present — use them, but still try to get track number from filename
    const { trackNumber } = parseFilename(file.name);
    // Strip any embedded track numbers from ID3 title/artist fields
    const cleanTitle = tags.title.replace(/^\d+[\s_\-\.]+/, '').trim();
    const cleanArtist = (tags.artist || 'Unknown Artist').replace(/^\d+[\s_\-\.]+/, '').trim();
    return { trackNumber, title: cleanTitle, artist: cleanArtist };
  }
  // Fall back to filename parsing
  return parseFilename(file.name);
}

export function BulkUploadDialog({ onClose, onUpload }: BulkUploadDialogProps) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [lyricsFiles, setLyricsFiles] = useState<File[]>([]);
  const [language, setLanguage] = useState('Greek (Ελληνικά)');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number; filePct: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const lyricsRef = useRef<HTMLInputElement>(null);

  const handleAudioFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f =>
      /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f.name)
    );
    if (!files.length) return;
    setLoading(true);
    const draft: UploadItem[] = [];
    for (const file of files) {
      const { trackNumber, title, artist } = await readMetadata(file);
      draft.push({
        file, trackNumber, title, artist,
        lyrics: '', syncedLyrics: [], lyricsSource: 'none', status: 'pending', editing: false,
      });
    }
    // Sort by track number numerically if all have one
    if (draft.every(d => d.trackNumber)) {
      draft.sort((a, b) => parseInt(a.trackNumber!) - parseInt(b.trackNumber!));
    }
    setItems(draft);
    setLoading(false);
  }, []);

  const handleLyricsFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLyricsFiles(Array.from(e.target.files ?? []));
  }, []);

  const matchFromFiles = useCallback(async () => {
    if (!lyricsFiles.length) return;
    setLoading(true);
    setItems(prev => prev.map(item => {
      const audioNum = leadingNumber(item.file.name);
      const nameNorm = normalize(stripExt(item.file.name));
      const titleNorm = normalize(item.title);

      const match = lyricsFiles.find(lf => {
        const lfNum = leadingNumber(lf.name);
        if (audioNum && lfNum && audioNum === lfNum) return true;
        const lfNorm = normalize(stripExt(lf.name));
        return lfNorm.includes(titleNorm) || titleNorm.includes(lfNorm) || lfNorm === nameNorm;
      });

      if (!match) return item;
      if (/\.(jpg|jpeg|png|webp|gif)$/i.test(match.name)) {
        return { ...item, lyricsImageFile: match, status: 'file' as LyricsStatus };
      }
      return item;
    }));

    const updates: { idx: number; lyrics: string; synced: import('../../utils/lrcParser').LyricLine[]; source: SongUploadPayload['lyricsSource'] }[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const audioNum = leadingNumber(item.file.name);
      const nameNorm = normalize(stripExt(item.file.name));
      const titleNorm = normalize(item.title);
      const match = lyricsFiles.find(lf => {
        const lfNum = leadingNumber(lf.name);
        if (audioNum && lfNum && audioNum === lfNum) return true;
        const lfNorm = normalize(stripExt(lf.name));
        return lfNorm.includes(titleNorm) || titleNorm.includes(lfNorm) || lfNorm === nameNorm;
      });
      if (match && /\.(txt|lrc)$/i.test(match.name)) {
        const text = await match.text();
        const isLrc = /\[\d+:\d+\.\d+\]/.test(text);
        updates.push({
          idx: i,
          lyrics: isLrc ? text.replace(/\[\d+:\d+\.\d+\]\s*/g, '') : text,
          synced: isLrc ? parseLrc(text) : [],
          source: 'file',
        });
      }
    }
    if (updates.length) {
      setItems(prev => prev.map((item, i) => {
        const u = updates.find(u => u.idx === i);
        return u ? { ...item, lyrics: u.lyrics, syncedLyrics: u.synced, lyricsSource: u.source, status: 'file' as LyricsStatus } : item;
      }));
    }
    setLoading(false);
  }, [items, lyricsFiles]);

  const searchAll = useCallback(async () => {
    setLoading(true);
    const pending = items.map((item, i) => ({ item, i })).filter(({ item }) =>
      item.status === 'pending' || item.status === 'not-found'
    );

    setItems(prev => prev.map((item, i) =>
      pending.find(p => p.i === i) ? { ...item, status: 'searching' as LyricsStatus } : item
    ));

    await Promise.all(pending.map(async ({ item, i }) => {
      const result = await searchLyrics(item.title, item.artist);
      setItems(prev => prev.map((it, idx) =>
        idx === i
          ? result
            ? { ...it, lyrics: result.plain, syncedLyrics: result.synced, lyricsSource: 'api', status: 'found' as LyricsStatus }
            : { ...it, status: 'not-found' as LyricsStatus }
          : it
      ));
    }));
    setLoading(false);
  }, [items]);

  const setEditing = (i: number, editing: boolean) => {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, editing } : it));
  };

  const setManualLyrics = (i: number, lyrics: string) => {
    setItems(prev => prev.map((it, idx) =>
      idx === i ? { ...it, lyrics, lyricsSource: 'manual', status: lyrics.trim() ? 'manual' : 'not-found' as LyricsStatus } : it
    ));
  };

  const handleSubmit = async () => {
    if (!items.length) return;
    setSaving(true);
    setUploadError(null);
    setSaveProgress({ done: 0, total: items.length, filePct: 0 });
    const payloads: SongUploadPayload[] = items.map(it => ({
      trackNumber: it.trackNumber,
      title: it.title,
      artist: it.artist,
      language,
      lyrics: it.lyrics,
      syncedLyrics: it.syncedLyrics,
      lyricsSource: it.lyricsSource,
      audioFile: it.file,
      lyricsImageFile: it.lyricsImageFile,
    }));
    try {
      await onUpload(payloads, (done, total, filePct = 0) => setSaveProgress({ done, total, filePct }));
      onClose(); // all succeeded
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed — check that you are signed in and the server is reachable.';
      // If some songs were uploaded (partial success), close after showing the warning briefly
      if (msg.includes(' of ') && msg.includes('uploaded')) {
        setUploadError(msg);
        setSaving(false);
        setSaveProgress(null);
        // Close after 4 seconds so user can read the summary
        setTimeout(() => onClose(), 4000);
        return;
      }
      setUploadError(msg);
    } finally {
      setSaving(false);
      setSaveProgress(null);
    }
  };

  const statusIcon = (s: LyricsStatus) => {
    if (s === 'found' || s === 'file' || s === 'manual') return <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />;
    if (s === 'not-found') return <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0" />;
    if (s === 'searching') return <Loader2 className="w-5 h-5 text-blue-400 flex-shrink-0 animate-spin" />;
    return <Music className="w-5 h-5 text-gray-400 flex-shrink-0" />;
  };

  const statusLabel = (s: LyricsStatus) => ({
    pending: 'Pending',
    searching: 'Searching...',
    found: 'Found online',
    'not-found': 'Not found',
    manual: 'Manual',
    file: 'From file',
  }[s]);

  const readyCount = items.filter(it => it.lyrics.trim() || it.lyricsImageFile).length;
  const numberedCount = items.filter(it => it.trackNumber).length;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-white/20 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="border-b border-white/10 px-6 py-5 flex items-center justify-between flex-shrink-0">
          <h2 className="text-2xl font-bold">Bulk Upload Songs</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Step 1: Audio files */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-300 mb-2 font-medium">1. Audio Files (MP3 / WAV)</label>
              <input ref={audioRef} type="file" accept=".mp3,.wav,.ogg,.m4a,.flac,.aac,audio/*" multiple onChange={handleAudioFiles} className="hidden" />
              <button
                onClick={() => audioRef.current?.click()}
                className="w-full flex items-center justify-center gap-3 px-4 py-5 bg-black/30 border-2 border-dashed border-white/20 rounded-xl hover:border-blue-400 transition-colors"
              >
                <FolderUp className="w-6 h-6 text-blue-400" />
                <span className="text-gray-300">
                  {items.length ? `${items.length} audio files selected` : 'Select MP3 / WAV files'}
                </span>
              </button>
              {numberedCount > 0 && (
                <p className="mt-1.5 text-xs text-purple-300">
                  {numberedCount}/{items.length} files have track numbers — numbers will be shown before the title
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2 font-medium">2. Lyrics Files (optional — .txt / .lrc / images)</label>
              <input ref={lyricsRef} type="file" accept=".txt,.lrc,image/*" multiple onChange={handleLyricsFiles} className="hidden" />
              <button
                onClick={() => lyricsRef.current?.click()}
                className="w-full flex items-center justify-center gap-3 px-4 py-5 bg-black/30 border-2 border-dashed border-white/20 rounded-xl hover:border-purple-400 transition-colors"
              >
                <FileText className="w-6 h-6 text-purple-400" />
                <span className="text-gray-300">
                  {lyricsFiles.length ? `${lyricsFiles.length} lyrics files` : 'Select lyrics/image files'}
                </span>
              </button>
            </div>
          </div>

          {/* Language */}
          <div>
            <label className="block text-sm text-gray-300 mb-2 font-medium">Language for all songs</label>
            <select value={language} onChange={e => setLanguage(e.target.value)}
              className="px-4 py-2.5 bg-black/30 border border-white/20 rounded-lg text-white focus:outline-none focus:border-purple-500">
              {['Greek (Ελληνικά)','English','Spanish','French','German','Italian','Portuguese','Japanese','Korean','Mandarin'].map(l =>
                <option key={l} value={l}>{l}</option>
              )}
            </select>
          </div>

          {items.length > 0 && (
            <>
              {/* Action buttons */}
              <div className="flex gap-3 flex-wrap">
                {lyricsFiles.length > 0 && (
                  <button onClick={matchFromFiles} disabled={loading}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    Match from Files
                  </button>
                )}
                <button onClick={searchAll} disabled={loading}
                  className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded-lg text-sm font-medium transition-colors flex items-center gap-2">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Auto-Search Lyrics Online
                </button>
                <span className="ml-auto self-center text-sm text-gray-400">
                  {readyCount}/{items.length} songs ready
                </span>
              </div>

              {/* Song list */}
              <div className="space-y-2">
                {items.map((item, i) => (
                  <div key={i} className="bg-black/30 border border-white/10 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      {statusIcon(item.status)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="font-medium truncate">
                            {item.trackNumber && (
                              <span className="font-mono text-purple-300 mr-1">{item.trackNumber}</span>
                            )}
                            {item.title}
                          </span>
                          <span className="text-xs px-2 py-0.5 bg-white/10 rounded-full text-gray-400 flex-shrink-0">{statusLabel(item.status)}</span>
                          {item.syncedLyrics.length > 0 && <span className="text-xs px-2 py-0.5 bg-pink-500/20 text-pink-300 rounded-full flex-shrink-0">Synced</span>}
                        </div>
                        <p className="text-sm text-gray-400">{item.artist} · <span className="text-gray-500">{item.file.name}</span></p>

                        {item.lyricsImageFile && (
                          <p className="text-xs text-emerald-400 mt-1">🖼 Image: {item.lyricsImageFile.name}</p>
                        )}

                        {item.lyrics && !item.editing && (
                          <div className="mt-2 text-xs text-gray-500 bg-black/20 rounded p-2 max-h-16 overflow-hidden">
                            {item.lyrics.split('\n').slice(0, 3).join('\n')}
                          </div>
                        )}

                        {(item.status === 'not-found' || item.status === 'pending' || item.editing) && (
                          <textarea
                            className="mt-2 w-full px-3 py-2 bg-black/30 border border-white/20 rounded text-sm text-white focus:outline-none focus:border-purple-500 min-h-[60px]"
                            placeholder="Paste lyrics manually..."
                            value={item.lyrics}
                            onChange={e => setManualLyrics(i, e.target.value)}
                          />
                        )}

                        {item.lyrics && (
                          <button onClick={() => setEditing(i, !item.editing)} className="mt-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                            {item.editing ? 'Done editing' : 'Edit lyrics'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 px-6 py-4 flex flex-col gap-3 flex-shrink-0">
          {uploadError && (
            <div className="flex items-start gap-2 px-4 py-3 bg-red-900/40 border border-red-500/50 rounded-xl text-sm text-red-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{uploadError}</span>
            </div>
          )}
          <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
            Cancel
          </button>
          {saving && saveProgress ? (
            /* ── Upload progress bar ── */
            <div className="flex-1 flex flex-col gap-2">
              {(() => {
                const overallPct = Math.round(
                  ((saveProgress.done + saveProgress.filePct / 100) / saveProgress.total) * 100
                );
                return (
                  <>
                    <div className="flex justify-between text-xs text-gray-300 px-1">
                      <span>
                        Uploading song {Math.min(saveProgress.done + 1, saveProgress.total)} of {saveProgress.total}
                      </span>
                      <span className="font-mono font-bold text-pink-300">{overallPct}%</span>
                    </div>
                    <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-pink-500 to-purple-500 rounded-full transition-all duration-150"
                        style={{ width: `${overallPct}%` }}
                      />
                    </div>
                    <p className="text-xs text-center text-gray-500">
                      {saveProgress.done} of {saveProgress.total} saved
                      {saveProgress.filePct > 0 && saveProgress.filePct < 100
                        ? ` · current file ${saveProgress.filePct}%`
                        : ''}
                    </p>
                  </>
                );
              })()}
            </div>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={saving || items.length === 0}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed rounded-lg transition-all font-medium flex items-center justify-center gap-2"
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Preparing…</>
                : `Add ${items.length} Song${items.length !== 1 ? 's' : ''} to Library`
              }
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
