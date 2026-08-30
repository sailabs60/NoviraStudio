/**
 * Floor-plan import, calibration, and both routes out of it.
 *
 * The automatic tracer and its API endpoint were both built and working, and
 * there was no button anywhere that called them — the feature was unreachable.
 * This drives the flow the way a planner does, so an entry point that goes
 * missing again is caught.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const API = 'http://localhost:4100/api';
const WEB = process.env.NOVIRA_WEB ?? 'http://localhost:5174';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(path, options = {}, token) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  return res.json();
}

const { token } = await api('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: 'planner@novira.test', password: 'novira123' }),
});
const project = await api('/projects', {
  method: 'POST',
  body: JSON.stringify({ title: `Floorplan ${Date.now().toString(36)}` }),
}, token);
const plan = await api('/plans', {
  method: 'POST',
  body: JSON.stringify({ projectId: project.id, title: 'Traced' }),
}, token);

/*
 * A synthetic plan with known answers: a 900 × 600 px room outline with a
 * cross wall. Drawn here rather than shipped as a fixture so the expected
 * geometry is visible next to the assertions.
 */
function drawPlan() {
  const W = 900;
  const H = 600;
  const px = Buffer.alloc(W * H * 3, 0xff);
  const set = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    px[i] = 0;
    px[i + 1] = 0;
    px[i + 2] = 0;
  };
  const thick = 8;
  const hLine = (x0, x1, y) => {
    for (let x = x0; x <= x1; x += 1) for (let t = 0; t < thick; t += 1) set(x, y + t);
  };
  const vLine = (y0, y1, x) => {
    for (let y = y0; y <= y1; y += 1) for (let t = 0; t < thick; t += 1) set(x + t, y);
  };

  // Outline.
  hLine(60, 840, 60);
  hLine(60, 840, 540);
  vLine(60, 548, 60);
  vLine(60, 548, 840);
  // One interior partition.
  vLine(60, 548, 450);

  // Minimal PPM, which sharp reads happily.
  const header = Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii');
  return Buffer.concat([header, px]);
}

mkdirSync('storage/research', { recursive: true });
writeFileSync('storage/research/test-plan.ppm', drawPlan());

// Convert to PNG through the API's own image pipeline by uploading it.
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));

await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL(/\/(dashboard|projects)/, { timeout: 20000 });
await page.goto(`${WEB}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(16000);

/* Make a PNG in the browser, which avoids depending on a converter here. */
const pngBase64 = await page.evaluate(() => {
  const W = 900;
  const H = 600;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  const thick = 8;
  ctx.fillRect(60, 60, 781, thick);
  ctx.fillRect(60, 540, 781, thick);
  ctx.fillRect(60, 60, thick, 489);
  ctx.fillRect(840, 60, thick, 489);
  ctx.fillRect(450, 60, thick, 489);
  return c.toDataURL('image/png').split(',')[1];
});
writeFileSync('storage/research/test-plan.png', Buffer.from(pngBase64, 'base64'));

/* The first-run tour is another dialog; dismiss it before opening a modal. */
const skipTour = page.getByRole('button', { name: 'Skip the tour' });
if (await skipTour.count()) {
  await skipTour.click().catch(() => {});
  await page.waitForTimeout(500);
}

/* Drawing tools live under Create → Layout Tools in the studio. */
await page
  .getByRole('navigation', { name: 'Editor sections' })
  .getByRole('button', { name: /^Create/ })
  .click();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: /Layout Tools/ }).click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: /Import a drawing or image/ }).click();
await page.waitForTimeout(1500);
record('import dialog opens', (await page.locator('div[role="dialog"]').count()) > 0);

await page.locator('div[role="dialog"] >> text=/Floor plan|floor plan/i').first().click().catch(() => {});
await page.waitForTimeout(1200);

const chooser = page.waitForEvent('filechooser');
await page.locator('div[role="dialog"] button:has-text("Choose a drawing")').click();
(await chooser).setFiles('storage/research/test-plan.png');
await page.waitForTimeout(5000);

const calText = await page.locator('div[role="dialog"]').innerText().catch(() => '');
record('calibration step appears', /scale|distance/i.test(calText),
  calText.replace(/\s+/g, ' ').slice(0, 70));

/* Two clicks across the known 780 px span, then state the real distance. */
const img = await page.locator('div[role="dialog"] img').first().boundingBox();
if (img) {
  // The outline runs from x=60 to x=840 of 900, i.e. 6.7% to 93.3%.
  await page.mouse.click(img.x + img.width * 0.067, img.y + img.height * 0.12);
  await page.waitForTimeout(600);
  await page.mouse.click(img.x + img.width * 0.933, img.y + img.height * 0.12);
  await page.waitForTimeout(900);

  const selected = await page.locator('div[role="dialog"]').innerText();
  record('two points give a pixel length', /\d+(\.\d+)?\s*px/i.test(selected),
    selected.match(/[\d.]+\s*px/i)?.[0] ?? 'none');

  await page.locator('#real-distance').fill('20');
  await page.waitForTimeout(800);

  const scaleNote = await page.locator('div[role="dialog"]').innerText();
  record('the scale is reported back', /1 px =/.test(scaleNote),
    scaleNote.match(/1 px = [\d.]+ mm/)?.[0] ?? '');
}

/* Both routes must be offered — this is what was missing entirely. */
const manual = await page.locator('div[role="dialog"] button:has-text("Trace by hand")').count();
const auto = await page.locator('div[role="dialog"] button:has-text("Trace for me")').count();
record('a manual route is offered', manual > 0);
record('an automatic route is offered', auto > 0);

if (auto > 0) {
  await page.locator('div[role="dialog"] button:has-text("Trace for me")').click();

  let done = false;
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(1000);
    if (!(await page.locator('div[role="dialog"]').count())) { done = true; break; }
    const err = await page.locator('div[role="dialog"] .notice-error').count();
    if (err) break;
  }
  record('the trace runs to completion', done);

  await page.waitForTimeout(2000);
  await page.locator('button:has-text("Save")').first().click().catch(() => {});
  await page.waitForTimeout(2500);

  const scene = (await api(`/plans/${plan.id}`, {}, token)).scene;
  const segments = scene.walls?.segments ?? [];
  record('walls land in the plan', segments.length > 0, `${segments.length} segments`);

  /*
   * The drawing is 20 ft across its 780 px outline, so the traced room should
   * measure about 6.1 m. Checking the number, not just the count, is the point:
   * a tracer that finds walls in the wrong place is worse than one that finds
   * none.
   */
  if (segments.length) {
    const xs = segments.flatMap((s) => [s.start.xMm, s.end.xMm]);
    const width = Math.max(...xs) - Math.min(...xs);
    const expected = 20 * 304.8;
    record('the traced room is the size the scale says',
      Math.abs(width - expected) < expected * 0.12,
      `${(width / 1000).toFixed(2)} m traced, ${(expected / 1000).toFixed(2)} m expected`);
  }

  record('the plan image is placed behind the walls', Boolean(scene.floorPlan?.imageUrl));
}

await page.screenshot({ path: 'storage/shots/106-floorplan.png' });
await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} floor-plan checks passed.`);
if (errors.length) console.log(`\nerrors:\n${[...new Set(errors)].slice(0, 4).join('\n')}`);
process.exit(passed === results.length ? 0 : 1);
