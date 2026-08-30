/**
 * Versions, comments and comparison.
 *
 * Half of this router is reachable without a session, and that is the point: a
 * client with a share link has to be able to leave a comment, or the whole
 * feature collapses back into email. So there are two entry paths to the same
 * data, and they differ in exactly one way — a share-token caller is a *client*
 * and never sees, writes or resolves an internal note.
 *
 * That rule is enforced in the query, not in the response mapping. Filtering
 * internal comments out after loading them is the version of this that
 * eventually leaks one.
 */
import { Router } from 'express';
import { z } from 'zod';
import { compareScenes, createEmptyScene, migrateScene, summariseComparison } from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthedUser } from '../middleware/auth.js';
import { loadPlanForUser } from './plans.js';
import { savePreviewImage } from '../services/storage.js';

export const reviewRouter = Router();
export const reviewPublicRouter = Router();

/* ── Serialisation ─────────────────────────────────────────────────────── */

interface CommentRow {
  id: bigint;
  planId: bigint;
  versionId: bigint | null;
  authorId: bigint | null;
  authorName: string;
  authorIsClient: boolean;
  body: string;
  visibility: string;
  status: string;
  anchor: unknown;
  resolvedAt: Date | null;
  resolvedByName: string | null;
  createdAt: Date;
  replies?: Array<{
    id: bigint;
    body: string;
    authorId: bigint | null;
    authorName: string;
    authorIsClient: boolean;
    createdAt: Date;
  }>;
}

function commentDto(row: CommentRow, versionLabel: string | null = null) {
  return {
    id: Number(row.id),
    planId: Number(row.planId),
    versionId: row.versionId ? Number(row.versionId) : null,
    versionLabel,
    anchor: row.anchor,
    body: row.body,
    visibility: row.visibility,
    status: row.status,
    authorName: row.authorName,
    authorUserId: row.authorId ? Number(row.authorId) : null,
    authorIsClient: row.authorIsClient,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedByName: row.resolvedByName,
    replies: (row.replies ?? []).map((r) => ({
      id: Number(r.id),
      body: r.body,
      authorName: r.authorName,
      authorUserId: r.authorId ? Number(r.authorId) : null,
      authorIsClient: r.authorIsClient,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

function versionDto(row: {
  id: bigint;
  planId: bigint;
  label: string;
  note: string | null;
  reason: string;
  objectCount: number;
  previewUrl: string | null;
  createdAt: Date;
  author?: { firstName: string; lastName: string; displayName: string | null } | null;
}) {
  const author = row.author;
  return {
    id: Number(row.id),
    planId: Number(row.planId),
    label: row.label,
    note: row.note,
    reason: row.reason,
    objectCount: row.objectCount,
    previewUrl: row.previewUrl,
    authorName: author ? author.displayName || `${author.firstName} ${author.lastName}`.trim() : 'Unknown',
    createdAt: row.createdAt.toISOString(),
  };
}

/* ── Versions (authenticated) ──────────────────────────────────────────── */

reviewRouter.use(requireAuth);

reviewRouter.get(
  '/plans/:id/versions',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    await loadPlanForUser(req.user!, id);

    const rows = await prisma.planVersion.findMany({
      where: { planId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { author: { select: { firstName: true, lastName: true, displayName: true } } },
    });
    res.json({ items: rows.map((r) => versionDto(r)) });
  })
);

const createVersionBody = z.object({
  label: z.string().trim().min(1).max(180),
  note: z.string().trim().max(2000).optional(),
  reason: z.enum(['manual', 'milestone', 'before_ai', 'before_restore', 'shared', 'auto']).default('manual'),
  /** Snapshot the scene the client currently holds, rather than the saved one. */
  scene: z.unknown().optional(),
  previewDataUrl: z.string().optional(),
});

/**
 * Save a version.
 *
 * The scene may be supplied by the client so a snapshot captures unsaved work —
 * "save a version before I try something" is the whole reason people press it,
 * and taking the last autosave instead would silently miss the last few edits.
 */
reviewRouter.post(
  '/plans/:id/versions',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    await loadPlanForUser(req.user!, id);
    const body = createVersionBody.parse(req.body);

    const scene = body.scene
      ? migrateScene(body.scene)
      : migrateScene((await prisma.planScene.findUnique({ where: { planId: id } }))?.scene);

    let previewUrl: string | null = null;
    if (body.previewDataUrl) {
      // Best effort: a version without a thumbnail is still a version.
      previewUrl = await savePreviewImage(body.previewDataUrl, `version-${id}`).catch(() => null);
    }

    const row = await prisma.planVersion.create({
      data: {
        planId: id,
        authorId: req.user!.id,
        label: body.label,
        note: body.note ?? null,
        reason: body.reason,
        scene: scene as unknown as object,
        objectCount: scene.objects.length,
        previewUrl,
      },
      include: { author: { select: { firstName: true, lastName: true, displayName: true } } },
    });

    res.status(201).json(versionDto(row));
  })
);

reviewRouter.get(
  '/plans/:id/versions/:versionId',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    const versionId = toId(req.params.versionId);
    if (!id || !versionId) throw ApiError.notFound('Version not found.');
    await loadPlanForUser(req.user!, id);

    const row = await prisma.planVersion.findFirst({
      where: { id: versionId, planId: id },
      include: { author: { select: { firstName: true, lastName: true, displayName: true } } },
    });
    if (!row) throw ApiError.notFound('Version not found.');
    res.json({ ...versionDto(row), scene: migrateScene(row.scene) });
  })
);

/**
 * Restore a version.
 *
 * Snapshots the current scene first, unconditionally. Restoring is the one
 * action in the editor that discards work that was never explicitly saved, so
 * it is also the one action that must be undoable after the fact.
 */
reviewRouter.post(
  '/plans/:id/versions/:versionId/restore',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    const versionId = toId(req.params.versionId);
    if (!id || !versionId) throw ApiError.notFound('Version not found.');
    const plan = await loadPlanForUser(req.user!, id, { write: true });

    const version = await prisma.planVersion.findFirst({ where: { id: versionId, planId: id } });
    if (!version) throw ApiError.notFound('Version not found.');

    const current = migrateScene((await prisma.planScene.findUnique({ where: { planId: id } }))?.scene);
    await prisma.planVersion.create({
      data: {
        planId: id,
        authorId: req.user!.id,
        label: `Before restoring "${version.label}"`,
        reason: 'before_restore',
        scene: current as unknown as object,
        objectCount: current.objects.length,
      },
    });

    const restored = migrateScene(version.scene);
    await prisma.planScene.upsert({
      where: { planId: id },
      create: { planId: id, schemaVersion: restored.schemaVersion, scene: restored as unknown as object },
      update: { schemaVersion: restored.schemaVersion, scene: restored as unknown as object },
    });
    await prisma.plan.update({ where: { id }, data: { objectCount: restored.objects.length } });
    await prisma.project.update({ where: { id: plan.projectId }, data: { updatedAt: new Date() } });

    res.json({ ok: true, scene: restored });
  })
);

reviewRouter.delete(
  '/plans/:id/versions/:versionId',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    const versionId = toId(req.params.versionId);
    if (!id || !versionId) throw ApiError.notFound('Version not found.');
    await loadPlanForUser(req.user!, id, { write: true });
    await prisma.planVersion.deleteMany({ where: { id: versionId, planId: id } });
    res.json({ ok: true });
  })
);

/* ── Comparison ────────────────────────────────────────────────────────── */

const compareQuery = z.object({
  /** Version ids, or the literal `current` for the live scene. */
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
});

async function loadComparisonScene(planId: bigint, ref: string) {
  if (ref === 'current') {
    const row = await prisma.planScene.findUnique({ where: { planId } });
    return { scene: migrateScene(row?.scene), label: 'Current' };
  }
  const id = toId(ref);
  if (!id) return { scene: createEmptyScene(), label: 'Unknown' };
  const version = await prisma.planVersion.findFirst({ where: { id, planId } });
  if (!version) throw ApiError.notFound('That version is not part of this plan.');
  return { scene: migrateScene(version.scene), label: version.label };
}

/**
 * Compare two versions, or a version against the current scene.
 *
 * "Compare layout A vs B" in the brief is usually asked of two saved options,
 * but in practice the comparison people run most is "what changed since the
 * client last saw it" — which is a version against current. Both are the same
 * call.
 */
reviewRouter.get(
  '/plans/:id/compare',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    await loadPlanForUser(req.user!, id);
    const query = compareQuery.parse(req.query);

    const [before, after] = await Promise.all([
      loadComparisonScene(id, query.from),
      loadComparisonScene(id, query.to),
    ]);

    const comparison = compareScenes(before.scene, after.scene);
    res.json({
      from: { ref: query.from, label: before.label, objectCount: before.scene.objects.length },
      to: { ref: query.to, label: after.label, objectCount: after.scene.objects.length },
      comparison,
      summary: summariseComparison(comparison),
    });
  })
);

/* ── Comments (authenticated) ──────────────────────────────────────────── */

const anchorSchema = z.object({
  positionMm: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  objectId: z.string().max(80).nullable().default(null),
  cameraPositionMm: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullable().default(null),
  cameraTargetMm: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullable().default(null),
});

const commentBody = z.object({
  body: z.string().trim().min(1).max(4000),
  visibility: z.enum(['everyone', 'internal']).default('everyone'),
  anchor: anchorSchema,
  versionId: z.number().int().positive().optional(),
});

const commentQuery = z.object({
  status: z.enum(['open', 'resolved', 'all']).default('all'),
});

function displayName(user: { firstName?: string; lastName?: string; displayName?: string | null; email: string }) {
  const full = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return user.displayName || full || user.email;
}

reviewRouter.get(
  '/plans/:id/comments',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    await loadPlanForUser(req.user!, id);
    const query = commentQuery.parse(req.query);

    const rows = await prisma.planComment.findMany({
      where: {
        planId: id,
        ...(query.status === 'all' ? {} : { status: query.status }),
      },
      orderBy: { createdAt: 'desc' },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
      take: 300,
    });

    const versionIds = [...new Set(rows.map((r) => r.versionId).filter(Boolean))] as bigint[];
    const versions = versionIds.length
      ? await prisma.planVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, label: true } })
      : [];
    const labels = new Map(versions.map((v) => [String(v.id), v.label]));

    res.json({
      items: rows.map((r) => commentDto(r, r.versionId ? labels.get(String(r.versionId)) ?? null : null)),
    });
  })
);

reviewRouter.post(
  '/plans/:id/comments',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Plan not found.');
    await loadPlanForUser(req.user!, id);
    const body = commentBody.parse(req.body);
    const user = req.user!;
    const profile = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { firstName: true, lastName: true, displayName: true, email: true },
    });

    const row = await prisma.planComment.create({
      data: {
        planId: id,
        versionId: body.versionId ? BigInt(body.versionId) : null,
        authorId: user.id,
        authorName: displayName(profile),
        authorIsClient: false,
        body: body.body,
        visibility: body.visibility,
        anchor: body.anchor as unknown as object,
      },
      include: { replies: true },
    });
    res.status(201).json(commentDto(row));
  })
);

reviewRouter.post(
  '/comments/:commentId/replies',
  asyncHandler(async (req, res) => {
    const commentId = toId(req.params.commentId);
    if (!commentId) throw ApiError.notFound('Comment not found.');
    const comment = await prisma.planComment.findUnique({ where: { id: commentId } });
    if (!comment) throw ApiError.notFound('Comment not found.');
    await loadPlanForUser(req.user!, comment.planId);

    const body = z.object({ body: z.string().trim().min(1).max(4000) }).parse(req.body);
    const profile = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { firstName: true, lastName: true, displayName: true, email: true },
    });

    const reply = await prisma.planCommentReply.create({
      data: {
        commentId,
        authorId: req.user!.id,
        authorName: displayName(profile),
        authorIsClient: false,
        body: body.body,
      },
    });
    res.status(201).json({
      id: Number(reply.id),
      body: reply.body,
      authorName: reply.authorName,
      authorUserId: Number(req.user!.id),
      authorIsClient: false,
      createdAt: reply.createdAt.toISOString(),
    });
  })
);

reviewRouter.post(
  '/comments/:commentId/resolve',
  asyncHandler(async (req, res) => {
    const commentId = toId(req.params.commentId);
    if (!commentId) throw ApiError.notFound('Comment not found.');
    const comment = await prisma.planComment.findUnique({ where: { id: commentId } });
    if (!comment) throw ApiError.notFound('Comment not found.');
    await loadPlanForUser(req.user!, comment.planId);

    const body = z.object({ resolved: z.boolean().default(true) }).parse(req.body ?? {});
    const profile = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { firstName: true, lastName: true, displayName: true, email: true },
    });

    const row = await prisma.planComment.update({
      where: { id: commentId },
      data: body.resolved
        ? { status: 'resolved', resolvedAt: new Date(), resolvedById: req.user!.id, resolvedByName: displayName(profile) }
        : { status: 'open', resolvedAt: null, resolvedById: null, resolvedByName: null },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
    });
    res.json(commentDto(row));
  })
);

reviewRouter.delete(
  '/comments/:commentId',
  asyncHandler(async (req, res) => {
    const commentId = toId(req.params.commentId);
    if (!commentId) throw ApiError.notFound('Comment not found.');
    const comment = await prisma.planComment.findUnique({ where: { id: commentId } });
    if (!comment) throw ApiError.notFound('Comment not found.');
    await loadPlanForUser(req.user!, comment.planId, { write: true });
    await prisma.planComment.delete({ where: { id: commentId } });
    res.json({ ok: true });
  })
);

/* ── Comments through a share link ─────────────────────────────────────── */

/**
 * Resolve a share token to a plan, or refuse.
 *
 * Revocation and expiry are both checked here rather than at the edge, because
 * a comment posted through a link that was revoked an hour ago should not
 * appear in the planner's list as though the client still had access.
 */
async function planForShareToken(token: string) {
  const share = await prisma.planShare.findUnique({ where: { token }, include: { plan: true } });
  if (!share || share.revokedAt) throw ApiError.notFound('This share link is no longer available.');
  if (share.expiresAt && share.expiresAt < new Date()) {
    throw new ApiError(410, 'SHARE_EXPIRED', 'This share link has expired.');
  }
  return share;
}

reviewPublicRouter.get(
  '/share/:token/comments',
  asyncHandler(async (req, res) => {
    const share = await planForShareToken(String(req.params.token));
    const rows = await prisma.planComment.findMany({
      // Internal notes are excluded in the query. Filtering them out of the
      // response instead is the version of this that eventually leaks one.
      where: { planId: share.planId, visibility: 'everyone' },
      orderBy: { createdAt: 'desc' },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
      take: 200,
    });
    res.json({ items: rows.map((r) => commentDto(r)) });
  })
);

const clientCommentBody = z.object({
  body: z.string().trim().min(1).max(4000),
  authorName: z.string().trim().min(1).max(120),
  anchor: anchorSchema,
});

reviewPublicRouter.post(
  '/share/:token/comments',
  asyncHandler(async (req, res) => {
    const token = String(req.params.token);
    const share = await planForShareToken(token);
    const body = clientCommentBody.parse(req.body);

    const row = await prisma.planComment.create({
      data: {
        planId: share.planId,
        authorId: null,
        authorName: body.authorName,
        authorIsClient: true,
        shareToken: token,
        body: body.body,
        // A client can only ever write a comment the whole room can see.
        visibility: 'everyone',
        anchor: body.anchor as unknown as object,
      },
      include: { replies: true },
    });
    res.status(201).json(commentDto(row));
  })
);

reviewPublicRouter.post(
  '/share/:token/comments/:commentId/replies',
  asyncHandler(async (req, res) => {
    const token = String(req.params.token);
    const share = await planForShareToken(token);
    const commentId = toId(req.params.commentId);
    if (!commentId) throw ApiError.notFound('Comment not found.');

    const comment = await prisma.planComment.findFirst({
      where: { id: commentId, planId: share.planId, visibility: 'everyone' },
    });
    if (!comment) throw ApiError.notFound('Comment not found.');

    const body = z
      .object({ body: z.string().trim().min(1).max(4000), authorName: z.string().trim().min(1).max(120) })
      .parse(req.body);

    const reply = await prisma.planCommentReply.create({
      data: { commentId, authorId: null, authorName: body.authorName, authorIsClient: true, body: body.body },
    });
    res.status(201).json({
      id: Number(reply.id),
      body: reply.body,
      authorName: reply.authorName,
      authorUserId: null,
      authorIsClient: true,
      createdAt: reply.createdAt.toISOString(),
    });
  })
);

export type { AuthedUser };
