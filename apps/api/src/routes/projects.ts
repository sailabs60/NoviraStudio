import { Router } from 'express';
import { z } from 'zod';
import { ERROR_CODES } from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthedUser } from '../middleware/auth.js';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

/**
 * Visibility.
 *
 * A user always sees their own projects. Inside a company, members whose
 * visibility is `company_wide` also expose their projects to the tenant, and
 * company admins see everything belonging to the company.
 */
async function visibleProjectFilter(user: AuthedUser) {
  if (user.role === 'super_admin') return {};
  if (!user.companyId) return { ownerId: user.id };

  const isAdmin = user.companyRole === 'admin' || user.role === 'company_admin';
  if (isAdmin) return { OR: [{ ownerId: user.id }, { companyId: user.companyId }] };

  const shared = await prisma.companyMember.findMany({
    where: { companyId: user.companyId, visibility: 'company_wide', status: 'active' },
    select: { userId: true },
  });
  const sharedIds = shared.map((m) => m.userId).filter((id): id is bigint => id !== null);
  return { OR: [{ ownerId: user.id }, { ownerId: { in: sharedIds }, companyId: user.companyId }] };
}

async function loadOwnedProject(user: AuthedUser, id: bigint) {
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) throw ApiError.notFound('Project not found.');
  const isOwner = project.ownerId === user.id;
  const isCompanyAdmin =
    user.role === 'super_admin' ||
    (project.companyId !== null &&
      project.companyId === user.companyId &&
      (user.companyRole === 'admin' || user.role === 'company_admin'));
  if (!isOwner && !isCompanyAdmin) throw ApiError.forbidden('This project belongs to someone else.');
  return project;
}

projectsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const where = await visibleProjectFilter(user);
    const projects = await prisma.project.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        owner: { select: { displayName: true, firstName: true, lastName: true } },
        plans: {
          select: { previewUrl: true },
          orderBy: { updatedAt: 'desc' },
          take: 4,
        },
        _count: { select: { plans: true } },
      },
    });

    res.json({
      items: projects.map((p) => ({
        id: Number(p.id),
        title: p.title,
        description: p.description,
        planCount: p._count.plans,
        previewUrls: p.plans.map((pl) => pl.previewUrl).filter((u): u is string => Boolean(u)),
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        createdByName:
          p.owner.displayName ?? `${p.owner.firstName} ${p.owner.lastName}`.trim(),
      })),
    });
  })
);

const projectBody = z.object({
  title: z.string().trim().min(1, 'Project title is required.').max(180),
  description: z.string().trim().max(2000).optional().nullable(),
});

projectsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = projectBody.parse(req.body);
    const user = req.user!;
    const project = await prisma.project.create({
      data: {
        ownerId: user.id,
        companyId: user.companyId,
        title: body.title,
        description: body.description ?? null,
      },
    });
    res.status(201).json({
      id: Number(project.id),
      title: project.title,
      description: project.description,
      planCount: 0,
      previewUrls: [],
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    });
  })
);

projectsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Project not found.');
    const project = await loadOwnedProject(req.user!, id);
    const planCount = await prisma.plan.count({ where: { projectId: id } });
    res.json({
      id: Number(project.id),
      title: project.title,
      description: project.description,
      planCount,
      previewUrls: [],
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    });
  })
);

projectsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Project not found.');
    await loadOwnedProject(req.user!, id);
    const body = projectBody.partial().parse(req.body);
    const project = await prisma.project.update({ where: { id }, data: body });
    res.json({
      id: Number(project.id),
      title: project.title,
      description: project.description,
      updatedAt: project.updatedAt.toISOString(),
    });
  })
);

projectsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Project not found.');
    await loadOwnedProject(req.user!, id);
    // A project with plans cannot be deleted — the plans must go first, so a
    // stray click can never take a whole event's work with it.
    const planCount = await prisma.plan.count({ where: { projectId: id } });
    if (planCount > 0) {
      throw ApiError.conflict(
        ERROR_CODES.PROJECT_HAS_PLANS,
        'Delete all plans in this project first.',
        { planCount }
      );
    }
    await prisma.project.delete({ where: { id } });
    res.json({ ok: true });
  })
);

export { loadOwnedProject, visibleProjectFilter };
