/**
 * Reproduce the reported failures in the procedural builders.
 *
 * Drives the editor the way a planner would and reports what actually happens,
 * rather than asserting what should. Written to find bugs, not to pass.
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
  body: JSON.stringify({ title: `Diagnose ${Date.now().toString(36)}` }),
}, token);
const plan = await api('/plans', {
  method: 'POST',
  body: JSON.stringify({ projectId: project.id, title: 'Procedural' }),
}, token);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`);
});

await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL(/\/(dashboard|projects)/, { timeout: 20000 });

await page.goto(`${WEB}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(18000);

const objectCount = async () => {
  const t = await page.locator('text=/\\d+ objects/').first().innerText().catch(() => '0 objects');
  return Number((t.match(/(\d+) objects/) ?? [0, 0])[1]);
};

const report = [];
function note(area, finding) {
  report.push({ area, finding });
  console.log(`[${area}] ${finding}`);
}

/* ── Drape ───────────────────────────────────────────────────────────────── */

const before = await objectCount();
await page.locator('aside button:has-text("Drape"), button:has-text("Drape")').first().click();
await page.waitForTimeout(3000);
const afterDrape = await objectCount();
note('drape', `objects ${before} -> ${afterDrape} after clicking Drape`);

if (afterDrape > before) {
  // A drape should be selectable and have editable properties.
  const props = await page.locator('aside').last().innerText().catch(() => '');
  note('drape', `properties panel after insert: ${props.replace(/\s+/g, ' ').slice(0, 200)}`);
  const handles = await page.locator('canvas').count();
  note('drape', `canvas present: ${handles > 0}`);
}

/* ── Stage ───────────────────────────────────────────────────────────────── */

const beforeStage = await objectCount();
await page.locator('button:has-text("Stage")').first().click();
await page.waitForTimeout(3000);
const afterStage = await objectCount();
note('stage', `objects ${beforeStage} -> ${afterStage} after clicking Stage`);

const stageProps = await page.locator('aside').last().innerText().catch(() => '');
note('stage', `properties: ${stageProps.replace(/\s+/g, ' ').slice(0, 320)}`);

/* ── Tent ────────────────────────────────────────────────────────────────── */

const beforeTent = await objectCount();
await page.locator('button:has-text("Tent")').first().click();
await page.waitForTimeout(2500);
const tentDialog = await page.locator('div[role="dialog"]').innerText().catch(() => '');
note('tent', `picker: ${tentDialog.replace(/\s+/g, ' ').slice(0, 240)}`);

const tentOption = page.locator('div[role="dialog"] button').filter({ hasText: /Frame Tent|Pole Tent|\d+×\d+/ }).first();
if (await tentOption.count()) {
  await tentOption.click();
  await page.waitForTimeout(3500);
}
const afterTent = await objectCount();
note('tent', `objects ${beforeTent} -> ${afterTent}`);

const tentProps = await page.locator('aside').last().innerText().catch(() => '');
note('tent', `properties: ${tentProps.replace(/\s+/g, ' ').slice(0, 320)}`);

/* ── Venue ───────────────────────────────────────────────────────────────── */

const beforeVenue = await objectCount();
await page.locator('button[title="Generate a venue"]').click();
await page.waitForTimeout(3000);

const venueDialog = await page.locator('div[role="dialog"]').innerText().catch(() => '');
note('venue', `dialog opened: ${venueDialog.replace(/\s+/g, ' ').slice(0, 200)}`);

const genBtn = page.locator('div[role="dialog"] button:has-text("Generate")');
if (await genBtn.count()) {
  await genBtn.click();
  let built = false;
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(1000);
    if (await page.locator('div[role="dialog"] >> text=/Venue built/').count()) { built = true; break; }
    if (await page.locator('div[role="dialog"] .notice-error').count()) break;
  }
  note('venue', `generation completed: ${built}`);
  if (built) {
    await page.locator('div[role="dialog"] button:has-text("Add to plan")').click();
    await page.waitForTimeout(3000);
    const afterVenue = await objectCount();
    note('venue', `objects ${beforeVenue} -> ${afterVenue} after Add to plan`);
    // The venue's own mesh: is it anywhere in the scene?
    await page.getByRole('button', { name: /^Walls$/ }).click().catch(() => {});
    await page.waitForTimeout(1500);
    const segs = await page.locator('text=/Segments:/').first().innerText().catch(() => 'none');
    note('venue', `walls after add: ${segs}`);
    await page.getByRole('button', { name: /^Walls$/ }).click().catch(() => {});
  } else {
    const err = await page.locator('div[role="dialog"] .notice-error').innerText().catch(() => '');
    note('venue', `error: ${err.slice(0, 200)}`);
  }
}
await page.keyboard.press('Escape');
await page.waitForTimeout(800);

await page.screenshot({ path: 'storage/shots/96-diagnose.png' });

await browser.close();

console.log('\n--- console/page errors ---');
console.log(errors.length ? [...new Set(errors)].slice(0, 10).join('\n') : 'none');
