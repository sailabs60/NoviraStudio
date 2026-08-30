/**
 * Venues.
 *
 * A venue is a generated building shell that can be reused across plans — the
 * room itself, as opposed to what is arranged inside it. Generation runs
 * through the same job pipeline as the AI features, so it is preflighted,
 * charged, pollable, cancellable, and refunded when it fails.
 *
 * Preview is free and instant, because it is pure arithmetic; only the GLB
 * build costs a credit.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  VENUE_STYLES,
  defaultVenueParams,
  deriveVenue,
  type VenueStyle,
} from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { assertFeature } from '../services/access.js';
import { getJob, jobDto, registerHandler, startJob } from '../services/jobs.js';
import { buildVenue } from '../services/venueGenerator.js';

export const venuesRouter = Router();
venuesRouter.use(requireAuth);

// Derived from the style table rather than repeated, so adding a style cannot
// leave the validator behind.
const styleEnum = z.enum(Object.keys(VENUE_STYLES) as [VenueStyle, ...VenueStyle[]]);

/**
 * Bounds are real constraints, not arbitrary caps: below 3 m nothing usable
 * fits, and above 120 m the shell stops being a single room.
 */
const paramsSchema = z.object({
  style: styleEnum,
  widthMm: z.number().int().min(3000).max(120000),
  depthMm: z.number().int().min(3000).max(120000),
  heightMm: z.number().int().min(2000).max(20000),
  entrances: z.number().int().min(0).max(6),
  windowsPerSide: z.number().int().min(0).max(12),
  stageAlcove: z.boolean(),
  columns: z.boolean(),
});

/* ── Job handler ───────────────────────────────────────────────────────── */

registerHandler('venue_generation', async (ctx) => {
  const params = paramsSchema.parse(ctx.input.params);
  const name = String(ctx.input.name ?? '').trim() || `${VENUE_STYLES[params.style].label} venue`;
  await ctx.report(10);

  if (await ctx.isCancelled()) throw ApiError.badRequest('Cancelled before the build started.');

  const relativePath = `venues/${ctx.jobId}.glb`;
  const { derived, assetUrl, triangles } = await buildVenue(params, relativePath);
  await ctx.report(80);

  const venue = await prisma.venue.create({
    data: {
      ownerId: ctx.userId,
      scope: 'personal',
      name: name.slice(0, 180),
      assetUrl,
      sourceRunId: ctx.jobId,
    },
  });
  await ctx.report(100);

  return {
    venueId: Number(venue.id),
    name: venue.name,
    assetUrl,
    triangles,
    areaSqM: derived.areaSqM,
    capacity: derived.capacity,
    warnings: derived.warnings,
    walls: derived.walls,
    openings: derived.openings,
    features: derived.features,
    roof: derived.roof,
  };
});

/* ── Routes ────────────────────────────────────────────────────────────── */

/** The style catalogue, with each style's sensible starting parameters. */
venuesRouter.get(
  '/styles',
  asyncHandler(async (_req, res) => {
    res.json({
      items: Object.values(VENUE_STYLES).map((profile) => ({
        style: profile.style,
        label: profile.label,
        description: profile.description,
        roof: profile.roof,
        walled: profile.walled,
        defaults: defaultVenueParams(profile.style),
      })),
    });
  })
);

/**
 * Free preview.
 *
 * Returns everything except the mesh: capacity figures, warnings, wall lines
 * and openings. The editor draws this live while the sliders move, so it must
 * not cost anything or touch a queue.
 */
venuesRouter.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const params = paramsSchema.parse(req.body);
    const derived = deriveVenue(params);
    res.json({
      areaSqM: derived.areaSqM,
      perimeterMm: derived.perimeterMm,
      capacity: derived.capacity,
      warnings: derived.warnings,
      roof: derived.roof,
      openingCount: derived.openings.length,
      featureCount: derived.features.length,
      walls: derived.walls,
      openings: derived.openings,
      features: derived.features,
    });
  })
);

/** What generation would cost, and whether this account may run it. */
venuesRouter.get(
  '/capability',
  asyncHandler(async (req, res) => {
    try {
      const access = await assertFeature(req.user!, 'venue_generation');
      res.json({ allowed: true, cost: access.cost });
    } catch (err) {
      const reason = err instanceof ApiError ? err.message : 'Not available on this account.';
      res.json({ allowed: false, cost: 0, reason });
    }
  })
);

/** Start a generation. Credits are charged by the job pipeline, not here. */
venuesRouter.post(
  '/generate',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        params: paramsSchema,
        name: z.string().trim().max(180).optional(),
        planId: z.number().int().positive().optional(),
        idempotencyKey: z.string().trim().max(80).optional(),
      })
      .parse(req.body);

    const job = await startJob({
      user: req.user!,
      feature: 'venue_generation',
      input: { params: body.params, name: body.name },
      planId: body.planId ? BigInt(body.planId) : null,
      idempotencyKey: body.idempotencyKey,
      provider: 'Novira (local)',
      providerModel: `venue-${body.params.style}`,
    });

    res.status(202).json(jobDto(job));
  })
);

venuesRouter.get(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const job = await getJob(req.user!, req.params.id!);
    res.json(jobDto(job));
  })
);

/** The user's saved venues, newest first. */
venuesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const items = await prisma.venue.findMany({
      where: {
        OR: [
          { ownerId: user.id },
          ...(user.companyId ? [{ companyId: user.companyId, scope: 'company' }] : []),
          { scope: 'global' },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({
      items: items.map((v) => ({
        id: Number(v.id),
        name: v.name,
        scope: v.scope,
        assetUrl: v.assetUrl,
        previewUrl: v.previewUrl,
        createdAt: v.createdAt.toISOString(),
        isOwner: v.ownerId === user.id,
      })),
    });
  })
);

venuesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('That venue no longer exists.');
    const venue = await prisma.venue.findUnique({ where: { id } });
    if (!venue) throw ApiError.notFound('That venue no longer exists.');
    if (venue.ownerId !== req.user!.id && req.user!.role !== 'super_admin') {
      throw ApiError.forbidden('You can only delete venues you generated.');
    }
    await prisma.venue.delete({ where: { id } });
    res.json({ deleted: true });
  })
);
