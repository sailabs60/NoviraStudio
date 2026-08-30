/**
 * Modular stage builder.
 *
 * Models a real decked staging system rather than a parametric box: fixed 4′×4′
 * decks on legs, stairs that land on a specific bay, skirting that leaves a gap
 * where stairs are, guardrail chosen by height, and cross-bracing.
 *
 * The point of doing it properly is the **bill of materials**. A crew loading a
 * truck needs to know it is 36 decks, 144 legs and 6 rails — not "a stage
 * roughly 24 feet square". Everything here derives that list from the design.
 *
 * ── A note on safety figures ────────────────────────────────────────────────
 *
 * The thresholds below (guardrail above 30″, extra stair support above 36″,
 * bracing every third bay) follow common practice for portable decked staging.
 * They are a **design aid, not an engineering certification** — the generated
 * parts list carries that disclaimer, and any real install still needs sign-off
 * against the manufacturer's own load tables.
 */

import type { StageSceneObject, StageSide } from './scene.js';

/** One deck module: 4 feet square. */
export const DECK_SIZE_MM = 1219;
/** Deck heights are set in whole inches. */
export const HEIGHT_SNAP_MM = 25;
/** Above this, guardrail switches from a horizontal panel to vertical rail. */
export const RAIL_TYPE_THRESHOLD_MM = 762; // 30"
/** Above this, each stair needs extra support legs and pins. */
export const STAIR_EXTRA_SUPPORT_MM = 914; // 36"
/** Supported stair rise range. */
export const STAIR_MIN_MM = 305; // 12"
export const STAIR_MAX_MM = 1778; // 70"
/** Guardrail is required at or above this height. */
export const GUARDRAIL_REQUIRED_MM = 762; // 30"

export const STAGE_SIDES: StageSide[] = ['north', 'east', 'south', 'west'];

export interface BomLine {
  part: string;
  quantity: number;
  note?: string;
}

export interface StageWarning {
  level: 'required' | 'advisory';
  message: string;
}

export interface StageDerivation {
  footprintMm: { width: number; depth: number };
  deckCount: number;
  bom: BomLine[];
  warnings: StageWarning[];
  railType: 'horizontal-panel' | 'vertical-rail' | null;
  stairModel: string | null;
  stepCount: number;
}

/** Bays along one side, given the footprint. */
export function baysOnSide(stage: StageSceneObject, side: StageSide): number {
  return side === 'north' || side === 'south' ? stage.deckColumns : stage.deckRows;
}

/** Nearest supported stair unit for a given rise. */
export function stairForHeight(heightMm: number): { steps: number; label: string } | null {
  if (heightMm < STAIR_MIN_MM || heightMm > STAIR_MAX_MM) return null;
  // Units come in 3, 4, 6, 8 and 10 steps; a step is about 178 mm (7").
  const steps = Math.max(3, Math.round(heightMm / 178));
  const available = [3, 4, 6, 8, 10];
  const chosen = available.reduce((best, n) =>
    Math.abs(n - steps) < Math.abs(best - steps) ? n : best
  );
  return { steps: chosen, label: `Ultra-Stair (${chosen}-Step)` };
}

/**
 * Derive the parts list and safety notes for a stage.
 *
 * Quantities are counted the way a crew would: legs at every deck corner shared
 * between neighbours, braces at corners and every third bay, skirt panels per
 * exposed bay minus the stair gaps.
 */
export function deriveStage(stage: StageSceneObject): StageDerivation {
  const rows = Math.max(1, stage.deckRows);
  const columns = Math.max(1, stage.deckColumns);
  const deckCount = rows * columns;
  const heightMm = Math.max(0, stage.deckHeightMm);

  const footprintMm = { width: columns * DECK_SIZE_MM, depth: rows * DECK_SIZE_MM };

  const bom: BomLine[] = [];
  const warnings: StageWarning[] = [];

  bom.push({ part: `Stage Deck ${DECK_SIZE_MM} mm × ${DECK_SIZE_MM} mm`, quantity: deckCount });

  /*
   * Legs sit at deck corners and are shared between adjacent decks, so the
   * count is the grid of intersections, not four per deck.
   */
  const legCount = (rows + 1) * (columns + 1);
  bom.push({ part: 'Stage Leg', quantity: legCount, note: `${heightMm} mm` });
  bom.push({ part: 'Rubber Base Pad', quantity: legCount });
  bom.push({ part: 'Snap Pin', quantity: legCount * 2, note: 'two per leg' });

  /*
   * Bracing: every corner plus every third bay along each axis. Above the rail
   * threshold the practice is three braces per braced bay rather than two.
   */
  const bracedBaysX = Math.max(1, Math.ceil(columns / 3));
  const bracedBaysZ = Math.max(1, Math.ceil(rows / 3));
  const bracesPerBay = heightMm > RAIL_TYPE_THRESHOLD_MM ? 3 : 2;
  const braceCount = (bracedBaysX + bracedBaysZ) * 2 * bracesPerBay;
  if (heightMm > 200) {
    bom.push({
      part: 'Cross Brace',
      quantity: braceCount,
      note: `${bracesPerBay} per braced bay — corners and every third bay`,
    });
  }

  /* ── Stairs ──────────────────────────────────────────────────────────── */
  const stair = heightMm > 0 ? stairForHeight(heightMm) : null;
  const stairSides = stage.stairSides ?? [];

  if (stairSides.length) {
    if (!stair) {
      warnings.push({
        level: 'required',
        message: `Stair sides need a rise between ${STAIR_MIN_MM} mm and ${STAIR_MAX_MM} mm; this stage is ${heightMm} mm.`,
      });
    } else {
      bom.push({ part: stair.label, quantity: stairSides.length });
      if (heightMm > STAIR_EXTRA_SUPPORT_MM) {
        bom.push({
          part: 'Stair Support Leg',
          quantity: stairSides.length * 2,
          note: 'two per stair above 914 mm',
        });
        bom.push({
          part: 'Snap Pin',
          quantity: stairSides.length * 2,
          note: 'additional, for stair support legs',
        });
        warnings.push({
          level: 'required',
          message: 'Stairs above 914 mm need two additional support legs and two additional snap pins each.',
        });
      }
    }
  }

  /* ── Guardrail ───────────────────────────────────────────────────────── */
  const railSides = stage.guardrailSides ?? [];
  const railType: StageDerivation['railType'] =
    heightMm > RAIL_TYPE_THRESHOLD_MM ? 'vertical-rail' : heightMm > 0 ? 'horizontal-panel' : null;

  if (railSides.length && railType) {
    const railBays = railSides.reduce((sum, side) => sum + baysOnSide(stage, side), 0);
    bom.push({
      part: railType === 'vertical-rail' ? 'Vertical Guardrail' : 'Horizontal Guard Panel',
      quantity: railBays,
      note: railType === 'vertical-rail' ? 'auto-selected above 762 mm' : 'auto-selected at or below 762 mm',
    });
  }

  // Any exposed edge above the threshold that has no rail is worth flagging.
  if (heightMm >= GUARDRAIL_REQUIRED_MM) {
    const unrailed = STAGE_SIDES.filter(
      (side) => !railSides.includes(side) && !stairSides.includes(side)
    );
    if (unrailed.length) {
      warnings.push({
        level: 'required',
        message: `At ${heightMm} mm, guardrail is required on exposed edges. Add railing on: ${unrailed.join(', ')}.`,
      });
    }
  } else if (heightMm > 400) {
    const unrailed = STAGE_SIDES.filter((side) => !railSides.includes(side) && !stairSides.includes(side));
    if (unrailed.length) {
      warnings.push({
        level: 'advisory',
        message: `Consider adding railing on: ${unrailed.join(', ')}.`,
      });
    }
  }

  /* ── Skirting ────────────────────────────────────────────────────────── */
  const skirtSides = stage.skirtSides ?? [];
  if (skirtSides.length && heightMm > 100) {
    // A skirt runs the bays of each chosen side, less one bay wherever a stair
    // interrupts it — the opening is automatic rather than something to remove.
    const skirtBays = skirtSides.reduce((sum, side) => {
      const bays = baysOnSide(stage, side);
      const interrupted = stairSides.includes(side) ? 1 : 0;
      return sum + Math.max(0, bays - interrupted);
    }, 0);
    bom.push({
      part: 'Stage Skirt 4′ Section',
      quantity: skirtBays,
      note: 'openings left automatically where stairs are placed',
    });
  }

  // Merge duplicate part lines (snap pins appear twice by design).
  const merged = new Map<string, BomLine>();
  for (const line of bom) {
    const existing = merged.get(line.part);
    if (existing) {
      existing.quantity += line.quantity;
      if (line.note && !existing.note?.includes(line.note)) {
        existing.note = existing.note ? `${existing.note}; ${line.note}` : line.note;
      }
    } else {
      merged.set(line.part, { ...line });
    }
  }

  return {
    footprintMm,
    deckCount,
    bom: [...merged.values()],
    warnings,
    railType,
    stairModel: stair?.label ?? null,
    stepCount: stair?.steps ?? 0,
  };
}

/** A stage with sensible defaults, ready to be configured. */
export function createStage(originMm = { x: 0, y: 0, z: 0 }): StageSceneObject {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const id =
    typeof g.crypto?.randomUUID === 'function'
      ? g.crypto.randomUUID()
      : `stage-${Date.now().toString(36)}`;
  return {
    id,
    type: 'stage',
    name: 'Stage',
    positionMm: originMm,
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    deckRows: 4,
    deckColumns: 6,
    deckHeightMm: 610, // 24"
    stairSides: ['south'],
    stairBays: { south: 3 },
    skirtSides: ['north', 'east', 'south', 'west'],
    guardrailSides: ['north', 'east', 'west'],
    deckColor: '#2f3136',
    skirtColor: '#1a1a1d',
  };
}
