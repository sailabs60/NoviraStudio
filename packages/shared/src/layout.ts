/**
 * Layout generation.
 *
 * Shared by Quick Layout (arrange the current selection) and Table Designer
 * (generate a full banquet set), because they are the same problem: given a
 * preset and spacing, produce a list of positions and rotations.
 *
 * Everything is millimetres and degrees, in the plan's own coordinate space,
 * relative to an origin the caller supplies.
 */

import type { LayoutParams, LayoutPreset, Vec3 } from './scene.js';

export interface Placement {
  positionMm: Vec3;
  rotationDeg: number;
}

const DEG = Math.PI / 180;

/** Rotate a point about the origin in the XZ plane. */
function rotateXZ(x: number, z: number, deg: number): { x: number; z: number } {
  if (!deg) return { x, z };
  const a = deg * DEG;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: x * cos - z * sin, z: x * sin + z * cos };
}

function grid(count: number, p: LayoutParams): Placement[] {
  const out: Placement[] = [];
  const columns = Math.max(1, p.columns);
  const rows = Math.max(1, Math.ceil(count / columns));
  const spanX = (columns - 1) * p.columnSpacingMm;
  const spanZ = (rows - 1) * p.rowSpacingMm;

  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / columns);
    const col = i % columns;
    const x = col * p.columnSpacingMm - spanX / 2;
    const z = row * p.rowSpacingMm - spanZ / 2;
    const r = rotateXZ(x, z, p.angleDeg);
    out.push({ positionMm: { x: r.x, y: 0, z: r.z }, rotationDeg: p.angleDeg });
  }
  return out;
}

/** Rows that narrow toward the far end — a head-table-facing arrangement. */
function pyramid(count: number, p: LayoutParams): Placement[] {
  const out: Placement[] = [];
  let placed = 0;
  let row = 0;
  let perRow = Math.max(1, p.columns);

  while (placed < count && perRow > 0) {
    const inThisRow = Math.min(perRow, count - placed);
    const spanX = (inThisRow - 1) * p.columnSpacingMm;
    for (let i = 0; i < inThisRow; i += 1) {
      const x = i * p.columnSpacingMm - spanX / 2;
      const z = row * p.rowSpacingMm;
      out.push({ positionMm: { x, y: 0, z }, rotationDeg: 0 });
    }
    placed += inThisRow;
    row += 1;
    perRow -= 1;
  }
  return out;
}

/** Evenly spaced around a circle, each item turned to face the centre. */
function circle(count: number, p: LayoutParams, closed: boolean): Placement[] {
  const out: Placement[] = [];
  const sweep = closed ? 360 : Math.min(360, Math.max(1, p.sweepDeg));
  const step = count > 1 ? sweep / (closed ? count : count - 1) : 0;
  const start = closed ? 0 : -sweep / 2;

  for (let i = 0; i < count; i += 1) {
    const angle = (start + step * i) * DEG;
    out.push({
      positionMm: {
        x: Math.sin(angle) * p.radiusMm,
        y: 0,
        z: Math.cos(angle) * p.radiusMm,
      },
      // Face inward.
      rotationDeg: -(start + step * i) + 180,
    });
  }
  return out;
}

/** An arc of rows, as used for a ceremony facing a focal point. */
function curved(count: number, p: LayoutParams): Placement[] {
  const out: Placement[] = [];
  const perRow = Math.max(1, p.itemsPerRow || p.columns);
  const rows = Math.ceil(count / perRow);

  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const inThisRow = Math.min(perRow, count - row * perRow);
    const radius = p.radiusMm + row * p.rowSpacingMm;
    const sweep = Math.min(170, Math.max(10, p.sweepDeg));
    const step = inThisRow > 1 ? sweep / (inThisRow - 1) : 0;
    const angle = (-sweep / 2 + step * col) * DEG;
    out.push({
      positionMm: { x: Math.sin(angle) * radius, y: 0, z: -Math.cos(angle) * radius },
      rotationDeg: (-sweep / 2 + step * col),
    });
  }
  return out;
}

/** Two blocks with a centre aisle — the standard ceremony plan. */
function aisle(count: number, p: LayoutParams): Placement[] {
  const out: Placement[] = [];
  const perSide = Math.max(1, Math.floor((p.itemsPerRow || p.columns) / 2)) || 1;
  const rows = Math.ceil(count / (perSide * 2));
  const aisleHalf = p.columnSpacingMm * 1.5;

  let placed = 0;
  for (let row = 0; row < rows && placed < count; row += 1) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < perSide && placed < count; i += 1) {
        const offset = aisleHalf + i * p.columnSpacingMm;
        out.push({
          positionMm: { x: side * offset, y: 0, z: row * p.rowSpacingMm },
          rotationDeg: 0,
        });
        placed += 1;
      }
    }
  }
  return out;
}

/** Three runs forming a U, open toward the viewer. */
function uShape(count: number, p: LayoutParams): Placement[] {
  const out: Placement[] = [];
  const perSide = Math.max(1, Math.floor(count / 3));
  const across = count - perSide * 2;
  const halfWidth = ((across - 1) * p.columnSpacingMm) / 2;
  const depth = perSide * p.rowSpacingMm;

  for (let i = 0; i < across; i += 1) {
    out.push({
      positionMm: { x: i * p.columnSpacingMm - halfWidth, y: 0, z: -depth / 2 },
      rotationDeg: 0,
    });
  }
  for (let i = 0; i < perSide; i += 1) {
    const z = -depth / 2 + (i + 1) * p.rowSpacingMm;
    out.push({ positionMm: { x: -halfWidth, y: 0, z }, rotationDeg: 90 });
    out.push({ positionMm: { x: halfWidth, y: 0, z }, rotationDeg: -90 });
  }
  return out.slice(0, count);
}

/** A single diagonal run. */
function diagonal(count: number, p: LayoutParams): Placement[] {
  const out: Placement[] = [];
  const span = (count - 1) / 2;
  for (let i = 0; i < count; i += 1) {
    const t = i - span;
    out.push({
      positionMm: { x: t * p.columnSpacingMm, y: 0, z: t * p.rowSpacingMm },
      rotationDeg: p.angleDeg || 45,
    });
  }
  return out;
}

/** A single straight run of rows. */
function rows(count: number, p: LayoutParams): Placement[] {
  const out: Placement[] = [];
  const perRow = Math.max(1, p.itemsPerRow || p.columns);
  const rowCount = Math.ceil(count / perRow);
  const spanZ = (rowCount - 1) * p.rowSpacingMm;

  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const inThisRow = Math.min(perRow, count - row * perRow);
    const spanX = (inThisRow - 1) * p.columnSpacingMm;
    out.push({
      positionMm: {
        x: col * p.columnSpacingMm - spanX / 2,
        y: 0,
        z: row * p.rowSpacingMm - spanZ / 2,
      },
      rotationDeg: 0,
    });
  }
  return out;
}

/**
 * Generate `count` placements for a preset.
 *
 * The result is centred on the origin (except the presets where a directional
 * arrangement is the point, such as pyramid and aisle, which grow away from
 * it). Callers translate by their own origin afterwards.
 */
export function generateLayout(count: number, params: LayoutParams): Placement[] {
  if (count <= 0) return [];
  const p = params;

  const byPreset: Record<LayoutPreset, () => Placement[]> = {
    grid: () => grid(count, p),
    'angled-grid': () => grid(count, { ...p, angleDeg: p.angleDeg || 45 }),
    rows: () => rows(count, p),
    pyramid: () => pyramid(count, p),
    diagonal: () => diagonal(count, p),
    curved: () => curved(count, p),
    circle: () => circle(count, p, false),
    'closed-circle': () => circle(count, p, true),
    'u-shape': () => uShape(count, p),
    aisle: () => aisle(count, p),
  };

  return (byPreset[p.preset] ?? byPreset.grid)();
}

/** Translate placements by an origin and an overall rotation. */
export function applyOrigin(placements: Placement[], origin: Vec3, rotationDeg = 0): Placement[] {
  return placements.map((placement) => {
    const r = rotateXZ(placement.positionMm.x, placement.positionMm.z, rotationDeg);
    return {
      positionMm: { x: origin.x + r.x, y: origin.y, z: origin.z + r.z },
      rotationDeg: placement.rotationDeg + rotationDeg,
    };
  });
}

/**
 * Seat positions around one table.
 *
 * Round tables get an even ring; rectangular tables get seats down the two long
 * sides, plus the ends when the seat count calls for them — which is how the
 * trade actually lays a table.
 */
export function seatPositions(
  seats: number,
  table: { shape: 'round' | 'rectangular' | 'other'; widthMm: number; depthMm: number },
  clearanceMm = 200
): Placement[] {
  if (seats <= 0) return [];

  if (table.shape === 'round' || table.shape === 'other') {
    const radius = table.widthMm / 2 + clearanceMm;
    return Array.from({ length: seats }, (_, i) => {
      const angle = (i / seats) * Math.PI * 2;
      return {
        positionMm: { x: Math.sin(angle) * radius, y: 0, z: Math.cos(angle) * radius },
        // Chairs face the table centre.
        rotationDeg: -(i / seats) * 360 + 180,
      };
    });
  }

  // Rectangular: fill the long sides first, then one seat at each end.
  const halfW = table.widthMm / 2;
  const halfD = table.depthMm / 2;
  const useEnds = seats % 2 === 0 && seats >= 6;
  const endSeats = useEnds ? 2 : 0;
  const sideSeats = seats - endSeats;
  const perSide = Math.ceil(sideSeats / 2);

  const out: Placement[] = [];
  for (const side of [-1, 1] as const) {
    const onThisSide = side === -1 ? Math.floor(sideSeats / 2) : Math.ceil(sideSeats / 2);
    const span = (onThisSide - 1) * (table.widthMm / Math.max(1, perSide));
    for (let i = 0; i < onThisSide; i += 1) {
      const step = onThisSide > 1 ? span / (onThisSide - 1) : 0;
      out.push({
        positionMm: {
          x: onThisSide > 1 ? i * step - span / 2 : 0,
          y: 0,
          z: side * (halfD + clearanceMm),
        },
        rotationDeg: side === -1 ? 0 : 180,
      });
    }
  }
  if (useEnds) {
    out.push({ positionMm: { x: -(halfW + clearanceMm), y: 0, z: 0 }, rotationDeg: 90 });
    out.push({ positionMm: { x: halfW + clearanceMm, y: 0, z: 0 }, rotationDeg: -90 });
  }
  return out.slice(0, seats);
}

/**
 * Where each place-setting piece sits, relative to a seat.
 *
 * Offsets follow standard cover layout: plate centred, forks left, knife and
 * spoon right, glasses above and to the right.
 */
export const PLACE_SETTING_OFFSETS: Record<string, { x: number; z: number }> = {
  plate: { x: 0, z: 0 },
  fork1: { x: -110, z: 0 },
  fork2: { x: -175, z: 0 },
  knife: { x: 110, z: 0 },
  spoon: { x: 170, z: 0 },
  beverage: { x: 130, z: -170 },
  beverage2: { x: 195, z: -215 },
};
