/**
 * Prepare the platform's photography for the web.
 *
 * Generated artwork arrives as very large PNGs — the set in `artwork/` is
 * 24 MB across twenty-six files, and one of them is 2.3 MB for a card that
 * renders 380 px wide. Shipping those straight out of `public/` would make the
 * landing page, which is the first thing anyone ever sees, the slowest page in
 * the product.
 *
 * So `artwork/` holds the originals, untouched and not served, and this writes
 * the web copies into `apps/web/public/`. Re-run it whenever a file there
 * changes or a new one arrives; it is idempotent.
 *
 *   node scripts/artwork.mjs            # build everything
 *   node scripts/artwork.mjs --check    # report what is missing, write nothing
 *
 * Two rules decide the output:
 *
 *  · **Photographs become JPEG.** None of them has transparency, and a JPEG at
 *    quality 82 is a tenth of the PNG at a size nobody can tell apart on a
 *    screen. The dimensions come from where the image is actually used, not
 *    from what the generator produced.
 *  · **The logo stays PNG.** It is the only artwork with an alpha channel, and
 *    it has to sit on azure, on white and on near-black without a box.
 *
 * `IMAGE_PROMPTS.md` in the repository root holds the prompt behind each name.
 */
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// sharp is hoisted to the workspace root; resolved from this file rather than
// from the working directory so the script runs from anywhere.
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const SOURCE = path.join(ROOT, 'artwork');
const PUBLIC = path.join(ROOT, 'apps/web/public');

/**
 * Where each picture goes and how big it needs to be.
 *
 * The widths are roughly twice the largest size the image is ever displayed at,
 * which covers a 2× display and nothing more. A banner shown 1200 px wide does
 * not need a 3200 px file.
 */
const SLOTS = [
  /* ── The landing page ───────────────────────────────────────────────── */
  { name: 'step-find', to: 'landing', width: 1200, height: 750 },
  { name: 'step-build', to: 'landing', width: 1200, height: 750 },
  { name: 'step-finish', to: 'landing', width: 1200, height: 750 },
  { name: 'step-cost', to: 'landing', width: 1200, height: 750 },
  { name: 'step-check', to: 'landing', width: 1200, height: 750 },
  { name: 'step-send', to: 'landing', width: 1200, height: 750 },
  { name: 'library-grid', to: 'landing', width: 1400, height: 1050 },
  { name: 'library-materials', to: 'landing', width: 1000, height: 1000, optional: true },
  { name: 'library-hdri', to: 'landing', width: 1000, height: 1000 },
  // Portrait, because the photograph is: a chair with a fan of swatches beside
  // it. Cropping it to a landscape band would throw away the swatches, which
  // are the half of the picture the section is about.
  { name: 'materials-drop', to: 'landing', width: 1000, height: 1250 },
  { name: 'deliverables-spread', to: 'landing', width: 2200, height: 943 },
  { name: 'who-agency', to: 'landing', width: 1200, height: 750 },
  { name: 'who-exhibition', to: 'landing', width: 1200, height: 750 },
  { name: 'who-venue', to: 'landing', width: 1200, height: 750 },

  /* ── In the product ─────────────────────────────────────────────────── */
  { name: 'empty-projects', to: 'app', width: 1400, height: 788 },
  { name: 'empty-plans', to: 'app', width: 1400, height: 788 },
  { name: 'auth-panel', to: 'app', width: 1000, height: 1333 },
  { name: 'marketplace-hero', to: 'app', width: 2000, height: 857 },
  { name: 'specialists-hero', to: 'app', width: 2000, height: 857 },
  { name: 'ai-studio-hero', to: 'app', width: 2000, height: 857 },
  { name: 'help-hero', to: 'app', width: 2000, height: 857 },
  { name: 'venues-hero', to: 'app', width: 2000, height: 857 },
  { name: 'share-cover', to: 'app', width: 1600, height: 900 },
  // Facebook, LinkedIn and X all read 1.91:1 and all crop anything else.
  { name: 'og-card', to: 'app', width: 1200, height: 630 },
];

/** The mark, which keeps its alpha and therefore its format. */
const LOGOS = [
  { name: 'logo-mark', size: 512 },
  { name: 'logo-mark-white', size: 512 },
  { name: 'logo-mark-black', size: 512 },
];

/**
 * Sizes a browser or a phone asks for by name.
 *
 * These are the *tile*: the white mark on an azure rounded square, exactly as
 * the header wears it. A bare azure truss on transparency is right on a page
 * and wrong in a tab strip, where it lands on whatever colour the browser
 * chose and shrinks to sixteen pixels of thin diagonal lines.
 */
const ICONS = [
  { out: 'favicon-32.png', size: 32 },
  { out: 'favicon-180.png', size: 180 },
  { out: 'icon-512.png', size: 512 },
];

/** Novira azure. */
const BRAND = { r: 0, g: 114, b: 253, alpha: 1 };

/** The rounded square the mark sits on, as an SVG the compositor can rasterise. */
function tile(size) {
  const radius = Math.round(size * 0.22);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${radius}" fill="#0072FD"/></svg>`
  );
}

const check = process.argv.includes('--check');

/** Find a source file by slot name, whatever extension it was saved with. */
async function findSource(name, available) {
  const match = available.find((file) => file.replace(/\.[^.]+$/, '').toLowerCase() === name);
  return match ? path.join(SOURCE, match) : null;
}

async function main() {
  let available;
  try {
    available = await readdir(SOURCE);
  } catch {
    console.error(`No artwork/ directory. Put the generated files there — see IMAGE_PROMPTS.md.`);
    process.exitCode = 1;
    return;
  }

  await mkdir(path.join(PUBLIC, 'landing'), { recursive: true });
  await mkdir(path.join(PUBLIC, 'app'), { recursive: true });

  const missing = [];
  let written = 0;
  let bytesIn = 0;
  let bytesOut = 0;

  for (const slot of SLOTS) {
    const source = await findSource(slot.name, available);
    if (!source) {
      if (!slot.optional) missing.push(`${slot.to}/${slot.name}`);
      continue;
    }
    const target = path.join(PUBLIC, slot.to, `${slot.name}.jpg`);
    bytesIn += (await stat(source)).size;
    if (check) continue;

    const out = await sharp(source)
      .resize(slot.width, slot.height, { fit: 'cover', position: 'attention' })
      // mozjpeg at 82 is the point where a photograph stops getting visibly
      // better and keeps getting bigger.
      .jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();
    await writeFile(target, out);
    bytesOut += out.length;
    written += 1;
  }

  for (const logo of LOGOS) {
    const source = await findSource(logo.name, available);
    if (!source) {
      missing.push(logo.name);
      continue;
    }
    bytesIn += (await stat(source)).size;
    if (check) continue;

    const out = await sharp(source)
      // `contain` rather than `cover`: a logo must never be cropped, and the
      // padding is transparent so it makes no mark of its own.
      .resize(logo.size, logo.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();
    await writeFile(path.join(PUBLIC, `${logo.name}.png`), out);
    bytesOut += out.length;
    written += 1;
  }

  const iconSource = await findSource('logo-mark-white', available);
  for (const icon of ICONS) {
    if (!iconSource || check) continue;
    // 68% of the tile, so the truss has air inside the corner radius rather
    // than running into it — the same inset the header uses.
    const inner = Math.round(icon.size * 0.68);
    const mark = await sharp(iconSource)
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();
    const out = await sharp(tile(icon.size))
      .composite([{ input: mark, gravity: 'center' }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(path.join(PUBLIC, icon.out), out);
    bytesOut += out.length;
    written += 1;
  }

  // The drawn SVG favicon, rebuilt around the real mark rather than a letter N.
  if (!check && iconSource) {
    const inline = (await sharp(iconSource).resize(348, 348, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer()).toString('base64');
    await writeFile(
      path.join(PUBLIC, 'favicon.svg'),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
        `<rect width="512" height="512" rx="113" fill="#0072FD"/>` +
        `<image href="data:image/png;base64,${inline}" x="82" y="82" width="348" height="348"/>` +
        `</svg>
`
    );
    written += 1;
  }
  void BRAND;

  if (check) {
    console.log(missing.length ? `Missing: ${missing.join(', ')}` : 'Every slot has artwork.');
    return;
  }

  console.log(
    `${written} files written — ${(bytesIn / 1e6).toFixed(1)} MB of originals became ${(bytesOut / 1e6).toFixed(1)} MB on the page.`
  );
  if (missing.length) {
    console.log(`Still waiting on: ${missing.join(', ')} (see IMAGE_PROMPTS.md).`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
