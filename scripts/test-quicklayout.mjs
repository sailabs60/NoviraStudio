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

// Work in a fresh plan so the result is unambiguous.
await page.goto(`${BASE}/projects/1`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'New plan' }).click();
await page.waitForTimeout(600);
await page.fill('#plan-title', 'Quick Layout check');
await page.getByRole('button', { name: 'Create and open' }).click();
await page.waitForURL('**/editor/**', { timeout: 30000 });
await page.waitForTimeout(5000);

console.log('placing one chair…');
await page.getByRole('textbox', { name: 'Search the catalogue' }).fill('chair');
await page.waitForTimeout(1600);
/* Cards are figures now, and clicking one arms it for the next floor click. */
await page.locator('figure[role="button"]').first().click();
await page.waitForTimeout(400);
const box = await page.locator('canvas').first().boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.62);
await page.waitForTimeout(3500);
await shot('20-one-chair');

console.log('opening Quick Layout…');

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
await page.getByRole('button', { name: 'Quick Layout' }).click();
await page.waitForTimeout(1200);
await shot('21-quicklayout-open');

// Ceremony seating: an aisle of 24.
await page.getByRole('button', { name: 'Aisle', exact: true }).click();
await page.waitForTimeout(300);
const positions = page.locator('label:has-text("Positions") + input, input[type=number]').first();
await positions.fill('24');
await page.waitForTimeout(300);
await shot('22-quicklayout-aisle');

await page.getByRole('button', { name: 'Apply layout' }).click();
await page.waitForTimeout(5000);

const counter = await page.locator('text=/\\d+ objects/').first().textContent();
console.log('object counter:', counter);

await page.getByRole('button', { name: /^Plan$/ }).click();
await page.waitForTimeout(3000);
await shot('23-quicklayout-result');

await browser.close();
console.log(errors.length ? `errors: ${[...new Set(errors)].slice(0, 6).join(' | ')}` : 'No console errors.');
