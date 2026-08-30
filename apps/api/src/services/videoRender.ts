/**
 * Walkthrough video rendering.
 *
 * The camera path is deterministic (`shared/walkthrough.ts`), so a video is
 * just that path sampled at a fixed frame rate. The question is only *where*
 * the frames are drawn.
 *
 * They are drawn in the browser, by the same renderer that draws the viewport,
 * and uploaded here to be encoded. That is a deliberate choice over a headless
 * renderer on the server:
 *
 * - the frames match the preview exactly, because they came from the same
 *   renderer with the same materials, environment and lighting — a
 *   server-rendered video that looks different from the preview is a support
 *   ticket every time;
 * - a client GPU is already there and idle, where a server one costs money per
 *   minute of video;
 * - and the model, texture and HDR assets are already loaded in the tab.
 *
 * What the server contributes is the part a browser cannot do well: encoding a
 * long sequence of high-resolution stills into an MP4 that plays everywhere,
 * with an optional audio bed mixed under it.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { env } from '../lib/env.js';
import { ApiError } from '../lib/errors.js';
import { assetUrl } from './storage.js';

/** Frames for an in-progress render live here until they are encoded. */
function sessionDir(sessionId: string): string {
  return path.join(env.assetDir, 'video-sessions', sessionId);
}

/** Reject anything that is not a plain session id, before it reaches a path. */
export function assertSessionId(sessionId: string): string {
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(sessionId)) {
    throw ApiError.badRequest('Invalid render session.');
  }
  return sessionId;
}

export async function createSession(sessionId: string): Promise<void> {
  assertSessionId(sessionId);
  await mkdir(sessionDir(sessionId), { recursive: true });
}

/**
 * Store one frame.
 *
 * Frames are numbered by the client and zero-padded here, because ffmpeg's
 * image sequence input matches on a printf pattern and would silently stop at
 * frame 9 if they were not.
 */
export async function saveFrame(sessionId: string, index: number, dataUrl: string): Promise<void> {
  assertSessionId(sessionId);
  const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) throw ApiError.badRequest('A frame was not a readable image.');
  if (!Number.isInteger(index) || index < 0 || index > 100_000) {
    throw ApiError.badRequest('Frame index out of range.');
  }
  const dir = sessionDir(sessionId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${String(index).padStart(6, '0')}.png`), Buffer.from(match[2]!, 'base64'));
}

export async function frameCount(sessionId: string): Promise<number> {
  assertSessionId(sessionId);
  try {
    const files = await readdir(sessionDir(sessionId));
    return files.filter((f) => f.endsWith('.png')).length;
  } catch {
    return 0;
  }
}

export interface EncodeOptions {
  fps: number;
  width: number;
  height: number;
  bitrateMbps: number;
  /** Audio file already on our storage, mixed under the video. */
  audioPath?: string | null;
  loopAudio?: boolean;
}

export interface EncodeResult {
  url: string;
  relativePath: string;
  durationSeconds: number;
  frames: number;
  sizeBytes: number;
}

function run(binary: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stderr = '';
    // ffmpeg writes its whole progress log to stderr, so this is the diagnostic
    // channel rather than an error channel — it is only read on failure.
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

/**
 * Encode the frames into an MP4.
 *
 * `yuv420p` and `+faststart` are both non-negotiable for a deliverable: without
 * the pixel format the file will not play in QuickTime or on most phones, and
 * without faststart the whole file must download before playback begins, which
 * makes a 200 MB 4K walkthrough look broken when a client clicks it.
 */
export async function encodeSession(sessionId: string, options: EncodeOptions): Promise<EncodeResult> {
  assertSessionId(sessionId);
  const binary = ffmpegPath;
  if (!binary) {
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Video encoding is not available on this server.');
  }

  const dir = sessionDir(sessionId);
  const frames = await frameCount(sessionId);
  if (frames < 2) throw ApiError.badRequest('No frames were uploaded for this render.');

  const relativePath = `videos/${sessionId}.mp4`;
  const output = path.join(env.assetDir, relativePath);
  await mkdir(path.dirname(output), { recursive: true });

  // Even dimensions only: H.264 cannot encode an odd width or height, and the
  // failure message ffmpeg gives for it is not one anyone would recognise.
  const width = Math.round(options.width / 2) * 2;
  const height = Math.round(options.height / 2) * 2;

  const args: string[] = [
    '-y',
    '-framerate',
    String(options.fps),
    '-i',
    path.join(dir, '%06d.png'),
  ];

  if (options.audioPath) {
    if (options.loopAudio !== false) args.push('-stream_loop', '-1');
    args.push('-i', options.audioPath);
  }

  args.push(
    '-vf',
    `scale=${width}:${height}:flags=lanczos`,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-b:v',
    `${options.bitrateMbps}M`,
    '-maxrate',
    `${Math.round(options.bitrateMbps * 1.4)}M`,
    '-bufsize',
    `${Math.round(options.bitrateMbps * 2)}M`,
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart'
  );

  if (options.audioPath) {
    args.push(
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      // End when the pictures do, however long the audio bed is.
      '-shortest',
      '-af',
      'afade=t=out:st=' + Math.max(0, frames / options.fps - 2).toFixed(2) + ':d=2'
    );
  }

  args.push(output);

  const result = await run(binary, args);
  if (result.code !== 0) {
    // Surface the last few lines only. The full log is thousands of lines of
    // per-frame progress and would bury the actual failure.
    const tail = result.stderr.split('\n').slice(-8).join(' ').trim();
    throw new ApiError(500, 'ENCODE_FAILED', `The video could not be encoded. ${tail}`);
  }

  const { stat } = await import('node:fs/promises');
  const info = await stat(output);

  // The frames are large and single-use; leaving them would fill the disk
  // faster than anything else this product writes.
  await rm(dir, { recursive: true, force: true }).catch(() => {});

  return {
    url: assetUrl(relativePath),
    relativePath,
    durationSeconds: Math.round((frames / options.fps) * 10) / 10,
    frames,
    sizeBytes: info.size,
  };
}

/** Remove a session's frames without encoding — used when a job is cancelled. */
export async function discardSession(sessionId: string): Promise<void> {
  assertSessionId(sessionId);
  await rm(sessionDir(sessionId), { recursive: true, force: true }).catch(() => {});
}

export function encoderStatus(): { available: boolean; name: string; reason?: string } {
  return ffmpegPath
    ? { available: true, name: 'ffmpeg' }
    : { available: false, name: 'ffmpeg', reason: 'No ffmpeg binary is available on this server.' };
}
