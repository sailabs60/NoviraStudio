/**
 * Vendors and inventory.
 *
 * Two related things a planner keeps: who they buy from, and what they own.
 *
 * The connection that makes this more than a contacts list is
 * `catalogItemId` on an inventory row: it ties a piece of stock to the 3D model
 * that represents it, so a layout can be costed automatically. Place forty gold
 * Chiavari chairs in the plan and the system knows you own twenty-four and must
 * hire sixteen, and what both cost.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { migrateScene } from '@novira/shared';

export const vendorsRouter = Router();
vendorsRouter.use(requireAuth);

/** Rows the caller owns, or that their company shares. */
function ownerScope(userId: bigint, companyId: bigint | null) {
  return {
    OR: [{ ownerId: userId }, ...(companyId ? [{ companyId }] : [])],
  };
}

/* ── Vendors ───────────────────────────────────────────────────────────── */

const vendorBody = z.object({
  name: z.string().trim().min(1).max(180),
  category: z.string().trim().min(1).max(60),
  contactName: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional(),
  website: z.string().trim().max(255).optional(),
  addressLine: z.string().trim().max(255).optional(),
  city: z.string().trim().max(120).optional(),
  country: z.string().trim().length(2).optional().or(z.literal('')),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
  notes: z.string().trim().max(4000).optional(),
  shareWithCompany: z.boolean().optional(),
});

vendorsRouter.get(
  '/vendors',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        category: z.string().trim().max(60).optional(),
        q: z.string().trim().max(120).optional(),
      })
      .parse(req.query);

    const items = await prisma.vendor.findMany({
      where: {
        ...ownerScope(req.user!.id, req.user!.companyId),
        isActive: true,
        ...(query.category ? { category: query.category } : {}),
        ...(query.q ? { name: { contains: query.q } } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { items: true } } },
    });

    res.json({
      items: items.map((v) => ({
        id: Number(v.id),
        name: v.name,
        category: v.category,
        contactName: v.contactName,
        email: v.email,
        phone: v.phone,
        website: v.website,
        addressLine: v.addressLine,
        city: v.city,
        country: v.country,
        rating: v.rating,
        leadTimeDays: v.leadTimeDays,
        notes: v.notes,
        itemCount: v._count.items,
        isOwner: v.ownerId === req.user!.id,
      })),
      categories: [...new Set(items.map((v) => v.category))].sort(),
    });
  })
);

vendorsRouter.post(
  '/vendors',
  asyncHandler(async (req, res) => {
    const body = vendorBody.parse(req.body);
    const vendor = await prisma.vendor.create({
      data: {
        ownerId: req.user!.id,
        companyId: body.shareWithCompany ? req.user!.companyId : null,
        name: body.name,
        category: body.category,
        contactName: body.contactName || null,
        email: body.email || null,
        phone: body.phone || null,
        website: body.website || null,
        addressLine: body.addressLine || null,
        city: body.city || null,
        country: body.country ? body.country.toUpperCase() : null,
        rating: body.rating ?? null,
        leadTimeDays: body.leadTimeDays ?? null,
        notes: body.notes || null,
      },
    });
    res.status(201).json({ id: Number(vendor.id) });
  })
);

vendorsRouter.patch(
  '/vendors/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Vendor not found.');
    const existing = await prisma.vendor.findFirst({
      where: { id, ...ownerScope(req.user!.id, req.user!.companyId) },
    });
    if (!existing) throw ApiError.notFound('That vendor no longer exists.');

    // `shareWithCompany` is a UI flag, not a column; it decides companyId.
    const { shareWithCompany, ...body } = vendorBody.partial().parse(req.body);
    const vendor = await prisma.vendor.update({
      where: { id },
      data: {
        ...body,
        email: body.email === '' ? null : body.email,
        country: body.country ? body.country.toUpperCase() : undefined,
        ...(shareWithCompany !== undefined
          ? { companyId: shareWithCompany ? req.user!.companyId : null }
          : {}),
      },
    });
    res.json({ id: Number(vendor.id) });
  })
);

vendorsRouter.delete(
  '/vendors/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Vendor not found.');
    const existing = await prisma.vendor.findFirst({
      where: { id, ...ownerScope(req.user!.id, req.user!.companyId) },
    });
    if (!existing) throw ApiError.notFound('That vendor no longer exists.');
    // Soft delete: stock rows point at vendors, and history should survive.
    await prisma.vendor.update({ where: { id }, data: { isActive: false } });
    res.json({ deleted: true });
  })
);

/* ── Inventory ─────────────────────────────────────────────────────────── */

const inventoryBody = z.object({
  name: z.string().trim().min(1).max(180),
  sku: z.string().trim().max(80).optional(),
  vendorId: z.number().int().positive().nullable().optional(),
  catalogItemId: z.number().int().positive().nullable().optional(),
  ownership: z.enum(['owned', 'hired']).default('owned'),
  quantityOwned: z.number().int().min(0).max(100000).default(0),
  unitCost: z.number().int().min(0).default(0),
  rentalRate: z.number().int().min(0).default(0),
  currency: z.string().trim().length(3).default('usd'),
  storageNote: z.string().trim().max(180).optional(),
  shareWithCompany: z.boolean().optional(),
});

vendorsRouter.get(
  '/inventory',
  asyncHandler(async (req, res) => {
    const items = await prisma.inventoryItem.findMany({
      where: { ...ownerScope(req.user!.id, req.user!.companyId), isActive: true },
      orderBy: { name: 'asc' },
      include: { vendor: { select: { id: true, name: true } } },
    });

    /*
     * Show what is already committed elsewhere. Owning twenty chairs means
     * nothing if eighteen are out on another job that weekend, and that is
     * precisely the mistake this view exists to catch.
     */
    const allocations = await prisma.inventoryAllocation.groupBy({
      by: ['inventoryItemId'],
      _sum: { quantity: true },
      where: { inventoryItemId: { in: items.map((i) => i.id) } },
    });
    const committed = new Map(
      allocations.map((a) => [String(a.inventoryItemId), a._sum.quantity ?? 0])
    );

    res.json({
      items: items.map((i) => ({
        id: Number(i.id),
        name: i.name,
        sku: i.sku,
        ownership: i.ownership,
        quantityOwned: i.quantityOwned,
        quantityCommitted: committed.get(String(i.id)) ?? 0,
        unitCost: i.unitCost,
        rentalRate: i.rentalRate,
        currency: i.currency,
        storageNote: i.storageNote,
        vendor: i.vendor ? { id: Number(i.vendor.id), name: i.vendor.name } : null,
        catalogItemId: i.catalogItemId ? Number(i.catalogItemId) : null,
        isOwner: i.ownerId === req.user!.id,
      })),
    });
  })
);

vendorsRouter.post(
  '/inventory',
  asyncHandler(async (req, res) => {
    const body = inventoryBody.parse(req.body);
    const item = await prisma.inventoryItem.create({
      data: {
        ownerId: req.user!.id,
        companyId: body.shareWithCompany ? req.user!.companyId : null,
        vendorId: body.vendorId ? BigInt(body.vendorId) : null,
        catalogItemId: body.catalogItemId ? BigInt(body.catalogItemId) : null,
        name: body.name,
        sku: body.sku || null,
        ownership: body.ownership,
        quantityOwned: body.quantityOwned,
        unitCost: body.unitCost,
        rentalRate: body.rentalRate,
        currency: body.currency.toLowerCase(),
        storageNote: body.storageNote || null,
      },
    });
    res.status(201).json({ id: Number(item.id) });
  })
);

vendorsRouter.patch(
  '/inventory/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Item not found.');
    const existing = await prisma.inventoryItem.findFirst({
      where: { id, ...ownerScope(req.user!.id, req.user!.companyId) },
    });
    if (!existing) throw ApiError.notFound('That item no longer exists.');

    const { shareWithCompany, ...body } = inventoryBody.partial().parse(req.body);
    await prisma.inventoryItem.update({
      where: { id },
      data: {
        ...body,
        vendorId: body.vendorId === undefined ? undefined : body.vendorId ? BigInt(body.vendorId) : null,
        catalogItemId:
          body.catalogItemId === undefined
            ? undefined
            : body.catalogItemId
              ? BigInt(body.catalogItemId)
              : null,
        currency: body.currency ? body.currency.toLowerCase() : undefined,
        ...(shareWithCompany !== undefined
          ? { companyId: shareWithCompany ? req.user!.companyId : null }
          : {}),
      },
    });
    res.json({ id: Number(id) });
  })
);

vendorsRouter.delete(
  '/inventory/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Item not found.');
    const existing = await prisma.inventoryItem.findFirst({
      where: { id, ...ownerScope(req.user!.id, req.user!.companyId) },
    });
    if (!existing) throw ApiError.notFound('That item no longer exists.');
    await prisma.inventoryItem.update({ where: { id }, data: { isActive: false } });
    res.json({ deleted: true });
  })
);

/**
 * What a layout needs, against what is owned.
 *
 * Counts catalogue items placed in the plan, matches them to stock, and reports
 * the shortfall. This is the bridge between the 3D design and the operational
 * side: it is the answer to "can we actually put this room in, and what does it
 * cost".
 */
vendorsRouter.get(
  '/plans/:planId/requirements',
  asyncHandler(async (req, res) => {
    const planId = toId(req.params.planId);
    if (!planId) throw ApiError.notFound('Plan not found.');

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw ApiError.notFound('That plan no longer exists.');
    const project = await prisma.project.findUnique({ where: { id: plan.projectId } });
    const mine = project?.ownerId === req.user!.id;
    const shared = req.user!.companyId !== null && project?.companyId === req.user!.companyId;
    if (!mine && !shared) throw ApiError.forbidden('That plan is not yours.');

    const sceneRow = await prisma.planScene.findUnique({ where: { planId } });
    if (!sceneRow) return res.json({ lines: [], totalHireCost: 0, currency: 'usd' });

    const scene = migrateScene(sceneRow.scene);

    // Count placements per catalogue item.
    const needed = new Map<number, number>();
    for (const object of scene.objects) {
      if (object.type !== 'catalog' || object.hidden) continue;
      // A generated venue is the building, not something to hire.
      if ((object as { venueId?: number | null }).venueId) continue;
      const itemId = (object as { catalogItemId: number }).catalogItemId;
      if (!itemId) continue;
      needed.set(itemId, (needed.get(itemId) ?? 0) + 1);
    }
    if (!needed.size) return res.json({ lines: [], totalHireCost: 0, currency: 'usd' });

    const catalogItems = await prisma.catalogItem.findMany({
      where: { id: { in: [...needed.keys()].map((n) => BigInt(n)) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(catalogItems.map((c) => [Number(c.id), c.name]));

    const stock = await prisma.inventoryItem.findMany({
      where: {
        ...ownerScope(req.user!.id, req.user!.companyId),
        isActive: true,
        catalogItemId: { in: [...needed.keys()].map((n) => BigInt(n)) },
      },
      include: { vendor: { select: { id: true, name: true } } },
    });
    const stockByCatalog = new Map(stock.map((s) => [Number(s.catalogItemId), s]));

    let totalHireCost = 0;
    let currency = 'usd';

    const lines = [...needed.entries()].map(([catalogItemId, quantity]) => {
      const owned = stockByCatalog.get(catalogItemId);
      const have = owned?.quantityOwned ?? 0;
      const shortfall = Math.max(0, quantity - have);
      const rate = owned?.rentalRate ?? 0;
      const cost = shortfall * rate;
      totalHireCost += cost;
      if (owned?.currency) currency = owned.currency;

      return {
        catalogItemId,
        name: nameById.get(catalogItemId) ?? `Item ${catalogItemId}`,
        required: quantity,
        owned: have,
        shortfall,
        inventoryId: owned ? Number(owned.id) : null,
        rentalRate: rate,
        hireCost: cost,
        vendor: owned?.vendor ? { id: Number(owned.vendor.id), name: owned.vendor.name } : null,
        tracked: Boolean(owned),
      };
    });

    lines.sort((a, b) => b.shortfall - a.shortfall || a.name.localeCompare(b.name));

    res.json({ lines, totalHireCost, currency });
  })
);

/** Commit stock to a plan, so the same chairs cannot be promised twice. */
vendorsRouter.put(
  '/plans/:planId/allocations',
  asyncHandler(async (req, res) => {
    const planId = toId(req.params.planId);
    if (!planId) throw ApiError.notFound('Plan not found.');
    const body = z
      .object({
        items: z.array(
          z.object({
            inventoryItemId: z.number().int().positive(),
            quantity: z.number().int().min(0).max(100000),
          })
        ),
      })
      .parse(req.body);

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw ApiError.notFound('That plan no longer exists.');

    await prisma.$transaction([
      prisma.inventoryAllocation.deleteMany({ where: { planId } }),
      prisma.inventoryAllocation.createMany({
        data: body.items
          .filter((i) => i.quantity > 0)
          .map((i) => ({
            planId,
            inventoryItemId: BigInt(i.inventoryItemId),
            quantity: i.quantity,
          })),
      }),
    ]);

    res.json({ allocated: body.items.filter((i) => i.quantity > 0).length });
  })
);
