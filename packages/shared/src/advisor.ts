/**
 * The layout assistant.
 *
 * Six checks the brief names: booth spacing, screen placement, sightlines,
 * crowd flow, fire safety, and generating a starting point from a description.
 * The first five are the same shape — read the plan, apply a rule someone would
 * otherwise apply from memory, and say what to do about it — so they share one
 * result type and one runner.
 *
 * Two things this module refuses to do:
 *
 * **It does not guess at rules.** Every threshold below is a published planning
 * figure or a widely used trade rule of thumb, and each finding says which one
 * it applied. A warning a planner cannot check is a warning they will learn to
 * ignore.
 *
 * **It does not silently fix anything.** Findings carry a suggested action and,
 * where the fix is mechanical, the exact change to make — but applying it is
 * always the planner's click. The plan belongs to them.
 */
import { pointInPolygon, polygonBounds, type ObjectFootprint } from './constraints.js';
import { deriveLedScreen } from './led.js';
import { polygonArea } from './walls.js';
import type {
  BoothSceneObject,
  ConstraintSceneObject,
  LedScreenSceneObject,
  SceneDocument,
  SceneObject,
  StageSceneObject,
  WallPoint,
} from './scene.js';

/* ── Findings ──────────────────────────────────────────────────────────── */

export const ADVICE_CATEGORIES = [
  'spacing',
  'screens',
  'sightlines',
  'flow',
  'safety',
  'accessibility',
  'comfort',
] as const;
export type AdviceCategory = (typeof ADVICE_CATEGORIES)[number];

export const ADVICE_CATEGORY_INFO: Record<AdviceCategory, { label: string; note: string; icon: string }> = {
  spacing: { label: 'Spacing', note: 'Gaps between stands, tables and structures.', icon: 'move-horizontal' },
  screens: { label: 'Screen placement', note: 'Whether the audience can actually read the screen.', icon: 'monitor' },
  sightlines: { label: 'Sightlines', note: 'What blocks the view of the stage.', icon: 'eye' },
  flow: { label: 'Crowd flow', note: 'How people move through the room.', icon: 'footprints' },
  safety: { label: 'Fire safety', note: 'Egress, exit width and travel distance.', icon: 'flame' },
  accessibility: { label: 'Accessibility', note: 'Step-free routes and wheelchair space.', icon: 'accessibility' },
  comfort: { label: 'Comfort', note: 'Density, service access and dwell space.', icon: 'sofa' },
};

export interface Advice {
  id: string;
  category: AdviceCategory;
  severity: 'error' | 'warning' | 'suggestion';
  title: string;
  /** What is wrong, in one sentence. */
  detail: string;
  /** What to do about it. */
  action: string;
  /** The rule this came from, so it can be checked or overridden. */
  rule: string;
  objectIds: string[];
  /** Where in the plan to look, for the "show me" control. */
  focusMm?: { x: number; z: number } | null;
}

export interface AdvisorReport {
  advice: Advice[];
  /** 0-100. A single number people can watch move as they fix things. */
  score: number;
  counts: { error: number; warning: number; suggestion: number };
  byCategory: Array<{ category: AdviceCategory; label: string; count: number }>;
}

/* ── Planning constants ────────────────────────────────────────────────── */

/**
 * Every figure here is a published allowance or a trade rule, named in the
 * `rule` field of any finding that uses it, so a planner can check it against
 * their own jurisdiction rather than trusting the software.
 */
export const PLANNING_RULES = {
  /** Minimum aisle between exhibition stands. */
  minAisleMm: 3000,
  /** Aisle on a main circulation route through a hall. */
  mainAisleMm: 4500,
  /** Clear gangway between banquet tables, chairs pulled out. */
  bannquetGangwayMm: 1370,
  /** Service gangway a waiter needs between table backs. */
  serviceGangwayMm: 1830,
  /** Clear width between rows of theatre seating. */
  theatreRowClearMm: 450,
  /** Clear width of an escape route per 100 people. */
  exitWidthPer100Mm: 500,
  /** Absolute minimum clear width of any escape route. */
  minExitWidthMm: 1050,
  /** Furthest anyone should be from an exit, in a room with one direction of travel. */
  maxTravelSingleMm: 18000,
  /** Furthest anyone should be from an exit, with two directions available. */
  maxTravelDualMm: 45000,
  /** Screens: nearest row, as a multiple of screen height. */
  minViewingHeightMultiple: 2,
  /** Screens: furthest row, as a multiple of screen height. */
  maxViewingHeightMultiple: 8,
  /** Screens: maximum horizontal angle off the centreline before the image skews. */
  maxOffAxisDeg: 45,
  /** Bottom of a screen above the floor, so row three can see row one's heads over it. */
  minScreenBottomMm: 1200,
  /** Eye height of a seated adult. */
  seatedEyeHeightMm: 1200,
  /** Eye height of a standing adult. */
  standingEyeHeightMm: 1550,
  /** Wheelchair turning circle. */
  wheelchairTurningMm: 1500,
  /** Standing density that starts to feel crowded, in people per square metre. */
  crowdedDensity: 2.5,
  /** Density at which movement through a crowd effectively stops. */
  crushDensity: 4,
} as const;

/* ── Footprints ────────────────────────────────────────────────────────── */

/**
 * Reduce the scene to the shape every check needs: a footprint, a height and
 * a mass. Doing it once here is what keeps the individual checks short enough
 * to read.
 */
export function footprintsFor(scene: SceneDocument): ObjectFootprint[] {
  const out: ObjectFootprint[] = [];
  for (const object of scene.objects) {
    if (object.hidden) continue;
    const centre: WallPoint = { xMm: object.positionMm.x, zMm: object.positionMm.z };
    const name = object.name ?? object.type;

    switch (object.type) {
      case 'catalog': {
        const item = object as SceneObject & {
          venueId?: number | null;
          dimensionsMm?: { width: number; depth: number; height: number };
        };
        if (item.venueId) continue;
        const d = item.dimensionsMm ?? { width: 600, depth: 600, height: 750 };
        out.push({ id: object.id, name, centre, widthMm: d.width, depthMm: d.depth, topMm: d.height, weightKg: 20, flown: false });
        break;
      }
      case 'booth': {
        const booth = object as BoothSceneObject;
        out.push({
          id: object.id,
          name: booth.exhibitorName || booth.standNumber || name,
          centre,
          widthMm: booth.widthMm,
          depthMm: booth.depthMm,
          topMm: booth.heightMm,
          weightKg: 350,
          flown: false,
        });
        break;
      }
      case 'stage': {
        const stage = object as StageSceneObject;
        out.push({
          id: object.id,
          name,
          centre,
          widthMm: stage.deckColumns * 1219,
          depthMm: stage.deckRows * 1219,
          topMm: stage.deckHeightMm,
          weightKg: 34 * stage.deckRows * stage.deckColumns,
          flown: false,
        });
        break;
      }
      case 'led': {
        const led = object as LedScreenSceneObject;
        const derived = deriveLedScreen(led);
        out.push({
          id: object.id,
          name,
          centre,
          widthMm: derived.widthMm,
          depthMm: Math.max(400, derived.panel.depthMm),
          topMm: derived.topMm,
          weightKg: derived.weightKg,
          flown: led.frame === 'flown',
        });
        break;
      }
      case 'truss': {
        const truss = object as SceneObject & {
          points?: WallPoint[];
          trimHeightMm?: number;
          legType?: string;
        };
        const points = truss.points ?? [];
        if (!points.length) continue;
        const bounds = polygonBounds(points);
        out.push({
          id: object.id,
          name,
          centre: {
            xMm: object.positionMm.x + (bounds.minX + bounds.maxX) / 2,
            zMm: object.positionMm.z + (bounds.minZ + bounds.maxZ) / 2,
          },
          widthMm: Math.max(300, bounds.maxX - bounds.minX),
          depthMm: Math.max(300, bounds.maxZ - bounds.minZ),
          topMm: truss.trimHeightMm ?? 4000,
          weightKg: 60,
          flown: truss.legType === 'flown',
        });
        break;
      }
      case 'tent': {
        const tent = object as SceneObject & { widthMm: number; lengthMm: number; peakHeightMm: number };
        out.push({ id: object.id, name, centre, widthMm: tent.widthMm, depthMm: tent.lengthMm, topMm: tent.peakHeightMm, weightKg: 400, flown: false });
        break;
      }
      case 'curtain': {
        const curtain = object as SceneObject & { middleWidthMm: number; heightMm: number };
        out.push({ id: object.id, name, centre, widthMm: curtain.middleWidthMm, depthMm: 400, topMm: curtain.heightMm, weightKg: 25, flown: false });
        break;
      }
      case 'light':
      case 'drawing':
      case 'constraint':
      case 'opening':
        break;
      default: {
        const generic = object as SceneObject & { widthMm?: number; depthMm?: number; heightMm?: number };
        out.push({
          id: object.id,
          name,
          centre,
          widthMm: generic.widthMm ?? 600,
          depthMm: generic.depthMm ?? 600,
          topMm: generic.heightMm ?? 600,
          weightKg: 10,
          flown: false,
        });
        break;
      }
    }
  }
  return out;
}

/* ── Individual checks ─────────────────────────────────────────────────── */

function gapBetween(a: ObjectFootprint, b: ObjectFootprint): number {
  const dx = Math.abs(a.centre.xMm - b.centre.xMm) - (a.widthMm + b.widthMm) / 2;
  const dz = Math.abs(a.centre.zMm - b.centre.zMm) - (a.depthMm + b.depthMm) / 2;
  // Diagonal neighbours are not in each other's way; take the larger clearance.
  return Math.max(dx, dz);
}

/** Booth and stand spacing: is there an aisle, and is it wide enough. */
export function checkSpacing(scene: SceneDocument, footprints: ObjectFootprint[]): Advice[] {
  const advice: Advice[] = [];
  const booths = scene.objects.filter((o): o is BoothSceneObject => o.type === 'booth' && !o.hidden);
  if (booths.length < 2) return advice;

  const boothPrints = footprints.filter((f) => booths.some((b) => b.id === f.id));

  const seen = new Set<string>();
  for (let i = 0; i < boothPrints.length; i += 1) {
    for (let j = i + 1; j < boothPrints.length; j += 1) {
      const a = boothPrints[i]!;
      const b = boothPrints[j]!;
      const gap = gapBetween(a, b);
      // Only neighbours matter; two stands 40 m apart share no aisle.
      if (gap > PLANNING_RULES.mainAisleMm * 2) continue;

      const key = [a.id, b.id].sort().join(':');
      if (seen.has(key)) continue;
      seen.add(key);

      if (gap < 0) {
        advice.push({
          id: `spacing-overlap-${key}`,
          category: 'spacing',
          severity: 'error',
          title: `${a.name} and ${b.name} overlap`,
          detail: `These two stands occupy the same ${Math.abs(Math.round(gap))} mm of floor.`,
          action: 'Move one stand clear, or reduce its footprint to the space actually sold.',
          rule: 'Stands may not encroach on a neighbour or an aisle.',
          objectIds: [a.id, b.id],
          focusMm: { x: (a.centre.xMm + b.centre.xMm) / 2, z: (a.centre.zMm + b.centre.zMm) / 2 },
        });
      } else if (gap > 100 && gap < PLANNING_RULES.minAisleMm) {
        advice.push({
          id: `spacing-narrow-${key}`,
          category: 'spacing',
          severity: 'warning',
          title: `Aisle between ${a.name} and ${b.name} is ${(gap / 1000).toFixed(2)} m`,
          detail: `An aisle below ${(PLANNING_RULES.minAisleMm / 1000).toFixed(1)} m stops two people passing a stand where someone has stopped to talk.`,
          action: `Open the gap to at least ${(PLANNING_RULES.minAisleMm / 1000).toFixed(1)} m, or ${(PLANNING_RULES.mainAisleMm / 1000).toFixed(1)} m if it is a main route.`,
          rule: `Minimum aisle ${(PLANNING_RULES.minAisleMm / 1000).toFixed(1)} m between stands.`,
          objectIds: [a.id, b.id],
          focusMm: { x: (a.centre.xMm + b.centre.xMm) / 2, z: (a.centre.zMm + b.centre.zMm) / 2 },
        });
      }
    }
  }

  /* Banquet gangways: tables are round and pull chairs out on every side. */
  const tables = footprints.filter((f) => {
    const object = scene.objects.find((o) => o.id === f.id);
    return object?.type === 'catalog' && Boolean((object as SceneObject & { tableShape?: string | null }).tableShape);
  });
  const tight: string[] = [];
  for (let i = 0; i < tables.length; i += 1) {
    for (let j = i + 1; j < tables.length; j += 1) {
      const gap = gapBetween(tables[i]!, tables[j]!);
      if (gap >= 0 && gap < PLANNING_RULES.bannquetGangwayMm) {
        tight.push(tables[i]!.id, tables[j]!.id);
      }
    }
  }
  if (tight.length) {
    const unique = [...new Set(tight)];
    advice.push({
      id: 'spacing-banquet',
      category: 'spacing',
      severity: 'warning',
      title: `${unique.length} tables are closer than ${(PLANNING_RULES.bannquetGangwayMm / 1000).toFixed(2)} m apart`,
      detail: 'Once chairs are pulled out, guests cannot get past and service cannot reach the table.',
      action: `Space table edges at least ${(PLANNING_RULES.bannquetGangwayMm / 1000).toFixed(2)} m apart, or ${(PLANNING_RULES.serviceGangwayMm / 1000).toFixed(2)} m where waiting staff need to pass.`,
      rule: 'Banquet gangway: 1370 mm between chair backs, 1830 mm on a service route.',
      objectIds: unique,
      focusMm: null,
    });
  }

  return advice;
}

/** Screen placement: distance, angle and height from where people sit. */
export function checkScreens(scene: SceneDocument, footprints: ObjectFootprint[]): Advice[] {
  const advice: Advice[] = [];
  const screens = scene.objects.filter((o): o is LedScreenSceneObject => o.type === 'led' && !o.hidden);
  if (!screens.length) return advice;

  const seats = footprints.filter((f) => {
    const object = scene.objects.find((o) => o.id === f.id);
    if (object?.type !== 'catalog') return false;
    const name = (object.name ?? '').toLowerCase();
    return /chair|seat|stool|bench/.test(name);
  });

  for (const screen of screens) {
    const derived = deriveLedScreen(screen);
    const screenHeight = derived.heightMm;

    if (screen.bottomMm < PLANNING_RULES.minScreenBottomMm && screen.frame !== 'floor') {
      advice.push({
        id: `screen-low-${screen.id}`,
        category: 'screens',
        severity: 'warning',
        title: `${screen.name ?? 'Screen'} sits ${screen.bottomMm} mm off the floor`,
        detail: `Anyone past the third row will be looking at the back of the heads in front of them, not the bottom of the image.`,
        action: `Raise the bottom of the image to at least ${PLANNING_RULES.minScreenBottomMm} mm, or ${PLANNING_RULES.minScreenBottomMm + 600} mm for a flat-floor room of more than six rows.`,
        rule: 'Bottom of image 1200 mm minimum above a flat floor.',
        objectIds: [screen.id],
        focusMm: { x: screen.positionMm.x, z: screen.positionMm.z },
      });
    }

    if (!seats.length) continue;

    const distances = seats.map((seat) =>
      Math.hypot(seat.centre.xMm - screen.positionMm.x, seat.centre.zMm - screen.positionMm.z)
    );
    const nearest = Math.min(...distances);
    const furthest = Math.max(...distances);

    if (nearest < screenHeight * PLANNING_RULES.minViewingHeightMultiple) {
      advice.push({
        id: `screen-near-${screen.id}`,
        category: 'screens',
        severity: 'warning',
        title: 'Front row is too close to the screen',
        detail: `The nearest seat is ${(nearest / 1000).toFixed(1)} m from a ${(screenHeight / 1000).toFixed(1)} m screen. Anything closer than ${((screenHeight * 2) / 1000).toFixed(1)} m means craning to see the top.`,
        action: `Pull the front row back to at least ${((screenHeight * 2) / 1000).toFixed(1)} m, or use a shorter screen.`,
        rule: 'Nearest viewer: 2 × screen height.',
        objectIds: [screen.id, ...seats.filter((_, i) => distances[i]! === nearest).map((s) => s.id)],
        focusMm: { x: screen.positionMm.x, z: screen.positionMm.z },
      });
    }

    if (furthest > screenHeight * PLANNING_RULES.maxViewingHeightMultiple) {
      advice.push({
        id: `screen-far-${screen.id}`,
        category: 'screens',
        severity: 'warning',
        title: 'Back row is too far from the screen',
        detail: `The furthest seat is ${(furthest / 1000).toFixed(1)} m away. Beyond ${((screenHeight * 8) / 1000).toFixed(1)} m a ${(screenHeight / 1000).toFixed(1)} m screen cannot carry readable text.`,
        action: `Add a delay screen further back, or make the main screen at least ${((furthest / 8000) * 1000).toFixed(0)} mm tall.`,
        rule: 'Furthest viewer: 8 × screen height for detailed content.',
        objectIds: [screen.id],
        focusMm: { x: screen.positionMm.x, z: screen.positionMm.z },
      });
    }

    // Seats a long way off the centreline get a skewed, dim image.
    const yaw = (screen.rotationDeg.y * Math.PI) / 180;
    const normal = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const offAxis = seats.filter((seat) => {
      const dx = seat.centre.xMm - screen.positionMm.x;
      const dz = seat.centre.zMm - screen.positionMm.z;
      const distance = Math.hypot(dx, dz) || 1;
      const cos = Math.abs((dx * normal.x + dz * normal.z) / distance);
      const angle = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
      return angle > PLANNING_RULES.maxOffAxisDeg;
    });
    if (offAxis.length > seats.length * 0.15) {
      advice.push({
        id: `screen-angle-${screen.id}`,
        category: 'screens',
        severity: 'suggestion',
        title: `${offAxis.length} seats are more than ${PLANNING_RULES.maxOffAxisDeg}° off the screen axis`,
        detail: 'At that angle an LED wall loses brightness and the image skews. Those guests are effectively watching a different screen.',
        action: 'Narrow the seating block, angle the outer sections inward, or add side screens.',
        rule: `Viewing cone: ${PLANNING_RULES.maxOffAxisDeg}° either side of the screen normal.`,
        objectIds: [screen.id, ...offAxis.slice(0, 20).map((s) => s.id)],
        focusMm: { x: screen.positionMm.x, z: screen.positionMm.z },
      });
    }
  }
  return advice;
}

/** Sightlines: what stands between the audience and the stage. */
export function checkSightlines(scene: SceneDocument, footprints: ObjectFootprint[]): Advice[] {
  const advice: Advice[] = [];
  const stage = scene.objects.find((o): o is StageSceneObject => o.type === 'stage' && !o.hidden);
  const screen = scene.objects.find((o): o is LedScreenSceneObject => o.type === 'led' && !o.hidden);
  const focus = stage ?? screen;
  if (!focus) return advice;

  const focusPoint = { x: focus.positionMm.x, z: focus.positionMm.z };
  const focusTop =
    focus.type === 'stage'
      ? (focus as StageSceneObject).deckHeightMm + 1700
      : deriveLedScreen(focus as LedScreenSceneObject).topMm;

  const seats = footprints.filter((f) => {
    const object = scene.objects.find((o) => o.id === f.id);
    if (object?.type !== 'catalog') return false;
    return /chair|seat|stool|bench/i.test(object.name ?? '');
  });

  /*
   * Blockers are anything tall enough to cut the line from a seated eye to the
   * stage: columns, drapes, tall stands, ground-stacked speakers. Truss legs
   * count; a flown truss does not, because nobody looks up at it.
   */
  const blockers = footprints.filter((f) => {
    if (f.flown) return false;
    if (f.topMm < PLANNING_RULES.seatedEyeHeightMm) return false;
    if (f.id === focus.id) return false;
    const object = scene.objects.find((o) => o.id === f.id);
    return object?.type !== 'catalog' || f.topMm > 1400;
  });

  const columns = scene.objects.filter(
    (o): o is ConstraintSceneObject => o.type === 'constraint' && (o as ConstraintSceneObject).constraintKind === 'no-build'
  );

  const blocked = new Map<string, string[]>();
  for (const seat of seats) {
    for (const blocker of blockers) {
      if (segmentIntersectsBox(seat.centre, { xMm: focusPoint.x, zMm: focusPoint.z }, blocker)) {
        const list = blocked.get(blocker.id) ?? [];
        list.push(seat.id);
        blocked.set(blocker.id, list);
      }
    }
  }

  for (const [blockerId, seatIds] of blocked) {
    const blocker = blockers.find((b) => b.id === blockerId)!;
    advice.push({
      id: `sightline-${blockerId}`,
      category: 'sightlines',
      severity: seatIds.length > seats.length * 0.1 ? 'warning' : 'suggestion',
      title: `${blocker.name} blocks the view from ${seatIds.length} seat${seatIds.length === 1 ? '' : 's'}`,
      detail: `At ${(blocker.topMm / 1000).toFixed(2)} m it sits above seated eye height (${PLANNING_RULES.seatedEyeHeightMm} mm) on the line to the ${focus.type === 'stage' ? 'stage' : 'screen'}.`,
      action: 'Move it out of the viewing cone, lower it below 1.2 m, or reseat those places.',
      rule: 'Seated eye height 1200 mm; nothing above it inside the viewing cone.',
      objectIds: [blockerId, ...seatIds.slice(0, 30)],
      focusMm: { x: blocker.centre.xMm, z: blocker.centre.zMm },
    });
  }

  if (columns.length && seats.length) {
    advice.push({
      id: 'sightline-columns',
      category: 'sightlines',
      severity: 'suggestion',
      title: `${columns.length} structural column${columns.length === 1 ? '' : 's'} in the room`,
      detail: 'Columns cannot be moved, so the seating has to work around them rather than the other way round.',
      action: 'Leave the seats directly behind each column empty, or use them for service stations and cameras.',
      rule: 'Columns break sightlines; plan the layout around them.',
      objectIds: columns.map((c) => c.id),
      focusMm: null,
    });
  }

  // A stage everyone has to look up at is as bad as one they cannot see over.
  if (stage && seats.length) {
    const nearest = Math.min(
      ...seats.map((s) => Math.hypot(s.centre.xMm - focusPoint.x, s.centre.zMm - focusPoint.z))
    );
    const rise = focusTop - PLANNING_RULES.seatedEyeHeightMm;
    const angle = (Math.atan2(rise, Math.max(1, nearest)) * 180) / Math.PI;
    if (angle > 30) {
      advice.push({
        id: 'sightline-stage-angle',
        category: 'sightlines',
        severity: 'warning',
        title: `Front row looks up at ${Math.round(angle)}° to the stage`,
        detail: `A ${(stage.deckHeightMm / 1000).toFixed(2)} m stage ${(nearest / 1000).toFixed(1)} m from the front row is uncomfortable for a whole session.`,
        action: 'Pull the front row back, or lower the deck. Above 30° people stop looking up and start looking at their phones.',
        rule: 'Comfortable upward viewing angle: 30° maximum.',
        objectIds: [stage.id],
        focusMm: { x: focusPoint.x, z: focusPoint.z },
      });
    }
  }

  return advice;
}

/** Crowd flow: density, pinch points and dead ends. */
export function checkFlow(scene: SceneDocument, footprints: ObjectFootprint[]): Advice[] {
  const advice: Advice[] = [];
  const floorAreaSqM = scene.walls.floors.reduce((sum, f) => sum + polygonArea(f.points) / 1_000_000, 0);
  if (floorAreaSqM <= 0) return advice;

  const occupiedSqM = footprints.reduce((sum, f) => sum + (f.widthMm * f.depthMm) / 1_000_000, 0);
  const clearSqM = Math.max(0, floorAreaSqM - occupiedSqM);
  const clearShare = clearSqM / floorAreaSqM;

  if (clearShare < 0.35) {
    advice.push({
      id: 'flow-density',
      category: 'flow',
      severity: clearShare < 0.25 ? 'warning' : 'suggestion',
      title: `Only ${Math.round(clearShare * 100)} % of the floor is clear`,
      detail: `${occupiedSqM.toFixed(0)} m² of ${floorAreaSqM.toFixed(0)} m² is occupied. Below about 35 % clear, people stop being able to move around the room freely.`,
      action: 'Remove or shrink something, or take the same content into a larger space.',
      rule: 'Keep at least a third of the floor clear for circulation.',
      objectIds: [],
      focusMm: null,
    });
  }

  // Standing capacity against clear floor: the number that decides whether a
  // reception feels busy or feels like a crush.
  const standingCapacity = Math.floor(clearSqM / 0.65);
  if (standingCapacity > 0) {
    const seats = footprints.filter((f) => /chair|seat|stool/i.test(f.name)).length;
    if (seats > standingCapacity) {
      advice.push({
        id: 'flow-seats-over-capacity',
        category: 'comfort',
        severity: 'warning',
        title: `${seats} seats in a room that comfortably holds ${standingCapacity}`,
        detail: 'The seat count is above what the clear floor supports once circulation is allowed for.',
        action: 'Reduce the seat count, or reconfigure to a denser layout such as theatre style.',
        rule: 'Standing allowance 0.65 m² per person, net of furniture.',
        objectIds: [],
        focusMm: null,
      });
    }
  }

  // A single doorway into a large room is the classic queue at the entrance.
  const doors = scene.objects.filter((o) => o.type === 'opening' && (o as SceneObject & { openingKind: string }).openingKind === 'door');
  if (floorAreaSqM > 200 && doors.length === 1) {
    advice.push({
      id: 'flow-single-entrance',
      category: 'flow',
      severity: 'suggestion',
      title: 'One doorway serves the whole room',
      detail: `A ${floorAreaSqM.toFixed(0)} m² room with a single entrance queues at the door on arrival and again at the break.`,
      action: 'Open a second entrance, or stagger arrival and break times.',
      rule: 'Rooms above 200 m² should have more than one way in.',
      objectIds: doors.map((d) => d.id),
      focusMm: null,
    });
  }

  return advice;
}

/** Fire safety: exits, widths and travel distance. */
export function checkSafety(scene: SceneDocument, footprints: ObjectFootprint[]): Advice[] {
  const advice: Advice[] = [];

  const exits = scene.objects.filter(
    (o): o is ConstraintSceneObject => o.type === 'constraint' && (o as ConstraintSceneObject).constraintKind === 'exit'
  );
  const doors = scene.objects.filter(
    (o) => o.type === 'opening' && (o as SceneObject & { openingKind: string }).openingKind === 'door'
  );

  const floorAreaSqM = scene.walls.floors.reduce((sum, f) => sum + polygonArea(f.points) / 1_000_000, 0);
  const occupancy = Math.max(
    footprints.filter((f) => /chair|seat|stool|bench/i.test(f.name)).length,
    Math.floor(floorAreaSqM / 0.65)
  );

  if (occupancy === 0) return advice;

  const exitWidthMm =
    exits.reduce((sum, e) => sum + (e.clearWidthMm ?? 0), 0) ||
    doors.reduce((sum, d) => sum + ((d as SceneObject & { widthMm?: number }).widthMm ?? 0), 0);

  const requiredWidthMm = Math.max(
    PLANNING_RULES.minExitWidthMm,
    Math.ceil((occupancy / 100) * PLANNING_RULES.exitWidthPer100Mm)
  );

  if (exitWidthMm === 0) {
    advice.push({
      id: 'safety-no-exit',
      category: 'safety',
      severity: 'error',
      title: 'No exits are marked',
      detail: `A room planned for about ${occupancy} people has no exit or door recorded, so egress cannot be checked at all.`,
      action: 'Add the venue exits from the Site layer, with the clear width of each.',
      rule: 'Every assembly space must have marked, measured escape routes.',
      objectIds: [],
      focusMm: null,
    });
  } else if (exitWidthMm < requiredWidthMm) {
    advice.push({
      id: 'safety-exit-width',
      category: 'safety',
      severity: 'error',
      title: `Exit width ${(exitWidthMm / 1000).toFixed(2)} m is below the ${(requiredWidthMm / 1000).toFixed(2)} m needed`,
      detail: `About ${occupancy} people need ${PLANNING_RULES.exitWidthPer100Mm} mm of clear escape width per 100 occupants.`,
      action: 'Open more exits, widen the routes, or reduce the planned occupancy.',
      rule: `Escape width: ${PLANNING_RULES.exitWidthPer100Mm} mm per 100 people, minimum ${PLANNING_RULES.minExitWidthMm} mm.`,
      objectIds: exits.map((e) => e.id),
      focusMm: null,
    });
  }

  const exitCount = exits.length || doors.length;
  if (occupancy > 60 && exitCount < 2) {
    advice.push({
      id: 'safety-exit-count',
      category: 'safety',
      severity: 'error',
      title: 'Only one escape route',
      detail: `${occupancy} people with a single way out means a fire at that exit traps the room.`,
      action: 'Provide a second exit remote from the first, ideally on a different wall.',
      rule: 'More than 60 occupants normally requires two independent exits.',
      objectIds: [],
      focusMm: null,
    });
  }

  // Travel distance: furthest seat to nearest exit.
  const exitPoints: WallPoint[] = [
    ...exits.map((e) => {
      const bounds = polygonBounds(e.points.length ? e.points : [{ xMm: e.positionMm.x, zMm: e.positionMm.z }]);
      return { xMm: (bounds.minX + bounds.maxX) / 2, zMm: (bounds.minZ + bounds.maxZ) / 2 };
    }),
    ...doors.map((d) => ({ xMm: d.positionMm.x, zMm: d.positionMm.z })),
  ];
  if (exitPoints.length) {
    const limit = exitCount >= 2 ? PLANNING_RULES.maxTravelDualMm : PLANNING_RULES.maxTravelSingleMm;
    let worst = 0;
    let worstId = '';
    for (const seat of footprints) {
      const nearest = Math.min(...exitPoints.map((p) => Math.hypot(p.xMm - seat.centre.xMm, p.zMm - seat.centre.zMm)));
      if (nearest > worst) {
        worst = nearest;
        worstId = seat.id;
      }
    }
    if (worst > limit) {
      advice.push({
        id: 'safety-travel-distance',
        category: 'safety',
        severity: 'warning',
        title: `Furthest point is ${(worst / 1000).toFixed(0)} m from an exit`,
        detail: `With ${exitCount} exit${exitCount === 1 ? '' : 's'}, travel distance should stay under ${(limit / 1000).toFixed(0)} m.`,
        action: 'Add an exit nearer that end of the room, or move the furthest seating closer in.',
        rule: `Travel distance: ${(PLANNING_RULES.maxTravelSingleMm / 1000).toFixed(0)} m in one direction, ${(PLANNING_RULES.maxTravelDualMm / 1000).toFixed(0)} m where two are available.`,
        objectIds: worstId ? [worstId] : [],
        focusMm: null,
      });
    }
  }

  // Anything standing inside an exit zone.
  for (const exit of exits) {
    if (exit.points.length < 3) continue;
    const blocking = footprints.filter((f) => pointInPolygon(f.centre, exit.points));
    if (blocking.length) {
      advice.push({
        id: `safety-blocked-${exit.id}`,
        category: 'safety',
        severity: 'error',
        title: `${exit.label || 'Fire exit'} is obstructed`,
        detail: `${blocking.length} item${blocking.length === 1 ? '' : 's'} stand in the escape route.`,
        action: 'Clear the route completely. Escape routes are checked on site and a blocked one stops the event.',
        rule: 'Escape routes must be kept entirely clear.',
        objectIds: blocking.map((b) => b.id),
        focusMm: { x: exit.positionMm.x, z: exit.positionMm.z },
      });
    }
  }

  return advice;
}

/** Accessibility: step-free routes and wheelchair space. */
export function checkAccessibility(scene: SceneDocument, footprints: ObjectFootprint[]): Advice[] {
  const advice: Advice[] = [];

  const stages = scene.objects.filter((o): o is StageSceneObject => o.type === 'stage' && !o.hidden);
  for (const stage of stages) {
    if (stage.deckHeightMm > 0 && stage.stairSides.length === 0) {
      advice.push({
        id: `access-stage-${stage.id}`,
        category: 'accessibility',
        severity: 'warning',
        title: 'Stage has no way up',
        detail: `A ${(stage.deckHeightMm / 1000).toFixed(2)} m deck with no stairs or ramp cannot be reached by any speaker.`,
        action: `Add stairs, and a ramp at 1:12 — ${((stage.deckHeightMm * 12) / 1000).toFixed(1)} m of run — if a wheelchair user is presenting.`,
        rule: 'Ramps at 1:12 for step-free access to a raised platform.',
        objectIds: [stage.id],
        focusMm: { x: stage.positionMm.x, z: stage.positionMm.z },
      });
    }
  }

  const booths = scene.objects.filter((o): o is BoothSceneObject => o.type === 'booth' && !o.hidden);
  for (const booth of booths) {
    if (booth.platformHeightMm > 20) {
      advice.push({
        id: `access-booth-${booth.id}`,
        category: 'accessibility',
        severity: 'suggestion',
        title: `${booth.standNumber || booth.name || 'Stand'} has a ${booth.platformHeightMm} mm raised floor`,
        detail: 'A raised stand floor is a step, and a step excludes visitors who cannot take one.',
        action: `Add an edge ramp — ${((booth.platformHeightMm * 12) / 1000).toFixed(2)} m of run at 1:12 — on at least one open side.`,
        rule: 'Raised stand floors need a ramp on an aisle side.',
        objectIds: [booth.id],
        focusMm: { x: booth.positionMm.x, z: booth.positionMm.z },
      });
    }
  }

  const tables = footprints.filter((f) => {
    const object = scene.objects.find((o) => o.id === f.id);
    return object?.type === 'catalog' && Boolean((object as SceneObject & { tableShape?: string | null }).tableShape);
  });
  if (tables.length >= 4) {
    advice.push({
      id: 'access-wheelchair-space',
      category: 'accessibility',
      severity: 'suggestion',
      title: 'Plan a wheelchair space at the tables',
      detail: `A wheelchair user needs a ${PLANNING_RULES.wheelchairTurningMm} mm turning circle and a place at the table with a chair removed.`,
      action: 'Choose the tables nearest an accessible route, and leave one seat position clear at each.',
      rule: 'Wheelchair turning circle 1500 mm; one clear place setting per accessible table.',
      objectIds: [],
      focusMm: null,
    });
  }

  return advice;
}

/* ── Runner ────────────────────────────────────────────────────────────── */

/**
 * Run every check.
 *
 * The score is deliberately blunt: errors cost 12 points, warnings 5, and
 * suggestions 1, floored at zero. It exists to be watched moving while someone
 * fixes things, not to be a precise measure of anything.
 */
export function advise(scene: SceneDocument): AdvisorReport {
  const footprints = footprintsFor(scene);
  const advice = [
    ...checkSafety(scene, footprints),
    ...checkSightlines(scene, footprints),
    ...checkScreens(scene, footprints),
    ...checkSpacing(scene, footprints),
    ...checkFlow(scene, footprints),
    ...checkAccessibility(scene, footprints),
  ];

  const counts = {
    error: advice.filter((a) => a.severity === 'error').length,
    warning: advice.filter((a) => a.severity === 'warning').length,
    suggestion: advice.filter((a) => a.severity === 'suggestion').length,
  };

  const score = Math.max(0, 100 - counts.error * 12 - counts.warning * 5 - counts.suggestion * 1);

  const byCategory = ADVICE_CATEGORIES.map((category) => ({
    category,
    label: ADVICE_CATEGORY_INFO[category].label,
    count: advice.filter((a) => a.category === category).length,
  })).filter((c) => c.count > 0);

  return { advice, score, counts, byCategory };
}

/* ── Geometry ──────────────────────────────────────────────────────────── */

/** Does the line from a to b pass through the footprint's box? */
function segmentIntersectsBox(a: WallPoint, b: WallPoint, box: ObjectFootprint): boolean {
  const halfW = box.widthMm / 2;
  const halfD = box.depthMm / 2;
  const minX = box.centre.xMm - halfW;
  const maxX = box.centre.xMm + halfW;
  const minZ = box.centre.zMm - halfD;
  const maxZ = box.centre.zMm + halfD;

  // Liang–Barsky against the axis-aligned box.
  const dx = b.xMm - a.xMm;
  const dz = b.zMm - a.zMm;
  let t0 = 0;
  let t1 = 1;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  return (
    clip(-dx, a.xMm - minX) &&
    clip(dx, maxX - a.xMm) &&
    clip(-dz, a.zMm - minZ) &&
    clip(dz, maxZ - a.zMm)
  );
}
