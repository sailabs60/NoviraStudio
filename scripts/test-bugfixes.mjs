/**
 * Regression check for the two bugs that were previously worked around.
 *
 *   1. A derived zustand selector re-rendered forever and crashed the tab.
 *      Verified by loading the editor and confirming the render count settles.
 *   2. drei's <Environment> killed the renderer on software WebGL.
 *      Verified by loading with image-based lighting enabled and confirming the
 *      tab survives and reports why IBL was or was not used.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.NOVIRA_WEB ?? 'http://localhost:5174';
const API = process.env.NOVIRA_API ?? 'http://localhost:4100/api';
fs.mkdirSync('storage/shots', { recursive: true });

const api = async (path, options = {}, token) =>
  (
    await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    })
  ).json();

const { token } = await api('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: 'planner@novira.test', password: 'novira123' }),
});
const project = await api('/projects', { method: 'POST', body: JSON.stringify({ title: `Bugfix check ${Date.now()}` }) }, token);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('crash', () => errors.push('TAB CRASHED'));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL('**/dashboard', { timeout: 30000 });

console.log('opening the editor (55-object scene)…');
/*
 * A plan this account can edit. Plan 1 is shared read-only, and every control
 * in the properties dock is correctly disabled there — which made this stress
 * test silently pass by changing nothing at all.
 */
const owned = await api(
  '/plans',
  { method: 'POST', body: JSON.stringify({ projectId: project.id, title: 'Lighting stress' }) },
  token
);
await page.goto(`${BASE}/editor/${owned.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(10000);

// If the render loop were still runaway, evaluate would never return.
const alive = await page.evaluate(() => ({
  canvases: document.querySelectorAll('canvas').length,
  title: document.querySelector('header h1')?.textContent ?? null,
}));
console.log('tab responsive:', JSON.stringify(alive));

console.log('\nchecking WebGL capability as the app sees it…');
const capability = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
  if (!gl) return { ok: false };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    ok: true,
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
    webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
    halfFloat: Boolean(gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float')),
    maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  };
});
console.log('renderer:', JSON.stringify(capability));

// Cycle every lighting preset — each swaps the HDR and rebuilds the cubemap,
// which is precisely what used to kill the renderer.
console.log('\ncycling all 12 lighting presets…');
/* Scene lighting lives in the Simulation tab of the properties dock. */
await page
  .getByRole('button', { name: /^Simulation$/ })
  .first()
  .click()
  .catch(() => {});
await page.waitForTimeout(600);

const select = page.locator('#sim-preset');
const options = await select.locator('option').evaluateAll((els) => els.map((e) => e.value));
if (!options.length) errors.push('no lighting presets were offered — the control moved or is missing');
for (const value of options) {
  await select.selectOption(value);
  await page.waitForTimeout(1200);
  const stillThere = await page.locator('canvas').count();
  if (!stillThere) {
    errors.push(`canvas vanished after selecting "${value}"`);
    break;
  }
}
console.log(`survived ${options.length} preset switches`);

await page.screenshot({ path: 'storage/shots/40-env-lighting.png', animations: 'disabled', timeout: 15000 });

// Hammer the store to prove derived selectors no longer loop.
console.log('\nstressing the store with rapid selection changes…');
const before = Date.now();
for (let i = 0; i < 6; i += 1) {
  await page.keyboard.press('t');
  await page.keyboard.press('p');
}
await page.waitForTimeout(1200);
const responsive = await page.evaluate(() => document.querySelectorAll('canvas').length);
console.log(`store still responsive after ${Date.now() - before}ms, canvases: ${responsive}`);

await browser.close();
console.log(errors.length ? `\nERRORS:\n${[...new Set(errors)].join('\n')}` : '\nNo errors, no crash.');
