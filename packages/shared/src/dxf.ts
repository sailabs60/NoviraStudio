/**
 * CAD export.
 *
 * Production teams do not open a PDF in a saw shop; they open a DXF. So the
 * plan has to leave as real CAD geometry, on named layers, at true scale, in
 * the units the receiving system expects.
 *
 * DXF R12 is written deliberately rather than a newer revision. R12 is ASCII,
 * has no object handles or class table to keep consistent, and is read by
 * everything from AutoCAD to a laser cutter's driver — which matters far more
 * here than the features later revisions add. Nothing in an event plan needs
 * them.
 *
 * The one convention worth knowing: **DXF is written in millimetres with Y
 * increasing north**, while the scene uses Z for north. So the mapping is
 * `x → X, z → -Y`, applied in one place (`toDxf`) so it cannot drift.
 */
import type { WallPoint } from './scene.js';

/* ── Layers ────────────────────────────────────────────────────────────── */

/**
 * AutoCAD Color Index values. Layer colour is the only styling a fabrication
 * shop reliably sees, so the palette is chosen for legibility on a white
 * background rather than to match the app.
 */
export const ACI = {
  red: 1,
  yellow: 2,
  green: 3,
  cyan: 4,
  blue: 5,
  magenta: 6,
  white: 7,
  grey: 8,
  lightGrey: 9,
} as const;

export interface DxfLayer {
  name: string;
  color: number;
  /** DXF linetype name; only CONTINUOUS and DASHED are defined below. */
  linetype: 'CONTINUOUS' | 'DASHED';
}

export const DXF_LAYERS: DxfLayer[] = [
  { name: 'NZ-WALLS', color: ACI.white, linetype: 'CONTINUOUS' },
  { name: 'NZ-FLOOR', color: ACI.grey, linetype: 'CONTINUOUS' },
  { name: 'NZ-STAGE', color: ACI.cyan, linetype: 'CONTINUOUS' },
  { name: 'NZ-TRUSS', color: ACI.magenta, linetype: 'CONTINUOUS' },
  { name: 'NZ-LED', color: ACI.blue, linetype: 'CONTINUOUS' },
  { name: 'NZ-BOOTH', color: ACI.green, linetype: 'CONTINUOUS' },
  { name: 'NZ-FURNITURE', color: ACI.lightGrey, linetype: 'CONTINUOUS' },
  { name: 'NZ-LIGHTING', color: ACI.yellow, linetype: 'CONTINUOUS' },
  { name: 'NZ-CONSTRAINTS', color: ACI.red, linetype: 'DASHED' },
  { name: 'NZ-DIMENSIONS', color: ACI.green, linetype: 'CONTINUOUS' },
  { name: 'NZ-TEXT', color: ACI.white, linetype: 'CONTINUOUS' },
  { name: 'NZ-GRID', color: ACI.grey, linetype: 'DASHED' },
];

/* ── Entities ──────────────────────────────────────────────────────────── */

export type DxfEntity =
  | { type: 'line'; layer: string; a: WallPoint; b: WallPoint }
  | { type: 'polyline'; layer: string; points: WallPoint[]; closed: boolean }
  | { type: 'circle'; layer: string; centre: WallPoint; radiusMm: number }
  | { type: 'text'; layer: string; at: WallPoint; text: string; heightMm: number; rotationDeg?: number };

export interface DxfDocument {
  entities: DxfEntity[];
  /** Title block values, written as text in the corner of the drawing. */
  title: string;
  subtitle: string;
  /** Extra rows for the title block, printed one per line. */
  info: Array<{ label: string; value: string }>;
}

/* ── Writing ───────────────────────────────────────────────────────────── */

/** One group code and value. The whole format is pairs of these. */
function pair(code: number | string, value: string | number): string {
  return `${code}\n${value}\n`;
}

/** Scene millimetres to DXF millimetres. See the note at the top of the file. */
function toDxf(point: WallPoint): { x: number; y: number } {
  return { x: round(point.xMm), y: round(-point.zMm) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function writeHeader(): string {
  return (
    pair(0, 'SECTION') +
    pair(2, 'HEADER') +
    // Millimetres. Without this, a receiving system may assume inches and
    // scale the whole drawing by 25.4 without saying anything.
    pair(9, '$INSUNITS') +
    pair(70, 4) +
    pair(9, '$MEASUREMENT') +
    pair(70, 1) +
    pair(0, 'ENDSEC')
  );
}

function writeTables(): string {
  let out = pair(0, 'SECTION') + pair(2, 'TABLES');

  // Linetypes have to be declared before a layer may reference one.
  out += pair(0, 'TABLE') + pair(2, 'LTYPE') + pair(70, 2);
  out +=
    pair(0, 'LTYPE') +
    pair(2, 'CONTINUOUS') +
    pair(70, 0) +
    pair(3, 'Solid line') +
    pair(72, 65) +
    pair(73, 0) +
    pair(40, 0);
  out +=
    pair(0, 'LTYPE') +
    pair(2, 'DASHED') +
    pair(70, 0) +
    pair(3, '__ __ __') +
    pair(72, 65) +
    pair(73, 2) +
    pair(40, 15) +
    pair(49, 10) +
    pair(49, -5);
  out += pair(0, 'ENDTAB');

  out += pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, DXF_LAYERS.length);
  for (const layer of DXF_LAYERS) {
    out += pair(0, 'LAYER') + pair(2, layer.name) + pair(70, 0) + pair(62, layer.color) + pair(6, layer.linetype);
  }
  out += pair(0, 'ENDTAB');

  out += pair(0, 'ENDSEC');
  return out;
}

function writeEntity(entity: DxfEntity): string {
  switch (entity.type) {
    case 'line': {
      const a = toDxf(entity.a);
      const b = toDxf(entity.b);
      return (
        pair(0, 'LINE') +
        pair(8, entity.layer) +
        pair(10, a.x) +
        pair(20, a.y) +
        pair(30, 0) +
        pair(11, b.x) +
        pair(21, b.y) +
        pair(31, 0)
      );
    }
    case 'polyline': {
      /*
       * POLYLINE plus VERTEX, not LWPOLYLINE. LWPOLYLINE is the modern entity
       * and is a third of the size, but it does not exist in R12 — writing one
       * into an R12 file produces a drawing that opens empty in older readers
       * with no error to explain why.
       */
      let out =
        pair(0, 'POLYLINE') +
        pair(8, entity.layer) +
        pair(66, 1) +
        pair(70, entity.closed ? 1 : 0) +
        pair(10, 0) +
        pair(20, 0) +
        pair(30, 0);
      for (const point of entity.points) {
        const p = toDxf(point);
        out += pair(0, 'VERTEX') + pair(8, entity.layer) + pair(10, p.x) + pair(20, p.y) + pair(30, 0);
      }
      out += pair(0, 'SEQEND') + pair(8, entity.layer);
      return out;
    }
    case 'circle': {
      const c = toDxf(entity.centre);
      return (
        pair(0, 'CIRCLE') +
        pair(8, entity.layer) +
        pair(10, c.x) +
        pair(20, c.y) +
        pair(30, 0) +
        pair(40, round(entity.radiusMm))
      );
    }
    case 'text': {
      const at = toDxf(entity.at);
      return (
        pair(0, 'TEXT') +
        pair(8, entity.layer) +
        pair(10, at.x) +
        pair(20, at.y) +
        pair(30, 0) +
        pair(40, round(entity.heightMm)) +
        // DXF text has no escape mechanism for a newline, so a value carrying
        // one would silently corrupt the file. Flatten it here.
        pair(1, entity.text.replace(/[\r\n]+/g, ' ')) +
        pair(50, round(entity.rotationDeg ?? 0))
      );
    }
    default:
      return '';
  }
}

/** Serialise a document to DXF R12 text. */
export function writeDxf(doc: DxfDocument): string {
  let out = writeHeader() + writeTables();
  out += pair(0, 'SECTION') + pair(2, 'ENTITIES');
  for (const entity of doc.entities) out += writeEntity(entity);

  /*
   * Title block. Placed below the drawing rather than inside it, so it can
   * never overlap geometry however large the plan is — the caller has already
   * given us the extents by the time this runs.
   */
  const extents = documentExtents(doc.entities);
  const blockTop = extents.maxZ + 2000;
  const textHeight = Math.max(150, (extents.maxX - extents.minX) / 90);
  let line = 0;
  const addLine = (text: string, scale = 1) => {
    out += writeEntity({
      type: 'text',
      layer: 'NZ-TEXT',
      at: { xMm: extents.minX, zMm: blockTop + line * textHeight * 1.9 },
      text,
      heightMm: textHeight * scale,
    });
    line += scale;
  };
  addLine(doc.title, 1.6);
  if (doc.subtitle) addLine(doc.subtitle);
  for (const row of doc.info) addLine(`${row.label}: ${row.value}`);

  out += pair(0, 'ENDSEC') + pair(0, 'EOF');
  return out;
}

export function documentExtents(entities: DxfEntity[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const visit = (point: WallPoint) => {
    minX = Math.min(minX, point.xMm);
    maxX = Math.max(maxX, point.xMm);
    minZ = Math.min(minZ, point.zMm);
    maxZ = Math.max(maxZ, point.zMm);
  };

  for (const entity of entities) {
    switch (entity.type) {
      case 'line':
        visit(entity.a);
        visit(entity.b);
        break;
      case 'polyline':
        entity.points.forEach(visit);
        break;
      case 'circle':
        visit({ xMm: entity.centre.xMm - entity.radiusMm, zMm: entity.centre.zMm - entity.radiusMm });
        visit({ xMm: entity.centre.xMm + entity.radiusMm, zMm: entity.centre.zMm + entity.radiusMm });
        break;
      case 'text':
        visit(entity.at);
        break;
      default:
        break;
    }
  }

  if (!Number.isFinite(minX)) return { minX: 0, maxX: 10_000, minZ: 0, maxZ: 10_000 };
  return { minX, maxX, minZ, maxZ };
}

/* ── Helpers for building a drawing ────────────────────────────────────── */

/** A rectangle centred on a point, rotated about it. */
export function rectangleAt(
  centre: WallPoint,
  widthMm: number,
  depthMm: number,
  rotationDeg = 0
): WallPoint[] {
  const halfW = widthMm / 2;
  const halfD = depthMm / 2;
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    { x: -halfW, z: -halfD },
    { x: halfW, z: -halfD },
    { x: halfW, z: halfD },
    { x: -halfW, z: halfD },
  ].map(({ x, z }) => ({
    xMm: Math.round(centre.xMm + x * cos - z * sin),
    zMm: Math.round(centre.zMm + x * sin + z * cos),
  }));
}

/**
 * A dimension, drawn as an annotated line with ticks.
 *
 * Written as plain geometry rather than a DIMENSION entity on purpose: a real
 * dimension carries a style reference, and a style that does not resolve in the
 * receiving CAD system renders as nothing at all. Lines and text always draw.
 */
export function dimensionEntities(
  a: WallPoint,
  b: WallPoint,
  label: string,
  offsetMm: number,
  textHeightMm: number,
  layer = 'NZ-DIMENSIONS'
): DxfEntity[] {
  const dx = b.xMm - a.xMm;
  const dz = b.zMm - a.zMm;
  const length = Math.hypot(dx, dz) || 1;
  // Perpendicular, so the dimension line sits clear of the thing it measures.
  const nx = (-dz / length) * offsetMm;
  const nz = (dx / length) * offsetMm;

  const a2: WallPoint = { xMm: a.xMm + nx, zMm: a.zMm + nz };
  const b2: WallPoint = { xMm: b.xMm + nx, zMm: b.zMm + nz };
  const mid: WallPoint = { xMm: (a2.xMm + b2.xMm) / 2, zMm: (a2.zMm + b2.zMm) / 2 };
  const angle = (Math.atan2(-dz, dx) * 180) / Math.PI;

  return [
    { type: 'line', layer, a, b: a2 },
    { type: 'line', layer, a: b, b: b2 },
    { type: 'line', layer, a: a2, b: b2 },
    {
      type: 'text',
      layer,
      at: { xMm: mid.xMm, zMm: mid.zMm + textHeightMm * 0.4 },
      text: label,
      heightMm: textHeightMm,
      rotationDeg: angle > 90 || angle < -90 ? angle + 180 : angle,
    },
  ];
}
