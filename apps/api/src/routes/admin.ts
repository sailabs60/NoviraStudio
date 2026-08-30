import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { FeatureCode, PlanTier } from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth, requireSuperAdmin, signToken } from '../middleware/auth.js';
import { adminAdjust, recompute } from '../services/credits.js';
import { applyTier } from './billing.js';
import { providerStatuses } from '../services/providers.js';

/**
 * Super Admin Console.
 *
 * The application is configured from here rather than from constants: pricing,
 * credit costs, plan allowances, onboarding options and the theme are all rows,
 * so the console is load-bearing infrastructure rather than a nice-to-have.
 */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireSuperAdmin);

/* ── Dashboard ─────────────────────────────────────────────────────────── */

adminRouter.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const [
      totalUsers,
      byTier,
      totalProjects,
      totalPlans,
      catalogApproved,
      catalogPending,
      creditsIssued,
      creditsSpent,
      jobsByStatus,
      recentSignups,
      companies,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.groupBy({ by: ['planTier'], _count: { _all: true } }),
      prisma.project.count(),
      prisma.plan.count(),
      prisma.catalogItem.count({ where: { reviewStatus: 'approved' } }),
      prisma.catalogItem.count({ where: { reviewStatus: 'pending' } }),
      prisma.creditLedger.aggregate({
        where: { delta: { gt: 0 } },
        _sum: { delta: true },
      }),
      prisma.creditLedger.aggregate({
        where: { reason: 'debit' },
        _sum: { delta: true },
      }),
      prisma.aiJob.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, email: true, planTier: true, createdAt: true },
      }),
      prisma.company.count(),
    ]);

    res.json({
      totalUsers,
      companies,
      planSplit: Object.fromEntries(byTier.map((r) => [r.planTier, r._count._all])),
      activeSubscribers: byTier
        .filter((r) => r.planTier !== 'free')
        .reduce((sum, r) => sum + r._count._all, 0),
      totalProjects,
      totalPlans,
      catalog: { approved: catalogApproved, pending: catalogPending },
      credits: {
        issued: creditsIssued._sum.delta ?? 0,
        spent: Math.abs(creditsSpent._sum.delta ?? 0),
      },
      jobsByStatus: Object.fromEntries(jobsByStatus.map((r) => [r.status, r._count._all])),
      recentSignups: recentSignups.map((u) => ({
        id: Number(u.id),
        email: u.email,
        planTier: u.planTier,
        createdAt: u.createdAt.toISOString(),
      })),
      providers: providerStatuses(),
    });
  })
);

/* ── Users ─────────────────────────────────────────────────────────────── */

const userQuery = z.object({
  q: z.string().trim().max(120).optional(),
  planTier: z.enum(['free', 'plus', 'pro']).optional(),
  role: z.enum(['user', 'company_admin', 'super_admin']).optional(),
  blocked: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const query = userQuery.parse(req.query);
    const where = {
      ...(query.planTier ? { planTier: query.planTier } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.blocked ? { isBlocked: query.blocked === 'true' } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q } },
              { firstName: { contains: query.q } },
              { lastName: { contains: query.q } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        skip: query.offset,
        include: { company: { select: { name: true } } },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      items: rows.map((u) => ({
        id: Number(u.id),
        email: u.email,
        name: `${u.firstName} ${u.lastName}`.trim(),
        role: u.role,
        planTier: u.planTier,
        companyName: u.company?.name ?? null,
        creditsRemaining: u.creditsRemaining,
        monthlyCreditQuota: u.monthlyCreditQuota,
        isBlocked: u.isBlocked,
        isEmailVerified: u.isEmailVerified,
        createdAt: u.createdAt.toISOString(),
      })),
      total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + rows.length < total,
    });
  })
);

const userPatch = z.object({
  planTier: z.enum(['free', 'plus', 'pro']).optional(),
  role: z.enum(['user', 'company_admin', 'super_admin']).optional(),
  isBlocked: z.boolean().optional(),
  monthlyCreditQuota: z.number().int().min(0).max(100_000).optional(),
  creditAdjustment: z.number().int().min(-100_000).max(100_000).optional(),
  adjustmentNote: z.string().trim().max(200).optional(),
});

adminRouter.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('User not found.');
    const body = userPatch.parse(req.body);

    // An administrator locking themselves out is an easy and unrecoverable
    // mistake, so it is simply not allowed.
    if (id === req.user!.id && (body.isBlocked || body.role === 'user')) {
      throw ApiError.badRequest('You cannot remove your own administrator access.');
    }

    if (body.planTier) await applyTier(id, body.planTier);

    await prisma.user.update({
      where: { id },
      data: {
        ...(body.role ? { role: body.role } : {}),
        ...(body.isBlocked !== undefined ? { isBlocked: body.isBlocked } : {}),
        ...(body.monthlyCreditQuota !== undefined ? { monthlyCreditQuota: body.monthlyCreditQuota } : {}),
      },
    });

    if (body.creditAdjustment) {
      await adminAdjust(id, body.creditAdjustment, body.adjustmentNote ?? 'Administrator adjustment');
    }

    const updated = await prisma.user.findUniqueOrThrow({ where: { id } });
    res.json({
      id: Number(updated.id),
      planTier: updated.planTier,
      role: updated.role,
      isBlocked: updated.isBlocked,
      creditsRemaining: updated.creditsRemaining,
    });
  })
);

adminRouter.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('User not found.');
    const { password } = z
      .object({ password: z.string().min(8).regex(/[A-Za-z]/).regex(/[0-9]/) })
      .parse(req.body);
    await prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(password, 12) },
    });
    res.json({ ok: true });
  })
);

/**
 * Impersonation.
 *
 * Genuinely useful for support and genuinely dangerous, so: never another
 * administrator, always recorded, and the returned token is short-lived and
 * carries a marker the client shows in the UI.
 */
adminRouter.post(
  '/users/:id/impersonate',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('User not found.');
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw ApiError.notFound('User not found.');
    if (target.role === 'super_admin') {
      throw ApiError.forbidden('Administrators cannot impersonate one another.');
    }
    if (target.id === req.user!.id) throw ApiError.badRequest('You are already signed in as this user.');

    const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.body);

    await prisma.analyticsEvent.create({
      data: {
        userId: req.user!.id,
        name: 'admin.impersonate',
        props: {
          targetUserId: Number(target.id),
          targetEmail: target.email,
          reason,
          at: new Date().toISOString(),
        },
      },
    });

    res.json({
      token: signToken(target),
      impersonating: { id: Number(target.id), email: target.email },
      note: 'This session is recorded. Sign out to return to your own account.',
    });
  })
);

adminRouter.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('User not found.');
    if (id === req.user!.id) throw ApiError.badRequest('You cannot delete your own account.');
    await prisma.user.delete({ where: { id } });
    res.json({ ok: true });
  })
);

/* ── Companies ─────────────────────────────────────────────────────────── */

adminRouter.get(
  '/companies',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.company.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { users: true, members: true, projects: true } } },
    });
    res.json({
      items: rows.map((c) => ({
        id: Number(c.id),
        name: c.name,
        mainEmail: c.mainEmail,
        creditMode: c.creditMode,
        poolBalance: c.poolBalance,
        userCount: c._count.users,
        memberCount: c._count.members,
        projectCount: c._count.projects,
        globalModelsEnabled: c.globalModelsEnabled,
        globalTexturesEnabled: c.globalTexturesEnabled,
        companyAdminCanManageAssets: c.companyAdminCanManageAssets,
        aiImageTo3dEnabled: c.aiImageTo3dEnabled,
        venueGenerationAccess: c.venueGenerationAccess,
        isActive: c.isActive,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  })
);

const companyPatch = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  globalModelsEnabled: z.boolean().optional(),
  globalTexturesEnabled: z.boolean().optional(),
  companyAdminCanManageAssets: z.boolean().optional(),
  aiImageTo3dEnabled: z.boolean().optional(),
  venueGenerationAccess: z.enum(['default', 'granted', 'blocked']).optional(),
  isActive: z.boolean().optional(),
  poolBalance: z.number().int().min(0).optional(),
});

adminRouter.patch(
  '/companies/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Company not found.');
    const updated = await prisma.company.update({
      where: { id },
      data: companyPatch.parse(req.body),
    });
    res.json({ id: Number(updated.id), name: updated.name });
  })
);

/* ── Catalogue review ──────────────────────────────────────────────────── */

adminRouter.get(
  '/catalog/review',
  asyncHandler(async (req, res) => {
    const status = (req.query.status as string) ?? 'pending';
    const rows = await prisma.catalogItem.findMany({
      where: { reviewStatus: status },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { category: { select: { slug: true, name: true } } },
    });
    res.json({
      items: rows.map((i) => ({
        id: Number(i.id),
        name: i.name,
        categorySlug: i.category.slug,
        categoryName: i.category.name,
        scope: i.scope,
        modelUrl: i.modelUrl,
        previewImage: i.previewImage,
        widthMm: i.widthMm,
        depthMm: i.depthMm,
        heightMm: i.heightMm,
        triangleCount: i.triangleCount,
        sourceLabel: i.sourceLabel,
        license: i.license,
        verificationScore: i.verificationScore,
        // The reason the pipeline held it back, so review is informed.
        verificationNotes: i.verificationNotes,
        createdAt: i.createdAt.toISOString(),
      })),
    });
  })
);

adminRouter.post(
  '/catalog/:id/review',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Item not found.');
    const { decision, categorySlug, widthMm, depthMm, heightMm } = z
      .object({
        decision: z.enum(['approve', 'reject']),
        categorySlug: z.string().trim().optional(),
        widthMm: z.number().int().positive().optional(),
        depthMm: z.number().int().positive().optional(),
        heightMm: z.number().int().positive().optional(),
      })
      .parse(req.body);

    // Approving is also the moment to correct a measurement the pipeline got
    // wrong — which is the whole reason borderline items are held rather than
    // discarded.
    const categoryId = categorySlug
      ? (await prisma.catalogCategory.findUnique({ where: { slug: categorySlug } }))?.id
      : undefined;

    await prisma.catalogItem.update({
      where: { id },
      data: {
        reviewStatus: decision === 'approve' ? 'approved' : 'rejected',
        ...(categoryId ? { categoryId } : {}),
        ...(widthMm ? { widthMm } : {}),
        ...(depthMm ? { depthMm } : {}),
        ...(heightMm ? { heightMm } : {}),
      },
    });
    res.json({ ok: true });
  })
);

/* ── Pricing and credits ───────────────────────────────────────────────── */

adminRouter.patch(
  '/pricing/:tier',
  asyncHandler(async (req, res) => {
    const tier = req.params.tier as PlanTier;
    const body = z
      .object({
        marketingName: z.string().trim().min(1).max(60).optional(),
        tagline: z.string().trim().max(240).optional(),
        unitAmount: z.number().int().min(0).optional(),
        monthlyCredits: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);

    const updated = await prisma.planPrice.update({ where: { tier }, data: body });
    res.json({
      tier: updated.tier,
      unitAmount: updated.unitAmount,
      monthlyCredits: updated.monthlyCredits,
      note:
        body.monthlyCredits !== undefined
          ? 'New allowances apply from the next billing cycle. Existing balances are unchanged.'
          : undefined,
    });
  })
);

adminRouter.patch(
  '/credit-ratios/:featureCode',
  asyncHandler(async (req, res) => {
    const featureCode = req.params.featureCode as FeatureCode;
    const { credits, isActive } = z
      .object({ credits: z.number().int().min(0).max(1000).optional(), isActive: z.boolean().optional() })
      .parse(req.body);
    const updated = await prisma.creditRatio.update({
      where: { featureCode },
      data: { ...(credits !== undefined ? { credits } : {}), ...(isActive !== undefined ? { isActive } : {}) },
    });
    res.json({ featureCode: updated.featureCode, credits: updated.credits, isActive: updated.isActive });
  })
);

/* ── Operational reporting ─────────────────────────────────────────────── */

adminRouter.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        processType: z.string().optional(),
        status: z.string().optional(),
        q: z.string().trim().max(120).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(60),
      })
      .parse(req.query);

    const rows = await prisma.aiJob.findMany({
      where: {
        ...(query.processType ? { processType: query.processType } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.q ? { user: { email: { contains: query.q } } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      include: { user: { select: { email: true } } },
    });

    res.json({
      items: rows.map((j) => ({
        id: j.id,
        email: j.user.email,
        processType: j.processType,
        provider: j.provider,
        providerModel: j.providerModel,
        status: j.status,
        progress: j.progress,
        creditsCharged: j.creditsCharged,
        errorCode: j.errorCode,
        errorMessage: j.errorMessage,
        createdAt: j.createdAt.toISOString(),
        completedAt: j.completedAt?.toISOString() ?? null,
        durationMs: j.completedAt ? j.completedAt.getTime() - j.createdAt.getTime() : null,
      })),
    });
  })
);

/* ── Theme ─────────────────────────────────────────────────────────────── */

adminRouter.get(
  '/themes',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.themePreset.findMany({ orderBy: { id: 'asc' } });
    res.json({
      items: rows.map((t) => ({
        id: Number(t.id),
        name: t.name,
        tokens: t.tokens,
        isActive: t.isActive,
      })),
    });
  })
);

adminRouter.post(
  '/themes/:id/activate',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Theme not found.');
    await prisma.$transaction([
      prisma.themePreset.updateMany({ data: { isActive: false } }),
      prisma.themePreset.update({ where: { id }, data: { isActive: true } }),
    ]);
    res.json({ ok: true });
  })
);

/* ── Maintenance ───────────────────────────────────────────────────────── */

/** Rebuild every cached credit balance from the ledger. */
adminRouter.post(
  '/maintenance/recompute-credits',
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ select: { id: true } });
    let changed = 0;
    for (const user of users) {
      const before = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).creditsRemaining;
      const after = await recompute(user.id);
      if (before !== after) changed += 1;
    }
    res.json({ checked: users.length, corrected: changed });
  })
);
