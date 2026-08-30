/**
 * 2D drafting and annotation.
 *
 * A layout is a working document, not only a picture. Someone on site has to
 * read it: where the cable run goes, how far the bar is from the wall, which
 * corner is the fire exit, what that 6 m gap is for. None of that is furniture,
 * and none of it belongs in the 3D catalogue — it is draughting.
 *
 * So these are flat annotation objects living in plan space, drawn at a chosen
 * elevation. They render in both views, which matters: a dimension is most
 * useful in top view but has to still be there when someone spins the model to
 * show a client.
 *
 * Everything is integer millimetres in plan space (X across, Z into the room),
 * matching walls and furniture, so a dimension measures the same thing the
 * editor snaps to.
 */
import type { WallPoint } from './scene.js';

export const DRAW_KINDS = [
  'line',
  'polyline',
  'rectangle',
  'circle',
  'arc',
  'dimension',
  'area',
  'label',
] as const;
export type DrawKind = (typeof DRAW_KINDS)[number];

export interface DrawKindInfo {
  kind: DrawKind;
  label: string;
  hint: string;
  /** Points needed before the shape is complete; 0 means "until closed". */
  pointsNeeded: number;
  closes: boolean;
}

export const DRAW_KIND_INFO: Record<DrawKind, DrawKindInfo> = {
  line: { kind: 'line', label: 'Line', hint: 'Click the start, then the end.', pointsNeeded: 2, closes: false },
  polyline: { kind: 'polyline', label: 'Polyline', hint: 'Click each point. Right-click or press Enter to finish.', pointsNeeded: 0, closes: false },
  rectangle: { kind: 'rectangle', label: 'Rectangle', hint: 'Click two opposite corners.', pointsNeeded: 2, closes: true },
  circle: { kind: 'circle', label: 'Circle', hint: 'Click the centre, then a point on the edge.', pointsNeeded: 2, closes: true },
  arc: { kind: 'arc', label: 'Arc', hint: 'Click the centre, the start, then the end.', pointsNeeded: 3, closes: false },
  dimension: { kind: 'dimension', label: 'Dimension', hint: 'Click the two points to measure between.', pointsNeeded: 2, closes: false },
  area: { kind: 'area', label: 'Zone', hint: 'Click each corner. Right-click or press Enter to close it.', pointsNeeded: 0, closes: true },
  label: { kind: 'label', label: 'Label', hint: 'Click where the note should sit.', pointsNeeded: 1, closes: false },
};

export interface DrawingStyle {
  strokeColor: string;
  strokeWidthMm: number;
  dashed: boolean;
  fillColor: string | null;
  /** 0 is unfilled; only meaningful for closed shapes. */
  fillOpacity: number;
  textSizeMm: number;
}

export const DEFAULT_DRAWING_STYLE: DrawingStyle = {
  strokeColor: '#7dd3fc',
  strokeWidthMm: 25,
  dashed: false,
  fillColor: null,
  fillOpacity: 0,
  textSizeMm: 200,
};

/**
 * Ready-made styles for the things people actually annotate.
 *
 * Named for the job rather than the appearance, because "fire egress" is a
 * decision and "red dashed line" is not.
 */
export const DRAWING_PRESETS: Array<{ key: string; label: string; note: string; style: Partial<DrawingStyle> }> = [
  {
    key: 'dimension',
    label: 'Dimension',
    note: 'Measured distances, in the plan units.',
    style: { strokeColor: '#a3a3a3', strokeWidthMm: 12, dashed: false },
  },
  {
    key: 'egress',
    label: 'Fire egress',
    note: 'Escape routes that must stay clear.',
    style: { strokeColor: '#f87171', strokeWidthMm: 40, dashed: true, fillColor: '#f87171', fillOpacity: 0.12 },
  },
  {
    key: 'services',
    label: 'Cable &amp; services',
    note: 'Power runs, water, and where they enter.',
    style: { strokeColor: '#fbbf24', strokeWidthMm: 20, dashed: true },
  },
  {
    key: 'zone',
    label: 'Zone',
    note: 'Dance floor, bar area, breakout space.',
    style: { strokeColor: '#4DA0FF', strokeWidthMm: 25, dashed: false, fillColor: '#4DA0FF', fillOpacity: 0.14 },
  },
  {
    key: 'exclusion',
    label: 'Keep clear',
    note: 'Anything nothing may be placed in.',
    style: { strokeColor: '#fb7185', strokeWidthMm: 30, dashed: true, fillColor: '#fb7185', fillOpacity: 0.1 },
  },
  {
    key: 'guide',
    label: 'Guide',
    note: 'Setting-out lines and centrelines.',
    style: { strokeColor: '#64748b', strokeWidthMm: 10, dashed: true },
  },
];

/* ── Geometry ──────────────────────────────────────────────────────────── */

export function distanceMm(a: WallPoint, b: WallPoint): number {
  return Math.hypot(b.xMm - a.xMm, b.zMm - a.zMm);
}

/** Total length along a run of points. */
export function pathLengthMm(points: WallPoint[], closed = false): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distanceMm(points[i - 1]!, points[i]!);
  if (closed && points.length > 2) total += distanceMm(points[points.length - 1]!, points[0]!);
  return total;
}

/**
 * Signed area of a polygon, by the shoelace formula, returned as a positive
 * value in square millimetres.
 */
export function polygonAreaMm2(points: WallPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.xMm * b.zMm - b.xMm * a.zMm;
  }
  return Math.abs(sum) / 2;
}

/** The four corners implied by two opposite corners. */
export function rectangleCorners(a: WallPoint, b: WallPoint): WallPoint[] {
  return [
    { xMm: a.xMm, zMm: a.zMm },
    { xMm: b.xMm, zMm: a.zMm },
    { xMm: b.xMm, zMm: b.zMm },
    { xMm: a.xMm, zMm: b.zMm },
  ];
}

/** A circle as a polyline, for rendering and for area. */
export function circlePoints(centre: WallPoint, edge: WallPoint, segments = 48): WallPoint[] {
  const radius = distanceMm(centre, edge);
  return Array.from({ length: segments }, (_, i) => {
    const angle = (i / segments) * Math.PI * 2;
    return {
      xMm: Math.round(centre.xMm + Math.cos(angle) * radius),
      zMm: Math.round(centre.zMm + Math.sin(angle) * radius),
    };
  });
}

/**
 * An arc from centre, start and end points.
 *
 * The sweep always takes the shorter way round, which is what someone drawing
 * a curve by clicking three times expects.
 */
export function arcPoints(
  centre: WallPoint,
  start: WallPoint,
  end: WallPoint,
  segments = 32
): WallPoint[] {
  const radius = distanceMm(centre, start);
  const a0 = Math.atan2(start.zMm - centre.zMm, start.xMm - centre.xMm);
  let a1 = Math.atan2(end.zMm - centre.zMm, end.xMm - centre.xMm);

  // Normalise to the shorter sweep.
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  a1 = a0 + delta;

  return Array.from({ length: segments + 1 }, (_, i) => {
    const angle = a0 + (delta * i) / segments;
    return {
      xMm: Math.round(centre.xMm + Math.cos(angle) * radius),
      zMm: Math.round(centre.zMm + Math.sin(angle) * radius),
    };
  });
}

/** The points actually drawn for a shape, whatever its kind. */
export function resolveDrawPoints(kind: DrawKind, points: WallPoint[]): WallPoint[] {
  if (points.length < 2) return points;
  switch (kind) {
    case 'rectangle':
      return rectangleCorners(points[0]!, points[1]!);
    case 'circle':
      return circlePoints(points[0]!, points[1]!);
    case 'arc':
      return points.length >= 3 ? arcPoints(points[0]!, points[1]!, points[2]!) : points;
    default:
      return points;
  }
}

/**
 * The measurement a shape reports.
 *
 * Lines and dimensions report length; closed shapes report area as well, which
 * is the number a planner actually wants from a zone.
 */
export interface DrawMeasurement {
  lengthMm: number;
  areaMm2: number;
  /** True where the area figure is meaningful. */
  hasArea: boolean;
}

export function measureDrawing(kind: DrawKind, points: WallPoint[]): DrawMeasurement {
  const resolved = resolveDrawPoints(kind, points);
  const closes = DRAW_KIND_INFO[kind].closes;

  if (kind === 'circle' && points.length >= 2) {
    const radius = distanceMm(points[0]!, points[1]!);
    return {
      lengthMm: 2 * Math.PI * radius,
      areaMm2: Math.PI * radius * radius,
      hasArea: true,
    };
  }

  return {
    lengthMm: pathLengthMm(resolved, closes),
    areaMm2: closes ? polygonAreaMm2(resolved) : 0,
    hasArea: closes,
  };
}

/* ── Snapping ──────────────────────────────────────────────────────────── */

export interface SnapCandidate {
  point: WallPoint;
  kind: 'grid' | 'endpoint' | 'midpoint' | 'centre' | 'ortho';
  /** For reporting which snap fired, so the UI can say why the cursor jumped. */
  label: string;
}

/**
 * Find the best snap for a cursor position.
 *
 * Ordered by how strongly a draughtsman expects it: an endpoint beats a
 * midpoint, and both beat the grid, because clicking near the end of an
 * existing line almost always means "exactly there".
 */
export function findSnap(
  cursor: WallPoint,
  options: {
    gridMm: number;
    /** Existing geometry to snap against. */
    segments?: Array<{ start: WallPoint; end: WallPoint }>;
    /** The point being drawn from, for orthogonal constraint. */
    anchor?: WallPoint | null;
    /** Snap radius in plan millimetres. */
    toleranceMm?: number;
    enableGrid?: boolean;
    enableOrtho?: boolean;
  }
): SnapCandidate {
  const {
    gridMm,
    segments = [],
    anchor = null,
    toleranceMm = 250,
    enableGrid = true,
    enableOrtho = true,
  } = options;

  let best: SnapCandidate | null = null;
  let bestDistance = toleranceMm;

  const consider = (point: WallPoint, kind: SnapCandidate['kind'], label: string) => {
    const d = distanceMm(cursor, point);
    if (d < bestDistance) {
      best = { point, kind, label };
      bestDistance = d;
    }
  };

  for (const segment of segments) {
    consider(segment.start, 'endpoint', 'endpoint');
    consider(segment.end, 'endpoint', 'endpoint');
    consider(
      {
        xMm: Math.round((segment.start.xMm + segment.end.xMm) / 2),
        zMm: Math.round((segment.start.zMm + segment.end.zMm) / 2),
      },
      'midpoint',
      'midpoint'
    );
  }

  if (best) return best;

  /*
   * Orthogonal constraint: while drawing from an anchor, a nearly-horizontal or
   * nearly-vertical run is almost always meant to be exactly so. Applied before
   * the grid, since a drawn line matters more than the grid it sits on.
   */
  if (enableOrtho && anchor) {
    const dx = Math.abs(cursor.xMm - anchor.xMm);
    const dz = Math.abs(cursor.zMm - anchor.zMm);
    const orthoTolerance = Math.max(toleranceMm, Math.min(dx, dz) * 0.18);
    if (dz < orthoTolerance && dx > dz) {
      return { point: { xMm: cursor.xMm, zMm: anchor.zMm }, kind: 'ortho', label: 'horizontal' };
    }
    if (dx < orthoTolerance && dz > dx) {
      return { point: { xMm: anchor.xMm, zMm: cursor.zMm }, kind: 'ortho', label: 'vertical' };
    }
  }

  if (enableGrid && gridMm > 0) {
    return {
      point: {
        xMm: Math.round(cursor.xMm / gridMm) * gridMm,
        zMm: Math.round(cursor.zMm / gridMm) * gridMm,
      },
      kind: 'grid',
      label: 'grid',
    };
  }

  return { point: cursor, kind: 'grid', label: 'free' };
}

/** Square millimetres to square metres, for display. */
export function areaSqM(areaMm2: number): number {
  return Math.round((areaMm2 / 1_000_000) * 100) / 100;
}
