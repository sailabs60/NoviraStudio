/**
 * A bad link on an LED wall must not take the scene with it.
 *
 * The original failure: content was loaded through react-three-fiber's
 * `useLoader`, which throws a promise for Suspense to catch. A *rejected*
 * promise — a typo, a link to an HTML page, a host that refuses hotlinking —
 * escapes the Suspense boundary as an uncaught error, unmounts the Canvas and
 * takes the WebGL context with it. The whole plan went white.
 */
import { chromium } from 'playwright';

const API = 'http://localhost:4100/api';
const WEB = process.env.NOVIRA_WEB ?? 'http://localhost:5174';

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const api = async (p, o = {}, t) =>
  (
    await fetch(API + p, {
      ...o,
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...o.headers },
    })
  ).json();

const { token } = await api('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: 'planner@novira.test', password: 'novira123' }),
});
const project = await api(
  '/projects',
  { method: 'POST', body: JSON.stringify({ title: `LED ${Date.now().toString(36)}` }) },
  token
);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

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
      await page.waitForTimeout(4000);
      return true;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

/** A wall carrying each kind of hostile URL in turn. */
const CASES = [
  ['a link that 404s', 'https://example.com/nope-not-here.png'],
  ['a link to a web page rather than an image', 'https://example.com/'],
  ['a host that does not exist at all', 'https://this-host-does-not-exist-novira.invalid/x.png'],
  ['nonsense typed into the field', 'htp:/not a url at all'],
];

for (const [label, url] of CASES) {
  const plan = await api(
    '/plans',
    { method: 'POST', body: JSON.stringify({ projectId: project.id, title: label }) },
    token
  );
  const scene = (await api(`/plans/${plan.id}`, {}, token)).scene;
  scene.objects = [
    {
      id: 'wall',
      type: 'led',
      name: 'LED wall',
      panelKey: 'p3-9-500',
      columns: 6,
      rows: 4,
      bottomMm: 600,
      curveDeg: 0,
      frame: 'ground-support',
      brightness: 0.8,
      glowIntensity: 0.6,
      contentColor: '#12203a',
      contentUrl: url,
      positionMm: { x: 0, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  ];
  await api(`/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ scene }) }, token);

  errors.length = 0;
  await page.goto(`${WEB}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
  const up = await ready();
  const skip = page.getByRole('button', { name: 'Skip the tour' });
  if (await skip.count()) await skip.click().catch(() => {});
  await page.waitForTimeout(3000);

  const alive = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { canvas: false, context: false };
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return { canvas: true, context: Boolean(gl) && !gl.isContextLost() };
  });

  record(`${label}: the viewport survives`, up && alive.canvas && alive.context);
  record(
    `${label}: no uncaught error`,
    errors.length === 0,
    errors.slice(0, 1).join('')
  );

  // The rest of the plan still has to work — an object list, a selectable wall.
  const body = await page.locator('body').innerText();
  record(`${label}: the plan still reports its contents`, /1 object/.test(body), body.match(/\d+ objects?/)?.[0] ?? '');
}

/* And a real image still shows. */
{
  const imported = await (
    await fetch(`${API}/branding/images/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url: 'https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg', title: 'Screen content' }),
    })
  ).json();

  record('a real image imports onto our own host', Boolean(imported.imageUrl), imported.imageUrl ?? JSON.stringify(imported).slice(0, 120));

  if (imported.imageUrl) {
    const plan = await api(
      '/plans',
      { method: 'POST', body: JSON.stringify({ projectId: project.id, title: 'good image' }) },
      token
    );
    const scene = (await api(`/plans/${plan.id}`, {}, token)).scene;
    scene.objects = [
      {
        id: 'wall',
        type: 'led',
        name: 'LED wall',
        panelKey: 'p3-9-500',
        columns: 6,
        rows: 4,
        bottomMm: 600,
        curveDeg: 0,
        frame: 'ground-support',
        brightness: 0.8,
        glowIntensity: 0.6,
        contentColor: '#12203a',
        contentUrl: imported.imageUrl,
        positionMm: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    ];
    await api(`/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ scene }) }, token);

    errors.length = 0;
    await page.goto(`${WEB}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
    await ready();
    await page.waitForTimeout(4000);

    record('a good image does not error either', errors.length === 0, errors.slice(0, 1).join(''));

    // Reading the canvas back proves the image did not taint it — which is what
    // PDF export, the plan thumbnail and AI Enhance all depend on.
    const readable = await page.evaluate(() => {
      try {
        const canvas = document.querySelector('canvas');
        return Boolean(canvas && canvas.toDataURL('image/png').length > 1000);
      } catch {
        return false;
      }
    });
    record('the canvas is still readable, so export and Enhance still work', readable);
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
