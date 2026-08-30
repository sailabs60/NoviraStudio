/**
 * Walls end to end: draw a closed run by clicking, confirm the floor is derived,
 * then drop a Quick Room and edit a segment.
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

// Fresh plan so the result is unambiguous.
await page.goto(`${BASE}/projects/1`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'New plan' }).click();
await page.waitForTimeout(600);
await page.fill('#plan-title', 'Wall check');
await page.getByRole('button', { name: 'Create and open' }).click();
await page.waitForURL('**/editor/**', { timeout: 30000 });
await page.waitForTimeout(5000);

// Draw from directly above so screen space maps predictably to the floor.

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
await page.getByRole('button', { name: /^Plan$/ }).click();
await page.waitForTimeout(2500);

console.log('activating the wall tool…');
/*
 * Reached through the studio's own navigation: Create → Layout Tools. There is
 * no floating toolbar button any more — the drawing and arrangement tools live
 * with everything else you put into a room.
 */
await page
  .getByRole('navigation', { name: 'Editor sections' })
  .getByRole('button', { name: /^Create/ })
  .click();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: /Layout Tools/ }).click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: /^Walls/ }).first().click();
await page.waitForTimeout(900);
await shot('50-wall-panel');

await page.locator('button[title="Start creating"]').click();
await page.waitForTimeout(500);

const box = await page.locator('canvas').first().boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
const d = 150;

console.log('clicking four corners, then closing on the first…');
const corners = [
  [cx - d, cy - d],
  [cx + d, cy - d],
  [cx + d, cy + d],
  [cx - d, cy + d],
];
for (const [x, y] of corners) {
  await page.mouse.click(x, y);
  await page.waitForTimeout(500);
}
await shot('51-wall-drawing');

// Clicking the first corner again should close the loop.
await page.mouse.click(corners[0][0], corners[0][1]);
await page.waitForTimeout(2500);

const segCount = await page.locator('text=/Segments:/').first().textContent();
console.log('after closing:', segCount?.trim());

const floorText = await page
  .locator('section:has-text("Floor")')
  .last()
  .textContent()
  .catch(() => null);
console.log('floor section says:', floorText?.replace(/\s+/g, ' ').slice(0, 140));

await shot('52-wall-closed');

console.log('\nadding a Quick Room…');
await page.getByRole('button', { name: 'Create room' }).click();
await page.waitForTimeout(2500);
const segCount2 = await page.locator('text=/Segments:/').first().textContent();
console.log('after Quick Room:', segCount2?.trim());
await shot('53-wall-quickroom');

console.log('\nselecting a wall segment…');
await page.mouse.click(cx, cy - d);
await page.waitForTimeout(1500);
const editText = await page
  .locator('section:has-text("Edit wall")')
  .first()
  .textContent()
  .catch(() => null);
console.log('edit panel:', editText?.replace(/\s+/g, ' ').slice(0, 160));
await shot('54-wall-selected');

// Perspective view so the extrusion is visible.
await page.getByRole('button', { name: /^3D$/ }).click();
await page.waitForTimeout(3500);
await shot('55-wall-3d');

await browser.close();
console.log(errors.length ? `\nerrors: ${[...new Set(errors)].slice(0, 6).join(' | ')}` : '\nNo console errors.');
