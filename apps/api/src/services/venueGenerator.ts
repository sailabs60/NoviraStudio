/**
 * Venue generation.
 *
 * Builds a real, dimensioned venue shell as a GLB from the parameters the
 * planner chose, and registers it as a reusable Venue.
 *
 * The generator is local and deterministic rather than a call out to a model
 * service. That is a deliberate choice: an event planner needs a venue whose
 * dimensions are exactly what they asked for — a 24 m × 16 m ballroom has to
 * measure 24 m × 16 m, because every table, aisle and sightline downstream is
 * derived from it. A generative model gives a plausible-looking room of
 * unreliable size, which is worse than useless here. The same reasoning drove
 * the procedural catalogue items.
 *
 * Walls are built as segments with real openings cut out of them, so a doorway
 * is a hole through the wall rather than a dark rectangle painted on it.
 */
import {
  deriveVenue,
  type DerivedVenue,
  type VenueOpening,
  type VenueParams,
} from '@novira/shared';
import { box, buildGlb, type MeshSpec, type Part } from './proceduralAssets.js';

/** Millimetres to metres — glTF is metres, our storage is millimetres. */
const M = 0.001;

/**
 * A wall run, minus its openings, as a list of solid boxes.
 *
 * Openings are cut by splitting the run into the pieces either side of each
 * hole, plus a lintel above it and (for windows) an apron below. This is the
 * standard way to frame an opening and it means the geometry is genuinely
 * pierced rather than decorated.
 */
function wallWithOpenings(
  axis: 'x' | 'z',
  /** Fixed coordinate of the wall line. */
  fixed: number,
  from: number,
  to: number,
  thickness: number,
  height: number,
  openings: Array<{ centre: number; width: number; height: number; sill: number }>
): ReturnType<typeof box>[] {
  const pieces: ReturnType<typeof box>[] = [];
  const start = Math.min(from, to);
  const end = Math.max(from, to);

  const make = (a: number, b: number, base: number, h: number) => {
    if (b - a <= 1 || h <= 1) return;
    const centre = (a + b) / 2;
    const span = b - a;
    if (axis === 'x') {
      pieces.push(box(centre * M, fixed * M, span * M, thickness * M, h * M, base * M));
    } else {
      pieces.push(box(fixed * M, centre * M, thickness * M, span * M, h * M, base * M));
    }
  };

  const sorted = [...openings]
    .filter((o) => o.centre - o.width / 2 > start && o.centre + o.width / 2 < end)
    .sort((a, b) => a.centre - b.centre);

  let cursor = start;
  for (const o of sorted) {
    const left = o.centre - o.width / 2;
    const right = o.centre + o.width / 2;
    // Full-height wall up to the opening.
    make(cursor, left, 0, height);
    // Apron below a window sill.
    if (o.sill > 0) make(left, right, 0, o.sill);
    // Lintel above the opening.
    const headHeight = height - (o.sill + o.height);
    if (headHeight > 0) make(left, right, o.sill + o.height, headHeight);
    cursor = right;
  }
  make(cursor, end, 0, height);

  return pieces;
}

/**
 * An arbitrary convex hexahedron, given its eight corners.
 *
 * `box()` only makes axis-aligned boxes, which cannot express a sloping roof
 * plane. Approximating the slope with a stack of small boxes produces a
 * visible staircase along the ridge — on a 24 m marquee it reads as corrugated
 * sheeting rather than a roof.
 *
 * Corners are ordered bottom face first (anticlockwise seen from below), then
 * the top face directly above it.
 */
function hexahedron(c: [number, number, number][]): MeshSpec {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const face = (a: number, b: number, cIdx: number, d: number) => {
    const p0 = c[a]!;
    const p1 = c[b]!;
    const p2 = c[cIdx]!;
    const p3 = c[d]!;

    // Flat normal per face, so edges stay crisp.
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p3[0] - p0[0];
    const vy = p3[1] - p0[1];
    const vz = p3[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    const base = positions.length / 3;
    for (const point of [p0, p1, p2, p3]) {
      positions.push(point[0], point[1], point[2]);
      normals.push(nx, ny, nz);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  face(3, 2, 1, 0); // bottom
  face(4, 5, 6, 7); // top
  face(0, 1, 5, 4);
  face(1, 2, 6, 5);
  face(2, 3, 7, 6);
  face(3, 0, 4, 7);

  return { positions, indices, normals };
}

/**
 * A gable roof: two solid sloped slabs meeting at the ridge.
 *
 * Built as real inclined solids rather than stepped boxes, so the slope is a
 * plane and the ridge is a clean line.
 */
function gableRoof(
  widthMm: number,
  depthMm: number,
  eavesMm: number,
  ridgeMm: number,
  overhangMm: number
): MeshSpec[] {
  const halfW = widthMm / 2 + overhangMm;
  const halfD = depthMm / 2 + overhangMm;
  const thickness = 120;

  const eave = eavesMm * M;
  const ridge = ridgeMm * M;
  const t = thickness * M;
  const w = halfW * M;
  const d = halfD * M;

  // One slab per side, mirrored about the ridge.
  return ([-1, 1] as const).map((side) => {
    const outer = side * w;
    return hexahedron([
      // Underside: eave edge, then ridge.
      [outer, eave - t, -d],
      [0, ridge - t, -d],
      [0, ridge - t, d],
      [outer, eave - t, d],
      // Top face, directly above.
      [outer, eave, -d],
      [0, ridge, -d],
      [0, ridge, d],
      [outer, eave, d],
    ]);
  });
}

export interface VenueBuildResult {
  derived: DerivedVenue;
  assetUrl: string;
  triangles: number;
}

/**
 * Build the venue shell.
 *
 * `relativePath` is where the GLB lands under the asset directory; callers pass
 * something job-scoped so two runs never collide.
 */
export async function buildVenue(
  params: VenueParams,
  relativePath: string
): Promise<VenueBuildResult> {
  const derived = deriveVenue(params);
  const { profile } = derived;
  const parts: Part[] = [];

  const halfW = params.widthMm / 2;
  const halfD = params.depthMm / 2;
  const t = 200; // wall thickness, matching the derivation
  const h = params.heightMm;

  /* Floor slab. */
  const alcove = derived.features.find((f) => f.kind === 'stage-alcove');
  parts.push({
    mesh: box(0, 0, params.widthMm * M, params.depthMm * M, 0.1, -0.1),
    color: profile.floorColor,
    materialName: 'floor',
    roughness: 0.85,
  });
  if (alcove) {
    parts.push({
      mesh: box(
        alcove.xMm * M,
        alcove.zMm * M,
        alcove.widthMm * M,
        alcove.depthMm * M,
        0.1,
        -0.1
      ),
      color: profile.floorColor,
      materialName: 'floor',
      roughness: 0.85,
    });
  }

  if (profile.walled) {
    /* Group openings by which wall they pierce. */
    const on = (pred: (o: VenueOpening) => boolean) =>
      derived.openings.filter(pred).map((o) => ({
        centre: o.rotationDeg === 0 || o.rotationDeg === 180 ? o.xMm : o.zMm,
        width: o.widthMm,
        height: o.heightMm,
        sill: o.sillMm,
      }));

    // Front (z = -halfD), back (z = +halfD), right (x = +halfW), left (x = -halfW).
    const front = wallWithOpenings('x', -halfD, -halfW, halfW, t, h, on((o) => o.rotationDeg === 0));
    const right = wallWithOpenings('z', halfW, -halfD, halfD, t, h, on((o) => o.rotationDeg === 90));
    const left = wallWithOpenings('z', -halfW, -halfD, halfD, t, h, on((o) => o.rotationDeg === 270));

    // The back wall is interrupted where a stage alcove opens off it.
    const backOpenings = alcove
      ? [{ centre: alcove.xMm, width: alcove.widthMm, height: h - 200, sill: 0 }]
      : [];
    const back = wallWithOpenings('x', halfD, -halfW, halfW, t, h, backOpenings);

    for (const mesh of [...front, ...back, ...left, ...right]) {
      parts.push({ mesh, color: profile.wallColor, materialName: 'wall', roughness: 0.8 });
    }

    // Alcove side and back walls.
    if (alcove) {
      const aHalf = alcove.widthMm / 2;
      const zBack = halfD + alcove.depthMm;
      parts.push({
        mesh: box(0, zBack * M, (alcove.widthMm + t * 2) * M, t * M, h * M, 0),
        color: profile.wallColor,
        materialName: 'wall',
        roughness: 0.8,
      });
      for (const sign of [-1, 1]) {
        parts.push({
          mesh: box(
            (sign * (aHalf + t / 2)) * M,
            (halfD + alcove.depthMm / 2) * M,
            t * M,
            alcove.depthMm * M,
            h * M,
            0
          ),
          color: profile.wallColor,
          materialName: 'wall',
          roughness: 0.8,
        });
      }
    }
  }

  /* Columns and posts. */
  for (const feature of derived.features) {
    if (feature.kind !== 'column' && feature.kind !== 'post') continue;
    parts.push({
      mesh: box(
        feature.xMm * M,
        feature.zMm * M,
        feature.widthMm * M,
        feature.depthMm * M,
        feature.heightMm * M,
        0
      ),
      color: profile.style === 'warehouse' ? '#6b7075' : profile.wallColor,
      materialName: 'column',
      roughness: 0.6,
      metallic: profile.style === 'warehouse' ? 0.6 : 0,
    });
  }

  /* Roof. */
  if (derived.roof.kind === 'flat') {
    parts.push({
      mesh: box(0, 0, (params.widthMm + 200) * M, (params.depthMm + 200) * M, 0.2, h * M),
      color: profile.roofColor,
      materialName: 'roof',
      roughness: 0.9,
    });
  } else {
    const overhang = profile.roof === 'open' ? 600 : 300;
    for (const mesh of gableRoof(
      params.widthMm,
      params.depthMm,
      h,
      derived.roof.ridgeHeightMm,
      overhang
    )) {
      parts.push({ mesh, color: profile.roofColor, materialName: 'roof', roughness: 0.85 });
    }
  }

  /* Glazing, so windows read as glass rather than as holes. */
  for (const opening of derived.openings) {
    if (opening.kind !== 'window') continue;
    const along = opening.rotationDeg === 90 || opening.rotationDeg === 270;
    parts.push({
      mesh: box(
        opening.xMm * M,
        opening.zMm * M,
        (along ? 40 : opening.widthMm) * M,
        (along ? opening.widthMm : 40) * M,
        opening.heightMm * M,
        opening.sillMm * M
      ),
      color: '#a8c4d4',
      materialName: 'glazing',
      roughness: 0.1,
      metallic: 0.1,
    });
  }

  const { url, triangles } = await buildGlb(parts, relativePath);
  return { derived, assetUrl: url, triangles };
}
