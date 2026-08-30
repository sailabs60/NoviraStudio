/**
 * Drive the running dev app and capture screenshots, so UI work can be
 * verified against the real thing rather than assumed.
 *
 *   node scripts/shoot.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.NOVIRA_WEB ?? 'http://localhost:5174';
const OUT = 'storage/shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

async function shot(name) {
  await page.waitForTimeout(700);
  // The editor's WebGL canvas renders continuously, so Playwright's default
  // stability wait never settles. Disable animations and cap the wait.
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled', timeout: 15000 });
  console.log(`  captured ${name} — ${page.url()}`);
}

console.log('1. login page');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
await shot('01-login');

console.log('2. register page');
await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
await shot('02-register');

console.log('3. sign in');
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#email', 'planner@novira.test');
await page.fill('#password', 'novira123');
await page.click('button[type="submit"]');
await page.waitForURL('**/dashboard', { timeout: 30000 });
await shot('03-dashboard');

console.log('4. catalogue');
await page.goto(`${BASE}/catalog`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await shot('04-catalogue');

console.log('5. project');
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
const card = page.locator('a[href^="/projects/"]').first();
if (await card.count()) {
  await card.click();
  await page.waitForTimeout(1200);
  await shot('05-project');

  console.log('6. editor');
  const planLink = page.locator('a[href^="/editor/"]').first();
  if (await planLink.count()) {
    await planLink.click();
    await page.waitForTimeout(6000);
    await shot('06-editor');

    console.log('7. place an item');
    const item = page.locator('aside button.ed-item-card').first();
    if (await item.count()) {
      await item.click();
      await page.waitForTimeout(400);
      // Click the middle of the viewport to drop the item on the floor.
      const box = await page.locator('canvas').first().boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.62);
        await page.waitForTimeout(4000);
        await shot('07-editor-placed');
      }
    }
  }
}

console.log('8. account');
await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
await shot('08-account');

await browser.close();

if (errors.length) {
  console.log(`\n${errors.length} console error(s):`);
  for (const e of [...new Set(errors)].slice(0, 15)) console.log('  -', e.slice(0, 200));
} else {
  console.log('\nNo console errors.');
}
