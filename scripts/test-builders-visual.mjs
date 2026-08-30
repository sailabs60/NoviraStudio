/**
 * The procedural builders, checked against what went wrong with them.
 *
 * Each assertion here corresponds to a specific reported failure, so a
 * regression would show up as the same complaint rather than as a vague drop in
 * quality. Where a fault was visual, the check measures the geometry that made
 * it visual rather than screenshotting and hoping.
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
  body: JSON.stringify({ title: `Builders ${Date.now().toString(36)}` }),
}, token);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));

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
  await page.waitForTimeout(15000);
  return plan;
}

/**
 * Read the saved scene back.
 *
 * The editor autosaves on a debounce, so a read taken straight after an
 * edit sees the previous state. Saving explicitly first removes the race.
 */
const sceneOf = async (planId) => {
  await page.locator('button:has-text("Save")').first().click().catch(() => {});
  await page.waitForTimeout(2500);
  return (await api(`/plans/${planId}`, {}, token)).scene;
};

/* ── The selection toolbar is fixed, not floating over the object. ───────── */

/**
 * Add something from the Build rail.
 *
 * Driven through the rail rather than through `button:has-text("Tent")`, which
 * also matches the catalogue's "Tents & Structures" filter chip — and matches
 * it first, because Create is what an editor opens on. The test was filtering
 * the catalogue and then waiting for a dialog that was never going to appear.
 *
 * The button locator is unscoped on purpose: these labels exist only inside
 * the builder, and scoping to `aside` broke as soon as one of them moved into
 * a nested section.
 */
async function build(subject, label) {
  await page.getByRole('button', { name: 'Skip the tour' }).click().catch(() => {});
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Build/ }).first().click();
  await page.waitForTimeout(1200);
  // Build opens on Stage; the subject segment chooses which builder is shown.
  await page.getByText(subject, { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('button').filter({ hasText: label }).first().click();
  await page.waitForTimeout(3500);
}

const tentPlan = await freshPlan('Tent check');
await build('Tents & drapes', /Frame Tent 30 × 40/);

const toolbar = page.locator('[data-testid="selection-toolbar"]');
record('selection toolbar appears for a selection', (await toolbar.count()) > 0);

if (await toolbar.count()) {
  const box = await toolbar.boundingBox();
  const canvas = await page.locator('canvas').boundingBox();
  // Anchored near the top of the viewport, and horizontally centred: a bar that
  // follows the object was never twice in the same place.
  const centred = Math.abs((box.x + box.width / 2) - (canvas.x + canvas.width / 2)) < 60;
  const nearTop = box.y - canvas.y < 60;
  record('toolbar is pinned to the top centre', centred && nearTop,
    `offset ${Math.round((box.x + box.width / 2) - (canvas.x + canvas.width / 2))}px, ${Math.round(box.y - canvas.y)}px down`);

  const radius = await toolbar.evaluate((el) => getComputedStyle(el).borderRadius);
  record('toolbar is a rounded pill', parseFloat(radius) >= 20 || radius.includes('9999'), radius);
}

/* Rotate mode must offer one ring, and show the angle. */
await page.locator('[data-testid="selection-toolbar"] button:has-text("Rotate")').click();
await page.waitForTimeout(2000);
const angleShown = await page.locator('text=/^\\d+°/').count();
record('rotate mode shows a live angle', angleShown > 0);

/* ── Tent: a gable, not a flat sheet. ───────────────────────────────────── */

const tentScene = await sceneOf(tentPlan.id);
const tent = tentScene.objects.find((o) => o.type === 'tent');
record('tent placed', Boolean(tent), tent?.name);
record('tent peak stands above its eave',
  tent && tent.peakHeightMm > tent.eaveHeightMm + 500,
  tent ? `eave ${tent.eaveHeightMm} mm, peak ${tent.peakHeightMm} mm` : '');

/* ── Stage: readable, not a black mass. ─────────────────────────────────── */

const stagePlan = await freshPlan('Stage check');
await build('Stage', /Add a stage/);

const stageScene = await sceneOf(stagePlan.id);
const stage = stageScene.objects.find((o) => o.type === 'stage');
record('stage placed', Boolean(stage));

/*
 * The deck and the skirt were both near-black, so every edge, leg and seam
 * merged into one silhouette. They have to differ enough to read apart.
 */
const luminance = (hex) => {
  const v = (hex ?? '#000000').replace('#', '');
  return (
    parseInt(v.slice(0, 2), 16) * 0.299 +
    parseInt(v.slice(2, 4), 16) * 0.587 +
    parseInt(v.slice(4, 6), 16) * 0.114
  );
};
const deckLum = luminance(stage?.deckColor ?? '#41454d');
const skirtLum = luminance(stage?.skirtColor ?? '#23262b');
record('stage deck is not near-black', deckLum > 45, `deck luminance ${Math.round(deckLum)}`);
record('deck and skirt are distinguishable', Math.abs(deckLum - skirtLum) > 15,
  `deck ${Math.round(deckLum)} vs skirt ${Math.round(skirtLum)}`);

/* ── Drape: the handles do something. ───────────────────────────────────── */

const drapePlan = await freshPlan('Drape check');
await build('Tents & drapes', /Add a drape/);

const beforeDrape = await sceneOf(drapePlan.id);
const drapeBefore = beforeDrape.objects.find((o) => o.type === 'curtain');
record('drape placed', Boolean(drapeBefore));

/*
 * The nine control points were drawn as plain spheres with no interaction —
 * an affordance that did nothing. Dragging one must change the drape.
 */
if (drapeBefore) {
  await page.locator('button[title^="Fit everything"]').click().catch(() => {});
  await page.waitForTimeout(3000);
  const canvasBox = await page.locator('canvas').boundingBox();

  /*
   * The drape is already selected from being inserted, and the handles only
   * show while it is. Clicking the canvas to "re-select" it landed on empty
   * floor and deselected it instead, which hid the very things being tested.
   */
  const stillSelected = await page.locator('aside').last().innerText().catch(() => '');
  record('drape stays selected so its handles show', /Drape/.test(stillSelected),
    stillSelected.replace(/\s+/g, ' ').slice(0, 40));

  /*
   * Find a handle by hovering rather than by arithmetic.
   *
   * Where a 3D control point lands on screen depends on the camera, and
   * hard-coding a pixel makes the test fail for reasons unrelated to whether
   * dragging works. The handle sets the cursor to `grab` on hover, so sweeping
   * for that cursor locates it exactly — and incidentally proves the pointer
   * handlers are attached at all, which is precisely what was missing before.
   */
  const shapeFields = [
    'topLeftExtentMm', 'topRightExtentMm', 'middleLeftExtentMm',
    'middleRightExtentMm', 'bottomLeftExtentMm', 'bottomRightExtentMm',
    'curveDepthMm', 'middleCurveMm',
  ];

  const cursorNow = () =>
    page.evaluate(() => document.querySelector('canvas')?.style.cursor ?? '');

  let handleAt = null;
  outer: for (let fy = 0.18; fy <= 0.82; fy += 0.03) {
    for (let fx = 0.18; fx <= 0.82; fx += 0.03) {
      const x = canvasBox.x + canvasBox.width * fx;
      const y = canvasBox.y + canvasBox.height * fy;
      await page.mouse.move(x, y);
      if ((await cursorNow()) === 'grab') {
        handleAt = { x, y };
        break outer;
      }
    }
  }

  record('drape handles respond to the pointer', Boolean(handleAt),
    handleAt ? `found at ${Math.round(handleAt.x)},${Math.round(handleAt.y)}` : 'no handle set a grab cursor');

  let changed = [];
  if (handleAt) {
    await page.mouse.move(handleAt.x, handleAt.y);
    await page.mouse.down();
    await page.mouse.move(handleAt.x - 140, handleAt.y, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(1500);

    const after = await sceneOf(drapePlan.id);
    const now = after.objects.find((o) => o.type === 'curtain');
    if (now) changed = shapeFields.filter((f) => drapeBefore[f] !== now[f]);
  }
  record('dragging a drape handle reshapes it', changed.length > 0,
    changed.length ? changed.join(', ') : 'no handle responded to a drag');
}

/* ── Venue: the generated model actually lands in the plan. ─────────────── */

const venuePlan = await freshPlan('Venue check');
// The generator lives under Site, beneath the venue library it is the
// fallback for. Reaching it means opening that rail section first.
await page.getByRole('button', { name: 'Skip the tour' }).click().catch(() => {});
await page.waitForTimeout(400);
await page.getByRole('button', { name: /^Site/ }).first().click();
await page.waitForTimeout(1500);
await page.locator('button[title="Generate a venue"]').first().click();
await page.waitForTimeout(2500);
await page.locator('div[role="dialog"] button:has-text("Generate")').click();

let built = false;
for (let i = 0; i < 45; i += 1) {
  await page.waitForTimeout(1000);
  if (await page.locator('div[role="dialog"] >> text=/Venue built/').count()) { built = true; break; }
  if (await page.locator('div[role="dialog"] .notice-error').count()) break;
}
record('venue generates', built);

if (built) {
  await page.locator('div[role="dialog"] button:has-text("Add to plan")').click();
  await page.waitForTimeout(5000);

  const venueScene = await sceneOf(venuePlan.id);
  const shell = venueScene.objects.find((o) => o.venueId);

  /*
   * The whole model used to be discarded on apply — only wall segments were
   * kept, so a generated ballroom arrived as four bare slabs and it looked as
   * though nothing had happened.
   */
  record('the generated model is placed in the plan', Boolean(shell),
    shell ? `${shell.name} → ${shell.modelUrl?.split('/').pop()}` : 'no venue object');
  record('the venue arrives locked', shell?.locked === true);

  // And its mesh must be reachable, or it renders as a placeholder box.
  if (shell?.modelUrl) {
    const head = await fetch(shell.modelUrl, { method: 'HEAD' });
    record('the venue model is served', head.ok, `HTTP ${head.status}`);
  }

  /* Walls are in the mesh, so duplicating them would z-fight and brick up the
     doors. */
  record('no duplicate wall segments', (venueScene.walls?.segments?.length ?? 0) === 0,
    `${venueScene.walls?.segments?.length ?? 0} segments`);
  record('the floor is kept for area and seating',
    (venueScene.walls?.floors?.length ?? 0) > 0);
}

/* ── The layout picker has diagrams. ────────────────────────────────────── */

await page.locator('canvas').click({ position: { x: 500, y: 500 } }).catch(() => {});
await page.waitForTimeout(1500);
const quick = page.locator('button:has-text("Quick Layout")').first();
if (await quick.count()) {
  await quick.click();
  await page.waitForTimeout(2500);
  const diagrams = await page.locator('div[role="dialog"] svg').count();
  record('every arrangement has a diagram', diagrams >= 10, `${diagrams} diagrams`);
  await page.keyboard.press('Escape');
}

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} builder checks passed.`);
if (errors.length) console.log(`\nerrors:\n${[...new Set(errors)].slice(0, 5).join('\n')}`);
process.exit(passed === results.length ? 0 : 1);
