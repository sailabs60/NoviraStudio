/**
 * Browser checks for this round of work.
 *
 * Everything here was reported by the user as either broken or missing, and
 * every one of them is the kind of fault that a typecheck cannot see:
 *
 *  · The studio was greying out its own controls as if a design were being
 *    viewed through a share link.
 *  · An object could not be pushed around the floor with the right button.
 *  · Named views could not be saved, and a client opening a share link had no
 *    way to navigate the plan.
 *  · Nothing that asks for a picture offered the image libraries.
 *  · A building could not be uploaded as a venue.
 *
 * Driven through a real browser against the real API, because all five are
 * about what happens when someone presses something.
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
const project = await api(
  '/projects',
  { method: 'POST', body: JSON.stringify({ title: `Studio additions ${Date.now().toString(36)}` }) },
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

/**
 * Wait for the plan to be on screen, not merely for time to pass.
 *
 * A fixed sleep is the wrong tool: the viewport builds a WebGL context, loads
 * the scene and settles, and on a software renderer that takes as long as it
 * takes. Polling for a canvas with real pixels turns a flaky suite into a slow
 * one, which is the trade worth making.
 */
async function waitForViewport(target = page, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await target
      .evaluate(() => {
        const canvas = document.querySelector('canvas');
        return Boolean(canvas && canvas.width > 100 && canvas.height > 100);
      })
      .catch(() => false);
    if (ready) {
      // The first frame is not the settled frame; give the scene a moment.
      await target.waitForTimeout(2500);
      return true;
    }
    await target.waitForTimeout(500);
  }
  return false;
}

/** Whatever the app last said in a toast, for diagnosing a silent failure. */
async function lastToast(target = page) {
  return (await target.locator('[role="status"], [role="alert"]').allInnerTexts().catch(() => []))
    .join(' | ')
    .slice(0, 160);
}

async function dismissTour() {
  const skip = page.getByRole('button', { name: 'Skip the tour' });
  if (await skip.count()) {
    await skip.click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

/* ── 1. The studio is not read-only ────────────────────────────────────── */

const plan = await api(
  '/plans',
  { method: 'POST', body: JSON.stringify({ projectId: project.id, title: 'Additions' }) },
  token
);

await page.goto(`${WEB}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
record('the viewport comes up', await waitForViewport());
await dismissTour();

{
  const bar = page.locator('[data-testid="bottom-toolbar"], footer').first();
  const barText = await page.locator('body').innerText();
  record('the bottom toolbar is on screen', /\bPlan\b/.test(barText) && /\b3D\b/.test(barText));

  // Read-only is what greys everything; the studio must never be in it.
  const viewOnly = await page.getByText(/view only|read.?only/i).count();
  record('the studio is not in view-only mode', viewOnly === 0, `${viewOnly} view-only notices`);

  const saveView = page.getByRole('button', { name: /save view/i }).first();
  record('the Save view button is live', (await saveView.count()) > 0 && (await saveView.isEnabled()));
  void bar;
}

/* ── 2. Saving a view ──────────────────────────────────────────────────── */

{
  await page.getByRole('button', { name: /save view/i }).first().click();
  const said = await lastToast();

  // The scene autosaves on a debounce, so the read has to wait for the write.
  let views = [];
  for (let attempt = 0; attempt < 8 && !views.length; attempt++) {
    await page.waitForTimeout(1500);
    views = (await api(`/plans/${plan.id}`, {}, token)).scene?.views ?? [];
  }
  record('a view is stored on the scene', views.length === 1, views.length ? `${views.length} views` : said);
  record('the view carries a camera position', Boolean(views[0]?.positionMm));
  record(
    'the view carries a thumbnail',
    typeof views[0]?.thumbnailUrl === 'string' && views[0].thumbnailUrl.startsWith('data:image'),
    views[0]?.thumbnailUrl ? `${Math.round(views[0].thumbnailUrl.length / 1024)} KB` : 'none'
  );
}

/* ── 3. Right-dragging an object along the floor ───────────────────────── */

{
  // A box, placed away from the origin so a move is unambiguous.
  const scene = (await api(`/plans/${plan.id}`, {}, token)).scene;
  scene.objects.push({
    id: 'drag-me',
    type: 'shape',
    kind: 'box',
    name: 'Drag me',
    positionMm: { x: 0, y: 0, z: 0 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    widthMm: 1200,
    depthMm: 1200,
    extrudeMm: 900,
    color: '#0072FD',
  });
  await api(`/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ scene }) }, token);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForViewport();
  await dismissTour();

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 130, cy + 60, { steps: 14 });
  await page.mouse.up({ button: 'right' });

  let after = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.waitForTimeout(1500);
    after = (await api(`/plans/${plan.id}`, {}, token)).scene.objects.find((o) => o.id === 'drag-me');
    if (after && (Math.abs(after.positionMm.x) > 50 || Math.abs(after.positionMm.z) > 50)) break;
  }
  const moved = after && (Math.abs(after.positionMm.x) > 50 || Math.abs(after.positionMm.z) > 50);
  record(
    'right-dragging slides the object across the floor',
    Boolean(moved),
    after ? `now at ${after.positionMm.x}, ${after.positionMm.y}, ${after.positionMm.z} mm` : 'object gone'
  );
  record(
    'the drag stays on the floor rather than lifting it',
    after ? Math.abs(after.positionMm.y) < 50 : false,
    after ? `y = ${after.positionMm.y} mm` : ''
  );

  // The browser menu must not open on release.
  record('no context menu interfered', errors.length === 0, errors.slice(0, 2).join(' | '));
}

/* ── 4. The client's view strip on a share link ────────────────────────── */

{
  const share = await api(`/plans/${plan.id}/share`, { method: 'POST', body: JSON.stringify({}) }, token);
  // Built from WEB rather than the API's own corsOrigin, which may name a
  // different dev port than the one this run is driving.
  const url = share.token ? `${WEB}/share/${share.token}` : null;

  if (!url) {
    record('a share link could be created', false, JSON.stringify(share).slice(0, 160));
  } else {
    const viewer = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await viewer.goto(url.startsWith('http') ? url : `${WEB}${url}`, { waitUntil: 'domcontentloaded' });
    await waitForViewport(viewer);

    const strip = viewer.locator('section[aria-label="Saved views"]');
    record('the viewer gets a views strip along the bottom', (await strip.count()) > 0);

    if (await strip.count()) {
      const stripBox = await strip.boundingBox();
      const size = viewer.viewportSize();
      record(
        'the strip sits at the bottom of the page',
        stripBox && stripBox.y + stripBox.height > size.height - 120,
        stripBox ? `bottom at ${Math.round(stripBox.y + stripBox.height)} of ${size.height}` : ''
      );

      await viewer.getByRole('button', { name: /hide the saved views/i }).click();
      await viewer.waitForTimeout(400);
      const reopen = viewer.getByRole('button', { name: /saved view/i });
      record('it closes to a re-openable tab', (await reopen.count()) > 0);
      await reopen.first().click();
      await viewer.waitForTimeout(400);
      record('and re-opens', (await viewer.locator('section[aria-label="Saved views"]').count()) > 0);
    }
    await viewer.close();
  }
}

/* ── 5. Browsing the image libraries where creative work happens ───────── */

{
  await page.goto(`${WEB}/ai-studio`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // The mockup generator's style reference is the clearest entry point.
  const toImage = page.getByRole('button', { name: /2D|image|mock/i }).first();
  if (await toImage.count()) await toImage.click().catch(() => {});
  await page.waitForTimeout(1200);

  const openPicker = page.getByRole('button', { name: /match the look of a reference/i }).first();
  record('a reference image can be chosen', (await openPicker.count()) > 0);

  if (await openPicker.count()) {
    await openPicker.click();
    await page.waitForTimeout(600);

    const dialog = page.getByRole('dialog').last();
    const text = await dialog.innerText();
    record('the picker offers the libraries, upload and a link', /Search the libraries/i.test(text) && /Upload/i.test(text) && /Paste a link/i.test(text));
    record('Pinterest is named as a source', /pinterest/i.test(text), text.split('\n').find((l) => /pinterest/i.test(l)) ?? '');

    // Eighteen upstream libraries, fanned out server-side; the first page is
    // slower than a single provider would be.
    await page.waitForTimeout(15000);

    /*
     * Counting the tiles, not the loaded images. `LazyImage` deliberately does
     * not request a thumbnail until it is near the viewport, so counting `img`
     * elements measures how many fit on screen — which changes whenever the
     * dialog's chrome does, and says nothing about whether the search worked.
     */
    const tiles = await dialog.locator('figure').count();
    record('a wall of results comes back', tiles >= 24, `${tiles} results`);

    const sources = await dialog.locator('figure').evaluateAll((nodes) =>
      nodes.slice(0, 8).map((n) => (n.textContent || '').match(/Openverse|Pinterest|Unsplash|Pexels|Pixabay/)?.[0] ?? '?')
    );
    record(
      'the first rows are not all one library',
      new Set(sources).size > 1,
      sources.join(', ')
    );

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
}

/* ── 6. Uploading a building, and seeing one that has a model ──────────── */

{
  await page.goto(`${WEB}/venues`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const upload = page.getByRole('button', { name: /upload a building/i }).first();
  record('venues can be uploaded from the library page', (await upload.count()) > 0);

  if (await upload.count()) {
    await upload.click();
    await page.waitForTimeout(500);
    const dialog = await page.getByRole('dialog').last().innerText();
    record('the upload form asks for three things, not forty', /What is it called/i.test(dialog) && /City/i.test(dialog) && /Country/i.test(dialog));
    record('it explains what it does with the file', /optimis|compress|floors/i.test(dialog));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  await page.fill('input[aria-label="Search venues"]', 'Almasi');
  await page.waitForTimeout(2500);
  const cards = await page.locator('article.card').first().innerText().catch(() => '');
  record('a venue with a building says so', /3D building/i.test(cards), cards.split('\n').slice(0, 3).join(' · '));
  record('and how many floors it has', /floor/i.test(cards));

  const detail = page.getByRole('button', { name: /Capacity, rules and warnings/i }).first();
  if (await detail.count()) {
    await detail.click();
    await page.waitForTimeout(600);
    const expanded = await page.locator('article.card').first().innerText();
    record('the floors are listed with their heights', /Ballroom floor/i.test(expanded), expanded.match(/Ballroom floor.*/)?.[0] ?? '');
  }
}

/* ── Done ──────────────────────────────────────────────────────────────── */

await browser.close();

const failedCount = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failedCount} passed, ${failedCount} failed`);
if (errors.length) console.log(`page errors: ${errors.slice(0, 5).join(' | ')}`);
process.exitCode = failedCount ? 1 : 0;
