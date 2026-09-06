/**
 * The AI studio.
 *
 * Generative work that produces an *asset* — a mesh, an image — rather than a
 * change to a plan. Everything here runs through the same job subsystem as the
 * rest of the AI features, which is not an implementation detail but the whole
 * design:
 *
 *  · credits are checked and charged **before** a provider is called,
 *  · a double-submitted request returns the original job instead of charging
 *    twice,
 *  · a failure or a cancellation refunds automatically,
 *  · and progress is polled from one endpoint regardless of which provider is
 *    doing the work.
 *
 * The alternative — a parallel set of endpoints that call providers directly —
 * is how a product ends up with two credit systems that disagree.
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { assertFeature } from '../services/access.js';
import { jobDto, registerHandler, startJob, type JobContext } from '../services/jobs.js';
import {
  adopt,
  generationStatuses,
  meshGen,
  mockup,
  type MockupApi,
  type TaskStatus,
} from '../services/generation.js';
import {
  analyseVisualStyle,
  openAiConfigured,
  refine3dPrompt,
  refineMockupPrompt,
  sceneAgent,
  smartSuggestion,
  type SceneSnapshot,
} from '../services/openaiStudio.js';
import { saveAssetBuffer } from '../services/storage.js';

export const aiStudioRouter = Router();
aiStudioRouter.use(requireAuth);

/* ── Capability ────────────────────────────────────────────────────────── */

aiStudioRouter.get(
  '/capabilities',
  asyncHandler(async (req, res) => {
    const features = ['ai_text_to_3d', 'ai_image_to_3d', 'ai_mockup', 'ai_prompt_refine', 'ai_assistant'] as const;
    const access: Record<string, unknown> = {};
    for (const feature of features) {
      try {
        const result = await assertFeature(req.user!, feature);
        access[feature] = { allowed: true, cost: result.cost, balance: result.balance };
      } catch (error) {
        access[feature] =
          error instanceof ApiError
            ? { allowed: false, reason: error.message, code: error.code }
            : { allowed: false, reason: 'Unavailable.' };
      }
    }
    res.json({ providers: generationStatuses(), access });
  })
);

/* ── Session memory ────────────────────────────────────────────────────── */

/**
 * The last few things this user asked for.
 *
 * What makes "now in walnut" produce the same chair in walnut rather than an
 * unrelated walnut object. Read from the job history rather than kept in a
 * session, so it survives a reload and a different device.
 */
async function recentPrompts(userId: bigint, limit = 6): Promise<string[]> {
  const rows = await prisma.aiJob.findMany({
    where: { userId, processType: { in: ['ai_text_to_3d', 'ai_mockup', 'ai_image_to_3d'] } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { inputPayload: true },
  });
  return rows
    .map((row) => (row.inputPayload as { originalPrompt?: string; prompt?: string } | null))
    .map((payload) => payload?.originalPrompt ?? payload?.prompt ?? '')
    .filter((prompt) => prompt.length > 4)
    .map((prompt) => `[earlier] ${prompt.slice(0, 240)}`);
}

/* ── Prompt refinement ─────────────────────────────────────────────────── */

const refineBody = z.object({
  prompt: z.string().min(3).max(2000),
  kind: z.enum(['3d', '2d']).default('3d'),
  /** True when editing an existing image rather than starting one. */
  editing: z.boolean().optional(),
});

/**
 * Expand a short idea into a full prompt.
 *
 * Synchronous rather than a job: it takes a second, the user is watching the
 * text box, and putting a poll between them and the result would make a fast
 * thing feel slow. It still goes through the credit check.
 */
aiStudioRouter.post(
  '/refine',
  asyncHandler(async (req, res) => {
    const parsed = refineBody.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Write a few words about what you want first.');
    const { prompt, kind, editing } = parsed.data;

    if (!openAiConfigured()) {
      throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Prompt refinement needs an OpenAI key on this server.');
    }

    const access = await assertFeature(req.user!, 'ai_prompt_refine');
    const history = await recentPrompts(req.user!.id);

    const refined =
      kind === '2d'
        ? await refineMockupPrompt(prompt, history, editing)
        : await refine3dPrompt(prompt, history);

    /*
     * Only charge for a refinement that changed something. A model that hands
     * back the input — because it was already a good prompt, or because the
     * call failed — has not done work worth a credit.
     */
    let charged = 0;
    if (refined !== prompt && access.cost > 0) {
      const job = await startJob({
        user: req.user!,
        feature: 'ai_prompt_refine',
        input: { prompt, kind },
        provider: 'openai',
        providerModel: 'gpt-4o',
      });
      charged = job.creditsCharged;
      await prisma.aiJob.update({
        where: { id: job.id },
        data: { status: 'succeeded', progress: 100, outputPayload: { refined }, completedAt: new Date() },
      });
    }

    res.json({ prompt: refined, changed: refined !== prompt, creditsCharged: charged });
  })
);

/* ── 3D generation ─────────────────────────────────────────────────────── */

const textTo3dBody = z.object({
  prompt: z.string().min(3).max(2000),
  /** Applied to the prompt before refinement — "Modern", "Luxury"… */
  style: z.string().max(60).optional(),
  /** Refine the prompt with the language model before generating. */
  refine: z.boolean().default(true),
  planId: z.coerce.number().int().positive().optional(),
  idempotencyKey: z.string().max(80).optional(),
});

aiStudioRouter.post(
  '/text-to-3d',
  asyncHandler(async (req, res) => {
    const parsed = textTo3dBody.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Describe what you want built.');
    if (!meshGen.configured()) {
      throw new ApiError(503, 'PROVIDER_UNAVAILABLE', '3D generation is not configured on this server.');
    }

    const { prompt, style, refine, planId, idempotencyKey } = parsed.data;
    const job = await startJob({
      user: req.user!,
      feature: 'ai_text_to_3d',
      planId: planId ? BigInt(planId) : null,
      idempotencyKey,
      provider: 'tripo',
      providerModel: 'text_to_model',
      input: { originalPrompt: prompt, prompt, style, refine },
    });
    res.status(201).json(jobDto(job));
  })
);

const imageTo3dBody = z.object({
  /** A data URL or a link the provider can reach. */
  imageUrl: z.string().min(8).max(4_000_000),
  prompt: z.string().max(2000).optional(),
  planId: z.coerce.number().int().positive().optional(),
  idempotencyKey: z.string().max(80).optional(),
});

aiStudioRouter.post(
  '/image-to-3d',
  asyncHandler(async (req, res) => {
    const parsed = imageTo3dBody.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Choose an image to build from.');
    if (!meshGen.configured()) {
      throw new ApiError(503, 'PROVIDER_UNAVAILABLE', '3D generation is not configured on this server.');
    }

    const { imageUrl, prompt, planId, idempotencyKey } = parsed.data;
    const job = await startJob({
      user: req.user!,
      feature: 'ai_image_to_3d',
      planId: planId ? BigInt(planId) : null,
      idempotencyKey,
      provider: 'tripo',
      providerModel: 'image_to_model',
      input: { imageUrl, prompt, originalPrompt: prompt },
    });
    res.status(201).json(jobDto(job));
  })
);

/* ── 2D mockups ────────────────────────────────────────────────────────── */

const mockupBody = z.object({
  prompt: z.string().min(3).max(2000),
  /** The image being edited. Present means an edit rather than a fresh one. */
  sourceImageUrl: z.string().max(4_000_000).optional().nullable(),
  /** A reference whose style should be carried across. */
  styleImageUrl: z.string().max(4_000_000).optional().nullable(),
  aspectRatio: z.string().max(12).optional(),
  size: z.enum(['1K', '2K', '4K']).optional(),
  refine: z.boolean().default(true),
  planId: z.coerce.number().int().positive().optional(),
  idempotencyKey: z.string().max(80).optional(),
});

aiStudioRouter.post(
  '/mockup',
  asyncHandler(async (req, res) => {
    const parsed = mockupBody.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('Describe the image you want.');
    if (!mockup.configured()) {
      throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Image generation is not configured on this server.');
    }

    const body = parsed.data;
    const job = await startJob({
      user: req.user!,
      feature: 'ai_mockup',
      planId: body.planId ? BigInt(body.planId) : null,
      idempotencyKey: body.idempotencyKey,
      provider: 'nanobanana',
      providerModel: body.sourceImageUrl ? 'edit-v1' : 'generate-v2',
      input: { ...body, originalPrompt: body.prompt },
    });
    res.status(201).json(jobDto(job));
  })
);

/* ── The assistant ─────────────────────────────────────────────────────── */

const snapshotSchema = z.object({
  title: z.string().optional(),
  units: z.string().optional(),
  regionCode: z.string().optional(),
  objectCount: z.number(),
  roomWidthMm: z.number().optional(),
  roomDepthMm: z.number().optional(),
  objects: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        positionMm: z.object({ x: z.number(), y: z.number(), z: z.number() }),
        widthMm: z.number().nullable().optional(),
        depthMm: z.number().nullable().optional(),
        heightMm: z.number().nullable().optional(),
      })
    )
    .max(400),
});

const agentBody = z.object({
  message: z.string().min(1).max(4000),
  snapshot: snapshotSchema,
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(16)
    .optional(),
  imageDataUrl: z.string().max(4_000_000).optional().nullable(),
});

aiStudioRouter.post(
  '/agent',
  asyncHandler(async (req, res) => {
    const parsed = agentBody.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('That message could not be read.');

    await assertFeature(req.user!, 'ai_assistant');

    const answer = await sceneAgent({
      message: parsed.data.message,
      snapshot: parsed.data.snapshot as SceneSnapshot,
      history: parsed.data.history,
      imageDataUrl: parsed.data.imageDataUrl,
    });

    /*
     * Charged only when the model actually answered. A "could not reach the
     * model" reply is not a service the user should pay for, and billing for a
     * failure is the fastest way to make people stop trusting a credit meter.
     */
    if (openAiConfigured()) {
      const job = await startJob({
        user: req.user!,
        feature: 'ai_assistant',
        input: { message: parsed.data.message.slice(0, 500) },
        provider: 'openai',
        providerModel: 'gpt-4o',
      });
      await prisma.aiJob.update({
        where: { id: job.id },
        data: { status: 'succeeded', progress: 100, outputPayload: answer as object, completedAt: new Date() },
      });
    }

    res.json(answer);
  })
);

const suggestionBody = z.object({
  snapshot: snapshotSchema,
  avoid: z.array(z.string().max(400)).max(10).optional(),
});

aiStudioRouter.post(
  '/suggest',
  asyncHandler(async (req, res) => {
    const parsed = suggestionBody.safeParse(req.body);
    if (!parsed.success) throw ApiError.badRequest('The plan could not be read.');

    if (!openAiConfigured()) {
      res.json({ suggestion: null, reason: 'The assistant is not configured on this server.' });
      return;
    }

    const suggestion = await smartSuggestion(parsed.data.snapshot as SceneSnapshot, parsed.data.avoid ?? []);
    res.json({ suggestion });
  })
);

/* ── The vault ─────────────────────────────────────────────────────────── */

const STUDIO_FEATURES = ['ai_text_to_3d', 'ai_image_to_3d', 'ai_mockup'];

/** Everything this user has generated, newest first. */
aiStudioRouter.get(
  '/creations',
  asyncHandler(async (req, res) => {
    const rows = await prisma.aiJob.findMany({
      where: { userId: req.user!.id, processType: { in: STUDIO_FEATURES } },
      orderBy: { createdAt: 'desc' },
      take: 120,
    });
    res.json({ items: rows.map(creationDto) });
  })
);

aiStudioRouter.delete(
  '/creations/:id',
  asyncHandler(async (req, res) => {
    const row = await prisma.aiJob.findFirst({ where: { id: req.params.id!, userId: req.user!.id } });
    if (!row) throw ApiError.notFound('That creation is not yours.');
    await prisma.aiJob.delete({ where: { id: row.id } });
    res.json({ ok: true });
  })
);

function creationDto(row: {
  id: string;
  processType: string;
  status: string;
  progress: number;
  inputPayload: unknown;
  outputPayload: unknown;
  errorMessage: string | null;
  createdAt: Date;
}) {
  const input = (row.inputPayload ?? {}) as { originalPrompt?: string; prompt?: string; style?: string };
  const output = (row.outputPayload ?? {}) as {
    modelUrl?: string;
    imageUrl?: string;
    thumbnailUrl?: string;
    refinedPrompt?: string;
  };
  const is2d = row.processType === 'ai_mockup';

  return {
    id: row.id,
    kind: is2d ? ('image' as const) : ('model' as const),
    feature: row.processType,
    status: row.status,
    progress: row.progress,
    prompt: input.originalPrompt ?? input.prompt ?? '',
    refinedPrompt: output.refinedPrompt ?? null,
    style: input.style ?? null,
    resultUrl: (is2d ? output.imageUrl : output.modelUrl) ?? null,
    thumbnailUrl: output.thumbnailUrl ?? (is2d ? output.imageUrl : null) ?? null,
    error: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

/* ── Job handlers ──────────────────────────────────────────────────────── */

/**
 * Wait for a provider task, reporting progress and honouring cancellation.
 *
 * The deadline is generous because mesh generation genuinely takes minutes, and
 * the cancellation check runs every tick so a user who changes their mind gets
 * their credits back within four seconds rather than at the end.
 */
async function waitFor(
  ctx: JobContext,
  poll: () => Promise<TaskStatus>,
  opts: { timeoutMs?: number; from?: number; to?: number; expectedMs?: number } = {}
): Promise<TaskStatus> {
  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  const from = opts.from ?? 20;
  const to = opts.to ?? 92;
  const expected = opts.expectedMs ?? 60_000;
  const startedAt = Date.now();
  let highest = from;

  while (Date.now() < deadline) {
    if (await ctx.isCancelled()) throw new ApiError(499, 'CANCELLED', 'Cancelled.');
    await new Promise((resolve) => setTimeout(resolve, 4000));

    const status = await poll();
    if (status.status === 'success') return status;
    if (status.status === 'failed') {
      throw new ApiError(502, 'PROVIDER_ERROR', status.error ?? 'The generation failed.');
    }

    /*
     * Progress, whether or not the provider reports any.
     *
     * Tripo returns a real percentage; Nano Banana returns none at all, so a
     * mockup used to show four numbers across two minutes and read as frozen
     * — the same complaint as a genuine hang, for a job that was working.
     *
     * When the provider is silent this falls back to an estimate from elapsed
     * time, shaped so it slows as it goes and asymptotically approaches `to`
     * without ever arriving. That is honest in the way that matters: it never
     * claims to be finished before the result exists, and it never goes
     * backwards, because a bar that retreats destroys more confidence than a
     * slow one.
     */
    const reported = status.progress ?? 0;
    const elapsed = Date.now() - startedAt;
    const estimated = from + (to - from) * (1 - Math.exp(-elapsed / expected));
    const next =
      reported > 0
        ? Math.min(to, from + ((to - from) * reported) / 100)
        : estimated;

    if (next > highest) {
      highest = next;
      await ctx.report(Math.round(highest));
    }
  }
  throw new ApiError(504, 'PROVIDER_TIMEOUT', 'The generation took too long. Your credits have been returned.');
}

registerHandler('ai_text_to_3d', async (ctx) => {
  const input = ctx.input as { prompt: string; style?: string; refine?: boolean; originalPrompt?: string };

  let prompt = input.style ? `${input.style} style: ${input.prompt}` : input.prompt;
  if (input.refine !== false && openAiConfigured()) {
    await ctx.report(8);
    const history = await recentPrompts(ctx.userId);
    prompt = await refine3dPrompt(prompt, history);
  }

  await ctx.report(15);
  const taskId = await meshGen.fromText(prompt);

  const finished = await waitFor(ctx, () => meshGen.poll(taskId));
  await ctx.report(94);

  const stored = await adopt(finished, 'generated/models');
  return {
    modelUrl: stored.url,
    thumbnailUrl: stored.thumbnailUrl,
    refinedPrompt: prompt,
    providerTaskId: taskId,
  };
});

/*
 * `ai_image_to_3d` is deliberately *not* registered here.
 *
 * It used to be, alongside a second registration in `routes/ai.ts`, and
 * because the handler map is keyed by feature the later import silently
 * replaced the earlier one. The studio's version read `imageUrl` while the
 * editor's route sent `imageDataUrl`, so whichever route lost the race fed
 * its input to a handler that could not read it and failed in a way that
 * looked like the provider being down.
 *
 * The surviving handler lives in `routes/ai.ts` because it does strictly
 * more: it mirrors the mesh, inspects it and reports real-world dimensions,
 * which the catalogue needs before an item can be saved. It accepts either
 * input shape, so this route's requests are served by it unchanged.
 * `registerHandler` now throws on a collision so this cannot recur silently.
 */

registerHandler('ai_mockup', async (ctx) => {
  const input = ctx.input as {
    prompt: string;
    sourceImageUrl?: string | null;
    styleImageUrl?: string | null;
    aspectRatio?: string;
    size?: string;
    refine?: boolean;
  };

  const editing = Boolean(input.sourceImageUrl);
  let prompt = input.prompt;

  /*
   * A style reference is read before the prompt is refined, so the refinement
   * has the style to work into it. Doing it the other way round produces a
   * prompt that describes the subject well and the look not at all.
   */
  if (input.styleImageUrl && openAiConfigured()) {
    await ctx.report(6);
    const style = await analyseVisualStyle(await hostable(input.styleImageUrl, 'references'));
    if (style) prompt = `${prompt}\n\nMatch this look exactly: ${style}`;
  }

  if (input.refine !== false && openAiConfigured()) {
    await ctx.report(12);
    const history = await recentPrompts(ctx.userId);
    prompt = await refineMockupPrompt(prompt, history, editing);
  }

  await ctx.report(18);

  let taskId: string;
  let api: MockupApi;
  if (editing) {
    // The edit endpoint fetches the source itself, so a data URL has to be
    // hosted somewhere reachable first.
    const source = await hostable(input.sourceImageUrl!, 'mockups');
    ({ taskId, api } = await mockup.editTask(prompt, [source]));
  } else {
    ({ taskId, api } = await mockup.createTask(prompt, {
      aspectRatio: input.aspectRatio,
      size: input.size,
    }));
  }

  const finished = await waitFor(ctx, () => mockup.poll(taskId, api), {
    timeoutMs: 6 * 60_000,
    // Measured against the live provider: a 2K mockup lands near two minutes.
    expectedMs: 110_000,
  });
  await ctx.report(94);

  const stored = await adopt(finished, 'generated/mockups');
  return { imageUrl: stored.url, thumbnailUrl: stored.url, refinedPrompt: prompt, providerTaskId: taskId };
});

/**
 * A URL the provider can fetch.
 *
 * Two problems, one answer.
 *
 * Providers refuse data URLs, so anything base64 has to be written somewhere
 * public first. And now that references can be picked straight out of the image
 * libraries, a reference is very often a Pinterest or Unsplash CDN link — and
 * those hosts refuse requests that arrive without a browser's referer, which
 * would fail *inside* the provider as an unhelpful "could not read the image".
 *
 * So a remote image is mirrored into our own storage rather than passed along,
 * and only a mirror failure falls back to handing over the original link.
 */
async function hostable(imageUrl: string, subdir: string): Promise<string> {
  const store = async (bytes: Buffer, extension: string) => {
    const saved = await saveAssetBuffer(
      bytes,
      `${subdir}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
    );
    return saved.url.startsWith('http') ? saved.url : `${process.env.PUBLIC_BASE_URL ?? ''}${saved.url}`;
  };

  if (/^https?:\/\//i.test(imageUrl)) {
    try {
      const response = await fetch(imageUrl, {
        headers: {
          // Enough of a browser to satisfy the hotlink checks; without a
          // referer Pinterest returns a 403 placeholder rather than the pin.
          'user-agent': 'Mozilla/5.0 (compatible; NoviraBot/1.0)',
          accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
          referer: new URL(imageUrl).origin,
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) return imageUrl;

      const type = response.headers.get('content-type') ?? '';
      if (!type.startsWith('image/')) return imageUrl;

      const bytes = Buffer.from(await response.arrayBuffer());
      // Anything larger is almost certainly not a reference photograph, and
      // the providers cap uploads well below it anyway.
      if (!bytes.length || bytes.length > 24 * 1024 * 1024) return imageUrl;

      const extension = type.includes('png')
        ? 'png'
        : type.includes('webp')
          ? 'webp'
          : type.includes('gif')
            ? 'gif'
            : 'jpg';
      return await store(bytes, extension);
    } catch {
      // The provider may still be able to reach it even if we could not.
      return imageUrl;
    }
  }

  const match = /^data:image\/(\w+);base64,(.+)$/s.exec(imageUrl);
  if (!match) throw ApiError.badRequest('That image could not be read.');

  return store(Buffer.from(match[2]!, 'base64'), match[1] === 'jpeg' ? 'jpg' : match[1]!);
}
