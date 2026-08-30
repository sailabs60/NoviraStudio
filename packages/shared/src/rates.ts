/**
 * Rate cards — the agency's own cost database.
 *
 * The take-off says *what* is in the design. This says *what it costs*, and the
 * two are deliberately separate: the same drawing, priced against a Nairobi
 * rate card and a Dubai one, must produce two different quotes without either
 * of them touching the measurement.
 *
 * A rate card is a list of rates keyed by take-off code, plus a fallback rate
 * per unit for anything the card does not name. The fallback matters more than
 * it sounds: an agency that has priced only truss and LED should still get a
 * complete quote on day one, with the unpriced lines visible as gaps rather
 * than silently missing.
 *
 * Money follows the same rules as `quoting.ts`: integer minor units, rounded
 * once per line, never a float.
 */
import { lineAmount, type QuoteLine } from './quoting.js';
import { TAKEOFF_GROUP_LABELS, type TakeoffGroup, type TakeoffLine, type TakeoffUnit } from './takeoff.js';

/* ── The card ──────────────────────────────────────────────────────────── */

export interface RateLine {
  /** Take-off code this rate prices, or a unit fallback like `*:sqm`. */
  code: string;
  description: string;
  unit: TakeoffUnit;
  /** Sell price per unit, in minor units. */
  unitPrice: number;
  /** What it costs the agency, for margin reporting. Optional. */
  unitCost?: number | null;
  /** Whether tax applies to this line. */
  taxable: boolean;
  group: TakeoffGroup;
  /** Minimum charge for this line, in minor units. A 2 m truss run still
   *  costs a call-out. */
  minimumCharge?: number | null;
  /** Waste and over-order allowance, in basis points. Print is cut oversize. */
  wastageBp?: number;
}

export interface RateCard {
  id: number | null;
  name: string;
  currency: string;
  /** Region this card was written for, matching `region.ts`. */
  regionCode: string;
  /** Applied to every line — a blanket uplift or a negotiated discount. */
  adjustmentBp: number;
  lines: RateLine[];
  /** Build-hour overrides handed to the take-off. */
  labourOverrides?: Record<string, number>;
  /** Hourly crew rate, in minor units. */
  crewRate: number;
  updatedAt?: string;
}

/* ── The built-in card ─────────────────────────────────────────────────── */

/**
 * Defaults in US cents, chosen as mid-market hire rates for a two-to-three day
 * event. They exist so a new account gets a working estimate immediately, and
 * every one of them is meant to be overridden — which is why each line says
 * what it assumes rather than presenting itself as a fact.
 */
export const DEFAULT_RATE_LINES: RateLine[] = [
  // ── Structure
  { code: 'TRUSS-*', description: 'Truss, supplied and rigged', unit: 'm', unitPrice: 3800, unitCost: 1400, taxable: true, group: 'structure', minimumCharge: 40000 },
  { code: 'TRUSS-SUPPORT-base-plate', description: 'Base plate and upright', unit: 'each', unitPrice: 6500, unitCost: 2000, taxable: true, group: 'structure' },
  { code: 'TRUSS-SUPPORT-tower', description: 'Lifting tower', unit: 'each', unitPrice: 22000, unitCost: 8000, taxable: true, group: 'structure' },
  { code: 'STAGE-*', description: 'Staging component', unit: 'each', unitPrice: 4200, unitCost: 1500, taxable: true, group: 'structure' },
  { code: 'BOOTH-WALL-*', description: 'Stand wall system', unit: 'sqm', unitPrice: 8500, unitCost: 3400, taxable: true, group: 'structure', wastageBp: 500 },
  { code: 'TENT-FRAME', description: 'Framed structure, covered', unit: 'sqm', unitPrice: 3200, unitCost: 1200, taxable: true, group: 'structure' },
  { code: 'TENT-WALL', description: 'Sidewall bay', unit: 'each', unitPrice: 4500, unitCost: 1600, taxable: true, group: 'structure' },
  { code: 'LED-FRAME-*', description: 'Screen support hardware', unit: 'm', unitPrice: 9000, unitCost: 3200, taxable: true, group: 'structure' },

  // ── Surfaces
  { code: 'FLOOR-CARPET', description: 'Venue carpet, laid and lifted', unit: 'sqm', unitPrice: 1100, unitCost: 420, taxable: true, group: 'surfaces', wastageBp: 1000 },
  { code: 'FLOOR-raised-platform', description: 'Raised platform floor', unit: 'sqm', unitPrice: 5200, unitCost: 2100, taxable: true, group: 'surfaces' },
  { code: 'FLOOR-timber-deck', description: 'Timber deck', unit: 'sqm', unitPrice: 4800, unitCost: 1900, taxable: true, group: 'surfaces' },
  { code: 'FLOOR-vinyl', description: 'Vinyl floor', unit: 'sqm', unitPrice: 2400, unitCost: 950, taxable: true, group: 'surfaces', wastageBp: 800 },
  { code: 'FLOOR-carpet', description: 'Stand carpet', unit: 'sqm', unitPrice: 1400, unitCost: 500, taxable: true, group: 'surfaces', wastageBp: 1000 },
  { code: 'DRAPE', description: 'Pleated drape, hung', unit: 'm', unitPrice: 2800, unitCost: 900, taxable: true, group: 'surfaces' },

  // ── Print
  { code: 'PRINT-STAND', description: 'Printed stand graphics', unit: 'sqm', unitPrice: 4200, unitCost: 1600, taxable: true, group: 'print', wastageBp: 1200 },
  { code: 'PRINT-PANEL', description: 'Printed panel or banner', unit: 'sqm', unitPrice: 3600, unitCost: 1300, taxable: true, group: 'print', wastageBp: 1200 },
  { code: 'LETTERING-3D', description: 'Dimensional lettering, fabricated', unit: 'sqm', unitPrice: 38000, unitCost: 15000, taxable: true, group: 'print' },

  // ── Screens
  { code: 'LED-*', description: 'LED wall, supplied and operated', unit: 'sqm', unitPrice: 26000, unitCost: 9500, taxable: true, group: 'screens', minimumCharge: 150000 },
  { code: 'LED-PROCESSING', description: 'LED processing and signal', unit: 'each', unitPrice: 65000, unitCost: 22000, taxable: true, group: 'screens' },

  // ── Lighting
  { code: 'LIGHT-moving-head-spot', description: 'Moving head spot', unit: 'each', unitPrice: 9500, unitCost: 3200, taxable: true, group: 'lighting' },
  { code: 'LIGHT-moving-head-wash', description: 'Moving head wash', unit: 'each', unitPrice: 9000, unitCost: 3000, taxable: true, group: 'lighting' },
  { code: 'LIGHT-beam', description: 'Beam fixture', unit: 'each', unitPrice: 8500, unitCost: 2800, taxable: true, group: 'lighting' },
  { code: 'LIGHT-profile-spot', description: 'Profile spot', unit: 'each', unitPrice: 5500, unitCost: 1800, taxable: true, group: 'lighting' },
  { code: 'LIGHT-uplighter', description: 'Battery uplighter', unit: 'each', unitPrice: 1800, unitCost: 500, taxable: true, group: 'lighting' },
  { code: 'LIGHT-*', description: 'Lighting fixture', unit: 'each', unitPrice: 4200, unitCost: 1400, taxable: true, group: 'lighting' },
  { code: 'DMX-UNIVERSE', description: 'Lighting control and distribution', unit: 'each', unitPrice: 45000, unitCost: 15000, taxable: true, group: 'lighting' },

  // ── Power
  { code: 'POWER-DISTRO', description: 'Power distribution and cabling', unit: 'kw', unitPrice: 3500, unitCost: 1200, taxable: true, group: 'power' },

  // ── Furniture
  { code: 'ITEM-*', description: 'Furniture and fittings, hired', unit: 'each', unitPrice: 1800, unitCost: 600, taxable: true, group: 'furniture' },

  // ── Logistics and labour
  { code: 'TRANSPORT', description: 'Transport, each way', unit: 'each', unitPrice: 48000, unitCost: 22000, taxable: true, group: 'logistics' },
  { code: 'LABOUR-BUILD', description: 'Build and de-rig crew', unit: 'hour', unitPrice: 4500, unitCost: 2600, taxable: true, group: 'labour' },
];

/** Unit-level fallbacks, used when no code matches at all. */
export const DEFAULT_UNIT_FALLBACK: Record<TakeoffUnit, number> = {
  sqm: 3000,
  m: 2500,
  each: 2500,
  cum: 4000,
  kg: 40,
  hour: 4500,
  kw: 3500,
};

export function defaultRateCard(currency = 'usd', regionCode = 'global'): RateCard {
  return {
    id: null,
    name: 'Novira default rates',
    currency,
    regionCode,
    adjustmentBp: 0,
    lines: DEFAULT_RATE_LINES.map((l) => ({ ...l })),
    crewRate: 4500,
  };
}

/* ── Matching ──────────────────────────────────────────────────────────── */

/**
 * Find the rate for a take-off code.
 *
 * Exact match first, then a `PREFIX-*` wildcard, longest prefix winning, so
 * `LED-p3-9-indoor` prefers a specific `LED-p3-9-indoor` rate over the general
 * `LED-*`. Longest-first is what makes a card refinable: an agency can start
 * with `LIGHT-*` and add `LIGHT-beam` later without the general rate suddenly
 * taking precedence.
 */
export function matchRate(card: RateCard, code: string): RateLine | null {
  const exact = card.lines.find((l) => l.code === code);
  if (exact) return exact;

  const wildcards = card.lines
    .filter((l) => l.code.endsWith('*') && code.startsWith(l.code.slice(0, -1)))
    .sort((a, b) => b.code.length - a.code.length);
  return wildcards[0] ?? null;
}

/* ── Pricing ───────────────────────────────────────────────────────────── */

export interface PricedLine {
  code: string;
  group: TakeoffGroup;
  groupLabel: string;
  description: string;
  quantityMilli: number;
  unit: TakeoffUnit;
  unitPrice: number;
  /** Line total, in minor units, after wastage and the minimum charge. */
  amount: number;
  /** Cost, where the card carries one. */
  cost: number | null;
  taxable: boolean;
  objectIds: string[];
  basis: string;
  /** True when no rate matched and a unit fallback was used. */
  estimated: boolean;
  /** Wastage uplift actually applied, in basis points. */
  wastageBp: number;
}

export interface PricedTakeoff {
  currency: string;
  cardName: string;
  lines: PricedLine[];
  /** Sum of line amounts. Rounding is per line, as in `quoting.ts`. */
  subtotal: number;
  /** Sum of costs where known. */
  cost: number;
  /** Margin as basis points of the subtotal, where cost is known throughout. */
  marginBp: number | null;
  /** Codes with no rate, so the gaps are visible rather than silent. */
  unpriced: string[];
  byGroup: Array<{ group: TakeoffGroup; label: string; amount: number; cost: number }>;
}

/**
 * Price a measured take-off.
 *
 * Wastage is applied to the quantity, not to the price, because that is what it
 * physically is: you buy 10 % more vinyl than you lay. Doing it as a price
 * uplift would produce a quote whose quantity disagrees with the drawing, which
 * is exactly the kind of discrepancy a client's procurement team looks for.
 */
export function priceTakeoff(lines: TakeoffLine[], card: RateCard): PricedTakeoff {
  const priced: PricedLine[] = [];
  const unpriced: string[] = [];
  const adjustment = 10_000 + clampBp(card.adjustmentBp, -5000, 20_000);

  for (const line of lines) {
    const rate = matchRate(card, line.code);
    const estimated = !rate;
    if (!rate) unpriced.push(line.code);

    const wastageBp = rate?.wastageBp ?? 0;
    const quantityMilli = Math.round(line.quantityMilli * (1 + wastageBp / 10_000));

    const baseUnitPrice = rate ? rate.unitPrice : DEFAULT_UNIT_FALLBACK[line.unit];
    const unitPrice = Math.round((baseUnitPrice * adjustment) / 10_000);

    let amount = lineAmount({ quantityMilli, unitPrice });
    const minimum = rate?.minimumCharge ?? 0;
    if (minimum > 0 && amount > 0 && amount < minimum) amount = minimum;

    const cost =
      rate?.unitCost != null ? lineAmount({ quantityMilli, unitPrice: rate.unitCost }) : null;

    priced.push({
      code: line.code,
      group: line.group,
      groupLabel: TAKEOFF_GROUP_LABELS[line.group],
      description: rate?.description ?? line.description,
      quantityMilli,
      unit: line.unit,
      unitPrice,
      amount,
      cost,
      taxable: rate?.taxable ?? true,
      objectIds: line.objectIds,
      basis: line.basis,
      estimated,
      wastageBp,
    });
  }

  const subtotal = priced.reduce((sum, l) => sum + l.amount, 0);
  const cost = priced.reduce((sum, l) => sum + (l.cost ?? 0), 0);
  const allCosted = priced.every((l) => l.cost !== null);
  const marginBp = allCosted && subtotal > 0 ? Math.round(((subtotal - cost) / subtotal) * 10_000) : null;

  const groups = new Map<TakeoffGroup, { amount: number; cost: number }>();
  for (const line of priced) {
    const entry = groups.get(line.group) ?? { amount: 0, cost: 0 };
    entry.amount += line.amount;
    entry.cost += line.cost ?? 0;
    groups.set(line.group, entry);
  }

  return {
    currency: card.currency,
    cardName: card.name,
    lines: priced,
    subtotal,
    cost,
    marginBp,
    unpriced: [...new Set(unpriced)],
    byGroup: [...groups.entries()].map(([group, v]) => ({
      group,
      label: TAKEOFF_GROUP_LABELS[group],
      amount: v.amount,
      cost: v.cost,
    })),
  };
}

function clampBp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Turn priced lines into proposal lines.
 *
 * The proposal is the client-facing document and `quoting.ts` owns its
 * arithmetic, so the estimator hands over quantities and unit prices and lets
 * that module do the rounding, discounting and tax. Nothing about costs or
 * margin crosses this boundary — the client never sees them.
 */
export function toQuoteLines(priced: PricedTakeoff): QuoteLine[] {
  return priced.lines
    .filter((l) => l.quantityMilli > 0)
    .map((l) => ({
      kind: l.group === 'labour' ? ('labour' as const) : ('item' as const),
      description: l.description,
      quantityMilli: l.quantityMilli,
      unitPrice: l.unitPrice,
      taxable: l.taxable,
    }));
}
