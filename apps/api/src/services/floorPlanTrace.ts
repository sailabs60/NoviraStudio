/**
 * Wall tracing from a floor-plan drawing.
 *
 * This is deliberately **not** a call to a third-party model. A floor plan is a
 * high-contrast line drawing, which is the easiest possible case for classical
 * computer vision — and doing it locally means no per-run cost, no provider
 * outage, no image leaving the server, and a result in a second rather than a
 * minute.
 *
 * The pipeline:
 *
 *   1. greyscale, downscale, and threshold to a binary mask of "ink"
 *   2. project the mask onto each axis to find rows and columns that are
 *      mostly ink — those are the walls, because architectural drawings are
 *      overwhelmingly orthogonal
 *   3. group adjacent strong rows/columns into single lines (a wall drawn as
 *      two parallel edges must not become two walls)
 *   4. walk each line and keep the spans where ink is actually continuous, so
 *      doorways and window openings break the run rather than being bridged
 *   5. convert to millimetres using the calibration the user already set
 *
 * It will not read a hand sketch, and it says so rather than guessing. Manual
 * drawing remains available and free for everything this cannot handle.
 */
import sharp from 'sharp';
import type { WallPoint } from '@novira/shared';

export interface TraceOptions {
  /** Millimetres per pixel of the *original* image, from calibration. */
  mmPerPixel: number;
  /** Ink threshold, 0–255. Lower catches fainter lines and more noise. */
  threshold?: number;
  /** A line must be this fraction of the span to count as a wall. */
  minCoverage?: number;
  /** Shorter runs than this are noise, in millimetres. */
  minWallLengthMm?: number;
}

export interface TracedWall {
  start: WallPoint;
  end: WallPoint;
  orientation: 'horizontal' | 'vertical';
}

export interface TraceResult {
  walls: TracedWall[];
  /** What the tracer saw, so a poor result can be explained rather than blamed. */
  diagnostics: {
    widthPx: number;
    heightPx: number;
    inkRatio: number;
    horizontalCandidates: number;
    verticalCandidates: number;
    note?: string;
  };
}

/** Downscale target — enough detail for walls, small enough to stay fast. */
const WORK_WIDTH = 900;

export async function traceWalls(imagePath: string, options: TraceOptions): Promise<TraceResult> {
  const {
    threshold = 140,
    /*
     * 0.28 was chosen against a known-answer plan: at 0.35 the outer walls are
     * found but interior partitions broken by doorways fall below the bar, and
     * below 0.28 nothing further is gained. At this value the tracer recovers
     * the partitions and splits them exactly at the openings.
     */
    minCoverage = 0.28,
    minWallLengthMm = 600,
  } = options;

  const source = sharp(imagePath).flatten({ background: '#ffffff' });
  const meta = await source.metadata();
  const originalWidth = meta.width ?? WORK_WIDTH;
  const originalHeight = meta.height ?? WORK_WIDTH;

  const scale = Math.min(1, WORK_WIDTH / originalWidth);
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));

  const { data } = await source
    .resize(width, height, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Binary ink mask.
  const ink = new Uint8Array(width * height);
  let inkCount = 0;
  for (let i = 0; i < ink.length; i += 1) {
    if (data[i]! < threshold) {
      ink[i] = 1;
      inkCount += 1;
    }
  }
  const inkRatio = inkCount / ink.length;

  const diagnostics: TraceResult['diagnostics'] = {
    widthPx: width,
    heightPx: height,
    inkRatio,
    horizontalCandidates: 0,
    verticalCandidates: 0,
  };

  // A drawing that is almost blank, or almost solid, is not something we can read.
  if (inkRatio < 0.002) {
    return { walls: [], diagnostics: { ...diagnostics, note: 'The drawing is too faint or too sparse to read.' } };
  }
  if (inkRatio > 0.45) {
    return { walls: [], diagnostics: { ...diagnostics, note: 'The drawing is too dense — try a cleaner export without fills or hatching.' } };
  }

  // Millimetres per pixel in the *working* image.
  const mmPerWorkPx = options.mmPerPixel / scale;
  const minLengthPx = minWallLengthMm / mmPerWorkPx;

  /* ── Row and column projections ─────────────────────────────────────── */
  const rowScore = new Float32Array(height);
  const colScore = new Float32Array(width);
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x < width; x += 1) if (ink[y * width + x]) count += 1;
    rowScore[y] = count / width;
  }
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y < height; y += 1) if (ink[y * width + x]) count += 1;
    colScore[x] = count / height;
  }

  const strongRows = groupRuns(rowScore, minCoverage);
  const strongCols = groupRuns(colScore, minCoverage);
  diagnostics.horizontalCandidates = strongRows.length;
  diagnostics.verticalCandidates = strongCols.length;

  if (!strongRows.length && !strongCols.length) {
    return {
      walls: [],
      diagnostics: { ...diagnostics, note: 'No continuous straight lines were found. Trace the walls manually.' },
    };
  }

  const walls: TracedWall[] = [];
  const toMm = (px: number) => Math.round(px * mmPerWorkPx);
  // Centre the result on the origin, matching how the plan image is placed.
  const offsetX = (width / 2) * mmPerWorkPx;
  const offsetZ = (height / 2) * mmPerWorkPx;

  for (const row of strongRows) {
    for (const span of continuousSpans(
      (x) => Boolean(ink[row * width + x]),
      width,
      minLengthPx
    )) {
      walls.push({
        orientation: 'horizontal',
        start: { xMm: toMm(span.from) - offsetX, zMm: toMm(row) - offsetZ },
        end: { xMm: toMm(span.to) - offsetX, zMm: toMm(row) - offsetZ },
      });
    }
  }

  for (const col of strongCols) {
    for (const span of continuousSpans(
      (y) => Boolean(ink[y * width + col]),
      height,
      minLengthPx
    )) {
      walls.push({
        orientation: 'vertical',
        start: { xMm: toMm(col) - offsetX, zMm: toMm(span.from) - offsetZ },
        end: { xMm: toMm(col) - offsetX, zMm: toMm(span.to) - offsetZ },
      });
    }
  }

  if (!walls.length) {
    diagnostics.note = 'Lines were detected but none were long enough to be walls.';
  }

  return { walls, diagnostics };
}

/**
 * Collapse adjacent above-threshold indices into one representative line.
 *
 * A drawn wall is two parallel edges a few pixels apart; without this the
 * tracer returns both and the plan ends up with doubled walls.
 */
function groupRuns(scores: Float32Array, minCoverage: number): number[] {
  const out: number[] = [];
  let runStart = -1;

  for (let i = 0; i <= scores.length; i += 1) {
    const strong = i < scores.length && scores[i]! >= minCoverage;
    if (strong && runStart === -1) runStart = i;
    if (!strong && runStart !== -1) {
      // Take the strongest index in the run as its centre line.
      let best = runStart;
      for (let j = runStart; j < i; j += 1) if (scores[j]! > scores[best]!) best = j;
      out.push(best);
      runStart = -1;
    }
  }
  return out;
}

/**
 * Walk one line and return the stretches where ink is continuous.
 *
 * Small gaps are bridged — drawings have hatching and dimension marks — but a
 * doorway is far wider than that and correctly breaks the wall in two.
 */
function continuousSpans(
  isInk: (index: number) => boolean,
  length: number,
  minLengthPx: number,
  maxGapPx = 6
): Array<{ from: number; to: number }> {
  const spans: Array<{ from: number; to: number }> = [];
  let start = -1;
  let gap = 0;

  for (let i = 0; i < length; i += 1) {
    if (isInk(i)) {
      if (start === -1) start = i;
      gap = 0;
    } else if (start !== -1) {
      gap += 1;
      if (gap > maxGapPx) {
        const end = i - gap;
        if (end - start >= minLengthPx) spans.push({ from: start, to: end });
        start = -1;
        gap = 0;
      }
    }
  }
  if (start !== -1 && length - start >= minLengthPx) spans.push({ from: start, to: length - 1 });

  return spans;
}
