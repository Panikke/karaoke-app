/**
 * One-time script: update Supabase audio_filename from .wav → .mp3
 * Run after converting WAV files to MP3 with ffmpeg.
 * Usage: node scripts/wav-to-mp3-db-update.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from project root
const envPath = join(__dirname, '..', '.env');
if (!existsSync(envPath)) {
  console.error('No .env file found at', envPath);
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(url, key);

// Find all songs with .wav filenames
const { data: wavSongs, error: fetchErr } = await supabase
  .from('songs')
  .select('id, title, audio_filename')
  .like('audio_filename', '%.wav');

if (fetchErr) {
  console.error('Fetch error:', fetchErr.message);
  process.exit(1);
}

if (!wavSongs || wavSongs.length === 0) {
  console.log('No WAV songs found in database — nothing to update.');
  process.exit(0);
}

console.log(`Found ${wavSongs.length} songs with .wav filenames. Updating...`);

let ok = 0, fail = 0;
for (const song of wavSongs) {
  const newFilename = song.audio_filename.replace(/\.wav$/i, '.mp3');
  const { error } = await supabase
    .from('songs')
    .update({ audio_filename: newFilename })
    .eq('id', song.id);

  if (error) {
    console.error(`  ✗ ${song.title}: ${error.message}`);
    fail++;
  } else {
    console.log(`  ✓ ${song.title}: ${song.audio_filename} → ${newFilename}`);
    ok++;
  }
}

console.log(`\nDone: ${ok} updated, ${fail} failed.`);
if (fail === 0) {
  console.log('\nYou can now delete the WAV files:');
  console.log('  rm /var/www/karaoke-app/audio/*.wav');
}
