import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { saveUpload, removeUpload } from '../services/storage.js';
import { env, mapsConfigured } from '../lib/env.js';
import { assertFeature } from '../services/access.js';
import { debit } from '../services/credits.js';

export const uploadsRouter = Router();

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
});

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml']);

/**
 * Background or floor-plan image.
 *
 * The response carries the pixel dimensions because calibration needs them:
 * the client measures a distance in image pixels and divides by the real-world
 * length the user types to get millimetres-per-pixel.
 */
uploadsRouter.post(
  '/background',
  requireAuth,
  upload.single('image'),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw ApiError.badRequest('No image was uploaded.');
    if (!ALLOWED.has(file.mimetype)) {
      throw ApiError.badRequest('Select a PNG, JPG, WEBP, GIF or SVG image.');
    }

    const purpose = req.body?.purpose === 'floor-plan' ? 'floor-plan' : 'background';
    const extension = file.mimetype === 'image/svg+xml' ? 'svg' : file.mimetype.split('/')[1]!;

    let widthPx = 0;
    let heightPx = 0;
    if (file.mimetype !== 'image/svg+xml') {
      try {
        const meta = await sharp(file.buffer).metadata();
        widthPx = meta.width ?? 0;
        heightPx = meta.height ?? 0;
      } catch {
        throw ApiError.badRequest('That image could not be read. Try re-exporting it.');
      }
    }

    const saved = await saveUpload(file.buffer, { extension, subdir: purpose });
    await prisma.upload.create({
      data: {
        fileKey: saved.key,
        ownerId: req.user!.id,
        contentType: file.mimetype,
        size: saved.size,
        purpose,
        url: saved.url,
      },
    });

    res.status(201).json({
      fileKey: saved.key,
      url: saved.url,
      widthPx,
      heightPx,
      size: saved.size,
      contentType: file.mimetype,
    });
  })
);

uploadsRouter.delete(
  '/:fileKey',
  requireAuth,
  asyncHandler(async (req, res) => {
    const fileKey = String(req.params.fileKey ?? '');
    const row = await prisma.upload.findUnique({ where: { fileKey } });
    if (!row) return res.json({ ok: true });
    if (row.ownerId !== req.user!.id && req.user!.role !== 'super_admin') {
      throw ApiError.forbidden('That file belongs to someone else.');
    }
    // The URL encodes the stored path; recover it to delete from disk.
    const relative = row.url.split('/static/uploads/')[1];
    if (relative) await removeUpload(relative);
    await prisma.upload.delete({ where: { fileKey } });
    res.json({ ok: true });
  })
);

/* ── Map import ────────────────────────────────────────────────────────── */

const mapQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  zoom: z.coerce.number().int().min(1).max(21).default(19),
  size: z.coerce.number().int().min(256).max(1280).default(640),
  scale: z.coerce.number().int().min(1).max(2).default(2),
  mapType: z.enum(['satellite', 'roadmap', 'hybrid', 'terrain']).default('satellite'),
});

/**
 * Ground-truth metres per pixel for a Web Mercator tile.
 *
 * At zoom z the world is 256·2^z pixels around, and the scale shrinks with
 * latitude by cos(lat). This is what lets an aerial capture drop into the plan
 * at true scale with no calibration step.
 */
function metresPerPixel(lat: number, zoom: number, scale: number): number {
  const EQUATOR_METRES = 156_543.03392;
  return (EQUATOR_METRES * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom / scale;
}

/**
 * Capture an aerial image server-side.
 *
 * Done on the server so the signing key never reaches the browser, and so the
 * scale can be computed and stored alongside the image rather than trusted from
 * the client.
 */
uploadsRouter.post(
  '/map',
  requireAuth,
  asyncHandler(async (req, res) => {
    const params = mapQuery.parse(req.body ?? {});
    const user = req.user!;

    // Metered: charged only once the capture actually succeeds.
    const access = await assertFeature(user, 'map_import');

    if (!mapsConfigured) {
      throw new ApiError(
        503,
        'PROVIDER_UNAVAILABLE',
        'Map import is not configured on this server. Add GOOGLE_MAPS_API_KEY to enable it.'
      );
    }

    const url =
      `https://maps.googleapis.com/maps/api/staticmap?center=${params.lat},${params.lng}` +
      `&zoom=${params.zoom}&size=${params.size}x${params.size}&scale=${params.scale}` +
      `&maptype=${params.mapType}&key=${env.maps.googleKey}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new ApiError(502, 'PROVIDER_UNAVAILABLE', 'The map service did not return an image.');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const saved = await saveUpload(buffer, { extension: 'png', subdir: 'map' });

    await prisma.upload.create({
      data: {
        fileKey: saved.key,
        ownerId: user.id,
        contentType: 'image/png',
        size: saved.size,
        purpose: 'map',
        url: saved.url,
      },
    });

    const mPerPx = metresPerPixel(params.lat, params.zoom, params.scale);
    const pixels = params.size * params.scale;

    if (access.cost > 0) await debit(user.id, 'map_import', null, access.cost);

    res.status(201).json({
      fileKey: saved.key,
      url: saved.url,
      widthPx: pixels,
      heightPx: pixels,
      // The number that makes the capture measurable.
      mmPerPixel: mPerPx * 1000,
      metresPerPixel: mPerPx,
      centre: { lat: params.lat, lng: params.lng },
      zoom: params.zoom,
      creditsCharged: access.cost,
    });
  })
);

/** Whether map import is usable, so the UI can explain itself before trying. */
uploadsRouter.get(
  '/map/capabilities',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { checkFeature } = await import('../services/access.js');
    const access = await checkFeature(req.user!, 'map_import');
    res.json({
      configured: mapsConfigured,
      allowed: access.allowed && mapsConfigured,
      reason: !mapsConfigured ? 'Map import is not configured on this server.' : access.message,
      cost: access.cost,
      balance: access.balance,
    });
  })
);
