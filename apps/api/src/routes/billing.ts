import { Router } from 'express';
import { z } from 'zod';
import { DEFAULT_PLAN_CREDITS, type PlanTier } from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { allCreditRatios, availableCredits, grantMonthly, history, purchase } from '../services/credits.js';
import { stripeConfigured } from '../lib/env.js';
import {
  createPackCheckout,
  createPortalSession,
  createSubscriptionCheckout,
} from '../services/stripe.js';

/**
 * Plans, credits and billing.
 *
 * Stripe is the intended processor, but the whole surface works without it:
 * where no key is configured, upgrades go through an approval queue instead of
 * a checkout session. That is not a stub — an invoiced enterprise deal follows
 * exactly the same path, so the manual route is a real mode rather than a
 * placeholder.
 */
export const billingRouter = Router();

/** Public pricing — the client needs it before sign-in to render the plans. */
billingRouter.get(
  '/pricing',
  asyncHandler(async (_req, res) => {
    const [tiers, packs, ratios] = await Promise.all([
      prisma.planPrice.findMany({ where: { isActive: true } }),
      prisma.creditPack.findMany({ where: { isActive: true }, orderBy: { displayOrder: 'asc' } }),
      allCreditRatios(),
    ]);

    res.json({
      // Ordering is deliberate: free, plus, pro — not database order.
      tiers: ['free', 'plus', 'pro']
        .map((tier) => tiers.find((t) => t.tier === tier))
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .map((t) => ({
          tier: t.tier as PlanTier,
          marketingName: t.marketingName,
          tagline: t.tagline,
          unitAmount: t.unitAmount,
          currency: t.currency,
          monthlyCredits: t.monthlyCredits,
          features: t.features as string[],
          highlight: t.highlight,
        })),
      packs: packs.map((p) => ({
        id: Number(p.id),
        creditAmount: p.creditAmount,
        unitAmount: p.unitAmount,
        currency: p.currency,
        expiryDays: p.expiryDays,
      })),
      ratios,
      // The client uses this to choose between checkout and a plan request.
      checkoutAvailable: stripeConfigured,
    });
  })
);

billingRouter.use(requireAuth);

billingRouter.get(
  '/subscription',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const [row, subscription, pending, expiring] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { planTier: true, monthlyCreditQuota: true, creditsRemaining: true },
      }),
      prisma.subscription.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } }),
      prisma.subscriptionRequest.findFirst({
        where: { userId: user.id, status: 'pending' },
        orderBy: { requestedAt: 'desc' },
      }),
      prisma.creditLedger.findFirst({
        where: { userId: user.id, reason: 'purchase', expiresAt: { gt: new Date() } },
        orderBy: { expiresAt: 'asc' },
      }),
    ]);

    const { balance, source } = await availableCredits(user.id);

    res.json({
      planTier: row.planTier as PlanTier,
      billingSource: (subscription?.billingSource ?? 'manual') as 'stripe' | 'manual' | 'company',
      cycleEndsAt: subscription?.cycleEndsAt?.toISOString() ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      monthlyCreditQuota: row.monthlyCreditQuota,
      creditsRemaining: balance,
      creditSource: source,
      purchasedExpiringAt: expiring?.expiresAt?.toISOString() ?? null,
      pendingRequest: pending
        ? { requestedPlan: pending.requestedPlan as PlanTier, requestedAt: pending.requestedAt.toISOString() }
        : null,
      checkoutAvailable: stripeConfigured,
    });
  })
);

billingRouter.get(
  '/credits/history',
  asyncHandler(async (req, res) => {
    const limit = Math.min(200, Number(req.query.limit ?? 50));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const { items, total } = await history(req.user!.id, limit, offset);
    res.json({
      items: items.map((i) => ({
        id: Number(i.id),
        delta: i.delta,
        reason: i.reason,
        featureCode: i.featureCode,
        balanceAfter: i.balanceAfter,
        expiresAt: i.expiresAt?.toISOString() ?? null,
        note: i.note,
        createdAt: i.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    });
  })
);

/** CSV export — finance asks for this, and a table on screen will not do. */
billingRouter.get(
  '/credits/history/export',
  asyncHandler(async (req, res) => {
    const { items } = await history(req.user!.id, 5000, 0);
    const rows = [
      'date,delta,reason,feature,balance_after,note',
      ...items.map((i) =>
        [
          i.createdAt.toISOString(),
          i.delta,
          i.reason,
          i.featureCode ?? '',
          i.balanceAfter,
          `"${(i.note ?? '').replace(/"/g, '""')}"`,
        ].join(',')
      ),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="credit-history.csv"');
    res.send(rows.join('\n'));
  })
);

/* ── Changing plan ─────────────────────────────────────────────────────── */

const upgradeBody = z.object({ tier: z.enum(['free', 'plus', 'pro']) });

billingRouter.post(
  '/subscription/change',
  asyncHandler(async (req, res) => {
    const { tier } = upgradeBody.parse(req.body);
    const user = req.user!;

    if (user.role === 'super_admin') {
      throw ApiError.badRequest('Administrator accounts already have full access.');
    }

    const price = await prisma.planPrice.findUnique({ where: { tier } });
    if (!price?.isActive) throw ApiError.badRequest('That plan is not available.');

    // Downgrading to free needs no payment path at all.
    if (tier === 'free') {
      await applyTier(user.id, 'free');
      return res.json({ status: 'applied', planTier: 'free' });
    }

    if (stripeConfigured) {
      // The tier is applied by the webhook once payment settles, never here —
      // returning from Checkout is not proof that the charge succeeded.
      const session = await createSubscriptionCheckout(user.id, tier);
      return res.status(200).json({ status: 'checkout', url: session.url, sessionId: session.id });
    }

    const existing = await prisma.subscriptionRequest.findFirst({
      where: { userId: user.id, status: 'pending' },
    });
    if (existing) {
      throw ApiError.conflict('PLAN_REQUEST_PENDING', 'Your plan change request is already pending approval.');
    }

    const request = await prisma.subscriptionRequest.create({
      data: { userId: user.id, requestedPlan: tier, status: 'pending' },
    });

    res.status(202).json({
      status: 'pending_approval',
      requestId: Number(request.id),
      message:
        'Card payment is not enabled on this deployment, so your upgrade has been sent for approval. ' +
        'An administrator will apply it shortly.',
    });
  })
);

billingRouter.post(
  '/subscription/cancel',
  asyncHandler(async (req, res) => {
    const body = z
      .object({ reasonId: z.number().int().positive().optional(), note: z.string().trim().max(1000).optional() })
      .parse(req.body ?? {});
    const user = req.user!;

    const reasons = await prisma.cancellationReason.findMany({ where: { isActive: true } });
    if (reasons.length && !body.reasonId) {
      throw ApiError.badRequest('Choose a reason before scheduling cancellation.');
    }
    const reason = reasons.find((r) => Number(r.id) === body.reasonId);
    if (reason?.requiresNote && !body.note?.trim()) {
      throw ApiError.badRequest('That reason needs a short note.');
    }

    const subscription = await prisma.subscription.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });

    // Access continues to the end of the paid period — cancelling is not a refund.
    const cycleEndsAt = subscription?.cycleEndsAt ?? new Date(Date.now() + 30 * 86_400_000);

    if (subscription) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          cancelAtPeriodEnd: true,
          cancellationReasonId: reason?.id ?? null,
          cancellationNote: body.note ?? null,
          cycleEndsAt,
        },
      });
    }

    res.json({
      status: 'scheduled',
      cycleEndsAt: cycleEndsAt.toISOString(),
      message: `Your plan stays active until ${cycleEndsAt.toLocaleDateString()}.`,
    });
  })
);

billingRouter.post(
  '/subscription/resume',
  asyncHandler(async (req, res) => {
    const subscription = await prisma.subscription.findFirst({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription?.cancelAtPeriodEnd) throw ApiError.badRequest('Nothing is scheduled to cancel.');
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: false, cancellationReasonId: null, cancellationNote: null },
    });
    res.json({ status: 'resumed' });
  })
);

billingRouter.get(
  '/cancellation-reasons',
  asyncHandler(async (_req, res) => {
    const reasons = await prisma.cancellationReason.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    res.json({
      items: reasons.map((r) => ({ id: Number(r.id), label: r.label, requiresNote: r.requiresNote })),
    });
  })
);

/* ── Credit packs ──────────────────────────────────────────────────────── */

billingRouter.post(
  '/credits/purchase',
  asyncHandler(async (req, res) => {
    const { packId } = z.object({ packId: z.number().int().positive() }).parse(req.body);
    const user = req.user!;

    if (user.planTier === 'free') {
      throw ApiError.upgradeRequired('Credit packs are available on Plus and Pro plans.');
    }

    const pack = await prisma.creditPack.findUnique({ where: { id: BigInt(packId) } });
    if (!pack?.isActive) throw ApiError.badRequest('That credit pack is not available.');

    if (stripeConfigured) {
      const session = await createPackCheckout(user.id, pack.id);
      return res.status(200).json({ status: 'checkout', url: session.url, sessionId: session.id });
    }

    // Without a processor the purchase is recorded for an administrator to
    // confirm; nothing is granted until then, so credits are never given away.
    const request = await prisma.subscriptionRequest.create({
      data: {
        userId: user.id,
        requestedPlan: user.planTier,
        status: 'pending',
        note: `Credit pack: ${pack.creditAmount} credits (${(pack.unitAmount / 100).toFixed(2)} ${pack.currency.toUpperCase()})`,
      },
    });

    res.status(202).json({
      status: 'pending_approval',
      requestId: Number(request.id),
      message: 'Card payment is not enabled here, so your credit purchase has been sent for approval.',
    });
  })
);

/**
 * Stripe's hosted billing portal.
 *
 * Only meaningful once the user has a Stripe customer, so it 503s in manual
 * mode rather than pretending to have somewhere to send them.
 */
billingRouter.post(
  '/portal',
  asyncHandler(async (req, res) => {
    if (!stripeConfigured) {
      throw new ApiError(
        503,
        'STRIPE_NOT_CONFIGURED',
        'Card payment is not enabled on this deployment, so there is no billing portal.'
      );
    }
    const session = await createPortalSession(req.user!.id);
    res.json(session);
  })
);

/** Whether the client should show checkout buttons or the approval-queue copy. */
billingRouter.get(
  '/mode',
  asyncHandler(async (_req, res) => {
    res.json({ mode: stripeConfigured ? 'stripe' : 'manual' });
  })
);

/* ── Administration ────────────────────────────────────────────────────── */

/** Apply a tier and grant its allowance. Shared by admin approval and downgrade. */
export async function applyTier(userId: bigint, tier: PlanTier) {
  const price = await prisma.planPrice.findUnique({ where: { tier } });
  const quota = price?.monthlyCredits ?? DEFAULT_PLAN_CREDITS[tier];

  await prisma.user.update({
    where: { id: userId },
    data: { planTier: tier, monthlyCreditQuota: quota },
  });

  const cycleEndsAt = new Date(Date.now() + 30 * 86_400_000);
  const existing = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    await prisma.subscription.update({
      where: { id: existing.id },
      data: { planTier: tier, monthlyCreditQuota: quota, cycleEndsAt, cancelAtPeriodEnd: false },
    });
  } else {
    await prisma.subscription.create({
      data: {
        userId,
        planTier: tier,
        billingSource: 'manual',
        monthlyCreditQuota: quota,
        cycleEndsAt,
        billingCycleAnchor: new Date(),
      },
    });
  }

  if (quota > 0) await grantMonthly(userId, quota);
}

billingRouter.get(
  '/admin/requests',
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await prisma.subscriptionRequest.findMany({
      where: { status: 'pending' },
      orderBy: { requestedAt: 'asc' },
      include: { user: { select: { email: true, firstName: true, lastName: true, planTier: true } } },
    });
    res.json({
      items: rows.map((r) => ({
        id: Number(r.id),
        userId: Number(r.userId),
        email: r.user.email,
        name: `${r.user.firstName} ${r.user.lastName}`.trim(),
        currentPlan: r.user.planTier,
        requestedPlan: r.requestedPlan,
        note: r.note,
        requestedAt: r.requestedAt.toISOString(),
      })),
    });
  })
);

billingRouter.post(
  '/admin/requests/:id/approve',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Request not found.');
    const request = await prisma.subscriptionRequest.findUnique({ where: { id } });
    if (!request || request.status !== 'pending') throw ApiError.notFound('No pending request with that id.');

    // A credit-pack request carries its amount in the note rather than a tier.
    const packMatch = /Credit pack: (\d+) credits/.exec(request.note ?? '');
    if (packMatch) {
      await purchase(request.userId, Number(packMatch[1]), new Date(Date.now() + 365 * 86_400_000));
    } else {
      await applyTier(request.userId, request.requestedPlan as PlanTier);
    }

    await prisma.subscriptionRequest.update({
      where: { id },
      data: { status: 'approved', decidedAt: new Date(), decidedBy: req.user!.id },
    });
    res.json({ ok: true });
  })
);

billingRouter.post(
  '/admin/requests/:id/reject',
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Request not found.');
    await prisma.subscriptionRequest.update({
      where: { id },
      data: { status: 'rejected', decidedAt: new Date(), decidedBy: req.user!.id },
    });
    res.json({ ok: true });
  })
);
