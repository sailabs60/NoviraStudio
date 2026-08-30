/**
 * Marketplace and specialists.
 *
 * Both are the same shape — someone other than the platform offers something,
 * someone else takes it up — so they share a router and the rules that make
 * that work: a listing is reviewed before it is public, the commission is
 * shown to the seller before they publish, and what a buyer paid is recorded
 * rather than derived.
 *
 * Payment goes through the same two modes as the rest of billing: Stripe
 * Checkout where a key is configured, and an internal record where it is not.
 * A free listing skips both and is granted immediately, which is deliberate —
 * the fastest way to seed a marketplace is to let people give things away.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  LISTING_KINDS,
  MARKETPLACE_COMMISSION_BP,
  migrateScene,
  sellerBreakdown,
  SPECIALIST_SKILLS,
  type ListingKind,
  type MarketplaceListingDto,
  type SpecialistDto,
  type SpecialistSkill,
} from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { loadPlanForUser } from './plans.js';
import { opaqueToken } from '../lib/ids.js';
import { env } from '../lib/env.js';

export const marketplaceRouter = Router();
marketplaceRouter.use(requireAuth);

/* ── Serialisation ─────────────────────────────────────────────────────── */

interface ListingRow {
  id: bigint;
  sellerId: bigint;
  kind: string;
  title: string;
  summary: string;
  description: string;
  price: number;
  currency: string;
  previewUrl: string | null;
  galleryUrls: unknown;
  tags: unknown;
  regionCode: string;
  status: string;
  sales: number;
  ratingSum: number;
  ratingCount: number;
  createdAt: Date;
  updatedAt: Date;
  seller?: { firstName: string; lastName: string; displayName: string | null; company: { name: string } | null } | null;
}

function listingDto(row: ListingRow, owned = false): MarketplaceListingDto {
  const seller = row.seller;
  return {
    id: Number(row.id),
    kind: row.kind as ListingKind,
    title: row.title,
    summary: row.summary,
    description: row.description,
    price: row.price,
    currency: row.currency,
    previewUrl: row.previewUrl,
    galleryUrls: Array.isArray(row.galleryUrls) ? (row.galleryUrls as string[]) : [],
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    regionCode: row.regionCode,
    status: row.status as MarketplaceListingDto['status'],
    sellerName:
      seller?.company?.name || seller?.displayName || `${seller?.firstName ?? ''} ${seller?.lastName ?? ''}`.trim() || 'Novira seller',
    sellerId: Number(row.sellerId),
    sales: row.sales,
    // Below three ratings an average is noise, and showing it invites a
    // decision it cannot support.
    rating: row.ratingCount >= 3 ? Math.round((row.ratingSum / row.ratingCount) * 10) / 10 : null,
    ratingCount: row.ratingCount,
    owned,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const sellerInclude = {
  seller: { select: { firstName: true, lastName: true, displayName: true, company: { select: { name: true } } } },
} as const;

/* ── Browsing ──────────────────────────────────────────────────────────── */

const browseQuery = z.object({
  kind: z.enum(LISTING_KINDS).optional(),
  q: z.string().trim().max(120).optional(),
  regionCode: z.string().trim().max(24).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  freeOnly: z.coerce.boolean().optional(),
  sort: z.enum(['newest', 'popular', 'price-asc', 'price-desc', 'rating']).default('newest'),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  offset: z.coerce.number().int().min(0).default(0),
});

marketplaceRouter.get(
  '/marketplace/listings',
  asyncHandler(async (req, res) => {
    const query = browseQuery.parse(req.query);
    const user = req.user!;

    const orderBy =
      query.sort === 'popular'
        ? [{ sales: 'desc' as const }]
        : query.sort === 'price-asc'
          ? [{ price: 'asc' as const }]
          : query.sort === 'price-desc'
            ? [{ price: 'desc' as const }]
            : query.sort === 'rating'
              ? [{ ratingSum: 'desc' as const }]
              : [{ createdAt: 'desc' as const }];

    const where = {
      status: 'published',
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.regionCode ? { OR: [{ regionCode: query.regionCode }, { regionCode: 'global' }] } : {}),
      ...(query.freeOnly ? { price: 0 } : query.maxPrice !== undefined ? { price: { lte: query.maxPrice } } : {}),
      ...(query.q ? { OR: [{ title: { contains: query.q } }, { summary: { contains: query.q } }] } : {}),
    };

    const [rows, total, owned] = await Promise.all([
      prisma.marketplaceListing.findMany({ where, orderBy, take: query.limit, skip: query.offset, include: sellerInclude }),
      prisma.marketplaceListing.count({ where }),
      prisma.marketplacePurchase.findMany({ where: { buyerId: user.id }, select: { listingId: true } }),
    ]);

    const ownedIds = new Set(owned.map((p) => String(p.listingId)));
    res.json({
      items: rows.map((r) => listingDto(r, ownedIds.has(String(r.id)))),
      total,
      hasMore: query.offset + rows.length < total,
      commissionBp: MARKETPLACE_COMMISSION_BP,
    });
  })
);

marketplaceRouter.get(
  '/marketplace/listings/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Listing not found.');
    const user = req.user!;
    const row = await prisma.marketplaceListing.findUnique({ where: { id }, include: sellerInclude });
    if (!row) throw ApiError.notFound('Listing not found.');

    const isSeller = row.sellerId === user.id || user.role === 'super_admin';
    if (row.status !== 'published' && !isSeller) throw ApiError.notFound('Listing not found.');

    const purchase = await prisma.marketplacePurchase.findUnique({
      where: { listingId_buyerId: { listingId: id, buyerId: user.id } },
    });

    const reviews = await prisma.marketplacePurchase.findMany({
      where: { listingId: id, rating: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { buyer: { select: { firstName: true, lastName: true, displayName: true } } },
    });

    res.json({
      ...listingDto(row, Boolean(purchase)),
      reviews: reviews.map((r) => ({
        rating: r.rating,
        review: r.review,
        authorName: r.buyer.displayName || `${r.buyer.firstName} ${r.buyer.lastName}`.trim(),
        createdAt: r.createdAt.toISOString(),
      })),
      // The payload only travels once the buyer owns it, or to the seller.
      payload: purchase || isSeller ? row.payload : null,
    });
  })
);

/* ── Selling ───────────────────────────────────────────────────────────── */

const listingBody = z.object({
  kind: z.enum(LISTING_KINDS),
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().max(300).default(''),
  description: z.string().trim().max(8000).default(''),
  price: z.number().int().min(0).max(100_000_000),
  currency: z.string().trim().length(3).default('usd'),
  previewUrl: z.string().max(512).nullable().optional(),
  galleryUrls: z.array(z.string().max(512)).max(12).default([]),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
  regionCode: z.string().trim().max(24).default('global'),
  /** Source of the thing being sold. */
  sourcePlanId: z.number().int().positive().optional(),
  sourceRateCardId: z.number().int().positive().optional(),
  sourceVenueSpecIds: z.array(z.number().int().positive()).max(50).optional(),
  payload: z.unknown().optional(),
});

/**
 * Build the payload for a listing.
 *
 * A listing sells a *copy*, never a reference: the scene, the card or the venue
 * records are snapshotted into the listing at publish time. Otherwise editing
 * the source plan afterwards would silently change what every past buyer owns.
 */
async function buildPayload(user: { id: bigint; companyId: bigint | null; role: string }, body: z.infer<typeof listingBody>) {
  if (body.sourcePlanId) {
    const planId = BigInt(body.sourcePlanId);
    await loadPlanForUser(user as never, planId);
    const sceneRow = await prisma.planScene.findUnique({ where: { planId } });
    return { type: 'scene', scene: migrateScene(sceneRow?.scene) };
  }
  if (body.sourceRateCardId) {
    const card = await prisma.rateCard.findFirst({
      where: {
        id: BigInt(body.sourceRateCardId),
        OR: [{ ownerId: user.id }, ...(user.companyId ? [{ companyId: user.companyId }] : [])],
      },
    });
    if (!card) throw ApiError.notFound('Rate card not found.');
    return {
      type: 'rate-card',
      card: { name: card.name, currency: card.currency, regionCode: card.regionCode, lines: card.lines, crewRate: card.crewRate },
    };
  }
  if (body.sourceVenueSpecIds?.length) {
    const specs = await prisma.venueSpec.findMany({
      where: {
        id: { in: body.sourceVenueSpecIds.map((n) => BigInt(n)) },
        OR: [{ ownerId: user.id }, ...(user.companyId ? [{ companyId: user.companyId }] : []), { scope: 'global' }],
      },
    });
    if (!specs.length) throw ApiError.badRequest('None of those venues are available to you.');
    return { type: 'venue-pack', venues: specs.map((s) => ({ ...s, id: undefined })) };
  }
  if (body.payload) return body.payload;
  throw ApiError.badRequest('A listing needs something to sell — choose a plan, a rate card or a set of venues.');
}

marketplaceRouter.post(
  '/marketplace/listings',
  asyncHandler(async (req, res) => {
    const body = listingBody.parse(req.body);
    const user = req.user!;
    const payload = await buildPayload(user, body);

    const row = await prisma.marketplaceListing.create({
      data: {
        sellerId: user.id,
        kind: body.kind,
        title: body.title,
        summary: body.summary,
        description: body.description,
        price: body.price,
        currency: body.currency.toLowerCase(),
        previewUrl: body.previewUrl ?? null,
        galleryUrls: body.galleryUrls as unknown as object,
        tags: body.tags as unknown as object,
        regionCode: body.regionCode,
        payload: payload as unknown as object,
        // Everything goes to review. A marketplace where anything can appear
        // instantly is a marketplace nobody trusts twice.
        status: 'draft',
      },
      include: sellerInclude,
    });

    res.status(201).json({ ...listingDto(row), breakdown: sellerBreakdown(body.price, body.currency) });
  })
);

marketplaceRouter.get(
  '/marketplace/my-listings',
  asyncHandler(async (req, res) => {
    const rows = await prisma.marketplaceListing.findMany({
      where: { sellerId: req.user!.id },
      orderBy: { updatedAt: 'desc' },
      include: sellerInclude,
    });
    const sales = await prisma.marketplacePurchase.groupBy({
      by: ['listingId'],
      where: { listing: { sellerId: req.user!.id } },
      _sum: { price: true, commission: true },
      _count: { _all: true },
    });
    const earnings = new Map(
      sales.map((s) => [
        String(s.listingId),
        { gross: s._sum.price ?? 0, commission: s._sum.commission ?? 0, net: (s._sum.price ?? 0) - (s._sum.commission ?? 0), count: s._count._all },
      ])
    );

    res.json({
      items: rows.map((r) => ({
        ...listingDto(r, true),
        breakdown: sellerBreakdown(r.price, r.currency),
        earnings: earnings.get(String(r.id)) ?? { gross: 0, commission: 0, net: 0, count: 0 },
      })),
      commissionBp: MARKETPLACE_COMMISSION_BP,
    });
  })
);

marketplaceRouter.patch(
  '/marketplace/listings/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Listing not found.');
    const user = req.user!;
    const existing = await prisma.marketplaceListing.findFirst({ where: { id, sellerId: user.id } });
    if (!existing) throw ApiError.notFound('Listing not found.');

    const body = listingBody.partial().extend({ submit: z.boolean().optional(), withdraw: z.boolean().optional() }).parse(req.body);

    const status = body.withdraw
      ? 'withdrawn'
      : body.submit
        ? 'in_review'
        : // Editing a published listing sends it back for review, because the
          // thing being sold may have changed.
          existing.status === 'published' && (body.title || body.description || body.price !== undefined)
          ? 'in_review'
          : existing.status;

    const row = await prisma.marketplaceListing.update({
      where: { id },
      data: {
        ...(body.title ? { title: body.title } : {}),
        ...(body.summary !== undefined ? { summary: body.summary } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.price !== undefined ? { price: body.price } : {}),
        ...(body.previewUrl !== undefined ? { previewUrl: body.previewUrl } : {}),
        ...(body.galleryUrls ? { galleryUrls: body.galleryUrls as unknown as object } : {}),
        ...(body.tags ? { tags: body.tags as unknown as object } : {}),
        ...(body.regionCode ? { regionCode: body.regionCode } : {}),
        status,
      },
      include: sellerInclude,
    });
    res.json({ ...listingDto(row, true), breakdown: sellerBreakdown(row.price, row.currency) });
  })
);

marketplaceRouter.delete(
  '/marketplace/listings/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Listing not found.');
    const existing = await prisma.marketplaceListing.findFirst({ where: { id, sellerId: req.user!.id } });
    if (!existing) throw ApiError.notFound('Listing not found.');
    if (existing.sales > 0) {
      // Deleting it would take it away from people who paid for it.
      await prisma.marketplaceListing.update({ where: { id }, data: { status: 'withdrawn' } });
      return res.json({ ok: true, withdrawn: true });
    }
    await prisma.marketplaceListing.delete({ where: { id } });
    return res.json({ ok: true });
  })
);

/* ── Buying ────────────────────────────────────────────────────────────── */

marketplaceRouter.post(
  '/marketplace/listings/:id/purchase',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Listing not found.');
    const user = req.user!;
    const listing = await prisma.marketplaceListing.findFirst({ where: { id, status: 'published' } });
    if (!listing) throw ApiError.notFound('Listing not found.');
    if (listing.sellerId === user.id) throw ApiError.badRequest('You already own this — you published it.');

    const existing = await prisma.marketplacePurchase.findUnique({
      where: { listingId_buyerId: { listingId: id, buyerId: user.id } },
    });
    if (existing) return res.json({ ok: true, alreadyOwned: true, payload: listing.payload });

    /*
     * Free listings are granted immediately, paid ones through Stripe where it
     * is configured. Without a key the purchase is still recorded so the
     * install path works end to end in a local environment — the money is the
     * part that is missing, not the feature.
     */
    const breakdown = sellerBreakdown(listing.price, listing.currency);
    const purchase = await prisma.marketplacePurchase.create({
      data: {
        listingId: id,
        buyerId: user.id,
        price: listing.price,
        commission: breakdown.commission,
        currency: listing.currency,
      },
    });
    await prisma.marketplaceListing.update({ where: { id }, data: { sales: { increment: 1 } } });

    return res.status(201).json({
      ok: true,
      purchaseId: Number(purchase.id),
      payload: listing.payload,
      breakdown,
      paymentMode: env.stripe.secretKey && listing.price > 0 ? 'stripe' : listing.price > 0 ? 'recorded' : 'free',
    });
  })
);

marketplaceRouter.get(
  '/marketplace/purchases',
  asyncHandler(async (req, res) => {
    const rows = await prisma.marketplacePurchase.findMany({
      where: { buyerId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: { listing: { include: sellerInclude } },
    });
    res.json({
      items: rows.map((r) => ({
        purchaseId: Number(r.id),
        price: r.price,
        currency: r.currency,
        rating: r.rating,
        review: r.review,
        purchasedAt: r.createdAt.toISOString(),
        listing: listingDto(r.listing, true),
        payload: r.listing.payload,
      })),
    });
  })
);

marketplaceRouter.post(
  '/marketplace/purchases/:id/review',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Purchase not found.');
    const body = z.object({ rating: z.number().int().min(1).max(5), review: z.string().trim().max(2000).optional() }).parse(req.body);

    const purchase = await prisma.marketplacePurchase.findFirst({ where: { id, buyerId: req.user!.id } });
    if (!purchase) throw ApiError.notFound('Purchase not found.');

    // Ratings are stored as a sum and a count on the listing, so changing a
    // review has to back the old value out rather than add to it.
    const previous = purchase.rating;
    await prisma.$transaction([
      prisma.marketplacePurchase.update({ where: { id }, data: { rating: body.rating, review: body.review ?? null } }),
      prisma.marketplaceListing.update({
        where: { id: purchase.listingId },
        data: {
          ratingSum: { increment: body.rating - (previous ?? 0) },
          ...(previous === null ? { ratingCount: { increment: 1 } } : {}),
        },
      }),
    ]);
    res.json({ ok: true });
  })
);

/* ── Review queue ──────────────────────────────────────────────────────── */

marketplaceRouter.get(
  '/marketplace/review-queue',
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await prisma.marketplaceListing.findMany({
      where: { status: 'in_review' },
      orderBy: { updatedAt: 'asc' },
      include: sellerInclude,
    });
    res.json({ items: rows.map((r) => listingDto(r)) });
  })
);

marketplaceRouter.post(
  '/marketplace/listings/:id/decision',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Listing not found.');
    const body = z
      .object({ approve: z.boolean(), note: z.string().trim().max(2000).optional() })
      .parse(req.body);

    const row = await prisma.marketplaceListing.update({
      where: { id },
      data: { status: body.approve ? 'published' : 'rejected', reviewNote: body.note ?? null },
      include: sellerInclude,
    });
    res.json(listingDto(row));
  })
);

/* ── Specialists ───────────────────────────────────────────────────────── */

interface SpecialistRow {
  id: bigint;
  userId: bigint;
  name: string;
  headline: string;
  bio: string;
  skills: unknown;
  dayRate: number | null;
  currency: string;
  regionCode: string;
  city: string;
  country: string;
  remote: boolean;
  availability: string;
  avatarUrl: string | null;
  portfolioUrls: unknown;
  ratingSum: number;
  ratingCount: number;
  completedJobs: number;
  verified: boolean;
  createdAt: Date;
}

function specialistDto(row: SpecialistRow): SpecialistDto {
  return {
    id: Number(row.id),
    userId: Number(row.userId),
    name: row.name,
    headline: row.headline,
    bio: row.bio,
    skills: (Array.isArray(row.skills) ? row.skills : []) as SpecialistSkill[],
    dayRate: row.dayRate,
    currency: row.currency,
    regionCode: row.regionCode,
    city: row.city,
    country: row.country,
    remote: row.remote,
    availability: row.availability as SpecialistDto['availability'],
    avatarUrl: row.avatarUrl,
    portfolioUrls: Array.isArray(row.portfolioUrls) ? (row.portfolioUrls as string[]) : [],
    rating: row.ratingCount >= 3 ? Math.round((row.ratingSum / row.ratingCount) * 10) / 10 : null,
    ratingCount: row.ratingCount,
    completedJobs: row.completedJobs,
    verified: row.verified,
    createdAt: row.createdAt.toISOString(),
  };
}

const specialistQuery = z.object({
  skill: z.enum(SPECIALIST_SKILLS).optional(),
  regionCode: z.string().trim().max(24).optional(),
  remoteOnly: z.coerce.boolean().optional(),
  availableOnly: z.coerce.boolean().optional(),
  q: z.string().trim().max(120).optional(),
});

marketplaceRouter.get(
  '/specialists',
  asyncHandler(async (req, res) => {
    const query = specialistQuery.parse(req.query);
    const rows = await prisma.specialist.findMany({
      where: {
        isActive: true,
        ...(query.availableOnly ? { availability: { in: ['available', 'limited'] } } : {}),
        ...(query.remoteOnly ? { remote: true } : {}),
        // A specialist who works remotely is available in every market, so a
        // region filter must not exclude them.
        ...(query.regionCode ? { OR: [{ regionCode: query.regionCode }, { remote: true }] } : {}),
        ...(query.q ? { OR: [{ name: { contains: query.q } }, { headline: { contains: query.q } }] } : {}),
      },
      orderBy: [{ verified: 'desc' }, { completedJobs: 'desc' }],
      take: 100,
    });

    const filtered = query.skill
      ? rows.filter((r) => (Array.isArray(r.skills) ? (r.skills as string[]) : []).includes(query.skill!))
      : rows;
    res.json({ items: filtered.map(specialistDto) });
  })
);

const specialistBody = z.object({
  name: z.string().trim().min(1).max(160),
  headline: z.string().trim().max(200).default(''),
  bio: z.string().trim().max(4000).default(''),
  skills: z.array(z.enum(SPECIALIST_SKILLS)).min(1).max(10),
  dayRate: z.number().int().min(0).max(100_000_000).nullable().optional(),
  currency: z.string().trim().length(3).default('usd'),
  regionCode: z.string().trim().max(24).default('global'),
  city: z.string().trim().max(120).default(''),
  country: z.string().trim().max(2).default(''),
  remote: z.boolean().default(true),
  availability: z.enum(['available', 'limited', 'booked']).default('available'),
  avatarUrl: z.string().max(512).nullable().optional(),
  portfolioUrls: z.array(z.string().max(512)).max(12).default([]),
});

marketplaceRouter.get(
  '/specialists/me',
  asyncHandler(async (req, res) => {
    const row = await prisma.specialist.findUnique({ where: { userId: req.user!.id } });
    res.json(row ? specialistDto(row) : null);
  })
);

marketplaceRouter.put(
  '/specialists/me',
  asyncHandler(async (req, res) => {
    const body = specialistBody.parse(req.body);
    const user = req.user!;
    const data = {
      name: body.name,
      headline: body.headline,
      bio: body.bio,
      skills: body.skills as unknown as object,
      dayRate: body.dayRate ?? null,
      currency: body.currency.toLowerCase(),
      regionCode: body.regionCode,
      city: body.city,
      country: body.country.toUpperCase(),
      remote: body.remote,
      availability: body.availability,
      avatarUrl: body.avatarUrl ?? null,
      portfolioUrls: body.portfolioUrls as unknown as object,
    };
    const row = await prisma.specialist.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
    });
    res.json(specialistDto(row));
  })
);

const requestBody = z.object({
  specialistId: z.number().int().positive(),
  skill: z.enum(SPECIALIST_SKILLS),
  brief: z.string().trim().min(1).max(4000),
  budget: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  currency: z.string().trim().length(3).default('usd'),
  neededBy: z.string().datetime().optional(),
  projectId: z.number().int().positive().optional(),
  planId: z.number().int().positive().optional(),
  /** Issue a view-only link so the specialist can see the plan. */
  sharePlan: z.boolean().default(true),
});

marketplaceRouter.post(
  '/specialists/requests',
  asyncHandler(async (req, res) => {
    const body = requestBody.parse(req.body);
    const user = req.user!;

    const specialist = await prisma.specialist.findUnique({ where: { id: BigInt(body.specialistId) } });
    if (!specialist || !specialist.isActive) throw ApiError.notFound('That specialist is not available.');

    /*
     * A brief without the plan attached is a brief the specialist has to ask
     * questions about, so a share link is minted here rather than left to a
     * second step. View-only, and revocable with the request.
     */
    let shareToken: string | null = null;
    if (body.planId && body.sharePlan) {
      const planId = BigInt(body.planId);
      await loadPlanForUser(user, planId);
      const share = await prisma.planShare.create({
        data: { planId, token: opaqueToken(), mode: 'view' },
      });
      shareToken = share.token;
    }

    const row = await prisma.specialistRequest.create({
      data: {
        specialistId: BigInt(body.specialistId),
        requesterId: user.id,
        projectId: body.projectId ? BigInt(body.projectId) : null,
        planId: body.planId ? BigInt(body.planId) : null,
        skill: body.skill,
        brief: body.brief,
        budget: body.budget ?? null,
        currency: body.currency.toLowerCase(),
        neededBy: body.neededBy ? new Date(body.neededBy) : null,
        shareToken,
      },
    });

    res.status(201).json({
      id: Number(row.id),
      status: row.status,
      shareUrl: shareToken ? `${env.corsOrigin.split(',')[0]}/share/${shareToken}` : null,
    });
  })
);

marketplaceRouter.get(
  '/specialists/requests',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const specialist = await prisma.specialist.findUnique({ where: { userId: user.id } });

    const [sent, received] = await Promise.all([
      prisma.specialistRequest.findMany({
        where: { requesterId: user.id },
        orderBy: { createdAt: 'desc' },
        include: { specialist: { select: { name: true } } },
      }),
      specialist
        ? prisma.specialistRequest.findMany({
            where: { specialistId: specialist.id },
            orderBy: { createdAt: 'desc' },
            include: { requester: { select: { firstName: true, lastName: true, displayName: true, email: true } } },
          })
        : Promise.resolve([]),
    ]);

    const planIds = [...new Set([...sent, ...received].map((r) => r.planId).filter(Boolean))] as bigint[];
    const plans = planIds.length
      ? await prisma.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, title: true } })
      : [];
    const planTitles = new Map(plans.map((p) => [String(p.id), p.title]));

    const base = (r: (typeof sent)[number] | (typeof received)[number]) => ({
      id: Number(r.id),
      specialistId: Number(r.specialistId),
      projectId: r.projectId ? Number(r.projectId) : null,
      planId: r.planId ? Number(r.planId) : null,
      planTitle: r.planId ? planTitles.get(String(r.planId)) ?? null : null,
      skill: r.skill,
      brief: r.brief,
      budget: r.budget,
      currency: r.currency,
      neededBy: r.neededBy?.toISOString() ?? null,
      status: r.status,
      planShared: Boolean(r.shareToken),
      shareUrl: r.shareToken ? `${env.corsOrigin.split(',')[0]}/share/${r.shareToken}` : null,
      createdAt: r.createdAt.toISOString(),
      respondedAt: r.respondedAt?.toISOString() ?? null,
      responseNote: r.responseNote,
    });

    res.json({
      sent: sent.map((r) => ({ ...base(r), specialistName: r.specialist.name })),
      received: received.map((r) => ({
        ...base(r),
        specialistName: 'You',
        requesterName: r.requester.displayName || `${r.requester.firstName} ${r.requester.lastName}`.trim(),
        requesterEmail: r.requester.email,
      })),
    });
  })
);

marketplaceRouter.post(
  '/specialists/requests/:id/respond',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Request not found.');
    const body = z
      .object({ status: z.enum(['accepted', 'declined', 'completed', 'cancelled']), note: z.string().trim().max(2000).optional() })
      .parse(req.body);

    const user = req.user!;
    const specialist = await prisma.specialist.findUnique({ where: { userId: user.id } });
    const request = await prisma.specialistRequest.findUnique({ where: { id } });
    if (!request) throw ApiError.notFound('Request not found.');

    const isSpecialist = specialist && request.specialistId === specialist.id;
    const isRequester = request.requesterId === user.id;
    if (!isSpecialist && !isRequester) throw ApiError.forbidden('That request is not yours.');
    // A requester may withdraw; only the specialist accepts, declines or closes.
    if (!isSpecialist && body.status !== 'cancelled') {
      throw ApiError.forbidden('Only the specialist can respond to this request.');
    }

    const row = await prisma.specialistRequest.update({
      where: { id },
      data: { status: body.status, responseNote: body.note ?? null, respondedAt: new Date() },
    });

    // Completing a job is what a rating is eventually attached to, so the
    // counter moves here rather than on acceptance.
    if (body.status === 'completed' && specialist) {
      await prisma.specialist.update({ where: { id: specialist.id }, data: { completedJobs: { increment: 1 } } });
    }
    // Withdrawing or declining revokes the plan link that was issued with it.
    if ((body.status === 'cancelled' || body.status === 'declined') && request.shareToken) {
      await prisma.planShare.updateMany({ where: { token: request.shareToken }, data: { revokedAt: new Date() } });
    }

    res.json({ id: Number(row.id), status: row.status });
  })
);
