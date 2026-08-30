/**
 * Real-world constraints.
 *
 * A design that ignores the building is a picture, not a plan. The things that
 * actually stop a build are always the same handful: you cannot go higher than
 * the roof allows, you cannot hang from a point that is not there, you cannot
 * find power on the far side of the hall, and you cannot block a fire exit.
 *
 * Every one of those is spatial, so they belong in the scene rather than in a
 * document alongside it — and being in the scene is what lets the plan check
 * itself. `evaluateConstraints` is the whole point of this module: it takes the
 * constraints and the objects, and reports what breaks.
 *
 * All lengths are integer millimetres; loads are kilograms; current is amps.
 */
import type { SceneObject, Vec3, WallPoint } from './scene.js';

/* ── The kinds ─────────────────────────────────────────────────────────── */

export const CONSTRAINT_KINDS = [
  'height-limit',
  'rigging-point',
  'power',
  'exit',
  'keep-clear',
  'truck-access',
  'load-limit',
  'no-build',
] as const;
export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];

export interface ConstraintKindInfo {
  key: ConstraintKind;
  label: string;
  note: string;
  /** How it is drawn: a single point, or an area. */
  geometry: 'point' | 'area';
  color: string;
  /** Whether breaching it stops a build or is merely worth knowing. */
  severity: 'error' | 'warning' | 'info';
  icon: string;
}

export const CONSTRAINT_INFO: Record<ConstraintKind, ConstraintKindInfo> = {
  'height-limit': {
    key: 'height-limit',
    label: 'Height limit',
    note: 'Nothing may be built taller than this inside the area — a low soffit, a duct, an organiser rule.',
    geometry: 'area',
    color: '#f59e0b',
    severity: 'error',
    icon: 'arrow-down-to-line',
  },
  'rigging-point': {
    key: 'rigging-point',
    label: 'Rigging point',
    note: 'A structural point you may hang from, with the safe working load it is rated to.',
    geometry: 'point',
    color: '#22c55e',
    severity: 'error',
    icon: 'anchor',
  },
  power: {
    key: 'power',
    label: 'Power supply',
    note: 'Where a supply lands, and how much it will give you.',
    geometry: 'point',
    color: '#eab308',
    severity: 'warning',
    icon: 'zap',
  },
  exit: {
    key: 'exit',
    label: 'Fire exit',
    note: 'An exit and the escape route in front of it. Nothing may obstruct either.',
    geometry: 'area',
    color: '#ef4444',
    severity: 'error',
    icon: 'door-open',
  },
  'keep-clear': {
    key: 'keep-clear',
    label: 'Keep clear',
    note: 'A route or working area that has to stay empty — gangways, forklift runs, service doors.',
    geometry: 'area',
    color: '#f97316',
    severity: 'warning',
    icon: 'square-dashed',
  },
  'truck-access': {
    key: 'truck-access',
    label: 'Truck access',
    note: 'Where a vehicle can get to, and how large a vehicle that is.',
    geometry: 'area',
    color: '#3b82f6',
    severity: 'info',
    icon: 'truck',
  },
  'load-limit': {
    key: 'load-limit',
    label: 'Floor load limit',
    note: 'Maximum distributed load the floor will carry here — basements and raised floors are the usual cases.',
    geometry: 'area',
    color: '#a855f7',
    severity: 'error',
    icon: 'weight',
  },
  'no-build': {
    key: 'no-build',
    label: 'No build',
    note: 'A pillar, a hatch, a services riser. Nothing may be placed on it at all.',
    geometry: 'area',
    color: '#dc2626',
    severity: 'error',
    icon: 'ban',
  },
};

export const CONSTRAINT_LIST: ConstraintKindInfo[] = CONSTRAINT_KINDS.map((k) => CONSTRAINT_INFO[k]);

/* ── The data a constraint carries ─────────────────────────────────────── */

export interface ConstraintData {
  constraintKind: ConstraintKind;
  /** Polygon for an area, a single point for a point constraint. */
  points: WallPoint[];
  label: string;
  /** Height limit, in millimetres above the floor. */
  heightLimitMm?: number;
  /** Safe working load for a rigging point, in kilograms. */
  swlKg?: number;
  /** Distributed floor load, in kilograms per square metre. */
  floorLoadKgSqM?: number;
  /** Height of the rigging point above the floor. */
  rigHeightMm?: number;
  /** Power: current, phases and voltage at the outlet. */
  amps?: number;
  phases?: 1 | 3;
  voltage?: number;
  /** Exit: clear width of the doorway. */
  clearWidthMm?: number;
  /** Truck access: the largest vehicle that can reach here. */
  vehicle?: 'van' | 'box-truck' | 'rigid' | 'articulated';
  /** Free text, printed onto the technical drawing. */
  note?: string;
  color: string;
  /** Draw the extruded volume rather than just the floor outline. */
  showVolume?: boolean;
}

export const DEFAULT_CONSTRAINT: ConstraintData = {
  constraintKind: 'keep-clear',
  points: [],
  label: 'Keep clear',
  color: CONSTRAINT_INFO['keep-clear'].color,
  showVolume: false,
};

export const VEHICLE_SPECS: Record<
  NonNullable<ConstraintData['vehicle']>,
  { label: string; lengthMm: number; widthMm: number; heightMm: number; payloadKg: number; turningRadiusMm: number }
> = {
  van: { label: 'Long-wheelbase van', lengthMm: 6000, widthMm: 2100, heightMm: 2600, payloadKg: 1300, turningRadiusMm: 6500 },
  'box-truck': { label: '7.5 t box truck', lengthMm: 8500, widthMm: 2500, heightMm: 3600, payloadKg: 3000, turningRadiusMm: 9000 },
  rigid: { label: '18 t rigid with tail lift', lengthMm: 10000, widthMm: 2550, heightMm: 4000, payloadKg: 9500, turningRadiusMm: 11000 },
  articulated: { label: '40 ft articulated trailer', lengthMm: 16500, widthMm: 2600, heightMm: 4200, payloadKg: 24000, turningRadiusMm: 14500 },
};

export function constraintDefaults(kind: ConstraintKind): ConstraintData {
  const info = CONSTRAINT_INFO[kind];
  const base: ConstraintData = { ...DEFAULT_CONSTRAINT, constraintKind: kind, label: info.label, color: info.color, points: [] };
  switch (kind) {
    case 'height-limit':
      return { ...base, heightLimitMm: 4000, showVolume: true };
    case 'rigging-point':
      return { ...base, swlKg: 500, rigHeightMm: 7000 };
    case 'power':
      return { ...base, amps: 63, phases: 3, voltage: 400 };
    case 'exit':
      return { ...base, clearWidthMm: 1800, showVolume: true };
    case 'truck-access':
      return { ...base, vehicle: 'rigid' };
    case 'load-limit':
      return { ...base, floorLoadKgSqM: 500 };
    default:
      return base;
  }
}

/* ── Geometry helpers ──────────────────────────────────────────────────── */

/** Even-odd ray cast. Robust enough for the convex-ish shapes drawn here. */
export function pointInPolygon(point: WallPoint, polygon: WallPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      a.zMm > point.zMm !== b.zMm > point.zMm &&
      point.xMm < ((b.xMm - a.xMm) * (point.zMm - a.zMm)) / (b.zMm - a.zMm || 1e-9) + a.xMm;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function polygonBounds(points: WallPoint[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const xs = points.map((p) => p.xMm);
  const zs = points.map((p) => p.zMm);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

/** Rectangle from two opposite corners, in the winding order the renderer wants. */
export function rectanglePoints(a: WallPoint, b: WallPoint): WallPoint[] {
  return [
    { xMm: a.xMm, zMm: a.zMm },
    { xMm: b.xMm, zMm: a.zMm },
    { xMm: b.xMm, zMm: b.zMm },
    { xMm: a.xMm, zMm: b.zMm },
  ];
}

/** Axis-aligned footprint of an object, from its own declared size. */
export interface ObjectFootprint {
  id: string;
  name: string;
  centre: WallPoint;
  widthMm: number;
  depthMm: number;
  /** Top of the object above the floor. */
  topMm: number;
  /** Estimated mass, where the object type knows it. */
  weightKg: number;
  /** Whether this object hangs rather than stands. */
  flown: boolean;
}

/* ── Evaluation ────────────────────────────────────────────────────────── */

export interface ConstraintFinding {
  constraintId: string;
  constraintKind: ConstraintKind;
  severity: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  /** Objects involved, so the UI can select and show them. */
  objectIds: string[];
}

export interface ConstraintReport {
  findings: ConstraintFinding[];
  errors: number;
  warnings: number;
  /** Total mass hung across every rigging point, against total capacity. */
  riggingUsedKg: number;
  riggingCapacityKg: number;
  /** Total electrical demand against the supplies declared. */
  demandAmps: number;
  supplyAmps: number;
  /** True when nothing is broken — what the badge in the header reads. */
  clear: boolean;
}

export interface ConstraintLike extends ConstraintData {
  id: string;
}

/**
 * Check the plan against its constraints.
 *
 * Deliberately conservative in one direction only: something that *might*
 * breach is reported, because the cost of a false alarm is a glance and the
 * cost of a miss is a rebuild on site.
 */
export function evaluateConstraints(
  constraints: ConstraintLike[],
  footprints: ObjectFootprint[],
  demand: { amps: number; riggedLoadKg: number } = { amps: 0, riggedLoadKg: 0 }
): ConstraintReport {
  const findings: ConstraintFinding[] = [];

  const areas = constraints.filter((c) => CONSTRAINT_INFO[c.constraintKind].geometry === 'area' && c.points.length >= 3);
  const points = constraints.filter((c) => CONSTRAINT_INFO[c.constraintKind].geometry === 'point');

  for (const constraint of areas) {
    const inside = footprints.filter((f) => footprintOverlapsPolygon(f, constraint.points));
    if (!inside.length) continue;

    switch (constraint.constraintKind) {
      case 'height-limit': {
        const limit = constraint.heightLimitMm ?? 0;
        const tall = inside.filter((f) => f.topMm > limit);
        if (tall.length) {
          findings.push({
            constraintId: constraint.id,
            constraintKind: constraint.constraintKind,
            severity: 'error',
            title: `${tall.length} item${tall.length === 1 ? '' : 's'} above the ${(limit / 1000).toFixed(2)} m limit`,
            detail: `${constraint.label}: ${tall
              .slice(0, 4)
              .map((f) => `${f.name} at ${(f.topMm / 1000).toFixed(2)} m`)
              .join(', ')}${tall.length > 4 ? `, and ${tall.length - 4} more` : ''}.`,
            objectIds: tall.map((f) => f.id),
          });
        }
        break;
      }
      case 'exit': {
        findings.push({
          constraintId: constraint.id,
          constraintKind: constraint.constraintKind,
          severity: 'error',
          title: `Fire exit obstructed by ${inside.length} item${inside.length === 1 ? '' : 's'}`,
          detail: `${constraint.label} must stay completely clear. Move ${inside
            .slice(0, 4)
            .map((f) => f.name)
            .join(', ')}${inside.length > 4 ? `, and ${inside.length - 4} more` : ''} out of the escape route.`,
          objectIds: inside.map((f) => f.id),
        });
        break;
      }
      case 'keep-clear': {
        findings.push({
          constraintId: constraint.id,
          constraintKind: constraint.constraintKind,
          severity: 'warning',
          title: `${inside.length} item${inside.length === 1 ? '' : 's'} inside "${constraint.label}"`,
          detail: 'This area has to stay clear during the build or the event. Check whether these can move.',
          objectIds: inside.map((f) => f.id),
        });
        break;
      }
      case 'no-build': {
        findings.push({
          constraintId: constraint.id,
          constraintKind: constraint.constraintKind,
          severity: 'error',
          title: `${inside.length} item${inside.length === 1 ? '' : 's'} on a no-build area`,
          detail: `${constraint.label} cannot carry anything — it is a pillar, hatch or riser.`,
          objectIds: inside.map((f) => f.id),
        });
        break;
      }
      case 'load-limit': {
        const limit = constraint.floorLoadKgSqM ?? 0;
        const bounds = polygonBounds(constraint.points);
        const areaSqM = ((bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ)) / 1_000_000;
        const total = inside.filter((f) => !f.flown).reduce((sum, f) => sum + f.weightKg, 0);
        const perSqM = areaSqM > 0 ? total / areaSqM : 0;
        if (limit > 0 && perSqM > limit) {
          findings.push({
            constraintId: constraint.id,
            constraintKind: constraint.constraintKind,
            severity: 'error',
            title: `Floor loading ${Math.round(perSqM)} kg/m² over the ${limit} kg/m² limit`,
            detail: `${constraint.label} carries about ${Math.round(total)} kg over ${areaSqM.toFixed(1)} m². Spread the load or move weight off this area.`,
            objectIds: inside.map((f) => f.id),
          });
        }
        break;
      }
      case 'truck-access': {
        const vehicle = VEHICLE_SPECS[constraint.vehicle ?? 'rigid'];
        findings.push({
          constraintId: constraint.id,
          constraintKind: constraint.constraintKind,
          severity: 'warning',
          title: `${inside.length} item${inside.length === 1 ? '' : 's'} on the ${vehicle.label} route`,
          detail: `${constraint.label} needs ${(vehicle.widthMm / 1000).toFixed(1)} m of width and ${(vehicle.heightMm / 1000).toFixed(1)} m of headroom on load-in and load-out.`,
          objectIds: inside.map((f) => f.id),
        });
        break;
      }
      default:
        break;
    }
  }

  /* ── Rigging capacity ────────────────────────────────────────────────── */

  const rigPoints = points.filter((c) => c.constraintKind === 'rigging-point');
  const riggingCapacityKg = rigPoints.reduce((sum, c) => sum + (c.swlKg ?? 0), 0);
  const riggingUsedKg = Math.round(demand.riggedLoadKg);

  if (riggingUsedKg > 0 && rigPoints.length === 0) {
    findings.push({
      constraintId: 'rigging',
      constraintKind: 'rigging-point',
      severity: 'warning',
      title: `${riggingUsedKg} kg is flown with no rigging points marked`,
      detail: 'Add the venue rigging points so the load can be checked against what the roof will actually take.',
      objectIds: [],
    });
  } else if (riggingCapacityKg > 0 && riggingUsedKg > riggingCapacityKg) {
    findings.push({
      constraintId: 'rigging',
      constraintKind: 'rigging-point',
      severity: 'error',
      title: `Flown load ${riggingUsedKg} kg exceeds the ${riggingCapacityKg} kg available`,
      detail: `${rigPoints.length} rigging point${rigPoints.length === 1 ? '' : 's'} marked. Add points, reduce the load, or ground-support.`,
      objectIds: [],
    });
  }

  /* ── Power ───────────────────────────────────────────────────────────── */

  const supplies = points.filter((c) => c.constraintKind === 'power');
  const supplyAmps = supplies.reduce((sum, c) => sum + (c.amps ?? 0) * (c.phases === 3 ? 3 : 1), 0);
  const demandAmps = Math.round(demand.amps);

  if (demandAmps > 0 && supplies.length === 0) {
    findings.push({
      constraintId: 'power',
      constraintKind: 'power',
      severity: 'warning',
      title: `About ${demandAmps} A of demand with no supply marked`,
      detail: 'Mark where power lands in the venue so the distribution run can be planned and priced.',
      objectIds: [],
    });
  } else if (supplyAmps > 0 && demandAmps > supplyAmps * 0.8) {
    findings.push({
      constraintId: 'power',
      constraintKind: 'power',
      severity: demandAmps > supplyAmps ? 'error' : 'warning',
      title:
        demandAmps > supplyAmps
          ? `Demand ${demandAmps} A exceeds the ${supplyAmps} A supplied`
          : `Demand ${demandAmps} A is within 20 % of the ${supplyAmps} A supplied`,
      detail: 'Order a larger supply or a generator, or reduce the load. Design to 80 % of the available current.',
      objectIds: [],
    });
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;

  return {
    findings,
    errors,
    warnings,
    riggingUsedKg,
    riggingCapacityKg,
    demandAmps,
    supplyAmps,
    clear: errors === 0 && warnings === 0,
  };
}

/**
 * Whether an object's footprint touches a polygon.
 *
 * Tests the footprint corners and centre against the polygon, and the polygon
 * vertices against the footprint. That catches both "object inside the area"
 * and "area inside the object", which a corners-only test misses — a small
 * keep-clear zone entirely under a large stage is exactly the case that
 * matters.
 */
export function footprintOverlapsPolygon(footprint: ObjectFootprint, polygon: WallPoint[]): boolean {
  const halfW = footprint.widthMm / 2;
  const halfD = footprint.depthMm / 2;
  const corners: WallPoint[] = [
    { xMm: footprint.centre.xMm - halfW, zMm: footprint.centre.zMm - halfD },
    { xMm: footprint.centre.xMm + halfW, zMm: footprint.centre.zMm - halfD },
    { xMm: footprint.centre.xMm + halfW, zMm: footprint.centre.zMm + halfD },
    { xMm: footprint.centre.xMm - halfW, zMm: footprint.centre.zMm + halfD },
    footprint.centre,
  ];
  if (corners.some((c) => pointInPolygon(c, polygon))) return true;

  return polygon.some(
    (p) =>
      Math.abs(p.xMm - footprint.centre.xMm) <= halfW && Math.abs(p.zMm - footprint.centre.zMm) <= halfD
  );
}

/* ── Collision detection ───────────────────────────────────────────────── */

export interface Collision {
  a: string;
  b: string;
  aName: string;
  bName: string;
  /** How deeply they overlap, on the shallower axis. */
  overlapMm: number;
}

/**
 * Overlapping furniture.
 *
 * Axis-aligned, which is the right trade here: a rotated banquet round is still
 * a circle, and a rotated rectangle's AABB only ever over-reports — and
 * over-reporting a possible clash is the safe direction. A tolerance stops
 * chairs tucked under a table from reading as a collision, because they are
 * meant to be there.
 */
export function findCollisions(footprints: ObjectFootprint[], toleranceMm = 40): Collision[] {
  const out: Collision[] = [];
  for (let i = 0; i < footprints.length; i += 1) {
    for (let j = i + 1; j < footprints.length; j += 1) {
      const a = footprints[i]!;
      const b = footprints[j]!;
      // Things at different heights cannot collide — a flown truss over a table
      // is a plan, not a clash.
      const aBottom = a.flown ? a.topMm - 400 : 0;
      const bBottom = b.flown ? b.topMm - 400 : 0;
      if (aBottom > b.topMm || bBottom > a.topMm) continue;

      const dx = Math.abs(a.centre.xMm - b.centre.xMm);
      const dz = Math.abs(a.centre.zMm - b.centre.zMm);
      const overlapX = (a.widthMm + b.widthMm) / 2 - dx;
      const overlapZ = (a.depthMm + b.depthMm) / 2 - dz;
      if (overlapX > toleranceMm && overlapZ > toleranceMm) {
        out.push({
          a: a.id,
          b: b.id,
          aName: a.name,
          bName: b.name,
          overlapMm: Math.round(Math.min(overlapX, overlapZ)),
        });
      }
    }
  }
  return out.sort((x, y) => y.overlapMm - x.overlapMm);
}

/** Mass estimates by object type, for the load and rigging figures. */
export const TYPICAL_WEIGHTS_KG: Record<string, number> = {
  chair: 4,
  table: 28,
  stage: 34,
  booth: 350,
  truss: 60,
  led: 300,
  curtain: 25,
  tent: 400,
  catalog: 20,
  shape: 5,
  text3d: 12,
  artwork: 8,
  light: 6,
  opening: 0,
  drawing: 0,
  constraint: 0,
  text: 0,
};

/** Centre of a constraint area, for placing its label. */
export function constraintCentre(points: WallPoint[]): Vec3 {
  if (!points.length) return { x: 0, y: 0, z: 0 };
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.xMm, z: acc.z + p.zMm }), { x: 0, z: 0 });
  return { x: Math.round(sum.x / points.length), y: 0, z: Math.round(sum.z / points.length) };
}

/** Objects that are flown rather than standing, by type. */
export function isFlownObject(object: SceneObject): boolean {
  if (object.type === 'truss') {
    return (object as SceneObject & { legType?: string }).legType === 'flown';
  }
  if (object.type === 'led') {
    return (object as SceneObject & { frame?: string }).frame === 'flown';
  }
  if (object.type === 'light') {
    return (object.positionMm?.y ?? 0) > 2200;
  }
  return false;
}
