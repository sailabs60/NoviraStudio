/**
 * 2D drafting tools.
 *
 * Checks the arithmetic these produce, which is the part that matters: a
 * dimension that reads 4.97 m where it should read 5.00 m is worse than no
 * dimension, because someone will build from it.
 */
import {
  DRAW_KIND_INFO,
  areaSqM,
  arcPoints,
  circlePoints,
  findSnap,
  measureDrawing,
  pathLengthMm,
  polygonAreaMm2,
  rectangleCorners,
  resolveDrawPoints,
} from '../packages/shared/dist/index.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ── Lengths ─────────────────────────────────────────────────────────────── */

const line = [{ xMm: 0, zMm: 0 }, { xMm: 3000, zMm: 4000 }];
check('line length is exact', measureDrawing('line', line).lengthMm === 5000,
  `${measureDrawing('line', line).lengthMm} mm (3-4-5)`);

const run = [{ xMm: 0, zMm: 0 }, { xMm: 1000, zMm: 0 }, { xMm: 1000, zMm: 2000 }];
check('polyline sums its segments', pathLengthMm(run) === 3000, `${pathLengthMm(run)} mm`);

/* ── Rectangles ──────────────────────────────────────────────────────────── */

const rect = [{ xMm: 0, zMm: 0 }, { xMm: 6000, zMm: 4000 }];
const corners = rectangleCorners(rect[0], rect[1]);
check('rectangle has four corners', corners.length === 4);

const rectMeasure = measureDrawing('rectangle', rect);
check('rectangle perimeter', rectMeasure.lengthMm === 20000, `${rectMeasure.lengthMm} mm`);
check('rectangle area', areaSqM(rectMeasure.areaMm2) === 24, `${areaSqM(rectMeasure.areaMm2)} m²`);

/* A rectangle drawn backwards must measure the same. */
const backwards = measureDrawing('rectangle', [{ xMm: 6000, zMm: 4000 }, { xMm: 0, zMm: 0 }]);
check('rectangle drawn in reverse is identical',
  backwards.areaMm2 === rectMeasure.areaMm2 && backwards.lengthMm === rectMeasure.lengthMm);

/* ── Circles ─────────────────────────────────────────────────────────────── */

const circle = [{ xMm: 0, zMm: 0 }, { xMm: 2000, zMm: 0 }];
const circleMeasure = measureDrawing('circle', circle);
check('circle area uses πr² rather than the polygon approximation',
  Math.abs(circleMeasure.areaMm2 - Math.PI * 2000 * 2000) < 1,
  `${areaSqM(circleMeasure.areaMm2)} m² for r=2 m`);
check('circle circumference', Math.abs(circleMeasure.lengthMm - 2 * Math.PI * 2000) < 1,
  `${Math.round(circleMeasure.lengthMm)} mm`);
check('circle renders as a closed ring', circlePoints(circle[0], circle[1]).length === 48);

/* ── Arcs ────────────────────────────────────────────────────────────────── */

const arc = arcPoints({ xMm: 0, zMm: 0 }, { xMm: 1000, zMm: 0 }, { xMm: 0, zMm: 1000 }, 32);
check('arc starts and ends where asked',
  Math.abs(arc[0].xMm - 1000) < 2 && Math.abs(arc[arc.length - 1].zMm - 1000) < 2,
  `${arc.length} points from (${arc[0].xMm},${arc[0].zMm}) to (${arc[arc.length-1].xMm},${arc[arc.length-1].zMm})`);

const arcRadii = arc.map((p) => Math.hypot(p.xMm, p.zMm));
check('every arc point is on the radius',
  Math.max(...arcRadii) - Math.min(...arcRadii) < 2,
  `radius ${Math.round(Math.min(...arcRadii))}–${Math.round(Math.max(...arcRadii))} mm`);

/* The sweep must take the short way round, not the long one. */
const shortArc = arcPoints({ xMm: 0, zMm: 0 }, { xMm: 1000, zMm: 0 }, { xMm: -1000, zMm: 100 }, 32);
const arcLength = pathLengthMm(shortArc);
check('arc takes the shorter sweep', arcLength < Math.PI * 1000 * 1.1,
  `${Math.round(arcLength)} mm, semicircle is ${Math.round(Math.PI * 1000)} mm`);

/* ── Areas ───────────────────────────────────────────────────────────────── */

const lShape = [
  { xMm: 0, zMm: 0 }, { xMm: 4000, zMm: 0 }, { xMm: 4000, zMm: 2000 },
  { xMm: 2000, zMm: 2000 }, { xMm: 2000, zMm: 4000 }, { xMm: 0, zMm: 4000 },
];
check('concave polygon area', areaSqM(polygonAreaMm2(lShape)) === 12,
  `${areaSqM(polygonAreaMm2(lShape))} m² for an L of 4×2 + 2×2`);

/* Winding direction must not change the answer. */
check('winding direction does not matter',
  polygonAreaMm2(lShape) === polygonAreaMm2([...lShape].reverse()));

/* ── Snapping ────────────────────────────────────────────────────────────── */

const segments = [{ start: { xMm: 0, zMm: 0 }, end: { xMm: 5000, zMm: 0 } }];

const endSnap = findSnap({ xMm: 4900, zMm: 60 }, { gridMm: 500, segments });
check('snaps to a wall endpoint over the grid',
  endSnap.kind === 'endpoint' && endSnap.point.xMm === 5000 && endSnap.point.zMm === 0,
  `${endSnap.kind} at ${endSnap.point.xMm},${endSnap.point.zMm}`);

const midSnap = findSnap({ xMm: 2510, zMm: 80 }, { gridMm: 500, segments });
check('snaps to a midpoint', midSnap.kind === 'midpoint' && midSnap.point.xMm === 2500,
  `${midSnap.kind} at ${midSnap.point.xMm}`);

const gridSnap = findSnap({ xMm: 3040, zMm: 8000 }, { gridMm: 500, segments });
check('falls back to the grid', gridSnap.kind === 'grid' && gridSnap.point.xMm === 3000,
  `${gridSnap.point.xMm},${gridSnap.point.zMm}`);

/* Orthogonal constraint while drawing from an anchor. */
const ortho = findSnap(
  { xMm: 6000, zMm: 40 },
  { gridMm: 500, segments: [], anchor: { xMm: 0, zMm: 0 } }
);
check('near-horizontal runs snap flat', ortho.kind === 'ortho' && ortho.point.zMm === 0,
  `${ortho.label} at z=${ortho.point.zMm}`);

const orthoV = findSnap(
  { xMm: 30, zMm: 6000 },
  { gridMm: 500, segments: [], anchor: { xMm: 0, zMm: 0 } }
);
check('near-vertical runs snap straight', orthoV.kind === 'ortho' && orthoV.point.xMm === 0,
  `${orthoV.label} at x=${orthoV.point.xMm}`);

/* A genuine diagonal must not be forced square. */
const diagonal = findSnap(
  { xMm: 4000, zMm: 4000 },
  { gridMm: 500, segments: [], anchor: { xMm: 0, zMm: 0 } }
);
check('diagonals are left alone', diagonal.kind !== 'ortho', diagonal.kind);

/* Grid snapping can be turned off entirely. */
const free = findSnap({ xMm: 3040, zMm: 8000 }, { gridMm: 500, segments: [], enableGrid: false, enableOrtho: false });
check('snapping can be disabled', free.point.xMm === 3040, `${free.point.xMm}`);

/* ── Shape resolution ────────────────────────────────────────────────────── */

check('every draw kind has a description',
  Object.values(DRAW_KIND_INFO).every((i) => i.label && i.hint),
  `${Object.keys(DRAW_KIND_INFO).length} kinds`);

check('two clicks resolve a rectangle to four corners',
  resolveDrawPoints('rectangle', rect).length === 4);
check('a line resolves to itself', resolveDrawPoints('line', line).length === 2);

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} drafting checks passed.`);
process.exit(passed === results.length ? 0 : 1);
