import { chromium } from 'playwright';

const BASE = process.env.NOVIRA_WEB ?? 'http://localhost:5174';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} — ${r.failure()?.errorText}`));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL('**/dashboard', { timeout: 30000 });

console.log('navigating to editor…');
await page.goto(`${BASE}/editor/1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);

console.log('url:', page.url());
const info = await page.evaluate(() => ({
  canvases: document.querySelectorAll('canvas').length,
  headerText: document.querySelector('header h1')?.textContent ?? null,
  catalogItems: document.querySelectorAll('button.ed-item-card').length,
  bodyStart: (document.body.innerText || '').slice(0, 400),
}));
console.log(JSON.stringify(info, null, 2));

// Screenshot only the DOM chrome, avoiding the animating canvas entirely.
await page
  .locator('header')
  .first()
  .screenshot({ path: 'storage/shots/editor-header.png', timeout: 10000 })
  .catch((e) => console.log('header shot failed:', e.message));

console.log('\n--- logs ---');
for (const l of [...new Set(logs)].slice(0, 30)) console.log(l.slice(0, 400));

await browser.close();
