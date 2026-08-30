/**
 * Render catalogue thumbnails from the models themselves.
 *
 *   npm run thumbnails --workspace=apps/api            # only items missing one
 *   npm run thumbnails --workspace=apps/api -- --all   # re-render everything
 *   npm run thumbnails --workspace=apps/api -- --limit 20
 *
 * Every item needs a preview, whatever its provenance. Downloaded assets
 * usually arrive with a publisher's render, but procedurally generated ones
 * have no image at all, and a catalogue of grey placeholders is unusable — you
 * cannot pick a chair you cannot see.
 *
 * Rather than special-casing those, this renders the actual GLB in a headless
 * browser, so the thumbnail always depicts the geometry that will land in the
 * plan. That matters for a catalogue assembled from external sources: a
 * publisher's marketing render can flatter or plainly misrepresent the mesh,
 * and an image rendered from the file itself cannot.
 *
 * The camera frames each model from its own bounding box, so a 3 m banquet
 * table and a 40 cm plate both fill the frame.
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';

const ORIGIN = process.env.NOVIRA_API_ORIGIN ?? env.publicBaseUrl;
const OUT_REL = 'thumbnails';
const SIZE = 512;

const argv = process.argv.slice(2);
const renderAll = argv.includes('--all');
const limitIdx = argv.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : undefined;

const items = await prisma.catalogItem.findMany({
  where: {
    isActive: true,
    ...(renderAll ? {} : { OR: [{ previewImage: null }, { previewImage: '' }] }),
  },
  select: { id: true, name: true, modelUrl: true },
  orderBy: { id: 'asc' },
  ...(limit ? { take: limit } : {}),
});

if (!items.length) {
  console.log('Nothing to render — every active item already has a preview.');
  await prisma.$disconnect();
  process.exit(0);
}
console.log(`Rendering ${items.length} thumbnail${items.length === 1 ? '' : 's'}…`);

await mkdir(path.join(env.assetDir, OUT_REL), { recursive: true });

/*
 * three is ESM-only and GLTFLoader lives in examples/jsm, so there is no UMD
 * build to drop in with a script tag. Bundle a tiny entry with esbuild — the
 * same esbuild Vite already uses — so the page gets exactly the three version
 * the editor renders with. A model that renders here renders there.
 */
const bundlePath = path.join(os.tmpdir(), 'novira-thumb-harness.js');
await esbuild.build({
  stdin: {
    contents: [
      "import * as THREE from 'three';",
      "import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';",
      'window.THREE = THREE;',
      'window.GLTFLoader = GLTFLoader;',
    ].join('\n'),
    resolveDir: process.cwd(),
    loader: 'js',
  },
  bundle: true,
  format: 'iife',
  outfile: bundlePath,
  logLevel: 'silent',
});

const browser = await chromium.launch({
  // SwiftShader is the only renderer available here; without these Chromium can
  // fall back to a null device and every capture comes out blank.
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
page.on('pageerror', (e) => console.warn('  page error:', String(e).slice(0, 120)));

await page.setContent(
  `<!doctype html><html><body style="margin:0;background:transparent">` +
    `<canvas id="c" width="${SIZE}" height="${SIZE}"></canvas></body></html>`
);
await page.addScriptTag({ path: bundlePath });

const ready = await page.evaluate(() => {
  const w = globalThis as unknown as { THREE?: unknown; GLTFLoader?: unknown };
  return { three: typeof w.THREE !== 'undefined', loader: typeof w.GLTFLoader !== 'undefined' };
});
if (!ready.three || !ready.loader) {
  console.error('Could not load three.js / GLTFLoader in the page:', ready);
  await browser.close();
  await prisma.$disconnect();
  process.exit(1);
}

let done = 0;
let failed = 0;

for (const item of items) {
  const url = item.modelUrl.startsWith('http') ? item.modelUrl : `${ORIGIN}${item.modelUrl}`;

  const captured: string | { error: string } = await page
    .evaluate(
      async ({ url, size }: { url: string; size: number }) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const w = globalThis as any;
        const THREE = w.THREE;
        const GLTFLoader = w.GLTFLoader;
        const canvas = w.document.getElementById('c');

        const renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: true,
          alpha: true,
          preserveDrawingBuffer: true,
        });
        renderer.setSize(size, size, false);
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        const scene = new THREE.Scene();

        // Neutral three-point lighting: enough modelling to read the form, no
        // colour cast that would misrepresent the material.
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8d8d, 2.2));
        const key = new THREE.DirectionalLight(0xffffff, 2.4);
        key.position.set(3, 6, 4);
        scene.add(key);
        const fill = new THREE.DirectionalLight(0xffffff, 0.9);
        fill.position.set(-4, 2, -3);
        scene.add(fill);

        const gltf: any = await new Promise((resolve, reject) => {
          new GLTFLoader().load(url, resolve, undefined, reject);
        });

        const model = gltf.scene;
        scene.add(model);

        // Frame from the model's own bounds, so every item fills the frame
        // whatever its real-world size.
        const box = new THREE.Box3().setFromObject(model);
        if (box.isEmpty()) throw new Error('model has no geometry');
        const dims = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const radius = Math.max(dims.x, dims.y, dims.z) * 0.5 || 1;

        const camera = new THREE.PerspectiveCamera(35, 1, radius / 100, radius * 100);
        // Three-quarter view slightly above eye level — the angle that reads
        // most legibly as a product shot.
        const dir = new THREE.Vector3(1, 0.62, 1).normalize();
        const distance = (radius / Math.sin((35 * Math.PI) / 360)) * 1.15;
        camera.position.copy(centre.clone().add(dir.multiplyScalar(distance)));
        camera.lookAt(centre);

        renderer.render(scene, camera);
        const out = canvas.toDataURL('image/png');

        scene.remove(model);
        renderer.dispose();
        return out;
        /* eslint-enable @typescript-eslint/no-explicit-any */
      },
      { url, size: SIZE }
    )
    .catch((e: unknown) => ({ error: String(e).slice(0, 140) }));

  if (typeof captured !== 'string') {
    failed += 1;
    console.log(`  FAIL  ${item.name} — ${captured.error}`);
    continue;
  }

  const buffer = Buffer.from(captured.split(',')[1] ?? '', 'base64');

  // A blank capture means the renderer produced nothing. Recording that is
  // worse than leaving the item without a preview, because it looks deliberate.
  if (buffer.length < 2000) {
    failed += 1;
    console.log(`  FAIL  ${item.name} — blank capture (${buffer.length} bytes)`);
    continue;
  }

  const rel = `${OUT_REL}/item-${item.id}.png`;
  await writeFile(path.join(env.assetDir, rel), buffer);
  await prisma.catalogItem.update({
    where: { id: item.id },
    data: { previewImage: `${ORIGIN}/static/assets/${rel}` },
  });
  done += 1;
  console.log(`  ok    ${item.name} — ${(buffer.length / 1024).toFixed(0)} KB`);
}

await browser.close();
await prisma.$disconnect();

console.log(`\n${done} rendered, ${failed} failed.`);
process.exit(failed > 0 && done === 0 ? 1 : 0);
