import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ArrowLeft, Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Maximize, Minimize,
  ChevronLeft, ChevronRight, ListMusic, X, Repeat, GripVertical, Expand, Shrink,
} from 'lucide-react';
import type { Song } from '../App';
import { getCurrentLineIndex } from '../../utils/lrcParser';

interface KaraokePlayerProps {
  song: Song;
  playlist: Song[];
  queue: Song[];
  onQueueChange: React.Dispatch<React.SetStateAction<Song[]>>;
  onBack: () => void;
  onSelectSong: (song: Song) => void;
}

export function KaraokePlayer({ song, playlist, queue, onQueueChange, onBack, onSelectSong }: KaraokePlayerProps) {
  const [isPlaying, setIsPlaying]             = useState(false);
  const [currentTime, setCurrentTime]         = useState(0);
  const [duration, setDuration]               = useState(0);
  const [volume, setVolume]                   = useState(1);
  const [muted, setMuted]                     = useState(false);
  const [isFullscreen, setIsFullscreen]       = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showImageLyrics, setShowImageLyrics] = useState(false);
  const [imageLoadError, setImageLoadError]   = useState(false);
  const [imageFull, setImageFull]             = useState(false);
  const [autoplay, setAutoplay]               = useState(true);
  const [dragIdx, setDragIdx]                 = useState<number | null>(null);
  const [dragOver, setDragOver]               = useState<number | null>(null);

  const audioRef           = useRef<HTMLAudioElement>(null);
  const containerRef       = useRef<HTMLDivElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const lineRefs           = useRef<(HTMLParagraphElement | null)[]>([]);
  const wakeLockRef        = useRef<WakeLockSentinel | null>(null);
  const hideTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef           = useRef<Song[]>([]);
  const playlistRef        = useRef<Song[]>([]);
  const currentSongRef     = useRef<Song>(song);
  const autoplayRef        = useRef(true);
  const shouldAutoplayRef  = useRef(true);

  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { playlistRef.current = playlist; }, [playlist]);
  useEffect(() => { currentSongRef.current = song; }, [song]);
  useEffect(() => { autoplayRef.current = autoplay; }, [autoplay]);

  const hasSynced   = song.syncedLyrics.length > 0;
  const hasPlain    = song.lyrics.trim().length > 0;
  const plainLines  = hasPlain ? song.lyrics.split('\n').filter(l => l.trim()) : [];
  const syncedLines = song.syncedLyrics;

  // Proportional plain lyrics timing — each line weighted by character count
  const plainLineCumulativeTimes = useMemo(() => {
    if (!hasPlain || plainLines.length === 0 || duration === 0) return [];
    const weights = plainLines.map(l => Math.max(l.trim().length, 8));
    const total = weights.reduce((a, b) => a + b, 0);
    const times: number[] = [];
    let cum = 0;
    for (const w of weights) { times.push(cum); cum += (w / total) * duration; }
    return times;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.lyrics, duration]);

  const currentSyncedIdx = hasSynced ? getCurrentLineIndex(syncedLines, currentTime) : -1;
  const currentPlainIdx  = (!hasSynced && hasPlain && plainLineCumulativeTimes.length > 0)
    ? plainLineCumulativeTimes.reduce((best, t, i) => t <= currentTime ? i : best, 0)
    : -1;
  const currentLineIdx = hasSynced ? currentSyncedIdx : currentPlainIdx;
  const lyricsLines    = hasSynced ? syncedLines.map(l => l.text) : plainLines;
  const hasLyrics      = lyricsLines.length > 0;

  const currentIdx     = playlist.findIndex(s => s.id === song.id);
  const prevSong       = currentIdx > 0 ? playlist[currentIdx - 1] : null;
  const sequentialNext = currentIdx < playlist.length - 1 ? playlist[currentIdx + 1] : null;
  const nextSong       = queue.length > 0 ? queue[0] : sequentialNext;

  const upNext: Array<{ song: Song; queued: boolean }> = [
    ...queue.map(s => ({ song: s, queued: true })),
    ...playlist
      .slice(currentIdx + 1)
      .filter(s => !queue.some(q => q.id === s.id))
      .map(s => ({ song: s, queued: false })),
  ].slice(0, 20);

  const otherSongs = playlist.filter(s => s.id !== song.id);

  // DJ adds to FRONT (play next); patron library adds to END (FIFO)
  const addToQueue = useCallback((s: Song) => {
    onQueueChange(prev => [s, ...prev.filter(q => q.id !== s.id)]);
  }, [onQueueChange]);

  const removeFromQueue = useCallback((id: string) => {
    onQueueChange(prev => prev.filter(q => q.id !== id));
  }, [onQueueChange]);

  const goNext = useCallback(() => {
    const q = queueRef.current;
    if (q.length > 0) {
      const next = q[0];
      onQueueChange(prev => prev.slice(1));
      onSelectSong(next);
    } else {
      const pl  = playlistRef.current;
      const idx = pl.findIndex(s => s.id === currentSongRef.current.id);
      if (idx < pl.length - 1) onSelectSong(pl[idx + 1]);
    }
  }, [onSelectSong, onQueueChange]);

  // User-initiated navigation — always autoplay the selected song
  const selectAndPlay = useCallback((s: Song) => {
    shouldAutoplayRef.current = true;
    onSelectSong(s);
  }, [onSelectSong]);

  const goNextAndPlay = useCallback(() => {
    shouldAutoplayRef.current = true;
    goNext();
  }, [goNext]);

  // Auto-scroll active lyric line
  useEffect(() => {
    if (currentLineIdx >= 0) {
      lineRefs.current[currentLineIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentLineIdx]);

  // Audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => setDuration(audio.duration);
    const onEnd  = () => {
      setIsPlaying(false);
      const hasNext = queueRef.current.length > 0 ||
        playlistRef.current.findIndex(s => s.id === currentSongRef.current.id) < playlistRef.current.length - 1;
      if (autoplayRef.current && hasNext) shouldAutoplayRef.current = true;
      goNext();
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
    };
  }, [song.audioUrl, goNext]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
  }, [volume, muted]);

  // Reset image error state whenever the lyrics image URL changes (e.g. after re-upload)
  useEffect(() => {
    setImageLoadError(false);
    if (song.lyricsImageUrl) setShowImageLyrics(true);
  }, [song.lyricsImageUrl]);

  // Reset on song change
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    lineRefs.current = [];
    setShowImageLyrics(!!song.lyricsImageUrl);
    setImageLoadError(false);
    setImageFull(false);

    if (shouldAutoplayRef.current) {
      shouldAutoplayRef.current = false;
      const audio = audioRef.current;
      if (!audio) return;
      const startPlay = () => {
        audio.play().then(() => setIsPlaying(true)).catch(() => {});
        audio.removeEventListener('canplay', startPlay);
      };
      if (audio.readyState >= 3) startPlay();
      else audio.addEventListener('canplay', startPlay);
    }
  }, [song.id]);

  // Wake Lock
  useEffect(() => {
    if (isPlaying) {
      (navigator as Navigator & { wakeLock?: { request: (type: string) => Promise<WakeLockSentinel> } })
        .wakeLock?.request('screen')
        .then(lock => { wakeLockRef.current = lock; })
        .catch(() => {});
    } else {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    }
    return () => { wakeLockRef.current?.release().catch(() => {}); };
  }, [isPlaying]);

  // Fullscreen tracking
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Media Session API
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title:   song.title,
      artist:  song.artist,
      artwork: song.coverArtUrl ? [{ src: song.coverArtUrl, sizes: '512x512', type: 'image/png' }] : [],
    });
    navigator.mediaSession.setActionHandler('play',          () => { audioRef.current?.play(); setIsPlaying(true); });
    navigator.mediaSession.setActionHandler('pause',         () => { audioRef.current?.pause(); setIsPlaying(false); });
    navigator.mediaSession.setActionHandler('previoustrack', prevSong ? () => selectAndPlay(prevSong) : null);
    navigator.mediaSession.setActionHandler('nexttrack',     nextSong ? goNextAndPlay : null);
  }, [song, prevSong, nextSong, goNextAndPlay, selectAndPlay]);

  // Auto-hide controls in fullscreen
  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (document.fullscreenElement) setControlsVisible(false);
    }, 3000);
  }, []);

  useEffect(() => {
    if (!isFullscreen) {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    } else {
      showControls();
    }
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [isFullscreen, showControls]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) { audio.pause(); setIsPlaying(false); }
    else           { audio.play();  setIsPlaying(true);  }
  }, [isPlaying]);

  const seek = (v: number) => { if (audioRef.current) { audioRef.current.currentTime = v; setCurrentTime(v); } };
  const skip = (s: number) => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, Math.min(duration, currentTime + s)); };
  const fmt  = (t: number) => !isFinite(t) ? '0:00' : `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen();
    else document.exitFullscreen();
  };

  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver  = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOver(idx); };
  const handleDrop      = (e: React.DragEvent, toIdx: number) => {
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== toIdx) {
      const reordered = [...upNext];
      const [item] = reordered.splice(dragIdx, 1);
      reordered.splice(toIdx, 0, item);
      onQueueChange(reordered.map(({ song: s }) => s));
    }
    setDragIdx(null);
    setDragOver(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setDragOver(null); };

  const controlsFade = isFullscreen && !controlsVisible ? 'opacity-0 pointer-events-none' : 'opacity-100';
  const showingImage = (showImageLyrics || !hasLyrics) && !!song.lyricsImageUrl && !imageLoadError;

  return (
    <div
      ref={containerRef}
      className="size-full flex flex-col bg-slate-900 text-white select-none"
      onPointerMove={showControls}
      onPointerDown={showControls}
    >
      <audio ref={audioRef} src={song.audioUrl} />

      {/* ── Header ── */}
      <header className={`flex-shrink-0 bg-slate-900 border-b border-slate-700 px-3 py-2 flex items-center gap-2 transition-opacity duration-300 ${controlsFade}`}>
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-slate-300 hover:text-white min-w-[48px] min-h-[48px] px-3 rounded hover:bg-slate-700 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm hidden sm:inline">Library</span>
        </button>

        <div className="flex-1 text-center px-2 min-w-0">
          <p className="font-bold truncate leading-tight">{song.title}</p>
          <p className="text-sm text-slate-400 truncate leading-tight">{song.artist}</p>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {prevSong && (
            <button onClick={() => selectAndPlay(prevSong)} className="min-w-[48px] min-h-[48px] flex items-center justify-center hover:bg-slate-700 rounded transition-colors" title={prevSong.title}>
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          {nextSong && (
            <button onClick={goNextAndPlay} className="min-w-[48px] min-h-[48px] flex items-center justify-center hover:bg-slate-700 rounded transition-colors" title={nextSong.title}>
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
          <button onClick={toggleFullscreen} className="min-w-[48px] min-h-[48px] flex items-center justify-center hover:bg-slate-700 rounded transition-colors">
            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* ── Main three-column layout ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── Left panel — cover art + controls ── */}
        <div className={`flex-shrink-0 flex flex-col items-center justify-between py-4 px-5 w-[260px] lg:w-[300px] xl:w-[340px] border-r border-slate-700 bg-slate-800 transition-all duration-300 ${controlsFade} ${imageFull ? 'hidden' : ''}`}>

          <div className="flex-1 flex items-center justify-center w-full min-h-0 py-2">
            {song.coverArtUrl ? (
              <img src={song.coverArtUrl} alt={song.title} className="shadow-2xl object-cover max-h-full max-w-full aspect-square rounded-lg" />
            ) : (
              <div className="w-32 h-32 bg-slate-700 border border-slate-600 flex items-center justify-center shadow-xl rounded-lg">
                <span className="text-4xl opacity-30">♪</span>
              </div>
            )}
          </div>

          <div className="w-full space-y-1 mt-2">
            <input type="range" min={0} max={duration || 0} value={currentTime}
              onChange={e => seek(Number(e.target.value))}
              className="w-full h-1.5 bg-slate-600 rounded-full appearance-none cursor-pointer accent-orange-500" />
            <div className="flex justify-between text-xs text-slate-400 tabular-nums px-0.5">
              <span>{fmt(currentTime)}</span>
              <span>{fmt(duration)}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 mt-3">
            <button onClick={() => prevSong && selectAndPlay(prevSong)} disabled={!prevSong}
              className="w-12 h-12 flex items-center justify-center hover:bg-slate-700 rounded-full transition-colors disabled:opacity-25">
              <SkipBack className="w-6 h-6" />
            </button>
            <button onClick={() => skip(-10)}
              className="w-11 h-11 flex items-center justify-center hover:bg-slate-700 rounded-full transition-colors text-xs font-bold text-slate-300">
              −10s
            </button>
            <button onClick={togglePlay}
              className="w-[72px] h-[72px] flex items-center justify-center bg-orange-500 hover:bg-orange-600 active:scale-95 transition-all shadow-lg shadow-orange-900/40 rounded-full">
              {isPlaying ? <Pause className="w-8 h-8 text-white" /> : <Play className="w-8 h-8 text-white ml-1" />}
            </button>
            <button onClick={() => skip(10)}
              className="w-11 h-11 flex items-center justify-center hover:bg-slate-700 rounded-full transition-colors text-xs font-bold text-slate-300">
              +10s
            </button>
            <button onClick={goNextAndPlay} disabled={!nextSong}
              className="w-12 h-12 flex items-center justify-center hover:bg-slate-700 rounded-full transition-colors disabled:opacity-25">
              <SkipForward className="w-6 h-6" />
            </button>
          </div>

          <div className="flex items-center gap-2 mt-3 w-full">
            <button onClick={() => setMuted(m => !m)}
              className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-white transition-colors flex-shrink-0">
              {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <input type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume}
              onChange={e => { setVolume(Number(e.target.value)); setMuted(false); }}
              className="flex-1 h-1.5 bg-slate-600 rounded-full appearance-none cursor-pointer accent-white" />
          </div>

          <button
            onClick={() => setAutoplay(a => !a)}
            title={autoplay ? 'Autoplay on — click to turn off' : 'Autoplay off — click to turn on'}
            className={`mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-xs font-medium transition-all ${
              autoplay
                ? 'bg-orange-500/15 border border-orange-500/40 text-orange-400 hover:bg-orange-500/25'
                : 'bg-slate-700 border border-slate-600 text-slate-500 hover:text-slate-300'
            }`}
          >
            <Repeat className="w-4 h-4" />
            Autoplay {autoplay ? 'On' : 'Off'}
          </button>
        </div>

        {/* ── Centre panel — lyrics ── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-slate-900">

          {/* Toggle bar */}
          {(hasLyrics && song.lyricsImageUrl || showingImage) && (
            <div className="flex-shrink-0 flex items-center justify-end gap-2 px-4 pt-2">
              {hasLyrics && song.lyricsImageUrl && (
                <button
                  onClick={() => setShowImageLyrics(v => !v)}
                  className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300 hover:text-white"
                >
                  {showImageLyrics ? '📝 Text' : '🖼 Image'}
                </button>
              )}
              {showingImage && (
                <button
                  onClick={() => setImageFull(v => !v)}
                  title={imageFull ? 'Exit wall-to-wall' : 'Wall-to-wall'}
                  className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded transition-colors text-slate-300 hover:text-white flex items-center gap-1.5"
                >
                  {imageFull ? <Shrink className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{imageFull ? 'Exit' : 'Fullscreen'}</span>
                </button>
              )}
            </div>
          )}

          {/* Lyrics image */}
          {showingImage ? (
            <div
              className="flex-1 overflow-hidden flex items-center justify-center"
              onClick={() => imageFull && setImageFull(false)}
            >
              <img
                src={song.lyricsImageUrl!}
                alt="Lyrics"
                className="w-full h-full object-contain"
                onError={() => setImageLoadError(true)}
              />
            </div>
          ) : song.lyricsImageUrl && imageLoadError ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
              <span className="text-5xl opacity-20">🖼️</span>
              <p className="text-slate-400 text-sm">Lyrics image unavailable</p>
              <button
                onClick={() => setImageLoadError(false)}
                className="text-xs px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 transition-colors"
              >
                Retry
              </button>
              <p className="text-slate-500 text-xs">Or re-upload via the song library</p>
            </div>
          ) : hasLyrics ? (
            <div ref={lyricsContainerRef}
              className="flex-1 overflow-y-auto py-16 px-6 flex flex-col items-center gap-5"
              style={{ scrollbarWidth: 'none' }}
              onClick={togglePlay}
            >
              {lyricsLines.map((line, i) => {
                const offset   = i - currentLineIdx;
                const isActive = offset === 0;
                const isNext   = offset === 1;
                const isNear   = offset === 2 || offset === 3;
                const isPast   = offset < 0 && offset >= -3;
                const isFar    = offset > 3 || offset < -3;
                return (
                  <p key={i}
                    ref={el => { lineRefs.current[i] = el; }}
                    className={`text-center leading-tight transition-all duration-300 ${
                      isFar    ? 'hidden' :
                      isActive ? 'text-5xl sm:text-6xl xl:text-8xl font-bold text-white scale-[1.02]' :
                      isNext   ? 'text-2xl xl:text-3xl text-slate-300' :
                      isNear   ? 'text-lg text-slate-500' :
                      isPast   ? 'text-sm text-slate-600' :
                      'text-base text-slate-600'
                    }`}
                  >
                    {line || ' '}
                  </p>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
              <span className="text-7xl opacity-10">🎤</span>
              <p className="text-slate-400 text-xl">No lyrics image uploaded</p>
              <p className="text-slate-500 text-sm">Add a screenshot via the library</p>
            </div>
          )}
        </div>

        {/* ── Right panel — Up Next + All Songs ── */}
        <div className={`flex-shrink-0 w-[200px] lg:w-[220px] xl:w-[240px] border-l border-slate-700 bg-slate-800 flex flex-col overflow-hidden transition-all duration-300 ${imageFull ? 'hidden' : ''}`}>

          {/* Up Next */}
          <div className="flex-shrink-0 border-b border-slate-700 flex flex-col" style={{ maxHeight: '45%' }}>
            <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0">
              <ListMusic className="w-4 h-4 text-orange-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Up Next</span>
              {queue.length > 0 && (
                <span className="ml-auto text-xs px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded-full">{queue.length}</span>
              )}
            </div>
            <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: 'none' }}>
              {upNext.length === 0 ? (
                <p className="text-xs text-slate-500 px-3 pb-3">No songs queued</p>
              ) : (
                upNext.map(({ song: s, queued }, i) => (
                  <div key={s.id}
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragOver={e => handleDragOver(e, i)}
                    onDrop={e => handleDrop(e, i)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer group transition-colors relative
                      ${dragIdx === i ? 'opacity-30' : 'hover:bg-slate-700/50'}
                      ${dragOver === i && dragIdx !== i ? 'border-t-2 border-orange-500' : ''}
                    `}
                    onClick={() => dragIdx === null && selectAndPlay(s)}
                  >
                    <GripVertical className="w-4 h-4 text-slate-500 cursor-grab flex-shrink-0 active:cursor-grabbing hover:text-slate-300" />
                    {s.coverArtUrl
                      ? <img src={s.coverArtUrl} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                      : <div className="w-8 h-8 rounded bg-slate-600 flex items-center justify-center flex-shrink-0 text-xs">♪</div>
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">
                        {s.trackNumber && <span className="text-slate-500 font-normal">{s.trackNumber}. </span>}
                        {s.title}
                      </p>
                      <p className="text-xs text-slate-400 truncate">{s.artist}</p>
                    </div>
                    {queued ? (
                      <button onClick={e => { e.stopPropagation(); removeFromQueue(s.id); }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-all flex-shrink-0">
                        <X className="w-3 h-3" />
                      </button>
                    ) : (
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-600 flex-shrink-0" />
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* All Songs — DJ queue panel */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0 border-b border-slate-700/50">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">All Songs</span>
              <span className="ml-auto text-xs text-slate-500">{otherSongs.length}</span>
            </div>
            <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: 'none' }}>
              {otherSongs.map(s => {
                const isQueued = queue.some(q => q.id === s.id);
                return (
                  <div key={s.id}
                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer group transition-colors ${isQueued ? 'bg-orange-500/10' : 'hover:bg-slate-700/50'}`}
                    onClick={() => addToQueue(s)}
                  >
                    {s.coverArtUrl
                      ? <img src={s.coverArtUrl} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                      : <div className="w-8 h-8 rounded bg-slate-600 flex items-center justify-center flex-shrink-0 text-xs">♪</div>
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">
                        {s.trackNumber && <span className="text-slate-500 font-normal">{s.trackNumber}. </span>}
                        {s.title}
                      </p>
                      <p className="text-xs text-slate-400 truncate">{s.artist}</p>
                    </div>
                    {isQueued
                      ? <span className="text-xs text-orange-400 flex-shrink-0">✓</span>
                      : <span className="text-xs text-slate-500 opacity-0 group-hover:opacity-100 flex-shrink-0">+</span>
                    }
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
