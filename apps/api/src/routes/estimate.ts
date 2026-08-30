/**
 * Estimating: quantities, prices and rate cards.
 *
 * Two things share this router because they are two halves of one answer.
 * `/plans/:id/takeoff` says what is in the design; `/plans/:id/estimate` says
 * what it costs. Keeping them separate endpoints matters: a production manager
 * wants the first and should not have to see money to get it, and the take-off
 * has to be verifiable independently of whatever rate card is applied.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  advise,
  defaultRateCard,
  DEFAULT_RATE_LINES,
  evaluateConstraints,
  findCollisions,
  footprintsFor,
  isFlownObject,
  lightingLoad,
  migrateScene,
  regionPack,
  REGION_PACKS,
  toQuoteLines,
  TYPICAL_WEIGHTS_KG,
  type ConstraintSceneObject,
  type LightFixtureSceneObject,
  type ObjectFootprint,
  type RateLine,
} from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { loadPlanForUser } from './plans.js';
import { estimatePlan, rateCardDto, rateCardScope } from '../services/estimator.js';

export const estimateRouter = Router();
estimateRouter.use(requireAuth);

/* ── Take-off ──────────────────────────────────────────────────────────── */

estimateRouter.get(
  '/plans/:id/takeoff',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    await loadPlanForUser(req.user!, id);

    const estimate = await estimatePlan(req.user!, id);
    res.json({
      planId: estimate.planId,
      lines: estimate.takeoff.lines,
      summary: estimate.takeoff.summary,
      notes: estimate.takeoff.notes,
      regionCode: estimate.regionCode,
    });
  })
);

const estimateQuery = z.object({ rateCardId: z.coerce.number().int().positive().optional() });

estimateRouter.get(
  '/plans/:id/estimate',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    await loadPlanForUser(req.user!, id);
    const query = estimateQuery.parse(req.query);

    const estimate = await estimatePlan(req.user!, id, { rateCardId: query.rateCardId ?? null });
    res.json({
      planId: estimate.planId,
      summary: estimate.takeoff.summary,
      notes: estimate.takeoff.notes,
      priced: estimate.priced,
      card: {
        id: estimate.card.id,
        name: estimate.card.name,
        currency: estimate.card.currency,
        regionCode: estimate.card.regionCode,
        adjustmentBp: estimate.card.adjustmentBp,
      },
      region: regionPack(estimate.regionCode),
    });
  })
);

/**
 * The full site report: advice, constraint findings and collisions.
 *
 * One endpoint rather than three, because all three read the same scene and a
 * planner asks the same question of all of them — "is this buildable?". Three
 * round trips to answer it would show three loading states for one question.
 */
estimateRouter.get(
  '/plans/:id/review',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    await loadPlanForUser(req.user!, id);

    const sceneRow = await prisma.planScene.findUnique({ where: { planId: id } });
    const scene = migrateScene(sceneRow?.scene);

    const advisor = advise(scene);
    const footprints: ObjectFootprint[] = footprintsFor(scene).map((f) => {
      const object = scene.objects.find((o) => o.id === f.id);
      return object ? { ...f, flown: isFlownObject(object), weightKg: f.weightKg || (TYPICAL_WEIGHTS_KG[object.type] ?? 10) } : f;
    });

    const constraints = scene.objects
      .filter((o): o is ConstraintSceneObject => o.type === 'constraint')
      .map((o) => ({
        ...o,
        id: o.id,
        // Constraint points are stored in object-local space; the checker works
        // in plan space, so they are offset by the object's own position here.
        points: (o.points ?? []).map((p) => ({ xMm: p.xMm + o.positionMm.x, zMm: p.zMm + o.positionMm.z })),
      }));

    const fixtures = scene.objects.filter(
      (o): o is LightFixtureSceneObject => o.type === 'light' && !(o as LightFixtureSceneObject).muted
    );
    const load = lightingLoad(fixtures.map((f) => ({ fixture: f.fixture })));
    const flownLoadKg = footprints.filter((f) => f.flown).reduce((sum, f) => sum + f.weightKg, 0);

    const constraintReport = evaluateConstraints(constraints, footprints, {
      amps: load.amps230,
      riggedLoadKg: flownLoadKg,
    });

    const collisions = scene.collisionCheck ? findCollisions(footprints) : [];

    res.json({
      planId: Number(id),
      advisor,
      constraints: constraintReport,
      collisions,
      regionCode: scene.regionCode,
    });
  })
);

/**
 * Turn the estimate into proposal lines.
 *
 * Returns them rather than writing them: the proposal router owns proposals,
 * and a planner nearly always wants to review generated lines before they land
 * on a client-facing document.
 */
estimateRouter.get(
  '/plans/:id/estimate/quote-lines',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    await loadPlanForUser(req.user!, id);
    const query = estimateQuery.parse(req.query);
    const estimate = await estimatePlan(req.user!, id, { rateCardId: query.rateCardId ?? null });
    res.json({ currency: estimate.priced.currency, lines: toQuoteLines(estimate.priced) });
  })
);

/* ── Rate cards ────────────────────────────────────────────────────────── */

const rateLineSchema = z.object({
  code: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(200),
  unit: z.enum(['sqm', 'm', 'each', 'cum', 'kg', 'hour', 'kw']),
  unitPrice: z.number().int().min(0).max(100_000_000),
  unitCost: z.number().int().min(0).max(100_000_000).nullable().optional(),
  taxable: z.boolean().default(true),
  group: z.enum(['structure', 'surfaces', 'print', 'screens', 'lighting', 'furniture', 'power', 'labour', 'logistics']),
  minimumCharge: z.number().int().min(0).max(100_000_000).nullable().optional(),
  wastageBp: z.number().int().min(0).max(5000).optional(),
});

const rateCardBody = z.object({
  name: z.string().trim().min(1).max(180),
  currency: z.string().trim().length(3).default('usd'),
  regionCode: z.string().trim().max(24).default('global'),
  adjustmentBp: z.number().int().min(-5000).max(20_000).default(0),
  crewRate: z.number().int().min(0).max(10_000_000).default(4500),
  lines: z.array(rateLineSchema).max(400),
  labourOverrides: z.record(z.number().min(0).max(100)).optional(),
  isDefault: z.boolean().optional(),
  shareWithCompany: z.boolean().optional(),
});

estimateRouter.get(
  '/rate-cards',
  asyncHandler(async (req, res) => {
    const rows = await prisma.rateCard.findMany({
      where: rateCardScope(req.user!),
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
    res.json({
      items: rows.map(rateCardDto),
      // The built-in card, so the editor can offer "start from the defaults"
      // without a second request.
      builtIn: defaultRateCard(),
      defaultLines: DEFAULT_RATE_LINES,
      regions: REGION_PACKS.map((r) => ({ code: r.code, label: r.label, currency: r.currency, costIndexBp: r.costIndexBp })),
    });
  })
);

estimateRouter.post(
  '/rate-cards',
  asyncHandler(async (req, res) => {
    const body = rateCardBody.parse(req.body);
    const user = req.user!;

    if (body.shareWithCompany && !user.companyId) {
      throw ApiError.badRequest('You are not part of a company workspace.');
    }

    // Only one default per scope, or "the default" stops meaning anything.
    if (body.isDefault) await clearDefaults(user, body.shareWithCompany ?? false);

    const row = await prisma.rateCard.create({
      data: {
        ownerId: body.shareWithCompany ? null : user.id,
        companyId: body.shareWithCompany ? user.companyId : null,
        name: body.name,
        currency: body.currency.toLowerCase(),
        regionCode: body.regionCode,
        adjustmentBp: body.adjustmentBp,
        crewRate: body.crewRate,
        lines: body.lines as unknown as object,
        labourOverrides: (body.labourOverrides ?? null) as unknown as object,
        isDefault: body.isDefault ?? false,
      },
    });
    res.status(201).json(rateCardDto(row));
  })
);

estimateRouter.patch(
  '/rate-cards/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Rate card not found.');
    const user = req.user!;
    const existing = await prisma.rateCard.findFirst({ where: { id, ...rateCardScope(user) } });
    if (!existing) throw ApiError.notFound('Rate card not found.');

    const body = rateCardBody.partial().parse(req.body);
    if (body.isDefault) await clearDefaults(user, existing.companyId !== null);

    const row = await prisma.rateCard.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.currency ? { currency: body.currency.toLowerCase() } : {}),
        ...(body.regionCode ? { regionCode: body.regionCode } : {}),
        ...(body.adjustmentBp !== undefined ? { adjustmentBp: body.adjustmentBp } : {}),
        ...(body.crewRate !== undefined ? { crewRate: body.crewRate } : {}),
        ...(body.lines ? { lines: body.lines as unknown as object } : {}),
        ...(body.labourOverrides !== undefined
          ? { labourOverrides: (body.labourOverrides ?? null) as unknown as object }
          : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
      },
    });
    res.json(rateCardDto(row));
  })
);

estimateRouter.delete(
  '/rate-cards/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Rate card not found.');
    const existing = await prisma.rateCard.findFirst({ where: { id, ...rateCardScope(req.user!) } });
    if (!existing) throw ApiError.notFound('Rate card not found.');
    await prisma.rateCard.delete({ where: { id } });
    res.json({ ok: true });
  })
);

/** Duplicate a card, which is how a regional variant is usually made. */
estimateRouter.post(
  '/rate-cards/:id/duplicate',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Rate card not found.');
    const source = await prisma.rateCard.findFirst({ where: { id, ...rateCardScope(req.user!) } });
    if (!source) throw ApiError.notFound('Rate card not found.');

    const body = z
      .object({ name: z.string().trim().min(1).max(180).optional(), regionCode: z.string().trim().max(24).optional() })
      .parse(req.body ?? {});

    const row = await prisma.rateCard.create({
      data: {
        ownerId: req.user!.id,
        companyId: null,
        name: body.name ?? `${source.name} (copy)`,
        currency: source.currency,
        regionCode: body.regionCode ?? source.regionCode,
        adjustmentBp: source.adjustmentBp,
        crewRate: source.crewRate,
        lines: source.lines as object,
        labourOverrides: source.labourOverrides as object,
        isDefault: false,
      },
    });
    res.status(201).json(rateCardDto(row));
  })
);

/**
 * Seed a card from the built-in rates.
 *
 * The most common first action, and doing it in one call rather than making the
 * client post 30 lines keeps the defaults in one place — `shared/rates.ts` — so
 * they cannot drift between what the estimator falls back to and what a new
 * card starts from.
 */
estimateRouter.post(
  '/rate-cards/from-defaults',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(180).optional(),
        regionCode: z.string().trim().max(24).default('global'),
        shareWithCompany: z.boolean().optional(),
      })
      .parse(req.body ?? {});

    const user = req.user!;
    if (body.shareWithCompany && !user.companyId) {
      throw ApiError.badRequest('You are not part of a company workspace.');
    }

    const pack = regionPack(body.regionCode);
    const card = defaultRateCard(pack.currency, pack.code);
    const hasAny = await prisma.rateCard.count({ where: rateCardScope(user) });

    const row = await prisma.rateCard.create({
      data: {
        ownerId: body.shareWithCompany ? null : user.id,
        companyId: body.shareWithCompany ? user.companyId : null,
        name: body.name ?? `${pack.label} rates`,
        currency: pack.currency,
        regionCode: pack.code,
        adjustmentBp: pack.costIndexBp - 10_000,
        crewRate: card.crewRate,
        lines: card.lines as unknown as object,
        // The first card an account creates becomes its default; making someone
        // set that by hand is a step with only one sensible answer.
        isDefault: hasAny === 0,
      },
    });
    res.status(201).json(rateCardDto(row));
  })
);

async function clearDefaults(user: { id: bigint; companyId: bigint | null }, companyScope: boolean) {
  if (companyScope && user.companyId) {
    await prisma.rateCard.updateMany({ where: { companyId: user.companyId }, data: { isDefault: false } });
  } else {
    await prisma.rateCard.updateMany({ where: { ownerId: user.id }, data: { isDefault: false } });
  }
}

/* ── Regions ───────────────────────────────────────────────────────────── */

estimateRouter.get(
  '/regions',
  asyncHandler(async (_req, res) => {
    res.json({ items: REGION_PACKS });
  })
);

export type { RateLine };
