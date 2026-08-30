/**
 * The three builders end to end: insert a tent, a stage and a drape, then
 * exercise the controls that make each of them worth having.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.NOVIRA_WEB ?? 'http://localhost:5174';
fs.mkdirSync('storage/shots', { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const shot = (n) =>
  page.screenshot({ path: `storage/shots/${n}.png`, animations: 'disabled', timeout: 15000 });

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL('**/dashboard', { timeout: 30000 });

await page.goto(`${BASE}/projects/1`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'New plan' }).click();
await page.waitForTimeout(600);
await page.fill('#plan-title', 'Builders check');
await page.getByRole('button', { name: 'Create and open' }).click();
await page.waitForURL('**/editor/**', { timeout: 30000 });
await page.waitForTimeout(5000);


/*
 * The editor's tools now live behind a named left rail rather than in one
 * catalogue sidebar. Opening the right section is the first step of every
 * interaction, so it is a helper.
 */
async function openSection(page, label) {
  const skip = page.getByRole('button', { name: 'Skip the tour' });
  try {
    await skip.waitFor({ timeout: 6000 });
    await skip.click();
    await page.waitForTimeout(400);
  } catch {
    /* the tour has already been dismissed on this profile */
  }
  await page
    .getByRole('navigation', { name: 'Editor sections' })
    .getByRole('button', { name: new RegExp(`^${label}`) })
    .click();
  await page.waitForTimeout(800);
}

/* ── Stage ───────────────────────────────────────────────────────────── */
console.log('inserting a stage…');
await openSection(page, 'Build');
await page.getByRole('radio', { name: /^Stage/ }).first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: /^Add a stage/ }).click();
await page.waitForTimeout(4000);
await shot('60-stage');

const summary = await page.locator('section:has-text("Summary")').first().textContent();
console.log('summary:', summary?.replace(/\s+/g, ' ').slice(0, 150));

const bom = await page.locator('section:has-text("Derived parts list") table').first().textContent();
console.log('parts list:', bom?.replace(/\s+/g, ' ').slice(0, 220));

console.log('\nraising the stage to trigger the rail-type switch and warnings…');
const heightField = page.locator('section:has-text("Deck height") input').first();
await heightField.fill("4'");
await heightField.press('Enter');
await page.waitForTimeout(3000);

const summary2 = await page.locator('section:has-text("Summary")').first().textContent();
console.log('summary now:', summary2?.replace(/\s+/g, ' ').slice(0, 150));
const safety = await page.locator('section:has-text("Safety")').first().textContent().catch(() => null);
console.log('safety:', safety?.replace(/\s+/g, ' ').slice(0, 240));
await shot('61-stage-tall');

/* ── Tent ────────────────────────────────────────────────────────────── */
console.log('\ninserting a tent…');
await page.keyboard.press('Escape');
await page.getByRole('radio', { name: /Tents & drapes/ }).first().click();
await page.waitForTimeout(1200);
await shot('62-tent-picker');
await page.getByRole('button', { name: /Frame Tent 30 × 40/ }).click();
await page.waitForTimeout(4500);

const tentInfo = await page.locator('section:has-text("Sidewalls")').last().textContent();
console.log('tent sidewalls:', tentInfo?.replace(/\s+/g, ' ').slice(0, 160));
await shot('63-tent');

console.log('filling the east side with cathedral windows…');
await page.locator('section:has-text("Sidewalls") select').selectOption('cathedral');
await page.waitForTimeout(400);
await page.locator('section:has-text("Sidewalls") button:has-text("east")').click();
await page.waitForTimeout(2500);
const tentInfo2 = await page.locator('section:has-text("Sidewalls")').first().textContent();
console.log('after fill:', tentInfo2?.replace(/\s+/g, ' ').slice(0, 160));
await shot('64-tent-walls');

console.log('hiding the canopy…');
await page.getByRole('button', { name: 'Hide canopy' }).click();
await page.waitForTimeout(2500);
await shot('65-tent-canopy-hidden');

/* ── Drape ───────────────────────────────────────────────────────────── */
console.log('\ninserting a drape…');
await page.keyboard.press('Escape');
await page.locator('canvas').first().click({ position: { x: 60, y: 60 } });
await page.waitForTimeout(600);
await page.getByRole('radio', { name: /Tents & drapes/ }).first().click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: /^Add a drape/ }).click();
await page.waitForTimeout(4000);
const curtainInfo = await page.locator('section:has-text("Curtain shape")').first().textContent();
console.log('curtain:', curtainInfo?.replace(/\s+/g, ' ').slice(0, 180));
await shot('66-drape');

console.log('reshaping it — wider top, narrower bottom, deeper curve…');
const fields = page.locator('section:has-text("Curtain shape") input');
await fields.nth(0).fill("18'");
await fields.nth(0).press('Enter');
await page.waitForTimeout(700);
await fields.nth(1).fill("10'");
await fields.nth(1).press('Enter');
await page.waitForTimeout(700);
await fields.nth(4).fill("3'");
await fields.nth(4).press('Enter');
await page.waitForTimeout(2500);
await shot('67-drape-shaped');

const counter = await page.locator('text=/\\d+ objects/').first().textContent();
console.log('\nobjects in scene:', counter);

await browser.close();
console.log(errors.length ? `\nerrors: ${[...new Set(errors)].slice(0, 6).join(' | ')}` : '\nNo console errors.');
