/**
 * Execution-ready output.
 *
 * The four things a production team asks for — CAD, a dimensioned drawing, a
 * material breakdown and a bill of quantities — plus the client deck that goes
 * on top of them. All five are generated from the same plan drawing and the
 * same take-off, which is the only way they can be guaranteed to agree.
 *
 * Everything here is generated server-side and returned as a file, because
 * these are documents people email, print and hand to a workshop. A drawing
 * that only exists inside a browser tab is not execution-ready.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  buildPlanDrawing,
  DEFAULT_DECK_THEME,
  drawingToDxf,
  DRAWING_LAYERS,
  generateDeck,
  advise,
  migrateScene,
  regionPack,
  writeDxf,
  type DrawingLayer,
} from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { loadPlanForUser } from './plans.js';
import { estimatePlan } from '../services/estimator.js';

export const exportsRouter = Router();
exportsRouter.use(requireAuth);

/** Strip anything a filesystem or a Content-Disposition header would object to. */
function safeFilename(value: string, extension: string): string {
  const base = value
    .replace(/[^\w\d\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'novira-plan';
  return `${base}.${extension}`;
}

const drawingQuery = z.object({
  layers: z.string().optional(),
  dimensions: z.enum(['none', 'overall', 'detailed']).default('detailed'),
  labels: z.coerce.boolean().default(true),
});

function parseLayers(value: string | undefined): DrawingLayer[] | undefined {
  if (!value) return undefined;
  const requested = value.split(',').map((s) => s.trim());
  const valid = requested.filter((s): s is DrawingLayer => (DRAWING_LAYERS as readonly string[]).includes(s));
  return valid.length ? valid : undefined;
}

async function loadDrawing(userId: bigint, planId: bigint, query: z.infer<typeof drawingQuery>) {
  const plan = await prisma.plan.findUniqueOrThrow({
    where: { id: planId },
    include: { project: { select: { title: true } }, owner: { select: { firstName: true, lastName: true, displayName: true, company: { select: { name: true } } } } },
  });
  const sceneRow = await prisma.planScene.findUnique({ where: { planId } });
  const scene = migrateScene(sceneRow?.scene);

  const drawing = buildPlanDrawing(scene, {
    units: scene.units,
    layers: parseLayers(query.layers),
    overallDimensions: query.dimensions !== 'none',
    detailDimensions: query.dimensions === 'detailed',
    labels: query.labels,
    title: plan.title,
  });

  const preparedBy =
    plan.owner.company?.name ||
    plan.owner.displayName ||
    `${plan.owner.firstName} ${plan.owner.lastName}`.trim();

  return { plan, scene, drawing, preparedBy };
}

/* ── Plan drawing, as data ─────────────────────────────────────────────── */

/**
 * The drawing model itself, for the client to render on a canvas.
 *
 * Returned rather than rasterised because the same model drives an interactive
 * on-screen plan where layers can be toggled — and a picture cannot do that.
 */
exportsRouter.get(
  '/plans/:id/drawing',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    await loadPlanForUser(req.user!, id);
    const query = drawingQuery.parse(req.query);
    const { plan, scene, drawing, preparedBy } = await loadDrawing(req.user!.id, id, query);

    res.json({
      planId: Number(id),
      title: plan.title,
      projectTitle: plan.project.title,
      preparedBy,
      units: scene.units,
      region: regionPack(scene.regionCode),
      ...drawing,
    });
  })
);

/* ── CAD ───────────────────────────────────────────────────────────────── */

exportsRouter.get(
  '/plans/:id/export/dxf',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    await loadPlanForUser(req.user!, id);
    const query = drawingQuery.parse(req.query);
    const { plan, scene, drawing, preparedBy } = await loadDrawing(req.user!.id, id, query);

    const dxf = writeDxf(
      drawingToDxf(drawing, {
        title: plan.title,
        subtitle: plan.project.title,
        info: [
          { label: 'Prepared by', value: preparedBy },
          { label: 'Issued', value: new Date().toISOString().slice(0, 10) },
          { label: 'Units', value: 'Millimetres' },
          { label: 'Region', value: regionPack(scene.regionCode).label },
        ],
      })
    );

    res.setHeader('Content-Type', 'application/dxf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(plan.title, 'dxf')}"`);
    res.send(dxf);
  })
);

/* ── Bill of quantities ────────────────────────────────────────────────── */

/** Escape a value for CSV: quote it, and double any quote inside it. */
function csvCell(value: string | number): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const boqQuery = z.object({
  rateCardId: z.coerce.number().int().positive().optional(),
  /** Include prices. A production BOQ often should not carry them. */
  prices: z.coerce.boolean().default(true),
  format: z.enum(['csv', 'json']).default('csv'),
});

exportsRouter.get(
  '/plans/:id/export/boq',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    const plan = await loadPlanForUser(req.user!, id);
    const query = boqQuery.parse(req.query);

    const estimate = await estimatePlan(req.user!, id, { rateCardId: query.rateCardId ?? null });

    if (query.format === 'json') {
      return res.json({
        planId: Number(id),
        title: plan.title,
        summary: estimate.takeoff.summary,
        notes: estimate.takeoff.notes,
        lines: query.prices ? estimate.priced.lines : estimate.takeoff.lines,
        totals: query.prices ? { subtotal: estimate.priced.subtotal, currency: estimate.priced.currency } : null,
      });
    }

    const header = query.prices
      ? ['Trade', 'Code', 'Description', 'Quantity', 'Unit', 'Unit price', 'Amount', 'Basis']
      : ['Trade', 'Code', 'Description', 'Quantity', 'Unit', 'Basis'];

    const rows = query.prices
      ? estimate.priced.lines.map((l) => [
          l.groupLabel,
          l.code,
          l.description,
          (l.quantityMilli / 1000).toFixed(2),
          l.unit,
          (l.unitPrice / 100).toFixed(2),
          (l.amount / 100).toFixed(2),
          l.basis,
        ])
      : estimate.takeoff.lines.map((l) => [
          l.group,
          l.code,
          l.description,
          (l.quantityMilli / 1000).toFixed(2),
          l.unit,
          l.basis,
        ]);

    const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));

    if (query.prices) {
      lines.push('');
      lines.push(['', '', 'Subtotal', '', '', '', (estimate.priced.subtotal / 100).toFixed(2), estimate.priced.currency.toUpperCase()].map(csvCell).join(','));
    }
    lines.push('');
    lines.push(['', '', `Measured from the drawing on ${new Date().toISOString().slice(0, 10)}`].map(csvCell).join(','));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(`${plan.title}-boq`, 'csv')}"`);
    // A byte-order mark, so Excel opens the file as UTF-8 rather than mangling
    // every accented character and the m² sign.
    return res.send(`﻿${lines.join('\n')}`);
  })
);

/* ── Material breakdown ────────────────────────────────────────────────── */

/**
 * What has to be bought or pulled from stock, grouped by material rather than
 * by trade. It is the same measurement seen from the workshop's side: a joiner
 * does not care that 40 m² of MDF is split across six stands.
 */
exportsRouter.get(
  '/plans/:id/export/materials',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    const plan = await loadPlanForUser(req.user!, id);
    const estimate = await estimatePlan(req.user!, id);

    const materials = new Map<string, { description: string; unit: string; quantity: number; sources: string[] }>();
    for (const line of estimate.takeoff.lines) {
      // Group by the material family the code names, not the individual code.
      const family = line.code.split('-').slice(0, 2).join('-');
      const entry = materials.get(family) ?? { description: line.description, unit: line.unit, quantity: 0, sources: [] };
      entry.quantity += line.quantityMilli / 1000;
      entry.sources.push(line.code);
      materials.set(family, entry);
    }

    res.json({
      planId: Number(id),
      title: plan.title,
      summary: estimate.takeoff.summary,
      materials: [...materials.entries()]
        .map(([family, entry]) => ({
          family,
          description: entry.description,
          unit: entry.unit,
          quantity: Math.round(entry.quantity * 100) / 100,
          sources: [...new Set(entry.sources)],
        }))
        .sort((a, b) => b.quantity - a.quantity),
      weightKg: estimate.takeoff.summary.totalWeightKg,
      volumeCuM: estimate.takeoff.summary.structureVolumeCuM,
      truckLoads: estimate.takeoff.summary.truckLoads,
    });
  })
);

/* ── Presentation deck ─────────────────────────────────────────────────── */

const deckBody = z.object({
  clientName: z.string().trim().max(180).default(''),
  eventDate: z.string().trim().max(40).nullable().optional(),
  venueName: z.string().trim().max(180).default(''),
  rateCardId: z.number().int().positive().optional(),
  includePrices: z.boolean().default(true),
  /** A rendered top view supplied by the client, so the deck can show one. */
  planImageDataUrl: z.string().optional(),
  planImageUrl: z.string().max(512).optional(),
  theme: z
    .object({
      primaryColor: z.string().max(24).optional(),
      backgroundColor: z.string().max(24).optional(),
      textColor: z.string().max(24).optional(),
      logoUrl: z.string().max(512).nullable().optional(),
      brandName: z.string().max(180).optional(),
      footerText: z.string().max(300).optional(),
      showPlatformCredit: z.boolean().optional(),
    })
    .optional(),
});

/**
 * Generate the client deck.
 *
 * Returns the deck as data rather than a PDF: the client renders it, so the
 * user can edit any slide before it is exported, and the same structure drives
 * both the on-screen preview and the PDF. Generating a PDF here would make
 * every wording change a server round trip.
 */
exportsRouter.post(
  '/plans/:id/export/deck',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    const plan = await loadPlanForUser(req.user!, id);
    const body = deckBody.parse(req.body ?? {});

    const [project, owner, renders] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: plan.projectId }, select: { title: true, description: true } }),
      prisma.user.findUniqueOrThrow({
        where: { id: req.user!.id },
        select: { firstName: true, lastName: true, displayName: true, company: { select: { name: true, logoUrl: true, whiteLabel: true, whiteLabelEnabled: true } } },
      }),
      prisma.aiRender.findMany({ where: { planId: id }, orderBy: { createdAt: 'desc' }, take: 6, select: { mediaUrl: true } }),
    ]);

    const estimate = await estimatePlan(req.user!, id, { rateCardId: body.rateCardId ?? null });
    const advisor = advise(estimate.scene);

    /*
     * White label, where it is configured. A deck is the most client-facing
     * document the product produces, so this is the surface where an agency's
     * own brand matters most.
     */
    const white = (owner.company?.whiteLabel ?? null) as Record<string, unknown> | null;
    const whiteLabelOn = Boolean(owner.company?.whiteLabelEnabled && white);

    const theme = {
      ...DEFAULT_DECK_THEME,
      ...(whiteLabelOn
        ? {
            primaryColor: String(white?.primaryColor ?? DEFAULT_DECK_THEME.primaryColor),
            logoUrl: (white?.logoUrl as string | null) ?? owner.company?.logoUrl ?? null,
            brandName: String(white?.brandName ?? owner.company?.name ?? ''),
            footerText: String(white?.footerText ?? ''),
            showPlatformCredit: !white?.hidePlatformCredit,
          }
        : { logoUrl: owner.company?.logoUrl ?? null, brandName: owner.company?.name ?? '' }),
      ...(body.theme ?? {}),
    };

    const deck = generateDeck({
      planTitle: plan.title,
      projectTitle: project.title,
      clientName: body.clientName,
      eventDate: body.eventDate ?? null,
      venueName: body.venueName,
      preparedBy: owner.company?.name || owner.displayName || `${owner.firstName} ${owner.lastName}`.trim(),
      scene: estimate.scene,
      takeoff: estimate.takeoff,
      priced: body.includePrices ? estimate.priced : null,
      advice: advisor,
      renderUrls: renders.map((r) => r.mediaUrl),
      planImageUrl: body.planImageUrl ?? body.planImageDataUrl ?? null,
      theme,
    });

    res.json(deck);
  })
);
