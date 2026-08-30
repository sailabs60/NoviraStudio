/**
 * Review: comments, versions and comparison.
 *
 * The brief calls this "replacing WhatsApp chaos", and that phrase is exact
 * about the problem. Feedback on a 3D layout currently arrives as screenshots
 * with arrows drawn on them, in a thread, out of order, against a version
 * nobody can identify. Three things fix it, and they only work together:
 *
 * 1. **A comment is anchored in the scene**, not on an image. "Move this" has a
 *    position, so it means something a week later from a different angle.
 * 2. **A version is a saved point with a name**, so a comment can say which
 *    layout it was about, and an old one can be brought back.
 * 3. **Two versions can be compared**, because the question after a round of
 *    feedback is always "what actually changed?" — and answering it by looking
 *    is how changes get missed.
 *
 * Internal notes are the same object with a visibility flag. A separate
 * mechanism would mean someone eventually posts an internal note as a client
 * comment, which is exactly the failure this is meant to prevent.
 */
import type { SceneDocument, SceneObject, Vec3 } from './scene.js';

/* ── Comments ──────────────────────────────────────────────────────────── */

export const COMMENT_VISIBILITIES = ['everyone', 'internal'] as const;
export type CommentVisibility = (typeof COMMENT_VISIBILITIES)[number];

export const COMMENT_VISIBILITY_INFO: Record<CommentVisibility, { label: string; note: string }> = {
  everyone: { label: 'Visible to the client', note: 'Anyone with the share link can read and reply to this.' },
  internal: { label: 'Internal only', note: 'Your team sees this. It never appears on a shared link.' },
};

export const COMMENT_STATUSES = ['open', 'resolved'] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export interface CommentAnchor {
  /** Where in the room the comment points, in plan millimetres. */
  positionMm: Vec3;
  /** Object it was attached to, when it was placed on one. */
  objectId: string | null;
  /** Camera the comment was left from, so "show me" returns to that view. */
  cameraPositionMm: Vec3 | null;
  cameraTargetMm: Vec3 | null;
}

export interface PlanCommentDto {
  id: number;
  planId: number;
  /** Version the comment was left against, so it survives later edits. */
  versionId: number | null;
  versionLabel: string | null;
  anchor: CommentAnchor;
  body: string;
  visibility: CommentVisibility;
  status: CommentStatus;
  /** Author. A client commenting through a share link has no account. */
  authorName: string;
  authorUserId: number | null;
  authorIsClient: boolean;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
  replies: PlanCommentReplyDto[];
}

export interface PlanCommentReplyDto {
  id: number;
  body: string;
  authorName: string;
  authorUserId: number | null;
  authorIsClient: boolean;
  createdAt: string;
}

/* ── Versions ──────────────────────────────────────────────────────────── */

export const VERSION_REASONS = ['manual', 'milestone', 'before_ai', 'before_restore', 'shared', 'auto'] as const;
export type VersionReason = (typeof VERSION_REASONS)[number];

export const VERSION_REASON_LABELS: Record<VersionReason, string> = {
  manual: 'Saved by hand',
  milestone: 'Milestone',
  before_ai: 'Before an AI change',
  before_restore: 'Before restoring an earlier version',
  shared: 'Sent to the client',
  auto: 'Automatic snapshot',
};

export interface PlanVersionDto {
  id: number;
  planId: number;
  label: string;
  note: string | null;
  reason: VersionReason;
  objectCount: number;
  previewUrl: string | null;
  authorName: string;
  createdAt: string;
  /** Whether this is the version the editor currently holds. */
  isCurrent?: boolean;
}

/* ── Comparison ────────────────────────────────────────────────────────── */

export const CHANGE_KINDS = ['added', 'removed', 'moved', 'resized', 'restyled', 'renamed', 'other'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const CHANGE_KIND_INFO: Record<ChangeKind, { label: string; tone: 'success' | 'danger' | 'warning' | 'muted' }> = {
  added: { label: 'Added', tone: 'success' },
  removed: { label: 'Removed', tone: 'danger' },
  moved: { label: 'Moved', tone: 'warning' },
  resized: { label: 'Resized', tone: 'warning' },
  restyled: { label: 'Restyled', tone: 'muted' },
  renamed: { label: 'Renamed', tone: 'muted' },
  other: { label: 'Changed', tone: 'muted' },
};

export interface ObjectChange {
  objectId: string;
  name: string;
  type: string;
  kind: ChangeKind;
  /** Human summary, e.g. "moved 2.4 m north-east". */
  detail: string;
  /** Where it is, so the comparison view can put a marker on it. */
  positionMm: Vec3 | null;
  /** Where it was, for a moved object. */
  previousPositionMm: Vec3 | null;
}

export interface SceneComparison {
  changes: ObjectChange[];
  counts: Record<ChangeKind, number>;
  /** Objects present and identical in both. */
  unchanged: number;
  /** Settings that differ outside the object list. */
  settingChanges: Array<{ label: string; from: string; to: string }>;
}

/** Movement below this is a nudge, not a change worth reporting. */
const MOVE_TOLERANCE_MM = 25;
/** Scale change below this is rounding, not a resize. */
const SCALE_TOLERANCE = 0.02;

function describeDirection(dx: number, dz: number): string {
  const parts: string[] = [];
  // Plan north is -Z, matching how the venue module lays rooms out.
  if (dz < -MOVE_TOLERANCE_MM) parts.push('north');
  else if (dz > MOVE_TOLERANCE_MM) parts.push('south');
  if (dx > MOVE_TOLERANCE_MM) parts.push('east');
  else if (dx < -MOVE_TOLERANCE_MM) parts.push('west');
  return parts.join('-') || 'in place';
}

function sizeOf(object: SceneObject): { w: number; d: number; h: number } | null {
  const any = object as SceneObject & {
    widthMm?: number;
    depthMm?: number;
    heightMm?: number;
    dimensionsMm?: { width: number; depth: number; height: number };
    columns?: number;
    rows?: number;
    deckColumns?: number;
    deckRows?: number;
  };
  if (any.dimensionsMm) return { w: any.dimensionsMm.width, d: any.dimensionsMm.depth, h: any.dimensionsMm.height };
  if (any.deckColumns && any.deckRows) return { w: any.deckColumns * 1219, d: any.deckRows * 1219, h: 0 };
  if (any.columns && any.rows) return { w: any.columns * 500, d: 500, h: any.rows * 500 };
  if (any.widthMm != null) return { w: any.widthMm, d: any.depthMm ?? 0, h: any.heightMm ?? 0 };
  return null;
}

/** Fields whose change is a restyle rather than a geometric edit. */
const STYLE_KEYS = new Set([
  'color',
  'fillColor',
  'borderColor',
  'wallColor',
  'floorColor',
  'deckColor',
  'skirtColor',
  'canopyColor',
  'fasciaColor',
  'contentColor',
  'materialColors',
  'wallFinish',
  'floorFinish',
  'opacity',
  'textureAssetId',
  'textureVariationId',
]);

/**
 * Compare two scenes.
 *
 * Matched by object id, which is stable across edits — comparing by position
 * would report a moved table as one removal and one addition, which is exactly
 * the reading that hides what happened. Classification is ordered most
 * significant first: an object that both moved and changed colour is reported
 * as moved, because that is the change someone needs to see.
 */
export function compareScenes(before: SceneDocument, after: SceneDocument): SceneComparison {
  const beforeMap = new Map(before.objects.map((o) => [o.id, o]));
  const afterMap = new Map(after.objects.map((o) => [o.id, o]));
  const changes: ObjectChange[] = [];
  let unchanged = 0;

  for (const [id, object] of afterMap) {
    const previous = beforeMap.get(id);
    if (!previous) {
      changes.push({
        objectId: id,
        name: object.name ?? object.type,
        type: object.type,
        kind: 'added',
        detail: `Added to the plan.`,
        positionMm: object.positionMm,
        previousPositionMm: null,
      });
      continue;
    }

    const dx = object.positionMm.x - previous.positionMm.x;
    const dy = object.positionMm.y - previous.positionMm.y;
    const dz = object.positionMm.z - previous.positionMm.z;
    const distance = Math.hypot(dx, dy, dz);

    if (distance > MOVE_TOLERANCE_MM) {
      changes.push({
        objectId: id,
        name: object.name ?? object.type,
        type: object.type,
        kind: 'moved',
        detail: `Moved ${(distance / 1000).toFixed(2)} m ${describeDirection(dx, dz)}${Math.abs(dy) > MOVE_TOLERANCE_MM ? `, ${dy > 0 ? 'up' : 'down'} ${(Math.abs(dy) / 1000).toFixed(2)} m` : ''}.`,
        positionMm: object.positionMm,
        previousPositionMm: previous.positionMm,
      });
      continue;
    }

    const beforeSize = sizeOf(previous);
    const afterSize = sizeOf(object);
    const scaleChanged =
      Math.abs(object.scale.x - previous.scale.x) > SCALE_TOLERANCE ||
      Math.abs(object.scale.y - previous.scale.y) > SCALE_TOLERANCE ||
      Math.abs(object.scale.z - previous.scale.z) > SCALE_TOLERANCE;

    if (
      scaleChanged ||
      (beforeSize &&
        afterSize &&
        (Math.abs(beforeSize.w - afterSize.w) > MOVE_TOLERANCE_MM ||
          Math.abs(beforeSize.d - afterSize.d) > MOVE_TOLERANCE_MM ||
          Math.abs(beforeSize.h - afterSize.h) > MOVE_TOLERANCE_MM))
    ) {
      const detail =
        beforeSize && afterSize
          ? `Resized from ${(beforeSize.w / 1000).toFixed(2)} × ${(beforeSize.d / 1000).toFixed(2)} m to ${(afterSize.w / 1000).toFixed(2)} × ${(afterSize.d / 1000).toFixed(2)} m.`
          : 'Scale changed.';
      changes.push({
        objectId: id,
        name: object.name ?? object.type,
        type: object.type,
        kind: 'resized',
        detail,
        positionMm: object.positionMm,
        previousPositionMm: null,
      });
      continue;
    }

    if ((previous.name ?? '') !== (object.name ?? '')) {
      changes.push({
        objectId: id,
        name: object.name ?? object.type,
        type: object.type,
        kind: 'renamed',
        detail: `Renamed from "${previous.name ?? 'unnamed'}".`,
        positionMm: object.positionMm,
        previousPositionMm: null,
      });
      continue;
    }

    const styleChanged = [...STYLE_KEYS].some((key) => {
      const a = (previous as unknown as Record<string, unknown>)[key];
      const b = (object as unknown as Record<string, unknown>)[key];
      if (a === undefined && b === undefined) return false;
      return JSON.stringify(a) !== JSON.stringify(b);
    });
    if (styleChanged) {
      changes.push({
        objectId: id,
        name: object.name ?? object.type,
        type: object.type,
        kind: 'restyled',
        detail: 'Colour, finish or material changed.',
        positionMm: object.positionMm,
        previousPositionMm: null,
      });
      continue;
    }

    if (JSON.stringify(previous) !== JSON.stringify(object)) {
      changes.push({
        objectId: id,
        name: object.name ?? object.type,
        type: object.type,
        kind: 'other',
        detail: 'Settings changed.',
        positionMm: object.positionMm,
        previousPositionMm: null,
      });
      continue;
    }

    unchanged += 1;
  }

  for (const [id, object] of beforeMap) {
    if (afterMap.has(id)) continue;
    changes.push({
      objectId: id,
      name: object.name ?? object.type,
      type: object.type,
      kind: 'removed',
      detail: 'Removed from the plan.',
      positionMm: null,
      previousPositionMm: object.positionMm,
    });
  }

  const counts = CHANGE_KINDS.reduce(
    (acc, kind) => ({ ...acc, [kind]: changes.filter((c) => c.kind === kind).length }),
    {} as Record<ChangeKind, number>
  );

  /* Settings outside the object list, which are easy to change by accident. */
  const settingChanges: Array<{ label: string; from: string; to: string }> = [];
  const compare = (label: string, a: unknown, b: unknown) => {
    if (String(a) !== String(b)) settingChanges.push({ label, from: String(a), to: String(b) });
  };
  compare('Units', before.units, after.units);
  compare('Region', before.regionCode, after.regionCode);
  compare('Lighting look', before.render?.look, after.render?.look);
  compare('Environment', before.lighting?.preset, after.lighting?.preset);
  compare('Wall segments', before.walls.segments.length, after.walls.segments.length);
  compare('Floor polygons', before.walls.floors.length, after.walls.floors.length);

  // Most significant first, then alphabetical, so the list is stable.
  const order: ChangeKind[] = ['removed', 'added', 'moved', 'resized', 'renamed', 'restyled', 'other'];
  changes.sort((a, b) => {
    const delta = order.indexOf(a.kind) - order.indexOf(b.kind);
    return delta !== 0 ? delta : a.name.localeCompare(b.name);
  });

  return { changes, counts, unchanged, settingChanges };
}

/** One-line summary of a comparison, for a header or a notification. */
export function summariseComparison(comparison: SceneComparison): string {
  const parts: string[] = [];
  if (comparison.counts.added) parts.push(`${comparison.counts.added} added`);
  if (comparison.counts.removed) parts.push(`${comparison.counts.removed} removed`);
  if (comparison.counts.moved) parts.push(`${comparison.counts.moved} moved`);
  if (comparison.counts.resized) parts.push(`${comparison.counts.resized} resized`);
  const styling = comparison.counts.restyled + comparison.counts.renamed + comparison.counts.other;
  if (styling) parts.push(`${styling} otherwise changed`);
  if (!parts.length) return 'No differences in the object list.';
  return parts.join(', ');
}
