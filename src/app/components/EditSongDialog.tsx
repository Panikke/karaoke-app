import { useState, useRef } from 'react';
import { X, Save, Image, Trash2 } from 'lucide-react';
import type { Song } from '../App';

interface EditSongDialogProps {
  song: Song;
  onClose: () => void;
  onSave: (id: string, patch: { title: string; artist: string; language: string }) => Promise<void>;
  onAssignLyricsImage: (songId: string, file: File) => Promise<void>;
}

const LANGUAGES = [
  'Greek (Ελληνικά)', 'English', 'Spanish', 'Italian', 'French',
  'Portuguese', 'German', 'Arabic', 'Turkish', 'Other',
];

export function EditSongDialog({ song, onClose, onSave, onAssignLyricsImage }: EditSongDialogProps) {
  const [title, setTitle]       = useState(song.title);
  const [artist, setArtist]     = useState(song.artist);
  const [language, setLanguage] = useState(song.language);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // Lyrics image state
  const [newImageFile, setNewImageFile]     = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

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

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(song.id, { title: title.trim(), artist: artist.trim(), language });
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

  // Current image to display: new preview takes priority, then existing
  const displayImage = newImagePreview ?? song.lyricsImageUrl ?? null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-white/20 rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <h2 className="text-xl font-bold">Edit Song</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="Song title" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Artist</label>
            <input value={artist} onChange={e => setArtist(e.target.value)} className={inputCls} placeholder="Artist name" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Language</label>
            <select value={language} onChange={e => setLanguage(e.target.value)} className={`${inputCls} cursor-pointer`}>
              {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
              {!LANGUAGES.includes(language) && <option value={language}>{language}</option>}
            </select>
          </div>

          {/* ── Lyrics Image ── */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Lyrics Image</label>

            {displayImage ? (
              <div className="relative rounded-xl overflow-hidden border border-white/10">
                <img src={displayImage} alt="Lyrics" className="w-full max-h-40 object-contain bg-black/40" />
                {/* Change / remove overlay */}
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
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-white/10">
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
