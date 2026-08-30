/**
 * Close-up renders of every procedural builder.
 *
 * These exist to be *looked at*. Whether a length of truss reads as truss is
 * not a property any assertion can check — it is a judgement about ends,
 * joints, panel pitch and how the web meets the chord, and the only way to make
 * it is to render the thing large and look at the corner.
 *
 *   node scripts/shoot-builders.mjs                 # every subject
 *   node scripts/shoot-builders.mjs truss tent      # just these
 *
 * Each subject is dropped into an empty plan on its own, framed, and shot from
 * two distances: one that shows the whole object and one close enough to see
 * how it is put together.
 */
import { chromium } from 'playwright';
import path from 'node:path';

const API = 'http://localhost:4100/api';
const WEB = process.env.NOVIRA_WEB ?? 'http://localhost:5174';
const OUT = process.env.SHOT_DIR ?? '.';

const api = async (p, o = {}, t) =>
  (
    await fetch(API + p, {
      ...o,
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...o.headers },
    })
  ).json();

const id = () => `o-${Math.random().toString(36).slice(2, 10)}`;
const base = (extra) => ({
  id: id(),
  positionMm: { x: 0, y: 0, z: 0 },
  rotationDeg: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  ...extra,
});

/** One scene each, sized so the subject fills the frame. */
const SUBJECTS = {
  'truss-goalpost': {
    camera: { position: [9, 4.5, 10], target: [0, 3, 0] },
    close: { position: [2.2, 3.9, 2.6], target: [-2.4, 4.2, 0] },
    objects: [
      base({
        type: 'truss',
        name: 'Goalpost',
        systemKey: 'f34-square',
        shape: 'goalpost',
        points: [
          { xMm: -5000, zMm: 0 },
          { xMm: 5000, zMm: 0 },
        ],
        closed: false,
        trimHeightMm: 4500,
        legType: 'tower',
        hangingLoadKg: 120,
        color: '#c9ccd1',
        showBracing: true,
      }),
    ],
  },
  'truss-grid': {
    camera: { position: [12, 9, 13], target: [0, 4, 0] },
    close: { position: [4.2, 5.6, 4.6], target: [3, 5, 3] },
    objects: [
      base({
        type: 'truss',
        name: 'Mother grid',
        systemKey: 'h30v-tri',
        shape: 'square',
        points: [
          { xMm: -4000, zMm: -3000 },
          { xMm: 4000, zMm: -3000 },
          { xMm: 4000, zMm: 3000 },
          { xMm: -4000, zMm: 3000 },
        ],
        closed: true,
        trimHeightMm: 5000,
        legType: 'flown',
        hangingLoadKg: 300,
        color: '#c9ccd1',
        showBracing: true,
      }),
    ],
  },
  tent: {
    camera: { position: [22, 13, 24], target: [0, 2.5, 0] },
    close: { position: [8.5, 3.2, 11], target: [4, 2.4, 6] },
    objects: [
      base({
        type: 'tent',
        name: 'Frame tent',
        catalogItemId: 0,
        family: 'frame',
        widthMm: 12192,
        lengthMm: 18288,
        eaveHeightMm: 2440,
        peakHeightMm: 2440 + Math.round(12192 * 0.22),
        bayLengthMm: 3048,
        slots: [],
        canopyHidden: false,
        canopyColor: '#f7f6f3',
      }),
    ],
  },
  'tent-frame': {
    camera: { position: [22, 13, 24], target: [0, 2.5, 0] },
    close: { position: [9, 3.4, 11], target: [3, 2.6, 4] },
    objects: [
      base({
        type: 'tent',
        name: 'Frame tent',
        catalogItemId: 0,
        family: 'frame',
        widthMm: 12192,
        lengthMm: 18288,
        eaveHeightMm: 2440,
        peakHeightMm: 2440 + Math.round(12192 * 0.22),
        bayLengthMm: 3048,
        slots: [],
        canopyHidden: true,
        canopyColor: '#f7f6f3',
      }),
    ],
  },
  stage: {
    camera: { position: [9, 4, 10], target: [0, 0.7, 0] },
    close: { position: [3.4, 1.5, 3.8], target: [1.2, 0.5, 1.6] },
    objects: [
      base({
        type: 'stage',
        name: 'Stage',
        deckColumns: 6,
        deckRows: 3,
        deckHeightMm: 900,
        stairSides: ['south'],
        stairBays: { south: 3 },
        skirtSides: ['north', 'east', 'south', 'west'],
        guardrailSides: ['north'],
        deckColor: '#41454d',
        skirtColor: '#23262b',
      }),
    ],
  },
  drape: {
    camera: { position: [7, 3.2, 8], target: [0, 1.6, 0] },
    close: { position: [2.4, 1.9, 2.8], target: [0.5, 1.6, 0] },
    objects: [
      base({
        type: 'curtain',
        name: 'Drape',
        topWidthMm: 8000,
        middleWidthMm: 8000,
        bottomWidthMm: 8000,
        heightMm: 3000,
        curveDepthMm: 0,
        middleCurveMm: 0,
        topLeftExtentMm: 0,
        topRightExtentMm: 0,
        middleLeftExtentMm: 0,
        middleRightExtentMm: 0,
        bottomLeftExtentMm: 0,
        bottomRightExtentMm: 0,
        foldCount: 22,
        foldAmplitudeMm: 90,
        orientation: 'vertical',
        color: '#1d2026',
        fillOpacity: 1,
      }),
    ],
  },
  led: {
    camera: { position: [8, 3.4, 9], target: [0, 2, 0] },
    close: { position: [2.2, 2.2, 2.6], target: [0, 2, 0] },
    objects: [
      base({
        type: 'led',
        name: 'LED wall',
        panelKey: 'p3-9-500',
        columns: 10,
        rows: 6,
        bottomMm: 800,
        curveDeg: 0,
        frame: 'ground-support',
        brightness: 0.8,
        glowIntensity: 0.6,
        contentColor: '#12203a',
      }),
    ],
  },
  booth: {
    camera: { position: [8, 4, 9], target: [0, 1.4, 0] },
    close: { position: [3, 2, 3.4], target: [1, 1.3, 1] },
    objects: [
      base({
        type: 'booth',
        name: 'Shell scheme',
        boothType: 'shell-scheme',
        widthMm: 6000,
        depthMm: 3000,
        heightMm: 2500,
        walls: ['back', 'left', 'right'],
        wallFinish: 'modular-system',
        wallColor: '#e9ebef',
        floorFinish: 'carpet',
        floorColor: '#4b5563',
        platformHeightMm: 0,
        fascia: true,
        fasciaHeightMm: 300,
        fasciaText: 'NOVIRA',
        fasciaColor: '#1f2937',
        storeRoom: true,
        counter: true,
        standNumber: 'B22',
      }),
    ],
  },
};

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const subjects = Object.entries(SUBJECTS).filter(([key]) => !wanted.length || wanted.some((w) => key.includes(w)));

const { token } = await api('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: 'planner@novira.test', password: 'novira123' }),
});
const project = await api(
  '/projects',
  { method: 'POST', body: JSON.stringify({ title: `Builders ${Date.now().toString(36)}` }) },
  token
);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 180)));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console]', m.text().slice(0, 180));
});

await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL(/\/(dashboard|projects)/, { timeout: 20000 });

async function ready(timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await page
      .evaluate(() => {
        const c = document.querySelector('canvas');
        return Boolean(c && c.width > 100);
      })
      .catch(() => false);
    if (ok) {
      await page.waitForTimeout(5000);
      return;
    }
    await page.waitForTimeout(500);
  }
}

for (const [key, subject] of subjects) {
  const plan = await api(
    '/plans',
    { method: 'POST', body: JSON.stringify({ projectId: project.id, title: key }) },
    token
  );
  const scene = (await api(`/plans/${plan.id}`, {}, token)).scene;
  scene.objects = subject.objects;
  scene.showGrid = true;
  // Studio sky and a plain floor: the object is the subject, not the room.
  scene.camera = { ...scene.camera, mode: 'perspective' };
  await api(`/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ scene }) }, token);

  await page.goto(`${WEB}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
  await ready();
  const skip = page.getByRole('button', { name: 'Skip the tour' });
  if (await skip.count()) {
    await skip.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  // Collapse the panels so the viewport is the whole window.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  for (const [suffix, view] of [
    ['', subject.camera],
    ['-close', subject.close],
  ]) {
    await page.evaluate((v) => {
      const fn = window.__noviraSetCamera;
      if (fn) fn(v.position, v.target);
    }, view);
    await page.waitForTimeout(6000);

    const canvas = page.locator('canvas').first();
    const file = path.join(OUT, `builder-${key}${suffix}.png`);
    await canvas.screenshot({ path: file, timeout: 180000, animations: 'disabled' });
    console.log('wrote', file);
  }
}

await browser.close();
console.log('done');
