/**
 * Frames from the reference product's HLS-only demo videos.
 *
 * Five of the six videos are served as HLS behind a signed CDN URL, so neither
 * a plain download nor ffmpeg on its own can reach them: the signature is
 * minted by the embed player at load time and expires.
 *
 * So the browser gets the URL and ffmpeg does the decoding. Playwright loads
 * the embed and intercepts the signed `.m3u8` request.
 *
 * Handing that URL straight to ffmpeg still fails, and the reason is worth
 * recording: the playlist lists its segments by bare filename, so ffmpeg
 * resolves them against the playlist URL **without** its query string and
 * every segment request arrives unsigned. The playlist is therefore fetched
 * here, each segment rewritten to an absolute URL carrying the same
 * signature, and the rewritten copy handed to ffmpeg.
 *
 * Reading frames out of the rendered player was the earlier approach; it
 * reported a five-second duration because the player only knows about the
 * range it has buffered, not the whole stream.
 *
 *   node scripts/research-hls.mjs                 all five, one frame per 3s
 *   node scripts/research-hls.mjs --fps 1         denser
 *   node scripts/research-hls.mjs --video 3
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const VIDEOS = [
  { index: 1, id: '4857175e21044de2b3b4787cd7778096' },
  { index: 2, id: 'ebf557352ed2446cac70b22fc4370c6e' },
  { index: 3, id: '67cf14b3eca64bebb195bcea714076f2' },
  { index: 4, id: 'ab305e241dd34aceaf7d166a1c8dcf82' },
  { index: 5, id: 'bd86717b908b4456b990bd86be7f69e7' },
];

const OUT = 'storage/research/frames';
const argv = process.argv.slice(2);
const only = argv.indexOf('--video') >= 0 ? Number(argv[argv.indexOf('--video') + 1]) : null;
/** Frames per second to sample. 1/3 keeps a 10-minute video to ~200 frames. */
const fps = argv.indexOf('--fps') >= 0 ? Number(argv[argv.indexOf('--fps') + 1]) : 1 / 3;

/**
 * Get the signed playlist URL by loading the embed and watching the network.
 *
 * The signature is tied to the session the player opens, so it has to be taken
 * live rather than constructed.
 */
async function signedPlaylist(browser, id) {
  const page = await browser.newPage();
  const found = [];
  page.on('request', (r) => {
    const url = r.url();
    // The video-only playlist, not the master and not the audio track.
    if (url.includes('.m3u8') && url.includes('Signature=')) found.push(url);
  });

  try {
    await page.goto(`https://www.loom.com/embed/${id}?hideEmbedTopBar=true`, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.waitForTimeout(8000);
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) {
        v.muted = true;
        void v.play().catch(() => {});
      }
    });
    await page.waitForTimeout(7000);
  } catch {
    /* whatever was captured before the failure is still usable */
  } finally {
    await page.close();
  }

  // Prefer the video-only rendition; ffmpeg then has no audio to negotiate.
  return found.find((u) => u.includes('-video0.m3u8')) ?? found[0] ?? null;
}

/**
 * Rewrite a signed HLS playlist so its segments are signed too.
 *
 * CloudFront signs the playlist URL, but the playlist names its segments as
 * bare filenames. Any player resolving those relative to the playlist drops
 * the query string, and every segment then comes back 403. Browsers get away
 * with it because the player carries the signature forward itself.
 */
async function localisePlaylist(playlistUrl, index) {
  const res = await fetch(playlistUrl, {
    headers: {
      Referer: 'https://www.loom.com/',
      Origin: 'https://www.loom.com',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  if (!res.ok) return null;

  const body = await res.text();
  const url = new URL(playlistUrl);
  /*
   * Strip the query before looking for the last slash. A CloudFront signature
   * is base64 and routinely contains "/", so searching the whole href finds a
   * slash inside the signature and produces a base URL that is nonsense — the
   * segments then download as HTML error pages, which ffmpeg reports as
   * "Invalid data found" rather than as a 403.
   */
  const withoutQuery = url.origin + url.pathname;
  const base = withoutQuery.slice(0, withoutQuery.lastIndexOf('/') + 1);
  const query = url.search;

  const rewritten = body
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      // A segment line. Make it absolute and carry the signature across.
      if (/^https?:/i.test(trimmed)) return trimmed;
      return `${base}${trimmed}${query}`;
    })
    .join('\n');

  const file = path.join(OUT, `.playlist-${index}.m3u8`);
  await writeFile(file, rewritten);
  return file;
}

function runFfmpeg(args) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('close', (code) => resolve({ code, stderr }));
    child.on('error', () => resolve({ code: -1, stderr }));
  });
}

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const manifest = [];

for (const { index, id } of VIDEOS) {
  if (only !== null && only !== index) continue;

  const playlist = await signedPlaylist(browser, id);
  if (!playlist) {
    console.log(`video ${index}: no signed playlist captured`);
    continue;
  }

  /*
   * Reading a local playlist that points at https needs the protocols spelled
   * out. Without it ffmpeg refuses to follow the segment URLs and reports
   * "Invalid data found", which reads like a corrupt stream rather than the
   * policy refusal it actually is. The signature alone satisfies the CDN once
   * the segment URLs carry it, so no referer is needed.
   */
  const whitelist = ['-protocol_whitelist', 'file,http,https,tcp,tls,crypto'];

  const local = await localisePlaylist(playlist, index);
  if (!local) {
    console.log(`video ${index}: could not fetch the playlist`);
    continue;
  }

  const probe = await runFfmpeg([
    '-hide_banner',
    ...whitelist,
    '-i', local,
    '-f', 'null', '-',
  ]);
  const duration = /Duration: (\d+):(\d+):(\d+)/.exec(probe.stderr);
  const seconds = duration
    ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
    : 0;

  if (!seconds) {
    console.log(`video ${index}: could not read duration`);
    console.log(probe.stderr.split('\n').filter((l) => /error|403|404/i.test(l)).slice(0, 2).join('\n'));
    continue;
  }

  console.log(`video ${index} (${id.slice(0, 8)}): ${seconds}s`);

  const before = new Set(await readdir(OUT));

  const extract = await runFfmpeg([
    '-hide_banner',
    ...whitelist,
    '-i', local,
    '-vf', `fps=${fps}`,
    '-q:v', '3',
    path.join(OUT, `v${index}-%04d.jpg`),
  ]);

  const after = await readdir(OUT);
  const written = after.filter((f) => !before.has(f) && f.startsWith(`v${index}-`));

  if (extract.code !== 0 && !written.length) {
    console.log(`  extraction failed:`);
    console.log(
      extract.stderr.split('\n').filter((l) => /error|403|404|invalid/i.test(l)).slice(0, 3).join('\n')
    );
    continue;
  }

  console.log(`  ${written.length} frames written`);
  manifest.push({ index, id, seconds, frames: written.length });
}

await browser.close();

// The rewritten playlists carry short-lived signatures; there is no reason to
// leave them lying around.
for (const file of await readdir(OUT)) {
  if (file.startsWith('.playlist-')) await rm(path.join(OUT, file), { force: true });
}

await writeFile(
  path.join(OUT, 'hls-manifest.json'),
  JSON.stringify(manifest, null, 2)
);
console.log(`\n${manifest.reduce((n, m) => n + m.frames, 0)} frames added`);
