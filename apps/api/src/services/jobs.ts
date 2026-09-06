/**
 * Asynchronous job subsystem.
 *
 * Every AI feature shares one lifecycle:
 *
 *   preflight (tier · role · company flag · credits)
 *     → accept an idempotency key
 *       → enqueue
 *         → poll status
 *           → deliver the artefact, or refund and fall back
 *
 * Building this once rather than four times is what makes the AI features
 * consistent: the same status vocabulary, the same refund guarantee, the same
 * operational reporting, and one place to fix a bug in any of it.
 *
 * The worker runs in-process here. That is deliberate for a single-node
 * deployment and is the seam to replace with a real queue — `enqueue` is the
 * only function that would change.
 */
import { randomUUID } from 'node:crypto';
import type { FeatureCode, JobStatus } from '@novira/shared';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { assertFeature } from './access.js';
import { debit, refund } from './credits.js';
import type { AuthedUser } from '../middleware/auth.js';

export interface JobContext {
  jobId: string;
  userId: bigint;
  planId: bigint | null;
  input: Record<string, unknown>;
  /** Report progress so the client's poll shows movement. */
  report: (progress: number) => Promise<void>;
  /** True once a cancellation has been requested. */
  isCancelled: () => Promise<boolean>;
}

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>;

const handlers = new Map<FeatureCode, JobHandler>();

export function registerHandler(feature: FeatureCode, handler: JobHandler) {
  /*
   * Two modules registering the same feature is a bug, not a configuration.
   *
   * `ai_image_to_3d` was registered in both `ai.ts` and `aiStudio.ts`, and
   * because this is a Map the later import silently won — so one of the two
   * HTTP routes fed its input to a handler that read a different field name,
   * got `undefined`, and failed in a way that looked like the provider was
   * down. A collision is now refused outright rather than resolved by import
   * order, which is not a decision anybody made.
   */
  if (handlers.has(feature)) {
    throw new Error(
      `Two handlers registered for "${feature}". Only one module may own a feature.`
    );
  }
  handlers.set(feature, handler);
}

export interface StartJobOptions {
  user: AuthedUser;
  feature: FeatureCode;
  input: Record<string, unknown>;
  planId?: bigint | null;
  projectId?: bigint | null;
  idempotencyKey?: string;
  provider?: string;
  providerModel?: string;
  sourceImageFilename?: string;
}

/**
 * Start a job.
 *
 * Credits are charged up front so a run cannot begin without them, and refunded
 * automatically if it fails or is cancelled. The idempotency key means a
 * double-submitted request returns the original job rather than charging twice.
 */
export async function startJob(options: StartJobOptions) {
  const { user, feature } = options;

  const access = await assertFeature(user, feature);

  const idempotencyKey = options.idempotencyKey || `${feature}-${randomUUID()}`;
  const existing = await prisma.aiJob.findUnique({
    where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
  });
  if (existing) return existing;

  const id = randomUUID();
  const job = await prisma.aiJob.create({
    data: {
      id,
      userId: user.id,
      companyId: user.companyId,
      planId: options.planId ?? null,
      projectId: options.projectId ?? null,
      processType: feature,
      provider: options.provider ?? null,
      providerModel: options.providerModel ?? null,
      status: 'queued',
      progress: 0,
      idempotencyKey,
      creditsCharged: 0,
      inputPayload: options.input as object,
      sourceImageFilename: options.sourceImageFilename ?? null,
    },
  });

  if (access.cost > 0) {
    const { charged } = await debit(user.id, feature, id, access.cost);
    await prisma.aiJob.update({ where: { id }, data: { creditsCharged: charged } });
  }

  // Run without blocking the response; the client polls for the result.
  void run(id).catch(() => {
    /* run() records its own failures */
  });

  return prisma.aiJob.findUniqueOrThrow({ where: { id } });
}

async function run(jobId: string) {
  const job = await prisma.aiJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== 'queued') return;

  const handler = handlers.get(job.processType as FeatureCode);
  if (!handler) {
    await fail(jobId, 'NO_HANDLER', 'That workflow is not available on this server.');
    return;
  }

  await prisma.aiJob.update({
    where: { id: jobId },
    data: { status: 'in_progress', progress: 5 },
  });

  const ctx: JobContext = {
    jobId,
    userId: job.userId,
    planId: job.planId,
    input: (job.inputPayload as Record<string, unknown>) ?? {},
    report: async (progress) => {
      await prisma.aiJob.update({
        where: { id: jobId },
        data: { progress: Math.max(0, Math.min(99, Math.round(progress))) },
      });
    },
    isCancelled: async () => {
      const row = await prisma.aiJob.findUnique({ where: { id: jobId }, select: { status: true } });
      return row?.status === 'cancelled';
    },
  };

  try {
    const output = await handler(ctx);

    // A cancellation that landed mid-run wins; the refund is already recorded.
    if (await ctx.isCancelled()) return;

    await prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        progress: 100,
        outputPayload: output as object,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    await fail(
      jobId,
      err instanceof ApiError ? String(err.code) : 'PROVIDER_ERROR',
      err instanceof Error ? err.message : 'The job failed.'
    );
  }
}

async function fail(jobId: string, code: string, message: string) {
  const job = await prisma.aiJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  await prisma.aiJob.update({
    where: { id: jobId },
    data: {
      status: 'failed',
      errorCode: code,
      errorMessage: message,
      completedAt: new Date(),
    },
  });

  // A failed run must not cost the user anything.
  if (job.creditsCharged > 0) {
    await refund(job.userId, jobId, job.creditsCharged, job.processType as FeatureCode);
  }
}

/** Cancel a queued or running job and return its credits. */
export async function cancelJob(user: AuthedUser, jobId: string) {
  const job = await prisma.aiJob.findUnique({ where: { id: jobId } });
  if (!job) throw ApiError.notFound('Job not found.');
  if (job.userId !== user.id && user.role !== 'super_admin') {
    throw ApiError.forbidden('That job belongs to someone else.');
  }
  if (job.status === 'completed' || job.status === 'cancelled') return job;

  await prisma.aiJob.update({
    where: { id: jobId },
    data: { status: 'cancelled', completedAt: new Date() },
  });

  if (job.creditsCharged > 0) {
    await refund(job.userId, jobId, job.creditsCharged, job.processType as FeatureCode);
  }

  return prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } });
}

export async function getJob(user: AuthedUser, jobId: string) {
  const job = await prisma.aiJob.findUnique({ where: { id: jobId } });
  if (!job) throw ApiError.notFound('Job not found.');
  if (job.userId !== user.id && user.role !== 'super_admin') {
    throw ApiError.forbidden('That job belongs to someone else.');
  }
  return job;
}

export function jobDto(job: {
  id: string;
  processType: string;
  status: string;
  progress: number;
  creditsCharged: number;
  provider: string | null;
  providerModel: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  outputPayload: unknown;
  createdAt: Date;
  completedAt: Date | null;
}) {
  return {
    id: job.id,
    processType: job.processType as FeatureCode,
    status: job.status as JobStatus,
    progress: job.progress,
    creditsCharged: job.creditsCharged,
    provider: job.provider,
    providerModel: job.providerModel,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    output: (job.outputPayload as Record<string, unknown> | null) ?? null,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

export async function listJobs(user: AuthedUser, feature?: FeatureCode, limit = 25) {
  return prisma.aiJob.findMany({
    where: { userId: user.id, ...(feature ? { processType: feature } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
