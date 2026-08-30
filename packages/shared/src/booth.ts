/**
 * Exhibition booth modules.
 *
 * Exhibition floors are sold on a grid — 3 × 3 m shell scheme, 6 × 3 inline,
 * 6 × 6 island — and every organiser publishes rules for that grid: how tall
 * you may build, how far back from the aisle a solid wall must sit, whether the
 * rear of a wall facing a neighbour has to be finished.
 *
 * Those rules are the difference between a design that gets approved and one
 * that gets rebuilt on site at the contractor's cost, so they are modelled
 * explicitly rather than left to a note in an email. A booth here therefore
 * knows its own type, and can say whether it complies.
 */
import type { WallPoint } from './scene.js';

/* ── Stand types ───────────────────────────────────────────────────────── */

export const BOOTH_TYPES = ['shell-scheme', 'inline', 'corner', 'peninsula', 'island', 'double-decker'] as const;
export type BoothType = (typeof BOOTH_TYPES)[number];

export interface BoothTypeSpec {
  key: BoothType;
  label: string;
  note: string;
  /** How many sides are open to an aisle. */
  openSides: number;
  /** Which sides carry a wall by default, front being the main aisle. */
  defaultWalls: BoothSide[];
  /** Height an organiser normally permits for this type, in millimetres. */
  typicalHeightLimitMm: number;
  /** Whether a fascia board across the front is standard. */
  fascia: boolean;
}

export const BOOTH_SIDES = ['front', 'back', 'left', 'right'] as const;
export type BoothSide = (typeof BOOTH_SIDES)[number];

export const BOOTH_SIDE_LABELS: Record<BoothSide, string> = {
  front: 'Front (main aisle)',
  back: 'Back',
  left: 'Left',
  right: 'Right',
};

export const BOOTH_TYPE_SPECS: Record<BoothType, BoothTypeSpec> = {
  'shell-scheme': {
    key: 'shell-scheme',
    label: 'Shell scheme',
    note: 'The organiser-supplied booth: three walls, a fascia with your name, and a carpet.',
    openSides: 1,
    defaultWalls: ['back', 'left', 'right'],
    typicalHeightLimitMm: 2500,
    fascia: true,
  },
  inline: {
    key: 'inline',
    label: 'Inline (row) stand',
    note: 'Open to one aisle, neighbours on both sides. The most common space sold.',
    openSides: 1,
    defaultWalls: ['back', 'left', 'right'],
    typicalHeightLimitMm: 4000,
    fascia: false,
  },
  corner: {
    key: 'corner',
    label: 'Corner stand',
    note: 'Two aisles meet here, so two sides are open and traffic is roughly double.',
    openSides: 2,
    defaultWalls: ['back', 'left'],
    typicalHeightLimitMm: 4000,
    fascia: false,
  },
  peninsula: {
    key: 'peninsula',
    label: 'Peninsula',
    note: 'Three sides open, backing onto one neighbour.',
    openSides: 3,
    defaultWalls: ['back'],
    typicalHeightLimitMm: 5000,
    fascia: false,
  },
  island: {
    key: 'island',
    label: 'Island',
    note: 'Aisles on all four sides. Nothing to hide behind, so it is designed in the round.',
    openSides: 4,
    defaultWalls: [],
    typicalHeightLimitMm: 6000,
    fascia: false,
  },
  'double-decker': {
    key: 'double-decker',
    label: 'Double decker',
    note: 'Two storeys. Almost always needs structural sign-off from the organiser.',
    openSides: 4,
    defaultWalls: ['back'],
    typicalHeightLimitMm: 6000,
    fascia: false,
  },
};

/* ── Standard grid sizes ───────────────────────────────────────────────── */

export interface BoothSizePreset {
  key: string;
  label: string;
  widthMm: number;
  depthMm: number;
  type: BoothType;
  note: string;
}

/**
 * The sizes floors are actually sold in. Metric halls sell 3 m modules;
 * North American halls sell 10 ft, which is 3048 mm and is *not* the same
 * thing — a stand built for one does not fit the other, and that is precisely
 * the mistake this list exists to prevent.
 */
export const BOOTH_SIZES: BoothSizePreset[] = [
  { key: '3x3', label: '3 × 3 m shell', widthMm: 3000, depthMm: 3000, type: 'shell-scheme', note: 'One module. The entry-level space at most shows.' },
  { key: '6x3', label: '6 × 3 m inline', widthMm: 6000, depthMm: 3000, type: 'inline', note: 'Two modules side by side.' },
  { key: '9x3', label: '9 × 3 m inline', widthMm: 9000, depthMm: 3000, type: 'inline', note: 'Three modules; room for a meeting area at one end.' },
  { key: '6x6', label: '6 × 6 m island', widthMm: 6000, depthMm: 6000, type: 'island', note: 'The smallest space that works in the round.' },
  { key: '9x6', label: '9 × 6 m peninsula', widthMm: 9000, depthMm: 6000, type: 'peninsula', note: 'Three sides open with a back wall for graphics.' },
  { key: '12x6', label: '12 × 6 m island', widthMm: 12000, depthMm: 6000, type: 'island', note: 'Headline stand with a demo zone and hospitality.' },
  { key: '10x10ft', label: "10 × 10 ft inline", widthMm: 3048, depthMm: 3048, type: 'inline', note: 'North American single booth. Not interchangeable with 3 × 3 m.' },
  { key: '20x10ft', label: "20 × 10 ft inline", widthMm: 6096, depthMm: 3048, type: 'inline', note: 'North American double booth.' },
  { key: '20x20ft', label: "20 × 20 ft island", widthMm: 6096, depthMm: 6096, type: 'island', note: 'North American island.' },
];

/* ── Fit-out ───────────────────────────────────────────────────────────── */

export const BOOTH_WALL_FINISHES = ['fabric', 'laminate', 'painted-mdf', 'printed-graphic', 'timber', 'modular-system'] as const;
export type BoothWallFinish = (typeof BOOTH_WALL_FINISHES)[number];

export const BOOTH_WALL_FINISH_INFO: Record<BoothWallFinish, { label: string; note: string; color: string; printable: boolean }> = {
  fabric: { label: 'Tensioned fabric', note: 'SEG frames with a printed skin. Light, fast, reprintable.', color: '#f2f2f0', printable: true },
  laminate: { label: 'Laminated panel', note: 'Melamine-faced board in a system frame. Hard-wearing, reusable.', color: '#e6e3dc', printable: false },
  'painted-mdf': { label: 'Painted MDF', note: 'Built and sprayed. The best finish, and the least reusable.', color: '#eceae6', printable: false },
  'printed-graphic': { label: 'Direct-printed panel', note: 'Graphics printed straight onto the panel face.', color: '#dfe6ef', printable: true },
  timber: { label: 'Timber / plywood', note: 'Exposed ply or veneer. Reads warm, weighs a lot.', color: '#c9a677', printable: false },
  'modular-system': { label: 'Modular system', note: 'Octanorm-style extrusion and infill. Hire stock, zero waste.', color: '#d9dde2', printable: false },
};

export const BOOTH_FLOOR_FINISHES = ['carpet', 'raised-platform', 'vinyl', 'timber-deck', 'none'] as const;
export type BoothFloorFinish = (typeof BOOTH_FLOOR_FINISHES)[number];

export const BOOTH_FLOOR_FINISH_INFO: Record<BoothFloorFinish, { label: string; note: string; thicknessMm: number }> = {
  carpet: { label: 'Carpet', note: 'Laid straight onto the hall floor.', thicknessMm: 8 },
  'raised-platform': { label: 'Raised platform', note: 'Decked at 100 mm to run cable underneath. Needs an edge ramp.', thicknessMm: 100 },
  vinyl: { label: 'Vinyl', note: 'Printed or plain vinyl on a levelled base.', thicknessMm: 4 },
  'timber-deck': { label: 'Timber deck', note: 'Engineered board on battens.', thicknessMm: 60 },
  none: { label: 'Bare hall floor', note: 'Nothing laid; the hall surface shows.', thicknessMm: 0 },
};

/* ── Organiser rules ───────────────────────────────────────────────────── */

export interface BoothRegulations {
  /** Tallest anything may be built, measured from the hall floor. */
  maxHeightMm: number;
  /**
   * How far a solid element must sit back from an aisle edge, so the stand
   * does not wall off its neighbours' visibility.
   */
  setbackFromAisleMm: number;
  /** Solid run of wall allowed along a boundary before it must break. */
  maxSolidRunMm: number;
  /** Height above which the back of a wall facing a neighbour must be finished. */
  finishedRearAboveMm: number;
  /** Whether a raised platform needs an edge ramp for step-free access. */
  rampRequired: boolean;
  /** Aisle width the organiser keeps clear. */
  aisleWidthMm: number;
}

export const DEFAULT_BOOTH_REGULATIONS: BoothRegulations = {
  maxHeightMm: 4000,
  setbackFromAisleMm: 1000,
  maxSolidRunMm: 6000,
  finishedRearAboveMm: 2500,
  rampRequired: true,
  aisleWidthMm: 3000,
};

/* ── Derivation ────────────────────────────────────────────────────────── */

export interface BoothLike {
  boothType: BoothType;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  walls: BoothSide[];
  wallFinish: BoothWallFinish;
  floorFinish: BoothFloorFinish;
  fascia: boolean;
  fasciaHeightMm: number;
  storeRoom: boolean;
  counter: boolean;
  /** Height of any raised deck. 0 when the stand sits on the hall floor. */
  platformHeightMm: number;
}

export interface BoothWarning {
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface BoothDerivation {
  spec: BoothTypeSpec;
  /** Floor area sold, in square metres. */
  areaSqM: number;
  /** Usable floor once a store room is taken out. */
  usableAreaSqM: number;
  /** Total wall face area, one side only. */
  wallAreaSqM: number;
  /** Wall area that will actually be printed. */
  printAreaSqM: number;
  /** Carpet or decking laid, in square metres. */
  floorAreaSqM: number;
  /** Linear metres of wall — how a contractor prices framing. */
  wallRunM: number;
  /** Volume enclosed, which is how freight and build time are estimated. */
  volumeCuM: number;
  /** People the stand comfortably holds at once. */
  standCapacity: number;
  warnings: BoothWarning[];
}

/** Store rooms are sold by the square metre and always eat usable floor. */
const STORE_ROOM_SIZE_MM = 1000;

export function deriveBooth(booth: BoothLike, rules: BoothRegulations = DEFAULT_BOOTH_REGULATIONS): BoothDerivation {
  const spec = BOOTH_TYPE_SPECS[booth.boothType];
  const areaSqM = Math.round(((booth.widthMm * booth.depthMm) / 1_000_000) * 100) / 100;

  const storeArea = booth.storeRoom ? (STORE_ROOM_SIZE_MM * STORE_ROOM_SIZE_MM) / 1_000_000 : 0;
  const usableAreaSqM = Math.round(Math.max(0, areaSqM - storeArea) * 100) / 100;

  let wallRunMm = 0;
  for (const side of booth.walls) {
    wallRunMm += side === 'front' || side === 'back' ? booth.widthMm : booth.depthMm;
  }
  const wallRunM = Math.round((wallRunMm / 1000) * 100) / 100;
  const wallAreaSqM = Math.round(((wallRunMm * booth.heightMm) / 1_000_000) * 100) / 100;

  const finish = BOOTH_WALL_FINISH_INFO[booth.wallFinish];
  const fasciaAreaSqM = booth.fascia
    ? Math.round(((booth.widthMm * booth.fasciaHeightMm) / 1_000_000) * 100) / 100
    : 0;
  const printAreaSqM = Math.round(((finish.printable ? wallAreaSqM : 0) + fasciaAreaSqM) * 100) / 100;

  const floorAreaSqM = booth.floorFinish === 'none' ? 0 : usableAreaSqM;

  const volumeCuM = Math.round(((booth.widthMm * booth.depthMm * booth.heightMm) / 1_000_000_000) * 100) / 100;

  /*
   * Stand capacity uses the exhibition rule of thumb — roughly 1.5 m² of open
   * floor per person standing and talking, once furniture is in. Quoting it
   * stops a 9 m² stand being planned around a twelve-person demo.
   */
  const standCapacity = Math.max(1, Math.floor(usableAreaSqM / 1.5));

  const warnings: BoothWarning[] = [];
  if (booth.heightMm > rules.maxHeightMm) {
    warnings.push({
      severity: 'error',
      message: `Built height ${(booth.heightMm / 1000).toFixed(2)} m exceeds the ${(rules.maxHeightMm / 1000).toFixed(2)} m limit for this hall. Organiser approval will be refused.`,
    });
  } else if (booth.heightMm > spec.typicalHeightLimitMm) {
    warnings.push({
      severity: 'warning',
      message: `${(booth.heightMm / 1000).toFixed(2)} m is above the ${(spec.typicalHeightLimitMm / 1000).toFixed(2)} m normally allowed on a ${spec.label.toLowerCase()}. Check the exhibitor manual.`,
    });
  }

  if (booth.heightMm > rules.finishedRearAboveMm) {
    const neighbourWalls = booth.walls.filter((s) => s !== 'front');
    if (neighbourWalls.length) {
      warnings.push({
        severity: 'info',
        message: `Walls above ${(rules.finishedRearAboveMm / 1000).toFixed(1)} m must be finished on the neighbour's side too. Allow for ${wallRunM} m of rear finish.`,
      });
    }
  }

  const longestBoundary = Math.max(
    booth.walls.some((s) => s === 'front' || s === 'back') ? booth.widthMm : 0,
    booth.walls.some((s) => s === 'left' || s === 'right') ? booth.depthMm : 0
  );
  if (longestBoundary > rules.maxSolidRunMm) {
    warnings.push({
      severity: 'warning',
      message: `A ${(longestBoundary / 1000).toFixed(1)} m unbroken wall exceeds the ${(rules.maxSolidRunMm / 1000).toFixed(1)} m solid-run rule. Break it with a return or an opening.`,
    });
  }

  if (spec.openSides >= 2 && booth.walls.includes('front')) {
    warnings.push({
      severity: 'warning',
      message: 'This stand type is open to an aisle on the front. A wall there closes off the traffic you paid for.',
    });
  }

  if (booth.platformHeightMm > 0 && rules.rampRequired) {
    warnings.push({
      severity: 'info',
      message: `A ${booth.platformHeightMm} mm platform needs an access ramp — allow ${(booth.platformHeightMm * 12) / 1000} m of run at 1:12.`,
    });
  }

  if (booth.boothType === 'double-decker') {
    warnings.push({
      severity: 'warning',
      message: 'Double-deck stands need structural calculations and organiser sign-off, usually eight weeks ahead.',
    });
  }

  if (usableAreaSqM < 6 && booth.storeRoom) {
    warnings.push({
      severity: 'warning',
      message: 'A store room on a stand this small leaves almost no floor for visitors.',
    });
  }

  return {
    spec,
    areaSqM,
    usableAreaSqM,
    wallAreaSqM,
    printAreaSqM,
    floorAreaSqM,
    wallRunM,
    volumeCuM,
    standCapacity,
    warnings,
  };
}

/**
 * Lay out a block of stands on an exhibition floor.
 *
 * Rows of booths back to back with an aisle between each pair, which is how
 * every hall plan is set out — it halves the aisle count for the same number of
 * stands. Returns plan-space centres so the caller can place real objects.
 */
export interface BoothGridParams {
  columns: number;
  rows: number;
  boothWidthMm: number;
  boothDepthMm: number;
  aisleWidthMm: number;
  /** Put stands back to back so one aisle serves two rows. */
  backToBack: boolean;
  /** Gap between neighbouring stands in the same row. 0 means shared walls. */
  gapMm: number;
}

export interface BoothPlacement {
  index: number;
  centre: WallPoint;
  rotationDeg: number;
  row: number;
  column: number;
  /** Stand number in the sequence organisers use: row letter, column number. */
  standNumber: string;
}

export function generateBoothGrid(params: BoothGridParams): BoothPlacement[] {
  const { columns, rows, boothWidthMm, boothDepthMm, aisleWidthMm, backToBack, gapMm } = params;
  const out: BoothPlacement[] = [];

  const columnPitch = boothWidthMm + gapMm;
  const totalWidth = columns * columnPitch - gapMm;

  /*
   * Back to back pairs share a spine and then take an aisle, so the vertical
   * pitch alternates. Laid out as a running offset rather than a formula
   * because the alternation is easier to read — and easier to be right about —
   * written out.
   */
  const rowOffsets: number[] = [];
  let z = 0;
  for (let r = 0; r < rows; r += 1) {
    rowOffsets.push(z);
    const pairsWithNext = backToBack && r % 2 === 0;
    z += boothDepthMm + (pairsWithNext ? 0 : aisleWidthMm);
  }
  const totalDepth = z - (rows > 0 ? aisleWidthMm : 0);

  let index = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const faceAway = backToBack && r % 2 === 1;
      out.push({
        index,
        row: r,
        column: c,
        centre: {
          xMm: Math.round(-totalWidth / 2 + c * columnPitch + boothWidthMm / 2),
          zMm: Math.round(-totalDepth / 2 + rowOffsets[r]! + boothDepthMm / 2),
        },
        // A back-to-back partner faces the opposite aisle.
        rotationDeg: faceAway ? 180 : 0,
        standNumber: `${String.fromCharCode(65 + r)}${c + 1}`,
      });
      index += 1;
    }
  }
  return out;
}
