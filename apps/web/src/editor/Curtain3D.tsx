import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useEditor } from './editorStore';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { mmToWorld, type CurtainSceneObject } from '@novira/shared';

/**
 * Procedural drape.
 *
 * The surface is generated from a 3×3 control grid — three row widths plus six
 * corner extents, a centre bend and a top/bottom curve — with a sine ripple
 * across it for the pleats. Storing the parameters rather than a mesh means a
 * drape can be reshaped after the fact, scales to any pleat count without a new
 * asset, and costs a few dozen bytes in the scene document.
 */

interface Props {
  curtain: CurtainSceneObject;
  selected: boolean;
  showHandles?: boolean;
}

/** Half-width of the drape at a normalised height `v` (0 top → 1 bottom). */
function widthAt(curtain: CurtainSceneObject, v: number): { left: number; right: number } {
  // Interpolate through the three rows: top → middle at v=0.5 → bottom.
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  const topL = curtain.topWidthMm / 2 + curtain.topLeftExtentMm;
  const topR = curtain.topWidthMm / 2 + curtain.topRightExtentMm;
  const midL = curtain.middleWidthMm / 2 + curtain.middleLeftExtentMm;
  const midR = curtain.middleWidthMm / 2 + curtain.middleRightExtentMm;
  const botL = curtain.bottomWidthMm / 2 + curtain.bottomLeftExtentMm;
  const botR = curtain.bottomWidthMm / 2 + curtain.bottomRightExtentMm;

  if (v <= 0.5) {
    const t = v / 0.5;
    return { left: lerp(topL, midL, t), right: lerp(topR, midR, t) };
  }
  const t = (v - 0.5) / 0.5;
  return { left: lerp(midL, botL, t), right: lerp(midR, botR, t) };
}

function buildGeometry(curtain: CurtainSceneObject): THREE.BufferGeometry {
  const segmentsX = Math.max(8, Math.min(240, curtain.foldCount * 4));
  const segmentsY = 18;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const height = curtain.heightMm;
  const folds = Math.max(0, curtain.foldCount);
  const amplitude = curtain.foldAmplitudeMm;

  for (let iy = 0; iy <= segmentsY; iy += 1) {
    const v = iy / segmentsY;
    const { left, right } = widthAt(curtain, v);

    for (let ix = 0; ix <= segmentsX; ix += 1) {
      const u = ix / segmentsX;
      // Horizontal position, respecting the asymmetric extents.
      const x = -left + (left + right) * u;
      const y = -height * v;

      /*
       * Depth combines three things: the pleat ripple across the width, the
       * bow of the whole run (curve depth), and the centre bend. Pleats are
       * damped toward the top so the drape reads as gathered at the track and
       * falling free below.
       */
      const pleat = folds > 0 ? Math.sin(u * Math.PI * 2 * folds) * amplitude * (0.35 + 0.65 * v) : 0;
      const bow = Math.sin(u * Math.PI) * curtain.curveDepthMm;
      const bend = Math.sin(v * Math.PI) * curtain.middleCurveMm;
      const z = pleat + bow + bend;

      positions.push(mmToWorld(x), mmToWorld(y), mmToWorld(z));
      uvs.push(u, 1 - v);
      normals.push(0, 0, 1); // replaced by computeVertexNormals below
    }
  }

  for (let iy = 0; iy < segmentsY; iy += 1) {
    for (let ix = 0; ix < segmentsX; ix += 1) {
      const a = iy * (segmentsX + 1) + ix;
      const b = a + 1;
      const c = a + segmentsX + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** The nine draggable control points, in the drape's local space. */
export function anchorPositions(curtain: CurtainSceneObject): Array<{
  key: string;
  row: 'top' | 'middle' | 'bottom';
  column: 'left' | 'centre' | 'right';
  position: [number, number, number];
}> {
  const out: Array<{
    key: string;
    row: 'top' | 'middle' | 'bottom';
    column: 'left' | 'centre' | 'right';
    position: [number, number, number];
  }> = [];

  const rows = [
    { row: 'top' as const, v: 0 },
    { row: 'middle' as const, v: 0.5 },
    { row: 'bottom' as const, v: 1 },
  ];

  for (const { row, v } of rows) {
    const { left, right } = widthAt(curtain, v);
    const y = -curtain.heightMm * v;
    const bend = Math.sin(v * Math.PI) * curtain.middleCurveMm;
    out.push({
      key: `${row}-left`,
      row,
      column: 'left',
      position: [mmToWorld(-left), mmToWorld(y), mmToWorld(bend)],
    });
    out.push({
      key: `${row}-centre`,
      row,
      column: 'centre',
      position: [mmToWorld((right - left) / 2), mmToWorld(y), mmToWorld(bend + curtain.curveDepthMm)],
    });
    out.push({
      key: `${row}-right`,
      row,
      column: 'right',
      position: [mmToWorld(right), mmToWorld(y), mmToWorld(bend)],
    });
  }
  return out;
}

export function Curtain3D({ curtain, selected, showHandles = false }: Props) {
  const geometry = useMemo(() => buildGeometry(curtain), [curtain]);
  const anchors = useMemo(() => (showHandles ? anchorPositions(curtain) : []), [curtain, showHandles]);

  return (
    <group
      // The drape hangs from its top edge, so the origin sits at the track.
      position={[0, mmToWorld(curtain.heightMm), 0]}
      rotation={curtain.orientation === 'horizontal' ? [0, 0, 0] : [0, 0, 0]}
    >
      <mesh geometry={geometry} castShadow receiveShadow userData={{ part: 'fabric' }}>
        <meshStandardMaterial
          color={selected ? '#a5a8f0' : curtain.color}
          side={THREE.DoubleSide}
          transparent={curtain.fillOpacity < 1}
          opacity={curtain.fillOpacity}
          roughness={0.92}
          metalness={0}
          emissive={selected ? '#0059C4' : '#000000'}
          emissiveIntensity={selected ? 0.15 : 0}
        />
      </mesh>

      {/* Track rail across the top, so the drape reads as hung rather than floating. */}
      <mesh position={[0, mmToWorld(30), 0]} castShadow userData={{ part: 'track' }}>
        <boxGeometry
          args={[mmToWorld(curtain.topWidthMm + curtain.topLeftExtentMm + curtain.topRightExtentMm), mmToWorld(40), mmToWorld(40)]}
        />
        <meshStandardMaterial color="#6b7280" metalness={0.7} roughness={0.35} />
      </mesh>

      {anchors.map((anchor) => (
        <DrapeHandle key={anchor.key} curtain={curtain} anchor={anchor} />
      ))}

      {/* Red guide lines joining the control rows, matching the drag affordance. */}
      {showHandles ? <AnchorGuides curtain={curtain} /> : null}
    </group>
  );
}

function AnchorGuides({ curtain }: { curtain: CurtainSceneObject }) {
  const lines = useMemo(() => {
    const anchors = anchorPositions(curtain);
    const byRow = new Map<string, typeof anchors>();
    for (const anchor of anchors) {
      const list = byRow.get(anchor.row) ?? [];
      list.push(anchor);
      byRow.set(anchor.row, list);
    }
    return [...byRow.values()].map((row) =>
      new THREE.BufferGeometry().setFromPoints(row.map((a) => new THREE.Vector3(...a.position)))
    );
  }, [curtain]);

  return (
    <>
      {lines.map((geometry, i) => (
        <primitive
          key={i}
          object={new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#ef4444' }))}
        />
      ))}
    </>
  );
}

/** A drape with defaults that read well immediately. */
export function createCurtain(originMm = { x: 0, y: 0, z: 0 }): CurtainSceneObject {
  return {
    id: crypto.randomUUID(),
    type: 'curtain',
    name: 'Drape',
    positionMm: originMm,
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    topWidthMm: 4000,
    middleWidthMm: 4000,
    bottomWidthMm: 4000,
    heightMm: 3000,
    curveDepthMm: 0,
    middleCurveMm: 0,
    topLeftExtentMm: 0,
    topRightExtentMm: 0,
    middleLeftExtentMm: 0,
    middleRightExtentMm: 0,
    bottomLeftExtentMm: 0,
    bottomRightExtentMm: 0,
    foldCount: 24,
    foldAmplitudeMm: 90,
    orientation: 'vertical',
    color: '#e8e4dc',
    fillOpacity: 1,
  };
}

/**
 * One draggable control point on a drape.
 *
 * The nine handles were being drawn as plain spheres with no interaction at
 * all — they looked like an affordance and did nothing, which is worse than
 * not drawing them.
 *
 * Each one now edits the property it sits on: the side handles set how far
 * that row reaches out, and the centre handle sets how far the row bows
 * forward. Dragging happens against a plane facing the camera, so the handle
 * tracks the pointer no matter how the view is oriented.
 */
function DrapeHandle({
  curtain,
  anchor,
}: {
  curtain: CurtainSceneObject;
  anchor: ReturnType<typeof anchorPositions>[number];
}) {
  const updateObject = useEditor((s) => s.updateObject);
  const readOnly = useEditor((s) => s.readOnly);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { camera, raycaster, gl } = useThree();

  // Grab state, so a drag is measured from where it started rather than
  // snapping the handle to the pointer on the first move.
  const start = useRef<{ point: THREE.Vector3; value: number } | null>(null);

  /** Which property this handle drives. */
  const field = (() => {
    if (anchor.column === 'centre') {
      return anchor.row === 'middle' ? 'middleCurveMm' : 'curveDepthMm';
    }
    const side = anchor.column === 'left' ? 'Left' : 'Right';
    if (anchor.row === 'top') return `top${side}ExtentMm` as const;
    if (anchor.row === 'middle') return `middle${side}ExtentMm` as const;
    return `bottom${side}ExtentMm` as const;
  })();

  const onDown = (event: ThreeEvent<PointerEvent>) => {
    if (readOnly || curtain.locked) return;
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    start.current = {
      point: event.point.clone(),
      value: curtain[field] as number,
    };
    setDragging(true);
    gl.domElement.style.cursor = 'grabbing';
  };

  const onMove = (event: ThreeEvent<PointerEvent>) => {
    if (!dragging || !start.current) return;
    event.stopPropagation();

    /*
     * Project the pointer onto a plane through the grab point, facing the
     * camera. Using the raw intersection point would only work while the
     * pointer stays over the handle itself, which is a drag of about a
     * centimetre.
     */
    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, start.current.point);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) return;

    const delta = hit.clone().sub(start.current.point);

    /*
     * A side handle reaches outwards, so the left one grows as it moves in
     * -X and the right one as it moves in +X. A centre handle bows the drape
     * forward, which is depth.
     */
    const metres =
      anchor.column === 'centre'
        ? delta.z
        : anchor.column === 'left'
          ? -delta.x
          : delta.x;

    const next = Math.round(start.current.value + metres * 1000);
    // Extents cannot go negative; a curve may bow either way.
    const clamped = anchor.column === 'centre'
      ? Math.max(-4000, Math.min(4000, next))
      : Math.max(0, Math.min(20000, next));

    updateObject(curtain.id, { [field]: clamped } as never);
  };

  const onUp = (event: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    event.stopPropagation();
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    start.current = null;
    setDragging(false);
    gl.domElement.style.cursor = '';
  };

  const active = hovered || dragging;

  return (
    <group position={anchor.position}>
      {/*
        An invisible sphere several times the size of the visible one.
        A 55 mm dot is the right size to look at and the wrong size to grab —
        at the zoom someone actually works at it is a few pixels across. The
        hit target is what makes the handle usable; the dot is what makes it
        findable.
      */}
      <mesh
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerOut={onUp}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          gl.domElement.style.cursor = 'grab';
        }}
        onPointerLeave={() => {
          setHovered(false);
          if (!dragging) gl.domElement.style.cursor = '';
        }}
      >
        <sphereGeometry args={[0.28, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthTest={false} />
      </mesh>

      {/* The visible dot. Grows on hover so it is obvious what is grabbable. */}
      <mesh raycast={() => null}>
        <sphereGeometry args={[active ? 0.095 : 0.06, 16, 16]} />
        <meshBasicMaterial
          color={
            dragging
              ? '#0059C4'
              : active
                ? '#c7d2fe'
                : anchor.column === 'centre'
                  ? '#f59e0b'
                  : '#ffffff'
          }
          depthTest={false}
        />
      </mesh>
    </group>
  );
}
