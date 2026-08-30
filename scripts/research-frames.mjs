/**
 * Pull frames out of the reference product's demo videos.
 *
 * There is no ffmpeg on this machine, so frames are taken the way a browser
 * can: load the mp4 into a <video>, seek to a timestamp, draw that frame onto a
 * canvas, and read the pixels back. It is slower than a real decoder but it is
 * exact — the frame captured is the frame at that timestamp.
 *
 *   node scripts/research-frames.mjs                  every video, every 2s
 *   node scripts/research-frames.mjs --video 3        just the fourth one
 *   node scripts/research-frames.mjs --interval 1     denser sampling
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const LOOM_IDS = [
  '0857858c4b3a4b5b8acd5ab0008aa2d4',
  '4857175e21044de2b3b4787cd7778096',
  'ebf557352ed2446cac70b22fc4370c6e',
  '67cf14b3eca64bebb195bcea714076f2',
  'ab305e241dd34aceaf7d166a1c8dcf82',
  'bd86717b908b4456b990bd86be7f69e7',
];

const OUT = 'storage/research/frames';

const argv = process.argv.slice(2);
const only = argv.indexOf('--video') >= 0 ? Number(argv[argv.indexOf('--video') + 1]) : null;
const interval = argv.indexOf('--interval') >= 0 ? Number(argv[argv.indexOf('--interval') + 1]) : 2;

/** Loom hands out a signed CDN URL; it expires, so fetch it right before use. */
async function transcodedUrl(id) {
  const res = await fetch(`https://www.loom.com/api/campaigns/sessions/${id}/transcoded-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: '{}',
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body?.url ?? null;
}

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const manifest = [];

for (const [index, id] of LOOM_IDS.entries()) {
  if (only !== null && only !== index) continue;

  const url = await transcodedUrl(id);
  if (!url) {
    console.log(`video ${index}: no transcoded URL (${id})`);
    continue;
  }

  // A bare page holding one video element, sized to the video's own pixels so
  // nothing is scaled and no UI detail is lost.
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#000">
       <video id="v" crossorigin="anonymous" preload="auto" style="display:block"></video>
       <canvas id="c" style="display:none"></canvas>
     </body></html>`
  );

  const meta = await page.evaluate(async (src) => {
    const video = document.getElementById('v');
    video.src = src;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('load failed'));
      setTimeout(() => reject(new Error('timeout')), 60000);
    });
    return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
  }, url).catch((e) => ({ error: String(e) }));

  if (meta.error || !meta.duration) {
    console.log(`video ${index}: could not load — ${meta.error ?? 'no duration'}`);
    continue;
  }

  console.log(
    `video ${index} (${id.slice(0, 8)}): ${meta.duration.toFixed(0)}s at ${meta.width}×${meta.height}`
  );

  const stamps = [];
  for (let t = 0.5; t < meta.duration; t += interval) stamps.push(Number(t.toFixed(2)));

  let saved = 0;
  for (const t of stamps) {
    const dataUrl = await page.evaluate(async (time) => {
      const video = document.getElementById('v');
      const canvas = document.getElementById('c');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      await new Promise((resolve) => {
        // `seeked` is the only reliable signal that the frame is decoded and
        // ready; drawing before it yields the previous frame or a blank one.
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = time;
        setTimeout(resolve, 5000);
      });

      canvas.getContext('2d').drawImage(video, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.86);
    }, t);

    const buffer = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
    if (buffer.length < 3000) continue;

    const name = `v${index}-${String(Math.round(t)).padStart(4, '0')}s.jpg`;
    await writeFile(path.join(OUT, name), buffer);
    saved += 1;
  }

  manifest.push({ index, id, duration: meta.duration, frames: saved });
  console.log(`  ${saved} frames written`);
}

await browser.close();
await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n${manifest.reduce((n, m) => n + m.frames, 0)} frames in ${OUT}`);
