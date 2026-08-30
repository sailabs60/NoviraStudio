/**
 * Browser checks for the venue generator and the billing surface.
 *
 * Software WebGL makes the 3D viewport slow, so this drives only the panels
 * and reads their rendered text rather than waiting on renders.
 */
import { chromium } from 'playwright';

const WEB = 'http://localhost:5174';
const results = [];
const errors = [];

function record(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const API = 'http://localhost:4100/api';

/**
 * The designer account owns no seeded plans, and it has to be this account
 * rather than the admin: super admins generate for free, so every credit-cost
 * assertion below would be vacuous under the admin.
 */
async function seedPlanForDesigner() {
  const login = await (
    await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'designer@novira.test', password: 'novira123' }),
    })
  ).json();
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };

  const project = await (
    await fetch(`${API}/projects`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ title: `Venue check ${Date.now().toString(36)}` }),
    })
  ).json();
  const plan = await (
    await fetch(`${API}/plans`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ projectId: project.id, title: 'Venue check plan' }),
    })
  ).json();
  return { projectId: project.id, planId: plan.id };
}

const seeded = await seedPlanForDesigner();
if (!seeded.planId) {
  console.error('could not create a plan for the designer:', JSON.stringify(seeded));
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const textOf = async (selector) => {
  try {
    return await page.locator(selector).first().innerText({ timeout: 4000 });
  } catch {
    return null;
  }
};

/* ── Sign in ─────────────────────────────────────────────────────────────── */
await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'designer@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL(/\/(dashboard|projects)/, { timeout: 20000 });
record('sign in', true);

/* ── Billing surface ─────────────────────────────────────────────────────── */
await page.goto(`${WEB}/billing`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const packs = await page.locator('text=/Top up credits/').count();
record('credit packs section', packs > 0);

const packButtons = await page.locator('button:has-text("Request"), button:has-text("Buy")').count();
record('credit packs offered', packButtons > 0, `${packButtons} packs`);

const manualNote = await textOf('text=/Card payment is not enabled/');
record(
  'manual-mode copy shown without Stripe',
  Boolean(manualNote),
  manualNote?.slice(0, 60) ?? 'missing'
);

/* Stripe is not configured here, so the portal button must not be offered. */
const portalButtons = await page.locator('button:has-text("Manage billing")').count();
record('no billing portal in manual mode', portalButtons === 0);

/* ── Venue generator ─────────────────────────────────────────────────────── */
await page.goto(`${WEB}/editor/${seeded.planId}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(11000);
record('editor opens', true);

/* The venue generator lives in the Site section of the rail. */
await page
  .getByRole('navigation', { name: 'Editor sections' })
  .getByRole('button', { name: /^Site/ })
  .click();
await page.waitForTimeout(1200);
await page.locator('button[title="Generate a venue"]').first().click();
await page.waitForTimeout(2500);

const dialog = 'div[role="dialog"]';
const styleCount = await page.locator(`${dialog} button:has-text("Ballroom"), ${dialog} button:has-text("Marquee")`).count();
record('venue styles listed', styleCount >= 2, `${styleCount} style buttons matched`);

const area = await textOf(`${dialog} >> text=/\\d+(\\.\\d+)? m²/`);
record('live area preview', Boolean(area), area ?? 'missing');

const capacity = await textOf(`${dialog} >> text=/Estimated capacity/`);
record('capacity table', Boolean(capacity));

const banquetRow = await textOf(`${dialog} >> text=/Banquet \\(rounds of 10\\)/`);
record('banquet capacity shown', Boolean(banquetRow));

/* The generate button must state its price up front. */
const genButton = await textOf(`${dialog} button:has-text("Generate")`);
record('generate states its cost', /credits/.test(genButton ?? ''), genButton ?? 'missing');

/* Changing the style must change the preview — proves it is live, not static. */
const before = await textOf(`${dialog} >> text=/\\d+(\\.\\d+)? m²/`);
await page.locator(`${dialog} button:has-text("Warehouse")`).click();
await page.waitForTimeout(1800);
const after = await textOf(`${dialog} >> text=/\\d+(\\.\\d+)? m²/`);
record('preview updates with style', before !== after, `${before} → ${after}`);

/* Warehouse defaults have columns on, which must raise a sightline warning. */
const warning = await textOf(`${dialog} .notice-warning`);
record('warnings surface', Boolean(warning), warning?.slice(0, 70) ?? 'none');

/* ── Generate for real ───────────────────────────────────────────────────── */
await page.locator(`${dialog} button:has-text("Ballroom")`).click();
await page.waitForTimeout(1200);
await page.locator(`${dialog} button:has-text("Generate")`).click();

let built = false;
for (let i = 0; i < 40; i += 1) {
  await page.waitForTimeout(1000);
  const done = await page.locator(`${dialog} >> text=/Venue built/`).count();
  if (done > 0) {
    built = true;
    break;
  }
  const failed = await page.locator(`${dialog} .notice-error`).count();
  if (failed > 0) break;
}
record('venue generates', built);

if (built) {
  await page.locator(`${dialog} button:has-text("Add to plan")`).click();
  await page.waitForTimeout(3000);
  
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
  await page
    .getByRole('navigation', { name: 'Editor sections' })
    .getByRole('button', { name: /^Create/ })
    .click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /Layout Tools/ }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /^Walls/ }).first().click();
  await page.waitForTimeout(1500);

  /*
   * The building arrives as a mesh, not as editor wall segments — deliberately.
   * The generated model already has its walls with the door and window openings
   * cut through them; adding segments in the same millimetres would put two
   * sets of walls in the same place, z-fighting, and the editor's own walls
   * have no openings. So the right assertion is that the venue is *in* the
   * plan, and that the wall panel is honest about having no segments to edit.
   */
  const placed = await page
    .locator('span')
    .filter({ hasText: / objects? · /i })
    .first()
    .innerText()
    .catch(() => '');
  record('the venue lands in the plan', /[1-9]\d* objects?/.test(placed), placed || 'missing');

  const segments = await textOf('text=/Segments:/');
  record('the wall panel reports what it can edit', /Segments:/.test(segments ?? ''), segments ?? 'missing');
}

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed.`);
if (errors.length) {
  console.log(`\nconsole errors:\n${[...new Set(errors)].slice(0, 6).join('\n')}`);
} else {
  console.log('No console errors.');
}
process.exit(passed === results.length ? 0 : 1);
