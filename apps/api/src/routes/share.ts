import { Router } from 'express';
import { z } from 'zod';
import { migrateScene } from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { loadPlanForUser } from './plans.js';
import { opaqueToken } from '../lib/ids.js';
import { env } from '../lib/env.js';

export const shareRouter = Router();

/**
 * Public read-only view of a plan.
 *
 * Addressed by an opaque token, never by the plan id — sequential ids in a
 * public URL are trivially enumerable, which would expose every customer's
 * layouts to anyone who could count.
 */
shareRouter.get(
  '/share/:token',
  asyncHandler(async (req, res) => {
    const token = String(req.params.token ?? '');
    const share = await prisma.planShare.findUnique({
      where: { token },
      include: {
        plan: {
          include: {
            scene: true,
            owner: { select: { company: { select: { name: true, logoUrl: true } } } },
          },
        },
      },
    });

    if (!share || share.revokedAt) throw ApiError.notFound('This share link is no longer available.');
    if (share.expiresAt && share.expiresAt < new Date()) {
      throw new ApiError(410, 'SHARE_EXPIRED', 'This share link has expired.');
    }

    res.json({
      title: share.plan.title,
      units: share.plan.units,
      scene: migrateScene(share.plan.scene?.scene),
      mode: share.mode,
      companyName: share.plan.owner.company?.name ?? null,
      companyLogoUrl: share.plan.owner.company?.logoUrl ?? null,
    });
  })
);

const createShareBody = z.object({
  mode: z.enum(['view', 'embed']).default('view'),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

shareRouter.post(
  '/plans/:id/share',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    const plan = await loadPlanForUser(req.user!, id);
    if (plan.isReadOnly) throw ApiError.forbidden('Read-only plans cannot be shared.', 'READ_ONLY_PLAN');

    const body = createShareBody.parse(req.body ?? {});

    // Reuse a live link for the same mode rather than minting a new one each
    // time — a planner who clicks Share twice should get the same URL.
    const existing = await prisma.planShare.findFirst({
      where: { planId: id, mode: body.mode, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    const usable = existing && (!existing.expiresAt || existing.expiresAt > new Date()) ? existing : null;

    const share =
      usable ??
      (await prisma.planShare.create({
        data: {
          planId: id,
          token: opaqueToken(),
          mode: body.mode,
          expiresAt: body.expiresInDays
            ? new Date(Date.now() + body.expiresInDays * 86_400_000)
            : null,
        },
      }));

    res.json({
      token: share.token,
      mode: share.mode,
      url: `${env.corsOrigin.split(',')[0]}/share/${share.token}`,
      expiresAt: share.expiresAt?.toISOString() ?? null,
    });
  })
);

shareRouter.get(
  '/plans/:id/shares',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    await loadPlanForUser(req.user!, id);
    const shares = await prisma.planShare.findMany({
      where: { planId: id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      items: shares.map((s) => ({
        token: s.token,
        mode: s.mode,
        url: `${env.corsOrigin.split(',')[0]}/share/${s.token}`,
        expiresAt: s.expiresAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  })
);

shareRouter.delete(
  '/shares/:token',
  requireAuth,
  asyncHandler(async (req, res) => {
    const token = String(req.params.token ?? '');
    const share = await prisma.planShare.findUnique({ where: { token } });
    if (!share) throw ApiError.notFound('Share link not found.');
    await loadPlanForUser(req.user!, share.planId);
    await prisma.planShare.update({ where: { token }, data: { revokedAt: new Date() } });
    res.json({ ok: true });
  })
);
