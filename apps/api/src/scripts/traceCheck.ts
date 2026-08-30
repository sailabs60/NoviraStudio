/**
 * Known-answer check for the wall tracer.
 *
 * The synthetic plan is drawn at a known pixel size, so the recovered wall
 * lengths can be compared against the truth rather than merely eyeballed.
 */
import { traceWalls } from '../services/floorPlanTrace.js';

const file = process.argv[2] ?? 'storage/test-floorplan.png';
const mmPerPixel = Number(process.argv[3] ?? 10);

const coverage = process.argv[4] ? Number(process.argv[4]) : undefined;
const result = await traceWalls(file, { mmPerPixel, minCoverage: coverage });
console.log('diagnostics:', JSON.stringify(result.diagnostics));
console.log(`\nwalls found: ${result.walls.length}`);
for (const w of result.walls) {
  const length = Math.round(Math.hypot(w.end.xMm - w.start.xMm, w.end.zMm - w.start.zMm));
  console.log(
    `  ${w.orientation.padEnd(10)} ${String(length).padStart(6)} mm   ` +
      `(${w.start.xMm}, ${w.start.zMm}) -> (${w.end.xMm}, ${w.end.zMm})`
  );
}
