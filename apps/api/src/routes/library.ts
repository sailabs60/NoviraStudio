import { Router } from 'express';
import { z } from 'zod';
import { ERROR_CODES, migrateScene } from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { savePreviewImage } from '../services/storage.js';
import { loadPlanForUser } from './plans.js';

/**
 * Templates and collections.
 *
 * Both are reuse mechanisms, at different scales:
 *
 *   · a **template** is a whole plan — a room shell, a house layout, a standard
 *     ceremony set — and applying one replaces the current scene;
 *   · a **collection** is a group of objects with their relative placement kept,
 *     dropped into an existing plan without disturbing anything else.
 */
export const templatesRouter = Router();
export const collectionsRouter = Router();
templatesRouter.use(requireAuth);
collectionsRouter.use(requireAuth);

/* ── Templates ─────────────────────────────────────────────────────────── */

templatesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const rows = await prisma.template.findMany({
      // Local templates are private; global ones are available to everybody.
      where: { OR: [{ scope: 'global' }, { ownerId: user.id }] },
      orderBy: [{ scope: 'asc' }, { title: 'asc' }],
      select: {
        id: true,
        scope: true,
        title: true,
        description: true,
        previewUrl: true,
        ownerId: true,
        createdAt: true,
      },
    });
    res.json({
      items: rows.map((r) => ({
        id: Number(r.id),
        scope: r.scope as 'local' | 'global',
        title: r.title,
        description: r.description,
        previewUrl: r.previewUrl,
        ownerId: r.ownerId ? Number(r.ownerId) : null,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  })
);

const createTemplateBody = z.object({
  planId: z.number().int().positive(),
  title: z.string().trim().min(3, 'Title must be at least 3 characters.').max(180),
  description: z.string().trim().max(2000).optional(),
  scope: z.enum(['local', 'global']).default('local'),
  previewDataUrl: z.string().optional(),
  /** Overwrite an existing template of the same name instead of failing. */
  overwrite: z.boolean().optional(),
});

templatesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createTemplateBody.parse(req.body);
    const user = req.user!;

    // Only a super admin may publish a template to everyone.
    if (body.scope === 'global' && user.role !== 'super_admin') {
      throw ApiError.forbidden('Only an administrator can publish a global template.');
    }

    await loadPlanForUser(user, BigInt(body.planId));
    const sceneRow = await prisma.planScene.findUnique({ where: { planId: BigInt(body.planId) } });
    if (!sceneRow) throw ApiError.badRequest('Save the plan before creating a template from it.');

    const existing = await prisma.template.findFirst({
      where: { scope: body.scope, ownerId: body.scope === 'global' ? null : user.id, title: body.title },
    });
    if (existing && !body.overwrite) {
      throw ApiError.conflict(
        ERROR_CODES.TEMPLATE_TITLE_EXISTS,
        'A template with that name already exists. Overwrite it?'
      );
    }

    const previewUrl = body.previewDataUrl
      ? await savePreviewImage(body.previewDataUrl, `template-${Date.now()}`)
      : undefined;

    const data = {
      ownerId: body.scope === 'global' ? null : user.id,
      scope: body.scope,
      title: body.title,
      description: body.description ?? null,
      snapshot: sceneRow.scene as object,
      ...(previewUrl ? { previewUrl } : {}),
    };

    const template = existing
      ? await prisma.template.update({ where: { id: existing.id }, data })
      : await prisma.template.create({ data });

    res.status(existing ? 200 : 201).json({
      id: Number(template.id),
      scope: template.scope,
      title: template.title,
      description: template.description,
      previewUrl: template.previewUrl,
      createdAt: template.createdAt.toISOString(),
      overwritten: Boolean(existing),
    });
  })
);

templatesRouter.post(
  '/:id/apply',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Template not found.');
    const { planId } = z.object({ planId: z.number().int().positive() }).parse(req.body);
    const user = req.user!;

    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) throw ApiError.notFound('Template not found.');
    if (template.scope === 'local' && template.ownerId !== user.id) {
      throw ApiError.forbidden('That template belongs to someone else.');
    }

    await loadPlanForUser(user, BigInt(planId), { write: true });
    // Returned rather than written: applying is destructive, so the client
    // confirms first and the change goes through the normal save path.
    res.json({ scene: migrateScene(template.snapshot) });
  })
);

templatesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Template not found.');
    const user = req.user!;
    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) throw ApiError.notFound('Template not found.');
    const mine = template.ownerId === user.id;
    if (!mine && user.role !== 'super_admin') {
      throw ApiError.forbidden('That template belongs to someone else.');
    }
    await prisma.template.delete({ where: { id } });
    res.json({ ok: true });
  })
);

/* ── Collections ───────────────────────────────────────────────────────── */

collectionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await prisma.collection.findMany({
      where: { ownerId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        objectCount: true,
        summary: true,
        previewUrl: true,
        createdAt: true,
      },
    });
    res.json({
      items: rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        objectCount: r.objectCount,
        summary: r.summary,
        previewUrl: r.previewUrl,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  })
);

const createCollectionBody = z.object({
  name: z.string().trim().min(1, 'Give the collection a name.').max(180),
  objects: z.array(z.unknown()).min(1, 'Select at least one object first.'),
  summary: z.string().trim().max(300).optional(),
  sourcePlanId: z.number().int().positive().optional(),
  previewDataUrl: z.string().optional(),
});

collectionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createCollectionBody.parse(req.body);
    const previewUrl = body.previewDataUrl
      ? await savePreviewImage(body.previewDataUrl, `collection-${Date.now()}`)
      : undefined;

    const collection = await prisma.collection.create({
      data: {
        ownerId: req.user!.id,
        name: body.name,
        objects: body.objects as object,
        objectCount: body.objects.length,
        summary: body.summary ?? null,
        sourcePlanId: body.sourcePlanId ? BigInt(body.sourcePlanId) : null,
        ...(previewUrl ? { previewUrl } : {}),
      },
    });

    res.status(201).json({
      id: Number(collection.id),
      name: collection.name,
      objectCount: collection.objectCount,
      summary: collection.summary,
      previewUrl: collection.previewUrl,
      createdAt: collection.createdAt.toISOString(),
    });
  })
);

collectionsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Collection not found.');
    const collection = await prisma.collection.findUnique({ where: { id } });
    if (!collection) throw ApiError.notFound('Collection not found.');
    if (collection.ownerId !== req.user!.id) {
      throw ApiError.forbidden('That collection belongs to someone else.');
    }
    res.json({ id: Number(collection.id), name: collection.name, objects: collection.objects });
  })
);

collectionsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Collection not found.');
    const collection = await prisma.collection.findUnique({ where: { id } });
    if (!collection) throw ApiError.notFound('Collection not found.');
    if (collection.ownerId !== req.user!.id) {
      throw ApiError.forbidden('That collection belongs to someone else.');
    }
    await prisma.collection.delete({ where: { id } });
    res.json({ ok: true });
  })
);
