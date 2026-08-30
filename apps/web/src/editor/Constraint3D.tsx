import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  CONSTRAINT_INFO,
  mmToWorld,
  VEHICLE_SPECS,
  type ConstraintSceneObject,
  type WallPoint,
} from '@novira/shared';
import { useEditor } from './editorStore';

/**
 * The site constraint layer.
 *
 * These are the parts of the building the design has to live inside: a height
 * limit, a rigging point, a supply, an exit, a route that must stay clear. They
 * are drawn deliberately unlike everything else — flat, translucent, hatched at
 * the edge — because they are not things being built, and a plan where a
 * keep-clear zone looks like a rug is a plan someone will put a table on.
 *
 * A height limit is drawn as a *volume* when it is selected or the layer is
 * being worked on, because a line on the floor does not communicate "nothing
 * above 4 m here". Seeing the ceiling plane is what makes it obvious.
 */

interface Props {
  constraint: ConstraintSceneObject;
  selected: boolean;
}

function shapeFromPoints(points: WallPoint[]): THREE.Shape | null {
  if (points.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(mmToWorld(points[0]!.xMm), mmToWorld(points[0]!.zMm));
  for (const point of points.slice(1)) shape.lineTo(mmToWorld(point.xMm), mmToWorld(point.zMm));
  shape.closePath();
  return shape;
}

export function Constraint3D({ constraint, selected }: Props) {
  const info = CONSTRAINT_INFO[constraint.constraintKind];
  const showLabels = useEditor((s) => s.showMeasurements);
  const color = constraint.color || info.color;
  const points = constraint.points ?? [];

  const shape = useMemo(() => (info.geometry === 'area' ? shapeFromPoints(points) : null), [info.geometry, points]);

  const outline = useMemo(() => {
    if (points.length < 2) return null;
    const vertices: number[] = [];
    const closed = info.geometry === 'area';
    const list = closed ? [...points, points[0]!] : points;
    for (const point of list) vertices.push(mmToWorld(point.xMm), 0.02, mmToWorld(point.zMm));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return geometry;
  }, [points, info.geometry]);

  /* ── Point constraints: a rigging point or a supply ──────────────────── */

  if (info.geometry === 'point') {
    const at = points[0] ?? { xMm: 0, zMm: 0 };
    const x = mmToWorld(at.xMm);
    const z = mmToWorld(at.zMm);
    const isRig = constraint.constraintKind === 'rigging-point';
    const height = isRig ? mmToWorld(constraint.rigHeightMm ?? 7000) : 0.9;

    return (
      <group position={[x, 0, z]}>
        {/* A rigging point lives at the roof, so it is drawn there with a
            dropper down to the floor — otherwise it is invisible from a plan
            view and unfindable from a perspective one. */}
        <mesh position={[0, height, 0]}>
          <sphereGeometry args={[0.11, 12, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 0.8 : 0.3} />
        </mesh>
        <mesh position={[0, height / 2, 0]}>
          <cylinderGeometry args={[0.006, 0.006, height, 6]} />
          <meshBasicMaterial color={color} transparent opacity={0.35} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.16, 0.22, 24]} />
          <meshBasicMaterial color={color} transparent opacity={0.85} side={THREE.DoubleSide} />
        </mesh>

        {showLabels ? (
          <Html position={[0, height + 0.35, 0]} center style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
            <div
              className="whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold shadow"
              style={{ borderColor: color, background: 'rgb(var(--nv-surface-strong))', color }}
            >
              {constraint.label}
              {isRig && constraint.swlKg ? ` · ${constraint.swlKg} kg` : ''}
              {!isRig && constraint.amps ? ` · ${constraint.amps} A ${constraint.phases === 3 ? '3ph' : '1ph'}` : ''}
            </div>
          </Html>
        ) : null}
      </group>
    );
  }

  /* ── Area constraints ────────────────────────────────────────────────── */

  const heightLimitM = constraint.heightLimitMm ? mmToWorld(constraint.heightLimitMm) : 0;
  const vehicle = constraint.vehicle ? VEHICLE_SPECS[constraint.vehicle] : null;
  const volumeHeightM =
    constraint.constraintKind === 'height-limit'
      ? heightLimitM
      : constraint.constraintKind === 'truck-access' && vehicle
        ? mmToWorld(vehicle.heightMm)
        : constraint.constraintKind === 'exit'
          ? 2.1
          : 0;

  const centre = useMemo(() => {
    if (!points.length) return new THREE.Vector3();
    const sum = points.reduce((acc, p) => ({ x: acc.x + p.xMm, z: acc.z + p.zMm }), { x: 0, z: 0 });
    return new THREE.Vector3(mmToWorld(sum.x / points.length), 0, mmToWorld(sum.z / points.length));
  }, [points]);

  return (
    <group>
      {/* The floor area. Flat and translucent; deliberately not a material that
          could be mistaken for flooring. */}
      {shape ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
          <shapeGeometry args={[shape]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={selected ? 0.28 : 0.16}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ) : null}

      {outline ? (
        <lineLoop geometry={outline}>
          <lineBasicMaterial color={color} linewidth={2} />
        </lineLoop>
      ) : null}

      {/*
        The ceiling plane of a limit volume. Only drawn on selection, or where
        the constraint is genuinely a volume — a permanently visible plane at
        4 m over the whole room would hide everything under it.
      */}
      {constraint.showVolume && volumeHeightM > 0 && (selected || constraint.constraintKind === 'exit') && shape ? (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, volumeHeightM, 0]}>
            <shapeGeometry args={[shape]} />
            <meshBasicMaterial color={color} transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          {/* Corner posts, so the volume reads as a box rather than two planes. */}
          {points.map((point, i) => (
            <mesh key={`post-${i}`} position={[mmToWorld(point.xMm), volumeHeightM / 2, mmToWorld(point.zMm)]}>
              <cylinderGeometry args={[0.012, 0.012, volumeHeightM, 6]} />
              <meshBasicMaterial color={color} transparent opacity={0.5} />
            </mesh>
          ))}
        </>
      ) : null}

      {showLabels ? (
        <Html position={[centre.x, 0.5, centre.z]} center style={{ pointerEvents: 'none' }} zIndexRange={[20, 0]}>
          <div
            className="whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold shadow"
            style={{ borderColor: color, background: 'rgb(var(--nv-surface-strong))', color }}
          >
            {constraint.label}
            {constraint.constraintKind === 'height-limit' && constraint.heightLimitMm
              ? ` · max ${(constraint.heightLimitMm / 1000).toFixed(2)} m`
              : ''}
            {constraint.constraintKind === 'load-limit' && constraint.floorLoadKgSqM
              ? ` · ${constraint.floorLoadKgSqM} kg/m²`
              : ''}
            {constraint.constraintKind === 'exit' && constraint.clearWidthMm
              ? ` · ${(constraint.clearWidthMm / 1000).toFixed(2)} m clear`
              : ''}
            {constraint.constraintKind === 'truck-access' && vehicle ? ` · ${vehicle.label}` : ''}
          </div>
        </Html>
      ) : null}
    </group>
  );
}

/**
 * The area being drawn, following the cursor.
 *
 * Rendered outside the object list because it belongs to no object yet. The
 * rubber band to the cursor is what makes an area tool feel like a drawing
 * tool rather than a sequence of clicks.
 */
export function ConstraintDrawPreview() {
  const draft = useEditor((s) => s.constraintDraft);
  const hover = useEditor((s) => s.constraintHover);
  const kind = useEditor((s) => s.constraintKind);
  const tool = useEditor((s) => s.tool);

  const info = CONSTRAINT_INFO[kind];
  const points = useMemo(() => (hover ? [...draft, hover] : draft), [draft, hover]);

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const vertices: number[] = [];
    for (const point of points) vertices.push(mmToWorld(point.xMm), 0.03, mmToWorld(point.zMm));
    if (points.length >= 3) vertices.push(mmToWorld(points[0]!.xMm), 0.03, mmToWorld(points[0]!.zMm));
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    return buffer;
  }, [points]);

  if (tool !== 'constraint' || !draft.length) return null;

  return (
    <group>
      {geometry ? (
        <line>
          <primitive object={geometry} attach="geometry" />
          <lineBasicMaterial color={info.color} />
        </line>
      ) : null}
      {draft.map((point, i) => (
        <mesh key={i} position={[mmToWorld(point.xMm), 0.04, mmToWorld(point.zMm)]}>
          <sphereGeometry args={[0.07, 10, 10]} />
          <meshBasicMaterial color={info.color} />
        </mesh>
      ))}
      <Html
        position={[
          mmToWorld(hover?.xMm ?? draft[draft.length - 1]!.xMm),
          0.6,
          mmToWorld(hover?.zMm ?? draft[draft.length - 1]!.zMm),
        ]}
        center
        style={{ pointerEvents: 'none' }}
      >
        <div className="whitespace-nowrap rounded-full border border-line bg-surface-strong/95 px-2.5 py-1 text-[11px] font-medium text-ink shadow backdrop-blur">
          {draft.length < 3
            ? `${info.label}: click ${3 - draft.length} more point${3 - draft.length === 1 ? '' : 's'}`
            : 'Click the first point to close, or press Enter to finish'}
        </div>
      </Html>
    </group>
  );
}
