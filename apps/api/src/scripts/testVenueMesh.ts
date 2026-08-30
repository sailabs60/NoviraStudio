/**
 * Venue mesh checks.
 *
 * `scripts/test-venue.mjs` checks the derivation arithmetic; this checks that
 * the geometry actually built from it measures what the derivation promised.
 * The two are worth keeping separate — an inverted gable roof passed every
 * arithmetic check while the mesh was upside down, and only measuring the
 * vertices caught it.
 */
import { NodeIO } from '@gltf-transform/core';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { deriveVenue, defaultVenueParams, type VenueParams } from '@novira/shared';
import { env } from '../lib/env.js';
import { buildVenue } from '../services/venueGenerator.js';

const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

type Vec = [number, number, number];

async function meshPoints(relativePath: string): Promise<Vec[]> {
  const doc = await new NodeIO().read(path.join(env.assetDir, relativePath));
  const pts: Vec[] = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const a = prim.getAttribute('POSITION')!.getArray()!;
      for (let i = 0; i < a.length; i += 3) pts.push([a[i]!, a[i + 1]!, a[i + 2]!]);
    }
  }
  return pts;
}

const built: string[] = [];
async function build(name: string, params: VenueParams) {
  const rel = `venues/_test_${name}.glb`;
  built.push(rel);
  const result = await buildVenue(params, rel);
  return { ...result, points: await meshPoints(rel) };
}

function extent(pts: Vec[], axis: 0 | 1 | 2) {
  const vals = pts.map((p) => p[axis]);
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

/* ── Flat-roofed ballroom: footprint must be exact. ─────────────────────── */
{
  const params: VenueParams = {
    style: 'ballroom', widthMm: 24000, depthMm: 16000, heightMm: 5500,
    entrances: 2, windowsPerSide: 4, stageAlcove: false, columns: false,
  };
  const { points } = await build('ballroom', params);
  const x = extent(points, 0);
  const z = extent(points, 2);
  const y = extent(points, 1);

  // The flat roof caps overhang by 100 mm each side; nothing else may exceed
  // the requested footprint.
  check(
    'ballroom footprint',
    Math.abs(x.max - x.min - 24.2) < 0.01 && Math.abs(z.max - z.min - 16.2) < 0.01,
    `${(x.max - x.min).toFixed(2)} × ${(z.max - z.min).toFixed(2)} m (24.2 × 16.2 expected with roof cap)`
  );
  check(
    'ballroom is centred on the origin',
    Math.abs(x.max + x.min) < 0.01 && Math.abs(z.max + z.min) < 0.01,
    `centre ${((x.max + x.min) / 2).toFixed(3)}, ${((z.max + z.min) / 2).toFixed(3)}`
  );
  check(
    'ballroom height',
    Math.abs(y.max - 5.7) < 0.01,
    `${y.max.toFixed(2)} m (5.5 walls + 0.2 roof)`
  );
}

/* ── Gable roof: must peak at the ridge, not the eaves. ─────────────────── */
{
  const params = defaultVenueParams('marquee');
  const { derived, points } = await build('marquee', params);
  const y = extent(points, 1);

  /*
   * Sample the roof surface across the span rather than filtering by height.
   * The earlier version looked for vertices in a height band, which stopped
   * meaning anything once the roof became a solid slab whose eave edge sits
   * exactly at eaves level.
   */
  const halfW = params.widthMm / 2000;
  const highestNear = (x: number, tolerance = 0.35) => {
    const near = points.filter((p) => Math.abs(Math.abs(p[0]) - x) < tolerance);
    return near.length ? Math.max(...near.map((p) => p[1])) : null;
  };

  const atRidge = highestNear(0);
  const atEave = highestNear(halfW * 0.98, 0.6);

  check(
    'roof is higher at the ridge than at the eaves',
    atRidge !== null && atEave !== null && atRidge > atEave + 1,
    `${atRidge?.toFixed(2)} m at ridge vs ${atEave?.toFixed(2)} m at eave`
  );

  check(
    'mesh reaches the reported ridge height',
    Math.abs(y.max * 1000 - derived.roof.ridgeHeightMm) < 25,
    `${(y.max * 1000).toFixed(0)} mm vs ${derived.roof.ridgeHeightMm} mm reported`
  );

  /*
   * A sloped plane needs vertices only where it begins and ends. A stepped
   * approximation needs one per step, which is what this roof used to be —
   * and it was plainly visible as corrugation across a 24 m span. Counting the
   * distinct positions along the slope is therefore the exact test: a couple
   * per side is a plane, a dozen is a staircase.
   */
  // Strictly above the eave line, so the wall tops and glazing are excluded
  // and only the sloping part of the roof is left.
  const roofPoints = points.filter((p) => p[1] > derived.params.heightMm / 1000 + 0.1);
  const columns = new Set(roofPoints.map((p) => Math.round(Math.abs(p[0]) * 20)));
  check(
    'the slope is a plane, not a staircase',
    columns.size <= 2,
    `${columns.size} distinct positions across the slope`
  );
}

/* ── Openings must be genuine holes, not painted on. ────────────────────── */
{
  const withDoors: VenueParams = {
    style: 'conference', widthMm: 18000, depthMm: 12000, heightMm: 3200,
    entrances: 3, windowsPerSide: 0, stageAlcove: false, columns: false,
  };
  const solid: VenueParams = { ...withDoors, entrances: 0 };
  const a = await build('doors', withDoors);
  const b = await build('solid', solid);

  // Cutting three doorways splits the front wall into more pieces than the
  // single slab a solid wall produces.
  check(
    'doorways pierce the wall',
    a.triangles > b.triangles,
    `${b.triangles} triangles solid → ${a.triangles} with 3 doorways`
  );

  // No geometry may sit inside a doorway below its head height.
  const halfD = withDoors.depthMm / 2000;
  const derived = deriveVenue(withDoors);
  const door = derived.openings.find((o) => o.kind === 'door')!;
  const inDoorway = a.points.filter(
    (p) =>
      Math.abs(p[2] + halfD) < 0.15 &&
      Math.abs(p[0] - door.xMm / 1000) < door.widthMm / 2000 - 0.05 &&
      p[1] > 0.05 &&
      p[1] < door.heightMm / 1000 - 0.05
  );
  check('doorway opening is clear', inDoorway.length === 0, `${inDoorway.length} stray vertices`);
}

/* ── A pavilion is posts and a roof, with no walls. ─────────────────────── */
{
  const { points, derived } = await build('pavilion', defaultVenueParams('pavilion'));
  const eaves = derived.params.heightMm / 1000;

  check('pavilion derives no walls', derived.walls.segments.length === 0);

  /*
   * Count the posts by their plan footprint, sampling below the roof so the
   * roof slabs — whose own edges sit at eaves height — are not counted as
   * structure. Boxes only carry vertices at their extremes, so the base of
   * every post is the reliable place to look.
   */
  const atBase = points.filter((p) => Math.abs(p[1]) < 0.01);
  const footprints = new Set(
    atBase.map((p) => `${Math.round(p[0] * 200)}:${Math.round(p[2] * 200)}`)
  );
  const expectedPosts = derived.features.filter((f) => f.kind === 'post').length;

  check(
    'pavilion has a post at every derived position',
    footprints.size >= expectedPosts * 4,
    `${footprints.size} base corners for ${expectedPosts} posts`
  );

  /*
   * Nothing may span between the posts at mid height. A wall would put
   * geometry there; an open-sided pavilion has only air.
   */
  const midHeight = eaves * 0.5;
  const spanning = points.filter(
    (p) => Math.abs(p[1] - midHeight) < 0.05 && Math.abs(p[0]) < derived.params.widthMm / 2000 - 0.6
  );
  check('pavilion is open between its posts', spanning.length === 0,
    `${spanning.length} vertices between the posts at mid height`);
}
/* ── Determinism: same input, same mesh. ────────────────────────────────── */
{
  const params = defaultVenueParams('barn');
  const a = await build('barn-a', params);
  const b = await build('barn-b', params);
  const same =
    a.triangles === b.triangles &&
    a.points.length === b.points.length &&
    a.points.every((p, i) => p.every((v, k) => Math.abs(v - b.points[i]![k]!) < 1e-6));
  check('mesh is deterministic', same, `${a.triangles} triangles both times`);
}

/* Clean up the fixtures so they never reach the catalogue. */
for (const rel of built) {
  await rm(path.join(env.assetDir, rel), { force: true });
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} venue mesh checks passed.`);
process.exit(passed === results.length ? 0 : 1);
