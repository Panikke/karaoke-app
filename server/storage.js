/**
 * Where song media (audio, covers, lyrics images) is kept.
 *
 * - Local mode (default): files live in AUDIO_DIR and Express serves /audio/.
 * - R2 mode (R2_BUCKET set): files live in a Cloudflare R2 bucket, served
 *   publicly from its custom domain (R2_PUBLIC_URL). Playback then keeps
 *   working even when this server is down.
 *
 * Keys are the bare filenames stored in the songs table (UUID.mp3,
 * cover_<id>.jpg, …), so a file has the same name in either mode.
 */

import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import { S3Client, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const CONTENT_TYPES = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif',
};
export const contentTypeFor = (filename) =>
  CONTENT_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream';

// Same caching the Express /audio route uses. Filenames are UUID-based.
const CACHE_CONTROL = 'public, max-age=2592000';

export function createR2Client(env = process.env) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

export async function uploadToR2(client, bucket, key, body) {
  await new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentTypeFor(key),
      CacheControl: CACHE_CONTROL,
    },
    queueSize: 4,
    partSize: 16 * 1024 * 1024,
  }).done();
}

/** Size in bytes of an object in R2, or null if it doesn't exist. */
export async function r2ObjectSize(client, bucket, key) {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head.ContentLength ?? 0;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null;
    throw err;
  }
}

export function createStorage({ audioDir, env = process.env }) {
  const bucket = env.R2_BUCKET || '';

  if (!bucket) {
    return {
      mode: 'local',
      /** Put srcPath into storage as `filename`. keep=true leaves srcPath in place. */
      async save(srcPath, filename, { keep = false } = {}) {
        const dest = path.join(audioDir, filename);
        if (path.resolve(srcPath) === path.resolve(dest)) return;
        if (keep) await fs.copyFile(srcPath, dest);
        else await fs.rename(srcPath, dest);
      },
      async saveBuffer(buffer, filename) {
        await fs.writeFile(path.join(audioDir, filename), buffer);
      },
      async remove(filename) {
        await fs.unlink(path.join(audioDir, filename)).catch(() => {});
      },
    };
  }

  const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_URL']
    .filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`R2_BUCKET is set but ${missing.join(', ')} missing in .env`);
  }
  const client = createR2Client(env);

  return {
    mode: 'r2',
    bucket,
    publicUrl: env.R2_PUBLIC_URL.replace(/\/+$/, ''),
    async save(srcPath, filename, { keep = false } = {}) {
      await uploadToR2(client, bucket, filename, createReadStream(srcPath));
      if (!keep) await fs.unlink(srcPath).catch(() => {});
    },
    async saveBuffer(buffer, filename) {
      await uploadToR2(client, bucket, filename, buffer);
    },
    async remove(filename) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: filename }))
        .catch((err) => console.warn(`[R2] Delete ${filename} failed:`, err.message));
    },
  };
}
