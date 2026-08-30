import { Router } from 'express';
import { z } from 'zod';
import path from 'node:path';
import { segmentsFromRun, type WallPoint } from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { checkFeature } from '../services/access.js';
import { cancelJob, getJob, jobDto, listJobs, registerHandler, startJob } from '../services/jobs.js';
import { imageEnhance, imageTo3d, mirror, providerStatuses } from '../services/providers.js';
import { traceWalls } from '../services/floorPlanTrace.js';
import { saveAssetBuffer } from '../services/storage.js';
import { env } from '../lib/env.js';
import { inspectGltfFile, inferScale } from '../services/gltfInspect.js';

export const aiRouter = Router();
aiRouter.use(requireAuth);

/* ── Handlers ──────────────────────────────────────────────────────────── */

/** AI Enhance: photoreal render of the current view. */
registerHandler('ai_enhance', async (ctx) => {
  const imageDataUrl = String(ctx.input.imageDataUrl ?? '');
  if (!imageDataUrl.startsWith('data:image/')) {
    throw ApiError.badRequest('No canvas image was supplied. Make sure the plan has rendered.');
  }
  await ctx.report(15);

  const prompt = imageEnhance.buildPrompt(ctx.input.prompt as string | undefined);
  const result = await imageEnhance.enhance(imageDataUrl, prompt);
  await ctx.report(90);

  // Record it against the plan so the AI Renders panel can show a history.
  if (ctx.planId) {
    await prisma.aiRender.create({
      data: {
        planId: ctx.planId,
        jobId: ctx.jobId,
        prompt,
        model: result.model,
        mediaUrl: result.url,
        previewUrl: result.url,
      },
    });
  }

  return { imageUrl: result.url, provider: result.provider, model: result.model, prompt };
});

/** Image to 3D: a photograph becomes a catalogue-ready mesh. */
registerHandler('ai_image_to_3d', async (ctx) => {
  const imageDataUrl = String(ctx.input.imageDataUrl ?? '');
  if (!imageDataUrl.startsWith('data:image/')) {
    throw ApiError.badRequest('Upload a JPG, PNG or WebP image first.');
  }

  const taskId = await imageTo3d.start(imageDataUrl, { pbr: Boolean(ctx.input.pbr) });
  await ctx.report(10);

  const deadline = Date.now() + 10 * 60_000;
  let modelUrl: string | undefined;
  while (Date.now() < deadline) {
    if (await ctx.isCancelled()) return { cancelled: true };
    await new Promise((r) => setTimeout(r, 5000));
    const status = await imageTo3d.poll(taskId);
    await ctx.report(10 + Math.min(80, status.progress * 0.8));
    if (status.modelUrl) {
      modelUrl = status.modelUrl;
      break;
    }
    if (status.status === 'failed' || status.status === 'banned') {
      throw new ApiError(502, 'PROVIDER_ERROR', 'The model could not be generated from that image.');
    }
  }
  if (!modelUrl) throw new ApiError(504, 'PROVIDER_TIMEOUT', 'Generation took too long.');

  // Mirror it, then measure it — a generated mesh arrives at an arbitrary scale
  // and the catalogue only accepts correctly sized items.
  const localUrl = await mirror(modelUrl, 'generated');
  const relative = localUrl.split('/static/assets/')[1] ?? '';
  const facts = await inspectGltfFile(path.join(env.assetDir, relative));
  const scale = inferScale(facts);

  await ctx.report(98);
  return {
    modelUrl: localUrl,
    providerTaskId: taskId,
    triangleCount: facts.triangleCount,
    materialNames: facts.materialNames,
    // Reported so the operator can set a real target height before saving.
    detectedHeightMm: scale.sizeMm.height,
    detectedWidthMm: scale.sizeMm.width,
    detectedDepthMm: scale.sizeMm.depth,
  };
});

/** Floor Plan AI Draw: trace walls from a calibrated drawing. */
registerHandler('floor_plan_ai_draw', async (ctx) => {
  const imageUrl = String(ctx.input.imageUrl ?? '');
  const mmPerPixel = Number(ctx.input.mmPerPixel ?? 0);
  if (!imageUrl || !Number.isFinite(mmPerPixel) || mmPerPixel <= 0) {
    throw ApiError.badRequest('Calibrate the floor plan before tracing it.');
  }
  if (/\.svg($|\?)/i.test(imageUrl)) {
    throw ApiError.badRequest('Tracing needs a raster image. Re-export the drawing as PNG or JPG.');
  }

  await ctx.report(20);

  // The image is on our own storage; resolve it back to a path.
  const uploadsRelative = imageUrl.split('/static/uploads/')[1];
  const assetsRelative = imageUrl.split('/static/assets/')[1];
  const filePath = uploadsRelative
    ? path.join(env.uploadDir, uploadsRelative)
    : assetsRelative
      ? path.join(env.assetDir, assetsRelative)
      : null;
  if (!filePath) throw ApiError.badRequest('That image is not available on this server.');

  const result = await traceWalls(filePath, { mmPerPixel });
  await ctx.report(85);

  if (!result.walls.length) {
    throw new ApiError(
      422,
      'NO_WALLS_FOUND',
      result.diagnostics.note ?? 'No usable wall segments were found. Trace them manually instead.'
    );
  }

  // Emit segments in the scene's own shape so the client can merge them directly.
  const segments = result.walls.flatMap((wall) =>
    segmentsFromRun([wall.start as WallPoint, wall.end as WallPoint])
  );

  return { segments, count: segments.length, diagnostics: result.diagnostics };
});

/* ── Routes ────────────────────────────────────────────────────────────── */

/** What is available, and what it will cost — asked before any run. */
aiRouter.get(
  '/capabilities',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const providers = providerStatuses();
    const features = await Promise.all(
      (['ai_enhance', 'ai_image_to_3d', 'floor_plan_ai_draw'] as const).map(async (feature) => {
        const access = await checkFeature(user, feature);
        const provider = providers[feature];
        return [
          feature,
          {
            allowed: access.allowed && provider.available,
            reason: !provider.available ? provider.reason : access.message,
            cost: access.cost,
            balance: access.balance,
            requiredTier: access.requiredTier,
            provider: provider.name,
          },
        ] as const;
      })
    );
    res.json(Object.fromEntries(features));
  })
);

const enhanceBody = z.object({
  planId: z.number().int().positive().optional(),
  imageDataUrl: z.string().min(64),
  prompt: z.string().trim().max(600).optional(),
  idempotencyKey: z.string().max(80).optional(),
});

aiRouter.post(
  '/enhance',
  asyncHandler(async (req, res) => {
    const body = enhanceBody.parse(req.body);
    const job = await startJob({
      user: req.user!,
      feature: 'ai_enhance',
      planId: body.planId ? BigInt(body.planId) : null,
      input: { imageDataUrl: body.imageDataUrl, prompt: body.prompt },
      idempotencyKey: body.idempotencyKey,
      provider: imageEnhance.status().name,
    });
    res.status(202).json(jobDto(job));
  })
);

const imageTo3dBody = z.object({
  imageDataUrl: z.string().min(64),
  pbr: z.boolean().optional(),
  idempotencyKey: z.string().max(80).optional(),
  sourceFilename: z.string().max(255).optional(),
});

aiRouter.post(
  '/image-to-3d',
  asyncHandler(async (req, res) => {
    const body = imageTo3dBody.parse(req.body);
    const job = await startJob({
      user: req.user!,
      feature: 'ai_image_to_3d',
      input: { imageDataUrl: body.imageDataUrl, pbr: body.pbr ?? false },
      idempotencyKey: body.idempotencyKey,
      provider: imageTo3d.status().name,
      sourceImageFilename: body.sourceFilename,
    });
    res.status(202).json(jobDto(job));
  })
);

const traceBody = z.object({
  planId: z.number().int().positive(),
  imageUrl: z.string().url().or(z.string().startsWith('/')),
  mmPerPixel: z.number().positive(),
  idempotencyKey: z.string().max(80).optional(),
});

aiRouter.post(
  '/trace-walls',
  asyncHandler(async (req, res) => {
    const body = traceBody.parse(req.body);
    const job = await startJob({
      user: req.user!,
      feature: 'floor_plan_ai_draw',
      planId: BigInt(body.planId),
      input: { imageUrl: body.imageUrl, mmPerPixel: body.mmPerPixel },
      idempotencyKey: body.idempotencyKey,
      provider: 'Novira (local)',
    });
    res.status(202).json(jobDto(job));
  })
);

aiRouter.get(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const job = await getJob(req.user!, String(req.params.id));
    res.json(jobDto(job));
  })
);

aiRouter.post(
  '/jobs/:id/cancel',
  asyncHandler(async (req, res) => {
    const job = await cancelJob(req.user!, String(req.params.id));
    res.json(jobDto(job));
  })
);

aiRouter.get(
  '/jobs',
  asyncHandler(async (req, res) => {
    const feature = req.query.feature as never;
    const jobs = await listJobs(req.user!, feature, 40);
    res.json({ items: jobs.map(jobDto) });
  })
);

/** AI Enhance history for one plan. */
aiRouter.get(
  '/plans/:id/renders',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    const { loadPlanForUser } = await import('./plans.js');
    await loadPlanForUser(req.user!, id);
    const renders = await prisma.aiRender.findMany({
      where: { planId: id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    res.json({
      items: renders.map((r) => ({
        id: Number(r.id),
        jobId: r.jobId,
        prompt: r.prompt,
        model: r.model,
        mediaUrl: r.mediaUrl,
        previewUrl: r.previewUrl,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  })
);

/** Save a generated mesh into the catalogue at a real-world size. */
const saveToCatalogBody = z.object({
  jobId: z.string().uuid(),
  name: z.string().trim().min(1).max(180),
  description: z.string().trim().max(2000),
  categorySlug: z.string().trim().min(1),
  targetHeightMm: z.number().positive().max(30_000),
  scope: z.enum(['personal', 'company', 'global']).default('personal'),
});

aiRouter.post(
  '/save-to-catalog',
  asyncHandler(async (req, res) => {
    const body = saveToCatalogBody.parse(req.body);
    const user = req.user!;
    const job = await getJob(user, body.jobId);

    if (job.status !== 'completed') throw ApiError.badRequest('That generation has not finished.');
    const output = (job.outputPayload as Record<string, unknown>) ?? {};
    const modelUrl = String(output.modelUrl ?? '');
    if (!modelUrl) throw ApiError.badRequest('That generation produced no model.');

    if (body.scope === 'global' && user.role !== 'super_admin') {
      throw ApiError.forbidden('Only an administrator can publish to the global library.');
    }
    if (body.scope === 'company' && !user.companyId) {
      throw ApiError.badRequest('You are not part of a company workspace.');
    }

    const category = await prisma.catalogCategory.findUnique({ where: { slug: body.categorySlug } });
    if (!category) throw ApiError.badRequest('Choose a valid category.');

    /*
     * Scale the recorded dimensions to the height the operator specifies.
     * A generated mesh has no inherent size, so this is the step that makes it
     * usable in a to-scale plan — and why the catalogue asks for it.
     */
    const detectedHeight = Number(output.detectedHeightMm ?? 0) || 1;
    const factor = body.targetHeightMm / detectedHeight;
    const widthMm = Math.round(Number(output.detectedWidthMm ?? 0) * factor) || null;
    const depthMm = Math.round(Number(output.detectedDepthMm ?? 0) * factor) || null;

    const item = await prisma.catalogItem.create({
      data: {
        categoryId: category.id,
        companyId: body.scope === 'company' ? user.companyId : null,
        ownerId: body.scope === 'personal' ? user.id : null,
        scope: body.scope,
        name: body.name,
        description: body.description,
        modelUrl,
        widthMm,
        depthMm,
        heightMm: Math.round(body.targetHeightMm),
        triangleCount: Number(output.triangleCount ?? 0) || null,
        sourceKey: 'ai_image_to_3d',
        sourceLabel: 'Generated',
        sourceAssetId: job.id,
        license: 'Generated by the account holder',
        attribution: null,
        // Generated meshes go to review rather than straight into the library.
        reviewStatus: body.scope === 'personal' ? 'approved' : 'pending',
        verifiedAt: new Date(),
        verificationScore: null,
        verificationNotes: JSON.parse(
          JSON.stringify({
            verdict: 'generated',
            summary: `Scaled to a stated height of ${Math.round(body.targetHeightMm)} mm (×${factor.toFixed(3)} from the generated mesh).`,
            detected: {
              heightMm: output.detectedHeightMm,
              widthMm: output.detectedWidthMm,
              depthMm: output.detectedDepthMm,
            },
          })
        ),
      },
    });

    res.status(201).json({ id: Number(item.id), name: item.name, scope: item.scope });
  })
);
