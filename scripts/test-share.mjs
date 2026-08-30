/**
 * End-to-end check of share and export: create a link from the editor, then
 * open it in a clean browser context with no session at all.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.NOVIRA_WEB ?? 'http://localhost:5174';
fs.mkdirSync('storage/shots', { recursive: true });

const browser = await chromium.launch();
const errors = [];

// ── 1. signed-in planner creates the link ──────────────────────────────────
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`editor: ${e.message}`));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL('**/dashboard', { timeout: 30000 });

/*
 * A plan of its own rather than the largest seeded one.
 *
 * This is what makes the run reliable: sharing does not care what is in the
 * scene, and pointing the test at the heaviest demo layout meant it was really
 * measuring how fast a headless software rasteriser can draw twenty-six models
 * — which on a machine with no GPU is slow enough that clicks never land.
 */
const token = await page.evaluate(() => localStorage.getItem('novira.token'));
const authed = (path, body) =>
  fetch(`${process.env.NOVIRA_API ?? 'http://localhost:4100/api'}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const project = await authed('/projects', { title: `Share check ${Date.now()}` });
const plan = await authed('/plans', { projectId: project.id, title: 'Share check' });

await page.goto(`${BASE}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('nav[aria-label="Editor sections"]', { timeout: 30000 });
await page.waitForTimeout(3000);

console.log('opening share…');

/** The first-run tour covers part of the editor; dismiss it as a person would. */
async function dismissTour(page) {
  const skip = page.getByRole('button', { name: 'Skip the tour' });
  try {
    await skip.waitFor({ timeout: 6000 });
    await skip.click();
    await page.waitForTimeout(400);
  } catch {
    /* already dismissed on this profile */
  }
}

await dismissTour(page);
await page.getByRole('button', { name: 'Share' }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: 'storage/shots/30-share-dialog.png', animations: 'disabled', timeout: 15000 });

const link = await page.locator('input[readonly]').first().inputValue();
console.log('share url:', link);

console.log('switching to embed…');
await page.getByRole('button', { name: 'Embed instead' }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: 'storage/shots/31-embed-dialog.png', animations: 'disabled', timeout: 15000 });
const iframe = await page.locator('textarea').first().inputValue();
console.log('iframe snippet:', iframe.slice(0, 110), '…');

await ctx.close();

// ── 2. an anonymous visitor opens it ───────────────────────────────────────
console.log('\nopening the link with no session…');
const anon = await browser.newContext({ viewport: { width: 1280, height: 820 } });
const guest = await anon.newPage();
guest.on('pageerror', (e) => errors.push(`share: ${e.message}`));

await guest.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
await guest.waitForTimeout(8000);
await guest.screenshot({ path: 'storage/shots/32-share-public.png', animations: 'disabled', timeout: 15000 });

const heading = await guest.locator('header h1').first().textContent().catch(() => null);
const badge = await guest.locator('text=View only').first().textContent().catch(() => null);
const footer = await guest.locator('footer').first().textContent().catch(() => null);
console.log('viewer heading:', heading);
console.log('viewer badge  :', badge);
console.log('viewer footer :', footer);

// Editing chrome must not be present for a viewer.
const hasCatalog = await guest.locator('button:has-text("Table Designer")').count();
const hasSave = await guest.getByRole('button', { name: 'Save' }).count();
console.log('editor chrome present? catalog:', hasCatalog, 'save:', hasSave);

await browser.close();
console.log(errors.length ? `\nerrors:\n${[...new Set(errors)].join('\n')}` : '\nNo page errors.');
