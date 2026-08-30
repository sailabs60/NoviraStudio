/**
 * Wall geometry.
 *
 * Walls are stored as a blueprint of segments rather than as meshes: a segment
 * is two points, a thickness and a height. Everything visual is derived from
 * that, which keeps the document small, makes openings addressable (a door
 * belongs to a segment, at an offset along it), and lets a plan be re-rendered
 * at any quality without re-authoring.
 */

import type { FloorPolygon, WallBlueprint, WallPoint, WallSegment } from './scene.js';

/**
 * Identifier for a generated segment or floor.
 *
 * This module runs in both the browser and Node (the API regenerates floors
 * server-side on import), so it cannot assume a global `crypto`. Falls back to
 * a random string where `randomUUID` is unavailable.
 */
function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const DEFAULT_WALL_THICKNESS_MM = 150;
export const DEFAULT_WALL_HEIGHT_MM = 2800;

/** Distance between two plan points, in millimetres. */
export function segmentLength(a: WallPoint, b: WallPoint): number {
  return Math.hypot(b.xMm - a.xMm, b.zMm - a.zMm);
}

/** Bearing of a segment in degrees, measured about the Y axis. */
export function segmentAngleDeg(a: WallPoint, b: WallPoint): number {
  return (Math.atan2(b.zMm - a.zMm, b.xMm - a.xMm) * 180) / Math.PI;
}

export function segmentMidpoint(a: WallPoint, b: WallPoint): WallPoint {
  return { xMm: (a.xMm + b.xMm) / 2, zMm: (a.zMm + b.zMm) / 2 };
}

/** Point at `t` (0–1) along a segment. */
export function pointAlong(a: WallPoint, b: WallPoint, t: number): WallPoint {
  return { xMm: a.xMm + (b.xMm - a.xMm) * t, zMm: a.zMm + (b.zMm - a.zMm) * t };
}

/**
 * Closest point on a segment to an arbitrary point, plus how far along it sits.
 * Used to snap a dropped door or window onto the nearest wall.
 */
export function projectOntoSegment(
  point: WallPoint,
  a: WallPoint,
  b: WallPoint
): { point: WallPoint; distanceMm: number; alongMm: number; t: number } {
  const dx = b.xMm - a.xMm;
  const dz = b.zMm - a.zMm;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) {
    return { point: a, distanceMm: segmentLength(point, a), alongMm: 0, t: 0 };
  }
  const rawT = ((point.xMm - a.xMm) * dx + (point.zMm - a.zMm) * dz) / lengthSq;
  const t = Math.max(0, Math.min(1, rawT));
  const projected = { xMm: a.xMm + dx * t, zMm: a.zMm + dz * t };
  return {
    point: projected,
    distanceMm: segmentLength(point, projected),
    alongMm: t * Math.sqrt(lengthSq),
    t,
  };
}

/** The nearest wall segment to a point, within a tolerance. */
export function nearestSegment(
  segments: WallSegment[],
  point: WallPoint,
  toleranceMm = 1500
): { segment: WallSegment; alongMm: number; distanceMm: number } | null {
  let best: { segment: WallSegment; alongMm: number; distanceMm: number } | null = null;
  for (const segment of segments) {
    const hit = projectOntoSegment(point, segment.start, segment.end);
    if (hit.distanceMm > toleranceMm) continue;
    if (!best || hit.distanceMm < best.distanceMm) {
      best = { segment, alongMm: hit.alongMm, distanceMm: hit.distanceMm };
    }
  }
  return best;
}

/** Snap a point to the grid, in plan space. */
export function snapPoint(point: WallPoint, gridMm: number): WallPoint {
  if (!gridMm || gridMm <= 0) return point;
  return {
    xMm: Math.round(point.xMm / gridMm) * gridMm,
    zMm: Math.round(point.zMm / gridMm) * gridMm,
  };
}

/**
 * Snap a run's latest point to the axis of the previous one.
 *
 * Rooms are overwhelmingly orthogonal, and hand-drawn runs are almost never
 * exactly so. If the new point is within a few degrees of square to the last
 * segment, straighten it — the alternative is a plan full of walls that are
 * 0.4° off and never quite meet.
 */
export function orthoSnap(previous: WallPoint, next: WallPoint, toleranceDeg = 8): WallPoint {
  const dx = next.xMm - previous.xMm;
  const dz = next.zMm - previous.zMm;
  if (dx === 0 && dz === 0) return next;
  const angle = Math.abs((Math.atan2(dz, dx) * 180) / Math.PI);
  const nearHorizontal = angle < toleranceDeg || Math.abs(angle - 180) < toleranceDeg;
  const nearVertical = Math.abs(angle - 90) < toleranceDeg;
  if (nearHorizontal) return { xMm: next.xMm, zMm: previous.zMm };
  if (nearVertical) return { xMm: previous.xMm, zMm: next.zMm };
  return next;
}

/** A rectangular room, centred on the origin. */
export function createRoom(
  lengthMm: number,
  widthMm: number,
  thicknessMm = DEFAULT_WALL_THICKNESS_MM,
  heightMm = DEFAULT_WALL_HEIGHT_MM,
  centre: WallPoint = { xMm: 0, zMm: 0 }
): { segments: WallSegment[]; floor: FloorPolygon } {
  const halfL = lengthMm / 2;
  const halfW = widthMm / 2;
  const corners: WallPoint[] = [
    { xMm: centre.xMm - halfL, zMm: centre.zMm - halfW },
    { xMm: centre.xMm + halfL, zMm: centre.zMm - halfW },
    { xMm: centre.xMm + halfL, zMm: centre.zMm + halfW },
    { xMm: centre.xMm - halfL, zMm: centre.zMm + halfW },
  ];

  const spanId = newId();
  const segments: WallSegment[] = corners.map((start, i) => ({
    id: newId(),
    spanId,
    start,
    end: corners[(i + 1) % corners.length]!,
    thicknessMm,
    heightMm,
  }));

  return {
    segments,
    floor: { id: newId(), points: corners },
  };
}

/** Build segments from an ordered run of points. */
export function segmentsFromRun(
  points: WallPoint[],
  options: { thicknessMm?: number; heightMm?: number; closed?: boolean } = {}
): WallSegment[] {
  const { thicknessMm = DEFAULT_WALL_THICKNESS_MM, heightMm = DEFAULT_WALL_HEIGHT_MM, closed = false } = options;
  if (points.length < 2) return [];

  const spanId = newId();
  const segments: WallSegment[] = [];
  const last = closed ? points.length : points.length - 1;

  for (let i = 0; i < last; i += 1) {
    const start = points[i]!;
    const end = points[(i + 1) % points.length]!;
    if (segmentLength(start, end) < 1) continue;
    segments.push({ id: newId(), spanId, start, end, thicknessMm, heightMm });
  }
  return segments;
}

/** Signed area of a polygon, ×2. Positive means counter-clockwise. */
function signedArea2(points: WallPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.xMm * b.zMm - b.xMm * a.zMm;
  }
  return sum;
}

/** Polygon area in square millimetres. */
export function polygonArea(points: WallPoint[]): number {
  return Math.abs(signedArea2(points)) / 2;
}

export function polygonCentroid(points: WallPoint[]): WallPoint {
  const area2 = signedArea2(points);
  if (Math.abs(area2) < 1e-6) {
    // Degenerate: fall back to the average of the vertices.
    const sum = points.reduce((acc, p) => ({ xMm: acc.xMm + p.xMm, zMm: acc.zMm + p.zMm }), { xMm: 0, zMm: 0 });
    return { xMm: sum.xMm / points.length, zMm: sum.zMm / points.length };
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const cross = a.xMm * b.zMm - b.xMm * a.zMm;
    cx += (a.xMm + b.xMm) * cross;
    cz += (a.zMm + b.zMm) * cross;
  }
  return { xMm: cx / (3 * area2), zMm: cz / (3 * area2) };
}

/**
 * Find closed loops in a set of segments and turn them into floor polygons.
 *
 * Walls are drawn as runs, not as regions, so the floor a user expects to see
 * has to be recovered from the graph. This walks each connected component and
 * emits a polygon for any cycle it can close, which covers the ordinary cases
 * (a traced room, a Quick Room, a run that meets itself) without needing a full
 * planar-subdivision algorithm.
 */
export function deriveFloors(segments: WallSegment[], toleranceMm = 60): FloorPolygon[] {
  if (segments.length < 3) return [];

  const key = (p: WallPoint) =>
    `${Math.round(p.xMm / toleranceMm)}:${Math.round(p.zMm / toleranceMm)}`;

  const nodes = new Map<string, WallPoint>();
  const adjacency = new Map<string, Set<string>>();

  for (const segment of segments) {
    const a = key(segment.start);
    const b = key(segment.end);
    if (a === b) continue;
    nodes.set(a, segment.start);
    nodes.set(b, segment.end);
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  }

  const floors: FloorPolygon[] = [];
  const visitedCycles = new Set<string>();

  // Depth-first walk looking for a path that returns to its start.
  const findCycle = (start: string): string[] | null => {
    const stack: Array<{ node: string; path: string[]; from: string | null }> = [
      { node: start, path: [start], from: null },
    ];
    while (stack.length) {
      const { node, path, from } = stack.pop()!;
      for (const next of adjacency.get(node) ?? []) {
        if (next === from) continue;
        if (next === start && path.length >= 3) return path;
        if (path.includes(next)) continue;
        if (path.length > 64) continue; // guard against pathological graphs
        stack.push({ node: next, path: [...path, next], from: node });
      }
    }
    return null;
  };

  for (const startKey of adjacency.keys()) {
    const cycle = findCycle(startKey);
    if (!cycle) continue;
    const signature = [...cycle].sort().join('|');
    if (visitedCycles.has(signature)) continue;
    visitedCycles.add(signature);

    const points = cycle.map((k) => nodes.get(k)!).filter(Boolean);
    if (points.length < 3) continue;
    if (polygonArea(points) < 100_000) continue; // smaller than 0.1 m² is noise
    floors.push({ id: newId(), points });
  }

  return floors;
}

/** Rebuild the derived parts of a blueprint after segments change. */
export function rebuildBlueprint(segments: WallSegment[], keepFloors: FloorPolygon[] = []): WallBlueprint {
  const derived = deriveFloors(segments);
  // Preserve any styling already applied to a floor covering the same area.
  const styled = derived.map((floor) => {
    const centroid = polygonCentroid(floor.points);
    const previous = keepFloors.find((f) => {
      const c = polygonCentroid(f.points);
      return Math.hypot(c.xMm - centroid.xMm, c.zMm - centroid.zMm) < 500;
    });
    return previous ? { ...floor, color: previous.color, textureAssetId: previous.textureAssetId, textureTileSizeM: previous.textureTileSizeM } : floor;
  });
  return { segments, floors: styled };
}
