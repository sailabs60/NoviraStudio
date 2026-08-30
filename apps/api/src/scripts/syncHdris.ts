/**
 * Mirror the lighting environments locally.
 *
 * The editor's twelve lighting presets are Poly Haven HDRIs (all CC0). Serving
 * them from our own storage means the viewport never depends on a third-party
 * CDN mid-session, and lets us ship the small 1k variants rather than whatever
 * size a preset helper decides to fetch.
 */
import { LIGHTING_PRESETS } from '@novira/shared';
import { downloadToAssets } from '../services/storage.js';
import { hdriUrl } from '../services/assetSources/polyHavenDirect.js';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../lib/env.js';

async function alreadyHave(relative: string): Promise<boolean> {
  try {
    const info = await stat(path.join(env.assetDir, relative));
    return info.size > 10_000;
  } catch {
    return false;
  }
}

async function main() {
  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const preset of LIGHTING_PRESETS) {
    const relative = `hdri/${preset.file}`;
    if (await alreadyHave(relative)) {
      skipped += 1;
      console.log(`[hdri] = ${preset.label} (already present)`);
      continue;
    }

    // The preset filename encodes the slug and resolution: `venice_sunset_1k.hdr`.
    const slug = preset.file.replace(/_1k\.hdr$/, '');
    const url = await hdriUrl(slug, '1k');
    if (!url) {
      failed += 1;
      console.warn(`[hdri] ! ${preset.label} — no 1k HDR published for "${slug}"`);
      continue;
    }

    try {
      const saved = await downloadToAssets(url, relative, { maxBytes: 25 * 1024 * 1024 });
      fetched += 1;
      console.log(`[hdri] + ${preset.label} — ${(saved.size / 1024 / 1024).toFixed(1)} MB`);
    } catch (err) {
      failed += 1;
      console.warn(`[hdri] ! ${preset.label} — ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n[hdri] ${fetched} fetched, ${skipped} already present, ${failed} failed.`);
}

main().catch((err) => {
  console.error('[hdri] failed:', err);
  process.exit(1);
});
