/**
 * Catalogue sync.
 *
 * Pulls candidate models from the online asset pipeline, and admits only those
 * that survive verification. Nothing reaches the catalogue on the strength of
 * its name alone: every asset is downloaded, parsed, measured against the
 * plausible real-world size for what it claims to be, and scored.
 *
 *   npm run assets:sync -- --dry-run          classify only, download nothing
 *   npm run assets:sync -- --limit 40         cap the number of admissions
 *   npm run assets:sync -- --source polyhaven
 *   npm run assets:sync -- --category chairs
 *   npm run assets:sync -- --report           write a CSV of every decision
 */
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CATALOG_CATEGORIES } from '@novira/shared';
import { prisma } from '../lib/prisma.js';
import { classifyByHead } from '../services/assetClassifier.js';
import { inspectGltfFile } from '../services/gltfInspect.js';
import { verifyAsset, SOURCE_TRUST } from '../services/assetVerification.js';
import * as polyHaven from '../services/assetSources/polyHavenDirect.js';
import * as blenderKit from '../services/assetSources/blenderKitDirect.js';
import { searchPlan } from '../services/assetSources/eventSearchPlan.js';
import { downloadToAssets } from '../services/storage.js';

interface Args {
  dryRun: boolean;
  limit: number;
  source: string;
  category: string | null;
  report: boolean;
  resolution: '1k' | '2k' | '4k';
  concurrency: number;
  /** How far down the event search plan to go (search-based sources only). */
  tier: 1 | 2 | 3;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback?: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
  };
  return {
    dryRun: argv.includes('--dry-run'),
    limit: Number(get('--limit', '10000')),
    source: get('--source', 'polyhaven')!,
    category: get('--category', undefined) ?? null,
    report: argv.includes('--report'),
    resolution: (get('--resolution', '1k') as Args['resolution']) ?? '1k',
    concurrency: Number(get('--concurrency', '4')),
    tier: (Number(get('--tier', '3')) as Args['tier']) ?? 3,
  };
}

interface Decision {
  source: string;
  sourceId: string;
  name: string;
  verdict: string;
  score: number;
  identifiedAs: string;
  category: string;
  dimensions: string;
  scaleUnit: string;
  triangles: number;
  summary: string;
}

async function ensureCategories() {
  for (const c of CATALOG_CATEGORIES) {
    await prisma.catalogCategory.upsert({
      where: { slug: c.slug },
      create: { slug: c.slug, name: c.name, sortOrder: c.order },
      update: { name: c.name, sortOrder: c.order },
    });
  }
  const rows = await prisma.catalogCategory.findMany();
  return new Map(rows.map((r) => [r.slug, r.id]));
}

/** Run `worker` over `items` with bounded concurrency. */
async function pooled<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
}

async function syncPolyHaven(args: Args, categoryIds: Map<string, bigint>, decisions: Decision[]) {
  console.log('[sync] listing Poly Haven models…');
  const all = await polyHaven.listModels();
  console.log(`[sync] ${all.length} models in the library`);

  // Stage one is free: reject anything whose metadata cannot be read as an
  // event item before spending a download on it.
  const candidates: Array<{ asset: polyHaven.PolyHavenAsset; entryKey: string; category: string }> = [];
  let textRejected = 0;
  for (const asset of all) {
    const c = classifyByHead({
      name: asset.name,
      tags: asset.tags,
      categories: asset.categories,
    });
    if (!c.entry) {
      textRejected += 1;
      decisions.push({
        source: 'polyhaven',
        sourceId: asset.slug,
        name: asset.name,
        verdict: 'reject',
        score: 0,
        identifiedAs: '—',
        category: '—',
        dimensions: '—',
        scaleUnit: '—',
        triangles: 0,
        summary: c.reasons[0] ?? 'not an event item',
      });
      continue;
    }
    if (args.category && c.entry.category !== args.category) continue;
    candidates.push({ asset, entryKey: c.entry.key, category: c.entry.category });
  }

  console.log(
    `[sync] ${candidates.length} candidates after text classification (${textRejected} rejected on metadata)`
  );

  const admitted = { publish: 0, review: 0, reject: 0 };
  const slice = candidates.slice(0, args.limit);

  if (args.dryRun) {
    for (const c of slice) {
      decisions.push({
        source: 'polyhaven',
        sourceId: c.asset.slug,
        name: c.asset.name,
        verdict: 'candidate',
        score: 0,
        identifiedAs: c.entryKey,
        category: c.category,
        dimensions: 'not measured (dry run)',
        scaleUnit: '—',
        triangles: 0,
        summary: 'would download and verify',
      });
    }
    console.log(`[sync] dry run — ${slice.length} candidates would be downloaded and verified`);
    return admitted;
  }

  await pooled(slice, args.concurrency, async (candidate, index) => {
    const { asset } = candidate;
    const existing = await prisma.catalogItem.findFirst({
      where: { sourceKey: 'polyhaven', sourceAssetId: asset.slug },
      select: { id: true },
    });
    if (existing) {
      console.log(`[sync] (${index + 1}/${slice.length}) ${asset.slug} — already in catalogue, skipping`);
      return;
    }

    console.log(`[sync] (${index + 1}/${slice.length}) ${asset.slug} — downloading…`);
    const downloaded = await polyHaven.downloadModel(asset.slug, args.resolution);
    if (!downloaded) {
      admitted.reject += 1;
      decisions.push({
        source: 'polyhaven',
        sourceId: asset.slug,
        name: asset.name,
        verdict: 'reject',
        score: 0,
        identifiedAs: candidate.entryKey,
        category: candidate.category,
        dimensions: '—',
        scaleUnit: '—',
        triangles: 0,
        summary: 'download failed',
      });
      return;
    }

    const facts = await inspectGltfFile(downloaded.localPath);
    const result = verifyAsset({
      name: asset.name,
      tags: asset.tags,
      categories: asset.categories,
      facts,
      sourceKey: 'polyhaven',
      sourceTrust: SOURCE_TRUST.polyhaven,
    });

    decisions.push({
      source: 'polyhaven',
      sourceId: asset.slug,
      name: asset.name,
      verdict: result.verdict,
      score: result.score,
      identifiedAs: result.entry?.key ?? '—',
      category: result.category ?? '—',
      dimensions: result.dimensionsMm
        ? `${result.dimensionsMm.width}×${result.dimensionsMm.depth}×${result.dimensionsMm.height}`
        : '—',
      scaleUnit: result.scaleUnit,
      triangles: facts.triangleCount,
      summary: result.summary,
    });

    if (result.verdict === 'reject' || !result.entry || !result.dimensionsMm) {
      admitted.reject += 1;
      console.log(`[sync]   ✗ ${asset.name} — ${result.summary}`);
      return;
    }

    const categoryId = categoryIds.get(result.entry.category);
    if (!categoryId) {
      admitted.reject += 1;
      return;
    }

    await prisma.catalogItem.create({
      data: {
        categoryId,
        scope: 'global',
        name: asset.name,
        description: `${result.entry.label} · Poly Haven · CC0`,
        modelUrl: downloaded.modelUrl,
        previewImage: asset.thumbnailUrl,
        widthMm: result.dimensionsMm.width,
        depthMm: result.dimensionsMm.depth,
        heightMm: result.dimensionsMm.height,
        tableShape: result.entry.tableShape ?? null,
        seatsDefault: result.entry.seats ?? null,
        isFreePlanAvailable: result.entry.freePlan ?? false,
        triangleCount: facts.triangleCount,
        sourceKey: 'polyhaven',
        sourceLabel: 'Poly Haven',
        sourceAssetId: asset.slug,
        license: 'CC0',
        attribution: asset.authors.length ? `Poly Haven — ${asset.authors.join(', ')}` : 'Poly Haven',
        sourceUrl: `https://polyhaven.com/a/${asset.slug}`,
        reviewStatus: result.verdict === 'publish' ? 'approved' : 'pending',
        verifiedAt: new Date(),
        verificationScore: result.score,
        verificationNotes: JSON.parse(
          JSON.stringify({
            verdict: result.verdict,
            summary: result.summary,
            scaleUnit: result.scaleUnit,
            scaleToMm: result.scaleToMm,
            checks: result.checks,
          })
        ),
      },
    });

    if (result.verdict === 'publish') {
      admitted.publish += 1;
      console.log(`[sync]   ✓ ${asset.name} → ${result.entry.label} (${result.score}) ${result.dimensionsMm.width}×${result.dimensionsMm.height} mm`);
    } else {
      admitted.review += 1;
      console.log(`[sync]   ? ${asset.name} → review (${result.score}) — ${result.summary}`);
    }
  });

  return admitted;
}


/**
 * BlenderKit.
 *
 * Search-based rather than enumerable, so it works through the event search
 * plan instead of the whole library. Every result still passes the same gate
 * as Poly Haven: classify the name, download, measure the real geometry,
 * verify. BlenderKit carries a source trust of 0, so an asset from here is
 * admitted purely on what its mesh turns out to be — a community title earns
 * it nothing.
 */
async function syncBlenderKit(args: Args, categoryIds: Map<string, bigint>, decisions: Decision[]) {
  const plan = searchPlan(args.tier).filter((t) => !args.category || t.expect === args.category);
  console.log(`[sync] BlenderKit — ${plan.length} searches (tiers up to ${args.tier})`);

  const admitted = { publish: 0, review: 0, reject: 0 };

  // Gather first, so an asset returned by two different searches is only ever
  // downloaded once.
  const seen = new Set<string>();
  const candidates: Array<{ asset: blenderKit.BlenderKitAsset; entryKey: string; category: string }> = [];

  for (const term of plan) {
    const results = await blenderKit.search(term.query, 48);
    let kept = 0;
    for (const asset of results) {
      if (seen.has(asset.assetBaseId)) continue;
      seen.add(asset.assetBaseId);

      if (!blenderKit.licenceAcceptable(asset)) {
        decisions.push({
          source: 'blenderkit', sourceId: asset.assetBaseId, name: asset.name,
          verdict: 'reject', score: 0, identifiedAs: '—', category: '—',
          dimensions: '—', scaleUnit: '—', triangles: 0,
          summary: `licence not accepted (${asset.license})`,
        });
        continue;
      }

      const c = classifyByHead({
        name: asset.name,
        tags: asset.tags ?? [],
        categories: asset.category ? [asset.category] : [],
      });
      if (!c.entry) {
        decisions.push({
          source: 'blenderkit', sourceId: asset.assetBaseId, name: asset.name,
          verdict: 'reject', score: 0, identifiedAs: '—', category: '—',
          dimensions: '—', scaleUnit: '—', triangles: 0,
          summary: c.reasons[0] ?? 'not an event item',
        });
        continue;
      }
      if (args.category && c.entry.category !== args.category) continue;
      candidates.push({ asset, entryKey: c.entry.key, category: c.entry.category });
      kept += 1;
    }
    console.log(`[sync]   "${term.query}" → ${results.length} free glTF results, ${kept} plausible`);
  }

  console.log(`[sync] BlenderKit — ${candidates.length} candidates after text classification`);
  const slice = candidates.slice(0, args.limit);

  if (args.dryRun) {
    for (const c of slice) {
      decisions.push({
        source: 'blenderkit', sourceId: c.asset.assetBaseId, name: c.asset.name,
        verdict: 'candidate', score: 0, identifiedAs: c.entryKey, category: c.category,
        dimensions: 'not measured (dry run)', scaleUnit: '—', triangles: 0,
        summary: 'would download and verify',
      });
    }
    console.log(`[sync] dry run — ${slice.length} BlenderKit candidates would be downloaded`);
    return admitted;
  }

  await pooled(slice, args.concurrency, async (candidate, index) => {
    const { asset } = candidate;
    const existing = await prisma.catalogItem.findFirst({
      where: { sourceKey: 'blenderkit', sourceAssetId: asset.assetBaseId },
      select: { id: true },
    });
    if (existing) return;

    // The signed URL expires, so resolve it immediately before fetching.
    const signed = await blenderKit.resolveModelUrl(asset);
    if (!signed) {
      admitted.reject += 1;
      decisions.push({
        source: 'blenderkit', sourceId: asset.assetBaseId, name: asset.name,
        verdict: 'reject', score: 0, identifiedAs: candidate.entryKey, category: candidate.category,
        dimensions: '—', scaleUnit: '—', triangles: 0, summary: 'no downloadable glTF',
      });
      return;
    }

    console.log(`[sync] (${index + 1}/${slice.length}) ${asset.name} — downloading…`);
    let downloaded;
    try {
      downloaded = await downloadToAssets(signed, `blenderkit/${asset.assetBaseId}.glb`, {
        maxBytes: 40 * 1024 * 1024,
      });
    } catch (err) {
      admitted.reject += 1;
      decisions.push({
        source: 'blenderkit', sourceId: asset.assetBaseId, name: asset.name,
        verdict: 'reject', score: 0, identifiedAs: candidate.entryKey, category: candidate.category,
        dimensions: '—', scaleUnit: '—', triangles: 0,
        summary: `download failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const facts = await inspectGltfFile(downloaded.path);
    const result = verifyAsset({
      name: asset.name,
      tags: asset.tags ?? [],
      categories: asset.category ? [asset.category] : [],
      facts,
      sourceKey: 'blenderkit',
      sourceTrust: SOURCE_TRUST.blenderkit,
    });

    decisions.push({
      source: 'blenderkit', sourceId: asset.assetBaseId, name: asset.name,
      verdict: result.verdict, score: result.score,
      identifiedAs: result.entry?.key ?? '—', category: result.category ?? '—',
      dimensions: result.dimensionsMm
        ? `${result.dimensionsMm.width}×${result.dimensionsMm.depth}×${result.dimensionsMm.height}`
        : '—',
      scaleUnit: result.scaleUnit, triangles: facts.triangleCount, summary: result.summary,
    });

    if (result.verdict === 'reject' || !result.entry || !result.dimensionsMm) {
      admitted.reject += 1;
      console.log(`[sync]   ✗ ${asset.name} — ${result.summary}`);
      return;
    }

    const categoryId = categoryIds.get(result.entry.category);
    if (!categoryId) {
      admitted.reject += 1;
      return;
    }

    await prisma.catalogItem.create({
      data: {
        categoryId,
        scope: 'global',
        name: asset.name,
        description: `${result.entry.label} · BlenderKit · ${asset.license}`,
        modelUrl: downloaded.url,
        previewImage: blenderKit.thumbnailUrl(asset),
        widthMm: result.dimensionsMm.width,
        depthMm: result.dimensionsMm.depth,
        heightMm: result.dimensionsMm.height,
        tableShape: result.entry.tableShape ?? null,
        seatsDefault: result.entry.seats ?? null,
        isFreePlanAvailable: false,
        triangleCount: facts.triangleCount,
        sourceKey: 'blenderkit',
        sourceLabel: 'BlenderKit',
        sourceAssetId: asset.assetBaseId,
        license: asset.license,
        attribution: blenderKit.attributionFor(asset),
        sourceUrl: blenderKit.sourceUrlFor(asset),
        reviewStatus: result.verdict === 'publish' ? 'approved' : 'pending',
        verifiedAt: new Date(),
        verificationScore: result.score,
        verificationNotes: JSON.parse(
          JSON.stringify({
            verdict: result.verdict, summary: result.summary,
            scaleUnit: result.scaleUnit, scaleToMm: result.scaleToMm, checks: result.checks,
          })
        ),
      },
    });

    if (result.verdict === 'publish') {
      admitted.publish += 1;
      console.log(
        `[sync]   ✓ ${asset.name} → ${result.entry.label} (${result.score}) ${result.dimensionsMm.width}×${result.dimensionsMm.height} mm`
      );
    } else {
      admitted.review += 1;
      console.log(`[sync]   ? ${asset.name} → review (${result.score}) — ${result.summary}`);
    }
  });

  return admitted;
}

async function main() {
  const args = parseArgs();
  console.log('[sync] options:', args);

  const categoryIds = await ensureCategories();
  console.log(`[sync] ${categoryIds.size} catalogue categories ready`);

  const decisions: Decision[] = [];
  let totals = { publish: 0, review: 0, reject: 0 };

  const add = (a: typeof totals, b: typeof totals) => ({
    publish: a.publish + b.publish,
    review: a.review + b.review,
    reject: a.reject + b.reject,
  });

  if (args.source === 'polyhaven' || args.source === 'all') {
    totals = add(totals, await syncPolyHaven(args, categoryIds, decisions));
  }
  if (args.source === 'blenderkit' || args.source === 'all') {
    totals = add(totals, await syncBlenderKit(args, categoryIds, decisions));
  }

  if (args.report) {
    const header = 'source,source_id,name,verdict,score,identified_as,category,dimensions_mm,scale_unit,triangles,summary';
    const rows = decisions.map((d) =>
      [
        d.source,
        d.sourceId,
        `"${d.name.replace(/"/g, '""')}"`,
        d.verdict,
        d.score,
        d.identifiedAs,
        d.category,
        d.dimensions,
        d.scaleUnit,
        d.triangles,
        `"${d.summary.replace(/"/g, '""')}"`,
      ].join(',')
    );
    const out = path.resolve('storage/asset-sync-report.csv');
    await writeFile(out, [header, ...rows].join('\n'), 'utf8');
    console.log(`[sync] report written to ${out} (${rows.length} rows)`);
  }

  const total = await prisma.catalogItem.count();
  const approved = await prisma.catalogItem.count({ where: { reviewStatus: 'approved' } });
  console.log(
    `\n[sync] done — published ${totals.publish}, needs review ${totals.review}, rejected ${totals.reject}.`
  );
  console.log(`[sync] catalogue now holds ${total} items (${approved} approved).`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[sync] failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
