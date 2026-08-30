/**
 * Frames from the reference product's demo videos that are only served as HLS.
 *
 * The first video hands out a plain mp4, which `research-frames.mjs` decodes
 * directly. The remaining five are HLS-only, and with no ffmpeg here the
 * practical route is to let the player decode them and screenshot the video
 * element as it goes.
 *
 * Screenshotting the element rather than the page keeps the player's own chrome
 * out of the frame, so what lands on disk is the product UI.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const IDS = [
  { index: 1, id: '4857175e21044de2b3b4787cd7778096' },
  { index: 2, id: 'ebf557352ed2446cac70b22fc4370c6e' },
  { index: 3, id: '67cf14b3eca64bebb195bcea714076f2' },
  { index: 4, id: 'ab305e241dd34aceaf7d166a1c8dcf82' },
  { index: 5, id: 'bd86717b908b4456b990bd86be7f69e7' },
];

const OUT = 'storage/research/frames';
const argv = process.argv.slice(2);
const only = argv.indexOf('--video') >= 0 ? Number(argv[argv.indexOf('--video') + 1]) : null;
const interval = argv.indexOf('--interval') >= 0 ? Number(argv[argv.indexOf('--interval') + 1]) : 4;

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let total = 0;

for (const { index, id } of IDS) {
  if (only !== null && only !== index) continue;

  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`https://www.loom.com/embed/${id}?hideEmbedTopBar=true&hide_owner=true&hide_share=true`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(6000);

  const video = page.locator('video').first();
  if (!(await video.count())) {
    console.log(`video ${index}: no player`);
    await page.close();
    continue;
  }

  // Start it, then drive by seeking rather than watching in real time.
  const duration = await page
    .evaluate(async () => {
      const v = document.querySelector('video');
      if (!v) return 0;
      try {
        await v.play();
      } catch {
        /* autoplay may still be blocked; seeking works regardless */
      }
      v.muted = true;
      for (let i = 0; i < 40 && !Number.isFinite(v.duration); i += 1) {
        await new Promise((r) => setTimeout(r, 250));
      }
      return Number.isFinite(v.duration) ? v.duration : 0;
    })
    .catch(() => 0);

  if (!duration) {
    console.log(`video ${index}: no duration`);
    await page.close();
    continue;
  }

  console.log(`video ${index} (${id.slice(0, 8)}): ${duration.toFixed(0)}s`);

  let saved = 0;
  for (let t = 1; t < duration; t += interval) {
    await page.evaluate(async (time) => {
      const v = document.querySelector('video');
      if (!v) return;
      await new Promise((resolve) => {
        const done = () => {
          v.removeEventListener('seeked', done);
          resolve();
        };
        v.addEventListener('seeked', done);
        v.currentTime = time;
        setTimeout(resolve, 4000);
      });
      // HLS needs a moment after the seek for the segment to paint.
      await new Promise((r) => setTimeout(r, 350));
    }, t);

    const shot = await video.screenshot({ timeout: 15000 }).catch(() => null);
    if (!shot || shot.length < 4000) continue;

    await writeFile(path.join(OUT, `v${index}-${String(Math.round(t)).padStart(4, '0')}s.jpg`), shot);
    saved += 1;
  }

  console.log(`  ${saved} frames written`);
  total += saved;
  await page.close();
}

await browser.close();
console.log(`\n${total} frames added to ${OUT}`);
