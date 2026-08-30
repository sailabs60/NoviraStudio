import { useEffect } from 'react';
import { invalidate } from '@react-three/fiber';
import * as THREE from 'three';
import { finishForPart, tileRepeat, type FinishMap, type SurfaceFinish } from '@novira/shared';

/**
 * Putting a finish on geometry.
 *
 * The document says "the seat cushion of this chair is emerald velvet, tiled at
 * 400 mm". Turning that into a rendered surface is this module's whole job, and
 * three details are what separate it from a colour swap:
 *
 *  · **Tiling is derived from the geometry.** A finish carries a real-world
 *    tile size in millimetres; the repeat count comes from measuring the mesh
 *    it lands on. That is why a 300 mm tile looks like 300 mm tiles on both a
 *    side table and a 40 m backwall, and why resizing an object does not
 *    stretch its material.
 *
 *  · **Textures are shared, materials are not.** The same oak map may be on
 *    forty objects; loading it forty times would cost forty uploads to the GPU.
 *    Materials, by contrast, must be per-mesh — two chairs with different
 *    cushions cannot share one.
 *
 *  · **The original is kept.** Removing a finish has to put back exactly what
 *    the model shipped with, so the first application stashes the original
 *    material on the mesh rather than overwriting it.
 */

/* ── Texture cache ─────────────────────────────────────────────────────── */

const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');

const textures = new Map<string, THREE.Texture>();

function loadTexture(url: string, colorSpace: THREE.ColorSpace): THREE.Texture {
  const key = `${url}::${colorSpace}`;
  const cached = textures.get(key);
  if (cached) return cached;

  /*
   * The viewport renders on demand, and a texture arriving is a change React
   * never sees — without the invalidate the material updates on the GPU and
   * nothing redraws, so the surface stays untextured until the next click.
   */
  const texture = loader.load(url, () => invalidate());
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  // Anisotropy matters enormously for floors seen at a grazing angle, which is
  // most of them in a plan view tipped towards perspective.
  texture.anisotropy = 8;
  textures.set(key, texture);
  return texture;
}

/**
 * A texture is shared, so its repeat cannot be. Each surface gets a clone that
 * shares the same GPU image but carries its own transform.
 */
function tiledTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  repeatX: number,
  repeatY: number,
  rotationDeg: number
): THREE.Texture {
  const base = loadTexture(url, colorSpace);
  const view = base.clone();
  view.needsUpdate = true;
  view.wrapS = THREE.RepeatWrapping;
  view.wrapT = THREE.RepeatWrapping;
  view.repeat.set(repeatX, repeatY);
  view.center.set(0.5, 0.5);
  view.rotation = (rotationDeg * Math.PI) / 180;
  return view;
}

/* ── Applying ──────────────────────────────────────────────────────────── */

interface Stash {
  original: THREE.Material | THREE.Material[];
  applied?: THREE.MeshStandardMaterial;
  appliedKey?: string;
}

const STASH = Symbol('novira.finish');

type MeshWithStash = THREE.Mesh & { [STASH]?: Stash };

/** The name this mesh answers to when a finish targets a part. */
function partName(mesh: THREE.Mesh): string {
  const explicit = (mesh.userData as { part?: string } | undefined)?.part;
  if (explicit) return explicit;
  const material = mesh.material as THREE.Material | THREE.Material[];
  const single = Array.isArray(material) ? material[0] : material;
  if (single?.name) return single.name;
  return mesh.name || '*';
}

/**
 * The two extents a texture should tile across, in millimetres.
 *
 * Taken from the mesh's own bounding box and the two axes of its largest face,
 * which is right for the flat and box-like surfaces that make up almost
 * everything in an event build. A curved or organic mesh gets an approximation;
 * that is acceptable, because the alternative is a UV unwrap the browser has no
 * business doing at drop time.
 */
function surfaceExtentMm(mesh: THREE.Mesh): { u: number; v: number } {
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return { u: 1000, v: 1000 };

  const size = box.getSize(new THREE.Vector3());
  const scale = mesh.getWorldScale(new THREE.Vector3());
  const dims = [size.x * scale.x, size.y * scale.y, size.z * scale.z]
    .map((v) => Math.max(0.001, Math.abs(v)) * 1000)
    .sort((a, b) => b - a);

  // The two largest extents: the face a texture is actually read across.
  return { u: dims[0] ?? 1000, v: dims[1] ?? 1000 };
}

/** A key that changes whenever the rendered result would differ. */
function finishKey(finish: SurfaceFinish): string {
  return [
    finish.materialId,
    finish.colorHex,
    finish.tileMm,
    finish.rotationDeg ?? 0,
    finish.roughness,
    finish.metalness,
    finish.opacity ?? 1,
    finish.emissiveIntensity ?? 0,
    finish.maps?.color ?? '',
    finish.maps?.normal ?? '',
    finish.maps?.roughness ?? '',
    finish.maps?.metalness ?? '',
    finish.maps?.ao ?? '',
  ].join('|');
}

function buildMaterial(finish: SurfaceFinish, mesh: THREE.Mesh): THREE.MeshStandardMaterial {
  const extent = surfaceExtentMm(mesh);
  const repeatX = tileRepeat(extent.u, finish.tileMm);
  const repeatY = tileRepeat(extent.v, finish.tileMm);
  const rotation = finish.rotationDeg ?? 0;

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(finish.colorHex),
    roughness: finish.roughness,
    metalness: finish.metalness,
  });
  material.name = `novira:${finish.materialId}`;

  const maps = finish.maps ?? {};
  if (maps.color) {
    material.map = tiledTexture(maps.color, THREE.SRGBColorSpace, repeatX, repeatY, rotation);
  }
  if (maps.normal) {
    material.normalMap = tiledTexture(maps.normal, THREE.LinearSRGBColorSpace, repeatX, repeatY, rotation);
    const strength = finish.normalScale ?? 1;
    material.normalScale = new THREE.Vector2(strength, strength);
  }
  if (maps.roughness) {
    material.roughnessMap = tiledTexture(maps.roughness, THREE.LinearSRGBColorSpace, repeatX, repeatY, rotation);
  }
  if (maps.metalness) {
    material.metalnessMap = tiledTexture(maps.metalness, THREE.LinearSRGBColorSpace, repeatX, repeatY, rotation);
  }
  if (maps.ao) {
    material.aoMap = tiledTexture(maps.ao, THREE.LinearSRGBColorSpace, repeatX, repeatY, rotation);
    material.aoMapIntensity = 1;
  }

  if (finish.emissiveIntensity) {
    material.emissive = new THREE.Color(finish.colorHex);
    material.emissiveIntensity = finish.emissiveIntensity;
    if (maps.color) material.emissiveMap = material.map;
  }

  const opacity = finish.opacity ?? 1;
  if (opacity < 1) {
    material.transparent = true;
    material.opacity = opacity;
  }

  return material;
}

/**
 * Apply a finish map to a rendered graph.
 *
 * Idempotent: called on every render, it only rebuilds a material when the
 * finish that produced it has actually changed. That matters because the
 * alternative — rebuilding on every frame — allocates a `MeshStandardMaterial`
 * and recompiles a shader sixty times a second, which stalls the tab within
 * seconds on a busy plan.
 */
export function applyFinishes(root: THREE.Object3D, finishes: FinishMap | undefined): void {
  root.traverse((node) => {
    if (!(node as THREE.Mesh).isMesh) return;
    const mesh = node as MeshWithStash;

    const part = partName(mesh);
    const finish = finishForPart(finishes, part);

    if (!finish) {
      // Put back what the model shipped with, once.
      const stash = mesh[STASH];
      if (stash) {
        mesh.material = stash.original;
        stash.applied?.dispose();
        delete mesh[STASH];
      }
      return;
    }

    const key = finishKey(finish);
    let stash = mesh[STASH];
    if (!stash) {
      stash = { original: mesh.material };
      mesh[STASH] = stash;
    }
    if (stash.appliedKey === key && stash.applied) {
      mesh.material = stash.applied;
      return;
    }

    stash.applied?.dispose();
    const material = buildMaterial(finish, mesh);
    stash.applied = material;
    stash.appliedKey = key;
    mesh.material = material;
  });
}

/** Put every original material back and forget every applied one. */
export function clearFinishes(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as MeshWithStash;
    const stash = mesh[STASH];
    if (!stash) return;
    mesh.material = stash.original;
    stash.applied?.dispose();
    delete mesh[STASH];
  });
}

/**
 * Keep a rendered graph in step with the document's finishes.
 *
 * A hook rather than a call so the cleanup is guaranteed — an object removed
 * from the plan while it carried a generated material would otherwise leak that
 * material and its shader program.
 */
export function useFinishes(root: THREE.Object3D | null | undefined, finishes: FinishMap | undefined): void {
  useEffect(() => {
    if (!root) return;
    applyFinishes(root, finishes);
  }, [root, finishes]);

  useEffect(() => {
    if (!root) return;
    return () => clearFinishes(root);
  }, [root]);
}
