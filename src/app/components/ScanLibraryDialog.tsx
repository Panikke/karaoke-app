import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, FolderSearch, CheckCircle, AlertCircle, RefreshCw, Music, Image, Cloud } from 'lucide-react';
import { listIncomingFiles, scanLibrary, getSyncConfig, syncFromCloud, type IncomingFile } from '../../lib/songsApi';
import type { Song } from '../App';

interface ScanLibraryDialogProps {
  onClose: () => void;
  onImported: (newSongs: Song[]) => void;
}

const LANGUAGES = [
  'Greek (Ελληνικά)', 'English', 'Spanish', 'French', 'German',
  'Italian', 'Portuguese', 'Japanese', 'Korean', 'Mandarin',
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ScanLibraryDialog({ onClose, onImported }: ScanLibraryDialogProps) {
  const [files, setFiles]             = useState<IncomingFile[]>([]);
  const [incomingPath, setIncomingPath] = useState<string>('');
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [language, setLanguage]       = useState('Greek (Ελληνικά)');
  const [loading, setLoading]         = useState(true);
  const [scanning, setScanning]       = useState(false);
  const [syncing, setSyncing]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [result, setResult]           = useState<{ imported: number; failed: { filename: string; error: string }[] } | null>(null);
  const [syncConfig, setSyncConfig]   = useState<{ configured: boolean; remote: string | null }>({ configured: false, remote: null });
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listIncomingFiles();
      setFiles(data.files);
      setIncomingPath(data.incomingPath);
      // Auto-select everything by default
      setSelected(new Set(data.files.map(f => f.filename)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Probe whether cloud sync is configured on the server
  useEffect(() => {
    getSyncConfig().then(setSyncConfig).catch(() => { /* silently leave as not configured */ });
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setSyncMessage(null);
    try {
      const { fileCount } = await syncFromCloud();
      setSyncMessage(`Cloud sync complete — ${fileCount} audio file(s) now in incoming folder.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  };

  const toggle = (filename: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === files.length) setSelected(new Set());
    else setSelected(new Set(files.map(f => f.filename)));
  };

  const handleScan = async () => {
    if (!selected.size) return;
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const { imported, failed } = await scanLibrary(language, Array.from(selected));
      setResult({ imported: imported.length, failed });
      if (imported.length) onImported(imported);
      // Refresh to show what's still in incoming/ (likely just failed ones, which moved to failed/)
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 border border-white/20 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="border-b border-white/10 px-6 py-5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <FolderSearch className="w-6 h-6 text-emerald-400" />
            <h2 className="text-2xl font-bold">Scan Library</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Instructions */}
          <div className="bg-blue-900/30 border border-blue-500/40 rounded-xl p-4 text-sm">
            <p className="font-medium text-blue-200 mb-1">How this works</p>
            {syncConfig.configured ? (
              <p className="text-gray-300">
                Drop audio files into your <b>{syncConfig.remote}</b> folder from any device (OneDrive web,
                phone, or Windows Explorer), then click <b>Sync from Cloud</b> below. The Pi pulls them in,
                reads ID3 tags, saves cover art, and indexes them. Works from anywhere.
              </p>
            ) : (
              <p className="text-gray-300">
                Cloud sync is not yet set up. For remote bulk uploads, configure <code className="bg-black/40 px-1 rounded">RCLONE_REMOTE</code> in
                the Pi's <code className="bg-black/40 px-1 rounded">.env</code> (e.g. <code className="bg-black/40 px-1 rounded">onedrive:karaoke-incoming</code>) — see <code className="bg-black/40 px-1 rounded">server/LIBRARY-SCAN-SETUP.md</code>.
                Until then, you can drop files into the incoming folder over SCP/SFTP/Samba on the LAN.
              </p>
            )}
            {incomingPath && (
              <p className="mt-2 text-xs font-mono text-blue-300 break-all">
                Incoming folder on Pi: <span className="bg-black/40 px-2 py-0.5 rounded">{incomingPath}</span>
              </p>
            )}
          </div>

          {/* Cloud sync action */}
          {syncConfig.configured && (
            <button
              onClick={handleSync}
              disabled={syncing || scanning}
              className="w-full px-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed rounded-xl flex items-center justify-center gap-2 font-medium transition-all"
            >
              {syncing ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Pulling from {syncConfig.remote}…</>
              ) : (
                <><Cloud className="w-4 h-4" /> Sync from Cloud ({syncConfig.remote})</>
              )}
            </button>
          )}

          {syncMessage && (
            <div className="flex items-start gap-2 px-4 py-3 bg-indigo-900/40 border border-indigo-500/50 rounded-xl text-sm text-indigo-200">
              <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{syncMessage}</span>
            </div>
          )}

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={refresh}
              disabled={loading || scanning}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 rounded-lg flex items-center gap-2 text-sm transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">Language</label>
              <select
                value={language}
                onChange={e => setLanguage(e.target.value)}
                disabled={scanning}
                className="px-3 py-2 bg-black/30 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
              >
                {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            {files.length > 0 && (
              <button
                onClick={toggleAll}
                disabled={scanning}
                className="text-sm text-gray-400 hover:text-white"
              >
                {selected.size === files.length ? 'Deselect all' : 'Select all'}
              </button>
            )}

            <span className="ml-auto text-sm text-gray-400">
              {selected.size} of {files.length} selected
            </span>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 px-4 py-3 bg-red-900/40 border border-red-500/50 rounded-xl text-sm text-red-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 px-4 py-3 bg-emerald-900/40 border border-emerald-500/50 rounded-xl text-sm text-emerald-300">
                <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>Imported <b>{result.imported}</b> songs into the library.</span>
              </div>
              {result.failed.length > 0 && (
                <div className="px-4 py-3 bg-yellow-900/30 border border-yellow-500/40 rounded-xl text-sm">
                  <p className="text-yellow-300 mb-1.5"><b>{result.failed.length}</b> file(s) failed and were moved to <code className="bg-black/40 px-1 rounded">audio/failed/</code>:</p>
                  <ul className="text-xs text-gray-400 max-h-32 overflow-y-auto space-y-1">
                    {result.failed.map(f => (
                      <li key={f.filename} className="font-mono">
                        <span className="text-yellow-200">{f.filename}</span> — {f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* File list */}
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin mr-3" />
              Reading incoming folder…
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Music className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>No audio files in the incoming folder.</p>
              <p className="text-sm mt-1">Drop MP3 / WAV / FLAC / M4A files there and click Refresh.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {files.map(f => {
                const isSel = selected.has(f.filename);
                return (
                  <label
                    key={f.filename}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border cursor-pointer transition-all ${
                      isSel
                        ? 'bg-emerald-900/20 border-emerald-500/40'
                        : 'bg-black/30 border-white/10 hover:border-white/20'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      disabled={scanning}
                      onChange={() => toggle(f.filename)}
                      className="w-4 h-4 accent-emerald-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {f.trackNumber && (
                          <span className="font-mono text-purple-300 text-sm">{f.trackNumber}</span>
                        )}
                        <span className="font-medium truncate">{f.title}</span>
                        {f.hasCoverArt && (
                          <span title="Embedded cover art will be imported">
                            <Image className="w-3.5 h-3.5 text-pink-300" />
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate">
                        {f.artist} · <span className="font-mono text-gray-500">{f.filename}</span> · {formatBytes(f.sizeBytes)}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 px-6 py-4 flex gap-3 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={scanning}
            className="flex-1 px-6 py-3 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg transition-colors"
          >
            Close
          </button>
          <button
            onClick={handleScan}
            disabled={scanning || selected.size === 0}
            className="flex-1 px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed rounded-lg transition-all font-medium flex items-center justify-center gap-2"
          >
            {scanning ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Scanning {selected.size} files…</>
            ) : (
              <><FolderSearch className="w-4 h-4" /> Scan & Import {selected.size > 0 ? selected.size : ''}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
