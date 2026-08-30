import { Router } from 'express';
import { z } from 'zod';
import { createEmptyScene, migrateScene, SCENE_SCHEMA_VERSION, type SceneDocument } from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthedUser } from '../middleware/auth.js';
import { loadOwnedProject } from './projects.js';
import { savePreviewImage } from '../services/storage.js';

export const plansRouter = Router();
plansRouter.use(requireAuth);

/**
 * Who may edit this plan.
 *
 * One function, used by both the read and the write path, because the studio's
 * disabled state and the API's refusal have to agree. When they disagreed, the
 * editor greyed out half its controls for a plan the server would happily have
 * saved — which reads as the product being broken rather than as a permission.
 *
 * Read-only in the studio means exactly two things: the plan row is flagged
 * read-only, or you are a company admin looking at a colleague's work. It has
 * nothing to do with the share link, which is a separate, genuinely read-only
 * surface for people who were sent a URL.
 */
export function planAccess(user: AuthedUser, plan: { ownerId: bigint; isReadOnly: boolean; project: { companyId: bigint | null } }) {
  const isOwner = plan.ownerId === user.id;
  const isSuperAdmin = user.role === 'super_admin';
  const sameCompany = plan.project.companyId !== null && plan.project.companyId === user.companyId;
  const isCompanyAdmin = sameCompany && (user.companyRole === 'admin' || user.role === 'company_admin');

  return {
    canRead: isOwner || isSuperAdmin || isCompanyAdmin,
    canWrite: (isOwner || isSuperAdmin) && !plan.isReadOnly,
    isOwner,
  };
}

export async function loadPlanForUser(user: AuthedUser, planId: bigint, opts: { write?: boolean } = {}) {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, include: { project: true } });
  if (!plan) throw ApiError.notFound('Plan not found.');

  const access = planAccess(user, plan);
  if (!access.canRead) throw ApiError.forbidden('This plan belongs to someone else.');

  if (opts.write && !access.canWrite) {
    throw ApiError.forbidden(
      plan.isReadOnly ? 'This plan is read-only.' : 'You can view this plan but not edit it.',
      'READ_ONLY_PLAN'
    );
  }
  return plan;
}

function planDto(plan: {
  id: bigint;
  projectId: bigint;
  title: string;
  editorType: string;
  units: string;
  previewUrl: string | null;
  isReadOnly: boolean;
  objectCount: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: Number(plan.id),
    projectId: Number(plan.projectId),
    title: plan.title,
    editorType: plan.editorType as '3d' | '2d',
    units: plan.units as 'metric' | 'imperial',
    previewUrl: plan.previewUrl,
    isReadOnly: plan.isReadOnly,
    objectCount: plan.objectCount,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

plansRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const projectId = req.query.project_id ? toId(req.query.project_id) : null;
    if (projectId) await loadOwnedProject(user, projectId);

    const plans = await prisma.plan.findMany({
      where: projectId ? { projectId } : { ownerId: user.id },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ items: plans.map(planDto) });
  })
);

const createPlanBody = z.object({
  projectId: z.number().int().positive(),
  title: z.string().trim().min(1, 'Plan title is required.').max(180),
  editorType: z.enum(['3d', '2d']).default('3d'),
});

plansRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createPlanBody.parse(req.body);
    const user = req.user!;
    await loadOwnedProject(user, BigInt(body.projectId));

    const units = (await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { preferredUnits: true },
    })).preferredUnits as 'metric' | 'imperial';

    const scene = createEmptyScene(units);
    // 2D plans open looking straight down; it is the only sane default there.
    scene.camera.mode = body.editorType === '2d' ? 'top' : 'perspective';

    const plan = await prisma.plan.create({
      data: {
        projectId: BigInt(body.projectId),
        ownerId: user.id,
        title: body.title,
        editorType: body.editorType,
        units,
        startInTopView: body.editorType === '2d',
        scene: { create: { schemaVersion: SCENE_SCHEMA_VERSION, scene: scene as unknown as object } },
      },
    });

    // Touch the project so the dashboard ordering reflects the new plan.
    await prisma.project.update({ where: { id: BigInt(body.projectId) }, data: { updatedAt: new Date() } });

    res.status(201).json(planDto(plan));
  })
);

plansRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    const user = req.user!;
    const plan = await loadPlanForUser(user, id);
    const sceneRow = await prisma.planScene.findUnique({ where: { planId: id } });
    const scene = sceneRow ? migrateScene(sceneRow.scene) : createEmptyScene(plan.units as 'metric' | 'imperial');
    // The same rule the write path applies, so the studio never disables a
    // control the server would have accepted.
    res.json({ ...planDto(plan), scene, isReadOnly: !planAccess(user, plan).canWrite });
  })
);

const updatePlanBody = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  scene: z.unknown().optional(),
  previewDataUrl: z.string().optional(),
});

plansRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    const user = req.user!;
    await loadPlanForUser(user, id, { write: true });
    const body = updatePlanBody.parse(req.body);

    let objectCount: number | undefined;
    let previewUrl: string | undefined;

    if (body.scene !== undefined) {
      const scene: SceneDocument = migrateScene(body.scene);
      objectCount = scene.objects.length;
      await prisma.planScene.upsert({
        where: { planId: id },
        create: { planId: id, schemaVersion: SCENE_SCHEMA_VERSION, scene: scene as unknown as object },
        update: { schemaVersion: SCENE_SCHEMA_VERSION, scene: scene as unknown as object },
      });
    }

    if (body.previewDataUrl) {
      previewUrl = await savePreviewImage(body.previewDataUrl, `plan-${id}`);
    }

    const plan = await prisma.plan.update({
      where: { id },
      data: {
        ...(body.title ? { title: body.title } : {}),
        ...(objectCount !== undefined ? { objectCount } : {}),
        ...(previewUrl ? { previewUrl } : {}),
      },
    });
    await prisma.project.update({ where: { id: plan.projectId }, data: { updatedAt: new Date() } });

    res.json(planDto(plan));
  })
);

plansRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    const plan = await loadPlanForUser(req.user!, id, { write: true });
    await prisma.plan.delete({ where: { id } });
    await prisma.project.update({ where: { id: plan.projectId }, data: { updatedAt: new Date() } });
    res.json({ ok: true });
  })
);
