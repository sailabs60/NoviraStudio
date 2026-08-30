/**
 * Truss systems.
 *
 * Truss is the single most quoted line on an exhibition or production job, and
 * it is quoted by the metre of a *named* system — "18 m of F34" — not by an
 * abstract length. So the catalogue of systems is explicit, carries the numbers
 * a rigger actually checks (chord count, section size, weight per metre, safe
 * span), and is tagged by the market it is standard in, because a Kenyan
 * supplier stocks different sections from a UAE or Indian one.
 *
 * A run is a polyline in plan with a trim height, exactly like a wall: a
 * goalpost, a square mother-grid and an arch are all runs. Deriving the parts
 * list from the run is what lets the cost estimator answer "how much truss" the
 * moment something is drawn, rather than after someone measures it by hand.
 *
 * Every length is integer millimetres.
 */
import type { WallPoint } from './scene.js';

/* ── The systems ───────────────────────────────────────────────────────── */

export const TRUSS_REGIONS = ['global', 'europe', 'north-america', 'middle-east', 'africa', 'india'] as const;
export type TrussRegion = (typeof TRUSS_REGIONS)[number];

export interface TrussSystemSpec {
  key: string;
  label: string;
  /** Vendor family the section belongs to, as a rigger would name it. */
  family: string;
  /** 2 = ladder, 3 = triangular, 4 = square/box. */
  chords: 2 | 3 | 4;
  /** Section width and height, measured chord centre to chord centre. */
  widthMm: number;
  heightMm: number;
  chordDiameterMm: number;
  /** Bare weight of the section. */
  weightPerMetreKg: number;
  /** Longest sensible unsupported span for this section, at typical loading. */
  maxSpanMm: number;
  /** Uniformly distributed load the section carries over that span. */
  maxUdlKg: number;
  /** Stock section lengths held by hire companies, longest first. */
  stockLengthsMm: number[];
  /**
   * Outside diameter of the diagonal bracing tube.
   *
   * Not derived from the chord: the ratio is not constant across families.
   * F34 runs a 50 mm chord against a 20 mm brace, H30V a 48 against a 16, and
   * drawing a brace as "some fraction of the chord" is how truss ends up
   * looking like a toy rather than like the section a rigger recognises.
   */
  braceDiameterMm: number;
  /**
   * Distance between panel points — where the bracing meets the chords.
   *
   * The single most recognisable thing about a length of truss at a glance,
   * and the reason two systems of identical section read differently.
   */
  panelLengthMm: number;
  /**
   * How the web is arranged between the chords.
   *
   *  · `warren` — a continuous zig-zag of diagonals and nothing else. F-series.
   *  · `warren-vertical` — the same zig-zag with an upright at every panel
   *    point. This is what the V in Prolyte's H30V and H40V stands for.
   *  · `ladder` — rungs only, no diagonals. A two-chord decor section.
   */
  bracePattern: 'warren' | 'warren-vertical' | 'ladder';
  /** Markets where this is a shelf item rather than a special order. */
  regions: TrussRegion[];
  /** Typical duty: what people actually hang on it. */
  duty: 'decor' | 'light' | 'medium' | 'heavy';
  color: string;
  note: string;
}

/**
 * Ordered lightest to heaviest inside each family, because that is how a
 * planner picks: start at the smallest section that carries the load.
 */
export const TRUSS_SYSTEMS: TrussSystemSpec[] = [
  {
    key: 'ladder-290',
    label: 'Ladder 290',
    family: 'Ladder',
    chords: 2,
    widthMm: 290,
    heightMm: 60,
    chordDiameterMm: 48,
    weightPerMetreKg: 3.2,
    maxSpanMm: 4000,
    maxUdlKg: 60,
    stockLengthsMm: [3000, 2000, 1000, 500],
    braceDiameterMm: 38,
    panelLengthMm: 500,
    bracePattern: 'ladder',
    regions: ['global', 'europe', 'africa', 'india'],
    duty: 'decor',
    color: '#c9ccd1',
    note: 'Flat two-chord section for banners, fabric and light decor. Not a rigging truss.',
  },
  {
    key: 'f31-tri',
    label: 'F31 triangle',
    family: 'Global Truss F-series',
    chords: 3,
    widthMm: 290,
    heightMm: 250,
    chordDiameterMm: 48,
    weightPerMetreKg: 4.1,
    maxSpanMm: 6000,
    maxUdlKg: 130,
    stockLengthsMm: [3000, 2000, 1500, 1000, 500],
    braceDiameterMm: 16,
    panelLengthMm: 500,
    bracePattern: 'warren',
    regions: ['global', 'europe', 'africa', 'india', 'middle-east'],
    duty: 'light',
    color: '#cfd3d8',
    note: 'The common small triangle. Uprights, short spans, exhibition gantries.',
  },
  {
    key: 'f32-tri',
    label: 'F32 triangle',
    family: 'Global Truss F-series',
    chords: 3,
    widthMm: 290,
    heightMm: 290,
    chordDiameterMm: 50,
    weightPerMetreKg: 5.4,
    maxSpanMm: 8000,
    maxUdlKg: 200,
    stockLengthsMm: [3000, 2500, 2000, 1500, 1000, 500],
    braceDiameterMm: 16,
    panelLengthMm: 500,
    bracePattern: 'warren',
    regions: ['global', 'europe', 'north-america', 'africa', 'india', 'middle-east'],
    duty: 'light',
    color: '#cfd3d8',
    note: 'Workhorse triangle for stand gantries and modest lighting bars.',
  },
  {
    key: 'f33-tri',
    label: 'F33 triangle',
    family: 'Global Truss F-series',
    chords: 3,
    widthMm: 290,
    heightMm: 290,
    chordDiameterMm: 50,
    weightPerMetreKg: 6.3,
    maxSpanMm: 10000,
    maxUdlKg: 280,
    stockLengthsMm: [4000, 3000, 2000, 1000, 500],
    braceDiameterMm: 20,
    panelLengthMm: 500,
    bracePattern: 'warren',
    regions: ['global', 'europe', 'north-america', 'middle-east'],
    duty: 'medium',
    color: '#c8ccd2',
    note: 'Heavier triangle; spans a small stage without a mid support.',
  },
  {
    key: 'f34-square',
    label: 'F34 box',
    family: 'Global Truss F-series',
    chords: 4,
    widthMm: 290,
    heightMm: 290,
    chordDiameterMm: 50,
    weightPerMetreKg: 8.2,
    maxSpanMm: 12000,
    maxUdlKg: 450,
    stockLengthsMm: [4000, 3000, 2500, 2000, 1500, 1000, 500],
    braceDiameterMm: 20,
    panelLengthMm: 500,
    bracePattern: 'warren',
    regions: ['global', 'europe', 'north-america', 'middle-east', 'india', 'africa'],
    duty: 'medium',
    color: '#c2c7ce',
    note: 'The default box truss. Most stage goalposts and LED headers are this.',
  },
  {
    key: 'f44-square',
    label: 'F44 box',
    family: 'Global Truss F-series',
    chords: 4,
    widthMm: 400,
    heightMm: 400,
    chordDiameterMm: 50,
    weightPerMetreKg: 12.4,
    maxSpanMm: 18000,
    maxUdlKg: 900,
    stockLengthsMm: [4000, 3000, 2000, 1000],
    braceDiameterMm: 20,
    panelLengthMm: 500,
    bracePattern: 'warren',
    regions: ['global', 'europe', 'north-america', 'middle-east'],
    duty: 'heavy',
    color: '#b9bec6',
    note: 'Long-span box for main stage roofs and wide mother grids.',
  },
  {
    key: 'h30v-tri',
    label: 'Prolyte H30V',
    family: 'Prolyte H-series',
    chords: 3,
    widthMm: 290,
    heightMm: 290,
    chordDiameterMm: 48,
    weightPerMetreKg: 5.9,
    maxSpanMm: 9000,
    maxUdlKg: 240,
    stockLengthsMm: [4000, 3000, 2000, 1000, 500],
    braceDiameterMm: 16,
    panelLengthMm: 500,
    bracePattern: 'warren-vertical',
    regions: ['europe', 'middle-east', 'africa'],
    duty: 'medium',
    color: '#ccd0d6',
    note: 'European standard triangle; the section most hire stock is built on.',
  },
  {
    key: 'h40v-square',
    label: 'Prolyte H40V',
    family: 'Prolyte H-series',
    chords: 4,
    widthMm: 400,
    heightMm: 400,
    chordDiameterMm: 48,
    weightPerMetreKg: 11.6,
    maxSpanMm: 16000,
    maxUdlKg: 820,
    stockLengthsMm: [4000, 3000, 2000, 1000],
    braceDiameterMm: 20,
    panelLengthMm: 500,
    bracePattern: 'warren-vertical',
    regions: ['europe', 'middle-east'],
    duty: 'heavy',
    color: '#b9bec6',
    note: 'Long-span European box, common under roof systems.',
  },
  {
    key: 'm290-tri',
    label: 'Milos M290',
    family: 'Milos',
    chords: 3,
    widthMm: 290,
    heightMm: 290,
    chordDiameterMm: 50,
    weightPerMetreKg: 5.7,
    maxSpanMm: 9000,
    maxUdlKg: 230,
    stockLengthsMm: [3000, 2000, 1500, 1000, 500],
    braceDiameterMm: 20,
    panelLengthMm: 500,
    bracePattern: 'warren',
    regions: ['europe', 'india', 'middle-east'],
    duty: 'medium',
    color: '#cbcfd5',
    note: 'Widely stocked in India and the Gulf; interchangeable duty with H30V.',
  },
  {
    key: 'box-520',
    label: '520 heavy box',
    family: 'Heavy box',
    chords: 4,
    widthMm: 520,
    heightMm: 520,
    chordDiameterMm: 60,
    weightPerMetreKg: 21.5,
    maxSpanMm: 24000,
    maxUdlKg: 1800,
    stockLengthsMm: [4000, 3000, 2000],
    braceDiameterMm: 25,
    panelLengthMm: 600,
    bracePattern: 'warren-vertical',
    regions: ['global', 'north-america', 'middle-east'],
    duty: 'heavy',
    color: '#adb3bc',
    note: 'Arena-scale section. Specify only where the load genuinely needs it.',
  },
];

export const TRUSS_SYSTEM_MAP: Record<string, TrussSystemSpec> = Object.fromEntries(
  TRUSS_SYSTEMS.map((s) => [s.key, s])
);

export const DEFAULT_TRUSS_SYSTEM = 'f34-square';

export function trussSystem(key: string | undefined | null): TrussSystemSpec {
  return TRUSS_SYSTEM_MAP[key ?? ''] ?? TRUSS_SYSTEM_MAP[DEFAULT_TRUSS_SYSTEM]!;
}

export function trussSystemsForRegion(region: TrussRegion): TrussSystemSpec[] {
  return TRUSS_SYSTEMS.filter((s) => s.regions.includes(region) || s.regions.includes('global'));
}

/**
 * The section to start a new run on, in a given market.
 *
 * The catalogue above is ordered lightest to heaviest, which is the right
 * order to *read* it in — you pick the smallest section that carries the load.
 * It is the wrong order to default to: the lightest entry is a decorative
 * ladder section rated to 4 m, so a new 8 m goalpost built on it lands in an
 * error state before the user has touched anything.
 *
 * So the default is the market's general-purpose box truss — the one most
 * goalposts and LED headers are actually built from — falling back to the
 * heaviest available section rather than the lightest if that market stocks
 * nothing medium.
 */
export function defaultTrussSystemForRegion(region: TrussRegion): TrussSystemSpec {
  const available = trussSystemsForRegion(region);
  return (
    available.find((s) => s.key === DEFAULT_TRUSS_SYSTEM) ??
    available.find((s) => s.duty === 'medium' && s.chords === 4) ??
    available.find((s) => s.duty === 'medium') ??
    available[available.length - 1] ??
    TRUSS_SYSTEM_MAP[DEFAULT_TRUSS_SYSTEM]!
  );
}

/* ── Shapes a run can be ───────────────────────────────────────────────── */

export const TRUSS_SHAPES = [
  'straight',
  'goalpost',
  'square',
  'u-shape',
  'arch',
  'circle',
  'custom',
] as const;
export type TrussShape = (typeof TRUSS_SHAPES)[number];

export interface TrussShapeInfo {
  key: TrussShape;
  label: string;
  note: string;
  /** Whether the run returns to its first point. */
  closes: boolean;
  /** Whether the shape stands on legs by default. */
  legs: boolean;
}

export const TRUSS_SHAPE_INFO: Record<TrussShape, TrussShapeInfo> = {
  straight: {
    key: 'straight',
    label: 'Straight run',
    note: 'A single horizontal bar, hung or on two legs.',
    closes: false,
    legs: true,
  },
  goalpost: {
    key: 'goalpost',
    label: 'Goalpost',
    note: 'Two uprights and a header — the standard stage frame.',
    closes: false,
    legs: true,
  },
  square: {
    key: 'square',
    label: 'Square grid',
    note: 'A closed rectangle over the floor, flown or on four legs.',
    closes: true,
    legs: true,
  },
  'u-shape': {
    key: 'u-shape',
    label: 'U-shape',
    note: 'Three sides open to the audience.',
    closes: false,
    legs: true,
  },
  arch: {
    key: 'arch',
    label: 'Arch',
    note: 'A curved header on two legs — entrances and photo walls.',
    closes: false,
    legs: true,
  },
  circle: {
    key: 'circle',
    label: 'Circle',
    note: 'A flown ring over a dance floor or centre stage.',
    closes: true,
    legs: false,
  },
  custom: {
    key: 'custom',
    label: 'Custom path',
    note: 'Draw the run point by point.',
    closes: false,
    legs: true,
  },
};

export const TRUSS_LEG_TYPES = ['base-plate', 'tower', 'flown', 'none'] as const;
export type TrussLegType = (typeof TRUSS_LEG_TYPES)[number];

export const TRUSS_LEG_LABELS: Record<TrussLegType, string> = {
  'base-plate': 'Legs on base plates',
  tower: 'Lifting towers',
  flown: 'Flown from rigging points',
  none: 'No support shown',
};

/* ── The parts list ────────────────────────────────────────────────────── */

export interface TrussBomLine {
  code: string;
  description: string;
  quantity: number;
  unit: 'each' | 'm';
  /** Mass of this line, for the total load a venue has to carry. */
  weightKg: number;
}

export interface TrussWarning {
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface TrussDerivation {
  system: TrussSystemSpec;
  /** Total run length, following the path. */
  totalLengthMm: number;
  /** Longest single span between supports — the number that decides the section. */
  longestSpanMm: number;
  cornerCount: number;
  legCount: number;
  /** Sections cut from stock lengths, longest first. */
  sections: Array<{ lengthMm: number; count: number }>;
  totalWeightKg: number;
  /** Point load at each leg or rigging point, assuming an even distribution. */
  loadPerSupportKg: number;
  bom: TrussBomLine[];
  warnings: TrussWarning[];
}

const CORNER_BLOCK_WEIGHT_KG = 9.5;
const BASE_PLATE_WEIGHT_KG = 22;
const TOWER_WEIGHT_KG = 46;

/**
 * Pack a length out of stock sections.
 *
 * Greedy longest-first, which is exactly how a warehouse loads a truck: take
 * the longest sections that fit, then fill the remainder. The final short piece
 * is rounded *up* to the shortest stock length rather than dropped, because a
 * 300 mm gap still needs a 500 mm section to close it.
 */
export function packSections(lengthMm: number, stock: number[]): Array<{ lengthMm: number; count: number }> {
  const sorted = [...stock].sort((a, b) => b - a);
  const shortest = sorted[sorted.length - 1] ?? 500;
  const out: Array<{ lengthMm: number; count: number }> = [];
  let remaining = Math.max(0, Math.round(lengthMm));

  for (const size of sorted) {
    if (remaining < size) continue;
    const count = Math.floor(remaining / size);
    out.push({ lengthMm: size, count });
    remaining -= count * size;
  }
  if (remaining > 0) {
    const existing = out.find((s) => s.lengthMm === shortest);
    if (existing) existing.count += 1;
    else out.push({ lengthMm: shortest, count: 1 });
  }
  return out.filter((s) => s.count > 0);
}

export function pathLength(points: WallPoint[], closed: boolean): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += Math.hypot(points[i + 1]!.xMm - points[i]!.xMm, points[i + 1]!.zMm - points[i]!.zMm);
  }
  if (closed && points.length > 2) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    total += Math.hypot(first.xMm - last.xMm, first.zMm - last.zMm);
  }
  return Math.round(total);
}

export interface TrussRunLike {
  systemKey: string;
  points: WallPoint[];
  closed: boolean;
  trimHeightMm: number;
  legType: TrussLegType;
  /** Extra mass hung from this run — fixtures, screens, banners. */
  hangingLoadKg?: number;
}

/**
 * Derive everything the run implies.
 *
 * The two numbers that matter are the longest span and the load per support:
 * the first decides whether the section is legal, the second is what the venue
 * or a base plate has to carry. Both are reported even when they are fine, so a
 * planner can show a rigger the figure rather than an assurance.
 */
export function deriveTruss(run: TrussRunLike): TrussDerivation {
  const system = trussSystem(run.systemKey);
  const points = run.points ?? [];
  const totalLengthMm = pathLength(points, run.closed);

  // Spans between direction changes — a corner is a support point in practice
  // only when a leg lands there, but it is always where the section changes.
  const spans: number[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    spans.push(Math.hypot(points[i + 1]!.xMm - points[i]!.xMm, points[i + 1]!.zMm - points[i]!.zMm));
  }
  if (run.closed && points.length > 2) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    spans.push(Math.hypot(first.xMm - last.xMm, first.zMm - last.zMm));
  }
  const longestSpanMm = Math.round(spans.length ? Math.max(...spans) : 0);

  const cornerCount = run.closed ? Math.max(0, points.length) : Math.max(0, points.length - 2);

  // Legs land at the ends of an open run, and at every corner of a closed one.
  const legCount =
    run.legType === 'none' || run.legType === 'flown'
      ? 0
      : run.closed
        ? Math.max(0, points.length)
        : points.length >= 2
          ? 2
          : 0;

  const sections = packSections(totalLengthMm, system.stockLengthsMm);

  const trussWeight = (totalLengthMm / 1000) * system.weightPerMetreKg;
  const cornerWeight = cornerCount * CORNER_BLOCK_WEIGHT_KG;
  const legRunMm = legCount * Math.max(0, run.trimHeightMm - system.heightMm);
  const legWeight = (legRunMm / 1000) * system.weightPerMetreKg;
  const supportWeight =
    run.legType === 'tower'
      ? legCount * TOWER_WEIGHT_KG
      : run.legType === 'base-plate'
        ? legCount * BASE_PLATE_WEIGHT_KG
        : 0;

  const hanging = Math.max(0, run.hangingLoadKg ?? 0);
  const totalWeightKg =
    Math.round((trussWeight + cornerWeight + legWeight + supportWeight + hanging) * 10) / 10;

  const supports =
    run.legType === 'flown'
      ? Math.max(2, Math.ceil(totalLengthMm / Math.max(1, system.maxSpanMm)) + 1)
      : Math.max(legCount, 2);
  const loadPerSupportKg = Math.round((totalWeightKg / supports) * 10) / 10;

  const bom: TrussBomLine[] = [];
  for (const section of sections) {
    bom.push({
      code: `${system.key.toUpperCase()}-${section.lengthMm}`,
      description: `${system.label} straight section, ${(section.lengthMm / 1000).toFixed(2)} m`,
      quantity: section.count,
      unit: 'each',
      weightKg: Math.round((section.lengthMm / 1000) * system.weightPerMetreKg * section.count * 10) / 10,
    });
  }
  if (cornerCount > 0) {
    bom.push({
      code: `${system.key.toUpperCase()}-CORNER`,
      description: `${system.label} corner block`,
      quantity: cornerCount,
      unit: 'each',
      weightKg: Math.round(cornerCount * CORNER_BLOCK_WEIGHT_KG * 10) / 10,
    });
  }
  if (legCount > 0) {
    bom.push({
      code: `${system.key.toUpperCase()}-LEG`,
      description: `${system.label} upright to ${(run.trimHeightMm / 1000).toFixed(2)} m trim`,
      quantity: legCount,
      unit: 'each',
      weightKg: Math.round(legWeight * 10) / 10,
    });
    bom.push({
      code: run.legType === 'tower' ? 'TOWER' : 'BASEPLATE',
      description: run.legType === 'tower' ? 'Lifting tower with outriggers' : 'Base plate with spigots',
      quantity: legCount,
      unit: 'each',
      weightKg: Math.round(supportWeight * 10) / 10,
    });
  }
  if (run.legType === 'flown') {
    bom.push({
      code: 'RIG-POINT',
      description: 'Rigging point: shackle, steel and hoist connection',
      quantity: supports,
      unit: 'each',
      weightKg: 0,
    });
  }

  const warnings: TrussWarning[] = [];
  if (longestSpanMm > system.maxSpanMm) {
    warnings.push({
      severity: 'error',
      message: `A ${(longestSpanMm / 1000).toFixed(1)} m span exceeds the ${(system.maxSpanMm / 1000).toFixed(1)} m limit for ${system.label}. Add a support or step up a section.`,
    });
  } else if (longestSpanMm > system.maxSpanMm * 0.85) {
    warnings.push({
      severity: 'warning',
      message: `The longest span is ${(longestSpanMm / 1000).toFixed(1)} m, close to the ${(system.maxSpanMm / 1000).toFixed(1)} m limit for ${system.label}. Check the load with your rigger.`,
    });
  }
  if (hanging > system.maxUdlKg) {
    warnings.push({
      severity: 'error',
      message: `${hanging} kg hung from ${system.label} is over its ${system.maxUdlKg} kg distributed limit.`,
    });
  }
  if (system.chords === 2 && hanging > 0) {
    warnings.push({
      severity: 'warning',
      message: 'Ladder truss is a decor section. Do not hang fixtures or people from it.',
    });
  }
  if (run.legType === 'base-plate' && run.trimHeightMm > 5000) {
    warnings.push({
      severity: 'warning',
      message: `A ${(run.trimHeightMm / 1000).toFixed(1)} m trim on base plates needs ballast or bracing to be stable.`,
    });
  }

  return {
    system,
    totalLengthMm,
    longestSpanMm,
    cornerCount,
    legCount,
    sections,
    totalWeightKg,
    loadPerSupportKg,
    bom,
    warnings,
  };
}

/* ── Shape generators ──────────────────────────────────────────────────── */

/**
 * Points for a named shape, centred on the origin so the object's own
 * position places it. Returned in the same plan-space millimetres walls use.
 */
export function trussShapePoints(shape: TrussShape, widthMm: number, depthMm: number): WallPoint[] {
  const halfW = Math.round(widthMm / 2);
  const halfD = Math.round(depthMm / 2);
  switch (shape) {
    case 'straight':
    case 'goalpost':
      // The header only; a goalpost's uprights are derived from the trim height.
      return [
        { xMm: -halfW, zMm: 0 },
        { xMm: halfW, zMm: 0 },
      ];
    case 'square':
      return [
        { xMm: -halfW, zMm: -halfD },
        { xMm: halfW, zMm: -halfD },
        { xMm: halfW, zMm: halfD },
        { xMm: -halfW, zMm: halfD },
      ];
    case 'u-shape':
      return [
        { xMm: -halfW, zMm: halfD },
        { xMm: -halfW, zMm: -halfD },
        { xMm: halfW, zMm: -halfD },
        { xMm: halfW, zMm: halfD },
      ];
    case 'arch': {
      const steps = 12;
      const rise = Math.round(Math.min(halfW, depthMm) * 0.55);
      return Array.from({ length: steps + 1 }, (_, i) => {
        const t = i / steps;
        return {
          xMm: Math.round(-halfW + widthMm * t),
          zMm: -Math.round(Math.sin(Math.PI * t) * rise),
        };
      });
    }
    case 'circle': {
      const steps = 24;
      const radius = Math.round(Math.min(halfW, halfD));
      return Array.from({ length: steps }, (_, i) => {
        const angle = (i / steps) * Math.PI * 2;
        return { xMm: Math.round(Math.cos(angle) * radius), zMm: Math.round(Math.sin(angle) * radius) };
      });
    }
    default:
      return [
        { xMm: -halfW, zMm: 0 },
        { xMm: halfW, zMm: 0 },
      ];
  }
}
