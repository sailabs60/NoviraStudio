import { useEffect, useMemo, useRef } from 'react';
import { invalidate } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Many identical boxes, drawn in one call.
 *
 * ## Why this exists
 *
 * The procedural builders — stages, booths, trussing — are written the obvious
 * React way: a `map` over the rows and columns, emitting a `<mesh>` per piece.
 * That reads beautifully and it is how the geometry stays honest against the
 * parts list. It is also, on any real event, the dominant cost in the frame.
 *
 * Measured on a 504-object banquet in the Almasi Ballroom: 812 meshes in the
 * scene, of which **326 belonged to a single 5 × 11 stage** — 220 lengths of
 * deck-edge extrusion, 72 legs, and the skirt and bracing on top of that. The
 * 419 chairs, which look like they ought to be the problem, were already
 * batched into twelve instanced draws and cost almost nothing. The scene held
 * only 26,754 triangles in total; it ran at **0.46 frames per second**, because
 * frame time on a scene that small is decided by draw calls and material
 * switches, not by geometry.
 *
 * Every one of those 326 pieces is the same box at a different position, which
 * is precisely what instancing is for. Batching them takes a stage from 326
 * draws to four.
 *
 * ## Why a shared component rather than one per builder
 *
 * The bookkeeping is identical every time and easy to get subtly wrong: an
 * instanced mesh cannot grow, so it has to be remounted when the count changes;
 * its bounding sphere has to be recomputed or it is culled from views it is
 * visible in; and the on-demand renderer has to be told a frame is needed after
 * the matrices are written, or the pieces appear on the next unrelated repaint.
 * Writing that once means the builders stay a description of the object.
 *
 * ## What it does not do
 *
 * Instances share one material, so anything that needs its own colour stays an
 * ordinary mesh. `userData.part` is set on the batch as a whole, which is what
 * the finish system and the picker read — so dropping a material on "the legs"
 * still paints the legs, and a raycast still resolves to the object that owns
 * them. What is lost is per-piece finishes *within* one part, which nothing in
 * the editor offers and nobody has asked for.
 */

export interface BoxPlacement {
  /** Centre of the box, in world units. */
  position: [number, number, number];
  /** Euler rotation in radians. Omitted means axis-aligned. */
  rotation?: [number, number, number];
  /**
   * Size in world units, when this piece differs from the batch default.
   *
   * Given as a scale against `size`, computed here rather than by the caller
   * so a batch of near-identical pieces — a skirt panel that is short at one
   * end of a run — can still share the draw call.
   */
  size?: [number, number, number];
}

export function InstancedBoxes({
  /** The size every piece is, before any per-piece override. */
  size,
  placements,
  color,
  metalness = 0,
  roughness = 1,
  part,
  castShadow = true,
  receiveShadow = false,
}: {
  size: [number, number, number];
  placements: BoxPlacement[];
  color: string;
  metalness?: number;
  roughness?: number;
  /** Names this batch for the finish system and the parts list. */
  part: string;
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = placements.length;

  /*
   * The matrices, rebuilt only when the placements actually change.
   *
   * The builders recompute their placement arrays on every render — they are
   * derived from props — so this is memoised on the contents rather than on the
   * array identity. Writing several hundred matrices on every unrelated render
   * of the parent is exactly the kind of cost this component exists to remove.
   */
  const key = useMemo(
    () =>
      placements
        .map((p) => `${p.position.join(',')}|${p.rotation?.join(',') ?? ''}|${p.size?.join(',') ?? ''}`)
        .join(';'),
    [placements]
  );

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh || !count) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();

    placements.forEach((placement, index) => {
      position.set(placement.position[0], placement.position[1], placement.position[2]);
      if (placement.rotation) {
        euler.set(placement.rotation[0], placement.rotation[1], placement.rotation[2]);
        quaternion.setFromEuler(euler);
      } else {
        quaternion.identity();
      }
      // A per-piece size is expressed against the batch's own geometry, so one
      // box mesh serves a run of pieces that differ only in length.
      if (placement.size) {
        scale.set(
          size[0] === 0 ? 1 : placement.size[0] / size[0],
          size[1] === 0 ? 1 : placement.size[1] / size[1],
          size[2] === 0 ? 1 : placement.size[2] / size[2]
        );
      } else {
        scale.set(1, 1, 1);
      }
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });

    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    // Without this the batch keeps the bounding sphere of its first layout and
    // is frustum-culled out of views it is plainly inside.
    mesh.computeBoundingSphere();
    // The viewport renders on demand; nothing else here asks for a frame.
    invalidate();
    // `key` is the contents of `placements`; see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, count, size[0], size[1], size[2]]);

  if (!count) return null;

  return (
    <instancedMesh
      // An instanced mesh cannot grow, so a changed count is a new mesh.
      key={`${part}-${count}`}
      ref={ref}
      args={[undefined, undefined, count]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      userData={{ part }}
    >
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} />
    </instancedMesh>
  );
}
