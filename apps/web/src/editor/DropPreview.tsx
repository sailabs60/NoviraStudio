import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mmToWorld } from '@novira/shared';
import { useDrag } from './dragStore';
import { useEditor } from './editorStore';

/**
 * The ghost that stands on the floor where a dragged model would land.
 *
 * This is the piece that turns drag-and-drop from a gesture into a decision.
 * A chip on the cursor tells you *what* you are holding; only a full-size ghost
 * in the scene tells you whether it fits — whether the 2.4 m counter clears the
 * truss, whether the round table leaves a gangway. Getting that wrong is a
 * conversation with a client, so it is worth rendering properly.
 *
 * Three details do most of the work:
 *
 *  · **It is the real model where one is available**, drawn translucent, not a
 *    box standing in for it. A box would answer the size question and none of
 *    the shape ones.
 *  · **A footprint ring is drawn on the floor underneath.** In a perspective
 *    view a floating object's position on the ground is genuinely ambiguous;
 *    the ring removes the ambiguity.
 *  · **It does not participate in picking.** `raycast` is disabled on every
 *    node, so the ghost cannot occlude the surface the drop is aimed at — which
 *    would make a material drop land on the preview of itself.
 */
export function DropPreview() {
  const payload = useDrag((s) => s.payload);
  const intent = useDrag((s) => s.intent);
  const overViewport = useDrag((s) => s.overViewport);

  if (!payload || !overViewport) return null;

  if (intent.type === 'place') {
    return (
      <PlacementGhost
        payload={payload}
        xMm={intent.xMm}
        yMm={intent.yMm}
        zMm={intent.zMm}
        snapped={intent.snapped}
      />
    );
  }
  if (intent.type === 'paint') {
    return <PartHighlight objectId={intent.objectId} part={intent.part} />;
  }
  return null;
}

/* ── A model, translucent, standing where it would land ────────────────── */

function PlacementGhost({
  payload,
  xMm,
  yMm,
  zMm,
  snapped,
}: {
  payload: NonNullable<ReturnType<typeof useDrag.getState>['payload']>;
  xMm: number;
  /** The surface height found under the cursor, so the ghost stands on it. */
  yMm: number;
  zMm: number;
  snapped: boolean;
}) {
  const cache = useEditor((s) => s.itemCache);

  const { url, size } = useMemo(() => {
    if (payload.kind === 'catalog') {
      const item = payload.item;
      const cached = cache[item.id];
      return {
        url: item.modelUrl || cached?.modelUrl || null,
        size: {
          width: item.widthMm ?? 600,
          depth: item.depthMm ?? 600,
          height: item.heightMm ?? 600,
        },
      };
    }
    if (payload.kind === 'asset') {
      /*
       * An online model has no URL until it is resolved, and resolving on
       * hover would mint a signed download link for every row the cursor
       * crosses. The ghost is a correctly-proportioned box instead, which
       * still answers the only question available before the file exists:
       * roughly how much floor does this take.
       */
      return { url: null, size: { width: 900, depth: 900, height: 900 } };
    }
    return { url: null, size: { width: 600, depth: 600, height: 600 } };
  }, [payload, cache]);

  const x = mmToWorld(xMm);
  const y = mmToWorld(yMm);
  const z = mmToWorld(zMm);
  const radius = mmToWorld(Math.max(size.width, size.depth)) / 2 + 0.06;

  return (
    <group position={[x, y, z]}>
      {/* The footprint. Drawn first so it reads as shadow, not as outline. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} raycast={() => null}>
        <ringGeometry args={[Math.max(0.05, radius - 0.04), radius, 56]} />
        <meshBasicMaterial color="#0072FD" transparent opacity={snapped ? 0.95 : 0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} raycast={() => null}>
        <circleGeometry args={[radius, 56]} />
        <meshBasicMaterial color="#0072FD" transparent opacity={0.1} side={THREE.DoubleSide} />
      </mesh>

      {url ? (
        <Suspense fallback={<GhostBox size={size} />}>
          <GhostModel url={url} />
        </Suspense>
      ) : (
        <GhostBox size={size} />
      )}
    </group>
  );
}

/** The placeholder volume, at the item's real dimensions. */
function GhostBox({ size }: { size: { width: number; depth: number; height: number } }) {
  const w = mmToWorld(size.width);
  const d = mmToWorld(size.depth);
  const h = mmToWorld(size.height);
  return (
    <group position={[0, h / 2, 0]}>
      <mesh raycast={() => null}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color="#0072FD" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <lineSegments raycast={() => null}>
        <edgesGeometry args={[new THREE.BoxGeometry(w, h, d)]} />
        <lineBasicMaterial color="#0072FD" transparent opacity={0.8} />
      </lineSegments>
    </group>
  );
}

/**
 * The catalogue model itself, drawn as a hologram.
 *
 * `depthWrite` is off so the ghost never hides what is behind it — the whole
 * reason it is translucent is to let a designer judge the drop against the
 * furniture already there.
 */
function GhostModel({ url }: { url: string }) {
  const { scene } = useGLTF(url, '/draco/');

  const ghost = useMemo(() => {
    const copy = scene.clone(true);
    copy.traverse((node) => {
      node.raycast = () => null;
      if (node instanceof THREE.Mesh) {
        node.castShadow = false;
        node.receiveShadow = false;
        node.material = new THREE.MeshStandardMaterial({
          color: '#0072FD',
          transparent: true,
          opacity: 0.36,
          depthWrite: false,
          roughness: 0.5,
          metalness: 0,
          emissive: new THREE.Color('#0072FD'),
          emissiveIntensity: 0.18,
        });
      }
    });
    return copy;
  }, [scene]);

  useEffect(
    () => () => {
      ghost.traverse((node) => {
        if (node instanceof THREE.Mesh) (node.material as THREE.Material).dispose();
      });
    },
    [ghost]
  );

  return <primitive object={ghost} />;
}

/* ── The part a material would land on ─────────────────────────────────── */

/**
 * Outline the exact surface a material drop would paint.
 *
 * The brief asks that a material land on "the part it has been dragged on to",
 * and this is the half of that promise the user can see. Without it, dropping
 * onto a chair is a coin toss between the seat, the frame and the cushion, and
 * the user finds out only after the fact.
 *
 * Implemented by cloning the hit meshes into a slightly inflated additive
 * overlay rather than by touching the real materials — mutating the scene's own
 * materials for a hover state is how you end up with a chair that stays blue
 * because a drag was cancelled at the wrong moment.
 */
function PartHighlight({ objectId, part }: { objectId: string; part: string }) {
  const { scene } = useThree();
  const groupRef = useRef<THREE.Group>(null);

  const overlay = useMemo(() => {
    const root = findRoot(scene, objectId);
    if (!root) return null;

    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: '#0072FD',
      transparent: true,
      opacity: 0.42,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    root.updateWorldMatrix(true, true);
    root.traverse((node) => {
      if (!(node as THREE.Mesh).isMesh) return;
      const mesh = node as THREE.Mesh;
      if (part !== '*' && nameOf(mesh) !== part) return;

      const clone = new THREE.Mesh(mesh.geometry, material);
      clone.raycast = () => null;
      // World matrix, then undo the group's own — the overlay is added to the
      // scene root, so it must not inherit the object's transform twice.
      clone.matrixAutoUpdate = false;
      clone.matrix.copy(mesh.matrixWorld);
      clone.renderOrder = 999;
      group.add(clone);
    });

    if (!group.children.length) return null;
    return { group, material };
  }, [scene, objectId, part]);

  useEffect(() => {
    if (!overlay) return;
    return () => {
      overlay.material.dispose();
    };
  }, [overlay]);

  if (!overlay) return null;
  return <primitive ref={groupRef} object={overlay.group} />;
}

function nameOf(mesh: THREE.Mesh): string {
  const explicit = (mesh.userData as { part?: string } | undefined)?.part;
  if (explicit) return explicit;
  const material = mesh.material as THREE.Material | THREE.Material[];
  const single = Array.isArray(material) ? material[0] : material;
  if (single?.name) return single.name;
  return mesh.name || '*';
}

function findRoot(scene: THREE.Object3D, objectId: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  scene.traverse((node) => {
    if (found) return;
    if ((node.userData as { objectId?: string } | undefined)?.objectId === objectId) found = node;
  });
  return found;
}
