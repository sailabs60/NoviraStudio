/**
 * One material per appearance, shared across the whole scene.
 *
 * The procedural parts — booth posts, stage edge frames, truss collars, banner
 * substrates — are written as ordinary JSX with an inline `<meshStandardMaterial>`
 * on each mesh. That reads well and is exactly right for a single object. It
 * stops being right at the scale a generated event reaches: thirteen stands
 * built from seventeen parts each is 221 meshes, and every one of them gets its
 * own material object even though most are the same grey metal.
 *
 * Materials are what the renderer batches by. A hundred meshes sharing one
 * material can be drawn together; a hundred meshes with a hundred identical-but
 * -separate materials cannot, and each becomes its own draw call with its own
 * shader state. On a generated event that difference was most of the frame.
 *
 * So this hands out a cached material keyed by what it looks like. Two parts
 * that want grey metal at the same roughness get the same object, and the
 * renderer can batch them.
 *
 * ## When not to use it
 *
 * Anything that will be *mutated* per object — a selection highlight, a
 * per-placement opacity, a dropped finish — must not share, because writing to
 * a shared material changes every other user of it. Those paths clone
 * deliberately; this cache is for the parts whose appearance is fixed by what
 * they are.
 */
import * as THREE from 'three';

export interface SharedMaterialSpec {
  color: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  toneMapped?: boolean;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

function keyOf(spec: SharedMaterialSpec): string {
  return [
    spec.color,
    spec.roughness ?? 1,
    spec.metalness ?? 0,
    spec.emissive ?? '',
    spec.emissiveIntensity ?? 0,
    spec.transparent ? 1 : 0,
    spec.opacity ?? 1,
    spec.side ?? THREE.FrontSide,
    spec.toneMapped === false ? 0 : 1,
  ].join('|');
}

/**
 * A material for this appearance, reused if one already exists.
 *
 * Never disposed. The set of distinct appearances in a plan is small and
 * bounded — a few dozen — and they are wanted again the moment anything is
 * added, so holding them costs less than rebuilding them. Disposing one while
 * another mesh still referenced it would blank that mesh, which is the failure
 * a cache like this exists to avoid.
 */
export function sharedMaterial(spec: SharedMaterialSpec): THREE.MeshStandardMaterial {
  const key = keyOf(spec);
  const existing = cache.get(key);
  if (existing) return existing;

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(spec.color),
    roughness: spec.roughness ?? 1,
    metalness: spec.metalness ?? 0,
    ...(spec.emissive ? { emissive: new THREE.Color(spec.emissive) } : {}),
    ...(spec.emissiveIntensity !== undefined ? { emissiveIntensity: spec.emissiveIntensity } : {}),
    ...(spec.transparent ? { transparent: true, opacity: spec.opacity ?? 1 } : {}),
    ...(spec.side !== undefined ? { side: spec.side } : {}),
    ...(spec.toneMapped === false ? { toneMapped: false } : {}),
  });
  cache.set(key, material);
  return material;
}

/** How many distinct appearances are being held. Used by tests. */
export function sharedMaterialCount(): number {
  return cache.size;
}
