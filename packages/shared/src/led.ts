/**
 * LED systems.
 *
 * An LED wall is not a picture on a plane — it is a count of cabinets on a
 * frame, and that count is what everything downstream needs. Square metres
 * drive the hire cost, the cabinet count drives the truck and the crew, the
 * pixel pitch decides how close an audience can stand before the image falls
 * apart, and the power draw decides whether the venue's supply is enough.
 *
 * So a screen here is defined the way it is ordered: a named panel type, a
 * number of columns and rows. Width, height, resolution, weight and power are
 * all derived from that, which means they cannot disagree with each other.
 */

/* ── Panel types ───────────────────────────────────────────────────────── */

export type LedUse = 'indoor' | 'outdoor' | 'both';

export interface LedPanelSpec {
  key: string;
  label: string;
  /** Distance between LED centres, in millimetres. The headline number. */
  pitchMm: number;
  /** Cabinet face size. Nearly everything modern is 500 × 500 or 500 × 1000. */
  widthMm: number;
  heightMm: number;
  /** Cabinet depth, which decides whether it fits in front of a wall. */
  depthMm: number;
  /** Pixels across and down one cabinet — derived from pitch, stated for clarity. */
  pixelsWide: number;
  pixelsHigh: number;
  weightKg: number;
  /** Average draw in normal content. Peak is roughly three times this. */
  powerAvgW: number;
  powerPeakW: number;
  brightnessNits: number;
  use: LedUse;
  /** Whether the cabinet can hang from a header as well as stack on the floor. */
  flyable: boolean;
  note: string;
}

/**
 * The pitches that actually get hired, from close-up conference screens out to
 * outdoor stage walls. Cabinet sizes are the standard 500 mm module family, so
 * a wall built from any of them lands on the same grid.
 */
export const LED_PANELS: LedPanelSpec[] = [
  {
    key: 'p1-9-indoor',
    label: 'P1.9 fine pitch',
    pitchMm: 1.9,
    widthMm: 500,
    heightMm: 500,
    depthMm: 80,
    pixelsWide: 256,
    pixelsHigh: 256,
    weightKg: 7.5,
    powerAvgW: 90,
    powerPeakW: 280,
    brightnessNits: 800,
    use: 'indoor',
    flyable: true,
    note: 'Boardroom and broadcast pitch. Readable from about 2 m.',
  },
  {
    key: 'p2-6-indoor',
    label: 'P2.6 indoor',
    pitchMm: 2.6,
    widthMm: 500,
    heightMm: 500,
    depthMm: 80,
    pixelsWide: 192,
    pixelsHigh: 192,
    weightKg: 7.2,
    powerAvgW: 105,
    powerPeakW: 320,
    brightnessNits: 1200,
    use: 'indoor',
    flyable: true,
    note: 'The default conference and summit wall. Good from about 3 m.',
  },
  {
    key: 'p3-9-indoor',
    label: 'P3.9 indoor',
    pitchMm: 3.9,
    widthMm: 500,
    heightMm: 500,
    depthMm: 80,
    pixelsWide: 128,
    pixelsHigh: 128,
    weightKg: 6.8,
    powerAvgW: 115,
    powerPeakW: 340,
    brightnessNits: 1500,
    use: 'both',
    flyable: true,
    note: 'The rental workhorse. Indoor stages and covered outdoor.',
  },
  {
    key: 'p4-8-indoor',
    label: 'P4.8 indoor/outdoor',
    pitchMm: 4.8,
    widthMm: 500,
    heightMm: 500,
    depthMm: 85,
    pixelsWide: 104,
    pixelsHigh: 104,
    weightKg: 7.0,
    powerAvgW: 130,
    powerPeakW: 390,
    brightnessNits: 3500,
    use: 'both',
    flyable: true,
    note: 'Bright enough for daylight under cover. Viewing from about 5 m.',
  },
  {
    key: 'p6-9-outdoor',
    label: 'P6.9 outdoor',
    pitchMm: 6.9,
    widthMm: 500,
    heightMm: 1000,
    depthMm: 110,
    pixelsWide: 72,
    pixelsHigh: 144,
    weightKg: 16.5,
    powerAvgW: 250,
    powerPeakW: 750,
    brightnessNits: 5500,
    use: 'outdoor',
    flyable: true,
    note: 'Open-air stage wall. Viewing from about 7 m.',
  },
  {
    key: 'p10-outdoor',
    label: 'P10 outdoor',
    pitchMm: 10,
    widthMm: 960,
    heightMm: 960,
    depthMm: 120,
    pixelsWide: 96,
    pixelsHigh: 96,
    weightKg: 32,
    powerAvgW: 400,
    powerPeakW: 1200,
    brightnessNits: 6500,
    use: 'outdoor',
    flyable: false,
    note: 'Large-format daylight wall. Ground-stacked; viewing from about 10 m.',
  },
  {
    key: 'transparent-p10',
    label: 'Transparent P10',
    pitchMm: 10,
    widthMm: 1000,
    heightMm: 500,
    depthMm: 60,
    pixelsWide: 100,
    pixelsHigh: 50,
    weightKg: 8.5,
    powerAvgW: 80,
    powerPeakW: 240,
    brightnessNits: 4000,
    use: 'indoor',
    flyable: true,
    note: 'See-through mesh for glass frontage and scenic reveals.',
  },
  {
    key: 'floor-p6-25',
    label: 'Floor P6.25',
    pitchMm: 6.25,
    widthMm: 500,
    heightMm: 500,
    depthMm: 100,
    pixelsWide: 80,
    pixelsHigh: 80,
    weightKg: 14,
    powerAvgW: 140,
    powerPeakW: 420,
    brightnessNits: 4500,
    use: 'indoor',
    flyable: false,
    note: 'Walkable cabinet for LED dance floors and runways.',
  },
];

export const LED_PANEL_MAP: Record<string, LedPanelSpec> = Object.fromEntries(
  LED_PANELS.map((p) => [p.key, p])
);

export const DEFAULT_LED_PANEL = 'p3-9-indoor';

export function ledPanel(key: string | undefined | null): LedPanelSpec {
  return LED_PANEL_MAP[key ?? ''] ?? LED_PANEL_MAP[DEFAULT_LED_PANEL]!;
}

/* ── How a screen is supported ─────────────────────────────────────────── */

export const LED_FRAMES = ['ground-support', 'flown', 'wall-mount', 'floor'] as const;
export type LedFrame = (typeof LED_FRAMES)[number];

export const LED_FRAME_LABELS: Record<LedFrame, string> = {
  'ground-support': 'Ground support frame',
  flown: 'Flown from truss',
  'wall-mount': 'Wall mounted',
  floor: 'Laid on the floor',
};

/* ── Derivation ────────────────────────────────────────────────────────── */

export interface LedScreenLike {
  panelKey: string;
  columns: number;
  rows: number;
  /** Height from the floor to the bottom of the image. */
  bottomMm: number;
  frame: LedFrame;
  /** Horizontal curve across the whole wall; 0 is flat. */
  curveDeg?: number;
}

export interface LedWarning {
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface LedDerivation {
  panel: LedPanelSpec;
  cabinetCount: number;
  widthMm: number;
  heightMm: number;
  areaSqM: number;
  pixelsWide: number;
  pixelsHigh: number;
  totalPixels: number;
  aspect: string;
  weightKg: number;
  powerAvgW: number;
  powerPeakW: number;
  /** Peak draw expressed as 230 V single-phase amps, which is how it is booked. */
  peakAmps230: number;
  /** Closest an audience should stand before pixels become visible. */
  minViewingDistanceMm: number;
  /** Where the image sits vertically. */
  topMm: number;
  /** Processing and cabling the wall needs, derived from pixel count. */
  processors: number;
  dataRuns: number;
  warnings: LedWarning[];
}

/**
 * A rule the industry actually uses: the comfortable minimum viewing distance
 * in metres is roughly the pitch in millimetres. It is approximate, and it is
 * the approximation everyone quotes, so reporting it beats reporting nothing.
 */
const VIEWING_DISTANCE_M_PER_MM_PITCH = 1.0;

/** Pixels one processor drives comfortably before a second is needed. */
const PIXELS_PER_PROCESSOR = 2_600_000;
/** Pixels per data run on a normal gigabit output. */
const PIXELS_PER_DATA_RUN = 650_000;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function deriveLedScreen(screen: LedScreenLike): LedDerivation {
  const panel = ledPanel(screen.panelKey);
  const columns = Math.max(1, Math.round(screen.columns));
  const rows = Math.max(1, Math.round(screen.rows));
  const cabinetCount = columns * rows;

  const widthMm = columns * panel.widthMm;
  const heightMm = rows * panel.heightMm;
  const areaSqM = Math.round(((widthMm * heightMm) / 1_000_000) * 100) / 100;

  const pixelsWide = columns * panel.pixelsWide;
  const pixelsHigh = rows * panel.pixelsHigh;
  const totalPixels = pixelsWide * pixelsHigh;

  const divisor = gcd(pixelsWide, pixelsHigh) || 1;
  const aspect = `${Math.round(pixelsWide / divisor)}:${Math.round(pixelsHigh / divisor)}`;

  const weightKg = Math.round(cabinetCount * panel.weightKg * 10) / 10;
  const powerAvgW = Math.round(cabinetCount * panel.powerAvgW);
  const powerPeakW = Math.round(cabinetCount * panel.powerPeakW);
  const peakAmps230 = Math.round((powerPeakW / 230) * 10) / 10;

  const minViewingDistanceMm = Math.round(panel.pitchMm * VIEWING_DISTANCE_M_PER_MM_PITCH * 1000);

  const processors = Math.max(1, Math.ceil(totalPixels / PIXELS_PER_PROCESSOR));
  const dataRuns = Math.max(1, Math.ceil(totalPixels / PIXELS_PER_DATA_RUN));

  const warnings: LedWarning[] = [];
  if (screen.frame === 'flown' && !panel.flyable) {
    warnings.push({
      severity: 'error',
      message: `${panel.label} cabinets are not rated to fly. Ground-stack this wall or change the panel.`,
    });
  }
  if (screen.frame === 'floor' && panel.key !== 'floor-p6-25') {
    warnings.push({
      severity: 'warning',
      message: 'Only walkable floor cabinets should be laid flat. Standard cabinets will be crushed.',
    });
  }
  if (panel.use === 'indoor' && screen.frame === 'ground-support' && heightMm > 6000) {
    warnings.push({
      severity: 'warning',
      message: `A ${(heightMm / 1000).toFixed(1)} m ground-stacked wall needs engineered ballast and a wind assessment if it is outdoors.`,
    });
  }
  if (screen.bottomMm > 0 && screen.bottomMm < 900 && screen.frame !== 'floor') {
    warnings.push({
      severity: 'info',
      message: 'The bottom of the image is below seated head height — the front rows will lose the lower content.',
    });
  }
  if (peakAmps230 > 32) {
    warnings.push({
      severity: 'warning',
      message: `Peak draw is about ${peakAmps230} A at 230 V. That is more than one 32 A supply; split the wall across phases.`,
    });
  }
  if (Math.abs(screen.curveDeg ?? 0) > 0 && panel.key === 'p10-outdoor') {
    warnings.push({
      severity: 'warning',
      message: 'Large-format outdoor cabinets do not curve. Build this wall flat or in flat facets.',
    });
  }

  return {
    panel,
    cabinetCount,
    widthMm,
    heightMm,
    areaSqM,
    pixelsWide,
    pixelsHigh,
    totalPixels,
    aspect,
    weightKg,
    powerAvgW,
    powerPeakW,
    peakAmps230,
    minViewingDistanceMm,
    topMm: screen.bottomMm + heightMm,
    processors,
    dataRuns,
    warnings,
  };
}

/**
 * Cabinet count for a target size.
 *
 * Rounds up: a wall is built from whole cabinets, so asking for 6.2 m of P3.9
 * gets 13 columns (6.5 m), not 12.4 columns. Reporting the achieved size back
 * is what stops a plan promising a width the hardware cannot make.
 */
export function fitLedScreen(
  panelKey: string,
  targetWidthMm: number,
  targetHeightMm: number
): { columns: number; rows: number; widthMm: number; heightMm: number } {
  const panel = ledPanel(panelKey);
  const columns = Math.max(1, Math.round(targetWidthMm / panel.widthMm));
  const rows = Math.max(1, Math.round(targetHeightMm / panel.heightMm));
  return {
    columns,
    rows,
    widthMm: columns * panel.widthMm,
    heightMm: rows * panel.heightMm,
  };
}

/** Common screen shapes offered as one-click starting points. */
export const LED_PRESETS: Array<{
  key: string;
  label: string;
  note: string;
  panelKey: string;
  columns: number;
  rows: number;
  bottomMm: number;
  frame: LedFrame;
  curveDeg: number;
}> = [
  {
    key: 'summit-16x9',
    label: 'Summit main screen',
    note: '10 m × 5.5 m, 16:9, sat on a 1 m stage riser.',
    panelKey: 'p3-9-indoor',
    columns: 20,
    rows: 11,
    bottomMm: 1000,
    frame: 'ground-support',
    curveDeg: 0,
  },
  {
    key: 'curved-backdrop',
    label: 'Curved backdrop',
    note: 'Wide gentle curve behind a stage — the shape everyone asks for.',
    panelKey: 'p3-9-indoor',
    columns: 28,
    rows: 12,
    bottomMm: 600,
    frame: 'ground-support',
    curveDeg: 24,
  },
  {
    key: 'side-delay',
    label: 'Side delay screen',
    note: 'A 4 m × 2.25 m repeat screen for the back of a long room.',
    panelKey: 'p3-9-indoor',
    columns: 8,
    rows: 5,
    bottomMm: 2200,
    frame: 'flown',
    curveDeg: 0,
  },
  {
    key: 'booth-header',
    label: 'Booth header',
    note: 'A fine-pitch strip above an exhibition stand.',
    panelKey: 'p2-6-indoor',
    columns: 12,
    rows: 2,
    bottomMm: 2600,
    frame: 'flown',
    curveDeg: 0,
  },
  {
    key: 'portrait-totem',
    label: 'Portrait totem',
    note: 'A vertical wayfinding or sponsor column.',
    panelKey: 'p2-6-indoor',
    columns: 2,
    rows: 8,
    bottomMm: 0,
    frame: 'ground-support',
    curveDeg: 0,
  },
  {
    key: 'led-dancefloor',
    label: 'LED dance floor',
    note: '5 m × 5 m of walkable cabinet, laid flat.',
    panelKey: 'floor-p6-25',
    columns: 10,
    rows: 10,
    bottomMm: 0,
    frame: 'floor',
    curveDeg: 0,
  },
  {
    key: 'outdoor-stage',
    label: 'Outdoor stage wall',
    note: 'Daylight-bright 9.6 m × 5.8 m for an open-air stage.',
    panelKey: 'p10-outdoor',
    columns: 10,
    rows: 6,
    bottomMm: 1200,
    frame: 'ground-support',
    curveDeg: 0,
  },
];
