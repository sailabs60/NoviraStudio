/**
 * Reproduce two reported failures:
 *   1. the drafting tools do nothing in the viewport
 *   2. lettering already in the scene cannot be edited
 *
 * Reports what actually happens at each step rather than asserting a result.
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
  body: JSON.stringify({ title: `Repro ${Date.now().toString(36)}` }),
}, token);
const plan = await api('/plans', {
  method: 'POST',
  body: JSON.stringify({ projectId: project.id, title: 'Repro' }),
}, token);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
});

await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL(/\/(dashboard|projects)/, { timeout: 20000 });
await page.goto(`${WEB}/editor/${plan.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(17000);

const objects = async () => {
  const t = await page.locator('text=/\\d+ objects/').first().innerText().catch(() => '0 objects');
  return Number((t.match(/(\d+) objects/) ?? [0, 0])[1]);
};
const panel = async () =>
  (await page.locator('aside').last().innerText().catch(() => '')).replace(/\s+/g, ' ');

console.log('=== 1. Drafting in the viewport ===');

await page.locator('button[title="Drafting tool"]').click();
await page.waitForTimeout(1500);
console.log('panel after activating Draft:', (await panel()).slice(0, 90));

const camMode = await page.locator('button:has-text("3D"), button:has-text("Top")').allInnerTexts();
console.log('camera buttons:', camMode.join('/'));

const box = await page.locator('canvas').boundingBox();

/* In the default 3D view, exactly as a user would find it. */
console.log('-- clicking in the default 3D view --');
for (const [fx, fy] of [[0.4, 0.6], [0.55, 0.65], [0.45, 0.7]]) {
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await page.waitForTimeout(700);
}
console.log('objects after 3 clicks in 3D:', await objects());
console.log('draft state:', (await panel()).match(/\d+ points? placed/)?.[0] ?? 'no points reported');

/* Then in top view, which is where the earlier test worked. */
console.log('-- switching to Top --');
await page.locator('button:has-text("Top")').first().click();
await page.waitForTimeout(2500);
for (const [fx, fy] of [[0.4, 0.45], [0.6, 0.45]]) {
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await page.waitForTimeout(800);
}
console.log('objects after 2 clicks in Top:', await objects());
console.log('draft state:', (await panel()).match(/\d+ points? placed/)?.[0] ?? 'no points reported');

await page.screenshot({ path: 'storage/shots/103-draw-repro.png' });

console.log('');
console.log('=== 2. Editing lettering already in the scene ===');

// Back to the select tool and add some lettering.
await page.locator('button[title="Drafting tool"]').click();
await page.waitForTimeout(1000);
await page.locator('button:has-text("3D")').first().click();
await page.waitForTimeout(2000);

await page.locator('button[title="3D lettering"]').click();
await page.waitForTimeout(2000);
await page.fill('div[role="dialog"] textarea', 'Hello World');
await page.locator('div[role="dialog"] button:has-text("Add lettering")').click();
await page.waitForTimeout(4000);

console.log('objects after adding lettering:', await objects());
console.log('panel right after adding:', (await panel()).slice(0, 140));

/* Deselect, then try to select it again the way a user would. */
await page.keyboard.press('Escape');
await page.waitForTimeout(1000);
console.log('panel after Escape:', (await panel()).slice(0, 70));

await page.locator('button[title^="Fit everything"]').click().catch(() => {});
await page.waitForTimeout(3000);

let reselected = false;
for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.48], [0.55, 0.52], [0.5, 0.45], [0.5, 0.55]]) {
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await page.waitForTimeout(1200);
  const text = await panel();
  if (/Lettering|Hello/.test(text)) {
    console.log(`re-selected by clicking at ${fx},${fy}`);
    reselected = true;
    break;
  }
}
console.log('could re-select the lettering by clicking:', reselected);
console.log('panel now:', (await panel()).slice(0, 160));

/* Whether or not clicking worked, is the editing UI reachable at all? */
const wordsField = await page.locator('aside textarea').count();
console.log('editable "Words" field present:', wordsField > 0);

if (wordsField > 0) {
  await page.locator('aside textarea').first().fill('Changed Text');
  await page.waitForTimeout(2500);
  await page.locator('button:has-text("Save")').first().click().catch(() => {});
  await page.waitForTimeout(2500);
  const scene = (await api(`/plans/${plan.id}`, {}, token)).scene;
  const t3d = scene.objects.find((o) => o.type === 'text3d');
  console.log('stored content after edit:', JSON.stringify(t3d?.content));
}

await page.screenshot({ path: 'storage/shots/104-text-repro.png' });
await browser.close();

console.log('');
console.log('=== errors ===');
console.log(errors.length ? [...new Set(errors)].slice(0, 8).join('\n') : 'none');
