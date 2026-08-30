import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { MemberRole, MemberStatus, MemberVisibility, PlanTier } from '@novira/shared';
import { DEFAULT_WHITE_LABEL, whiteLabelReadiness, type WhiteLabelSettings } from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth, requireCompanyAdmin } from '../middleware/auth.js';
import { opaqueToken } from '../lib/ids.js';
import { adminAdjust, availableCredits } from '../services/credits.js';
import { applyTier } from './billing.js';

/**
 * Company workspaces.
 *
 * A company owns seats, and a seat carries its own plan tier — a studio can put
 * two designers on Pro and the rest on Plus without buying the top tier for
 * everybody. Credits are either allocated per member or drawn from one shared
 * pool, which is the difference between "everyone gets 100" and "the team has
 * 600 between them".
 */
export const companyRouter = Router();
companyRouter.use(requireAuth);

/** The caller's company, or a clear error. */
async function requireCompany(req: Express.Request) {
  const companyId = req.user!.companyId;
  if (!companyId) throw ApiError.badRequest('You are not part of a company workspace.');
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw ApiError.notFound('Company not found.');
  return company;
}

companyRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    const company = await requireCompany(req);
    const [memberCount, poolBalance] = await Promise.all([
      prisma.companyMember.count({ where: { companyId: company.id, status: 'active' } }),
      Promise.resolve(company.poolBalance),
    ]);
    res.json({
      id: Number(company.id),
      name: company.name,
      mainEmail: company.mainEmail,
      phone: company.phone,
      addressLine: company.addressLine,
      city: company.city,
      country: company.country,
      postalCode: company.postalCode,
      logoUrl: company.logoUrl,
      creditMode: company.creditMode,
      pendingCreditMode: company.pendingCreditMode,
      poolBalance,
      memberCount,
      globalModelsEnabled: company.globalModelsEnabled,
      globalTexturesEnabled: company.globalTexturesEnabled,
      companyAdminCanManageAssets: company.companyAdminCanManageAssets,
      regionCode: company.regionCode,
      marketplaceEnabled: company.marketplaceEnabled,
      specialistsEnabled: company.specialistsEnabled,
      whiteLabelEnabled: company.whiteLabelEnabled,
      whiteLabel: { ...DEFAULT_WHITE_LABEL, ...((company.whiteLabel as object) ?? {}) },
    });
  })
);

const profileBody = z.object({
  name: z.string().trim().min(2, 'Company name must be at least 2 characters.').max(160).optional(),
  mainEmail: z.string().email().optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  addressLine: z.string().trim().max(255).optional().nullable(),
  city: z.string().trim().min(2).max(120).optional().nullable(),
  country: z.string().trim().length(2, 'Country must be a 2-letter code.').optional().nullable(),
  postalCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9 -]{2,20}$/, 'Postal code must be 2–20 letters, numbers, spaces or hyphens.')
    .optional()
    .nullable(),
  /** Market this agency works in — drives truss stock, materials and rules. */
  regionCode: z.string().trim().max(24).optional(),
});

companyRouter.patch(
  '/profile',
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const company = await requireCompany(req);
    const body = profileBody.parse(req.body);
    const updated = await prisma.company.update({
      where: { id: company.id },
      data: { ...body, country: body.country?.toUpperCase() ?? undefined },
    });
    res.json({ id: Number(updated.id), name: updated.name });
  })
);

/* ── White label ───────────────────────────────────────────────────────────
 *
 * The point of white label is that an agency can put this in front of their own
 * client without it looking like someone else's tool. Three surfaces have to
 * change together — the app chrome, the share link the client opens, and the
 * PDF that lands in their inbox — so the settings live in one place and are
 * gated on being complete enough to actually use.
 */

const whiteLabelBody = z.object({
  enabled: z.boolean().optional(),
  brandName: z.string().trim().max(180).optional(),
  logoUrl: z.string().trim().max(512).nullable().optional(),
  markUrl: z.string().trim().max(512).nullable().optional(),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #0072FD.')
    .optional(),
  hidePlatformCredit: z.boolean().optional(),
  footerText: z.string().trim().max(300).optional(),
  contactEmail: z.string().trim().max(255).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  website: z.string().trim().max(255).optional(),
  subdomain: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{3,40}$/, 'A subdomain is lower-case letters, numbers and hyphens.')
    .nullable()
    .optional(),
});

companyRouter.get(
  '/white-label',
  asyncHandler(async (req, res) => {
    const company = await requireCompany(req);
    const settings: WhiteLabelSettings = {
      ...DEFAULT_WHITE_LABEL,
      brandName: company.name,
      logoUrl: company.logoUrl,
      ...((company.whiteLabel as object) ?? {}),
      enabled: company.whiteLabelEnabled,
    };
    res.json({ settings, readiness: whiteLabelReadiness(settings) });
  })
);

companyRouter.patch(
  '/white-label',
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const company = await requireCompany(req);
    const body = whiteLabelBody.parse(req.body);

    const merged: WhiteLabelSettings = {
      ...DEFAULT_WHITE_LABEL,
      brandName: company.name,
      logoUrl: company.logoUrl,
      ...((company.whiteLabel as object) ?? {}),
      ...body,
    };

    /*
     * Turning it on with no logo produces a client-facing page with a gap where
     * a brand should be, which reads worse than the platform's own mark. So the
     * switch is refused until the visible pieces exist, and the response says
     * exactly which are missing rather than a generic validation failure.
     */
    const readiness = whiteLabelReadiness(merged);
    if (merged.enabled && !readiness.ready) {
      throw ApiError.badRequest(
        `White label needs ${readiness.missing.join(', ')} before it can be switched on.`,
        { missing: readiness.missing }
      );
    }

    const updated = await prisma.company.update({
      where: { id: company.id },
      data: {
        whiteLabel: merged as unknown as object,
        whiteLabelEnabled: merged.enabled,
        ...(merged.logoUrl ? { logoUrl: merged.logoUrl } : {}),
      },
    });

    res.json({
      settings: { ...merged, enabled: updated.whiteLabelEnabled },
      readiness: whiteLabelReadiness(merged),
    });
  })
);

/** Turn an individual account into a company workspace. */
companyRouter.post(
  '/convert',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    if (user.companyId) throw ApiError.badRequest('This account already belongs to a company.');
    const { name } = z
      .object({ name: z.string().trim().min(2, 'Company name must be at least 2 characters.').max(160) })
      .parse(req.body);

    const company = await prisma.$transaction(async (tx) => {
      const created = await tx.company.create({ data: { name, mainEmail: user.email } });
      await tx.user.update({ where: { id: user.id }, data: { companyId: created.id } });
      await tx.companyMember.create({
        data: {
          companyId: created.id,
          userId: user.id,
          invitedEmail: user.email,
          role: 'admin',
          visibility: 'company_wide',
          seatPlanTier: user.planTier,
          status: 'active',
        },
      });
      return created;
    });

    res.status(201).json({ id: Number(company.id), name: company.name });
  })
);

/* ── Members ───────────────────────────────────────────────────────────── */

companyRouter.get(
  '/members',
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const company = await requireCompany(req);
    const members = await prisma.companyMember.findMany({
      where: { companyId: company.id },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, displayName: true, creditsRemaining: true },
        },
      },
    });

    res.json({
      items: members.map((m) => ({
        id: Number(m.id),
        userId: m.userId ? Number(m.userId) : null,
        email: m.invitedEmail,
        name: m.user ? (m.user.displayName ?? `${m.user.firstName} ${m.user.lastName}`.trim()) : null,
        role: m.role as MemberRole,
        visibility: m.visibility as MemberVisibility,
        seatPlanTier: m.seatPlanTier as PlanTier,
        status: m.status as MemberStatus,
        creditsRemaining: m.user?.creditsRemaining ?? null,
        invitationExpiresAt: m.invitationExpiresAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
      creditMode: company.creditMode,
      poolBalance: company.poolBalance,
    });
  })
);

const inviteBody = z.object({
  email: z.string().email('Enter a valid email address.'),
  role: z.enum(['member', 'admin']).default('member'),
  visibility: z.enum(['own_only', 'company_wide']).default('own_only'),
  seatPlanTier: z.enum(['free', 'plus', 'pro']).default('plus'),
});

companyRouter.post(
  '/members',
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const company = await requireCompany(req);
    const body = inviteBody.parse(req.body);
    const email = body.email.toLowerCase().trim();

    if (req.user!.planTier === 'free' && req.user!.role !== 'super_admin') {
      throw ApiError.upgradeRequired('Free accounts cannot add team members. Upgrade to Plus or Pro.');
    }

    const existing = await prisma.companyMember.findUnique({
      where: { companyId_invitedEmail: { companyId: company.id, invitedEmail: email } },
    });
    if (existing) throw ApiError.conflict('MEMBER_EXISTS', 'That email is already on the team.');

    const token = opaqueToken();
    const member = await prisma.companyMember.create({
      data: {
        companyId: company.id,
        invitedEmail: email,
        role: body.role,
        visibility: body.visibility,
        seatPlanTier: body.seatPlanTier,
        status: 'invited',
        invitationToken: token,
        invitationExpiresAt: new Date(Date.now() + 14 * 86_400_000),
      },
    });

    res.status(201).json({
      id: Number(member.id),
      email,
      status: member.status,
      // No mail transport in development; the link is returned so the flow is
      // testable end to end. Remove once SMTP is configured.
      inviteToken: process.env.NODE_ENV === 'development' ? token : undefined,
      expiresAt: member.invitationExpiresAt?.toISOString(),
    });
  })
);

const memberPatch = z.object({
  role: z.enum(['member', 'admin']).optional(),
  visibility: z.enum(['own_only', 'company_wide']).optional(),
  seatPlanTier: z.enum(['free', 'plus', 'pro']).optional(),
});

companyRouter.patch(
  '/members/:id',
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const company = await requireCompany(req);
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Member not found.');
    const member = await prisma.companyMember.findUnique({ where: { id } });
    if (!member || member.companyId !== company.id) throw ApiError.notFound('Member not found.');

    const body = memberPatch.parse(req.body);
    const updated = await prisma.companyMember.update({ where: { id }, data: body });

    // Changing a seat's tier changes the member's actual entitlement.
    if (body.seatPlanTier && member.userId) {
      await applyTier(member.userId, body.seatPlanTier);
    }

    res.json({ id: Number(updated.id), role: updated.role, seatPlanTier: updated.seatPlanTier });
  })
);

companyRouter.delete(
  '/members/:id',
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const company = await requireCompany(req);
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Member not found.');
    const member = await prisma.companyMember.findUnique({ where: { id } });
    if (!member || member.companyId !== company.id) throw ApiError.notFound('Member not found.');

    // Company-owned work outlives the person: reassign rather than delete.
    const owner = await prisma.companyMember.findFirst({
      where: { companyId: company.id, role: 'admin', status: 'active', NOT: { id } },
      orderBy: { createdAt: 'asc' },
    });

    await prisma.$transaction(async (tx) => {
      if (member.userId && owner?.userId) {
        await tx.project.updateMany({
          where: { ownerId: member.userId, companyId: company.id },
          data: { ownerId: owner.userId },
        });
      }
      if (member.userId) {
        // The person keeps their account; they simply leave the workspace.
        await tx.user.update({ where: { id: member.userId }, data: { companyId: null } });
      }
      await tx.companyMember.delete({ where: { id } });
    });

    res.json({
      ok: true,
      projectsTransferred: Boolean(member.userId && owner?.userId),
    });
  })
);

/* ── Invitations ───────────────────────────────────────────────────────── */

companyRouter.get(
  '/invitations/preview',
  asyncHandler(async (req, res) => {
    const token = String(req.query.token ?? '');
    const member = await prisma.companyMember.findUnique({
      where: { invitationToken: token },
      include: { company: { select: { name: true, logoUrl: true } } },
    });
    if (!member) throw ApiError.notFound('This invitation link is invalid or has expired.');
    if (member.status === 'active') throw ApiError.conflict('ALREADY_ACCEPTED', 'This invitation was already accepted.');
    if (member.invitationExpiresAt && member.invitationExpiresAt < new Date()) {
      throw new ApiError(410, 'INVITE_EXPIRED', 'This invitation has expired. Ask for a new one.');
    }

    res.json({
      companyName: member.company.name,
      companyLogoUrl: member.company.logoUrl,
      invitedEmail: member.invitedEmail,
      role: member.role,
      visibility: member.visibility,
      seatPlanTier: member.seatPlanTier,
      expiresAt: member.invitationExpiresAt?.toISOString() ?? null,
    });
  })
);

export const inviteRouter = Router();

const acceptBody = z.object({
  token: z.string().min(10),
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .regex(/[A-Za-z]/, 'Password must include a letter.')
    .regex(/[0-9]/, 'Password must include a number.')
    .optional(),
});

/** Accept an invitation — creating the account if the person is new. */
inviteRouter.post(
  '/accept',
  asyncHandler(async (req, res) => {
    const body = acceptBody.parse(req.body);
    const member = await prisma.companyMember.findUnique({ where: { invitationToken: body.token } });
    if (!member) throw ApiError.notFound('This invitation link is invalid.');
    if (member.invitationExpiresAt && member.invitationExpiresAt < new Date()) {
      throw new ApiError(410, 'INVITE_EXPIRED', 'This invitation has expired.');
    }

    const existingUser = await prisma.user.findUnique({ where: { email: member.invitedEmail } });

    const userId = await prisma.$transaction(async (tx) => {
      let id: bigint;
      if (existingUser) {
        await tx.user.update({ where: { id: existingUser.id }, data: { companyId: member.companyId } });
        id = existingUser.id;
      } else {
        if (!body.password || !body.firstName || !body.lastName) {
          throw ApiError.badRequest('Enter your name and choose a password to join.');
        }
        const created = await tx.user.create({
          data: {
            email: member.invitedEmail,
            passwordHash: await bcrypt.hash(body.password, 12),
            firstName: body.firstName,
            lastName: body.lastName,
            displayName: `${body.firstName} ${body.lastName}`.trim(),
            companyId: member.companyId,
            planTier: member.seatPlanTier,
            isEmailVerified: true, // arriving via an emailed link is proof enough
          },
        });
        id = created.id;
      }
      await tx.companyMember.update({
        where: { id: member.id },
        data: { userId: id, status: 'active', invitationToken: null },
      });
      return id;
    });

    await applyTier(userId, member.seatPlanTier as PlanTier);

    const { signToken } = await import('../middleware/auth.js');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { toSessionUser } = await import('./auth.js');
    res.json({ token: signToken(user), user: await toSessionUser(userId) });
  })
);

/* ── Credits ───────────────────────────────────────────────────────────── */

const creditModeBody = z.object({ mode: z.enum(['per_user', 'shared_pool']) });

companyRouter.patch(
  '/settings/credit-mode',
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const company = await requireCompany(req);
    const { mode } = creditModeBody.parse(req.body);

    const memberCount = await prisma.companyMember.count({
      where: { companyId: company.id, status: 'active' },
    });

    /*
     * Switching mid-cycle would strand credits somebody has already been
     * granted, so the change is deferred — except on a team of one, where there
     * is nothing to strand and waiting would just be confusing.
     */
    if (memberCount <= 1) {
      await prisma.company.update({
        where: { id: company.id },
        data: { creditMode: mode, pendingCreditMode: null },
      });
      return res.json({ applied: 'immediately', creditMode: mode });
    }

    await prisma.company.update({ where: { id: company.id }, data: { pendingCreditMode: mode } });
    res.json({
      applied: 'next_cycle',
      pendingCreditMode: mode,
      message: 'Credit sharing changes at the start of the next billing cycle.',
    });
  })
);

companyRouter.get(
  '/credits/usage',
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const company = await requireCompany(req);
    const members = await prisma.companyMember.findMany({
      where: { companyId: company.id },
      select: { userId: true, invitedEmail: true },
    });
    const userIds = members.map((m) => m.userId).filter((id): id is bigint => id !== null);

    const [byFeature, byMember] = await Promise.all([
      prisma.creditLedger.groupBy({
        by: ['featureCode'],
        where: { userId: { in: userIds }, reason: 'debit' },
        _sum: { delta: true },
      }),
      prisma.creditLedger.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, reason: 'debit' },
        _sum: { delta: true },
      }),
    ]);

    const emailById = new Map(members.map((m) => [String(m.userId), m.invitedEmail]));

    res.json({
      creditMode: company.creditMode,
      poolBalance: company.poolBalance,
      byFeature: byFeature.map((f) => ({
        featureCode: f.featureCode,
        // Debits are stored negative; usage reads better positive.
        used: Math.abs(f._sum.delta ?? 0),
      })),
      byMember: byMember.map((m) => ({
        userId: Number(m.userId),
        email: emailById.get(String(m.userId)) ?? null,
        used: Math.abs(m._sum.delta ?? 0),
      })),
    });
  })
);

/** Grant credits to a member, or to the shared pool. */
const grantBody = z.object({
  memberId: z.number().int().positive().optional(),
  amount: z.number().int().min(1).max(10_000),
  note: z.string().trim().max(200).optional(),
});

companyRouter.post(
  '/credits/grant',
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const company = await requireCompany(req);
    const body = grantBody.parse(req.body);

    if (!body.memberId) {
      await prisma.company.update({
        where: { id: company.id },
        data: { poolBalance: { increment: body.amount } },
      });
      return res.json({ target: 'pool', poolBalance: company.poolBalance + body.amount });
    }

    const member = await prisma.companyMember.findUnique({ where: { id: BigInt(body.memberId) } });
    if (!member || member.companyId !== company.id || !member.userId) {
      throw ApiError.notFound('Member not found.');
    }
    await adminAdjust(member.userId, body.amount, body.note ?? 'Granted by company admin');
    const { balance } = await availableCredits(member.userId);
    res.json({ target: 'member', memberId: body.memberId, balance });
  })
);

/* ── Company dashboard ─────────────────────────────────────────────────── */

companyRouter.get(
  '/users/:id/projects',
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const company = await requireCompany(req);
    const userId = toId(req.params.id);
    if (!userId) throw ApiError.notFound('User not found.');

    const member = await prisma.companyMember.findFirst({
      where: { companyId: company.id, userId },
    });
    if (!member) throw ApiError.notFound('That user is not on your team.');

    const projects = await prisma.project.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { plans: true } } },
    });

    res.json({
      items: projects.map((p) => ({
        id: Number(p.id),
        title: p.title,
        description: p.description,
        planCount: p._count.plans,
        updatedAt: p.updatedAt.toISOString(),
      })),
    });
  })
);

companyRouter.get(
  '/projects',
  requireCompanyAdmin,
  asyncHandler(async (req, res) => {
    const company = await requireCompany(req);
    const projects = await prisma.project.findMany({
      where: { companyId: company.id },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: {
        owner: { select: { email: true, displayName: true, firstName: true, lastName: true } },
        _count: { select: { plans: true } },
      },
    });
    res.json({
      items: projects.map((p) => ({
        id: Number(p.id),
        title: p.title,
        planCount: p._count.plans,
        createdBy: p.owner.displayName ?? `${p.owner.firstName} ${p.owner.lastName}`.trim(),
        createdByEmail: p.owner.email,
        updatedAt: p.updatedAt.toISOString(),
      })),
    });
  })
);
