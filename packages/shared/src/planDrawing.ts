/**
 * The technical drawing.
 *
 * One geometric model of the plan, consumed by three outputs: the DXF a
 * fabricator opens, the dimensioned PDF that goes in a tender, and the top-view
 * plan on a presentation board. Building it once is what stops the three
 * disagreeing — a drawing that shows a 6 m stage and a PDF that dimensions it
 * at 5.8 m destroys confidence in both.
 *
 * Everything is plan-space millimetres, looking straight down, with +X east and
 * +Z south. Elevation is dropped: this is a plan, and a plan is flat.
 */
import { deriveLedScreen } from './led.js';
import { deriveStage } from './stage.js';
import { formatLength, type UnitSystem } from './units.js';
import { dimensionEntities, rectangleAt, type DxfDocument, type DxfEntity } from './dxf.js';
import { CONSTRAINT_INFO } from './constraints.js';
import { LIGHT_FIXTURE_SPECS } from './lighting.js';
import { polygonArea } from './walls.js';
import type {
  BoothSceneObject,
  CatalogSceneObject,
  ConstraintSceneObject,
  LedScreenSceneObject,
  LightFixtureSceneObject,
  SceneDocument,
  StageSceneObject,
  TentSceneObject,
  TrussSceneObject,
  WallPoint,
} from './scene.js';

/* ── The model ─────────────────────────────────────────────────────────── */

export const DRAWING_LAYERS = [
  'walls',
  'floor',
  'stage',
  'truss',
  'led',
  'booth',
  'furniture',
  'lighting',
  'constraints',
  'dimensions',
  'text',
] as const;
export type DrawingLayer = (typeof DRAWING_LAYERS)[number];

export const DRAWING_LAYER_INFO: Record<DrawingLayer, { label: string; dxfLayer: string; color: string; dashed: boolean }> = {
  walls: { label: 'Walls', dxfLayer: 'NZ-WALLS', color: '#111827', dashed: false },
  floor: { label: 'Floor', dxfLayer: 'NZ-FLOOR', color: '#9ca3af', dashed: false },
  stage: { label: 'Staging', dxfLayer: 'NZ-STAGE', color: '#0891b2', dashed: false },
  truss: { label: 'Truss & rigging', dxfLayer: 'NZ-TRUSS', color: '#c026d3', dashed: false },
  led: { label: 'LED & screens', dxfLayer: 'NZ-LED', color: '#2563eb', dashed: false },
  booth: { label: 'Stands', dxfLayer: 'NZ-BOOTH', color: '#16a34a', dashed: false },
  furniture: { label: 'Furniture', dxfLayer: 'NZ-FURNITURE', color: '#6b7280', dashed: false },
  lighting: { label: 'Lighting', dxfLayer: 'NZ-LIGHTING', color: '#ca8a04', dashed: false },
  constraints: { label: 'Site constraints', dxfLayer: 'NZ-CONSTRAINTS', color: '#dc2626', dashed: true },
  dimensions: { label: 'Dimensions', dxfLayer: 'NZ-DIMENSIONS', color: '#16a34a', dashed: false },
  text: { label: 'Labels', dxfLayer: 'NZ-TEXT', color: '#111827', dashed: false },
};

export type DrawingShape =
  | { kind: 'polygon'; layer: DrawingLayer; points: WallPoint[]; closed: boolean; fill?: string | null; label?: string }
  | { kind: 'line'; layer: DrawingLayer; a: WallPoint; b: WallPoint }
  | { kind: 'circle'; layer: DrawingLayer; centre: WallPoint; radiusMm: number; fill?: string | null; label?: string }
  | { kind: 'text'; layer: DrawingLayer; at: WallPoint; text: string; heightMm: number; rotationDeg?: number }
  | { kind: 'dimension'; layer: DrawingLayer; a: WallPoint; b: WallPoint; label: string; offsetMm: number };

export interface PlanDrawing {
  shapes: DrawingShape[];
  extents: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** What the drawing contains, for the legend. */
  legend: Array<{ layer: DrawingLayer; label: string; count: number }>;
  /** Key figures for the title block. */
  facts: Array<{ label: string; value: string }>;
}

export interface DrawingOptions {
  units: UnitSystem;
  /** Layers to include. Omitted layers are not drawn at all. */
  layers?: DrawingLayer[];
  /** Add overall width and depth dimensions around the plan. */
  overallDimensions: boolean;
  /** Dimension every major element individually. */
  detailDimensions: boolean;
  /** Label each element with its name. */
  labels: boolean;
  title: string;
  subtitle?: string;
}

export const DEFAULT_DRAWING_OPTIONS: DrawingOptions = {
  units: 'metric',
  overallDimensions: true,
  detailDimensions: true,
  labels: true,
  title: 'Layout plan',
};

/* ── Building it ───────────────────────────────────────────────────────── */

/**
 * Reduce a scene to a plan drawing.
 *
 * Each object type contributes its own footprint, so adding a new type is a
 * single case here — and an object type that is *not* handled contributes
 * nothing rather than a wrong box, which is the right failure: a missing
 * element is obvious on a drawing, a wrong one is not.
 */
export function buildPlanDrawing(scene: SceneDocument, options: DrawingOptions = DEFAULT_DRAWING_OPTIONS): PlanDrawing {
  const enabled = new Set<DrawingLayer>(options.layers ?? [...DRAWING_LAYERS]);
  const shapes: DrawingShape[] = [];
  const counts = new Map<DrawingLayer, number>();

  const add = (shape: DrawingShape) => {
    if (!enabled.has(shape.layer)) return;
    shapes.push(shape);
    if (shape.kind !== 'text' && shape.kind !== 'dimension') {
      counts.set(shape.layer, (counts.get(shape.layer) ?? 0) + 1);
    }
  };

  const world = (object: { positionMm: { x: number; z: number } }, local: WallPoint, rotationDeg = 0): WallPoint => {
    const radians = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
      xMm: Math.round(object.positionMm.x + local.xMm * cos - local.zMm * sin),
      zMm: Math.round(object.positionMm.z + local.xMm * sin + local.zMm * cos),
    };
  };

  /* ── Floors and walls ────────────────────────────────────────────────── */

  for (const floor of scene.walls.floors) {
    add({ kind: 'polygon', layer: 'floor', points: floor.points, closed: true, fill: '#f3f4f6' });
  }
  for (const segment of scene.walls.segments) {
    // A wall is drawn as its true thickness, because that is what a builder
    // sets out to — a centre line is ambiguous about which side it is on.
    const dx = segment.end.xMm - segment.start.xMm;
    const dz = segment.end.zMm - segment.start.zMm;
    const length = Math.hypot(dx, dz) || 1;
    const half = segment.thicknessMm / 2;
    const nx = (-dz / length) * half;
    const nz = (dx / length) * half;
    add({
      kind: 'polygon',
      layer: 'walls',
      closed: true,
      fill: '#374151',
      points: [
        { xMm: segment.start.xMm + nx, zMm: segment.start.zMm + nz },
        { xMm: segment.end.xMm + nx, zMm: segment.end.zMm + nz },
        { xMm: segment.end.xMm - nx, zMm: segment.end.zMm - nz },
        { xMm: segment.start.xMm - nx, zMm: segment.start.zMm - nz },
      ],
    });
  }

  /* ── Objects ─────────────────────────────────────────────────────────── */

  let stageCount = 0;
  let boothCount = 0;
  let fixtureCount = 0;
  let ledAreaSqM = 0;
  let trussLengthM = 0;

  for (const object of scene.objects) {
    if (object.hidden) continue;
    const centre: WallPoint = { xMm: object.positionMm.x, zMm: object.positionMm.z };
    const rotation = object.rotationDeg.y;

    switch (object.type) {
      case 'stage': {
        const stage = object as StageSceneObject;
        const derived = deriveStage(stage);
        stageCount += 1;
        add({
          kind: 'polygon',
          layer: 'stage',
          closed: true,
          fill: '#cffafe',
          points: rectangleAt(centre, derived.footprintMm.width, derived.footprintMm.depth, rotation),
          label: object.name ?? 'Stage',
        });
        // The deck grid, so a crew can count modules off the drawing.
        for (let c = 1; c < stage.deckColumns; c += 1) {
          const x = -derived.footprintMm.width / 2 + c * 1219;
          add({
            kind: 'line',
            layer: 'stage',
            a: world(object, { xMm: x, zMm: -derived.footprintMm.depth / 2 }, rotation),
            b: world(object, { xMm: x, zMm: derived.footprintMm.depth / 2 }, rotation),
          });
        }
        for (let r = 1; r < stage.deckRows; r += 1) {
          const z = -derived.footprintMm.depth / 2 + r * 1219;
          add({
            kind: 'line',
            layer: 'stage',
            a: world(object, { xMm: -derived.footprintMm.width / 2, zMm: z }, rotation),
            b: world(object, { xMm: derived.footprintMm.width / 2, zMm: z }, rotation),
          });
        }
        if (options.labels) {
          add({
            kind: 'text',
            layer: 'text',
            at: centre,
            text: `${object.name ?? 'Stage'} · ${formatLength(stage.deckHeightMm, options.units)} high`,
            heightMm: 200,
          });
        }
        if (options.detailDimensions) {
          const corners = rectangleAt(centre, derived.footprintMm.width, derived.footprintMm.depth, rotation);
          add({
            kind: 'dimension',
            layer: 'dimensions',
            a: corners[0]!,
            b: corners[1]!,
            label: formatLength(derived.footprintMm.width, options.units),
            offsetMm: -600,
          });
          add({
            kind: 'dimension',
            layer: 'dimensions',
            a: corners[1]!,
            b: corners[2]!,
            label: formatLength(derived.footprintMm.depth, options.units),
            offsetMm: -600,
          });
        }
        break;
      }

      case 'truss': {
        const truss = object as TrussSceneObject;
        const points = (truss.points ?? []).map((p) => world(object, p, rotation));
        if (points.length < 2) break;
        trussLengthM += pathLengthM(points, truss.closed);
        add({ kind: 'polygon', layer: 'truss', points, closed: truss.closed, fill: null });
        if (options.labels) {
          add({
            kind: 'text',
            layer: 'text',
            at: points[0]!,
            text: `${object.name ?? 'Truss'} @ ${formatLength(truss.trimHeightMm, options.units)}`,
            heightMm: 180,
          });
        }
        // Legs, drawn as crosses at the ends — a rigger reads those as ground
        // support and their absence as flown.
        if (truss.legType === 'base-plate' || truss.legType === 'tower') {
          for (const point of truss.closed ? points : [points[0]!, points[points.length - 1]!]) {
            add({ kind: 'circle', layer: 'truss', centre: point, radiusMm: 350, fill: null });
          }
        }
        break;
      }

      case 'led': {
        const screen = object as LedScreenSceneObject;
        const derived = deriveLedScreen(screen);
        ledAreaSqM += derived.areaSqM;
        add({
          kind: 'polygon',
          layer: 'led',
          closed: true,
          fill: '#dbeafe',
          points: rectangleAt(centre, derived.widthMm, Math.max(300, derived.panel.depthMm), rotation),
          label: object.name ?? 'LED',
        });
        if (options.labels) {
          add({
            kind: 'text',
            layer: 'text',
            at: { xMm: centre.xMm, zMm: centre.zMm - 700 },
            text: `${object.name ?? 'LED'} ${(derived.widthMm / 1000).toFixed(2)} × ${(derived.heightMm / 1000).toFixed(2)} m, ${derived.panel.label}`,
            heightMm: 180,
          });
        }
        if (options.detailDimensions) {
          const corners = rectangleAt(centre, derived.widthMm, 300, rotation);
          add({
            kind: 'dimension',
            layer: 'dimensions',
            a: corners[0]!,
            b: corners[1]!,
            label: formatLength(derived.widthMm, options.units),
            offsetMm: -900,
          });
        }
        break;
      }

      case 'booth': {
        const booth = object as BoothSceneObject;
        boothCount += 1;
        add({
          kind: 'polygon',
          layer: 'booth',
          closed: true,
          fill: '#dcfce7',
          points: rectangleAt(centre, booth.widthMm, booth.depthMm, rotation),
          label: booth.standNumber ?? object.name ?? 'Stand',
        });
        // Walls drawn thicker than the outline, so open sides read at a glance.
        const halfW = booth.widthMm / 2;
        const halfD = booth.depthMm / 2;
        const sides: Record<string, [WallPoint, WallPoint]> = {
          front: [{ xMm: -halfW, zMm: halfD }, { xMm: halfW, zMm: halfD }],
          back: [{ xMm: -halfW, zMm: -halfD }, { xMm: halfW, zMm: -halfD }],
          left: [{ xMm: -halfW, zMm: -halfD }, { xMm: -halfW, zMm: halfD }],
          right: [{ xMm: halfW, zMm: -halfD }, { xMm: halfW, zMm: halfD }],
        };
        for (const side of booth.walls) {
          const pair = sides[side];
          if (!pair) continue;
          add({ kind: 'line', layer: 'booth', a: world(object, pair[0], rotation), b: world(object, pair[1], rotation) });
        }
        if (options.labels) {
          add({
            kind: 'text',
            layer: 'text',
            at: centre,
            text: [booth.standNumber, booth.exhibitorName, `${booth.widthMm / 1000} × ${booth.depthMm / 1000} m`]
              .filter(Boolean)
              .join(' · '),
            heightMm: 200,
          });
        }
        break;
      }

      case 'tent': {
        const tent = object as TentSceneObject;
        add({
          kind: 'polygon',
          layer: 'stage',
          closed: true,
          fill: null,
          points: rectangleAt(centre, tent.widthMm, tent.lengthMm, rotation),
          label: object.name ?? 'Tent',
        });
        break;
      }

      case 'light': {
        const light = object as LightFixtureSceneObject;
        if (light.muted) break;
        fixtureCount += 1;
        add({ kind: 'circle', layer: 'lighting', centre, radiusMm: 180, fill: '#fef08a' });
        // The aim line: a lighting plot is unreadable without it.
        add({
          kind: 'line',
          layer: 'lighting',
          a: centre,
          b: { xMm: light.targetMm.x, zMm: light.targetMm.z },
        });
        if (options.labels) {
          add({
            kind: 'text',
            layer: 'text',
            at: { xMm: centre.xMm + 260, zMm: centre.zMm },
            text: `${LIGHT_FIXTURE_SPECS[light.fixture].label} ${light.channel}`,
            heightMm: 140,
          });
        }
        break;
      }

      case 'constraint': {
        const constraint = object as ConstraintSceneObject;
        const info = CONSTRAINT_INFO[constraint.constraintKind];
        const points = (constraint.points ?? []).map((p) => world(object, p, rotation));
        if (info.geometry === 'area' && points.length >= 3) {
          add({ kind: 'polygon', layer: 'constraints', points, closed: true, fill: null, label: constraint.label });
          if (options.labels) {
            add({
              kind: 'text',
              layer: 'text',
              at: points[0]!,
              text: constraint.label || info.label,
              heightMm: 180,
            });
          }
        } else {
          const at = points[0] ?? centre;
          add({ kind: 'circle', layer: 'constraints', centre: at, radiusMm: 300, fill: null });
          if (options.labels) {
            add({
              kind: 'text',
              layer: 'text',
              at: { xMm: at.xMm + 400, zMm: at.zMm },
              text: constraint.label || info.label,
              heightMm: 180,
            });
          }
        }
        break;
      }

      case 'catalog': {
        const item = object as CatalogSceneObject;
        if (item.venueId) break;
        const size = item.dimensionsMm ?? { width: 600, depth: 600, height: 750 };
        if (item.tableShape === 'round') {
          add({ kind: 'circle', layer: 'furniture', centre, radiusMm: size.width / 2, fill: null, label: object.name });
        } else {
          add({
            kind: 'polygon',
            layer: 'furniture',
            closed: true,
            fill: null,
            points: rectangleAt(centre, size.width, size.depth, rotation),
            label: object.name,
          });
        }
        break;
      }

      case 'curtain': {
        const curtain = object as SceneObject2<{ middleWidthMm: number }>;
        add({
          kind: 'polygon',
          layer: 'furniture',
          closed: false,
          fill: null,
          points: rectangleAt(centre, curtain.middleWidthMm, 300, rotation),
        });
        break;
      }

      default:
        break;
    }
  }

  /* ── Extents and overall dimensions ──────────────────────────────────── */

  const extents = shapeExtents(shapes);

  if (options.overallDimensions && shapes.length) {
    const margin = Math.max(1500, (extents.maxX - extents.minX) * 0.06);
    add({
      kind: 'dimension',
      layer: 'dimensions',
      a: { xMm: extents.minX, zMm: extents.maxZ },
      b: { xMm: extents.maxX, zMm: extents.maxZ },
      label: formatLength(extents.maxX - extents.minX, options.units),
      offsetMm: margin,
    });
    add({
      kind: 'dimension',
      layer: 'dimensions',
      a: { xMm: extents.maxX, zMm: extents.maxZ },
      b: { xMm: extents.maxX, zMm: extents.minZ },
      label: formatLength(extents.maxZ - extents.minZ, options.units),
      offsetMm: margin,
    });
  }

  const floorAreaSqM = scene.walls.floors.reduce((sum, f) => sum + polygonArea(f.points) / 1_000_000, 0);

  const facts: Array<{ label: string; value: string }> = [
    { label: 'Overall', value: `${formatLength(extents.maxX - extents.minX, options.units)} × ${formatLength(extents.maxZ - extents.minZ, options.units)}` },
  ];
  if (floorAreaSqM > 0) facts.push({ label: 'Floor area', value: `${floorAreaSqM.toFixed(1)} m²` });
  if (stageCount) facts.push({ label: 'Staging', value: `${stageCount} platform${stageCount === 1 ? '' : 's'}` });
  if (ledAreaSqM) facts.push({ label: 'LED', value: `${ledAreaSqM.toFixed(1)} m²` });
  if (trussLengthM) facts.push({ label: 'Truss', value: `${trussLengthM.toFixed(1)} m` });
  if (boothCount) facts.push({ label: 'Stands', value: String(boothCount) });
  if (fixtureCount) facts.push({ label: 'Fixtures', value: String(fixtureCount) });
  facts.push({ label: 'Scale', value: 'To scale, dimensions in ' + (options.units === 'metric' ? 'metres' : 'feet and inches') });

  const legend = [...counts.entries()]
    .map(([layer, count]) => ({ layer, label: DRAWING_LAYER_INFO[layer].label, count }))
    .sort((a, b) => DRAWING_LAYERS.indexOf(a.layer) - DRAWING_LAYERS.indexOf(b.layer));

  return { shapes, extents, legend, facts };
}

/** Minimal structural type for objects read only for one or two fields. */
type SceneObject2<T> = T & { positionMm: { x: number; y: number; z: number }; rotationDeg: { y: number } };

function pathLengthM(points: WallPoint[], closed: boolean): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += Math.hypot(points[i + 1]!.xMm - points[i]!.xMm, points[i + 1]!.zMm - points[i]!.zMm);
  }
  if (closed && points.length > 2) {
    total += Math.hypot(points[0]!.xMm - points[points.length - 1]!.xMm, points[0]!.zMm - points[points.length - 1]!.zMm);
  }
  return total / 1000;
}

export function shapeExtents(shapes: DrawingShape[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const visit = (p: WallPoint) => {
    minX = Math.min(minX, p.xMm);
    maxX = Math.max(maxX, p.xMm);
    minZ = Math.min(minZ, p.zMm);
    maxZ = Math.max(maxZ, p.zMm);
  };
  for (const shape of shapes) {
    switch (shape.kind) {
      case 'polygon':
        shape.points.forEach(visit);
        break;
      case 'line':
        visit(shape.a);
        visit(shape.b);
        break;
      case 'circle':
        visit({ xMm: shape.centre.xMm - shape.radiusMm, zMm: shape.centre.zMm - shape.radiusMm });
        visit({ xMm: shape.centre.xMm + shape.radiusMm, zMm: shape.centre.zMm + shape.radiusMm });
        break;
      case 'text':
        visit(shape.at);
        break;
      case 'dimension':
        visit(shape.a);
        visit(shape.b);
        break;
      default:
        break;
    }
  }
  if (!Number.isFinite(minX)) return { minX: -5000, maxX: 5000, minZ: -5000, maxZ: 5000 };
  return { minX, maxX, minZ, maxZ };
}

/* ── DXF ───────────────────────────────────────────────────────────────── */

/** Convert the drawing to a DXF document. */
export function drawingToDxf(
  drawing: PlanDrawing,
  meta: { title: string; subtitle: string; info: Array<{ label: string; value: string }> }
): DxfDocument {
  const entities: DxfEntity[] = [];
  const textHeight = Math.max(120, (drawing.extents.maxX - drawing.extents.minX) / 120);

  for (const shape of drawing.shapes) {
    const layer = DRAWING_LAYER_INFO[shape.layer].dxfLayer;
    switch (shape.kind) {
      case 'polygon':
        entities.push({ type: 'polyline', layer, points: shape.points, closed: shape.closed });
        break;
      case 'line':
        entities.push({ type: 'line', layer, a: shape.a, b: shape.b });
        break;
      case 'circle':
        entities.push({ type: 'circle', layer, centre: shape.centre, radiusMm: shape.radiusMm });
        break;
      case 'text':
        entities.push({ type: 'text', layer, at: shape.at, text: shape.text, heightMm: shape.heightMm, rotationDeg: shape.rotationDeg });
        break;
      case 'dimension':
        entities.push(...dimensionEntities(shape.a, shape.b, shape.label, shape.offsetMm, textHeight, layer));
        break;
      default:
        break;
    }
  }

  return { entities, title: meta.title, subtitle: meta.subtitle, info: [...meta.info, ...drawing.facts] };
}
