import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { DEFAULT_PLAN_CREDITS, ERROR_CODES, type SessionUser } from '@novira/shared';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { opaqueToken } from '../lib/ids.js';
import { requireAuth, signToken } from '../middleware/auth.js';

export const authRouter = Router();

const PASSWORD_RULE = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .regex(/[A-Za-z]/, 'Password must include a letter.')
  .regex(/[0-9]/, 'Password must include a number.');

/** Serialise a user row into the session shape the client expects. */
export async function toSessionUser(userId: bigint): Promise<SessionUser> {
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          logoUrl: true,
          creditMode: true,
          poolBalance: true,
          globalModelsEnabled: true,
          globalTexturesEnabled: true,
        },
      },
      memberships: { select: { companyId: true, role: true, status: true } },
    },
  });
  const membership = row.memberships.find((m) => m.companyId === row.companyId && m.status === 'active');
  return {
    id: Number(row.id),
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: row.displayName,
    role: row.role as SessionUser['role'],
    planTier: row.planTier as SessionUser['planTier'],
    preferredUnits: row.preferredUnits as SessionUser['preferredUnits'],
    appearance: row.appearance as SessionUser['appearance'],
    isEmailVerified: row.isEmailVerified,
    onboardingCompletedAt: row.onboardingCompletedAt?.toISOString() ?? null,
    creditsRemaining: row.creditsRemaining,
    monthlyCreditQuota: row.monthlyCreditQuota,
    company: row.company
      ? {
          id: Number(row.company.id),
          name: row.company.name,
          logoUrl: row.company.logoUrl,
          creditMode: row.company.creditMode as 'per_user' | 'shared_pool',
          poolBalance: row.company.poolBalance,
          role: (membership?.role as 'member' | 'admin') ?? null,
          globalModelsEnabled: row.company.globalModelsEnabled,
          globalTexturesEnabled: row.company.globalTexturesEnabled,
        }
      : null,
  };
}

/* ── Register ──────────────────────────────────────────────────────────── */

const registerSchema = z
  .object({
    email: z.string().email('Enter a valid email address.'),
    password: PASSWORD_RULE,
    firstName: z.string().trim().min(1, 'First name is required.').max(60),
    lastName: z.string().trim().min(1, 'Last name is required.').max(60),
    accountType: z.enum(['individual', 'company']).default('individual'),
    companyName: z.string().trim().max(160).optional(),
    companyCountry: z.string().trim().length(2).optional(),
    companyPostalCode: z.string().trim().max(20).optional(),
    phone: z.string().trim().max(40).optional(),
    marketingOptIn: z.boolean().optional(),
  })
  .refine((v) => (v.firstName + v.lastName).length <= 100, {
    message: 'First and last name must be 100 characters or fewer combined.',
    path: ['lastName'],
  })
  .refine((v) => v.accountType !== 'company' || Boolean(v.companyName && v.companyName.length >= 2), {
    message: 'Company name must be at least 2 characters.',
    path: ['companyName'],
  });

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const email = body.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw ApiError.conflict(ERROR_CODES.EMAIL_IN_USE, 'An account with that email already exists.');

    const passwordHash = await bcrypt.hash(body.password, 12);

    const user = await prisma.$transaction(async (tx) => {
      let companyId: bigint | null = null;
      if (body.accountType === 'company' && body.companyName) {
        const company = await tx.company.create({
          data: {
            name: body.companyName,
            mainEmail: email,
            country: body.companyCountry?.toUpperCase() ?? null,
            postalCode: body.companyPostalCode ?? null,
            phone: body.phone ?? null,
          },
        });
        companyId = company.id;
      }

      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName: body.firstName,
          lastName: body.lastName,
          displayName: `${body.firstName} ${body.lastName}`.trim(),
          phone: body.phone ?? null,
          companyId,
          marketingOptIn: body.marketingOptIn ?? false,
          planTier: 'free',
          monthlyCreditQuota: DEFAULT_PLAN_CREDITS.free,
        },
      });

      if (companyId) {
        await tx.companyMember.create({
          data: {
            companyId,
            userId: created.id,
            invitedEmail: email,
            role: 'admin',
            visibility: 'company_wide',
            seatPlanTier: 'free',
            status: 'active',
          },
        });
      }

      await tx.authToken.create({
        data: {
          userId: created.id,
          token: opaqueToken(),
          purpose: 'email_verify',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 48),
        },
      });

      return created;
    });

    res.status(201).json({ token: signToken(user), user: await toSessionUser(user.id) });
  })
);

/* ── Login ─────────────────────────────────────────────────────────────── */

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const email = body.email.toLowerCase().trim();

    const user = await prisma.user.findUnique({ where: { email } });
    // Same message for unknown email and wrong password — no account enumeration.
    if (!user?.passwordHash) {
      throw new ApiError(401, ERROR_CODES.INVALID_CREDENTIALS, 'Email or password is incorrect.');
    }
    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) throw new ApiError(401, ERROR_CODES.INVALID_CREDENTIALS, 'Email or password is incorrect.');
    if (user.isBlocked) throw ApiError.forbidden('This account has been blocked.');

    res.json({ token: signToken(user), user: await toSessionUser(user.id) });
  })
);

/* ── Session ───────────────────────────────────────────────────────────── */

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await toSessionUser(req.user!.id));
  })
);

const updateMeSchema = z.object({
  displayName: z.string().trim().min(2, 'Display name must be at least 2 characters.').max(120).optional(),
  preferredUnits: z.enum(['metric', 'imperial']).optional(),
  appearance: z.enum(['light', 'dark']).optional(),
});

authRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = updateMeSchema.parse(req.body);
    await prisma.user.update({ where: { id: req.user!.id }, data: body });
    res.json(await toSessionUser(req.user!.id));
  })
);

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: PASSWORD_RULE,
});

authRouter.post(
  '/me/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = passwordSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!user.passwordHash) throw ApiError.badRequest('This account signs in with Google.');
    const ok = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!ok) throw ApiError.badRequest('Your current password is incorrect.');
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(body.newPassword, 12) },
    });
    res.json({ ok: true });
  })
);

/* ── Verification & password reset ─────────────────────────────────────── */

authRouter.post(
  '/verification/resend',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.isEmailVerified) return res.json({ ok: true, alreadyVerified: true });
    const token = opaqueToken();
    await prisma.authToken.create({
      data: {
        userId: user.id,
        token,
        purpose: 'email_verify',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 48),
      },
    });
    // No mail transport is wired up in development; the token is returned so the
    // flow is testable end to end. Remove this branch when SMTP is configured.
    res.json({ ok: true, devToken: process.env.NODE_ENV === 'development' ? token : undefined });
  })
);

authRouter.post(
  '/verify',
  asyncHandler(async (req, res) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
    const row = await prisma.authToken.findUnique({ where: { token } });
    if (!row || row.purpose !== 'email_verify' || row.usedAt) {
      throw new ApiError(400, ERROR_CODES.TOKEN_INVALID, 'This verification link is invalid.');
    }
    if (row.expiresAt < new Date()) {
      throw new ApiError(400, ERROR_CODES.TOKEN_EXPIRED, 'This verification link has expired. Request a new one.');
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { isEmailVerified: true } }),
      prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    ]);
    res.json({ ok: true });
  })
);

authRouter.post(
  '/forgot',
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    // Always report success — never reveal whether an address is registered.
    if (!user) return res.json({ ok: true });
    const token = opaqueToken();
    await prisma.authToken.create({
      data: {
        userId: user.id,
        token,
        purpose: 'password_reset',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      },
    });
    res.json({ ok: true, devToken: process.env.NODE_ENV === 'development' ? token : undefined });
  })
);

authRouter.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const body = z.object({ token: z.string().min(10), password: PASSWORD_RULE }).parse(req.body);
    const row = await prisma.authToken.findUnique({ where: { token: body.token } });
    if (!row || row.purpose !== 'password_reset' || row.usedAt) {
      throw new ApiError(400, ERROR_CODES.TOKEN_INVALID, 'This reset link is invalid.');
    }
    if (row.expiresAt < new Date()) {
      throw new ApiError(400, ERROR_CODES.TOKEN_EXPIRED, 'This reset link has expired. Request a new one.');
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash: await bcrypt.hash(body.password, 12) },
      }),
      prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    ]);
    res.json({ ok: true });
  })
);
