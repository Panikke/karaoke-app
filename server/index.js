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

// Load .env from the project root (one level up from server/)
dotenv.config({ path: path.resolve(import.meta.dirname, '..', '.env') });

// ── Config ────────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT || 3001;
const AUDIO_DIR  = process.env.AUDIO_DIR || '/var/www/karaoke-app/audio';
const SUPABASE_URL      = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// Ensure audio directory exists
if (!existsSync(AUDIO_DIR)) mkdirSync(AUDIO_DIR, { recursive: true });

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

// ── Global error handler (catches multer & other middleware errors) ───────────
app.use((err, req, res, _next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🎤 Karaoke API listening on http://127.0.0.1:${PORT}`);
  console.log(`   Audio dir: ${AUDIO_DIR}`);
});
