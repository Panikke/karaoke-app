import { useState, useRef, useMemo } from 'react';
import { X, Save, Image, Trash2, Search, ExternalLink, Sparkles, Clock } from 'lucide-react';
import type { Song } from '../App';
import { parseLrc, type LyricLine } from '../../utils/lrcParser';

interface EditSongDialogProps {
  song: Song;
  onClose: () => void;
  onSave: (id: string, patch: { title: string; artist: string; language: string }) => Promise<void>;
  onAssignLyricsImage: (songId: string, file: File) => Promise<void>;
  onUpdateLyrics: (
    songId: string,
    lyrics: string,
    syncedLyrics: LyricLine[],
    source: Song['lyricsSource'],
  ) => Promise<void>;
}

const LANGUAGES = [
  'Greek (Ελληνικά)', 'English', 'Spanish', 'Italian', 'French',
  'Portuguese', 'German', 'Arabic', 'Turkish', 'Other',
];

const LRC_TIMESTAMP_RE = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/;

// Basic Greek → Latin transliteration for search fallback
function transliterateGreek(input: string): string {
  const map: Record<string, string> = {
    'α':'a','β':'v','γ':'g','δ':'d','ε':'e','ζ':'z','η':'i','θ':'th','ι':'i',
    'κ':'k','λ':'l','μ':'m','ν':'n','ξ':'x','ο':'o','π':'p','ρ':'r','σ':'s','ς':'s',
    'τ':'t','υ':'y','φ':'f','χ':'ch','ψ':'ps','ω':'o',
    'ά':'a','έ':'e','ή':'i','ί':'i','ό':'o','ύ':'y','ώ':'o','ϊ':'i','ϋ':'y','ΐ':'i','ΰ':'y',
  };
  return input.toLowerCase().split('').map(c => map[c] ?? c).join('');
}

function isLatin(input: string): boolean {
  return /^[\p{Script=Latin}\s\d\p{P}]*$/u.test(input);
}

export function EditSongDialog({
  song,
  onClose,
  onSave,
  onAssignLyricsImage,
  onUpdateLyrics,
}: EditSongDialogProps) {
  const [title, setTitle]       = useState(song.title);
  const [artist, setArtist]     = useState(song.artist);
  const [language, setLanguage] = useState(song.language);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Lyrics text state
  const [lyrics, setLyrics]                 = useState(song.lyrics ?? '');
  const [syncedLyrics, setSyncedLyrics]     = useState<LyricLine[]>(song.syncedLyrics ?? []);
  const [lyricsSource, setLyricsSource]     = useState<Song['lyricsSource']>(song.lyricsSource);
  const [lrcDetected, setLrcDetected]       = useState(false);

  // Lyrics image state
  const [newImageFile, setNewImageFile]       = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // ── Lyrics search URLs ────────────────────────────────────────────────────
  // Build search queries — for Greek titles, we also include a transliterated
  // version which is often how Google's lyrics panel surfaces results.
  const googleSearchUrl = useMemo(() => {
    const t = title.trim();
    const a = artist.trim();
    const queries = [`lyrics: ${t} ${a}`];
    if (!isLatin(t)) queries.push(`lyrics ${transliterateGreek(t)} ${transliterateGreek(a)}`);
    return `https://www.google.com/search?q=${encodeURIComponent(queries[0])}`;
  }, [title, artist]);

  const stixoiSearchUrl = useMemo(() => {
    // Stixoi.info site search via Google (their internal search is awkward)
    const q = `site:stixoi.info ${title.trim()} ${artist.trim()}`;
    return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  }, [title, artist]);

  // ── Lyrics paste / change handler with LRC auto-detect ────────────────────
  const onLyricsChange = (value: string) => {
    setLyrics(value);
    // Detect LRC-format timestamps
    if (LRC_TIMESTAMP_RE.test(value)) {
      setLrcDetected(true);
    } else {
      setLrcDetected(false);
      // Reset synced if user has cleared timestamps
      if (syncedLyrics.length > 0 && !LRC_TIMESTAMP_RE.test(value)) {
        setSyncedLyrics([]);
      }
    }
  };

  const applyLrcParse = () => {
    const parsed = parseLrc(lyrics);
    if (parsed.length === 0) return;
    setSyncedLyrics(parsed);
    // Strip timestamps from the plain text version
    const plain = lyrics
      .replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]\s*/g, '')
      .trim();
    setLyrics(plain);
    setLyricsSource('manual');
    setLrcDetected(false);
  };

  // ── Image handlers ────────────────────────────────────────────────────────
  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNewImageFile(file);
    setNewImagePreview(URL.createObjectURL(file));
  };

  const clearNewImage = () => {
    if (newImagePreview) URL.revokeObjectURL(newImagePreview);
    setNewImageFile(null);
    setNewImagePreview(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Metadata
      const patch = { title: title.trim(), artist: artist.trim(), language };
      const metaChanged =
        patch.title !== song.title ||
        patch.artist !== song.artist ||
        patch.language !== song.language;
      if (metaChanged) {
        await onSave(song.id, patch);
      }

      // Lyrics
      const lyricsChanged =
        lyrics !== (song.lyrics ?? '') ||
        JSON.stringify(syncedLyrics) !== JSON.stringify(song.syncedLyrics ?? []);
      if (lyricsChanged) {
        const newSource: Song['lyricsSource'] =
          lyrics.trim() === '' ? 'none' : (lyricsSource === 'none' ? 'manual' : lyricsSource);
        await onUpdateLyrics(song.id, lyrics, syncedLyrics, newSource);
      }

      // Image
      if (newImageFile) {
        await onAssignLyricsImage(song.id, newImageFile);
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-4 py-3 bg-black/30 border border-white/20 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500';

  const displayImage = newImagePreview ?? song.lyricsImageUrl ?? null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-white/20 rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10 flex-shrink-0">
          <h2 className="text-xl font-bold">Edit Song</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {/* ── Metadata ── */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Title</label>
              <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="Song title" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Artist</label>
              <input value={artist} onChange={e => setArtist(e.target.value)} className={inputCls} placeholder="Artist name" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Language</label>
            <select value={language} onChange={e => setLanguage(e.target.value)} className={`${inputCls} cursor-pointer`}>
              {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
              {!LANGUAGES.includes(language) && <option value={language}>{language}</option>}
            </select>
          </div>

          {/* ── Lyrics ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-sm text-gray-400">Lyrics</label>
              <div className="flex items-center gap-2">
                {syncedLyrics.length > 0 && (
                  <span className="text-xs px-2 py-0.5 bg-pink-500/20 text-pink-300 rounded-full flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Synced ({syncedLyrics.length} lines)
                  </span>
                )}
                <span className="text-xs text-gray-500 italic">Source: {lyricsSource}</span>
              </div>
            </div>

            {/* Search buttons */}
            <div className="grid grid-cols-2 gap-2">
              <a
                href={googleSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-600/30 hover:bg-blue-600/50 border border-blue-500/40 rounded-lg text-sm transition-colors"
                title={`Open Google search: lyrics: ${title} ${artist}`}
              >
                <Search className="w-4 h-4" />
                <span>Search on Google</span>
                <ExternalLink className="w-3 h-3 opacity-60" />
              </a>
              <a
                href={stixoiSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-3 py-2 bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/40 rounded-lg text-sm transition-colors"
                title="Open Google search restricted to Stixoi.info (Greek lyrics)"
              >
                <Search className="w-4 h-4" />
                <span>Search on Stixoi.info</span>
                <ExternalLink className="w-3 h-3 opacity-60" />
              </a>
            </div>

            <p className="text-xs text-gray-500">
              Open one, copy the lyrics you want, paste them into the box below.
              If they have timestamps like <code className="bg-black/40 px-1 rounded">[01:23.45]</code>, I'll offer to use them as synced lyrics.
            </p>

            <textarea
              value={lyrics}
              onChange={e => onLyricsChange(e.target.value)}
              className={`${inputCls} min-h-[180px] resize-y font-mono text-sm leading-relaxed`}
              placeholder="Paste lyrics here, or leave empty if you only want to attach an image…"
              spellCheck={false}
            />

            {/* LRC auto-detect prompt */}
            {lrcDetected && (
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-purple-900/40 border border-purple-500/50 rounded-lg text-sm">
                <div className="flex items-center gap-2 text-purple-200">
                  <Sparkles className="w-4 h-4 flex-shrink-0" />
                  <span>LRC timestamps detected — convert to synced lyrics?</span>
                </div>
                <button
                  onClick={applyLrcParse}
                  className="px-3 py-1 bg-purple-600 hover:bg-purple-500 rounded-md text-xs font-medium transition-colors flex-shrink-0"
                >
                  Convert
                </button>
              </div>
            )}
          </div>

          {/* ── Lyrics Image ── */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Lyrics Image (optional)</label>

            {displayImage ? (
              <div className="relative rounded-xl overflow-hidden border border-white/10">
                <img src={displayImage} alt="Lyrics" className="w-full max-h-40 object-contain bg-black/40" />
                <div className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-2 bg-blue-600/80 hover:bg-blue-500 rounded-lg text-sm transition-colors"
                  >
                    <Image className="w-4 h-4" />
                    Change
                  </button>
                  {newImageFile && (
                    <button
                      onClick={clearNewImage}
                      className="flex items-center gap-1.5 px-3 py-2 bg-red-600/80 hover:bg-red-500 rounded-lg text-sm transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Undo
                    </button>
                  )}
                </div>
                {newImageFile && (
                  <span className="absolute top-2 right-2 text-xs px-2 py-0.5 bg-green-600 rounded-full text-white">
                    New image selected
                  </span>
                )}
              </div>
            ) : (
              <button
                onClick={() => imageInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-4 py-5 bg-black/30 border-2 border-dashed border-white/20 rounded-xl hover:border-purple-400 transition-colors text-gray-400 hover:text-gray-200 text-sm"
              >
                <Image className="w-5 h-5" />
                Click to attach a lyrics image (JPG / PNG)
              </button>
            )}

            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              onChange={handleImagePick}
              className="hidden"
            />
            <p className="text-xs text-gray-500 mt-1.5">
              Tip: on Windows, use <kbd className="bg-black/40 px-1 rounded">Win</kbd> + <kbd className="bg-black/40 px-1 rounded">Shift</kbd> + <kbd className="bg-black/40 px-1 rounded">S</kbd> to snip the lyrics from Google and paste-save here.
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-white/10 flex-shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim() || !artist.trim()}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-600 disabled:to-gray-600 rounded-xl transition-all font-medium"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
