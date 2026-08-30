/**
 * Branding: artwork search and import.
 *
 * Searching is free and hits Openverse live. Importing copies the image onto
 * our own host, which matters for three reasons: a remote image can disappear
 * or change under a saved plan, cross-origin textures taint the WebGL canvas
 * and break both PDF export and AI Enhance, and a proposal has to keep working
 * offline once it has been sent.
 */
import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import multer from 'multer';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { searchImages } from '../services/imageSearch.js';
import { downloadToAssets, saveUpload } from '../services/storage.js';
import { env } from '../lib/env.js';

export const brandingRouter = Router();
brandingRouter.use(requireAuth);

const MAX_ARTWORK_BYTES = 25 * 1024 * 1024;
const artworkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ARTWORK_BYTES },
});
const ALLOWED_IMAGE = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

/**
 * The planner's own artwork — a client logo, a supplied monogram.
 *
 * Dimensions come back with it because the panel derives the physical height
 * from the pixel aspect, so an uploaded logo is never placed stretched.
 */
brandingRouter.post(
  '/images/upload',
  artworkUpload.single('file'),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw ApiError.badRequest('No image was uploaded.');
    if (!ALLOWED_IMAGE.has(file.mimetype)) {
      throw ApiError.badRequest('Select a PNG, JPG, WEBP or GIF image.');
    }

    let widthPx = 0;
    let heightPx = 0;
    let output: Buffer;
    try {
      const image = sharp(file.buffer, { failOn: 'error' });
      const meta = await image.metadata();
      if (!meta.width || !meta.height) throw new Error('no dimensions');
      // Cap the longest edge: a 6000 px client logo costs texture memory in
      // every viewport for detail no one will see at signage scale.
      output = await image
        .resize({ width: Math.min(meta.width, 2048), withoutEnlargement: true })
        .png({ compressionLevel: 8 })
        .toBuffer();
      const resized = await sharp(output).metadata();
      widthPx = resized.width ?? meta.width;
      heightPx = resized.height ?? meta.height;
    } catch {
      throw ApiError.badRequest('That image could not be read. Try re-exporting it.');
    }

    const saved = await saveUpload(output, { extension: 'png', subdir: 'branding' });
    res.status(201).json({
      url: saved.url,
      widthPx,
      heightPx,
      aspectRatio: heightPx > 0 ? widthPx / heightPx : 1,
    });
  })
);

brandingRouter.get(
  '/images/search',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        q: z.string().trim().min(2).max(120),
        page: z.coerce.number().int().min(1).max(20).optional(),
        transparent: z.coerce.boolean().optional(),
        orientation: z.enum(['wide', 'tall', 'square']).optional(),
      })
      .parse(req.query);

    const result = await searchImages({
      query: query.q,
      page: query.page ?? 1,
      transparentOnly: query.transparent ?? false,
      orientation: query.orientation,
    });
    res.json(result);
  })
);

/**
 * Copy a searched image onto our own host.
 *
 * The licence and credit line are stored with it so the proposal can print
 * attributions without the planner having to keep track of them.
 */
brandingRouter.post(
  '/images/import',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        url: z.string().url(),
        title: z.string().trim().max(240).optional(),
        license: z.string().trim().max(40).optional(),
        attribution: z.string().trim().max(400).optional(),
        sourceUrl: z.string().url().optional(),
        provider: z.string().trim().max(80).optional(),
      })
      .parse(req.body);

    const id = randomUUID();
    const downloaded = await downloadToAssets(body.url, `branding/${id}`, {
      maxBytes: 25 * 1024 * 1024,
    }).catch((err) => {
      throw new ApiError(
        502,
        'IMAGE_FETCH_FAILED',
        `Could not fetch that image: ${err instanceof Error ? err.message : 'unknown error'}`
      );
    });

    // Re-encode rather than trusting the source bytes: it normalises the format
    // for the texture loader, strips metadata, and proves the file really is an
    // image rather than something wearing an image URL.
    let width = 0;
    let height = 0;
    let finalUrl = downloaded.url;
    try {
      const image = sharp(downloaded.path, { failOn: 'error' });
      const meta = await image.metadata();
      width = meta.width ?? 0;
      height = meta.height ?? 0;
      if (!width || !height) throw new Error('no dimensions');

      // Keep alpha — cut-out logos are the main reason to import at all.
      const outPath = `${downloaded.path}.png`;
      await image
        .resize({ width: Math.min(width, 2048), withoutEnlargement: true })
        .png({ compressionLevel: 8 })
        .toFile(outPath);
      finalUrl = `${downloaded.url}.png`;

      const resized = await sharp(outPath).metadata();
      width = resized.width ?? width;
      height = resized.height ?? height;
    } catch {
      throw new ApiError(415, 'NOT_AN_IMAGE', 'That file could not be read as an image.');
    }

    res.status(201).json({
      imageUrl: finalUrl,
      widthPx: width,
      heightPx: height,
      aspectRatio: height > 0 ? width / height : 1,
      title: body.title ?? null,
      license: body.license ?? null,
      attribution: body.attribution ?? null,
      sourceUrl: body.sourceUrl ?? null,
      sourceLabel: body.provider ?? 'Openverse',
    });
  })
);

/**
 * The planner's own uploaded artwork, so a client logo can be reused across
 * plans without being re-uploaded each time.
 */
brandingRouter.get(
  '/images/mine',
  asyncHandler(async (req, res) => {
    const items = await prisma.brandAsset.findMany({
      where: {
        OR: [
          { ownerId: req.user!.id },
          ...(req.user!.companyId ? [{ companyId: req.user!.companyId }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({
      items: items.map((a) => ({
        id: Number(a.id),
        name: a.name,
        imageUrl: a.imageUrl,
        widthPx: a.widthPx,
        heightPx: a.heightPx,
        aspectRatio: a.heightPx > 0 ? a.widthPx / a.heightPx : 1,
        license: a.license,
        attribution: a.attribution,
        sourceUrl: a.sourceUrl,
        sourceLabel: a.sourceLabel,
        createdAt: a.createdAt.toISOString(),
        isOwner: a.ownerId === req.user!.id,
      })),
    });
  })
);

/** Keep an image in the planner's brand library. */
brandingRouter.post(
  '/images',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(180),
        imageUrl: z.string().min(1).max(512),
        widthPx: z.number().int().min(1),
        heightPx: z.number().int().min(1),
        license: z.string().trim().max(40).optional(),
        attribution: z.string().trim().max(400).optional(),
        sourceUrl: z.string().trim().max(512).optional(),
        sourceLabel: z.string().trim().max(80).optional(),
        shareWithCompany: z.boolean().optional(),
      })
      .parse(req.body);

    const asset = await prisma.brandAsset.create({
      data: {
        ownerId: req.user!.id,
        companyId: body.shareWithCompany ? req.user!.companyId : null,
        name: body.name,
        imageUrl: body.imageUrl,
        widthPx: body.widthPx,
        heightPx: body.heightPx,
        license: body.license ?? null,
        attribution: body.attribution ?? null,
        sourceUrl: body.sourceUrl ?? null,
        sourceLabel: body.sourceLabel ?? null,
      },
    });
    res.status(201).json({ id: Number(asset.id) });
  })
);

brandingRouter.delete(
  '/images/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw ApiError.notFound('Not found.');
    const asset = await prisma.brandAsset.findUnique({ where: { id: BigInt(id) } });
    if (!asset) throw ApiError.notFound('That artwork no longer exists.');
    if (asset.ownerId !== req.user!.id && req.user!.role !== 'super_admin') {
      throw ApiError.forbidden('You can only remove artwork you added.');
    }
    await prisma.brandAsset.delete({ where: { id: BigInt(id) } });
    res.json({ deleted: true });
  })
);

/** Where uploads land, for the client to POST its own files to. */
brandingRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json({ maxUploadBytes: 25 * 1024 * 1024, assetBase: `${env.publicBaseUrl}/static/assets` });
  })
);
