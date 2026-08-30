/**
 * The AI spatial routes: concept, photo analysis, pro render and video.
 *
 * They mount alongside the original AI router rather than inside it, because
 * that file is already the home of three unrelated workflows and a fourth,
 * fifth and sixth would make it unreadable. Everything still runs through the
 * same job subsystem, so the credit, refund and cancellation guarantees are
 * identical — that is the whole reason `services/jobs.ts` exists.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  advise,
  generateConcept,
  migrateScene,
  parseBrief,
  takeoff,
  VIDEO_PRESETS,
  type ConceptBrief,
} from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { checkFeature } from '../services/access.js';
import { jobDto, registerHandler, startJob } from '../services/jobs.js';
import { imageEnhance, providerStatuses } from '../services/providers.js';
import { analysePhoto, runConcept, textModel, visionModel } from '../services/aiSpatial.js';
import { loadPlanForUser } from './plans.js';
import {
  createSession,
  discardSession,
  encodeSession,
  encoderStatus,
  frameCount,
  saveFrame,
} from '../services/videoRender.js';
import { uuid } from '../lib/ids.js';

export const aiSpatialRouter = Router();
aiSpatialRouter.use(requireAuth);

/* ── Handlers ──────────────────────────────────────────────────────────── */

/** Concept generator: a written brief becomes a placed layout. */
registerHandler('ai_concept', async (ctx) => {
  const prompt = String(ctx.input.prompt ?? '').trim();
  if (!prompt) throw ApiError.badRequest('Describe the event you want to build.');
  await ctx.report(25);

  const base = (ctx.input.base ?? {}) as Partial<ConceptBrief>;
  const result = await runConcept(prompt, base);
  await ctx.report(90);

  return result as unknown as Record<string, unknown>;
});

/** Photo analysis: a photograph becomes objects, matches and a suggested brief. */
registerHandler('photo_analysis', async (ctx) => {
  const imageDataUrl = String(ctx.input.imageDataUrl ?? '');
  if (!imageDataUrl.startsWith('data:image/')) {
    throw ApiError.badRequest('Upload a JPG, PNG or WebP photograph first.');
  }
  await ctx.report(20);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: ctx.userId },
    select: { id: true, companyId: true },
  });
  const analysis = await analysePhoto(imageDataUrl, { userId: user.id, companyId: user.companyId });
  await ctx.report(90);

  return analysis as unknown as Record<string, unknown>;
});

/**
 * Pro Render.
 *
 * Fast mode is the viewport, costs nothing and is what people work in. Pro is
 * this: a high-resolution frame handed to an image model with a prompt written
 * to preserve the geometry exactly and improve only materials, light and
 * realism.
 *
 * Being straight about what this is: it is a diffusion pass over a real render,
 * not a path tracer. The layout is exact because it comes from the viewport;
 * the realism is model-generated. That is the right trade for a client image,
 * and it is stated in the UI so nobody presents it as a physically accurate
 * lighting simulation.
 */
registerHandler('pro_render', async (ctx) => {
  const imageDataUrl = String(ctx.input.imageDataUrl ?? '');
  if (!imageDataUrl.startsWith('data:image/')) {
    throw ApiError.badRequest('No frame was supplied. Let the plan finish rendering, then try again.');
  }
  await ctx.report(10);

  const style = String(ctx.input.style ?? 'photoreal');
  const extra = String(ctx.input.prompt ?? '').trim();

  const styleDirection: Record<string, string> = {
    photoreal: 'Photographic realism, as though shot on a full-frame camera with a 24 mm tilt-shift lens. Natural contrast, no stylisation.',
    editorial: 'Editorial architectural photography. Deep shadows, controlled highlights, a single strong light direction.',
    'night-event': 'Night event photography. Practical lights are the light sources, deep ambient shadow, visible haze in the beams.',
    daylight: 'Bright neutral daylight through the roof, as an exhibition hall reads at midday. Flat, even, no drama.',
  };

  const prompt = imageEnhance.buildPrompt(
    [styleDirection[style] ?? styleDirection.photoreal, extra].filter(Boolean).join(' ')
  );

  await ctx.report(25);
  const result = await imageEnhance.enhance(imageDataUrl, prompt);
  await ctx.report(90);

  if (ctx.planId) {
    await prisma.aiRender.create({
      data: {
        planId: ctx.planId,
        jobId: ctx.jobId,
        prompt,
        model: `${result.model} (pro)`,
        mediaUrl: result.url,
        previewUrl: result.url,
      },
    });
  }

  return { imageUrl: result.url, provider: result.provider, model: result.model, style, prompt };
});

/** Video render: encode the frames the client uploaded into an MP4. */
registerHandler('video_render', async (ctx) => {
  const sessionId = String(ctx.input.sessionId ?? '');
  const fps = Number(ctx.input.fps ?? 30);
  const width = Number(ctx.input.width ?? 1920);
  const height = Number(ctx.input.height ?? 1080);
  const bitrateMbps = Number(ctx.input.bitrateMbps ?? 16);
  const audioPath = (ctx.input.audioPath as string | undefined) ?? null;

  const frames = await frameCount(sessionId);
  if (frames < 2) throw ApiError.badRequest('No frames were uploaded for this render.');
  await ctx.report(20);

  if (await ctx.isCancelled()) {
    await discardSession(sessionId);
    return { cancelled: true };
  }

  const result = await encodeSession(sessionId, { fps, width, height, bitrateMbps, audioPath });
  await ctx.report(95);

  if (ctx.planId) {
    await prisma.aiRender.create({
      data: {
        planId: ctx.planId,
        jobId: ctx.jobId,
        prompt: `Walkthrough, ${result.durationSeconds}s at ${width}×${height}`,
        model: 'ffmpeg/h264',
        mediaUrl: result.url,
        previewUrl: null,
      },
    });
  }

  return {
    videoUrl: result.url,
    durationSeconds: result.durationSeconds,
    frames: result.frames,
    sizeBytes: result.sizeBytes,
    width,
    height,
    fps,
  };
});

/**
 * Deck copy.
 *
 * The one part of a tender deck a model should write: the narrative. Every
 * number on the other slides is measured, and a model must never be allowed
 * near those — so this handler is given the facts and asked only for prose,
 * and it is told explicitly not to introduce figures of its own.
 */
registerHandler('deck_generation', async (ctx) => {
  const facts = (ctx.input.facts ?? {}) as Record<string, unknown>;
  const tone = String(ctx.input.tone ?? 'professional');
  await ctx.report(30);

  const system = `You write the narrative sections of an event tender document for a production agency.

Return ONLY a JSON object:
{ "concept": "2-4 sentences describing the experience and the design intent",
  "highlights": ["3 to 5 short phrases, each a reason this design wins"],
  "closing": "2 sentences on next steps" }

Rules:
- Never state a number, dimension, quantity or price. Those are measured elsewhere and yours would contradict them.
- Write about the guest experience and the design intent, not the equipment list.
- No superlatives that cannot be supported. No "world-class", no "state of the art".
- Tone: ${tone}.`;

  const result = await textModel.json(system, JSON.stringify(facts));
  await ctx.report(90);

  if (!result) {
    throw new ApiError(
      503,
      'PROVIDER_UNAVAILABLE',
      'Writing the copy needs a language model. Set OPENAI_API_KEY, or write the concept slide yourself — the rest of the deck is already generated.'
    );
  }

  return {
    concept: String(result.concept ?? ''),
    highlights: Array.isArray(result.highlights) ? (result.highlights as string[]).slice(0, 6) : [],
    closing: String(result.closing ?? ''),
  };
});

/* ── Capabilities ──────────────────────────────────────────────────────── */

aiSpatialRouter.get(
  '/spatial/capabilities',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const text = textModel.status();
    const vision = visionModel.status();
    const encoder = encoderStatus();
    const base = providerStatuses();

    const entries = await Promise.all(
      (['ai_concept', 'photo_analysis', 'pro_render', 'video_render', 'deck_generation'] as const).map(
        async (feature) => {
          const access = await checkFeature(user, feature);
          const provider =
            feature === 'photo_analysis'
              ? vision
              : feature === 'video_render'
                ? encoder
                : feature === 'pro_render'
                  ? base.ai_enhance
                  : text;

          /*
           * The concept generator is the exception: it works without a model,
           * using the built-in parser, so it is never reported unavailable for
           * want of a provider. Reporting it as blocked would hide a feature
           * that is sitting there working.
           */
          const providerAvailable = feature === 'ai_concept' ? true : provider.available;

          return [
            feature,
            {
              allowed: access.allowed && providerAvailable,
              reason: !providerAvailable ? ('reason' in provider ? provider.reason : undefined) : access.message,
              cost: access.cost,
              balance: access.balance,
              requiredTier: access.requiredTier,
              provider: provider.name,
              degraded: feature === 'ai_concept' && !text.available,
            },
          ] as const;
        }
      )
    );

    res.json({
      ...Object.fromEntries(entries),
      videoPresets: VIDEO_PRESETS,
    });
  })
);

/* ── Concept ───────────────────────────────────────────────────────────── */

/**
 * Preview a brief without spending anything.
 *
 * Pure arithmetic, so it is free and instant — the same reasoning as the venue
 * generator's free preview. Someone should be able to try five phrasings and
 * see the layout change before they decide to spend a credit on the model
 * reading it properly.
 */
aiSpatialRouter.post(
  '/concept/preview',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        prompt: z.string().trim().max(2000).default(''),
        base: z.record(z.unknown()).optional(),
      })
      .parse(req.body ?? {});

    const brief = parseBrief(body.prompt, (body.base ?? {}) as Partial<ConceptBrief>);
    const result = generateConcept(brief);
    res.json({
      ...result,
      interpreter: 'parser',
      interpreterNote:
        'Read by the built-in parser, free and instant. Run it through the language model for a looser description.',
    });
  })
);

aiSpatialRouter.post(
  '/concept',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        prompt: z.string().trim().min(3).max(2000),
        planId: z.number().int().positive().optional(),
        base: z.record(z.unknown()).optional(),
        idempotencyKey: z.string().max(80).optional(),
      })
      .parse(req.body);

    const job = await startJob({
      user: req.user!,
      feature: 'ai_concept',
      planId: body.planId ? BigInt(body.planId) : null,
      input: { prompt: body.prompt, base: body.base ?? {} },
      idempotencyKey: body.idempotencyKey,
      provider: textModel.status().name,
    });
    res.status(202).json(jobDto(job));
  })
);

/* ── Photo analysis ────────────────────────────────────────────────────── */

aiSpatialRouter.post(
  '/photo-analysis',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        imageDataUrl: z.string().min(64),
        planId: z.number().int().positive().optional(),
        sourceFilename: z.string().max(255).optional(),
        idempotencyKey: z.string().max(80).optional(),
      })
      .parse(req.body);

    const job = await startJob({
      user: req.user!,
      feature: 'photo_analysis',
      planId: body.planId ? BigInt(body.planId) : null,
      input: { imageDataUrl: body.imageDataUrl },
      idempotencyKey: body.idempotencyKey,
      provider: visionModel.status().name,
      sourceImageFilename: body.sourceFilename,
    });
    res.status(202).json(jobDto(job));
  })
);

/* ── Pro render ────────────────────────────────────────────────────────── */

aiSpatialRouter.post(
  '/pro-render',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        imageDataUrl: z.string().min(64),
        planId: z.number().int().positive().optional(),
        style: z.enum(['photoreal', 'editorial', 'night-event', 'daylight']).default('photoreal'),
        prompt: z.string().trim().max(600).optional(),
        idempotencyKey: z.string().max(80).optional(),
      })
      .parse(req.body);

    const job = await startJob({
      user: req.user!,
      feature: 'pro_render',
      planId: body.planId ? BigInt(body.planId) : null,
      input: { imageDataUrl: body.imageDataUrl, style: body.style, prompt: body.prompt },
      idempotencyKey: body.idempotencyKey,
      provider: imageEnhance.status().name,
    });
    res.status(202).json(jobDto(job));
  })
);

/* ── Video ─────────────────────────────────────────────────────────────── */

/**
 * Open a frame-upload session.
 *
 * Access is checked here rather than only at encode time, so someone without
 * the plan or the credits finds out before uploading six hundred 4K frames.
 */
aiSpatialRouter.post(
  '/video/session',
  asyncHandler(async (req, res) => {
    const body = z.object({ planId: z.number().int().positive() }).parse(req.body);
    await loadPlanForUser(req.user!, BigInt(body.planId));

    const access = await checkFeature(req.user!, 'video_render');
    if (!access.allowed) {
      throw access.reason === 'credits'
        ? ApiError.insufficientCredits(access.cost, access.balance)
        : ApiError.upgradeRequired(access.message ?? undefined);
    }

    const sessionId = uuid();
    await createSession(sessionId);
    res.status(201).json({ sessionId, cost: access.cost });
  })
);

aiSpatialRouter.post(
  '/video/:sessionId/frames',
  asyncHandler(async (req, res) => {
    const sessionId = String(req.params.sessionId);
    const body = z
      .object({
        frames: z
          .array(z.object({ index: z.number().int().min(0).max(100_000), dataUrl: z.string().min(64) }))
          // Batched, because one request per frame at 30 fps is 900 requests
          // for a 30-second video and the round trips dominate.
          .min(1)
          .max(20),
      })
      .parse(req.body);

    for (const frame of body.frames) {
      await saveFrame(sessionId, frame.index, frame.dataUrl);
    }
    res.json({ ok: true, received: body.frames.length, total: await frameCount(sessionId) });
  })
);

aiSpatialRouter.post(
  '/video/render',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        sessionId: z.string().min(8).max(64),
        planId: z.number().int().positive(),
        fps: z.number().int().min(12).max(60).default(30),
        width: z.number().int().min(320).max(4096).default(1920),
        height: z.number().int().min(320).max(4096).default(1080),
        bitrateMbps: z.number().min(1).max(80).default(16),
        audioUrl: z.string().max(512).optional(),
        idempotencyKey: z.string().max(80).optional(),
      })
      .parse(req.body);

    await loadPlanForUser(req.user!, BigInt(body.planId));

    /*
     * An uploaded audio bed is resolved to a path here rather than in the
     * handler, so a URL pointing anywhere other than our own upload area never
     * reaches ffmpeg's input list.
     */
    let audioPath: string | null = null;
    if (body.audioUrl) {
      const relative = body.audioUrl.split('/static/uploads/')[1];
      if (!relative || relative.includes('..')) {
        throw ApiError.badRequest('The audio track must be a file uploaded to this workspace.');
      }
      const { default: path } = await import('node:path');
      const { env } = await import('../lib/env.js');
      audioPath = path.join(env.uploadDir, relative);
    }

    const job = await startJob({
      user: req.user!,
      feature: 'video_render',
      planId: BigInt(body.planId),
      input: {
        sessionId: body.sessionId,
        fps: body.fps,
        width: body.width,
        height: body.height,
        bitrateMbps: body.bitrateMbps,
        audioPath,
      },
      idempotencyKey: body.idempotencyKey,
      provider: 'ffmpeg',
    });
    res.status(202).json(jobDto(job));
  })
);

aiSpatialRouter.delete(
  '/video/:sessionId',
  asyncHandler(async (req, res) => {
    await discardSession(String(req.params.sessionId));
    res.json({ ok: true });
  })
);

/* ── Deck copy ─────────────────────────────────────────────────────────── */

aiSpatialRouter.post(
  '/deck-copy',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        planId: z.number().int().positive(),
        clientName: z.string().trim().max(180).optional(),
        eventName: z.string().trim().max(180).optional(),
        tone: z.enum(['professional', 'warm', 'bold', 'technical']).default('professional'),
        idempotencyKey: z.string().max(80).optional(),
      })
      .parse(req.body);

    const planId = BigInt(body.planId);
    const plan = await loadPlanForUser(req.user!, planId);
    const sceneRow = await prisma.planScene.findUnique({ where: { planId } });
    const scene = migrateScene(sceneRow?.scene);
    const measured = takeoff(scene);
    const advisor = advise(scene);

    /*
     * The facts handed to the model. Deliberately descriptive rather than
     * numeric — it is told not to state numbers, so giving it a list of them
     * would only invite the failure this design avoids.
     */
    const facts = {
      planTitle: plan.title,
      clientName: body.clientName ?? '',
      eventName: body.eventName ?? '',
      hasStage: scene.objects.some((o) => o.type === 'stage'),
      hasScreen: scene.objects.some((o) => o.type === 'led'),
      hasTruss: scene.objects.some((o) => o.type === 'truss'),
      hasBooths: measured.summary.boothCount > 0,
      seated: measured.summary.seatCount > 0,
      lightingLook: scene.render.look,
      scale: measured.summary.floorAreaSqM > 800 ? 'large' : measured.summary.floorAreaSqM > 200 ? 'medium' : 'intimate',
      designScore: advisor.score,
    };

    const job = await startJob({
      user: req.user!,
      feature: 'deck_generation',
      planId,
      input: { facts, tone: body.tone },
      idempotencyKey: body.idempotencyKey,
      provider: textModel.status().name,
    });
    res.status(202).json(jobDto(job));
  })
);

/* ── Render history for a plan ─────────────────────────────────────────── */

aiSpatialRouter.get(
  '/plans/:id/media',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    await loadPlanForUser(req.user!, id);

    const rows = await prisma.aiRender.findMany({
      where: { planId: id },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });

    res.json({
      images: rows
        .filter((r) => !r.mediaUrl.endsWith('.mp4'))
        .map((r) => ({ id: Number(r.id), url: r.mediaUrl, model: r.model, prompt: r.prompt, createdAt: r.createdAt.toISOString() })),
      videos: rows
        .filter((r) => r.mediaUrl.endsWith('.mp4'))
        .map((r) => ({ id: Number(r.id), url: r.mediaUrl, model: r.model, prompt: r.prompt, createdAt: r.createdAt.toISOString() })),
    });
  })
);
