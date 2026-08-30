import { Router } from 'express';
import { z } from 'zod';
import type { CatalogItemDto } from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { catalogItemAccess } from '../services/access.js';
import type { Prisma } from '@prisma/client';

export const catalogRouter = Router();

type ItemRow = Prisma.CatalogItemGetPayload<{
  include: { category: true; variations: true };
}>;

async function toDto(row: ItemRow, user: Express.Request['user']): Promise<CatalogItemDto> {
  const access = await catalogItemAccess(user, {
    scope: row.scope,
    isFreePlanAvailable: row.isFreePlanAvailable,
    companyId: row.companyId,
    ownerId: row.ownerId,
  });
  return {
    id: Number(row.id),
    categoryId: Number(row.categoryId),
    categorySlug: row.category.slug,
    scope: row.scope as CatalogItemDto['scope'],
    name: row.name,
    description: row.description,
    modelUrl: row.modelUrl,
    previewImage: row.previewImage,
    widthMm: row.widthMm,
    depthMm: row.depthMm,
    heightMm: row.heightMm,
    diameterMm: row.diameterMm,
    tableShape: row.tableShape as CatalogItemDto['tableShape'],
    seatsDefault: row.seatsDefault,
    isFreePlanAvailable: row.isFreePlanAvailable,
    isAccessible: access.accessible,
    lockReason: access.accessible ? null : (access.reason as 'plan' | 'company' | null),
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
    reviewStatus: row.reviewStatus as CatalogItemDto['reviewStatus'],
  };
}

/** Only approved items, and only those in scope for the viewer. */
function visibilityWhere(user: Express.Request['user']): Prisma.CatalogItemWhereInput {
  const scopes: Prisma.CatalogItemWhereInput[] = [{ scope: 'global' }];
  if (user?.companyId) scopes.push({ scope: 'company', companyId: user.companyId });
  if (user) scopes.push({ scope: 'personal', ownerId: user.id });
  return {
    isActive: true,
    reviewStatus: 'approved',
    OR: scopes,
  };
}

catalogRouter.get(
  '/categories',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const categories = await prisma.catalogCategory.findMany({ orderBy: { sortOrder: 'asc' } });
    const counts = await prisma.catalogItem.groupBy({
      by: ['categoryId'],
      where: visibilityWhere(req.user),
      _count: { _all: true },
    });
    const countBy = new Map(counts.map((c) => [String(c.categoryId), c._count._all]));
    res.json({
      items: categories.map((c) => ({
        id: Number(c.id),
        slug: c.slug,
        name: c.name,
        sortOrder: c.sortOrder,
        itemCount: countBy.get(String(c.id)) ?? 0,
      })),
    });
  })
);

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  categorySlug: z.string().trim().max(140).optional(),
  tableShape: z.enum(['round', 'rectangular', 'other']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  offset: z.coerce.number().int().min(0).default(0),
});

catalogRouter.get(
  '/items',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const query = listQuery.parse(req.query);

    const where: Prisma.CatalogItemWhereInput = { ...visibilityWhere(req.user) };
    if (query.categoryId) where.categoryId = BigInt(query.categoryId);
    if (query.categorySlug) where.category = { slug: query.categorySlug };
    if (query.tableShape) where.tableShape = query.tableShape;
    if (query.q) {
      where.AND = [
        {
          OR: [
            { name: { contains: query.q } },
            { description: { contains: query.q } },
          ],
        },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.catalogItem.findMany({
        where,
        include: { category: true, variations: true },
        // Free-plan items first so a free account sees something usable, then
        // alphabetically for a stable, scannable list.
        orderBy: [{ isFreePlanAvailable: 'desc' }, { name: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      prisma.catalogItem.count({ where }),
    ]);

    const items = await Promise.all(rows.map((r) => toDto(r, req.user)));
    res.json({ items, total, limit: query.limit, offset: query.offset, hasMore: query.offset + rows.length < total });
  })
);

catalogRouter.get(
  '/items/by-ids',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const raw = String(req.query.ids ?? '');
    const ids = raw
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 500)
      .map((n) => BigInt(n));
    if (!ids.length) return res.json({ items: [] });

    const rows = await prisma.catalogItem.findMany({
      where: { id: { in: ids } },
      include: { category: true, variations: true },
    });
    const items = await Promise.all(rows.map((r) => toDto(r, req.user)));
    res.json({ items });
  })
);

catalogRouter.get(
  '/items/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Item not found.');
    const row = await prisma.catalogItem.findUnique({
      where: { id },
      include: { category: true, variations: true },
    });
    if (!row) throw ApiError.notFound('Item not found.');
    res.json(await toDto(row, req.user));
  })
);

/** Verification detail — how we decided this item is what it says it is. */
catalogRouter.get(
  '/items/:id/provenance',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Item not found.');
    const row = await prisma.catalogItem.findUnique({
      where: { id },
      select: {
        name: true,
        sourceKey: true,
        sourceLabel: true,
        sourceUrl: true,
        license: true,
        attribution: true,
        triangleCount: true,
        verifiedAt: true,
        verificationScore: true,
        verificationNotes: true,
        widthMm: true,
        depthMm: true,
        heightMm: true,
      },
    });
    if (!row) throw ApiError.notFound('Item not found.');
    res.json(row);
  })
);
