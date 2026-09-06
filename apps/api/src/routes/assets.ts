/**
 * Online assets.
 *
 * The catalogue in the database is what Novira has measured and stands behind.
 * This router is the door to everything else — eighteen public libraries,
 * searched live, merged and ranked into one list a designer can scroll forever.
 *
 * Four things happen here and nowhere else:
 *
 *  · **Paging that means something.** One fan-out produces one ordering; every
 *    page is a slice of it. Without that, "page 2" from eighteen independently
 *    paginated APIs is not the continuation of page 1, and infinite scroll
 *    quietly shows duplicates and gaps.
 *
 *  · **Import.** Browsing is not using. Import pulls the file onto our own
 *    storage, measures it, and writes a real catalogue row owned by the user —
 *    so the model keeps working when the upstream site rearranges its CDN, and
 *    so a plan saved today opens in a year.
 *
 *  · **Proxy.** Most providers serve without CORS headers, which a browser
 *    treats as a refusal. The proxy re-serves those bytes same-origin, from a
 *    host allow-list, so an image or a texture can be previewed before anyone
 *    commits to importing it.
 *
 *  · **Honesty about access.** Every row says whether it can be used, bought,
 *    or only looked at. A library that pretends everything is free produces a
 *    designer explaining to a client why the render cannot be built.
 */
import { Router } from 'express';
import path from 'node:path';
import { z } from 'zod';
import { CATALOG_CATEGORIES } from '@novira/shared';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import {
  ASSET_CATEGORIES,
  SHELVES,
  providerCatalogue,
  searchAssets,
  shelvesFor,
  type AssetCategory,
} from '../services/assetRegistry.js';
import { downloadToAssets } from '../services/storage.js';
import { inspectGltfFile, inferScale } from '../services/gltfInspect.js';
import { classifyByText } from '../services/assetTaxonomy.js';
import { resolveAsset } from '../services/assetResolve.js';

export const assetsRouter = Router();

/* ── Search ────────────────────────────────────────────────────────────── */

const searchQuery = z.object({
  category: z.enum(['models', 'materials', 'hdris', 'images']).default('models'),
  q: z.string().max(240).optional(),
  offset: z.coerce.number().int().min(0).max(20_000).default(0),
  limit: z.coerce.number().int().min(1).max(120).default(48),
  /** `usable` drops rows the viewport cannot actually load. */
  usable: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

assetsRouter.get(
  '/search',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const parsed = searchQuery.safeParse(req.query);
    if (!parsed.success) throw ApiError.badRequest('That search could not be understood.');
    const { category, q, offset, limit, usable } = parsed.data;

    const page = await searchAssets({ category, q, offset, limit, applicableOnly: usable });

    /*
     * A short cache header, deliberately. The ranked list behind this changes
     * only when the upstream libraries do, and letting a browser or a proxy
     * hold a page for a minute removes a whole class of duplicated work when
     * someone scrolls back up.
     */
    res.set('Cache-Control', 'private, max-age=60');
    res.json(page);
  })
);

/* ── Browse ────────────────────────────────────────────────────────────── */

assetsRouter.get(
  '/shelves',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const category = req.query.category as AssetCategory | undefined;
    const shelves = category && ASSET_CATEGORIES.includes(category) ? shelvesFor(category) : SHELVES;
    res.json({ items: shelves });
  })
);

assetsRouter.get(
  '/providers',
  optionalAuth,
  asyncHandler(async (_req, res) => {
    const providers = providerCatalogue();
    res.json({
      items: providers,
      // The number the UI puts next to "sources", so the claim is computed
      // rather than typed into a heading and left to rot.
      activeCount: providers.filter((p) => p.configured).length,
      totalCount: providers.length,
    });
  })
);

/* ── Resolve ───────────────────────────────────────────────────────────── */

const resolveBody = z.object({
  source: z.string().min(1).max(40),
  sourceAssetId: z.string().min(1).max(200),
  modelUrl: z.string().url().max(2048).nullish(),
  downloadApiUrl: z.string().url().max(2048).nullish(),
  viewerUrl: z.string().url().max(1024).nullish(),
});

/**
 * Hand back the file behind a search row.
 *
 * Called at the moment someone drags a model into the viewport rather than
 * when the row is drawn — the links these libraries mint are signed and
 * short-lived, so resolving a whole page of them up front would produce
 * hundreds of URLs that expire before anyone clicks one.
 */
assetsRouter.post(
  '/resolve',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = resolveBody.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('That asset could not be resolved.');
    const resolved = await resolveAsset(parsed.data);
    res.json(resolved);
  })
);

/* ── Proxy ─────────────────────────────────────────────────────────────── */

/**
 * Hosts the proxy will fetch from.
 *
 * An allow-list rather than a filter, because an open proxy on an
 * authenticated origin is a server-side request forgery waiting to happen —
 * someone would eventually point it at an internal address. Matching is on the
 * registrable suffix so a provider's CDN subdomains work without listing each.
 */
const PROXY_HOSTS = [
  'sketchfab.com',
  'sketchfabcdn.com',
  'sketchfab.net',
  'polyhaven.com',
  'polyhaven.org',
  'ambientcg.com',
  'ambientcg.org',
  'poly.pizza',
  'static.poly.pizza',
  'blenderkit.com',
  'blenderkit-cdn.com',
  'raw.githubusercontent.com',
  'githubusercontent.com',
  'github.com',
  'si.edu',
  'smithsonian.com',
  '3d-api.si.edu',
  'europeana.eu',
  'nasa.gov',
  'thingiverse.com',
  'thingiverse.cachefly.net',
  'myminifactory.com',
  'free3d.com',
  'images.unsplash.com',
  'unsplash.com',
  'pexels.com',
  'images.pexels.com',
  'pixabay.com',
  'cdn.pixabay.com',
  'openverse.org',
  'wp.com',
  'wikimedia.org',
  'pinimg.com',
  'pinterest.com',
];

function hostAllowed(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return PROXY_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

assetsRouter.get(
  '/proxy',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const raw = String(req.query.url ?? '');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw ApiError.badRequest('That is not a valid address.');
    }
    if (!hostAllowed(url)) {
      throw new ApiError(403, 'HOST_NOT_ALLOWED', 'Novira does not fetch from that host.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    // If the client goes away mid-stream there is no point finishing the fetch.
    req.on('close', () => controller.abort());

    try {
      const upstream = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { 'User-Agent': 'Novira/1.0 (asset preview)', Accept: '*/*' },
      });
      if (!upstream.ok || !upstream.body) {
        throw new ApiError(502, 'UPSTREAM_FAILED', `The source returned ${upstream.status}.`);
      }

      const type = upstream.headers.get('content-type') ?? 'application/octet-stream';
      const length = upstream.headers.get('content-length');
      res.set('Content-Type', type);
      if (length) res.set('Content-Length', length);
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');

      const reader = upstream.body.getReader();
      // Streamed rather than buffered: an 80 MB glTF must not sit in memory.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(Buffer.from(value))) {
          await new Promise((resolve) => res.once('drain', resolve));
        }
      }
      res.end();
    } finally {
      clearTimeout(timer);
    }
  })
);

/* ── Import ────────────────────────────────────────────────────────────── */

const importBody = z.object({
  source: z.string().min(1).max(40),
  sourceAssetId: z.string().min(1).max(160),
  name: z.string().min(1).max(180),
  modelUrl: z.string().url().max(2048).optional().nullable(),
  previewImage: z.string().url().max(1024).optional().nullable(),
  viewerUrl: z.string().url().max(512).optional().nullable(),
  sourceLabel: z.string().max(80).optional().nullable(),
  license: z.string().max(80).optional().nullable(),
  attribution: z.string().max(400).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  tags: z.array(z.string().max(60)).max(40).optional(),
  /** Category the user chose. Left out, the name is classified instead. */
  categorySlug: z.string().max(140).optional().nullable(),
  /**
   * The sibling files a plain-JSON glTF references by relative path — its
   * `.bin` buffer and every texture — mapped to where each one actually lives
   * upstream. A `.glb` packs all of this into one binary and needs nothing
   * here; Poly Haven's `.gltf` format is exactly this JSON-plus-parts shape,
   * and without these, the file this route just saved cites buffers that were
   * never downloaded — the model resolves, downloads, and then fails to load
   * with a 404 on its own `.bin`.
   */
  gltfIncludes: z.record(z.string().url().max(2048)).optional().nullable(),
});

const CATEGORY_SLUGS = new Set<string>(CATALOG_CATEGORIES.map((c) => c.slug));
const FALLBACK_SLUG = 'decor';

/**
 * Where an imported model should file itself, from its own words.
 *
 * The same classifier the offline asset pipeline uses, so a chair imported by
 * hand lands in Chairs exactly as a chair ingested by the sync job would. It
 * also hands back the expected real-world size for that kind of object, which
 * is what turns a unitless glTF into millimetres a plan can trust.
 */
function classifyAsset(name: string, description: string, tags: string[]) {
  const classified = classifyByText({ name, description, tags });
  const entry = classified.entry;
  const slug = entry?.category;
  return {
    slug: slug && CATEGORY_SLUGS.has(slug) ? slug : FALLBACK_SLUG,
    expected: entry ? { widthMm: entry.dims.widthMm, heightMm: entry.dims.heightMm } : undefined,
    tableShape: entry?.tableShape ?? null,
    seats: entry?.seats ?? null,
  };
}

assetsRouter.post(
  '/import',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = importBody.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? 'That asset could not be imported.');
    }
    const body = parsed.data;
    const user = req.user!;

    /*
     * Already imported? Return the existing row rather than a second copy.
     * Someone who drops the same chair twice is not asking for two catalogue
     * entries, and the second import would cost another download.
     */
    const existing = await prisma.catalogItem.findFirst({
      where: {
        ownerId: user.id,
        sourceKey: body.source,
        sourceAssetId: body.sourceAssetId,
        isActive: true,
      },
      include: { category: true, variations: true },
    });
    if (existing) {
      res.json({ item: serialise(existing), reused: true });
      return;
    }

    const guess = classifyAsset(body.name, body.description ?? '', body.tags ?? []);
    const slug =
      body.categorySlug && CATEGORY_SLUGS.has(body.categorySlug) ? body.categorySlug : guess.slug;

    const category = await prisma.catalogCategory.findUnique({ where: { slug } });
    if (!category) throw new ApiError(500, 'CATEGORY_MISSING', 'The catalogue is not set up for that category.');

    /*
     * Resolve first. A row from a search result usually has no direct URL —
     * the library mints a signed one on demand — so the import path asks for it
     * here rather than trusting whatever the client happened to be holding.
     */
    const resolved = await resolveAsset({
      source: body.source,
      sourceAssetId: body.sourceAssetId,
      modelUrl: body.modelUrl,
      viewerUrl: body.viewerUrl,
    });
    if (resolved.status !== 'ready') {
      throw new ApiError(
        409,
        'ASSET_NOT_DOWNLOADABLE',
        resolved.status === 'external'
          ? resolved.reason
          : resolved.reason || 'That asset cannot be downloaded.'
      );
    }

    // Fetch onto our own storage. Upstream CDNs move; a saved plan must not.
    const safeId = body.sourceAssetId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const ext = guessExtension(resolved.url, resolved.format);
    const relative = path.posix.join('imported', String(user.id), `${body.source}-${safeId}${ext}`);

    let stored: { path: string; url: string; size: number };
    try {
      stored = await downloadToAssets(resolved.url, relative, { timeoutMs: 90_000, maxBytes: 90 * 1024 * 1024 });
    } catch (error) {
      throw new ApiError(
        502,
        'IMPORT_FAILED',
        error instanceof Error && /too large/i.test(error.message)
          ? 'That model is larger than Novira will import. Try a lower-detail version.'
          : 'The source could not be downloaded. It may have moved or require an account.'
      );
    }

    /*
     * The rest of a plain-JSON glTF.
     *
     * `.glb` is one binary file and this loop never runs. A `.gltf` is a JSON
     * document that references its own geometry buffer and every texture by a
     * *relative* path sitting beside it — Poly Haven, in particular, ships
     * exactly this shape. Saving only the JSON leaves those references
     * pointing at nothing: the import reports success, and the model then
     * fails to load with a 404 on its own `.bin` the first time it is dropped
     * into a scene. Each entry here is fetched to the same relative position
     * next to the file just saved, so the loader's relative references resolve
     * exactly as they do upstream.
     *
     * Best-effort: a missing texture is a visibly grey surface, which is
     * recoverable by re-importing. A missing geometry buffer is not, so that
     * one failure is the one this rethrows for.
     */
    if (resolved.format === 'gltf' && body.gltfIncludes) {
      const baseDir = path.posix.dirname(relative);
      for (const [relPath, fileUrl] of Object.entries(body.gltfIncludes)) {
        const siblingRelative = path.posix.normalize(path.posix.join(baseDir, relPath));
        // Never let an upstream-supplied relative path escape the model's own
        // folder — `../../whatever` would otherwise write outside it.
        if (!siblingRelative.startsWith(baseDir + path.posix.sep) && siblingRelative !== baseDir) continue;
        try {
          await downloadToAssets(fileUrl, siblingRelative, { timeoutMs: 60_000, maxBytes: 40 * 1024 * 1024 });
        } catch (error) {
          const isBuffer = /\.bin$/i.test(relPath);
          if (isBuffer) {
            throw new ApiError(502, 'IMPORT_FAILED', 'The model geometry could not be downloaded. Try again.');
          }
          console.warn(`[assets.import] texture "${relPath}" for ${body.name} failed:`, error);
        }
      }
    }

    /*
     * Measure it. A model with no dimensions cannot be placed against a wall,
     * cannot be costed, and cannot be checked for clearance — so an import that
     * skipped this would produce a row that looks fine and behaves like a toy.
     */
    const facts = await inspectGltfFile(stored.path);
    const scale = facts.ok ? inferScale(facts, guess.expected) : null;

    const item = await prisma.catalogItem.create({
      data: {
        categoryId: category.id,
        ownerId: user.id,
        companyId: null,
        scope: 'personal',
        name: body.name.slice(0, 180),
        description: body.description?.slice(0, 2000) ?? null,
        modelUrl: stored.url,
        previewImage: body.previewImage ?? null,
        widthMm: scale?.sizeMm.width ?? null,
        depthMm: scale?.sizeMm.depth ?? null,
        heightMm: scale?.sizeMm.height ?? null,
        tableShape: guess.tableShape,
        seatsDefault: guess.seats,
        isFreePlanAvailable: true,
        isActive: true,
        // A personal import is the user's own risk and their own library, so it
        // is live immediately. Nothing they import is visible to anyone else.
        reviewStatus: 'approved',
        sourceKey: body.source.slice(0, 40),
        sourceLabel: (body.sourceLabel ?? body.source).slice(0, 80),
        sourceAssetId: body.sourceAssetId.slice(0, 160),
        license: body.license?.slice(0, 80) ?? null,
        attribution: body.attribution?.slice(0, 400) ?? null,
        sourceUrl: body.viewerUrl?.slice(0, 512) ?? null,
        triangleCount: facts.ok ? facts.triangleCount : null,
      },
      include: { category: true, variations: true },
    });

    res.status(201).json({ item: serialise(item), reused: false });
  })
);

function guessExtension(url: string, format?: string): string {
  const clean = url.split(/[?#]/)[0] ?? '';
  const found = /\.(glb|gltf|zip|fbx|obj)$/i.exec(clean);
  if (found) return `.${found[1]!.toLowerCase()}`;
  if (format === 'glb' || format === 'gltf' || format === 'zip') return `.${format}`;
  return '.glb';
}

type ItemWithRelations = Awaited<ReturnType<typeof prisma.catalogItem.findFirst>> extends infer T
  ? NonNullable<T> & { category: { slug: string }; variations: Array<{ id: bigint; name: string; materialId: string | null; textureUrl: string | null; isDefault: boolean }> }
  : never;

/** The same shape the catalogue router returns, so the UI has one item type. */
function serialise(row: ItemWithRelations) {
  return {
    id: Number(row.id),
    categoryId: Number(row.categoryId),
    categorySlug: row.category.slug,
    scope: row.scope as 'global' | 'company' | 'personal',
    name: row.name,
    description: row.description,
    modelUrl: row.modelUrl,
    previewImage: row.previewImage,
    widthMm: row.widthMm,
    depthMm: row.depthMm,
    heightMm: row.heightMm,
    diameterMm: row.diameterMm,
    tableShape: row.tableShape as 'round' | 'rectangular' | 'other' | null,
    seatsDefault: row.seatsDefault,
    isFreePlanAvailable: row.isFreePlanAvailable,
    isAccessible: true,
    lockReason: null,
    textureVariations: row.variations.map((v) => ({
      id: Number(v.id),
      name: v.name,
      materialId: v.materialId,
      textureUrl: v.textureUrl,
      isDefault: v.isDefault,
    })),
    sourceLabel: row.sourceLabel,
    license: row.license,
    attribution: row.attribution,
    reviewStatus: row.reviewStatus as 'pending' | 'approved' | 'rejected',
  };
}

/* ── What the user has imported ────────────────────────────────────────── */

assetsRouter.get(
  '/imported',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await prisma.catalogItem.findMany({
      where: { ownerId: req.user!.id, scope: 'personal', isActive: true },
      include: { category: true, variations: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ items: rows.map((row) => serialise(row as ItemWithRelations)) });
  })
);

assetsRouter.delete(
  '/imported/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = BigInt(req.params.id!);
    const row = await prisma.catalogItem.findFirst({ where: { id, ownerId: req.user!.id } });
    if (!row) throw ApiError.notFound('That item is not in your library.');
    /*
     * Deactivated, not deleted. Plans already reference this row by id, and
     * removing it would leave a placed object pointing at nothing — the model
     * disappears from someone's saved layout with no explanation.
     */
    await prisma.catalogItem.update({ where: { id }, data: { isActive: false } });
    res.json({ ok: true });
  })
);
