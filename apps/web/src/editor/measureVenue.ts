import * as THREE from 'three';
import { worldToMm, type SiteBoundsMm } from '@novira/shared';

/**
 * Finding the actual room inside a building model.
 *
 * ## Why the recorded figures are not enough
 *
 * A venue record says the Johari Rotana's ballroom is 51 × 16 m, and that is
 * correct. What it cannot say is *where in the model* those 51 × 16 metres are,
 * because nobody typed that in — the record describes a room, and the glTF is a
 * building.
 *
 * Everything that treated the recorded footprint as though it were centred on
 * the plan origin was therefore aiming at a rectangle that happens to sit in a
 * corridor. Verified in the browser: framing the "room" put the camera in a
 * foyer looking at a service door, with the ballroom entirely off to one side.
 * The numbers were right and the position was invented.
 *
 * ## What this does
 *
 * Measures it. The room is found by looking for what a room actually is in a
 * building mesh: **a large, flat, upward-facing surface at or near the storey's
 * height**. Candidates are scored against the dimensions the record already
 * gives — a slab 51 × 16 m is the ballroom; a slab 8 × 4 m is a lift lobby and
 * a slab 54 × 41 m is the whole floor plate — and the best match's own position
 * is what the plan then uses.
 *
 * ## Why scoring rather than simply taking the biggest
 *
 * The biggest horizontal surface in a hotel model is the ground slab the whole
 * building stands on, which is exactly what should *not* be framed. The record
 * is the discriminator: it says how big the room is, and the measurement says
 * where something that size is. Neither is sufficient alone, and together they
 * are reliable — which is why this refines the record rather than replacing it.
 *
 * Run once, when the shell finishes loading. The result is written back into
 * the plan, so it costs one traversal per venue rather than one per frame.
 */

/** A flat surface somebody could stand on, as found in the mesh. */
interface Slab {
  bounds: SiteBoundsMm;
  /** Top of the surface, in millimetres above the plan origin. */
  yMm: number;
  widthMm: number;
  depthMm: number;
}

/**
 * Ignore anything thinner than this in plan — a skirting board is flat and
 * upward-facing and is not a floor.
 */
const MIN_SPAN_MM = 4000;
/** A floor is flat: anything taller than this is furniture or structure. */
const MAX_SLAB_THICKNESS_M = 0.8;

/**
 * Find where the room described by `widthMm` × `depthMm` actually sits.
 *
 * Returns null when nothing in the mesh resembles it, which is the honest
 * answer for a model that is only walls, or one whose floor is a single
 * building-wide plate with no room boundaries in the geometry at all. The
 * caller keeps the recorded footprint in that case, which is where it started.
 */
export function locateRoom(
  shell: THREE.Object3D,
  widthMm: number,
  depthMm: number,
  nearYMm: number
): { bounds: SiteBoundsMm; yMm: number } | null {
  const slabs: Slab[] = [];
  const box = new THREE.Box3();

  shell.updateWorldMatrix(true, true);
  shell.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const local = mesh.geometry.boundingBox;
    if (!local) return;

    box.copy(local).applyMatrix4(mesh.matrixWorld);
    const height = box.max.y - box.min.y;
    // Flat, and big enough in plan to be a room rather than a threshold.
    if (height > MAX_SLAB_THICKNESS_M) return;

    const w = Math.round(worldToMm(box.max.x - box.min.x));
    const d = Math.round(worldToMm(box.max.z - box.min.z));
    if (w < MIN_SPAN_MM || d < MIN_SPAN_MM) return;

    slabs.push({
      bounds: {
        minX: Math.round(worldToMm(box.min.x)),
        maxX: Math.round(worldToMm(box.max.x)),
        minZ: Math.round(worldToMm(box.min.z)),
        maxZ: Math.round(worldToMm(box.max.z)),
      },
      yMm: Math.round(worldToMm(box.max.y)),
      widthMm: w,
      depthMm: d,
    });
  });

  if (!slabs.length) return null;

  /*
   * Score each candidate on how closely it matches the room that was recorded.
   *
   * The two dimensions are compared as *ratios* rather than differences, so a
   * slab twice the size scores the same as one half the size — both are the
   * wrong room, and neither is more wrong for being larger. Orientation is
   * tried both ways round, because whether the model's X is the room's width
   * depends on how the building was drawn and nobody recorded that either.
   */
  const fit = (a: number, b: number) => (a > 0 && b > 0 ? Math.min(a, b) / Math.max(a, b) : 0);

  let best: { slab: Slab; score: number } | null = null;
  for (const slab of slabs) {
    const straight = fit(slab.widthMm, widthMm) * fit(slab.depthMm, depthMm);
    const turned = fit(slab.widthMm, depthMm) * fit(slab.depthMm, widthMm);
    let score = Math.max(straight, turned);

    /*
     * Prefer a surface at the storey being worked on.
     *
     * A building has a room this size on several floors, and the one that
     * matters is the one whose height was recorded. A metre of tolerance
     * covers the difference between the top of a slab and the finished floor
     * over it; beyond that the penalty grows, so a correctly sized room three
     * storeys up loses to a slightly-less-correct one on the right level.
     */
    const offMm = Math.abs(slab.yMm - nearYMm);
    score *= 1 / (1 + Math.max(0, offMm - 1000) / 4000);

    if (!best || score > best.score) best = { slab, score };
  }

  /*
   * A weak match is worse than no match.
   *
   * Below this, the best candidate is not the room — it is the building's own
   * floor plate or a car park — and moving the plan's idea of the room onto it
   * would be worse than leaving the recorded footprint where it was. Two thirds
   * on the product of both dimensions is a genuinely close match: a 51 × 16 m
   * room matching a 45 × 14 m slab scores 0.77, and matching the 54 × 41 m
   * floor plate scores 0.37.
   */
  if (!best || best.score < 0.62) return null;
  return { bounds: best.slab.bounds, yMm: best.slab.yMm };
}
