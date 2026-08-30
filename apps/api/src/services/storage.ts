/**
 * Local object storage.
 *
 * Binaries never go in MySQL — the database holds URLs and keys only. In
 * development files land on disk under `storage/`; the same interface is what
 * an S3/R2 adapter would implement.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { env } from '../lib/env.js';
import { fileKey } from '../lib/ids.js';

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export function uploadUrl(relative: string): string {
  return `${env.publicBaseUrl}/static/uploads/${relative.split(path.sep).join('/')}`;
}

export function assetUrl(relative: string): string {
  return `${env.publicBaseUrl}/static/assets/${relative.split(path.sep).join('/')}`;
}

/** Write an arbitrary buffer into the upload area. Returns key + public URL. */
export async function saveUpload(
  buffer: Buffer,
  opts: { extension: string; subdir?: string }
): Promise<{ key: string; url: string; size: number; relative: string }> {
  const key = fileKey();
  const subdir = opts.subdir ?? 'misc';
  const dir = path.join(env.uploadDir, subdir);
  await ensureDir(dir);
  const filename = `${key}.${opts.extension.replace(/^\./, '')}`;
  const full = path.join(dir, filename);
  await writeFile(full, buffer);
  const relative = path.join(subdir, filename);
  return { key, url: uploadUrl(relative), size: buffer.length, relative };
}

/**
 * Persist a canvas `data:` URL as a compressed preview.
 *
 * Plan thumbnails are shown in dense dashboard grids, so they are resized to
 * 512 px wide and re-encoded as WebP rather than stored as raw PNG.
 */
export async function savePreviewImage(dataUrl: string, name: string): Promise<string> {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match?.[2]) throw new Error('Preview must be a base64 image data URL.');
  const buffer = Buffer.from(match[2], 'base64');
  const dir = path.join(env.uploadDir, 'previews');
  await ensureDir(dir);
  const filename = `${name}-${Date.now()}.webp`;
  await sharp(buffer).resize({ width: 512, withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(dir, filename));
  return uploadUrl(path.join('previews', filename));
}

/** Stream a remote file into the asset area, preserving a caller-chosen path. */
export async function downloadToAssets(
  url: string,
  relativePath: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<{ path: string; url: string; size: number }> {
  const { timeoutMs = 120_000, maxBytes = 80 * 1024 * 1024 } = opts;
  const full = path.join(env.assetDir, relativePath);
  await ensureDir(path.dirname(full));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Novira/1.0 (event asset pipeline)' },
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} fetching ${url}`);

    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared && declared > maxBytes) throw new Error(`Asset too large (${declared} bytes).`);

    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(full));
    const info = await stat(full);
    if (info.size > maxBytes) {
      await unlink(full).catch(() => {});
      throw new Error(`Asset too large (${info.size} bytes).`);
    }
    return { path: full, url: assetUrl(relativePath), size: info.size };
  } finally {
    clearTimeout(timer);
  }
}

export async function saveAssetBuffer(
  buffer: Buffer,
  relativePath: string
): Promise<{ path: string; url: string; size: number }> {
  const full = path.join(env.assetDir, relativePath);
  await ensureDir(path.dirname(full));
  await writeFile(full, buffer);
  return { path: full, url: assetUrl(relativePath), size: buffer.length };
}

export async function removeUpload(relative: string): Promise<void> {
  await unlink(path.join(env.uploadDir, relative)).catch(() => {});
}
