/**
 * Screenshots of this round's work, for looking at rather than asserting on.
 *
 * A test can tell you the Rotana loaded; only a picture tells you whether a
 * designer would want to work in it.
 */
import { chromium } from 'playwright';
import path from 'node:path';

const API = 'http://localhost:4100/api';
const WEB = process.env.NOVIRA_WEB ?? 'http://localhost:5174';
const OUT = process.env.SHOT_DIR ?? '.';

const api = async (p, o = {}, t) =>
  (
    await fetch(API + p, {
      ...o,
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...o.headers },
    })
  ).json();

const { token } = await api('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: 'planner@novira.test', password: 'novira123' }),
});

const venues = await api('/venue-specs?q=Almasi&limit=5', {}, token);
const almasi = venues.items.find((v) => /Almasi/i.test(v.name));

const project = await api(
  '/projects',
  { method: 'POST', body: JSON.stringify({ title: `Shots ${Date.now().toString(36)}` }) },
  token
);
const plan = await api(
  '/plans',
  { method: 'POST', body: JSON.stringify({ projectId: project.id, title: 'Almasi Ballroom' }) },
  token
);
await api(`/venue-specs/${almasi.id}/apply-to-plan`, { method: 'POST', body: JSON.stringify({ planId: plan.id }) }, token);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));

await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL(/\/(dashboard|projects)/, { timeout: 20000 });

const shot = async (name, target = page) => {
  const file = path.join(OUT, `${name}.png`);
  // A software renderer draws a building in seconds, so the default 30 s wait
  // for a settled frame is not enough; animations are stopped so the wait is
  // for the scene rather than for a CSS transition.
  await target.screenshot({ path: file, timeout: 180000, animations: 'disabled' });
  console.log('wrote', file);
};

async function ready(target = page, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await target
      .evaluate(() => {
        const c = document.querySelector('canvas');
        return Boolean(c && c.width > 100);
      })
      .catch(() => false);
    if (ok) {
      await target.waitForTimeout(6000);
      return;
    }
    await target.waitForTimeout(500);
  }
}

/* The building, in the studio. */
await page.goto(`${WEB}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
await ready();
const skip = page.getByRole('button', { name: 'Skip the tour' });
if (await skip.count()) {
  await skip.click().catch(() => {});
  await page.waitForTimeout(600);
}
await page.waitForTimeout(8000);
await shot('rotana-studio');

/* The venue library, showing what the record carries. */
await page.goto(`${WEB}/venues`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.fill('input[aria-label="Search venues"]', 'Johari');
await page.waitForTimeout(2500);
const detail = page.getByRole('button', { name: /Capacity, rules and warnings/i }).first();
if (await detail.count()) {
  await detail.click();
  await page.waitForTimeout(800);
}
await shot('venue-library');

/* Uploading a building. */
await page.getByRole('button', { name: /upload a building/i }).first().click();
await page.waitForTimeout(700);
await shot('venue-upload');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

/* Browsing the image libraries. */
await page.goto(`${WEB}/ai-studio`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const toImage = page.getByRole('button', { name: /2D|image|mock/i }).first();
if (await toImage.count()) await toImage.click().catch(() => {});
await page.waitForTimeout(1200);
const openPicker = page.getByRole('button', { name: /match the look of a reference/i }).first();
if (await openPicker.count()) {
  await openPicker.click();
  await page.waitForTimeout(16000);
  await shot('image-picker');

  // And a shelf other than the default, to prove the chips work.
  const chip = page.getByRole('button', { name: 'Stand design' }).first();
  if (await chip.count()) {
    await chip.click();
    await page.waitForTimeout(14000);
    await shot('image-picker-stands');
  }
  await page.keyboard.press('Escape');
}

/* The client's view of a shared plan. */
const share = await api(`/plans/${plan.id}/share`, { method: 'POST', body: JSON.stringify({}) }, token);
if (share.token) {
  // Give the client something to navigate with first.
  await page.goto(`${WEB}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
  await ready();
  const skip2 = page.getByRole('button', { name: 'Skip the tour' });
  if (await skip2.count()) await skip2.click().catch(() => {});
  await page.waitForTimeout(2000);

  // Two views from two angles, so the strip has something to show. The pause
  // between them lets the success toast clear — it is centred over the bar.
  for (let i = 0; i < 2; i++) {
    if (i) {
      const canvas = await page.locator('canvas').first().boundingBox();
      await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
      await page.mouse.down();
      await page.mouse.move(canvas.x + canvas.width / 2 + 220, canvas.y + canvas.height / 2 - 40, { steps: 20 });
      await page.mouse.up();
      await page.waitForTimeout(3000);
    }
    await page.getByRole('button', { name: /save view/i }).first().click({ timeout: 60000 });
    await page.waitForTimeout(6000);
  }
  await page.waitForTimeout(6000);

  const viewer = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await viewer.goto(`${WEB}/share/${share.token}`, { waitUntil: 'domcontentloaded' });
  await ready(viewer);
  await page.waitForTimeout(2000);
  await shot('share-views', viewer);
  await viewer.close();
}

await browser.close();
console.log('done');
