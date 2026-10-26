/**
 * One-time copy of the existing song library from AUDIO_DIR into Cloudflare R2.
 *
 * Run on the machine that has the songs (e.g. the Windows PC):
 *   cd server
 *   npm install
 *   node migrate-to-r2.mjs            # copy everything (safe to re-run)
 *   node migrate-to-r2.mjs --check    # only report, upload nothing
 *
 * Reads AUDIO_DIR and the R2_* settings from the repo-root .env. Files already
 * in R2 with the same size are skipped, so an interrupted run can be resumed.
 * Nothing is deleted locally. Afterwards it cross-checks the songs table and
 * lists any file a song points at that isn't in R2.
 */

import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import dotenv from 'dotenv';
import dns from 'dns';
import { createClient } from '@supabase/supabase-js';
import { createR2Client, uploadToR2, r2ObjectSize } from './storage.js';

dns.setDefaultResultOrder('ipv4first');
dotenv.config({ path: path.resolve(import.meta.dirname, '..', '.env') });

const CHECK_ONLY = process.argv.includes('--check');
const CONCURRENCY = 4;
const MEDIA_RE = /\.(mp3|wav|ogg|m4a|flac|aac|jpg|jpeg|png|webp|gif)$/i;

const AUDIO_DIR = process.env.AUDIO_DIR || '/var/www/karaoke-app/audio';
const BUCKET = process.env.R2_BUCKET;
const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
  .filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(', ')}`);
  process.exit(1);
}

const r2 = createR2Client();
const gb = (n) => (n / 1024 ** 3).toFixed(2) + ' GB';

// Top-level media files only — incoming/ and failed/ aren't part of the library
const entries = await fs.readdir(AUDIO_DIR, { withFileTypes: true });
const files = [];
for (const e of entries) {
  if (!e.isFile() || !MEDIA_RE.test(e.name)) continue;
  const { size } = await fs.stat(path.join(AUDIO_DIR, e.name));
  files.push({ name: e.name, size });
}
const totalBytes = files.reduce((n, f) => n + f.size, 0);
console.log(`${files.length} files (${gb(totalBytes)}) in ${AUDIO_DIR}`);
console.log(CHECK_ONLY ? 'Check only — nothing will be uploaded.\n' : `Uploading to R2 bucket "${BUCKET}"…\n`);

let done = 0, uploaded = 0, skipped = 0, bytesSent = 0;
const failed = [];
const inR2 = new Set();

async function handle(file) {
  try {
    const remoteSize = await r2ObjectSize(r2, BUCKET, file.name);
    if (remoteSize === file.size) {
      skipped++;
      inR2.add(file.name);
    } else if (!CHECK_ONLY) {
      await uploadToR2(r2, BUCKET, file.name, createReadStream(path.join(AUDIO_DIR, file.name)));
      uploaded++;
      bytesSent += file.size;
      inR2.add(file.name);
    }
  } catch (err) {
    failed.push({ name: file.name, error: err.message });
  }
  done++;
  if (done % 25 === 0 || done === files.length) {
    console.log(`  ${done}/${files.length}  uploaded ${uploaded} (${gb(bytesSent)}), already there ${skipped}, failed ${failed.length}`);
  }
}

// Small worker pool so a 16 GB library doesn't take all night or swamp the line
const queue = [...files];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) await handle(queue.shift());
}));

console.log(`\nUploaded ${uploaded}, already in R2 ${skipped}, failed ${failed.length}.`);
for (const f of failed) console.log(`  FAILED ${f.name}: ${f.error}`);

// Cross-check: every file the database points at should now be in R2
if (process.env.VITE_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: songs, error } = await supabase
    .from('songs')
    .select('title, artist, audio_filename, cover_art_filename, lyrics_image_filename');
  if (error) {
    console.warn('\nCould not read songs table to cross-check:', error.message);
  } else {
    const notInR2 = [];
    for (const s of songs) {
      for (const fn of [s.audio_filename, s.cover_art_filename, s.lyrics_image_filename]) {
        if (fn && !inR2.has(fn)) notInR2.push(`${fn}  (${s.title} — ${s.artist})`);
      }
    }
    console.log(`\n${songs.length} songs in the database; ${notInR2.length} referenced file(s) not in R2.`);
    for (const line of notInR2) console.log(`  MISSING ${line}`);
    if (!notInR2.length && !failed.length && !CHECK_ONLY) console.log('All done — every song\'s files are in R2.');
  }
}

process.exit(failed.length ? 1 : 0);
