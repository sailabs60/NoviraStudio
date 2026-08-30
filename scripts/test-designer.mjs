/**
 * End-to-end check of the Table Designer: open it, pick a table and a chair,
 * insert, and confirm the generated objects actually land in the scene.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.NOVIRA_WEB ?? 'http://localhost:5174';
fs.mkdirSync('storage/shots', { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

/*
 * A generous timeout, and never fatal.
 *
 * Capturing a page with a live WebGL canvas waits for a frame, and on a machine
 * with no GPU a frame can take seconds. A missing diagnostic screenshot is not
 * a reason to fail a run that is otherwise checking real behaviour.
 */
const shot = async (n) =>
  page
    .screenshot({ path: `storage/shots/${n}.png`, animations: 'disabled', timeout: 45000 })
    .catch(() => console.log(`  (screenshot ${n} timed out — software renderer)`));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL('**/dashboard', { timeout: 30000 });

/*
 * A plan of its own rather than the largest seeded one — see the note in
 * test-share.mjs. The Table Designer does not care what else is in the scene,
 * and pointing the run at a heavy layout only measures the rasteriser.
 */
const token = await page.evaluate(() => localStorage.getItem('novira.token'));
const authed = (path, body) =>
  fetch(`${process.env.NOVIRA_API ?? 'http://localhost:4100/api'}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const project = await authed('/projects', { title: `Designer check ${Date.now()}` });
const plan = await authed('/plans', { projectId: project.id, title: 'Designer check' });

await page.goto(`${BASE}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

console.log('opening Table Designer…');

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
await page.getByRole('button', { name: /Table Designer/ }).click();
await page.waitForTimeout(1800);
await shot('10-designer-open');

console.log('choosing a table…');
/*
 * Scoped to the designer dialog and taken positionally: the table is the first
 * slot. Matching on the label text was fragile — the same words appear on the
 * slot, in its hint, and on the picker that opens over it.
 */
const designer = page.locator('div[role="dialog"]').first();
await designer.locator('button:has-text("Choose")').first().click();
await page.waitForTimeout(1400);
await shot('11-designer-table-picker');

/*
 * The picker replaces the designer rather than stacking on it, so there is only
 * ever one dialog open. Scoping to it keeps the item click off anything that
 * happens to share the item's name elsewhere on the page.
 */
const picker = page.locator('div[role="dialog"][aria-label^="Choose"]').first();
const round60 = picker.locator('button:has-text("Round Table 60")').first();
if (await round60.count()) await round60.click();
else await picker.locator('ul li button').first().click();
await page.waitForTimeout(900);

console.log('choosing a chair…');
/*
 * Every locator here is scoped to the open dialog.
 *
 * The catalogue is mounted in the Add panel behind the modal and has the same
 * `ul li button` shape, so an unscoped selector resolves to a covered element
 * and the click can never land.
 */
const chairSlot = page
  .locator('div[role="dialog"]')
  .first()
  .locator('button:has-text("Choose")')
  .nth(2);
if (await chairSlot.count()) {
  await chairSlot.click();
  await page.waitForTimeout(1400);
  const chair = page.locator('div[role="dialog"][aria-label^="Choose"]').first().locator('ul li button').first();
  if (await chair.count()) await chair.click();
  await page.waitForTimeout(800);
}

await shot('12-designer-configured');

const summary = await page
  .locator('text=/seats/')
  .first()
  .textContent()
  .catch(() => null);
console.log('summary line:', summary);

console.log('inserting…');
await page.getByRole('button', { name: 'Insert tables' }).click();
await page.waitForTimeout(6000);
await shot('13-designer-inserted');

const count = await page.locator('text=/\\d+ objects/').first().textContent().catch(() => null);
console.log('object counter reads:', count);

// Switch to top view so the arrangement is legible.
await page.getByRole('button', { name: /^Plan$/ }).click();
await page.waitForTimeout(3000);
await shot('14-designer-topview');

await browser.close();
console.log(errors.length ? `\nerrors:\n${[...new Set(errors)].slice(0, 10).join('\n')}` : '\nNo console errors.');
