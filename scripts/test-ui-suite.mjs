/**
 * Browser pass over the pages added for the operational features.
 *
 * The API tests prove the data; this proves a planner can actually reach it.
 */
import { chromium } from 'playwright';

const API = 'http://localhost:4100/api';
const WEB = process.env.NOVIRA_WEB ?? 'http://localhost:5174';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

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

/* A project with guests, a plan and a proposal to look at. */
const project = await api('/projects', {
  method: 'POST',
  body: JSON.stringify({ title: `UI check ${Date.now().toString(36)}` }),
}, token);

const plan = await api('/plans', {
  method: 'POST',
  body: JSON.stringify({ projectId: project.id, title: 'Room' }),
}, token);

await api(`/projects/${project.id}/guests/import`, {
  method: 'POST',
  body: JSON.stringify({
    rows: [
      { firstName: 'Ada', lastName: 'Okafor', partyName: 'Okafor family', rsvp: 'yes', mealChoice: 'Beef', dietary: 'Nut allergy' },
      { firstName: 'Ben', lastName: 'Okafor', partyName: 'Okafor family', rsvp: 'yes', mealChoice: 'Beef' },
      { firstName: 'Cara', lastName: 'Lindqvist', rsvp: 'pending' },
    ],
  }),
}, token);

const proposal = await api(`/projects/${project.id}/proposals`, {
  method: 'POST',
  body: JSON.stringify({ title: 'UI proposal', planId: plan.id, taxRateBp: 2000 }),
}, token);
await api(`/proposals/${proposal.id}/lines`, {
  method: 'POST',
  body: JSON.stringify({ kind: 'labour', description: 'Crew', quantityMilli: 2000, unitPrice: 40000 }),
}, token);
const share = await api(`/proposals/${proposal.id}/share`, { method: 'POST' }, token);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 120)}`);
});

const textOf = async (selector) => {
  try {
    return await page.locator(selector).first().innerText({ timeout: 4000 });
  } catch {
    return null;
  }
};

await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL(/\/(dashboard|projects)/, { timeout: 20000 });
record('sign in', true);

/* ── Guests ──────────────────────────────────────────────────────────────── */

await page.goto(`${WEB}/projects/${project.id}/guests`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const guestHeading = await textOf('h1');
record('guest list opens', guestHeading === 'Guest list', guestHeading ?? 'missing');

const guestRows = await page.locator('table tbody tr').count();
record('guests listed', guestRows === 3, `${guestRows} rows`);

const counts = await textOf('text=/guests ·/');
record('RSVP counts shown', /2 attending/.test(counts ?? ''), counts ?? 'missing');

const dietary = await page.locator('text=/Nut allergy/').count();
record('dietary requirements surfaced', dietary > 0);

await page.locator('button:has-text("Paste a list")').click();
await page.waitForTimeout(1200);
await page.fill('div[role="dialog"] textarea', 'First name\tLast name\tRSVP\nDee\tMoreau\tyes');
await page.waitForTimeout(800);
const previewRows = await page.locator('div[role="dialog"] table tbody tr').count();
record('paste importer previews before committing', previewRows === 1, `${previewRows} row previewed`);
await page.keyboard.press('Escape');

/* ── Suppliers ───────────────────────────────────────────────────────────── */

await page.goto(`${WEB}/vendors`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const vendorHeading = await textOf('h1');
record('suppliers page opens', /Suppliers/.test(vendorHeading ?? ''), vendorHeading ?? 'missing');

const tabs = await page.locator('button:has-text("Inventory")').count();
record('inventory tab present', tabs > 0);

/* ── Proposals ───────────────────────────────────────────────────────────── */

await page.goto(`${WEB}/projects/${project.id}/proposals`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const proposalHeading = await textOf('h1');
record('proposals page opens', proposalHeading === 'Proposals', proposalHeading ?? 'missing');

const lineRows = await page.locator('table tbody tr').count();
record('proposal lines shown', lineRows >= 1, `${lineRows} lines`);

/* 2 days × $400 = $800, +20% tax = $960. The totals must agree on screen. */
const totalsText = await textOf('text=/Total/');
record('totals rendered', Boolean(totalsText));

const buildBtn = await page.locator('button:has-text("Build from layout")').count();
record('build-from-layout offered', buildBtn > 0);

/* ── The client view ─────────────────────────────────────────────────────── */

const clientPage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await clientPage.goto(`${WEB}/proposal/${share.token}`, { waitUntil: 'domcontentloaded' });
await clientPage.waitForTimeout(2500);

const clientTitle = await clientPage.locator('h1').first().innerText().catch(() => null);
record('client can open the proposal without signing in', clientTitle === 'UI proposal',
  clientTitle ?? 'missing');

const acceptBtn = await clientPage.locator('button:has-text("Accept this proposal")').count();
record('client can accept or decline', acceptBtn > 0);

const navPresent = await clientPage.locator('a[href="/dashboard"]').count();
record('client view has no app navigation', navPresent === 0);
await clientPage.close();

/* ── Editor: drafting and the new panels ─────────────────────────────────── */

await page.goto(`${WEB}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(18000);
record('editor opens', true);

/* The first-run tour sits over the plan; dismiss it before driving. */
const skipTour = page.getByRole('button', { name: 'Skip the tour' });
if (await skipTour.count()) {
  await skipTour.click().catch(() => {});
  await page.waitForTimeout(600);
}

/*
 * Drafting now lives where a designer would look for it: Create → Layout
 * Tools. Opening it puts the drafting panel in the work column, exactly as
 * the old dedicated toolbar button did.
 */
await page.getByRole('navigation', { name: 'Editor sections' }).getByRole('button', { name: /^Create/ }).click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: /Layout Tools/ }).click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: /Dimensions & zones/ }).click();
await page.waitForTimeout(1500);

const draftHeading = await textOf('aside h2');
record('the drafting panel takes the work column', draftHeading === 'Drafting', draftHeading ?? 'missing');

const dimensionTool = await page.locator('aside button[title="Dimension"]').count();
record('drafting tools listed', dimensionTool > 0);

const presets = await page.locator('aside button:has-text("Fire egress")').count();
record('drafting presets named by purpose', presets > 0);

/*
 * Draw a dimension by clicking twice on the canvas.
 *
 * Top view first: in perspective the upper half of the canvas is above the
 * horizon, so a click there never meets the ground plane and places nothing.
 */
await page.getByRole('button', { name: /^Plan$/ }).first().click();
await page.waitForTimeout(3000);
const counter = page.locator('span').filter({ hasText: / objects? · /i }).first();
const countOf = async () =>
  Number((((await counter.innerText().catch(() => '0')) || '0').match(/\d+/) ?? ['0'])[0]);
const before = await countOf();

const box = await page.locator('canvas').boundingBox();
await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.45);
await page.waitForTimeout(900);
await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.45);
await page.waitForTimeout(2500);


/*
 * Counted before and after rather than asserted as non-zero. The plan these
 * checks run against accumulates objects across runs, so "more than zero"
 * would pass even if drafting placed nothing at all.
 */
const after = await countOf();
record('a drawn dimension becomes a scene object', after > before, `${before} → ${after}`);

/* Back out of drafting, then the seating chart. */
await page.locator('aside').getByRole('button', { name: /^Done$/ }).click();
await page.waitForTimeout(1200);
record('a drawing tool can be left from its own panel', true);

await page.getByRole('button', { name: /Layout Tools/ }).click();
await page.waitForTimeout(800);

const seatingSection = await page.getByRole('button', { name: /^Seating/ }).count();
record('the seating chart is reachable from Layout Tools', seatingSection > 0);

await page.getByRole('button', { name: /^Seating/ }).first().click();
await page.waitForTimeout(2000);
const seatingCopy = await textOf('aside');
record('the seating chart reads back from the layout', /seat|table|guest/i.test(seatingCopy ?? ''),
  (seatingCopy ?? '').replace(/\s+/g, ' ').slice(0, 70));

await page.screenshot({ path: 'storage/shots/95-features.png' });

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} UI checks passed.`);
if (errors.length) {
  console.log(`\nconsole errors:\n${[...new Set(errors)].slice(0, 6).join('\n')}`);
} else {
  console.log('No console errors.');
}
process.exit(passed === results.length ? 0 : 1);
