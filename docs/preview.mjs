import { chromium } from 'playwright';
import path from 'path';
import { pathToFileURL } from 'url';

const src = path.resolve('docs/nozila-spec.html');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
await page.goto(pathToFileURL(src).href, { waitUntil: 'networkidle', timeout: 120000 });
await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(900);

const H = 1123;
const shots = [[1, 0], [2, H * 1], [3, H * 4], [4, H * 9], [5, H * 16], [6, H * 26]];
for (const [i, y] of shots) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `docs/preview-${i}.png` });
}
await browser.close();
console.log('previews written');
