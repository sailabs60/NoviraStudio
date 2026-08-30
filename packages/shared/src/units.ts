/**
 * Units.
 *
 * Novira stores every linear dimension as an **integer number of millimetres**.
 * Floats drift under repeated snapping and make equality comparisons unsafe;
 * integers do neither. Imperial vs metric is a presentation concern only — it
 * never reaches the database.
 *
 * World-space values handed to three.js are metres (the renderer's convention),
 * so `mmToWorld` / `worldToMm` are the only bridge between storage and scene.
 */

export type UnitSystem = 'metric' | 'imperial';

export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;
export const MM_PER_METRE = 1000;

/** Storage (mm) → three.js world units (metres). */
export const mmToWorld = (mm: number): number => mm / MM_PER_METRE;

/** three.js world units (metres) → storage (mm), rounded to a whole millimetre. */
export const worldToMm = (world: number): number => Math.round(world * MM_PER_METRE);

export const mmToInches = (mm: number): number => mm / MM_PER_INCH;
export const inchesToMm = (inches: number): number => Math.round(inches * MM_PER_INCH);
export const mmToFeet = (mm: number): number => mm / MM_PER_FOOT;
export const feetToMm = (feet: number): number => Math.round(feet * MM_PER_FOOT);

/** Split a millimetre value into whole feet plus remaining inches. */
export function mmToFeetInches(mm: number): { feet: number; inches: number } {
  const totalInches = mm / MM_PER_INCH;
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches - feet * 12;
  return { feet, inches };
}

export function feetInchesToMm(feet: number, inches: number): number {
  return Math.round(feet * MM_PER_FOOT + inches * MM_PER_INCH);
}

export interface FormatOptions {
  /** Decimal places for the metric form. Default 2 (centimetre precision). */
  precision?: number;
  /** Omit the unit suffix. */
  bare?: boolean;
}

/**
 * Render a millimetre value for display.
 *
 * Imperial uses the feet-and-inches form the event trade actually speaks
 * (`24' 6"`), falling back to bare inches under one foot (`10.5"`).
 */
export function formatLength(mm: number, system: UnitSystem, opts: FormatOptions = {}): string {
  const { precision = 2, bare = false } = opts;
  if (!Number.isFinite(mm)) return bare ? '0' : system === 'metric' ? '0 m' : '0"';

  if (system === 'imperial') {
    const negative = mm < 0;
    const sign = negative ? '-' : '';

    /*
     * Round to the nearest quarter inch — the increment the rental trade
     * actually works in. Without this, a table built at exactly six feet
     * displays as 6' 0.01" because 1829 mm is a rounded storage value, and
     * that noise makes correct dimensions look wrong.
     */
    const totalQuarters = Math.round((Math.abs(mm) / MM_PER_INCH) * 4);
    let feet = Math.floor(totalQuarters / 48);
    const remainderQuarters = totalQuarters - feet * 48;
    let inches = remainderQuarters / 4;

    if (inches >= 12) {
      feet += 1;
      inches -= 12;
    }

    const inchText = Number.isInteger(inches)
      ? String(inches)
      : String(inches).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

    if (feet === 0) return `${sign}${inchText}"`;
    if (inches === 0) return `${sign}${feet}'`;
    return `${sign}${feet}' ${inchText}"`;
  }

  const metres = mm / MM_PER_METRE;
  const text = metres.toFixed(precision).replace(/\.?0+$/, '') || '0';
  return bare ? text : `${text} m`;
}

/** Parse a user-entered length in the given system back to millimetres. */
export function parseLength(input: string, system: UnitSystem): number | null {
  const raw = input.trim();
  if (!raw) return null;

  if (system === 'imperial') {
    // 24' 6"  |  24'  |  6"  |  24 6  |  18.5
    const feetInches = raw.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch(?:es)?)?)?$/i);
    if (feetInches) {
      const f = Number(feetInches[1]);
      const i = feetInches[2] ? Number(feetInches[2]) : 0;
      const sign = f < 0 ? -1 : 1;
      return sign * feetInchesToMm(Math.abs(f), i);
    }
    const inchesOnly = raw.match(/^(-?\d+(?:\.\d+)?)\s*(?:"|in|inch(?:es)?)$/i);
    if (inchesOnly) return inchesToMm(Number(inchesOnly[1]));
    const bare = Number(raw);
    return Number.isFinite(bare) ? inchesToMm(bare) : null;
  }

  const metric = raw.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m)?$/i);
  if (!metric) return null;
  const value = Number(metric[1]);
  if (!Number.isFinite(value)) return null;
  const unit = (metric[2] || 'm').toLowerCase();
  if (unit === 'mm') return Math.round(value);
  if (unit === 'cm') return Math.round(value * 10);
  return Math.round(value * MM_PER_METRE);
}

/** Unit label used beside numeric inputs. */
export const lengthUnitLabel = (system: UnitSystem): string => (system === 'metric' ? 'm' : 'in');

/** Area, for floor polygons. */
export function formatArea(mm2: number, system: UnitSystem): string {
  if (system === 'imperial') {
    const sqft = mm2 / (MM_PER_FOOT * MM_PER_FOOT);
    return `${sqft.toFixed(1)} sq ft`;
  }
  const m2 = mm2 / (MM_PER_METRE * MM_PER_METRE);
  return `${m2.toFixed(2)} m²`;
}

/** Default grid spacing, in mm. 500 mm metric, 12" imperial. */
export const defaultGridSizeMm = (system: UnitSystem): number => (system === 'metric' ? 500 : 305);
