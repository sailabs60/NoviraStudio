/**
 * Two faults that made features unusable without erroring.
 *
 * 1. Drafting clicks were ignored in the default 3D view, because the canvas
 *    click handler closed over a stale `tool`. It worked occasionally, whenever
 *    an unrelated dependency happened to rebuild the closure — which is worse
 *    than never working, because it looks like the user's fault.
 *
 * 2. Lettering could not be selected by clicking, because the only click target
 *    was the glyph geometry itself. Most of the area a word occupies is the gaps
 *    between and inside letters, and since selecting is the only route to the
 *    editing panel, text in a scene was effectively uneditable.
 *
 * Both are tested in the default view, with no camera changes, because that is
 * where they were found.
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
const project = await api('/projects', {
  method: 'POST',
  body: JSON.stringify({ title: `Viewport ${Date.now().toString(36)}` }),
}, token);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));

await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL(/\/(dashboard|projects)/, { timeout: 20000 });

async function freshPlan(title) {
  const plan = await api('/plans', {
    method: 'POST',
    body: JSON.stringify({ projectId: project.id, title }),
  }, token);
  await page.goto(`${WEB}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(16000);

  /* The first-run tour is an opaque dialog over the plan; clear it. */
  const skip = page.getByRole('button', { name: 'Skip the tour' });
  if (await skip.count()) {
    await skip.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  return plan;
}

const panel = async () =>
  (await page.locator('aside').last().innerText().catch(() => '')).replace(/\s+/g, ' ');

/*
 * The studio has two asides — the work panel on the left and the properties
 * dock on the right — so a drafting assertion has to say which one it means.
 * A drawing tool takes the left column over and labels it.
 */
const draftAside = () => page.locator('aside[aria-label="Drawing tool"]');
const draftPanel = async () =>
  (await draftAside().innerText().catch(() => '')).replace(/\s+/g, ' ');
const objectCount = async () => {
  /* The counter reads "1 object · metric" in the singular, so match both. */
  const t = await page
    .locator('span')
    .filter({ hasText: / objects? · /i })
    .first()
    .innerText()
    .catch(() => '0 objects');
  return Number((t.match(/(\d+) objects?/i) ?? [0, 0])[1]);
};

/* ── 1. Drafting works in the view you land in ──────────────────────────── */

const drawPlan = await freshPlan('Drafting');

/* Drawing tools live under Create → Layout Tools in the studio. */
await page
  .getByRole('navigation', { name: 'Editor sections' })
  .getByRole('button', { name: /^Create/ })
  .click();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: /Layout Tools/ }).click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: /Dimensions & zones/ }).click();
await page.waitForTimeout(1500);
record('drafting panel opens', /Drafting/.test(await draftPanel()));

/*
 * Measured after the panel is open, not before. The work column and the
 * bottom bar both change the canvas's size, so a box captured on arrival
 * describes a viewport that no longer exists by the time it is clicked.
 */
const box = await page.locator('canvas').boundingBox();

// Two clicks make a dimension. No camera change: the default view is the point.
await page.mouse.click(box.x + box.width * 0.38, box.y + box.height * 0.62);
await page.waitForTimeout(900);
const afterFirst = await draftPanel();
record('the first click registers in the default 3D view',
  /1 point placed/.test(afterFirst),
  afterFirst.match(/\d+ points? placed/)?.[0] ?? 'no point recorded');

await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.62);
await page.waitForTimeout(2000);
record('two clicks complete a dimension', (await objectCount()) === 1,
  `${await objectCount()} objects`);

await page.locator('button:has-text("Save")').first().click().catch(() => {});
await page.waitForTimeout(2500);
const scene = (await api(`/plans/${drawPlan.id}`, {}, token)).scene;
const drawing = scene.objects.find((o) => o.type === 'drawing');
record('the dimension is stored with both its points',
  drawing?.points?.length === 2,
  drawing ? `${drawing.drawKind}, ${drawing.points.length} points` : 'nothing stored');

/* A second tool, to prove it is not one lucky path. */
await draftAside().locator('button[title="Rectangle"]').click();
await page.waitForTimeout(800);
/*
 * Kept away from the bottom-left corner: the floating view controls sit there,
 * and a click that lands on the Plan/3D pill is not a click on the floor.
 */
await page.mouse.click(box.x + box.width * 0.44, box.y + box.height * 0.55);
await page.waitForTimeout(800);
await page.mouse.click(box.x + box.width * 0.68, box.y + box.height * 0.68);
await page.waitForTimeout(2000);
record('a second drafting tool also works', (await objectCount()) === 2,
  `${await objectCount()} objects`);

/* ── 2. Lettering can be selected by clicking near it ───────────────────── */

const textPlan = await freshPlan('Lettering');

/* Lettering lives under Create → 2D Art & Logos → Lettering. */
await page
  .getByRole('navigation', { name: 'Editor sections' })
  .getByRole('button', { name: /^Create/ })
  .click();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: /2D Art & Logos/ }).click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: /Lettering/ }).click();
await page.waitForTimeout(900);
await page.locator('button[title="3D lettering"]').first().click();
await page.waitForTimeout(2000);
await page.fill('div[role="dialog"] textarea', 'OO');
await page.locator('div[role="dialog"] button:has-text("Add lettering")').click();
await page.waitForTimeout(4000);

record('lettering is added', (await objectCount()) === 1);

await page.keyboard.press('Escape');
await page.waitForTimeout(1000);
record('escape deselects', /Nothing selected/.test(await panel()));

await page.locator('button[title^="Fit everything"]').click().catch(() => {});
await page.waitForTimeout(3000);

/*
 * Click the middle of the word. "OO" is chosen deliberately: the centre of the
 * text is inside the counters of the letters, so with only glyph geometry to
 * hit, this click lands on nothing — which was exactly the reported symptom.
 */
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.waitForTimeout(1500);
const afterClick = await panel();
record('clicking the middle of a word selects it',
  !/Nothing selected/.test(afterClick),
  afterClick.slice(0, 60));

const wordsField = page.locator('aside textarea').first();
record('the editing panel is reachable', (await wordsField.count()) > 0);

if (await wordsField.count()) {
  await wordsField.fill('Edited');
  await page.waitForTimeout(2000);
  await page.locator('button:has-text("Save")').first().click().catch(() => {});
  await page.waitForTimeout(2500);

  const after = (await api(`/plans/${textPlan.id}`, {}, token)).scene;
  const t3d = after.objects.find((o) => o.type === 'text3d');
  record('the edit is stored', t3d?.content === 'Edited', JSON.stringify(t3d?.content));

  /* Depth crosses zero, which is what makes extrude and intrude one control. */
  // Identified by its range rather than its position: depth is the only
  // control that crosses zero, which is what makes extrude and intrude one
  // slider instead of a mode switch.
  const depth = page.locator('aside input[type="range"][min="-40"]');
  if (await depth.count()) {
    await depth.fill('-20');
    await page.waitForTimeout(1500);
    const engraved = await panel();
    record('depth can be driven negative to engrave', /mm in|engrav/i.test(engraved),
      engraved.match(/-?\d+ mm (in|out)/)?.[0] ?? '');
  }
}

await page.screenshot({ path: 'storage/shots/105-viewport-editing.png' });
await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} viewport editing checks passed.`);
if (errors.length) console.log(`\nerrors:\n${[...new Set(errors)].slice(0, 4).join('\n')}`);
process.exit(passed === results.length ? 0 : 1);
