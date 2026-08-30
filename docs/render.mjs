import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const src = path.resolve('docs/nozila-spec.html');
const out = path.resolve('docs/Nozila-Rebuild-Specification.pdf');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file:///' + src.replace(/\\/g, '/'), { waitUntil: 'networkidle', timeout: 120000 });
await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(1200);

await page.pdf({
  path: out,
  format: 'A4',
  printBackground: true,
  margin: { top: '16mm', bottom: '18mm', left: '15mm', right: '15mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `
    <div style="width:100%;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:7pt;color:#8b95a6;
                padding:0 15mm;display:flex;justify-content:space-between;align-items:center;">
      <span>Nozila &middot; Rebuild Specification</span>
      <span class="pageNumber"></span>
    </div>`,
});

await browser.close();
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`PDF written: ${out} (${kb} KB)`);
