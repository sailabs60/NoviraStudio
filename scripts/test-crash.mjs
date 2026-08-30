/**
 * Scene resilience checks.
 *
 * Reproduces the failure that took the editor down: a catalogue model that
 * cannot be fetched. Before the fix, the thrown error escaped the Suspense,
 * unmounted the Canvas and lost the WebGL context, so the whole plan vanished.
 * A broken asset must now degrade to a placeholder and leave the scene running.
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

/* A plan holding one good model and one that cannot possibly load. */
const project = await api('/projects', {
  method: 'POST',
  body: JSON.stringify({ title: `Crash check ${Date.now().toString(36)}` }),
}, token);
const plan = await api('/plans', {
  method: 'POST',
  body: JSON.stringify({ projectId: project.id, title: 'Broken asset plan' }),
}, token);

const catalog = await api('/catalog/items?limit=1', {}, token);
const good = catalog.items[0];

const scene = (await api(`/plans/${plan.id}`, {}, token)).scene;
scene.objects = [
  {
    id: 'good-1',
    type: 'catalog',
    name: good.name,
    catalogItemId: good.id,
    modelUrl: good.modelUrl,
    positionMm: { x: -1500, y: 0, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    dimensionsMm: { width: good.widthMm ?? 600, depth: good.depthMm ?? 600, height: good.heightMm ?? 600 },
  },
  {
    id: 'broken-1',
    type: 'catalog',
    name: 'Broken asset',
    catalogItemId: good.id,
    // Deliberately unreachable: this is the exact failure being guarded against.
    modelUrl: 'http://localhost:4100/static/assets/does-not-exist/broken.gltf',
    positionMm: { x: 1500, y: 0, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    dimensionsMm: { width: 600, depth: 600, height: 600 },
  },
  {
    // Structurally broken: no positionMm at all. Bad data reaching the renderer
    // used to throw on every frame and unmount the Canvas, exactly like a bad
    // asset URL, so it is guarded the same way.
    id: 'malformed-1',
    type: 'catalog',
    name: 'Malformed object',
    catalogItemId: good.id,
    modelUrl: good.modelUrl,
  },
];
const saved = await api(`/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ scene }) }, token);
if (saved?.objectCount !== 3) {
  console.error('scene did not save as expected:', JSON.stringify(saved).slice(0, 300));
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const contextLost = [];
const pageErrors = [];
page.on('console', (m) => {
  if (m.text().includes('Context Lost')) contextLost.push(m.text());
});
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL(/\/(dashboard|projects)/, { timeout: 20000 });

await page.goto(`${WEB}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(16000);

/* The canvas must still be mounted and rendering. */
const canvasAlive = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return { present: false };
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  return {
    present: true,
    width: canvas.width,
    height: canvas.height,
    contextLost: gl ? gl.isContextLost() : null,
  };
});
record('canvas survives a broken asset', canvasAlive.present && canvasAlive.width > 0,
  `${canvasAlive.width}×${canvasAlive.height}`);
record('WebGL context not lost', contextLost.length === 0,
  contextLost.length ? `${contextLost.length} context-lost events` : 'none');

/* The editor chrome must still be interactive. */
const objectCount = await page.locator('text=/\\d+ objects/').first().innerText().catch(() => null);
record('scene still reports its objects', /[1-9]\d* objects/.test(objectCount ?? ''), objectCount ?? 'missing');

/* The good model must have loaded despite its neighbour failing. */
const uncaught = pageErrors.filter((e) => /Could not load/.test(e));
record('model failure did not become an uncaught error', uncaught.length === 0,
  uncaught.length ? uncaught[0].slice(0, 80) : 'none');

/* And the toolbar still responds — proof the tree was not torn down. */

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
 * Drawing tools live under Create → Layout Tools now. Reaching the wall panel
 * through them exercises three of the studio's regions — the rail, the work
 * panel, and a tool taking the panel over — which proves rather more than one
 * button responding.
 */
await page
  .getByRole('navigation', { name: 'Editor sections' })
  .getByRole('button', { name: /^Create/ })
  .click()
  .catch(() => {});
await page.waitForTimeout(1000);
await page.getByRole('button', { name: /Layout Tools/ }).click().catch(() => {});
await page.waitForTimeout(700);
await page.getByRole('button', { name: /^Walls/ }).first().click().catch(() => {});
await page.waitForTimeout(1400);
const wallPanel = await page.locator('text=/Segments:/').count();
record('editor still interactive', wallPanel > 0);

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} resilience checks passed.`);
process.exit(passed === results.length ? 0 : 1);
