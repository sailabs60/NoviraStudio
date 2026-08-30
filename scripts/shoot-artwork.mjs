/**
 * Screenshots of every surface that now carries photography.
 *
 * Artwork is the one kind of change a typecheck cannot judge at all: a file can
 * exist, be the right size, load without an error, and still be cropped through
 * somebody's head. These are for looking at.
 */
import { chromium } from 'playwright';
import path from 'node:path';

const API = 'http://localhost:4100/api';
const WEB = process.env.NOVIRA_WEB ?? 'http://localhost:5174';
const OUT = process.env.SHOT_DIR ?? '.';

const missing = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

// Any image that 404s is a wiring fault, not a design opinion — catch them all.
page.on('response', (r) => {
  if (r.status() >= 400 && /\.(jpg|png|webp|svg)$/i.test(new URL(r.url()).pathname)) {
    missing.push(`${r.status()} ${new URL(r.url()).pathname}`);
  }
});
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));

const shot = async (name, options = {}) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, timeout: 120000, animations: 'disabled', ...options });
  console.log('wrote', file);
};

/* ── Signed out ────────────────────────────────────────────────────────── */
await page.goto(`${WEB}/`, { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(4000);
await shot('art-landing-top');

for (const [name, y] of [
  ['art-landing-steps', 1400],
  ['art-landing-library', 3000],
  ['art-landing-materials', 4200],
  ['art-landing-deliverables', 5400],
  ['art-landing-who', 6400],
]) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
  await page.waitForTimeout(1800);
  await shot(name);
}

await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await shot('art-login');

/* ── Signed in ─────────────────────────────────────────────────────────── */
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL(/\/(dashboard|projects)/, { timeout: 20000 });
await page.waitForTimeout(2500);
await shot('art-dashboard');

for (const [name, route] of [
  ['art-venues', '/venues'],
  ['art-marketplace', '/marketplace'],
  ['art-specialists', '/specialists'],
  ['art-ai-studio', '/ai-studio'],
  ['art-help', '/help'],
]) {
  await page.goto(`${WEB}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await shot(name);
}

/* An empty project, for the plans empty state. */
const login = await (
  await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'planner@novira.test', password: 'novira123' }),
  })
).json();
const project = await (
  await fetch(`${API}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ title: `Artwork check ${Date.now().toString(36)}` }),
  })
).json();
await page.goto(`${WEB}/projects/${project.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await shot('art-empty-plans');

await browser.close();

console.log(missing.length ? `\nMISSING IMAGES:\n${[...new Set(missing)].join('\n')}` : '\nEvery image loaded.');
process.exitCode = missing.length ? 1 : 0;
