/**
 * Drawing repeated catalogue models as GPU instances.
 *
 * A generated banquet places 480 identical chairs. Rendered one React component
 * each, that is 480 clones of the same glTF and 480 draw calls, and it is the
 * single largest cost in a finished event: removing the chairs takes a
 * 571-object plan from 9 frames per second to 22, while removing the tables,
 * the stands, the lights or the entire stage changes almost nothing.
 *
 * The fix is the one the brief names. Chairs that share a model are drawn
 * together as an instanced mesh — one draw call per distinct piece of geometry
 * — while each chair keeps its own id, position, rotation and scale.
 *
 * ## What stays per-object
 *
 * Instancing is only correct for placements that are visually identical. Any
 * object that is selected, hidden, tinted, resized against its catalogue size,
 * or has a finish dropped on it is drawn the ordinary way instead, because
 * those all need their own material or their own geometry. That is why this
 * runs *alongside* the existing renderer rather than replacing it: the moment
 * you click a chair it leaves the instanced batch and becomes a normal object,
 * which is also exactly what makes it editable.
 *
 * ## Picking
 *
 * `instanceId` comes back on a raycast hit, so a click on the batch maps to the
 * right scene object through the same index the matrices were written in. That
 * is what keeps "select any individual object in the viewport" true for the 480
 * chairs that are no longer individual meshes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { invalidate, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import { mmToWorld, type CatalogSceneObject, type SceneObject } from '@novira/shared';
import { useEditor } from './editorStore';

/** Below this a batch is not worth forming; the per-object path is fine. */
const MIN_BATCH = 8;

/**
 * Above this many copies, a batch stops casting shadows.
 *
 * Twelve of something is a feature of the room and its shadows matter. Four
 * hundred is a texture, and paying a full shadow-map draw for each one is the
 * difference between a plan that turns and one that does not.
 */
const SHADOW_CAST_LIMIT = 48;

/** Batches smaller than this keep their full detail; it is never the problem. */
const SIMPLIFY_ABOVE = 60;

/**
 * Roughly how many triangles one repeated model may contribute in total.
 *
 * Two million is comfortable on the integrated graphics most of these plans are
 * drawn on, and it is far more than the geometry a room full of chairs needs to
 * read correctly. A batch over budget is decimated to fit it.
 */
const TRIANGLE_BUDGET = 2_000_000;

const triangleCount = (geometry: THREE.BufferGeometry): number =>
  geometry.index ? geometry.index.count / 3 : (geometry.attributes.position?.count ?? 0) / 3;

/*
 * Decimated geometry, cached by the geometry it came from.
 *
 * Simplification is slow enough to be worth doing once. The cache is keyed on
 * the source geometry's uuid, which is stable for the lifetime of a loaded
 * model, so the second banquet of the same chair costs nothing.
 */
const simplified = new Map<string, THREE.BufferGeometry>();

/**
 * A cheaper version of a geometry, at roughly `ratio` of its triangles.
 *
 * Returns the original on any failure. `SimplifyModifier` is a best-effort
 * algorithm that can throw on degenerate meshes, and a slightly slow chair is a
 * far better outcome than a missing one.
 */
function simplify(geometry: THREE.BufferGeometry, ratio: number): THREE.BufferGeometry {
  const key = `${geometry.uuid}:${ratio.toFixed(3)}`;
  const cached = simplified.get(key);
  if (cached) return cached;

  const count = triangleCount(geometry);
  const remove = Math.floor((geometry.attributes.position?.count ?? 0) * (1 - ratio));
  if (count < 500 || remove < 1) return geometry;

  try {
    const result = new SimplifyModifier().modify(geometry, remove);
    result.computeVertexNormals();
    simplified.set(key, result);
    return result;
  } catch {
    return geometry;
  }
}

/**
 * Can this placement be drawn as an instance?
 *
 * Everything that would need its own material or geometry is excluded. The
 * checks are cheap and run on every object every frame the scene changes, so
 * they are ordered with the common cases first.
 */
function instanceable(object: SceneObject, selectedIds: string[]): object is CatalogSceneObject {
  if (object.type !== 'catalog') return false;
  const catalog = object as CatalogSceneObject;
  if (!catalog.modelUrl) return false;
  if (object.hidden || object.locked) return false;
  if (selectedIds.includes(object.id)) return false;
  if (object.finishes && Object.keys(object.finishes).length) return false;
  if ((object.opacity ?? 1) < 1) return false;
  if (catalog.materialColors && Object.keys(catalog.materialColors).length) return false;
  return true;
}

interface Batch {
  url: string;
  objects: CatalogSceneObject[];
}

/**
 * Group the scene's repeated models into batches.
 *
 * Keyed on the model URL rather than the catalogue id, because two catalogue
 * entries can point at the same file and they draw identically when they do.
 */
export function useInstancedBatches(): { batches: Batch[]; instancedIds: Set<string> } {
  const objects = useEditor((s) => s.scene.objects);
  const selectedIds = useEditor((s) => s.selectedIds);

  return useMemo(() => {
    const byUrl = new Map<string, CatalogSceneObject[]>();
    for (const object of objects) {
      if (!instanceable(object, selectedIds)) continue;
      const url = (object as CatalogSceneObject).modelUrl!;
      const list = byUrl.get(url);
      if (list) list.push(object as CatalogSceneObject);
      else byUrl.set(url, [object as CatalogSceneObject]);
    }

    const batches: Batch[] = [];
    const instancedIds = new Set<string>();
    for (const [url, list] of byUrl) {
      if (list.length < MIN_BATCH) continue;
      batches.push({ url, objects: list });
      for (const object of list) instancedIds.add(object.id);
    }
    return { batches, instancedIds };
  }, [objects, selectedIds]);
}

export function InstancedCatalog() {
  const { batches } = useInstancedBatches();
  return (
    <>
      {batches.map((batch) => (
        <ModelBatch key={batch.url} url={batch.url} objects={batch.objects} />
      ))}
    </>
  );
}

/* ── One model, many placements ────────────────────────────────────────── */

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** The mesh's own transform inside the model, which every instance inherits. */
  local: THREE.Matrix4;
}

function ModelBatch({ url, objects }: { url: string; objects: CatalogSceneObject[] }) {
  const { scene } = useGLTF(url, '/draco/');
  const count = objects.length;
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const readOnly = useEditor((s) => s.readOnly);
  const tool = useEditor((s) => s.tool);

  /*
   * Flatten the model into its drawable parts.
   *
   * A glTF is a tree; an instanced mesh is one geometry and one material. So a
   * chair made of a seat, a back and four legs becomes up to six batches, each
   * carrying its own local transform from inside the model. Six draw calls for
   * 480 chairs is still 80 times better than 480, and the arithmetic is the
   * same one the renderer would do per node anyway.
   */
  const parts = useMemo(() => {
    const out: Part[] = [];
    scene.updateWorldMatrix(true, true);
    scene.traverse((node) => {
      if (!(node as THREE.Mesh).isMesh) return;
      const mesh = node as THREE.Mesh;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!mesh.geometry || !material) return;
      out.push({
        geometry: mesh.geometry,
        material,
        local: mesh.matrixWorld.clone(),
      });
    });

    /*
     * Simplify the geometry when there are going to be hundreds of it.
     *
     * Instancing removes the draw calls; it does not remove the triangles. A
     * catalogue chair measured 22,107 triangles, which is fine once and is
     * 10.6 million across a 480-seat banquet — more than an integrated GPU can
     * rasterise at an interactive rate, and measurably the whole remaining cost
     * of the frame.
     *
     * A chair seen across a ballroom does not need 22,000 triangles to read as
     * a chair. This decimates once per model, not per copy, and only for
     * batches big enough that the detail cannot be seen anyway.
     */
    return out;
  }, [scene]);

  /*
   * Simplification runs after the first paint, not before it.
   *
   * Decimating a 22,000-triangle chair takes long enough that doing it while
   * the scene is being built froze the page for twenty-five seconds — the plan
   * appeared to hang. Rendering the heavy geometry first and swapping in the
   * cheap version a moment later costs one slow frame and keeps the editor
   * responsive throughout, which is the right trade: the room is on screen
   * either way, and only its frame rate changes.
   */
  const [drawParts, setDrawParts] = useState(parts);

  useEffect(() => {
    setDrawParts(parts);

    const total = parts.reduce((sum, part) => sum + triangleCount(part.geometry), 0);
    if (count < SIMPLIFY_ABOVE || total * count <= TRIANGLE_BUDGET) return;

    const target = Math.max(0.06, TRIANGLE_BUDGET / (total * count));
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const reduced = parts.map((part) => ({ ...part, geometry: simplify(part.geometry, target) }));
      if (!cancelled) {
        setDrawParts(reduced);
        invalidate();
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [parts, count]);

  /*
   * The model's own size, so a placement's stated dimensions can be honoured.
   *
   * A catalogue model is authored at whatever scale its author used. The rest
   * of the editor scales it to the dimensions the catalogue records, and an
   * instanced copy has to do the same arithmetic or the chairs come out a
   * different size from the ones that are not batched.
   */
  const modelSize = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    return size;
  }, [scene]);

  return (
    <>
      {drawParts.map((part, index) => (
        <PartBatch
          key={index}
          part={part}
          objects={objects}
          modelSize={modelSize}
          onPick={(object, event) => {
            if (tool !== 'select' || readOnly) return;
            event.stopPropagation();
            toggleSelect(object.id, event.shiftKey || event.ctrlKey || event.metaKey);
          }}
        />
      ))}
    </>
  );
}

function PartBatch({
  part,
  objects,
  modelSize,
  onPick,
}: {
  part: Part;
  objects: CatalogSceneObject[];
  modelSize: THREE.Vector3;
  onPick: (object: CatalogSceneObject, event: ThreeEvent<MouseEvent>) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = objects.length;

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;

    const matrix = new THREE.Matrix4();
    const placement = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();

    objects.forEach((object, index) => {
      /*
       * Match the per-object renderer exactly.
       *
       * A placement is scaled so the model measures the dimensions the
       * catalogue records, then that is multiplied by the object's own scale.
       * Getting this wrong is not subtle — an instanced chair and a selected
       * one sit side by side, and any difference is immediately visible.
       */
      const dims = object.dimensionsMm;
      const fit = dims
        ? new THREE.Vector3(
            modelSize.x > 0 ? mmToWorld(dims.width) / modelSize.x : 1,
            modelSize.y > 0 ? mmToWorld(dims.height) / modelSize.y : 1,
            modelSize.z > 0 ? mmToWorld(dims.depth) / modelSize.z : 1
          )
        : new THREE.Vector3(1, 1, 1);

      scale.set(fit.x * (object.scale?.x ?? 1), fit.y * (object.scale?.y ?? 1), fit.z * (object.scale?.z ?? 1));

      euler.set(
        ((object.rotationDeg?.x ?? 0) * Math.PI) / 180,
        ((object.rotationDeg?.y ?? 0) * Math.PI) / 180,
        ((object.rotationDeg?.z ?? 0) * Math.PI) / 180
      );
      quaternion.setFromEuler(euler);
      position.set(
        mmToWorld(object.positionMm.x),
        mmToWorld(object.positionMm.y),
        mmToWorld(object.positionMm.z)
      );

      placement.compose(position, quaternion, scale);
      // The mesh's transform inside the model, then the placement on top.
      matrix.multiplyMatrices(placement, part.local);
      mesh.setMatrixAt(index, matrix);
    });

    mesh.count = objects.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [objects, part, modelSize]);

  return (
    <instancedMesh
      ref={ref}
      // Remounted when the batch size changes: an instanced mesh cannot grow.
      key={count}
      args={[part.geometry, part.material, Math.max(1, count)]}
      /*
       * A large batch receives shadows but does not cast them.
       *
       * Every shadow-casting light redraws the whole scene into its shadow map,
       * so 480 chairs are 480 more draws per light per frame — measured, the
       * shadow pass was nearly half the frame on a 571-object event. What those
       * chairs contribute to the picture is the shadow *under* each one, and at
       * the scale a banquet is viewed from that reads as a darker floor rather
       * than as 480 distinct silhouettes. They still receive shadows, so the
       * stage lighting still falls across them, which is the part you can see.
       */
      castShadow={count < SHADOW_CAST_LIMIT}
      receiveShadow
      onClick={(event) => {
        const index = event.instanceId;
        if (index === undefined) return;
        const object = objects[index];
        if (object) onPick(object, event);
      }}
    />
  );
}
