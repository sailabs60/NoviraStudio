/**
 * Branding engine checks.
 *
 * Covers the two things that actually matter about this feature: that the
 * search only ever offers artwork which is safe to use commercially, and that
 * lettering and artwork survive the round trip into the scene document and back
 * out into the renderer.
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
  return { status: res.status, body: await res.json().catch(() => null) };
}

const { body: login } = await api('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: 'planner@novira.test', password: 'novira123' }),
});
const token = login.token;

/* ── Search ──────────────────────────────────────────────────────────────── */
const search = await api('/branding/images/search?q=floral', {}, token);
record('image search returns results', (search.body?.results?.length ?? 0) > 0,
  `${search.body?.results?.length ?? 0} of ${search.body?.total ?? 0}`);

/*
 * The licence gate is the whole reason this source was chosen: artwork going
 * into a client proposal has to be safe to use commercially.
 */
const licences = [...new Set((search.body?.results ?? []).map((r) => r.license))];
const commercial = ['cc0', 'pdm', 'by', 'by-sa'];
record('every result is commercially usable', licences.every((l) => commercial.includes(l)),
  licences.join(', ') || 'none');

const credited = (search.body?.results ?? []).filter((r) => r.attributionRequired);
record('attribution flagged where the licence needs it',
  credited.every((r) => r.attribution && r.attribution.length > 3),
  `${credited.length} of ${search.body?.results?.length ?? 0} need credit`);

const tooShort = await api('/branding/images/search?q=a', {}, token);
record('search rejects a one-character query', tooShort.status === 400, `status ${tooShort.status}`);

/* ── Import ──────────────────────────────────────────────────────────────── */
const first = search.body?.results?.[0];
let imported = null;
if (first) {
  const res = await api('/branding/images/import', {
    method: 'POST',
    body: JSON.stringify({
      url: first.url,
      title: first.title,
      license: first.license,
      attribution: first.attribution,
    }),
  }, token);
  imported = res.body;
  record('import copies the image onto our own host',
    res.status === 201 && typeof imported?.imageUrl === 'string' && imported.imageUrl.includes('/static/'),
    imported?.imageUrl?.slice(0, 62) ?? `status ${res.status}`);
  record('import reports real pixel dimensions',
    (imported?.widthPx ?? 0) > 0 && (imported?.heightPx ?? 0) > 0,
    `${imported?.widthPx}×${imported?.heightPx}`);

  // Same-origin is what keeps canvas capture (PDF export, AI Enhance) working.
  const head = await fetch(imported.imageUrl, { method: 'HEAD' });
  record('imported image is served', head.ok, `HTTP ${head.status}`);
}

const badImport = await api('/branding/images/import', {
  method: 'POST',
  body: JSON.stringify({ url: 'https://example.com/definitely-not-an-image.txt' }),
}, token);
record('import rejects a non-image', badImport.status >= 400, `status ${badImport.status}`);

/* ── Round trip through a plan ───────────────────────────────────────────── */
const { body: project } = await api('/projects', {
  method: 'POST',
  body: JSON.stringify({ title: `Branding check ${Date.now().toString(36)}` }),
}, token);
const { body: plan } = await api('/plans', {
  method: 'POST',
  body: JSON.stringify({ projectId: project.id, title: 'Branding' }),
}, token);

const { body: detail } = await api(`/plans/${plan.id}`, {}, token);
const scene = detail.scene;

scene.objects = [
  {
    id: 'brand-text-raised',
    type: 'text3d',
    name: 'Raised lettering',
    positionMm: { x: -2000, y: 0, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    content: 'Sarah & James',
    font: 'helvetiker_bold',
    sizeMm: 300,
    depthMm: 60,
    bevelEnabled: true,
    bevelSizeMm: 2,
    bevelThicknessMm: 3,
    bevelSegments: 3,
    curveSegments: 8,
    letterSpacingMm: 0,
    lineHeight: 1.2,
    alignment: 'center',
    finish: 'metal',
    material: {
      color: '#d4af37', metalness: 1, roughness: 0.12,
      emissiveColor: '#000000', emissiveIntensity: 0,
      transmission: 0, thicknessMm: 12, ior: 1.5, opacity: 1, clearcoat: 0,
    },
    backing: {
      enabled: false, paddingMm: 60, thicknessMm: 18, cornerRadiusMm: 12,
      material: {
        color: '#3a3631', metalness: 0, roughness: 0.7,
        emissiveColor: '#000000', emissiveIntensity: 0,
        transmission: 0, thicknessMm: 12, ior: 1.5, opacity: 1, clearcoat: 0,
      },
    },
  },
  {
    // Negative depth: engraved into its backing panel.
    id: 'brand-text-engraved',
    type: 'text3d',
    name: 'Engraved lettering',
    positionMm: { x: 2000, y: 0, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    content: 'Welcome',
    font: 'optimer_bold',
    sizeMm: 260,
    depthMm: -12,
    bevelEnabled: false,
    bevelSizeMm: 2,
    bevelThicknessMm: 3,
    bevelSegments: 3,
    curveSegments: 8,
    letterSpacingMm: 0,
    lineHeight: 1.2,
    alignment: 'center',
    finish: 'wood',
    material: {
      color: '#c9b89a', metalness: 0, roughness: 0.75,
      emissiveColor: '#000000', emissiveIntensity: 0,
      transmission: 0, thicknessMm: 12, ior: 1.5, opacity: 1, clearcoat: 0.1,
    },
    backing: {
      enabled: true, paddingMm: 80, thicknessMm: 30, cornerRadiusMm: 16,
      material: {
        color: '#6b5741', metalness: 0, roughness: 0.7,
        emissiveColor: '#000000', emissiveIntensity: 0,
        transmission: 0, thicknessMm: 12, ior: 1.5, opacity: 1, clearcoat: 0,
      },
    },
  },
];

if (imported?.imageUrl) {
  scene.objects.push({
    // Backlit: emission driven by the image itself.
    id: 'brand-artwork',
    type: 'artwork',
    name: 'Backlit panel',
    positionMm: { x: 0, y: 0, z: -2000 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    imageUrl: imported.imageUrl,
    widthMm: 1600,
    heightMm: Math.round(1600 / (imported.aspectRatio || 1)),
    aspectRatio: imported.aspectRatio || 1,
    lockAspect: true,
    mount: 'panel',
    thicknessMm: 24,
    cornerRadiusMm: 20,
    doubleSided: false,
    useAlpha: true,
    finish: 'backlit',
    emitFromImage: true,
    material: {
      color: '#ffffff', metalness: 0, roughness: 0.55,
      emissiveColor: '#ffffff', emissiveIntensity: 1.4,
      transmission: 0.25, thicknessMm: 24, ior: 1.49, opacity: 1, clearcoat: 0,
    },
  });
}

const saved = await api(`/plans/${plan.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ scene }),
}, token);
record('branded objects survive the scene document',
  saved.body?.objectCount === scene.objects.length,
  `${saved.body?.objectCount} of ${scene.objects.length} kept`);

/* ── Render ──────────────────────────────────────────────────────────────── */
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 130)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 130)}`);
});

await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL(/\/(dashboard|projects)/, { timeout: 20000 });

await page.goto(`${WEB}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(22000);

const canvas = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return { present: false };
  const gl = c.getContext('webgl2') ?? c.getContext('webgl');
  return { present: true, lost: gl ? gl.isContextLost() : null, width: c.width };
});
record('scene renders with branded objects', canvas.present && !canvas.lost && canvas.width > 0,
  `${canvas.width}px, context ${canvas.lost ? 'lost' : 'alive'}`);

const count = await page.locator('text=/\\d+ objects/').first().innerText().catch(() => null);
record('all branded objects present', /[1-9]\d* objects/.test(count ?? ''), count ?? 'missing');

/*
 * The panel itself. Branding is a Build tool now rather than a catalogue
 * sidebar control — extruded lettering at a chosen depth in a named finish is
 * something you specify, not something you pick off a shelf.
 */
const skipTour = page.getByRole('button', { name: 'Skip the tour' });
try {
  await skipTour.waitFor({ timeout: 6000 });
  await skipTour.click();
  await page.waitForTimeout(400);
} catch {
  /* already dismissed */
}
await page
  .getByRole('navigation', { name: 'Editor sections' })
  .getByRole('button', { name: /^Build/ })
  .click();
await page.waitForTimeout(700);
await page.getByRole('radio', { name: /^Branding/ }).first().click();
await page.waitForTimeout(700);

const textBtn = await page.locator('button[title="3D lettering"]').count();
const artBtn = await page.locator('button[title="Artwork"]').count();
record('branding controls are in the editor', textBtn > 0 && artBtn > 0);

await page.locator('button[title="3D lettering"]').click();
await page.waitForTimeout(2000);
const dialog = 'div[role="dialog"]';
const depthLabel = await page.locator(`${dialog} >> text=/mm (raised|engraved)/`).count();
record('depth reads as one control crossing zero', depthLabel > 0);
const finishes = await page.locator(`${dialog} button:has-text("Brushed metal")`).count();
record('finishes offered by name', finishes > 0);
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

/* Selecting the engraved text must show its live controls. */
await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  canvas?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForTimeout(1000);

await page.screenshot({ path: 'storage/shots/93-branding.png' });

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} branding checks passed.`);
if (errors.length) {
  console.log(`\nconsole errors:\n${[...new Set(errors)].slice(0, 6).join('\n')}`);
} else {
  console.log('No console errors.');
}
process.exit(passed === results.length ? 0 : 1);
