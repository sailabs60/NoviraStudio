/**
 * Proposals and quoting.
 *
 * The point of building this into the design tool rather than leaving it to a
 * spreadsheet is that the quote can be generated *from the layout*. A planner
 * designs the room, and the line items follow from what is actually in it —
 * which means the quote cannot silently disagree with the design, and a change
 * to one is visible in the other.
 *
 * All arithmetic lives in `@novira/shared/quoting` so the figures the client
 * sees in the browser are computed by the same code that renders the PDF and
 * stores the totals. A quote whose subtotal depends on which side calculated it
 * is not a quote.
 */
import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { computeTotals, migrateScene, type QuoteLine } from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';

export const proposalsRouter = Router();

/**
 * Client-facing view.
 *
 * Mounted on its own path, and before the authenticated routers, because a
 * router that calls `.use(requireAuth)` while mounted at `/api` guards every
 * request that reaches it — including ones meant to be public. Ordering is
 * what keeps this reachable.
 */
export const proposalPublicRouter = Router();

async function assertProject(userId: bigint, companyId: bigint | null, projectId: bigint) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw ApiError.notFound('That project no longer exists.');
  const mine = project.ownerId === userId;
  const shared = companyId !== null && project.companyId === companyId;
  if (!mine && !shared) throw ApiError.forbidden('That project is not yours.');
  return project;
}

async function loadProposal(userId: bigint, companyId: bigint | null, id: bigint) {
  const proposal = await prisma.proposal.findUnique({
    where: { id },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!proposal) throw ApiError.notFound('That proposal no longer exists.');
  await assertProject(userId, companyId, proposal.projectId);
  return proposal;
}

type LineRow = {
  id: bigint;
  kind: string;
  description: string;
  quantityMilli: number;
  unitLabel: string | null;
  unitPrice: number;
  taxable: boolean;
  sortOrder: number;
  catalogItemId: bigint | null;
  inventoryId: bigint | null;
};

function toQuoteLines(lines: LineRow[]): QuoteLine[] {
  return lines.map((l) => ({
    kind: l.kind as QuoteLine['kind'],
    description: l.description,
    quantityMilli: l.quantityMilli,
    unitPrice: l.unitPrice,
    taxable: l.taxable,
  }));
}

function proposalDto(p: {
  id: bigint;
  projectId: bigint;
  planId: bigint | null;
  number: string;
  title: string;
  status: string;
  clientName: string | null;
  clientEmail: string | null;
  eventDate: Date | null;
  currency: string;
  taxRateBp: number;
  discountBp: number;
  depositBp: number;
  notes: string | null;
  terms: string | null;
  validUntil: Date | null;
  sentAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  shareToken: string | null;
  lines: LineRow[];
}) {
  const lines = p.lines.map((l) => ({
    id: Number(l.id),
    kind: l.kind,
    description: l.description,
    quantityMilli: l.quantityMilli,
    unitLabel: l.unitLabel,
    unitPrice: l.unitPrice,
    taxable: l.taxable,
    sortOrder: l.sortOrder,
    catalogItemId: l.catalogItemId ? Number(l.catalogItemId) : null,
    inventoryId: l.inventoryId ? Number(l.inventoryId) : null,
  }));

  return {
    id: Number(p.id),
    projectId: Number(p.projectId),
    planId: p.planId ? Number(p.planId) : null,
    number: p.number,
    title: p.title,
    status: p.status,
    clientName: p.clientName,
    clientEmail: p.clientEmail,
    eventDate: p.eventDate ? p.eventDate.toISOString().slice(0, 10) : null,
    currency: p.currency,
    taxRateBp: p.taxRateBp,
    discountBp: p.discountBp,
    depositBp: p.depositBp,
    notes: p.notes,
    terms: p.terms,
    validUntil: p.validUntil ? p.validUntil.toISOString().slice(0, 10) : null,
    sentAt: p.sentAt?.toISOString() ?? null,
    acceptedAt: p.acceptedAt?.toISOString() ?? null,
    declinedAt: p.declinedAt?.toISOString() ?? null,
    shareToken: p.shareToken,
    lines,
    totals: computeTotals(toQuoteLines(p.lines), {
      taxRateBp: p.taxRateBp,
      discountBp: p.discountBp,
      depositBp: p.depositBp,
    }),
  };
}

/** Sequential per owner, so two planners do not collide on numbering. */
async function nextNumber(ownerId: bigint): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.proposal.count({ where: { ownerId } });
  return `Q${year}-${String(count + 1).padStart(4, '0')}`;
}

proposalsRouter.use(requireAuth);

proposalsRouter.get(
  '/projects/:projectId/proposals',
  asyncHandler(async (req, res) => {
    const projectId = toId(req.params.projectId);
    if (!projectId) throw ApiError.notFound('Project not found.');
    await assertProject(req.user!.id, req.user!.companyId, projectId);

    const items = await prisma.proposal.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    res.json({ items: items.map(proposalDto) });
  })
);

const proposalBody = z.object({
  title: z.string().trim().min(1).max(180),
  planId: z.number().int().positive().nullable().optional(),
  clientName: z.string().trim().max(180).optional(),
  clientEmail: z.string().trim().email().max(255).optional().or(z.literal('')),
  eventDate: z.string().trim().max(10).optional().or(z.literal('')),
  currency: z.string().trim().length(3).default('usd'),
  taxRateBp: z.number().int().min(0).max(10000).default(0),
  discountBp: z.number().int().min(0).max(10000).default(0),
  depositBp: z.number().int().min(0).max(10000).default(0),
  notes: z.string().trim().max(8000).optional(),
  terms: z.string().trim().max(8000).optional(),
  validUntil: z.string().trim().max(10).optional().or(z.literal('')),
});

proposalsRouter.post(
  '/projects/:projectId/proposals',
  asyncHandler(async (req, res) => {
    const projectId = toId(req.params.projectId);
    if (!projectId) throw ApiError.notFound('Project not found.');
    await assertProject(req.user!.id, req.user!.companyId, projectId);

    const body = proposalBody.parse(req.body);
    const proposal = await prisma.proposal.create({
      data: {
        projectId,
        planId: body.planId ? BigInt(body.planId) : null,
        ownerId: req.user!.id,
        companyId: req.user!.companyId,
        number: await nextNumber(req.user!.id),
        title: body.title,
        clientName: body.clientName || null,
        clientEmail: body.clientEmail || null,
        eventDate: body.eventDate ? new Date(body.eventDate) : null,
        currency: body.currency.toLowerCase(),
        taxRateBp: body.taxRateBp,
        discountBp: body.discountBp,
        depositBp: body.depositBp,
        notes: body.notes || null,
        terms: body.terms || null,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
      },
      include: { lines: true },
    });
    res.status(201).json(proposalDto(proposal));
  })
);

proposalsRouter.get(
  '/proposals/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Proposal not found.');
    res.json(proposalDto(await loadProposal(req.user!.id, req.user!.companyId, id)));
  })
);

proposalsRouter.patch(
  '/proposals/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Proposal not found.');
    await loadProposal(req.user!.id, req.user!.companyId, id);

    const body = proposalBody
      .partial()
      .extend({ status: z.enum(['draft', 'sent', 'accepted', 'declined', 'expired']).optional() })
      .parse(req.body);

    const updated = await prisma.proposal.update({
      where: { id },
      data: {
        ...body,
        planId: body.planId === undefined ? undefined : body.planId ? BigInt(body.planId) : null,
        clientEmail: body.clientEmail === '' ? null : body.clientEmail,
        eventDate: body.eventDate === undefined ? undefined : body.eventDate ? new Date(body.eventDate) : null,
        validUntil:
          body.validUntil === undefined ? undefined : body.validUntil ? new Date(body.validUntil) : null,
        currency: body.currency ? body.currency.toLowerCase() : undefined,
        // Status transitions stamp their own timestamp, so the history is real
        // rather than something the client has to remember to send.
        ...(body.status === 'sent' ? { sentAt: new Date() } : {}),
        ...(body.status === 'accepted' ? { acceptedAt: new Date() } : {}),
        ...(body.status === 'declined' ? { declinedAt: new Date() } : {}),
      },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    res.json(proposalDto(updated));
  })
);

proposalsRouter.delete(
  '/proposals/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Proposal not found.');
    await loadProposal(req.user!.id, req.user!.companyId, id);
    await prisma.proposal.delete({ where: { id } });
    res.json({ deleted: true });
  })
);

/* ── Lines ─────────────────────────────────────────────────────────────── */

const lineBody = z.object({
  kind: z.enum(['item', 'labour', 'fee', 'discount']).default('item'),
  description: z.string().trim().min(1).max(400),
  quantityMilli: z.number().int().min(0).max(100_000_000).default(1000),
  unitLabel: z.string().trim().max(24).optional(),
  // Negative prices are how a discount line works, so they are allowed.
  unitPrice: z.number().int().min(-100_000_000).max(100_000_000).default(0),
  taxable: z.boolean().default(true),
  catalogItemId: z.number().int().positive().nullable().optional(),
  inventoryId: z.number().int().positive().nullable().optional(),
});

proposalsRouter.post(
  '/proposals/:id/lines',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Proposal not found.');
    const proposal = await loadProposal(req.user!.id, req.user!.companyId, id);

    const body = lineBody.parse(req.body);
    const line = await prisma.proposalLine.create({
      data: {
        proposalId: id,
        kind: body.kind,
        description: body.description,
        quantityMilli: body.quantityMilli,
        unitLabel: body.unitLabel || null,
        unitPrice: body.unitPrice,
        taxable: body.taxable,
        sortOrder: proposal.lines.length,
        catalogItemId: body.catalogItemId ? BigInt(body.catalogItemId) : null,
        inventoryId: body.inventoryId ? BigInt(body.inventoryId) : null,
      },
    });
    res.status(201).json({ id: Number(line.id) });
  })
);

proposalsRouter.patch(
  '/proposal-lines/:lineId',
  asyncHandler(async (req, res) => {
    const lineId = toId(req.params.lineId);
    if (!lineId) throw ApiError.notFound('Line not found.');
    const line = await prisma.proposalLine.findUnique({ where: { id: lineId } });
    if (!line) throw ApiError.notFound('That line no longer exists.');
    await loadProposal(req.user!.id, req.user!.companyId, line.proposalId);

    const body = lineBody.partial().extend({ sortOrder: z.number().int().min(0).optional() }).parse(req.body);
    await prisma.proposalLine.update({
      where: { id: lineId },
      data: {
        ...body,
        catalogItemId:
          body.catalogItemId === undefined ? undefined : body.catalogItemId ? BigInt(body.catalogItemId) : null,
        inventoryId:
          body.inventoryId === undefined ? undefined : body.inventoryId ? BigInt(body.inventoryId) : null,
      },
    });
    res.json({ id: Number(lineId) });
  })
);

proposalsRouter.delete(
  '/proposal-lines/:lineId',
  asyncHandler(async (req, res) => {
    const lineId = toId(req.params.lineId);
    if (!lineId) throw ApiError.notFound('Line not found.');
    const line = await prisma.proposalLine.findUnique({ where: { id: lineId } });
    if (!line) throw ApiError.notFound('That line no longer exists.');
    await loadProposal(req.user!.id, req.user!.companyId, line.proposalId);
    await prisma.proposalLine.delete({ where: { id: lineId } });
    res.json({ deleted: true });
  })
);

/**
 * Build the quote from the layout.
 *
 * This is the feature that makes the whole thing worth having: it reads what is
 * actually placed in the plan, prices it against the planner's own inventory,
 * and writes the lines. Items with no stock record are still listed, at zero,
 * so nothing in the design is quietly left out of the price.
 */
proposalsRouter.post(
  '/proposals/:id/generate-from-plan',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Proposal not found.');
    const proposal = await loadProposal(req.user!.id, req.user!.companyId, id);

    const body = z
      .object({
        planId: z.number().int().positive().optional(),
        replace: z.boolean().default(true),
      })
      .parse(req.body ?? {});

    const planId = body.planId ? BigInt(body.planId) : proposal.planId;
    if (!planId) throw ApiError.badRequest('No layout is linked to this proposal.');

    const sceneRow = await prisma.planScene.findUnique({ where: { planId } });
    if (!sceneRow) throw ApiError.badRequest('That layout has nothing in it yet.');

    const scene = migrateScene(sceneRow.scene);
    const counts = new Map<number, number>();
    for (const object of scene.objects) {
      if (object.type !== 'catalog' || object.hidden) continue;
      // The venue shell is the room, not a line on the hire bill.
      if ((object as { venueId?: number | null }).venueId) continue;
      const itemId = (object as { catalogItemId: number }).catalogItemId;
      if (!itemId) continue;
      counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    }

    if (!counts.size) throw ApiError.badRequest('That layout has no catalogue items in it.');

    const catalogItems = await prisma.catalogItem.findMany({
      where: { id: { in: [...counts.keys()].map((n) => BigInt(n)) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(catalogItems.map((c) => [Number(c.id), c.name]));

    const stock = await prisma.inventoryItem.findMany({
      where: {
        isActive: true,
        catalogItemId: { in: [...counts.keys()].map((n) => BigInt(n)) },
        OR: [
          { ownerId: req.user!.id },
          ...(req.user!.companyId ? [{ companyId: req.user!.companyId }] : []),
        ],
      },
    });
    const stockByCatalog = new Map(stock.map((s) => [Number(s.catalogItemId), s]));

    if (body.replace) {
      // Only clear generated lines: hand-written labour and fees must survive.
      await prisma.proposalLine.deleteMany({
        where: { proposalId: id, catalogItemId: { not: null } },
      });
    }

    const existingCount = body.replace
      ? proposal.lines.filter((l) => l.catalogItemId === null).length
      : proposal.lines.length;

    const rows = [...counts.entries()]
      .map(([catalogItemId, quantity]) => {
        const owned = stockByCatalog.get(catalogItemId);
        return {
          catalogItemId,
          quantity,
          name: nameById.get(catalogItemId) ?? `Item ${catalogItemId}`,
          rate: owned?.rentalRate ?? 0,
          inventoryId: owned ? Number(owned.id) : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    await prisma.proposalLine.createMany({
      data: rows.map((r, index) => ({
        proposalId: id,
        kind: 'item',
        description: r.name,
        quantityMilli: r.quantity * 1000,
        unitLabel: 'ea',
        unitPrice: r.rate,
        taxable: true,
        sortOrder: existingCount + index,
        catalogItemId: BigInt(r.catalogItemId),
        inventoryId: r.inventoryId ? BigInt(r.inventoryId) : null,
      })),
    });

    const refreshed = await loadProposal(req.user!.id, req.user!.companyId, id);
    res.json({
      generated: rows.length,
      unpriced: rows.filter((r) => r.rate === 0).length,
      proposal: proposalDto(refreshed),
    });
  })
);

/** A link the client can open without an account. */
proposalsRouter.post(
  '/proposals/:id/share',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Proposal not found.');
    const proposal = await loadProposal(req.user!.id, req.user!.companyId, id);

    const shareToken = proposal.shareToken ?? randomBytes(24).toString('base64url');
    await prisma.proposal.update({ where: { id }, data: { shareToken } });
    res.json({ token: shareToken });
  })
);

proposalsRouter.delete(
  '/proposals/:id/share',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Proposal not found.');
    await loadProposal(req.user!.id, req.user!.companyId, id);
    await prisma.proposal.update({ where: { id }, data: { shareToken: null } });
    res.json({ revoked: true });
  })
);

/* ── Client-facing ─────────────────────────────────────────────────────── */

/**
 * The read-only view a client opens.
 *
 * Deliberately narrow: internal cost, inventory links and the planner's notes
 * to themselves are not in the response at all, rather than merely hidden in
 * the UI.
 */
proposalPublicRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const proposal = await prisma.proposal.findUnique({
      where: { shareToken: req.params.token },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!proposal) throw ApiError.notFound('That proposal link is no longer valid.');

    res.json({
      number: proposal.number,
      title: proposal.title,
      status: proposal.status,
      clientName: proposal.clientName,
      eventDate: proposal.eventDate ? proposal.eventDate.toISOString().slice(0, 10) : null,
      currency: proposal.currency,
      validUntil: proposal.validUntil ? proposal.validUntil.toISOString().slice(0, 10) : null,
      notes: proposal.notes,
      terms: proposal.terms,
      lines: proposal.lines.map((l) => ({
        kind: l.kind,
        description: l.description,
        quantityMilli: l.quantityMilli,
        unitLabel: l.unitLabel,
        unitPrice: l.unitPrice,
        taxable: l.taxable,
      })),
      totals: computeTotals(toQuoteLines(proposal.lines), {
        taxRateBp: proposal.taxRateBp,
        discountBp: proposal.discountBp,
        depositBp: proposal.depositBp,
      }),
      taxRateBp: proposal.taxRateBp,
      discountBp: proposal.discountBp,
      depositBp: proposal.depositBp,
    });
  })
);

/** The client accepting or declining, from that same link. */
proposalPublicRouter.post(
  '/:token/respond',
  asyncHandler(async (req, res) => {
    const body = z.object({ decision: z.enum(['accepted', 'declined']) }).parse(req.body);
    const proposal = await prisma.proposal.findUnique({ where: { shareToken: req.params.token } });
    if (!proposal) throw ApiError.notFound('That proposal link is no longer valid.');

    // A decision is final from the client's side; reopening is the planner's job.
    if (proposal.status === 'accepted' || proposal.status === 'declined') {
      throw ApiError.conflict('ALREADY_ANSWERED', 'This proposal has already been answered.');
    }

    await prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        status: body.decision,
        ...(body.decision === 'accepted' ? { acceptedAt: new Date() } : { declinedAt: new Date() }),
      },
    });
    res.json({ status: body.decision });
  })
);
