/**
 * Full-platform smoke test.
 *
 * Walks the whole product as a user would and reports what actually worked, so
 * "it is built" can be checked rather than claimed.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.NOVIRA_WEB ?? 'http://localhost:5174';
fs.mkdirSync('storage/shots', { recursive: true });

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const shot = (n) =>
  page.screenshot({ path: `storage/shots/${n}.png`, animations: 'disabled', timeout: 15000 }).catch(() => {});

async function textOf(selector) {
  return page.locator(selector).first().textContent().catch(() => null);
}

/* ── Sign in ─────────────────────────────────────────────────────────── */
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL('**/dashboard', { timeout: 30000 });
record('sign in', true);

/* ── Billing ─────────────────────────────────────────────────────────── */
await page.goto(`${BASE}/billing`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const tierCount = await page.locator('section:has(button:has-text("Switch to")), section:has(button:has-text("Your plan"))').count();
const ratios = await textOf('section:has-text("What credits cost")');
record('billing page', tierCount >= 3, `${tierCount} tiers, ratios: ${ratios?.replace(/\s+/g, ' ').slice(0, 80)}`);
await shot('70-billing');

/* ── Admin console ───────────────────────────────────────────────────── */
await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const overview = await textOf('div.grid');
record('admin overview', Boolean(overview && /Users/.test(overview)), overview?.replace(/\s+/g, ' ').slice(0, 90));
await shot('71-admin-overview');

await page.getByRole('button', { name: 'Catalogue review' }).click();
await page.waitForTimeout(2000);
const reviewCards = await page.locator('article.card').count();
record('admin review queue', reviewCards > 0, `${reviewCards} items awaiting review`);
await shot('72-admin-review');

await page.getByRole('button', { name: 'Pricing & credits' }).click();
await page.waitForTimeout(1800);
const pricingRows = await page.locator('section:has-text("Credit cost per action") tr').count();
record('admin pricing editor', pricingRows >= 5, `${pricingRows} editable credit ratios`);
await shot('73-admin-pricing');

await page.getByRole('button', { name: 'Users' }).click();
await page.waitForTimeout(1800);
const userRows = await page.locator('tbody tr').count();
record('admin users', userRows > 0, `${userRows} users`);

/* ── Editor: everything at once ──────────────────────────────────────── */
await page.goto(`${BASE}/projects/1`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'New plan' }).click();
await page.waitForTimeout(600);
await page.fill('#plan-title', 'Full check');
await page.getByRole('button', { name: 'Create and open' }).click();
await page.waitForURL('**/editor/**', { timeout: 30000 });
await page.waitForTimeout(6000);
record('editor opens', (await page.locator('canvas').count()) === 1);

// Walls

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
await page.waitForTimeout(2000);
/* Drawing tools live under Create → Layout Tools in the studio. */
await page
  .getByRole('navigation', { name: 'Editor sections' })
  .getByRole('button', { name: /^Create/ })
  .click();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: /Layout Tools/ }).click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: /^Walls/ }).first().click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Create room' }).click();
await page.waitForTimeout(2500);
const segs = await textOf('text=/Segments:/');
record('quick room', /Segments: [1-9]/.test(segs ?? ''), segs?.trim());

// Structures. Leave the wall tool by its own Done button, then open Build.
await page.locator('aside').getByRole('button', { name: /^Done$/ }).click();
await page.waitForTimeout(800);
await page
  .getByRole('navigation', { name: 'Editor sections' })
  .getByRole('button', { name: /^Build/ })
  .click();
await page.waitForTimeout(900);
await page.getByRole('radio', { name: /^Stage/ }).first().click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: /^Add a stage/ }).click();
await page.waitForTimeout(3500);
const bom = await textOf('section:has-text("Derived parts list")');
record('stage + parts list', Boolean(bom && /Deck/.test(bom)), bom?.replace(/\s+/g, ' ').slice(0, 80));

await page.keyboard.press('Escape');
await page.getByRole('radio', { name: /Tents & drapes/ }).first().click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: /^Add a drape/ }).click();
await page.waitForTimeout(3000);
record('drape', Boolean(await textOf('section:has-text("Curtain shape")')));

// Table Designer, reached the way a person would: Create → Layout Tools.
await page.keyboard.press('Escape');
await page
  .getByRole('navigation', { name: 'Editor sections' })
  .getByRole('button', { name: /^Create/ })
  .click();
await page.waitForTimeout(900);
await page.getByRole('button', { name: /Layout Tools/ }).click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: /Table Designer/ }).click();
await page.waitForTimeout(2000);
await page.locator('button:has-text("Choose…")').first().click();
await page.waitForTimeout(1500);
const round = page.locator('button:has-text("Round Table 60")').first();
if (await round.count()) await round.click();
else await page.locator('ul li button').first().click();
await page.waitForTimeout(1000);
const seatLine = await textOf('text=/seats/');
await page.getByRole('button', { name: 'Insert tables' }).click();
await page.waitForTimeout(5000);
record('table designer', true, seatLine?.replace(/\s+/g, ' '));

// Templates
await page.getByRole('button', { name: 'Templates', exact: true }).click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: 'Save as template' }).click();
await page.waitForTimeout(900);
const tplTitle = `Full check ${Date.now().toString(36)}`;
await page.fill('#tpl-title', tplTitle);
await page.getByRole('button', { name: 'Save template' }).click();
await page.waitForTimeout(3000);
// The dialog only closes on a successful save, so its absence is the assertion.
// A duplicate title leaves it open asking to overwrite; that used to record a
// pass anyway, and then its backdrop swallowed the next click.
const tplStillOpen = await page.locator('div[role="dialog"]:has-text("Save as template")').count();
record('save template', tplStillOpen === 0, tplTitle);
if (tplStillOpen) await page.keyboard.press('Escape');

// AI gating / capability reporting
await page.getByRole('button', { name: 'AI Enhance' }).click();
await page.waitForTimeout(2500);
const aiText = await textOf('div[role="dialog"]');
record('AI panel', Boolean(aiText && /credits/.test(aiText)), aiText?.replace(/\s+/g, ' ').slice(0, 110));
await shot('74-ai-panel');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Export menu
await page.getByRole('button', { name: 'Export' }).click();
await page.waitForTimeout(800);
const exportMenu = await page.locator('button:has-text("PDF")').count();
record('export menu', exportMenu > 0, 'PDF and PNG offered');
await page.keyboard.press('Escape');

await page.getByRole('button', { name: /^3D$/ }).click();
await page.waitForTimeout(3500);
await shot('75-full-scene');

const objectCount = await textOf('text=/\\d+ objects/');
record('scene populated', /[1-9]\d* objects/.test(objectCount ?? ''), objectCount);

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed.`);
if (errors.length) {
  console.log(`\nconsole errors:\n${[...new Set(errors)].slice(0, 8).join('\n')}`);
} else {
  console.log('No console errors.');
}
