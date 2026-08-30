/**
 * Capture each procedural builder on its own, framed.
 *
 * One object per plan and the camera fitted to it, because the point is to see
 * whether the thing looks like what it claims to be — which a crowded scene
 * viewed from a fixed camera cannot answer.
 */
import { chromium } from 'playwright';

const API = 'http://localhost:4100/api';
const WEB = process.env.NOVIRA_WEB ?? 'http://localhost:5174';

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
  body: JSON.stringify({ title: `Shots ${Date.now().toString(36)}` }),
}, token);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));

await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL(/\/(dashboard|projects)/, { timeout: 20000 });

async function freshPlan(title) {
  const plan = await api('/plans', {
    method: 'POST',
    body: JSON.stringify({ projectId: project.id, title }),
  }, token);
  await page.goto(`${WEB}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(16000);
  return plan;
}

const fit = async () => {
  // Deselect first: a selected object renders in the highlight colour, which
  // hides whatever the shot was meant to show.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.locator('button[title^="Fit everything"]').click().catch(() => {});
  await page.waitForTimeout(3000);
};

/* ── Tent ────────────────────────────────────────────────────────────────── */
await freshPlan('Tent shot');
await page.locator('button:has-text("Tent")').first().click();
await page.waitForTimeout(2000);
await page.locator('div[role="dialog"] button').filter({ hasText: /Frame Tent 30 × 40/ }).first().click();
await page.waitForTimeout(3500);
await fit();
await page.screenshot({ path: 'storage/shots/97-tent.png' });
console.log('captured tent');

/* ── Stage ───────────────────────────────────────────────────────────────── */
await freshPlan('Stage shot');
await page.locator('button:has-text("Stage")').first().click();
await page.waitForTimeout(3500);
await fit();
await page.screenshot({ path: 'storage/shots/98-stage.png' });
console.log('captured stage');

/* ── Drape ───────────────────────────────────────────────────────────────── */
await freshPlan('Drape shot');
await page.locator('button:has-text("Drape")').first().click();
await page.waitForTimeout(3500);
await fit();
await page.screenshot({ path: 'storage/shots/99-drape.png' });
console.log('captured drape');

/* ── Venue ───────────────────────────────────────────────────────────────── */
await freshPlan('Venue shot');
await page.locator('button[title="Generate a venue"]').click();
await page.waitForTimeout(2500);
// Marquee: the style where the roof shape is most obvious.
await page.locator('div[role="dialog"] button:has-text("Marquee")').first().click();
await page.waitForTimeout(1500);
await page.locator('div[role="dialog"] button:has-text("Generate")').click();
for (let i = 0; i < 45; i += 1) {
  await page.waitForTimeout(1000);
  if (await page.locator('div[role="dialog"] >> text=/Venue built/').count()) break;
}
await page.locator('div[role="dialog"] button:has-text("Add to plan")').click();
await page.waitForTimeout(4000);
await fit();
await page.screenshot({ path: 'storage/shots/100-venue.png' });
console.log('captured venue');

/* ── The layout picker's diagrams ────────────────────────────────────────── */
await page.locator('canvas').click({ position: { x: 400, y: 400 } }).catch(() => {});
await page.waitForTimeout(1500);
await page.locator('button:has-text("Quick Layout")').first().click().catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: 'storage/shots/101-layout-picker.png' });
console.log('captured layout picker');

await browser.close();
console.log('errors:', errors.length ? [...new Set(errors)].slice(0, 4) : 'none');
