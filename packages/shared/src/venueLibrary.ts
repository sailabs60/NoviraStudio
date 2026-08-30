/**
 * Venue intelligence.
 *
 * The brief's claim is precise: with this, an agency does not need a site visit
 * to pitch. That only holds if the library carries the things a site visit is
 * actually for — ceiling height under the beam rather than at the ridge, where
 * the pillars are, what the floor will carry, how big a truck can get to the
 * door, and where the power lands.
 *
 * So a venue record here is a *specification*, not a name and a photograph.
 * Every field below is something an agency currently rings the venue to ask,
 * and every one of them is a number a design decision depends on.
 */
import type { WallPoint } from './scene.js';
import type { ConstraintData } from './constraints.js';
import { constraintDefaults } from './constraints.js';

export const VENUE_SPACE_TYPES = [
  'ballroom',
  'exhibition-hall',
  'conference-room',
  'auditorium',
  'outdoor',
  'marquee-site',
  'warehouse',
  'atrium',
  'restaurant',
  'arena',
] as const;
export type VenueSpaceType = (typeof VENUE_SPACE_TYPES)[number];

export const VENUE_SPACE_LABELS: Record<VenueSpaceType, string> = {
  ballroom: 'Ballroom',
  'exhibition-hall': 'Exhibition hall',
  'conference-room': 'Conference room',
  auditorium: 'Auditorium',
  outdoor: 'Outdoor space',
  'marquee-site': 'Marquee site',
  warehouse: 'Warehouse / raw space',
  atrium: 'Atrium',
  restaurant: 'Restaurant / private dining',
  arena: 'Arena',
};

/* ── Access ────────────────────────────────────────────────────────────── */

export interface VenueAccess {
  /** Largest vehicle that can reach the loading point. */
  vehicle: 'van' | 'box-truck' | 'rigid' | 'articulated';
  /** Clear width and height of the loading door. */
  doorWidthMm: number;
  doorHeightMm: number;
  /** Whether the loading bay is level with the truck bed. */
  dockLevel: boolean;
  /** Distance from where a truck stops to where the build happens. */
  pushDistanceMm: number;
  /** Lift dimensions, where the space is not on the ground floor. */
  liftWidthMm: number | null;
  liftDepthMm: number | null;
  liftHeightMm: number | null;
  liftCapacityKg: number | null;
  /** Steps or a ramp on the route in. */
  stepFree: boolean;
  notes: string;
}

/* ── Structure ─────────────────────────────────────────────────────────── */

export interface VenueStructure {
  /** Clear height under the lowest obstruction, not the ridge. This is the
   *  number that decides whether a build fits, and the one venues quote least
   *  accurately. */
  clearHeightMm: number;
  /** Height at the highest point, for context. */
  maxHeightMm: number;
  /** Whether anything may be rigged from the structure at all. */
  riggingAllowed: boolean;
  /** Total safe working load across all points. */
  totalRiggingCapacityKg: number | null;
  /** Load the floor carries, distributed. */
  floorLoadKgSqM: number | null;
  /** Point load limit, for a forklift or a heavy stand leg. */
  pointLoadKg: number | null;
  /** Pillar positions in plan, relative to the space origin. */
  columns: Array<{ xMm: number; zMm: number; widthMm: number; depthMm: number }>;
  /** Whether the floor is level; a raked or sloping floor changes everything. */
  levelFloor: boolean;
  floorSurface: 'carpet' | 'concrete' | 'timber' | 'tile' | 'grass' | 'tarmac' | 'raised-access';
  /** Whether fixings into the floor or walls are permitted. */
  fixingsAllowed: boolean;
}

/* ── Services ──────────────────────────────────────────────────────────── */

export interface VenueServices {
  /** Total power available, in amps at the stated phase. */
  powerAmps: number;
  powerPhases: 1 | 3;
  powerVoltage: number;
  /** Where the supplies land. */
  powerPoints: Array<{ xMm: number; zMm: number; amps: number; phases: 1 | 3; label: string }>;
  /** Whether a generator can be brought in and parked. */
  generatorAccess: boolean;
  waterAvailable: boolean;
  wifiBandwidthMbps: number | null;
  /** Whether the space has house lighting that can be dimmed or turned off. */
  dimmableHouseLights: boolean;
  /** Whether the venue permits haze, which decides whether beams read at all. */
  hazeAllowed: boolean;
  soundLimitDb: number | null;
}

/* ── Rules ─────────────────────────────────────────────────────────────── */

export interface VenueRules {
  /** Latest the build can run to, in 24-hour local time. */
  buildCurfew: string | null;
  /** Earliest the build can start. */
  buildFrom: string | null;
  /** Whether an in-house supplier must be used for a trade. */
  exclusiveSuppliers: string[];
  /** Whether the venue charges for a nominated external supplier. */
  externalSupplierFee: boolean;
  /** Naked-flame, confetti and pyrotechnic policy. */
  flameAllowed: boolean;
  confettiAllowed: boolean;
  /** Notes an agency needs before quoting. */
  notes: string[];
}

/* ── Capacity ──────────────────────────────────────────────────────────── */

export interface VenueCapacityTable {
  theatre: number;
  banquet: number;
  cabaret: number;
  classroom: number;
  cocktail: number;
  boardroom: number;
  /** Stands of the region's standard module that fit on the floor. */
  exhibitionStands: number;
}

/* ── The record ────────────────────────────────────────────────────────── */

/**
 * A horizontal surface in the building, found in its own geometry.
 *
 * This is what turns a 3D model from scenery into a venue. Without it every
 * object dropped into a building lands at the world origin — which for a model
 * whose ground floor sits 200 mm up, or whose mezzanine is at 2.9 m, means the
 * furniture is inside the slab and the user concludes the drop failed.
 *
 * Detected rather than authored: the importer measures every upward-facing
 * triangle, totals the area at each height, and keeps the heights with enough
 * floor to stand on and enough headroom above to stand *in*. The names are
 * suggested and always editable, because geometry knows where the floors are
 * and not what they are called.
 */
export interface VenueFloorLevel {
  id: string;
  name: string;
  /** Height above the model's own origin, in millimetres. */
  elevationMm: number;
  /** How much floor there is at this level. */
  areaSqM: number;
  /** Extent of that surface, as a sanity check against the room's own size. */
  widthMm: number;
  depthMm: number;
  /** Clear height to whatever is above, where it could be measured. */
  clearHeightMm?: number | null;
  /** The level new objects land on by default. */
  isDefault?: boolean;
}

export interface VenueSpec {
  id: number | null;
  name: string;
  /** The building; a venue may have many spaces. */
  buildingName: string;
  spaceType: VenueSpaceType;
  city: string;
  country: string;
  regionCode: string;
  /** Footprint. Rectangular by default; `outline` overrides for odd shapes. */
  widthMm: number;
  depthMm: number;
  outline: WallPoint[] | null;
  areaSqM: number;
  structure: VenueStructure;
  access: VenueAccess;
  services: VenueServices;
  rules: VenueRules;
  capacity: VenueCapacityTable;
  /** A generated or uploaded 3D shell, where one exists. */
  modelUrl: string | null;
  /**
   * The floors found in that model, lowest first.
   *
   * Empty for a venue with no model, or one whose geometry had no surface big
   * enough to stand on — in which case placement falls back to the ground
   * plane, exactly as it behaves without a venue.
   */
  floorLevels: VenueFloorLevel[];
  /**
   * Facts about the imported model, kept so the UI can be honest about what
   * it did to the file rather than silently changing it.
   */
  modelFacts?: {
    triangleCount: number;
    bytesBefore: number;
    bytesAfter: number;
    unitScale: number;
    convertedFrom?: string;
  } | null;
  previewUrl: string | null;
  floorPlanUrl: string | null;
  /** Who maintains this record. */
  scope: 'global' | 'company' | 'personal';
  verified: boolean;
  /** Last time someone confirmed these figures against the building. */
  verifiedAt: string | null;
  sourceNote: string;
}

/** Area allowances used to derive a capacity table from a footprint. */
const CAPACITY_ALLOWANCE_SQ_M = {
  theatre: 0.75,
  banquet: 1.55,
  cabaret: 1.75,
  classroom: 1.9,
  cocktail: 0.65,
  boardroom: 2.6,
} as const;

/**
 * Derive the capacity table from the geometry.
 *
 * Venues publish capacity numbers that are, charitably, optimistic — they are
 * computed on a clear rectangle with no columns, no stage and no bar. Deriving
 * them here from the actual usable area means the figure shown beside a venue
 * is the figure the room will really take once the event is in it.
 */
export function deriveVenueCapacity(spec: Pick<VenueSpec, 'widthMm' | 'depthMm' | 'structure' | 'regionCode'>): VenueCapacityTable {
  const areaSqM = (spec.widthMm * spec.depthMm) / 1_000_000;

  // Circulation and back-of-house, before any seating is laid out.
  const circulation = areaSqM < 100 ? 0.28 : areaSqM < 300 ? 0.24 : areaSqM < 800 ? 0.2 : 0.18;
  // Each column sterilises roughly a square metre and breaks the sightline
  // behind it, which costs more seats than it costs floor.
  const columnLoss = spec.structure.columns.length * 1.6;
  const net = Math.max(0, areaSqM * (1 - circulation) - columnLoss);

  const module = spec.regionCode === 'north-america' ? 3.048 * 3.048 : 9;
  // Stands need their aisles as well as their floor: roughly 1.9 m² of aisle
  // per square metre of stand on a typical hall plan.
  const standFootprint = module * 1.9;

  return {
    theatre: Math.floor(net / CAPACITY_ALLOWANCE_SQ_M.theatre),
    banquet: Math.floor(net / CAPACITY_ALLOWANCE_SQ_M.banquet),
    cabaret: Math.floor(net / CAPACITY_ALLOWANCE_SQ_M.cabaret),
    classroom: Math.floor(net / CAPACITY_ALLOWANCE_SQ_M.classroom),
    cocktail: Math.floor(net / CAPACITY_ALLOWANCE_SQ_M.cocktail),
    boardroom: Math.floor(net / CAPACITY_ALLOWANCE_SQ_M.boardroom),
    exhibitionStands: Math.floor(areaSqM / standFootprint),
  };
}

export function emptyVenueSpec(regionCode = 'global'): VenueSpec {
  return {
    id: null,
    name: '',
    buildingName: '',
    spaceType: 'ballroom',
    city: '',
    country: '',
    regionCode,
    widthMm: 24_000,
    depthMm: 16_000,
    outline: null,
    areaSqM: 384,
    structure: {
      clearHeightMm: 5000,
      maxHeightMm: 6000,
      riggingAllowed: true,
      totalRiggingCapacityKg: 2000,
      floorLoadKgSqM: 500,
      pointLoadKg: 1500,
      columns: [],
      levelFloor: true,
      floorSurface: 'carpet',
      fixingsAllowed: false,
    },
    access: {
      vehicle: 'rigid',
      doorWidthMm: 2400,
      doorHeightMm: 2600,
      dockLevel: false,
      pushDistanceMm: 30_000,
      liftWidthMm: null,
      liftDepthMm: null,
      liftHeightMm: null,
      liftCapacityKg: null,
      stepFree: true,
      notes: '',
    },
    services: {
      powerAmps: 63,
      powerPhases: 3,
      powerVoltage: 400,
      powerPoints: [],
      generatorAccess: true,
      waterAvailable: false,
      wifiBandwidthMbps: null,
      dimmableHouseLights: true,
      hazeAllowed: true,
      soundLimitDb: null,
    },
    rules: {
      buildCurfew: null,
      buildFrom: null,
      exclusiveSuppliers: [],
      externalSupplierFee: false,
      flameAllowed: false,
      confettiAllowed: false,
      notes: [],
    },
    capacity: {
      theatre: 0,
      banquet: 0,
      cabaret: 0,
      classroom: 0,
      cocktail: 0,
      boardroom: 0,
      exhibitionStands: 0,
    },
    modelUrl: null,
    floorLevels: [],
    modelFacts: null,
    previewUrl: null,
    floorPlanUrl: null,
    scope: 'personal',
    verified: false,
    verifiedAt: null,
    sourceNote: '',
  };
}

/**
 * Turn a venue record into the constraint objects a plan checks against.
 *
 * This is where venue intelligence stops being a reference sheet and becomes
 * something the software enforces: choose the venue, and the height limit, the
 * pillars, the rigging capacity, the supplies and the truck route arrive in the
 * scene as real, checkable geometry.
 */
export function constraintsFromVenue(spec: VenueSpec): Array<ConstraintData & { positionMm: { x: number; y: number; z: number } }> {
  const out: Array<ConstraintData & { positionMm: { x: number; y: number; z: number } }> = [];
  const halfW = spec.widthMm / 2;
  const halfD = spec.depthMm / 2;

  // The clear height over the whole floor.
  out.push({
    ...constraintDefaults('height-limit'),
    label: `Clear height ${(spec.structure.clearHeightMm / 1000).toFixed(2)} m`,
    heightLimitMm: spec.structure.clearHeightMm,
    note: `${spec.name}: lowest obstruction. Maximum height at the ridge is ${(spec.structure.maxHeightMm / 1000).toFixed(2)} m.`,
    points: [
      { xMm: -halfW, zMm: -halfD },
      { xMm: halfW, zMm: -halfD },
      { xMm: halfW, zMm: halfD },
      { xMm: -halfW, zMm: halfD },
    ],
    positionMm: { x: 0, y: 0, z: 0 },
  });

  // Floor loading, where the venue states one.
  if (spec.structure.floorLoadKgSqM) {
    out.push({
      ...constraintDefaults('load-limit'),
      label: `Floor load ${spec.structure.floorLoadKgSqM} kg/m²`,
      floorLoadKgSqM: spec.structure.floorLoadKgSqM,
      note: spec.structure.pointLoadKg ? `Point load limit ${spec.structure.pointLoadKg} kg.` : '',
      points: [
        { xMm: -halfW, zMm: -halfD },
        { xMm: halfW, zMm: -halfD },
        { xMm: halfW, zMm: halfD },
        { xMm: -halfW, zMm: halfD },
      ],
      positionMm: { x: 0, y: 0, z: 0 },
    });
  }

  // Pillars, as no-build areas.
  for (const [index, column] of spec.structure.columns.entries()) {
    const hw = column.widthMm / 2;
    const hd = column.depthMm / 2;
    out.push({
      ...constraintDefaults('no-build'),
      label: `Column ${index + 1}`,
      note: 'Structural column. Nothing may be built on it, and it breaks sightlines behind it.',
      points: [
        { xMm: column.xMm - hw, zMm: column.zMm - hd },
        { xMm: column.xMm + hw, zMm: column.zMm - hd },
        { xMm: column.xMm + hw, zMm: column.zMm + hd },
        { xMm: column.xMm - hw, zMm: column.zMm + hd },
      ],
      positionMm: { x: 0, y: 0, z: 0 },
    });
  }

  // Power supplies.
  for (const point of spec.services.powerPoints) {
    out.push({
      ...constraintDefaults('power'),
      label: point.label || `${point.amps} A ${point.phases === 3 ? '3-phase' : 'single-phase'}`,
      amps: point.amps,
      phases: point.phases,
      voltage: spec.services.powerVoltage,
      points: [{ xMm: point.xMm, zMm: point.zMm }],
      positionMm: { x: point.xMm, y: 0, z: point.zMm },
    });
  }

  // Rigging capacity, expressed as one point at the centre when the venue only
  // gives a total. A single figure is what most venues publish, and stating it
  // as one point is honest about that rather than inventing a grid.
  if (spec.structure.riggingAllowed && spec.structure.totalRiggingCapacityKg) {
    out.push({
      ...constraintDefaults('rigging-point'),
      label: `Rigging total ${spec.structure.totalRiggingCapacityKg} kg`,
      swlKg: spec.structure.totalRiggingCapacityKg,
      rigHeightMm: spec.structure.clearHeightMm,
      note: 'Total capacity as published by the venue. Ask for the point grid before committing a heavy rig.',
      points: [{ xMm: 0, zMm: 0 }],
      positionMm: { x: 0, y: 0, z: 0 },
    });
  }

  // The truck route from the loading door into the space.
  out.push({
    ...constraintDefaults('truck-access'),
    label: `${spec.access.vehicle} access`,
    vehicle: spec.access.vehicle,
    note: `Door ${(spec.access.doorWidthMm / 1000).toFixed(2)} × ${(spec.access.doorHeightMm / 1000).toFixed(2)} m, ${(spec.access.pushDistanceMm / 1000).toFixed(0)} m push to the floor.${spec.access.dockLevel ? ' Dock level.' : ' Ground level, tail lift needed.'}`,
    points: [
      { xMm: -3000, zMm: halfD },
      { xMm: 3000, zMm: halfD },
      { xMm: 3000, zMm: halfD - 6000 },
      { xMm: -3000, zMm: halfD - 6000 },
    ],
    positionMm: { x: 0, y: 0, z: 0 },
  });

  return out;
}

/** Warnings raised by the record itself, before any design exists. */
export function venueWarnings(spec: VenueSpec): string[] {
  const out: string[] = [];
  if (!spec.structure.riggingAllowed) {
    out.push('Rigging is not permitted here. Everything must be ground-supported, which adds base plates, ballast and floor space.');
  }
  if (spec.structure.clearHeightMm < 3000) {
    out.push(`Clear height is only ${(spec.structure.clearHeightMm / 1000).toFixed(2)} m. Standard truss goalposts and most LED walls will not fit under it.`);
  }
  if (!spec.structure.levelFloor) {
    out.push('The floor is not level. Staging and LED will need packing and levelling — allow build time and materials.');
  }
  if (!spec.structure.fixingsAllowed) {
    out.push('No fixings into the floor or walls. Everything must be freestanding or ballasted.');
  }
  if (spec.access.liftCapacityKg !== null) {
    out.push(`Everything goes up in a lift: ${spec.access.liftWidthMm} × ${spec.access.liftDepthMm} × ${spec.access.liftHeightMm} mm, ${spec.access.liftCapacityKg} kg. Anything longer than the lift has to be built in the room.`);
  }
  if (!spec.access.dockLevel) {
    out.push('No dock. A tail lift and more crew hours are needed on load-in and load-out.');
  }
  if (spec.access.pushDistanceMm > 60_000) {
    out.push(`${(spec.access.pushDistanceMm / 1000).toFixed(0)} m from the truck to the floor. That is a real labour cost — budget for it.`);
  }
  if (!spec.services.hazeAllowed) {
    out.push('Haze is not permitted, so beam effects will not read. Design the look around surfaces rather than beams.');
  }
  if (!spec.services.dimmableHouseLights) {
    out.push('House lights cannot be dimmed. Any lighting design has to compete with them.');
  }
  if (spec.services.soundLimitDb !== null) {
    out.push(`Sound is limited to ${spec.services.soundLimitDb} dB. Confirm this with the client before promising a band.`);
  }
  if (spec.rules.exclusiveSuppliers.length) {
    out.push(`Exclusive suppliers apply for: ${spec.rules.exclusiveSuppliers.join(', ')}. Those lines cannot be competitively quoted.`);
  }
  if (spec.rules.buildCurfew) {
    out.push(`Build must stop at ${spec.rules.buildCurfew}. Check the schedule fits before quoting a single overnight.`);
  }
  if (!spec.verified) {
    out.push('These figures have not been verified against the building. Confirm the critical ones before you commit to a design.');
  }
  return out;
}
