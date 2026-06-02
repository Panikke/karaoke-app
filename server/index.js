/**
 * Karaoke Upload API — runs on the Pi at port 3001
 * nginx proxies /api/ → http://127.0.0.1:3001
 * Audio files live at /var/www/karaoke-app/audio/
 */

import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { parseFile as parseAudioFile } from 'music-metadata';
import { exec } from 'child_process';
import { promisify } from 'util';
import dns from 'dns';

// Force IPv4-first DNS resolution. Without this, Node 18+ may try IPv6 routes
// to Supabase (Cloudflare-hosted) that fail on Pis without proper v6 routing,
// surfacing as repeated EAI_AGAIN errors.
dns.setDefaultResultOrder('ipv4first');

const execAsync = promisify(exec);

// Load .env from the project root (one level up from server/)
dotenv.config({ path: path.resolve(import.meta.dirname, '..', '.env') });

// ── Config ────────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT || 3001;
const AUDIO_DIR  = process.env.AUDIO_DIR || '/var/www/karaoke-app/audio';
const INCOMING_DIR = process.env.INCOMING_DIR || path.join(AUDIO_DIR, 'incoming');
const FAILED_DIR   = path.join(AUDIO_DIR, 'failed');
// rclone remote name (e.g. "onedrive:karaoke-incoming") — set in .env to enable cloud sync
const RCLONE_REMOTE = process.env.RCLONE_REMOTE || '';
const SUPABASE_URL      = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// Ensure audio directories exist
if (!existsSync(AUDIO_DIR))    mkdirSync(AUDIO_DIR,    { recursive: true });
if (!existsSync(INCOMING_DIR)) mkdirSync(INCOMING_DIR, { recursive: true });
if (!existsSync(FAILED_DIR))   mkdirSync(FAILED_DIR,   { recursive: true });

// Service-role client — bypasses RLS for write operations
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: [
    'https://danserv.co.uk',
    'http://localhost:5173',
    'http://localhost:4173',
  ],
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

app.use(express.json());

// Serve audio/image files at /audio/ — nginx should alias this path directly,
// but Express serves as a fallback (and as the primary when nginx proxies /audio/ here).
app.use('/audio', express.static(AUDIO_DIR, {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=2592000');
    res.setHeader('Access-Control-Allow-Origin', '*');
  },
}));

// ── Multer ────────────────────────────────────────────────────────────────────
// Audio uploads → saved to disk with UUID filename
const audioStorage = multer.diskStorage({
  destination: AUDIO_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const audioUpload = multer({
  storage: audioStorage,
  limits: { fileSize: 300 * 1024 * 1024 }, // 300 MB per file
  fileFilter: (_req, file, cb) => {
    if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio type: ${file.originalname}`));
    }
  },
});

// Image uploads → kept in memory (small files)
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (/\.(jpg|jpeg|png|webp|gif)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported image type: ${file.originalname}`));
    }
  },
});

// ── Auth Middleware ───────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  console.log(`[AUTH] ${req.method} ${req.path}`);
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    console.log('[AUTH] No Bearer token');
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = auth.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    console.log('[AUTH] Invalid token:', error?.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  console.log('[AUTH] OK, user:', user.email);
  req.user = user;
  next();
}

async function requireEditor(req, res, next) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, can_edit_playlist')
    .eq('id', req.user.id)
    .single();

  if (error || !profile) {
    return res.status(403).json({ error: 'Profile not found' });
  }
  const isEditor = profile.role === 'admin'
    || profile.role === 'dj'
    || profile.can_edit_playlist === true;

  if (!isEditor) {
    return res.status(403).json({ error: 'Editor permission required' });
  }
  req.profile = profile;
  next();
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true }));

/**
 * POST /api/songs/upload
 * Multipart: audio[] (one or more audio files) + metadata (JSON array, one object per file)
 * Each metadata object: { trackNumber, title, artist, language, lyrics, syncedLyrics, lyricsSource }
 */
app.post(
  '/api/songs/upload',
  requireAuth,
  requireEditor,
  audioUpload.array('audio'),
  async (req, res) => {
    console.log('[UPLOAD] Handler reached, files:', req.files?.length ?? 0);
    const files = req.files;
    if (!files?.length) {
      console.log('[UPLOAD] No files in request');
      return res.status(400).json({ error: 'No audio files received' });
    }

    let metaList = [];
    try {
      metaList = JSON.parse(req.body.metadata || '[]');
    } catch {
      metaList = [];
    }

    const inserted = [];
    const failed  = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const meta = metaList[i] || {};

      console.log(`[UPLOAD] Inserting "${meta.title || file.originalname}" into Supabase`);
      const { data, error } = await supabase
        .from('songs')
        .insert({
          track_number:   meta.trackNumber   || null,
          title:          meta.title         || file.originalname,
          artist:         meta.artist        || 'Unknown Artist',
          language:       meta.language      || 'Greek (Ελληνικά)',
          lyrics:         meta.lyrics        || '',
          synced_lyrics:  meta.syncedLyrics  || [],
          lyrics_source:  meta.lyricsSource  || 'none',
          audio_filename: file.filename,      // UUID.ext on disk
          in_playlist:    true,
        })
        .select()
        .single();

      if (error) {
        console.error(`[UPLOAD] Supabase insert failed:`, error.message);
        // Remove orphaned file
        await fs.unlink(path.join(AUDIO_DIR, file.filename)).catch(() => {});
        failed.push({ file: file.originalname, error: error.message });
      } else {
        console.log(`[UPLOAD] Inserted OK, id:`, data.id);
        inserted.push(data);
      }
    }

    if (failed.length && !inserted.length) {
      return res.status(500).json({ error: 'All inserts failed', failed });
    }

    res.json({ songs: inserted, failed });
  }
);

/**
 * POST /api/songs/:id/cover
 * Multipart: image (single image file)
 */
app.post(
  '/api/songs/:id/cover',
  requireAuth,
  requireEditor,
  imageUpload.single('image'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image file' });
    const { id } = req.params;

    // Remove old cover if one exists
    const { data: existing } = await supabase
      .from('songs')
      .select('cover_art_filename')
      .eq('id', id)
      .single();
    if (existing?.cover_art_filename) {
      await fs.unlink(path.join(AUDIO_DIR, existing.cover_art_filename)).catch(() => {});
    }

    const ext      = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const filename = `cover_${id}${ext}`;
    await fs.writeFile(path.join(AUDIO_DIR, filename), req.file.buffer);

    const { error } = await supabase
      .from('songs')
      .update({ cover_art_filename: filename })
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ filename });
  }
);

/**
 * POST /api/songs/:id/lyrics-image
 * Multipart: image (single image file)
 */
app.post(
  '/api/songs/:id/lyrics-image',
  requireAuth,
  requireEditor,
  imageUpload.single('image'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image file' });
    const { id } = req.params;

    const { data: existing } = await supabase
      .from('songs')
      .select('lyrics_image_filename')
      .eq('id', id)
      .single();
    if (existing?.lyrics_image_filename) {
      await fs.unlink(path.join(AUDIO_DIR, existing.lyrics_image_filename)).catch(() => {});
    }

    const ext      = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const filename = `lyrics_${id}${ext}`;
    await fs.writeFile(path.join(AUDIO_DIR, filename), req.file.buffer);

    const { error } = await supabase
      .from('songs')
      .update({ lyrics_image_filename: filename })
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ filename });
  }
);

/**
 * DELETE /api/songs/:id
 */
app.delete('/api/songs/:id', requireAuth, requireEditor, async (req, res) => {
  const { id } = req.params;

  const { data: song } = await supabase
    .from('songs')
    .select('audio_filename, cover_art_filename, lyrics_image_filename')
    .eq('id', id)
    .single();

  if (song) {
    for (const fn of [
      song.audio_filename,
      song.cover_art_filename,
      song.lyrics_image_filename,
    ]) {
      if (fn) await fs.unlink(path.join(AUDIO_DIR, fn)).catch(() => {});
    }
  }

  const { error } = await supabase.from('songs').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/**
 * DELETE /api/songs  (admin only — clear entire library)
 */
app.delete('/api/songs', requireAuth, async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', req.user.id)
    .single();

  if (profile?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { data: songs } = await supabase
    .from('songs')
    .select('audio_filename, cover_art_filename, lyrics_image_filename');

  if (songs) {
    for (const song of songs) {
      for (const fn of [
        song.audio_filename,
        song.cover_art_filename,
        song.lyrics_image_filename,
      ]) {
        if (fn) await fs.unlink(path.join(AUDIO_DIR, fn)).catch(() => {});
      }
    }
  }

  // Delete all rows — use a always-true condition
  const { error } = await supabase
    .from('songs')
    .delete()
    .gte('created_at', '1970-01-01');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── Library Scan (Plex/Navidrome-style) ──────────────────────────────────────
// Files are placed in INCOMING_DIR via SCP/Samba/SFTP, then this scans them,
// extracts tags with music-metadata, moves to AUDIO_DIR, and inserts rows.

const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;

function parseFromFilename(filename) {
  const base = filename.replace(/\.[^/.]+$/, '');
  const numMatch = base.match(/^(\d+)[_\s\-\.]+(.+)$/);
  const trackNumber = numMatch ? numMatch[1] : null;
  const remainder   = numMatch ? numMatch[2] : base;
  const parts = remainder.split(/\s[-–]\s/).map(p => p.trim());
  if (parts.length >= 2) {
    return { trackNumber, title: parts[0], artist: parts.slice(1).join(' - ') };
  }
  return { trackNumber, title: remainder, artist: 'Unknown Artist' };
}

async function extractMetadata(filePath) {
  try {
    const meta = await parseAudioFile(filePath, { skipCovers: false, duration: false });
    const common = meta.common || {};
    return {
      title:        common.title  || null,
      artist:       common.artist || (common.artists?.[0] ?? null),
      trackNumber:  common.track?.no ? String(common.track.no) : null,
      hasCoverArt:  Array.isArray(common.picture) && common.picture.length > 0,
      coverArtData: common.picture?.[0] || null,
    };
  } catch (err) {
    console.warn(`[SCAN] Could not parse tags from ${path.basename(filePath)}:`, err.message);
    return { title: null, artist: null, trackNumber: null, hasCoverArt: false, coverArtData: null };
  }
}

/**
 * GET /api/library/incoming
 * Lists files currently in INCOMING_DIR with parsed metadata preview.
 */
app.get('/api/library/incoming', requireAuth, requireEditor, async (_req, res) => {
  console.log('[SCAN] List incoming requested');
  try {
    const entries = await fs.readdir(INCOMING_DIR, { withFileTypes: true });
    const audioFiles = entries
      .filter(e => e.isFile() && AUDIO_EXT_RE.test(e.name))
      .map(e => e.name);

    const results = [];
    for (const filename of audioFiles) {
      const filePath = path.join(INCOMING_DIR, filename);
      const stat     = await fs.stat(filePath);
      const tags     = await extractMetadata(filePath);
      const fallback = parseFromFilename(filename);

      results.push({
        filename,
        sizeBytes:   stat.size,
        // Prefer ID3 tags; fall back to filename parsing
        title:       tags.title       || fallback.title,
        artist:      tags.artist      || fallback.artist,
        trackNumber: tags.trackNumber || fallback.trackNumber,
        hasCoverArt: tags.hasCoverArt,
      });
    }
    console.log(`[SCAN] Found ${results.length} files in incoming/`);
    res.json({ files: results, incomingPath: INCOMING_DIR });
  } catch (err) {
    console.error('[SCAN] List incoming failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/library/scan
 * Body: { language: string, files?: string[] }   // files optional — defaults to all
 * Processes each file: extract tags, move to AUDIO_DIR with UUID name, save cover
 * art if embedded, insert Supabase row. Failed files move to FAILED_DIR.
 */
app.post('/api/library/scan', requireAuth, requireEditor, async (req, res) => {
  const language = req.body?.language || 'Greek (Ελληνικά)';
  const requested = Array.isArray(req.body?.files) ? req.body.files : null;
  console.log(`[SCAN] Starting scan (language=${language}, files=${requested?.length ?? 'all'})`);

  try {
    const entries = await fs.readdir(INCOMING_DIR, { withFileTypes: true });
    const audioFiles = entries
      .filter(e => e.isFile() && AUDIO_EXT_RE.test(e.name))
      .map(e => e.name)
      .filter(n => !requested || requested.includes(n));

    const imported = [];
    const failed   = [];

    for (const filename of audioFiles) {
      const sourcePath = path.join(INCOMING_DIR, filename);
      try {
        const tags     = await extractMetadata(sourcePath);
        const fallback = parseFromFilename(filename);

        const title       = tags.title       || fallback.title;
        const artist      = tags.artist      || fallback.artist;
        const trackNumber = tags.trackNumber || fallback.trackNumber;

        // Move file to permanent location with UUID filename
        const ext          = path.extname(filename).toLowerCase();
        const newFilename  = `${randomUUID()}${ext}`;
        const destPath     = path.join(AUDIO_DIR, newFilename);
        await fs.rename(sourcePath, destPath);

        // Save embedded cover art if present
        let coverArtFilename = null;
        if (tags.coverArtData?.data) {
          const cExt = (tags.coverArtData.format || 'image/jpeg').replace('image/', '.');
          coverArtFilename = `cover_${path.parse(newFilename).name}${cExt}`;
          await fs.writeFile(path.join(AUDIO_DIR, coverArtFilename), tags.coverArtData.data);
        }

        const { data, error } = await supabase
          .from('songs')
          .insert({
            track_number:       trackNumber,
            title:              title,
            artist:             artist,
            language:           language,
            lyrics:             '',
            synced_lyrics:      [],
            lyrics_source:      'none',
            audio_filename:     newFilename,
            cover_art_filename: coverArtFilename,
            in_playlist:        true,
          })
          .select()
          .single();

        if (error) {
          // Roll back: move file back to incoming
          await fs.rename(destPath, sourcePath).catch(() => {});
          if (coverArtFilename) {
            await fs.unlink(path.join(AUDIO_DIR, coverArtFilename)).catch(() => {});
          }
          throw new Error(`Supabase: ${error.message}`);
        }

        console.log(`[SCAN] Imported "${title}" by ${artist}`);
        imported.push(data);
      } catch (err) {
        console.error(`[SCAN] Failed "${filename}":`, err.message);
        // Move to failed/ so it's not retried automatically next scan
        const failedPath = path.join(FAILED_DIR, filename);
        await fs.rename(sourcePath, failedPath).catch(() => {});
        failed.push({ filename, error: err.message });
      }
    }

    console.log(`[SCAN] Done: ${imported.length} imported, ${failed.length} failed`);
    res.json({ imported, failed, totalProcessed: audioFiles.length });
  } catch (err) {
    console.error('[SCAN] Scan failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/library/sync-config
 * Returns whether cloud sync is configured (so the UI can hide the button if not).
 */
app.get('/api/library/sync-config', requireAuth, requireEditor, (_req, res) => {
  res.json({
    configured: !!RCLONE_REMOTE,
    remote:     RCLONE_REMOTE || null,
  });
});

/**
 * POST /api/library/sync
 * Pulls new files from the configured rclone remote into INCOMING_DIR.
 * Uses `rclone copy` (not sync) so cloud files are not deleted.
 */
app.post('/api/library/sync', requireAuth, requireEditor, async (_req, res) => {
  if (!RCLONE_REMOTE) {
    return res.status(400).json({
      error: 'Cloud sync not configured. Set RCLONE_REMOTE in .env (e.g. "onedrive:karaoke-incoming") and configure the rclone remote on the Pi.',
    });
  }

  console.log(`[SYNC] Pulling from ${RCLONE_REMOTE} → ${INCOMING_DIR}`);
  try {
    // `rclone copy` skips files already present, downloads only new ones.
    // --stats-one-line gives a single summary line we can parse if we want to.
    const cmd = `rclone copy "${RCLONE_REMOTE}" "${INCOMING_DIR}" --include "*.{mp3,wav,ogg,m4a,flac,aac,MP3,WAV,OGG,M4A,FLAC,AAC}" --transfers 4 --checkers 8 --stats=0`;
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 30 * 60 * 1000,           // 30 min hard timeout
      maxBuffer: 10 * 1024 * 1024,       // 10 MB output buffer
    });
    if (stderr) console.log('[SYNC] rclone stderr:', stderr.trim());
    if (stdout) console.log('[SYNC] rclone stdout:', stdout.trim());

    // After pulling, count what's now in incoming/
    const entries = await fs.readdir(INCOMING_DIR, { withFileTypes: true });
    const fileCount = entries.filter(e => e.isFile() && AUDIO_EXT_RE.test(e.name)).length;

    console.log(`[SYNC] Done. ${fileCount} audio file(s) currently in incoming/`);
    res.json({ ok: true, fileCount });
  } catch (err) {
    console.error('[SYNC] Failed:', err.message);
    res.status(500).json({
      error: `rclone failed: ${err.message}. Is rclone installed and is the remote configured?`,
    });
  }
});

// ── Global error handler (catches multer & other middleware errors) ───────────
app.use((err, req, res, _next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🎤 Karaoke API listening on http://127.0.0.1:${PORT}`);
  console.log(`   Audio dir:    ${AUDIO_DIR}`);
  console.log(`   Incoming dir: ${INCOMING_DIR}`);
  console.log(`   Failed dir:   ${FAILED_DIR}`);
});
