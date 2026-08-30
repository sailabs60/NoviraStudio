/**
 * Quantity take-off.
 *
 * This is the feature the brief calls unavoidable, and the reason is simple:
 * agencies measure their own drawings by hand, every time, under deadline, and
 * they get it wrong. A design that already knows it contains 84 m² of LED,
 * 46 m of F34, 320 m² of carpet and 61 m² of print has removed the most
 * error-prone hour of the whole tender.
 *
 * Two rules make the output trustworthy:
 *
 * 1. **Every quantity is measured from the geometry**, never from a label. LED
 *    area is cabinets × cabinet size; truss length follows the path; carpet is
 *    the floor polygon less what stands on it. If the drawing changes, the
 *    number changes, and it cannot drift out of step.
 * 2. **Every quantity says where it came from.** A line carries the objects it
 *    was measured from, so "46 m of truss" can be clicked and seen. A number
 *    nobody can trace is a number nobody will stake a tender on.
 *
 * Money is not computed here — that is `rates.ts`, applied on top. Separating
 * measurement from pricing is what lets one agency's rate card produce a
 * different quote from the same drawing.
 */
import { deriveBooth, type BoothLike } from './booth.js';
import { deriveLedScreen } from './led.js';
import { lightingLoad, LIGHT_FIXTURE_SPECS, type LightFixtureKey } from './lighting.js';
import { deriveStage } from './stage.js';
import { deriveTruss } from './truss.js';
import { TYPICAL_WEIGHTS_KG } from './constraints.js';
import { polygonArea } from './walls.js';
import type {
  BoothSceneObject,
  CatalogSceneObject,
  ConstraintSceneObject,
  CurtainSceneObject,
  LedScreenSceneObject,
  LightFixtureSceneObject,
  SceneDocument,
  SceneObject,
  StageSceneObject,
  TentSceneObject,
  TrussSceneObject,
} from './scene.js';

/* ── Measures ──────────────────────────────────────────────────────────── */

export const TAKEOFF_UNITS = ['sqm', 'm', 'each', 'cum', 'kg', 'hour', 'kw'] as const;
export type TakeoffUnit = (typeof TAKEOFF_UNITS)[number];

export const TAKEOFF_UNIT_LABELS: Record<TakeoffUnit, string> = {
  sqm: 'm²',
  m: 'm',
  each: 'each',
  cum: 'm³',
  kg: 'kg',
  hour: 'hours',
  kw: 'kW',
};

/**
 * Trade groups, in the order a bill of quantities is normally set out:
 * structure first, then surfaces, then technical, then labour.
 */
export const TAKEOFF_GROUPS = [
  'structure',
  'surfaces',
  'print',
  'screens',
  'lighting',
  'furniture',
  'power',
  'labour',
  'logistics',
] as const;
export type TakeoffGroup = (typeof TAKEOFF_GROUPS)[number];

export const TAKEOFF_GROUP_LABELS: Record<TakeoffGroup, string> = {
  structure: 'Structure & rigging',
  surfaces: 'Surfaces & flooring',
  print: 'Print & graphics',
  screens: 'Screens & LED',
  lighting: 'Lighting',
  furniture: 'Furniture & fittings',
  power: 'Power & distribution',
  labour: 'Labour',
  logistics: 'Logistics',
};

export interface TakeoffLine {
  /** Stable key, so a rate card can price a line by code rather than by name. */
  code: string;
  group: TakeoffGroup;
  description: string;
  /** Thousandths, matching the proposal arithmetic in `quoting.ts`. */
  quantityMilli: number;
  unit: TakeoffUnit;
  /** Scene objects this line was measured from. */
  objectIds: string[];
  /** How the figure was arrived at, shown on hover. */
  basis: string;
}

export interface TakeoffSummary {
  /** The headline figures the brief names, each in its natural unit. */
  ledSqM: number;
  trussLengthM: number;
  carpetSqM: number;
  printSqM: number;
  structureVolumeCuM: number;
  labourHours: number;
  /** Supporting figures a planner will be asked for in the same breath. */
  totalWeightKg: number;
  flownWeightKg: number;
  powerKw: number;
  peakAmps: number;
  fixtureCount: number;
  seatCount: number;
  tableCount: number;
  boothCount: number;
  floorAreaSqM: number;
  /** Truck loads, derived from volume and weight. */
  truckLoads: number;
}

export interface TakeoffResult {
  lines: TakeoffLine[];
  summary: TakeoffSummary;
  /** Anything measured but ambiguous, so a human can decide. */
  notes: string[];
}

/* ── Labour model ──────────────────────────────────────────────────────── */

/**
 * Build hours per unit of work.
 *
 * These are crew-hours, not elapsed hours: 40 hours of truss is five people for
 * a day, not five days. They are deliberately conservative and deliberately
 * visible, because every agency will want to tune them — which is exactly what
 * the rate card override is for.
 */
export const LABOUR_RATES = {
  /** Per metre of truss, including rigging and de-rig. */
  trussPerM: 0.55,
  /** Per LED cabinet, hung or stacked, plus processing. */
  ledPerCabinet: 0.35,
  /** Per square metre of stage deck. */
  stagePerSqM: 0.22,
  /** Per square metre of carpet or floor covering. */
  floorPerSqM: 0.08,
  /** Per lighting fixture, rigged, addressed and focused. */
  fixturePerUnit: 0.4,
  /** Per exhibition stand square metre, built and dressed. */
  boothPerSqM: 1.1,
  /** Per banquet table, laid and dressed. */
  tablePerUnit: 0.25,
  /** Per square metre of print applied. */
  printPerSqM: 0.12,
  /** Per metre of drape hung. */
  drapePerM: 0.3,
} as const;

export type LabourRates = typeof LABOUR_RATES;

/** Volume one truck carries, and the mass it can take. */
const TRUCK_VOLUME_CU_M = 38;
const TRUCK_PAYLOAD_KG = 9500;

/* ── The take-off ──────────────────────────────────────────────────────── */

const milli = (value: number): number => Math.round(value * 1000);

function push(lines: TakeoffLine[], line: TakeoffLine) {
  // Merge lines with the same code so a plan with twenty identical stands
  // reads as one line of twenty, not twenty lines of one.
  const existing = lines.find((l) => l.code === line.code && l.unit === line.unit);
  if (existing) {
    existing.quantityMilli += line.quantityMilli;
    existing.objectIds.push(...line.objectIds);
    return;
  }
  lines.push(line);
}

/**
 * Measure a scene.
 *
 * `labour` is injectable so an agency's own build rates replace the defaults
 * without this function knowing anything about rate cards.
 */
export function takeoff(scene: SceneDocument, labour: Partial<LabourRates> = {}): TakeoffResult {
  const rates: LabourRates = { ...LABOUR_RATES, ...labour };
  const lines: TakeoffLine[] = [];
  const notes: string[] = [];

  let ledSqM = 0;
  let trussLengthM = 0;
  let printSqM = 0;
  let structureVolumeCuM = 0;
  let labourHours = 0;
  let totalWeightKg = 0;
  let flownWeightKg = 0;
  let powerWatts = 0;
  let seatCount = 0;
  let tableCount = 0;
  let boothCount = 0;
  let boothFloorSqM = 0;
  let stageSqM = 0;

  const fixtures: Array<{ fixture: LightFixtureKey }> = [];
  const visible = scene.objects.filter((o) => !o.hidden);

  for (const object of visible) {
    switch (object.type) {
      case 'truss': {
        const truss = object as TrussSceneObject;
        const derived = deriveTruss({
          systemKey: truss.systemKey,
          points: truss.points ?? [],
          closed: truss.closed,
          trimHeightMm: truss.trimHeightMm,
          legType: truss.legType,
          hangingLoadKg: truss.hangingLoadKg,
        });
        const metres = derived.totalLengthMm / 1000;
        trussLengthM += metres;
        totalWeightKg += derived.totalWeightKg;
        if (truss.legType === 'flown') flownWeightKg += derived.totalWeightKg;

        push(lines, {
          code: `TRUSS-${derived.system.key}`,
          group: 'structure',
          description: `${derived.system.label} truss`,
          quantityMilli: milli(metres),
          unit: 'm',
          objectIds: [object.id],
          basis: `Path length of the run, ${derived.sections.map((s) => `${s.count} × ${s.lengthMm / 1000} m`).join(' + ')}.`,
        });
        if (derived.legCount > 0) {
          push(lines, {
            code: `TRUSS-SUPPORT-${truss.legType}`,
            group: 'structure',
            description: truss.legType === 'tower' ? 'Lifting tower with outriggers' : 'Base plate and upright',
            quantityMilli: milli(derived.legCount),
            unit: 'each',
            objectIds: [object.id],
            basis: `${derived.legCount} supports at a ${(truss.trimHeightMm / 1000).toFixed(2)} m trim.`,
          });
        }
        labourHours += metres * rates.trussPerM;
        break;
      }

      case 'led': {
        const screen = object as LedScreenSceneObject;
        const derived = deriveLedScreen(screen);
        ledSqM += derived.areaSqM;
        totalWeightKg += derived.weightKg;
        if (screen.frame === 'flown') flownWeightKg += derived.weightKg;
        powerWatts += derived.powerAvgW;

        push(lines, {
          code: `LED-${derived.panel.key}`,
          group: 'screens',
          description: `${derived.panel.label} LED, ${derived.panel.pitchMm} mm pitch`,
          quantityMilli: milli(derived.areaSqM),
          unit: 'sqm',
          objectIds: [object.id],
          basis: `${derived.cabinetCount} cabinets at ${derived.panel.widthMm} × ${derived.panel.heightMm} mm = ${derived.widthMm / 1000} × ${derived.heightMm / 1000} m.`,
        });
        push(lines, {
          code: 'LED-PROCESSING',
          group: 'screens',
          description: 'LED processing and signal distribution',
          quantityMilli: milli(derived.processors),
          unit: 'each',
          objectIds: [object.id],
          basis: `${derived.totalPixels.toLocaleString()} pixels across ${derived.dataRuns} data runs.`,
        });
        push(lines, {
          code: `LED-FRAME-${screen.frame}`,
          group: 'structure',
          description:
            screen.frame === 'flown'
              ? 'LED flying bar and hardware'
              : screen.frame === 'ground-support'
                ? 'LED ground support frame'
                : 'LED mounting hardware',
          quantityMilli: milli(derived.widthMm / 1000),
          unit: 'm',
          objectIds: [object.id],
          basis: `Full screen width, ${(derived.widthMm / 1000).toFixed(2)} m.`,
        });
        labourHours += derived.cabinetCount * rates.ledPerCabinet;
        break;
      }

      case 'stage': {
        const stage = object as StageSceneObject;
        const derived = deriveStage(stage);
        const sqM = (derived.footprintMm.width * derived.footprintMm.depth) / 1_000_000;
        stageSqM += sqM;
        structureVolumeCuM += (sqM * stage.deckHeightMm) / 1000;
        totalWeightKg += (TYPICAL_WEIGHTS_KG.stage ?? 34) * stage.deckRows * stage.deckColumns;

        for (const bomLine of derived.bom) {
          push(lines, {
            code: `STAGE-${bomLine.part.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
            group: 'structure',
            description: bomLine.part,
            quantityMilli: milli(bomLine.quantity),
            unit: 'each',
            objectIds: [object.id],
            basis:
              bomLine.note ??
              `Derived from a ${stage.deckColumns} × ${stage.deckRows} deck at ${stage.deckHeightMm} mm.`,
          });
        }
        labourHours += sqM * rates.stagePerSqM;
        break;
      }

      case 'booth': {
        const booth = object as BoothSceneObject;
        const derived = deriveBooth(booth as unknown as BoothLike);
        boothCount += 1;
        boothFloorSqM += derived.floorAreaSqM;
        printSqM += derived.printAreaSqM;
        structureVolumeCuM += derived.volumeCuM;
        totalWeightKg += TYPICAL_WEIGHTS_KG.booth ?? 350;

        push(lines, {
          code: `BOOTH-WALL-${booth.wallFinish}`,
          group: 'structure',
          description: `Stand wall, ${booth.wallFinish.replace(/-/g, ' ')}`,
          quantityMilli: milli(derived.wallAreaSqM),
          unit: 'sqm',
          objectIds: [object.id],
          basis: `${derived.wallRunM} m of wall at ${(booth.heightMm / 1000).toFixed(2)} m high.`,
        });
        if (derived.printAreaSqM > 0) {
          push(lines, {
            code: 'PRINT-STAND',
            group: 'print',
            description: 'Printed stand graphics',
            quantityMilli: milli(derived.printAreaSqM),
            unit: 'sqm',
            objectIds: [object.id],
            basis: 'Printable wall faces plus fascia.',
          });
        }
        if (booth.floorFinish !== 'none') {
          push(lines, {
            code: `FLOOR-${booth.floorFinish}`,
            group: 'surfaces',
            description: `Stand floor, ${booth.floorFinish.replace(/-/g, ' ')}`,
            quantityMilli: milli(derived.floorAreaSqM),
            unit: 'sqm',
            objectIds: [object.id],
            basis: `Stand footprint ${booth.widthMm / 1000} × ${booth.depthMm / 1000} m.`,
          });
        }
        labourHours += derived.areaSqM * rates.boothPerSqM;
        break;
      }

      case 'light': {
        const light = object as LightFixtureSceneObject;
        if (light.muted) break;
        fixtures.push({ fixture: light.fixture });
        const spec = LIGHT_FIXTURE_SPECS[light.fixture];
        totalWeightKg += spec.weightKg;
        if ((light.positionMm?.y ?? 0) > 2200) flownWeightKg += spec.weightKg;
        break;
      }

      case 'curtain': {
        const curtain = object as CurtainSceneObject;
        const widthM = Math.max(curtain.topWidthMm, curtain.middleWidthMm, curtain.bottomWidthMm) / 1000;
        const heightM = curtain.heightMm / 1000;
        totalWeightKg += TYPICAL_WEIGHTS_KG.curtain ?? 25;
        push(lines, {
          code: 'DRAPE',
          group: 'surfaces',
          description: 'Pleated drape, hung',
          quantityMilli: milli(widthM),
          unit: 'm',
          objectIds: [object.id],
          basis: `${widthM.toFixed(2)} m wide at ${heightM.toFixed(2)} m drop, ${curtain.foldCount} pleats.`,
        });
        labourHours += widthM * rates.drapePerM;
        break;
      }

      case 'tent': {
        const tent = object as TentSceneObject;
        const sqM = (tent.widthMm * tent.lengthMm) / 1_000_000;
        structureVolumeCuM += (sqM * tent.peakHeightMm) / 1000;
        totalWeightKg += TYPICAL_WEIGHTS_KG.tent ?? 400;
        push(lines, {
          code: 'TENT-FRAME',
          group: 'structure',
          description: `Framed structure, ${tent.widthMm / 1000} m span`,
          quantityMilli: milli(sqM),
          unit: 'sqm',
          objectIds: [object.id],
          basis: `${tent.widthMm / 1000} × ${tent.lengthMm / 1000} m covered.`,
        });
        const walls = tent.slots.filter((s) => s.catalogItemId !== null).length;
        if (walls) {
          push(lines, {
            code: 'TENT-WALL',
            group: 'structure',
            description: 'Sidewall bay',
            quantityMilli: milli(walls),
            unit: 'each',
            objectIds: [object.id],
            basis: `${walls} of ${tent.slots.length} bays filled.`,
          });
        }
        break;
      }

      case 'text3d': {
        // Dimensional lettering is fabricated, so it is priced by face area.
        const text = object as SceneObject & { content?: string; heightMm?: number; depthMm?: number };
        const chars = Math.max(1, (text.content ?? '').replace(/\s/g, '').length);
        const heightM = (text.heightMm ?? 300) / 1000;
        const faceSqM = chars * heightM * heightM * 0.55;
        printSqM += 0;
        push(lines, {
          code: 'LETTERING-3D',
          group: 'print',
          description: 'Dimensional lettering, fabricated',
          quantityMilli: milli(faceSqM),
          unit: 'sqm',
          objectIds: [object.id],
          basis: `${chars} characters at ${(heightM * 1000).toFixed(0)} mm cap height.`,
        });
        totalWeightKg += TYPICAL_WEIGHTS_KG.text3d ?? 12;
        break;
      }

      case 'artwork': {
        const art = object as SceneObject & { widthMm?: number; heightMm?: number };
        const sqM = ((art.widthMm ?? 1000) * (art.heightMm ?? 1000)) / 1_000_000;
        printSqM += sqM;
        push(lines, {
          code: 'PRINT-PANEL',
          group: 'print',
          description: 'Printed panel or banner',
          quantityMilli: milli(sqM),
          unit: 'sqm',
          objectIds: [object.id],
          basis: `${((art.widthMm ?? 0) / 1000).toFixed(2)} × ${((art.heightMm ?? 0) / 1000).toFixed(2)} m.`,
        });
        totalWeightKg += TYPICAL_WEIGHTS_KG.artwork ?? 8;
        break;
      }

      case 'catalog': {
        const item = object as CatalogSceneObject;
        // The venue shell is the building, not something being hired.
        if (item.venueId) break;
        const isTable = Boolean(item.tableShape);
        if (isTable) {
          tableCount += 1;
          seatCount += item.seatsDefault ?? 0;
          labourHours += rates.tablePerUnit;
        }
        totalWeightKg += isTable ? TYPICAL_WEIGHTS_KG.table ?? 28 : TYPICAL_WEIGHTS_KG.catalog ?? 20;
        push(lines, {
          code: `ITEM-${item.catalogItemId}`,
          group: 'furniture',
          description: item.name ?? 'Catalogue item',
          quantityMilli: milli(1),
          unit: 'each',
          objectIds: [object.id],
          basis: 'Counted from the plan.',
        });
        break;
      }

      default:
        break;
    }
  }

  /* ── Floor coverings ─────────────────────────────────────────────────── */

  /*
   * Carpet is the floor polygon less what stands on it. Subtracting the stands
   * and stage matters: on an exhibition floor the stands *are* most of the
   * area, and carpeting under a solid stand is money spent on nothing anyone
   * will see.
   */
  const floorAreaSqM = scene.walls.floors.reduce((sum, floor) => sum + polygonArea(floor.points) / 1_000_000, 0);
  const carpetSqM = Math.max(0, floorAreaSqM - boothFloorSqM - stageSqM);
  if (carpetSqM > 0.5) {
    push(lines, {
      code: 'FLOOR-CARPET',
      group: 'surfaces',
      description: 'Venue floor covering',
      quantityMilli: milli(carpetSqM),
      unit: 'sqm',
      objectIds: [],
      basis: `${floorAreaSqM.toFixed(1)} m² of floor, less ${(boothFloorSqM + stageSqM).toFixed(1)} m² under stands and staging.`,
    });
    labourHours += carpetSqM * rates.floorPerSqM;
  }
  if (printSqM > 0) labourHours += printSqM * rates.printPerSqM;

  /* ── Lighting and power ──────────────────────────────────────────────── */

  const load = lightingLoad(fixtures);
  powerWatts += load.totalWatts;
  labourHours += load.fixtureCount * rates.fixturePerUnit;

  for (const line of load.lines) {
    push(lines, {
      code: `LIGHT-${line.fixture}`,
      group: 'lighting',
      description: line.label,
      quantityMilli: milli(line.count),
      unit: 'each',
      objectIds: visible.filter((o) => o.type === 'light' && (o as LightFixtureSceneObject).fixture === line.fixture).map((o) => o.id),
      basis: `${line.count} × ${line.wattsEach} W = ${line.wattsTotal} W.`,
    });
  }
  if (load.dmxUniverses > 0) {
    push(lines, {
      code: 'DMX-UNIVERSE',
      group: 'lighting',
      description: 'DMX universe with control and distribution',
      quantityMilli: milli(load.dmxUniverses),
      unit: 'each',
      objectIds: [],
      basis: `${load.fixtureCount} fixtures across ${load.dmxUniverses} universe${load.dmxUniverses === 1 ? '' : 's'}.`,
    });
  }

  const powerKw = Math.round((powerWatts / 1000) * 10) / 10;
  const peakAmps = Math.round((powerWatts * 1.6) / 230);
  if (powerKw > 0) {
    push(lines, {
      code: 'POWER-DISTRO',
      group: 'power',
      description: 'Power distribution and cabling',
      quantityMilli: milli(powerKw),
      unit: 'kw',
      objectIds: [],
      basis: `${powerKw} kW average draw; allow for ${peakAmps} A at peak.`,
    });
  }

  /* ── Logistics ───────────────────────────────────────────────────────── */

  const truckLoads = Math.max(
    structureVolumeCuM > 0 || totalWeightKg > 0 ? 1 : 0,
    Math.ceil(structureVolumeCuM / TRUCK_VOLUME_CU_M),
    Math.ceil(totalWeightKg / TRUCK_PAYLOAD_KG)
  );
  if (truckLoads > 0) {
    push(lines, {
      code: 'TRANSPORT',
      group: 'logistics',
      description: 'Transport, each way',
      quantityMilli: milli(truckLoads),
      unit: 'each',
      objectIds: [],
      basis: `${structureVolumeCuM.toFixed(1)} m³ and ${Math.round(totalWeightKg)} kg against a ${TRUCK_VOLUME_CU_M} m³ / ${TRUCK_PAYLOAD_KG} kg load.`,
    });
  }

  /* ── Labour ──────────────────────────────────────────────────────────── */

  const roundedLabour = Math.round(labourHours * 10) / 10;
  if (roundedLabour > 0) {
    push(lines, {
      code: 'LABOUR-BUILD',
      group: 'labour',
      description: 'Build and de-rig crew',
      quantityMilli: milli(roundedLabour),
      unit: 'hour',
      objectIds: [],
      basis: 'Crew-hours derived per trade from the quantities above.',
    });
  }

  /* ── Notes ───────────────────────────────────────────────────────────── */

  if (floorAreaSqM === 0 && (carpetSqM > 0 || boothCount > 0)) {
    notes.push('No floor polygon is defined, so venue carpet could not be measured. Draw walls or add a venue to get it.');
  }
  if (flownWeightKg > 0) {
    const rigPoints = visible.filter(
      (o) => o.type === 'constraint' && (o as ConstraintSceneObject).constraintKind === 'rigging-point'
    ).length;
    if (rigPoints === 0) {
      notes.push(`${Math.round(flownWeightKg)} kg is flown but no rigging points are marked. Add them from the Site layer to check the load.`);
    }
  }
  if (ledSqM > 0 && fixtures.length === 0) {
    notes.push('There is LED but no lighting. Most clients expect at least a key light on anyone standing in front of a screen.');
  }

  const summary: TakeoffSummary = {
    ledSqM: round2(ledSqM),
    trussLengthM: round2(trussLengthM),
    carpetSqM: round2(carpetSqM),
    printSqM: round2(printSqM),
    structureVolumeCuM: round2(structureVolumeCuM),
    labourHours: roundedLabour,
    totalWeightKg: Math.round(totalWeightKg),
    flownWeightKg: Math.round(flownWeightKg),
    powerKw,
    peakAmps,
    fixtureCount: load.fixtureCount,
    seatCount,
    tableCount,
    boothCount,
    floorAreaSqM: round2(floorAreaSqM),
    truckLoads,
  };

  // Deterministic order: group first, then description, so two runs of the
  // same plan produce byte-identical output and a diff means a real change.
  lines.sort((a, b) => {
    const groupDelta = TAKEOFF_GROUPS.indexOf(a.group) - TAKEOFF_GROUPS.indexOf(b.group);
    return groupDelta !== 0 ? groupDelta : a.description.localeCompare(b.description);
  });

  return { lines, summary, notes };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Group take-off lines for display, preserving the canonical group order. */
export function groupTakeoff(lines: TakeoffLine[]): Array<{ group: TakeoffGroup; label: string; lines: TakeoffLine[] }> {
  return TAKEOFF_GROUPS.map((group) => ({
    group,
    label: TAKEOFF_GROUP_LABELS[group],
    lines: lines.filter((l) => l.group === group),
  })).filter((g) => g.lines.length > 0);
}
