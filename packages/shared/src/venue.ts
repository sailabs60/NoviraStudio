/**
 * Venue derivation.
 *
 * Turns a handful of parameters — style, footprint, height, how many ways in —
 * into a complete venue: wall segments, door and window openings, structural
 * features, a roof profile, and the capacity figures a planner actually needs
 * before committing to a layout.
 *
 * This lives in `shared` rather than in the API because the editor previews the
 * result live as the sliders move; only the GLB build needs the server. Every
 * length is integer millimetres, as everywhere else.
 */
import type { FloorPolygon, WallBlueprint, WallPoint, WallSegment } from './scene.js';

function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type VenueStyle =
  | 'ballroom'
  | 'marquee'
  | 'warehouse'
  | 'conference'
  | 'barn'
  | 'pavilion';

export type RoofKind = 'flat' | 'gable' | 'hip' | 'open';

export interface VenueStyleProfile {
  style: VenueStyle;
  label: string;
  description: string;
  roof: RoofKind;
  /** Wall height at the eaves, before any roof pitch is added. */
  defaultHeightMm: number;
  defaultWidthMm: number;
  defaultDepthMm: number;
  /** Roof pitch in degrees; 0 for a flat roof. */
  pitchDeg: number;
  /** Pavilions have a roof on posts and no walls to speak of. */
  walled: boolean;
  wallColor: string;
  floorColor: string;
  roofColor: string;
  /** Whether a structural column grid is typical for the style. */
  columnsTypical: boolean;
  windowsTypical: boolean;
}

export const VENUE_STYLES: Record<VenueStyle, VenueStyleProfile> = {
  ballroom: {
    style: 'ballroom',
    label: 'Ballroom',
    description: 'High flat ceiling, plastered walls, tall windows down the long sides.',
    roof: 'flat',
    defaultHeightMm: 5500,
    defaultWidthMm: 24000,
    defaultDepthMm: 16000,
    pitchDeg: 0,
    walled: true,
    wallColor: '#e8e2d6',
    floorColor: '#8a6b4a',
    roofColor: '#f2ede3',
    columnsTypical: true,
    windowsTypical: true,
  },
  marquee: {
    style: 'marquee',
    label: 'Marquee',
    description: 'Framed fabric structure with a pitched roof and clear-span interior.',
    roof: 'gable',
    defaultHeightMm: 2600,
    defaultWidthMm: 15000,
    defaultDepthMm: 24000,
    pitchDeg: 26,
    walled: true,
    wallColor: '#f6f4ef',
    floorColor: '#6f6a60',
    roofColor: '#fbfaf7',
    columnsTypical: false,
    windowsTypical: true,
  },
  warehouse: {
    style: 'warehouse',
    label: 'Warehouse',
    description: 'Industrial shell, exposed steel columns, roller-shutter access.',
    roof: 'gable',
    defaultHeightMm: 7000,
    defaultWidthMm: 30000,
    defaultDepthMm: 20000,
    pitchDeg: 8,
    walled: true,
    wallColor: '#9aa0a6',
    floorColor: '#5f6367',
    roofColor: '#7c8288',
    columnsTypical: true,
    windowsTypical: false,
  },
  conference: {
    style: 'conference',
    label: 'Conference room',
    description: 'Lower flat ceiling, even walls, built for sightlines and AV.',
    roof: 'flat',
    defaultHeightMm: 3200,
    defaultWidthMm: 18000,
    defaultDepthMm: 12000,
    pitchDeg: 0,
    walled: true,
    wallColor: '#dcd8d0',
    floorColor: '#4a4a4a',
    roofColor: '#eceae5',
    columnsTypical: false,
    windowsTypical: true,
  },
  barn: {
    style: 'barn',
    label: 'Barn',
    description: 'Timber structure with a steep gable and wide entrance doors.',
    roof: 'gable',
    defaultHeightMm: 4200,
    defaultWidthMm: 14000,
    defaultDepthMm: 22000,
    pitchDeg: 38,
    walled: true,
    wallColor: '#7a5a3c',
    floorColor: '#8a7050',
    roofColor: '#4e3d2c',
    columnsTypical: false,
    windowsTypical: true,
  },
  pavilion: {
    style: 'pavilion',
    label: 'Pavilion',
    description: 'Open-sided roof on posts — cover without enclosure.',
    roof: 'open',
    defaultHeightMm: 3000,
    defaultWidthMm: 12000,
    defaultDepthMm: 12000,
    pitchDeg: 22,
    walled: false,
    wallColor: '#e6e1d7',
    floorColor: '#7d7468',
    roofColor: '#c9bfae',
    columnsTypical: true,
    windowsTypical: false,
  },
};

export interface VenueParams {
  style: VenueStyle;
  widthMm: number;
  depthMm: number;
  /** Wall height at the eaves. */
  heightMm: number;
  /** Doors on the front elevation. */
  entrances: number;
  /** Windows per long side. Ignored where the style has none. */
  windowsPerSide: number;
  /** Insert a recessed stage alcove at the back. */
  stageAlcove: boolean;
  /** Structural column grid through the interior. */
  columns: boolean;
}

export interface VenueOpening {
  id: string;
  kind: 'door' | 'window';
  /** Centre of the opening, in plan. */
  xMm: number;
  zMm: number;
  widthMm: number;
  heightMm: number;
  /** Height from the floor to the bottom of the opening. Doors are 0. */
  sillMm: number;
  /** Facing, degrees clockwise from +Z. */
  rotationDeg: number;
  wallId: string;
}

export interface VenueFeature {
  id: string;
  kind: 'column' | 'stage-alcove' | 'post';
  xMm: number;
  zMm: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export interface VenueCapacity {
  /** Round tables of ten, with service circulation. */
  banquet: number;
  /** Rows of chairs facing one way. */
  theatre: number;
  /** Standing reception. */
  cocktail: number;
  /** Tables and chairs facing front, writing surface each. */
  classroom: number;
}

export interface DerivedVenue {
  params: VenueParams;
  profile: VenueStyleProfile;
  walls: WallBlueprint;
  openings: VenueOpening[];
  features: VenueFeature[];
  roof: { kind: RoofKind; pitchDeg: number; ridgeHeightMm: number };
  /** Internal clear floor area, in square metres. */
  areaSqM: number;
  perimeterMm: number;
  capacity: VenueCapacity;
  warnings: string[];
}

/* ── Dimensional conventions ───────────────────────────────────────────── */

const WALL_THICKNESS_MM = 200;
const DOOR_WIDTH_MM = 1800;
const DOOR_HEIGHT_MM = 2100;
const WINDOW_WIDTH_MM = 1500;
const WINDOW_HEIGHT_MM = 1500;
const WINDOW_SILL_MM = 900;
const COLUMN_SIZE_MM = 400;
/** Columns are placed on a grid no wider than this, matching typical steel spans. */
const COLUMN_MAX_SPAN_MM = 9000;
const STAGE_ALCOVE_DEPTH_MM = 3000;

/**
 * Area per person by seating mode, in square metres, including the circulation
 * and service space each mode needs. These are the standard planning
 * allowances — a banquet round needs its chairs pulled out plus a service
 * gangway, which is why it costs roughly twice a standing guest.
 */
const AREA_PER_PERSON = {
  banquet: 1.55,
  theatre: 0.75,
  cocktail: 0.65,
  classroom: 1.9,
} as const;

/**
 * Share of the floor lost to aisles, egress routes and back-of-house before
 * any seating is laid out. Larger rooms lose proportionally less.
 */
function circulationAllowance(areaSqM: number): number {
  if (areaSqM < 100) return 0.28;
  if (areaSqM < 300) return 0.24;
  if (areaSqM < 800) return 0.2;
  return 0.18;
}

export function defaultVenueParams(style: VenueStyle): VenueParams {
  const profile = VENUE_STYLES[style];
  return {
    style,
    widthMm: profile.defaultWidthMm,
    depthMm: profile.defaultDepthMm,
    heightMm: profile.defaultHeightMm,
    entrances: 2,
    windowsPerSide: profile.windowsTypical ? 4 : 0,
    stageAlcove: false,
    columns: profile.columnsTypical,
  };
}

/** Ridge height above floor level for a pitched roof. */
export function ridgeHeight(params: VenueParams, profile: VenueStyleProfile): number {
  if (profile.roof === 'flat') return params.heightMm;
  const halfSpan = params.widthMm / 2;
  const rise = Math.round(halfSpan * Math.tan((profile.pitchDeg * Math.PI) / 180));
  return params.heightMm + rise;
}

/**
 * Spread `count` items evenly along a run of `length`, returning the centre
 * offset of each measured from the run's start.
 *
 * Even spacing puts each item in the middle of its own share of the run, which
 * keeps the end margins equal to half a gap rather than leaving items jammed
 * against the corners.
 */
function distribute(count: number, length: number): number[] {
  if (count <= 0) return [];
  const share = length / count;
  return Array.from({ length: count }, (_, i) => Math.round(share * (i + 0.5)));
}

export function deriveVenue(params: VenueParams): DerivedVenue {
  const profile = VENUE_STYLES[params.style];
  const warnings: string[] = [];

  const halfW = params.widthMm / 2;
  const halfD = params.depthMm / 2;

  // Corners, clockwise from front-left. Front is -Z, so the entrance elevation
  // faces the default camera.
  const corners: WallPoint[] = [
    { xMm: -halfW, zMm: -halfD },
    { xMm: halfW, zMm: -halfD },
    { xMm: halfW, zMm: halfD },
    { xMm: -halfW, zMm: halfD },
  ];

  const spanId = newId();
  const segments: WallSegment[] = corners.map((start, i) => ({
    id: newId(),
    spanId,
    start,
    end: corners[(i + 1) % corners.length]!,
    thicknessMm: WALL_THICKNESS_MM,
    heightMm: params.heightMm,
    color: profile.wallColor,
  }));

  const floorPoints = [...corners];
  const openings: VenueOpening[] = [];
  const features: VenueFeature[] = [];

  // A pavilion has posts instead of walls, so its openings are meaningless.
  if (profile.walled) {
    // Entrances along the front wall (segment 0, running -X to +X at z = -halfD).
    const entranceCount = Math.max(0, Math.min(params.entrances, 6));
    if (entranceCount > 0) {
      const frontWall = segments[0]!;
      const usable = params.widthMm - 2 * DOOR_WIDTH_MM;
      if (usable < entranceCount * DOOR_WIDTH_MM) {
        warnings.push(
          `${entranceCount} entrances do not fit across a ${(params.widthMm / 1000).toFixed(1)} m front wall; they will be crowded.`
        );
      }
      for (const offset of distribute(entranceCount, params.widthMm)) {
        openings.push({
          id: newId(),
          kind: 'door',
          xMm: -halfW + offset,
          zMm: -halfD,
          widthMm: DOOR_WIDTH_MM,
          heightMm: Math.min(DOOR_HEIGHT_MM, params.heightMm - 100),
          sillMm: 0,
          rotationDeg: 0,
          wallId: frontWall.id,
        });
      }
    }

    // Windows down both long sides (segments 1 and 3, running along Z).
    const windowCount = profile.windowsTypical ? Math.max(0, Math.min(params.windowsPerSide, 12)) : 0;
    if (windowCount > 0) {
      if (params.heightMm < WINDOW_SILL_MM + WINDOW_HEIGHT_MM + 200) {
        warnings.push('Wall height leaves no room for standard windows; they have been lowered to fit.');
      }
      const sill = Math.min(WINDOW_SILL_MM, Math.max(0, params.heightMm - WINDOW_HEIGHT_MM - 200));
      for (const offset of distribute(windowCount, params.depthMm)) {
        const z = -halfD + offset;
        openings.push({
          id: newId(),
          kind: 'window',
          xMm: halfW,
          zMm: z,
          widthMm: WINDOW_WIDTH_MM,
          heightMm: WINDOW_HEIGHT_MM,
          sillMm: sill,
          rotationDeg: 90,
          wallId: segments[1]!.id,
        });
        openings.push({
          id: newId(),
          kind: 'window',
          xMm: -halfW,
          zMm: z,
          widthMm: WINDOW_WIDTH_MM,
          heightMm: WINDOW_HEIGHT_MM,
          sillMm: sill,
          rotationDeg: 270,
          wallId: segments[3]!.id,
        });
      }
    }
  } else {
    // Corner posts plus intermediate posts along each side, carrying the roof.
    const perSide = Math.max(1, Math.ceil(params.widthMm / COLUMN_MAX_SPAN_MM));
    const perEnd = Math.max(1, Math.ceil(params.depthMm / COLUMN_MAX_SPAN_MM));
    const xs = [-halfW, ...distribute(perSide, params.widthMm).map((o) => -halfW + o), halfW];
    const zs = [-halfD, ...distribute(perEnd, params.depthMm).map((o) => -halfD + o), halfD];
    const seen = new Set<string>();
    for (const x of xs) {
      for (const z of zs) {
        // Perimeter only — a pavilion is open in the middle.
        const onEdge = Math.abs(Math.abs(x) - halfW) < 1 || Math.abs(Math.abs(z) - halfD) < 1;
        if (!onEdge) continue;
        const key = `${Math.round(x)}:${Math.round(z)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        features.push({
          id: newId(),
          kind: 'post',
          xMm: Math.round(x),
          zMm: Math.round(z),
          widthMm: COLUMN_SIZE_MM,
          depthMm: COLUMN_SIZE_MM,
          heightMm: params.heightMm,
        });
      }
    }
  }

  // A recessed stage alcove extends the back wall outward, so it adds floor
  // rather than eating into the room.
  if (params.stageAlcove && profile.walled) {
    const alcoveWidth = Math.min(Math.round(params.widthMm * 0.5), 12000);
    features.push({
      id: newId(),
      kind: 'stage-alcove',
      xMm: 0,
      zMm: halfD + STAGE_ALCOVE_DEPTH_MM / 2,
      widthMm: alcoveWidth,
      depthMm: STAGE_ALCOVE_DEPTH_MM,
      heightMm: params.heightMm,
    });
  }

  // Interior structural columns on a grid, for styles where they are real.
  if (params.columns && profile.walled) {
    const bays = Math.max(1, Math.ceil(params.widthMm / COLUMN_MAX_SPAN_MM));
    const rows = Math.max(1, Math.ceil(params.depthMm / COLUMN_MAX_SPAN_MM));
    if (bays > 1 || rows > 1) {
      for (let i = 1; i < bays; i += 1) {
        for (let j = 1; j < rows; j += 1) {
          features.push({
            id: newId(),
            kind: 'column',
            xMm: Math.round(-halfW + (params.widthMm * i) / bays),
            zMm: Math.round(-halfD + (params.depthMm * j) / rows),
            widthMm: COLUMN_SIZE_MM,
            depthMm: COLUMN_SIZE_MM,
            heightMm: params.heightMm,
          });
        }
      }
      if (bays > 1 && rows > 1) {
        warnings.push(
          `${(bays - 1) * (rows - 1)} interior columns break the clear span — check sightlines to any stage.`
        );
      }
    }
  }

  /* ── Derived figures ─────────────────────────────────────────────────── */

  // Internal area, measured inside the walls.
  const innerW = Math.max(0, params.widthMm - WALL_THICKNESS_MM);
  const innerD = Math.max(0, params.depthMm - WALL_THICKNESS_MM);
  const alcove = features.find((f) => f.kind === 'stage-alcove');
  const areaMm2 = innerW * innerD + (alcove ? alcove.widthMm * alcove.depthMm : 0);
  const areaSqM = areaMm2 / 1_000_000;

  const usable = areaSqM * (1 - circulationAllowance(areaSqM));
  // Each interior column sterilises roughly a square metre around itself.
  const columnLoss = features.filter((f) => f.kind === 'column').length * 1.0;
  const net = Math.max(0, usable - columnLoss);

  const capacity: VenueCapacity = {
    banquet: Math.floor(net / AREA_PER_PERSON.banquet),
    theatre: Math.floor(net / AREA_PER_PERSON.theatre),
    cocktail: Math.floor(net / AREA_PER_PERSON.cocktail),
    classroom: Math.floor(net / AREA_PER_PERSON.classroom),
  };

  const perimeterMm = 2 * (params.widthMm + params.depthMm);

  // Egress: a rough but real check — roughly 5 mm of clear door width per
  // person is the common rule for assembly occupancies.
  const doorWidthTotal = openings
    .filter((o) => o.kind === 'door')
    .reduce((sum, o) => sum + o.widthMm, 0);
  if (profile.walled && doorWidthTotal > 0 && capacity.cocktail * 5 > doorWidthTotal) {
    warnings.push(
      `Exit width (${(doorWidthTotal / 1000).toFixed(1)} m) is below the rule-of-thumb allowance for ${capacity.cocktail} standing guests. Add entrances or check local egress rules.`
    );
  }
  if (profile.walled && openings.filter((o) => o.kind === 'door').length < 2 && capacity.cocktail > 60) {
    warnings.push('A room this size normally needs at least two separate exits.');
  }
  if (params.heightMm < 2400 && profile.walled) {
    warnings.push('Wall height is below 2.4 m, which is low for an event space.');
  }

  const floor: FloorPolygon = {
    id: newId(),
    points: floorPoints,
    color: profile.floorColor,
  };

  return {
    params,
    profile,
    walls: { segments: profile.walled ? segments : [], floors: [floor] },
    openings,
    features,
    roof: {
      kind: profile.roof,
      pitchDeg: profile.pitchDeg,
      ridgeHeightMm: ridgeHeight(params, profile),
    },
    areaSqM: Math.round(areaSqM * 10) / 10,
    perimeterMm,
    capacity,
    warnings,
  };
}
