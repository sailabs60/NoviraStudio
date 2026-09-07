/**
 * Checking an assembled event before it is committed.
 *
 * The furnishing pass already avoids the obstacles it knows about — it claims a
 * footprint for everything it places and tests the next placement against them.
 * That is prevention, and it catches most of what would go wrong. This is the
 * pass that catches the rest: the things the plan could not know, because they
 * come from the room it is being put into rather than from the plan itself.
 *
 * Concretely, the plan is computed for a room of a derived size. The venue the
 * user actually has may be smaller, may have columns, may have a stage already
 * built into one end. Objects that were fine in the abstract room can end up
 * through a wall in the real one.
 *
 * ## Why this reports rather than silently repairs
 *
 * A validation pass that quietly moves things produces a layout nobody
 * specified and nobody can explain. Every finding here names the objects
 * involved and says what is wrong in the terms a planner would use, so the
 * decision stays with the person whose event it is. `autoResolve` exists for
 * the one case where the fix is unambiguous — an object outside the room has
 * exactly one correct answer, which is to be inside it.
 */
import {
  findCollisions,
  pointInPolygon,
  type Collision,
  type ObjectFootprint,
  type SceneObject,
  type WallPoint,
  type WallSegment,
} from '@novira/shared';

export interface AssemblyIssue {
  kind: 'collision' | 'outside-room' | 'ceiling' | 'walkway' | 'capacity';
  severity: 'error' | 'warning';
  message: string;
  objectIds: string[];
}

export interface ValidationResult {
  issues: AssemblyIssue[];
  errors: number;
  warnings: number;
  /** Objects checked, so a clean report can say what it looked at. */
  checked: number;
}

/* ── Footprints ────────────────────────────────────────────────────────── */

function sizeOf(object: SceneObject): { width: number; depth: number; height: number } {
  const dims = (object as { dimensionsMm?: { width: number; depth: number; height: number } }).dimensionsMm;
  if (dims) return dims;
  const flat = object as { widthMm?: number; depthMm?: number; heightMm?: number; extrudeMm?: number };
  return {
    width: flat.widthMm ?? 600,
    depth: flat.depthMm ?? 600,
    height: flat.heightMm ?? flat.extrudeMm ?? 600,
  };
}

/**
 * Which objects are worth checking for clashes.
 *
 * Carpets, walkways and zone markers lie flat on the floor and are *meant* to
 * have furniture standing on them, so including them would report every table
 * in the room as a collision. Lights and truss hang above head height and are
 * already excluded by the height test, but skipping them keeps the pass cheap
 * on a scene with a few hundred objects.
 */
function collidable(object: SceneObject): boolean {
  if (object.type === 'constraint') return false;
  if (object.type === 'light') return false;
  /*
   * A truss is a frame, not a volume.
   *
   * A goalpost is two legs and a span: it is *designed* to stand around the
   * stage with the stage inside it, so testing its overall footprint as solid
   * reports the correct rig as a clash every single time — and a validation
   * pass that always fires is one people learn to ignore. The legs are thin
   * and land where the layout put them, which the furnishing pass already
   * checked.
   */
  if (object.type === 'truss') return false;
  if (object.type === 'shape') {
    // A flat shape is a marking on the floor; an extruded one is a thing.
    const extrude = (object as { extrudeMm?: number }).extrudeMm ?? 0;
    return extrude > 100;
  }
  return true;
}

/**
 * How to refer to an object in a finding.
 *
 * Some objects are named for their place in a set rather than for what they
 * are — an exhibition stand is called "1" because that is its stand number —
 * so a bare name produces "1 reaches above the ceiling", which reads as a
 * count. Prefixing the type makes it a sentence about a thing.
 */
function label(object: SceneObject): string {
  const name = object.name?.trim();
  if (!name) return object.type;
  // A name that is only a number needs its type to make sense.
  return /^\d+$/.test(name) ? `${object.type} ${name}` : name;
}

function footprintOf(object: SceneObject): ObjectFootprint {
  const size = sizeOf(object);
  const scale = object.scale ?? { x: 1, y: 1, z: 1 };
  const rotation = ((object.rotationDeg?.y ?? 0) * Math.PI) / 180;

  /*
   * Rotate the footprint into an axis-aligned box.
   *
   * A stand turned 90 degrees against a side wall is 3 m along the wall and 2 m
   * into the room; treating it as 3 x 2 either way would put its clash test in
   * the wrong place entirely. The standard AABB of a rotated rectangle
   * over-reports slightly at other angles, which is the safe direction for a
   * clash check.
   */
  const cos = Math.abs(Math.cos(rotation));
  const sin = Math.abs(Math.sin(rotation));
  const width = size.width * scale.x;
  const depth = size.depth * scale.z;

  return {
    id: object.id,
    name: object.name ?? object.type,
    centre: { xMm: object.positionMm.x, zMm: object.positionMm.z },
    widthMm: Math.round(width * cos + depth * sin),
    depthMm: Math.round(width * sin + depth * cos),
    topMm: Math.round(object.positionMm.y + size.height * scale.y),
    weightKg: 0,
    flown: object.positionMm.y > 300,
  };
}

/* ── The room ──────────────────────────────────────────────────────────── */

function roomPolygon(segments: WallSegment[]): WallPoint[] | null {
  if (segments.length < 3) return null;
  // Wall runs are stored end to end, so the start points trace the room.
  return segments.map((segment) => segment.start);
}

/* ── The pass ──────────────────────────────────────────────────────────── */

export function validateAssembly(
  objects: SceneObject[],
  opts: {
    wallSegments: WallSegment[];
    roomHeightMm?: number;
    /** Regions nothing may stand in, such as a walkway. */
    keepClear?: Array<{ label: string; xMm: number; zMm: number; widthMm: number; depthMm: number }>;
  }
): ValidationResult {
  const issues: AssemblyIssue[] = [];
  const subjects = objects.filter(collidable);
  const footprints = subjects.map(footprintOf);

  /* -- Clashes ---------------------------------------------------------- */

  /*
   * The tolerance is 40 mm by default, which reads chairs tucked under a table
   * as intentional. It is raised here because a generated banquet puts chairs
   * deliberately close to their table and to each other, and reporting a set
   * layout as hundreds of clashes would bury the one real problem in noise.
   */
  const collisions: Collision[] = findCollisions(footprints, 120);

  // Chairs belonging to the same table are meant to be tight together.
  const groupOf = new Map(objects.map((o) => [o.id, (o as { groupId?: string | null }).groupId ?? null]));
  const realClashes = collisions.filter((collision) => {
    const a = groupOf.get(collision.a);
    const b = groupOf.get(collision.b);
    return !(a && b && a === b);
  });

  if (realClashes.length) {
    // Grouped into one finding: a hundred separate lines is a wall of text, and
    // they are almost always the same underlying mistake repeated.
    const worst = realClashes.slice(0, 5);
    issues.push({
      kind: 'collision',
      severity: 'warning',
      message:
        realClashes.length === 1
          ? `${worst[0]!.aName} and ${worst[0]!.bName} overlap by ${(worst[0]!.overlapMm / 1000).toFixed(2)} m.`
          : `${realClashes.length} pairs of objects overlap. The worst is ${worst[0]!.aName} and ${worst[0]!.bName}, by ${(worst[0]!.overlapMm / 1000).toFixed(2)} m.`,
      objectIds: realClashes.flatMap((c) => [c.a, c.b]).slice(0, 60),
    });
  }

  /* -- Outside the room ------------------------------------------------- */

  const polygon = roomPolygon(opts.wallSegments);
  if (polygon) {
    const outside = subjects.filter(
      (object) => !pointInPolygon({ xMm: object.positionMm.x, zMm: object.positionMm.z }, polygon)
    );
    if (outside.length) {
      issues.push({
        kind: 'outside-room',
        severity: 'error',
        message:
          outside.length === 1
            ? `${label(outside[0]!)} is outside the room.`
            : `${outside.length} objects are outside the room.`,
        objectIds: outside.map((o) => o.id),
      });
    }
  }

  /* -- Ceiling ---------------------------------------------------------- */

  if (opts.roomHeightMm) {
    const tooTall = subjects.filter((object) => {
      const size = sizeOf(object);
      const top = object.positionMm.y + size.height * (object.scale?.y ?? 1);
      return top > opts.roomHeightMm!;
    });
    if (tooTall.length) {
      issues.push({
        kind: 'ceiling',
        severity: 'error',
        message:
          tooTall.length === 1
            ? `${label(tooTall[0]!)} reaches above the ${(opts.roomHeightMm / 1000).toFixed(1)} m ceiling.`
            : `${tooTall.length} objects reach above the ${(opts.roomHeightMm / 1000).toFixed(1)} m ceiling.`,
        objectIds: tooTall.map((o) => o.id),
      });
    }
  }

  /* -- Routes that must stay clear -------------------------------------- */

  for (const region of opts.keepClear ?? []) {
    const blocking = subjects.filter((object) => {
      const print = footprintOf(object);
      const gapX = Math.abs(print.centre.xMm - region.xMm) - (print.widthMm + region.widthMm) / 2;
      const gapZ = Math.abs(print.centre.zMm - region.zMm) - (print.depthMm + region.depthMm) / 2;
      return gapX < 0 && gapZ < 0 && !print.flown;
    });
    if (blocking.length) {
      issues.push({
        kind: 'walkway',
        severity: 'error',
        message: `${blocking.length} object${blocking.length === 1 ? '' : 's'} stand in the ${region.label.toLowerCase()}, which has to stay clear.`,
        objectIds: blocking.map((o) => o.id),
      });
    }
  }

  return {
    issues,
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    checked: subjects.length,
  };
}

/* ── Correcting what can be corrected ──────────────────────────────────── */

/**
 * Remove the objects a validation pass found to be impossible.
 *
 * Only the unambiguous cases: an object outside the room, through the ceiling,
 * or standing in a route that has to stay clear has no correct position that
 * can be inferred — it should not be there. Overlaps are left alone, because
 * two objects too close together might be a mistake or might be exactly what
 * the designer wanted, and that is not this pass's call to make.
 *
 * Returns the objects to keep, so the caller decides whether to apply it.
 */
export function autoResolve(objects: SceneObject[], result: ValidationResult): {
  kept: SceneObject[];
  removed: number;
} {
  const doomed = new Set<string>();
  for (const issue of result.issues) {
    if (issue.kind === 'outside-room' || issue.kind === 'ceiling' || issue.kind === 'walkway') {
      for (const id of issue.objectIds) doomed.add(id);
    }
  }
  if (!doomed.size) return { kept: objects, removed: 0 };

  /*
   * A table's chairs go with it. Leaving ten chairs in a ring around nothing is
   * a worse result than removing the set, and it is what the user would do.
   */
  const groups = new Set(
    objects
      .filter((o) => doomed.has(o.id))
      .map((o) => (o as { groupId?: string | null }).groupId)
      .filter(Boolean) as string[]
  );

  const kept = objects.filter((object) => {
    if (doomed.has(object.id)) return false;
    const group = (object as { groupId?: string | null }).groupId;
    return !(group && groups.has(group));
  });

  return { kept, removed: objects.length - kept.length };
}
