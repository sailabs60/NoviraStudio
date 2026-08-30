import * as THREE from 'three';

/**
 * Raycasting from a DOM event.
 *
 * react-three-fiber's own pointer events cannot help here: a drag from a panel
 * into the canvas produces `dragover` events on the DOM, which never reach the
 * scene graph. So the drag layer does the picking itself, against the live
 * renderer the viewport publishes.
 *
 * The important part is what a hit *means*. A raycast returns a mesh, but the
 * editor thinks in objects and parts — so a hit is walked up the graph until
 * it finds the node the scene document owns, and the mesh's own material name
 * is kept as the part. That pair is exactly what a material drop needs: which
 * object, and which surface of it.
 */

export interface PickBridge {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
}

let bridge: PickBridge | null = null;

/** Registered by the viewport once react-three-fiber has a renderer. */
export function registerPicking(next: PickBridge | null) {
  bridge = next;
}

export function pickingReady(): boolean {
  return bridge !== null;
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const scratch = new THREE.Vector3();
const normalMatrix = new THREE.Matrix3();
const down = new THREE.Vector3();
const DOWN_DIRECTION = new THREE.Vector3(0, -1, 0);

/** Client pixels → normalised device coordinates, or null if outside. */
function toNdc(clientX: number, clientY: number): THREE.Vector2 | null {
  if (!bridge) return null;
  const rect = bridge.gl.domElement.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((clientY - rect.top) / rect.height) * 2 + 1;
  if (x < -1 || x > 1 || y < -1 || y > 1) return null;
  return ndc.set(x, y);
}

/**
 * Where the cursor meets the floor, in millimetres.
 *
 * Returns null when the ray misses the ground plane entirely — which happens
 * whenever the camera is looking at or above the horizon, and is the case that
 * has to be handled rather than clamped, because clamping puts the ghost
 * somewhere absurd instead of showing nothing.
 */
export function pickGround(clientX: number, clientY: number): { xMm: number; zMm: number } | null {
  if (!bridge) return null;
  const point = toNdc(clientX, clientY);
  if (!point) return null;

  raycaster.setFromCamera(point, bridge.camera);
  const hit = raycaster.ray.intersectPlane(GROUND, scratch);
  if (!hit) return null;
  return { xMm: Math.round(hit.x * 1000), zMm: Math.round(hit.z * 1000) };
}

export interface PlacementPoint {
  xMm: number;
  /** The height of the surface underneath, so nothing lands inside the floor. */
  yMm: number;
  zMm: number;
  /** True when the point came from real geometry rather than the ground plane. */
  onSurface: boolean;
  /** What it landed on, when that was a placed object. */
  objectId?: string;
}

/**
 * Where a thing being placed should actually stand.
 *
 * The ground plane is only the floor of an empty plan. Drop a chair into a
 * venue with a raised stage, a mezzanine, or a hotel model whose ground floor
 * sits four metres above the origin, and placing it at y = 0 buries it — the
 * user sees the object vanish and concludes the drop failed.
 *
 * So the ray is fired at the scene first and the highest **upward-facing**
 * surface under the cursor wins. The normal test is what makes it usable: a
 * wall or the underside of a truss is not somewhere a chair goes, and without
 * it a grazing ray down a wall would place furniture halfway up it.
 *
 * The ground plane remains the fallback, so an empty plan behaves exactly as
 * it always did.
 */
export function pickPlacement(
  clientX: number,
  clientY: number,
  ignoreObjectId?: string
): PlacementPoint | null {
  if (!bridge) return null;
  const point = toNdc(clientX, clientY);
  if (!point) return null;

  raycaster.setFromCamera(point, bridge.camera);
  const hits = raycaster.intersectObjects(bridge.scene.children, true);

  for (const hit of hits) {
    const mesh = hit.object;
    if (!(mesh as THREE.Mesh).isMesh || !mesh.visible) continue;
    if (isDecoration(mesh)) continue;
    /*
     * An object being dragged must not be asked where the cursor is.
     *
     * It follows the pointer, so it is permanently under it — and reading the
     * cursor's position off its own top face rather than off the floor
     * introduces a parallax error the height of the object. Every frame that
     * error is applied again, so the thing accelerates away from the pointer
     * and finishes the gesture metres from where it was let go.
     */
    if (ignoreObjectId && ownerOf(mesh) === ignoreObjectId) continue;
    if (!hit.face) continue;

    /*
     * The face normal, in world space. Anything steeper than about 40° from
     * vertical is a wall, a ceiling or the side of a riser — not a floor.
     */
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    if (normal.y < 0.68) continue;

    return {
      xMm: Math.round(hit.point.x * 1000),
      yMm: Math.round(hit.point.y * 1000),
      zMm: Math.round(hit.point.z * 1000),
      onSurface: true,
      objectId: ownerOf(mesh) ?? undefined,
    };
  }

  // Nothing under the cursor: the plan's own ground.
  const ground = raycaster.ray.intersectPlane(GROUND, scratch);
  if (!ground) return null;
  return {
    xMm: Math.round(ground.x * 1000),
    yMm: 0,
    zMm: Math.round(ground.z * 1000),
    onSurface: false,
  };
}

/**
 * The same question, from a point already in the world rather than from the
 * cursor. Used while dragging an object across the floor: the pointer gives
 * the X and Z, and this finds what height that spot sits at.
 *
 * `fromYMm` is the ceiling of the search, and it matters more than it looks.
 * Once a plan contains a real building — the Rotana's ballroom, say — a ray
 * dropped from 200 m hits the *roof* first, and a chair pushed across the floor
 * would climb onto the outside of the building. Starting a little above the
 * object being moved keeps the search inside the room it is already in: it can
 * still step up onto a stage or a riser, and cannot teleport a storey.
 */
export function surfaceHeightAt(
  xMm: number,
  zMm: number,
  ignoreObjectId?: string,
  fromYMm = 200_000
): number {
  if (!bridge) return 0;

  down.set(xMm / 1000, fromYMm / 1000, zMm / 1000);
  raycaster.set(down, DOWN_DIRECTION);
  const hits = raycaster.intersectObjects(bridge.scene.children, true);

  for (const hit of hits) {
    const mesh = hit.object;
    if (!(mesh as THREE.Mesh).isMesh || !mesh.visible) continue;
    if (isDecoration(mesh)) continue;
    // The object being dragged must not stand on itself.
    if (ignoreObjectId && ownerOf(mesh) === ignoreObjectId) continue;
    if (!hit.face) continue;

    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    if (normal.y < 0.68) continue;

    return Math.round(hit.point.y * 1000);
  }
  return 0;
}

export interface SurfaceHit {
  objectId: string;
  /** glTF material name, or the procedural builder's surface name. */
  part: string;
  /** Friendly name for the part, for the drop hint. */
  partLabel: string;
  pointMm: { x: number; y: number; z: number };
  distance: number;
}

/**
 * Is this mesh part of the interface rather than part of the design?
 *
 * The move gizmo is the reason this has to walk the whole chain rather than
 * check one flag. Three's `TransformControls` builds its arrows, planes and
 * invisible pickers as a subtree of the scene, marks none of them, and parks
 * the lot on top of whatever is selected — so a ray cast at the cursor hits an
 * arrow before it reaches the floor. Reading a drop point off that gives an
 * answer roughly the height of the object out, every frame, which is what made
 * a dragged object accelerate away from the pointer.
 *
 * Grids, outlines and our own hint geometry set `userData.helper`, and those
 * are checked at every level too: a helper's children are helpers.
 */
function isDecoration(node: THREE.Object3D | null): boolean {
  let current: THREE.Object3D | null = node;
  while (current) {
    if ((current.userData as { helper?: boolean } | undefined)?.helper) return true;
    if (current.type.startsWith('TransformControls') || current.name.startsWith('TransformControls')) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Walk up from a mesh to the scene object that owns it.
 *
 * Every placed object's group carries `userData.objectId`; nothing below it
 * does. Walking up rather than tagging every mesh keeps the renderers free to
 * build whatever internal hierarchy suits them.
 */
function ownerOf(node: THREE.Object3D | null): string | null {
  let current: THREE.Object3D | null = node;
  while (current) {
    const id = (current.userData as { objectId?: string } | undefined)?.objectId;
    if (typeof id === 'string' && id) return id;
    current = current.parent;
  }
  return null;
}

/**
 * The name of the surface a hit landed on.
 *
 * Preference order matters. A glTF material name is what the file's author
 * chose and what a designer sees in the parts list, so it wins. A procedural
 * builder sets `userData.part` on its own meshes, which is the same idea for
 * geometry we generate. Only if neither exists does it fall back to the mesh
 * name, and finally to the whole object.
 */
function partOf(mesh: THREE.Object3D): { part: string; label: string } {
  const explicit = (mesh.userData as { part?: string } | undefined)?.part;
  if (explicit) return { part: explicit, label: humanise(explicit) };

  const material = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  const single = Array.isArray(material) ? material[0] : material;
  if (single?.name) return { part: single.name, label: humanise(single.name) };

  if (mesh.name) return { part: mesh.name, label: humanise(mesh.name) };
  return { part: '*', label: 'the whole object' };
}

function humanise(raw: string): string {
  return raw
    .replace(/[_.]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * What the cursor is over, in the scene.
 *
 * Invisible and helper objects are excluded: a drop must land on something the
 * user can see. Transform gizmos, selection rings and grid helpers are all in
 * the same scene graph, and hitting one of those instead of the chair behind
 * it is the single most confusing failure this feature could have.
 */
export function pickSurface(clientX: number, clientY: number): SurfaceHit | null {
  if (!bridge) return null;
  const point = toNdc(clientX, clientY);
  if (!point) return null;

  raycaster.setFromCamera(point, bridge.camera);
  const hits = raycaster.intersectObjects(bridge.scene.children, true);

  for (const hit of hits) {
    const mesh = hit.object;
    if (!(mesh as THREE.Mesh).isMesh) continue;
    if (!mesh.visible) continue;
    // Helpers opt out by name or by a flag their renderer sets.
    if (isDecoration(mesh)) continue;
    if (mesh.type === 'GridHelper' || mesh.type === 'LineSegments') continue;

    const objectId = ownerOf(mesh);
    if (!objectId) continue;

    const { part, label } = partOf(mesh);
    return {
      objectId,
      part,
      partLabel: label,
      pointMm: {
        x: Math.round(hit.point.x * 1000),
        y: Math.round(hit.point.y * 1000),
        z: Math.round(hit.point.z * 1000),
      },
      distance: hit.distance,
    };
  }
  return null;
}

/**
 * Every distinct part of one placed object.
 *
 * Read from the rendered graph rather than the document, because the parts of
 * a glTF are a property of the file — the document has never seen them. This
 * is what fills the parts list in the properties panel, so someone can paint a
 * counter's top without having to hit it precisely with a cursor.
 */
export function partsOfObject(objectId: string): Array<{ part: string; label: string }> {
  if (!bridge) return [];
  const root = findObjectRoot(objectId);
  if (!root) return [];

  const seen = new Map<string, string>();
  root.traverse((node) => {
    if (!(node as THREE.Mesh).isMesh) return;
    const { part, label } = partOf(node);
    if (!seen.has(part)) seen.set(part, label);
  });
  return [...seen.entries()].map(([part, label]) => ({ part, label }));
}

function findObjectRoot(objectId: string): THREE.Object3D | null {
  if (!bridge) return null;
  let found: THREE.Object3D | null = null;
  bridge.scene.traverse((node) => {
    if (found) return;
    if ((node.userData as { objectId?: string } | undefined)?.objectId === objectId) found = node;
  });
  return found;
}

/** The world-space bounding box of a placed object, in millimetres. */
export function objectBoundsMm(objectId: string): { width: number; height: number; depth: number } | null {
  const root = findObjectRoot(objectId);
  if (!root) return null;
  const box = new THREE.Box3().setFromObject(root);
  if (!Number.isFinite(box.min.x) || box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  return {
    width: Math.round(size.x * 1000),
    height: Math.round(size.y * 1000),
    depth: Math.round(size.z * 1000),
  };
}
