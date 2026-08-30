import { useCallback, useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import {
  mmToWorld,
  segmentAngleDeg,
  segmentLength,
  type FloorPolygon,
  type OpeningSceneObject,
  type WallSegment,
} from '@novira/shared';
import { useEditor } from './editorStore';

const DEG = Math.PI / 180;

/**
 * Wall rendering.
 *
 * A segment becomes a box, positioned at its midpoint and rotated to its
 * bearing. Openings are cut by *splitting the box around them* rather than by
 * CSG: three.js has no cheap boolean, and for a rectangular hole in a
 * rectangular wall the split is exact, far faster, and keeps the geometry
 * trivially re-derivable when a door moves.
 */

interface WallPiece {
  /** Centre of this piece along the wall's own length axis, from the start. */
  alongMm: number;
  lengthMm: number;
  /** Vertical extent — a window leaves wall above and below. */
  bottomMm: number;
  heightMm: number;
}

/** Split a wall into the solid pieces left once its openings are removed. */
export function splitWallAroundOpenings(segment: WallSegment, openings: OpeningSceneObject[]): WallPiece[] {
  const total = segmentLength(segment.start, segment.end);
  const mine = openings
    .filter((o) => o.wallSegmentId === segment.id)
    .map((o) => ({
      start: Math.max(0, o.offsetAlongMm - o.widthMm / 2),
      end: Math.min(total, o.offsetAlongMm + o.widthMm / 2),
      bottomMm: Math.max(0, o.bottomMm),
      topMm: Math.min(segment.heightMm, o.bottomMm + o.heightMm),
    }))
    .filter((o) => o.end > o.start)
    .sort((a, b) => a.start - b.start);

  if (!mine.length) {
    return [{ alongMm: total / 2, lengthMm: total, bottomMm: 0, heightMm: segment.heightMm }];
  }

  const pieces: WallPiece[] = [];
  let cursor = 0;

  for (const opening of mine) {
    // Full-height wall before the opening.
    if (opening.start > cursor + 1) {
      const length = opening.start - cursor;
      pieces.push({ alongMm: cursor + length / 2, lengthMm: length, bottomMm: 0, heightMm: segment.heightMm });
    }
    // Wall under a window sill.
    if (opening.bottomMm > 1) {
      pieces.push({
        alongMm: (opening.start + opening.end) / 2,
        lengthMm: opening.end - opening.start,
        bottomMm: 0,
        heightMm: opening.bottomMm,
      });
    }
    // Wall above the head — the lintel.
    if (opening.topMm < segment.heightMm - 1) {
      pieces.push({
        alongMm: (opening.start + opening.end) / 2,
        lengthMm: opening.end - opening.start,
        bottomMm: opening.topMm,
        heightMm: segment.heightMm - opening.topMm,
      });
    }
    cursor = Math.max(cursor, opening.end);
  }

  if (cursor < total - 1) {
    const length = total - cursor;
    pieces.push({ alongMm: cursor + length / 2, lengthMm: length, bottomMm: 0, heightMm: segment.heightMm });
  }

  return pieces;
}

function WallSegmentMesh({
  segment,
  openings,
  selected,
  onSelect,
}: {
  segment: WallSegment;
  openings: OpeningSceneObject[];
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
}) {
  const length = segmentLength(segment.start, segment.end);
  if (length < 1) return null;

  const angle = segmentAngleDeg(segment.start, segment.end);
  const pieces = useMemo(() => splitWallAroundOpenings(segment, openings), [segment, openings]);

  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      onSelect(segment.id, event.shiftKey || event.ctrlKey || event.metaKey);
    },
    [segment.id, onSelect]
  );

  return (
    <group
      position={[mmToWorld(segment.start.xMm), 0, mmToWorld(segment.start.zMm)]}
      rotation={[0, -angle * DEG, 0]}
      onClick={handleClick}
      userData={{ wallSegmentId: segment.id }}
    >
      {pieces.map((piece, index) => (
        <mesh
          key={index}
          position={[
            mmToWorld(piece.alongMm),
            mmToWorld(piece.bottomMm + piece.heightMm / 2),
            0,
          ]}
          castShadow
          receiveShadow
        >
          <boxGeometry
            args={[mmToWorld(piece.lengthMm), mmToWorld(piece.heightMm), mmToWorld(segment.thicknessMm)]}
          />
          <meshStandardMaterial
            color={selected ? '#8b8ff5' : (segment.color ?? '#e2e0dc')}
            roughness={0.92}
            metalness={0}
            emissive={selected ? '#0059C4' : '#000000'}
            emissiveIntensity={selected ? 0.25 : 0}
          />
        </mesh>
      ))}
    </group>
  );
}

function FloorMesh({
  floor,
  selected,
  onSelect,
}: {
  floor: FloorPolygon;
  selected: boolean;
  onSelect: (id: string, additive: boolean) => void;
}) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    floor.points.forEach((point, i) => {
      const x = mmToWorld(point.xMm);
      const z = mmToWorld(point.zMm);
      if (i === 0) shape.moveTo(x, z);
      else shape.lineTo(x, z);
    });
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, [floor.points]);

  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      onSelect(floor.id, event.shiftKey || event.ctrlKey || event.metaKey);
    },
    [floor.id, onSelect]
  );

  return (
    <mesh
      geometry={geometry}
      // ShapeGeometry is authored in XY; lay it flat, and lift it a hair above
      // the ground plane so the two do not z-fight.
      rotation={[Math.PI / 2, 0, 0]}
      position={[0, 0.004, 0]}
      receiveShadow
      onClick={handleClick}
      userData={{ floorId: floor.id }}
    >
      <meshStandardMaterial
        color={selected ? '#7c7fe8' : (floor.color ?? '#9aa3b2')}
        roughness={0.95}
        side={THREE.DoubleSide}
        transparent
        opacity={selected ? 0.85 : 0.7}
      />
    </mesh>
  );
}

/** Length labels shown while a wall is selected, so runs can be checked. */
function WallDimension({ segment }: { segment: WallSegment }) {
  const centre = {
    x: mmToWorld((segment.start.xMm + segment.end.xMm) / 2),
    z: mmToWorld((segment.start.zMm + segment.end.zMm) / 2),
  };
  return (
    <mesh position={[centre.x, mmToWorld(segment.heightMm) + 0.15, centre.z]}>
      <sphereGeometry args={[0.05, 8, 8]} />
      <meshBasicMaterial color="#0072FD" />
    </mesh>
  );
}

export function Walls() {
  const segments = useEditor((s) => s.scene.walls.segments);
  const floors = useEditor((s) => s.scene.walls.floors);
  const objects = useEditor((s) => s.scene.objects);
  const selectedWallId = useEditor((s) => s.selectedWallId);
  const selectedFloorId = useEditor((s) => s.selectedFloorId);
  const selectWall = useEditor((s) => s.selectWall);
  const selectFloor = useEditor((s) => s.selectFloor);

  const openings = useMemo(
    () => objects.filter((o): o is OpeningSceneObject => o.type === 'opening'),
    [objects]
  );

  const onSelectWall = useCallback((id: string) => selectWall(id), [selectWall]);
  const onSelectFloor = useCallback((id: string) => selectFloor(id), [selectFloor]);

  return (
    <group name="walls">
      {floors.map((floor) => (
        <FloorMesh
          key={floor.id}
          floor={floor}
          selected={floor.id === selectedFloorId}
          onSelect={onSelectFloor}
        />
      ))}
      {segments.map((segment) => (
        <WallSegmentMesh
          key={segment.id}
          segment={segment}
          openings={openings}
          selected={segment.id === selectedWallId}
          onSelect={onSelectWall}
        />
      ))}
      {segments
        .filter((s) => s.id === selectedWallId)
        .map((s) => (
          <WallDimension key={s.id} segment={s} />
        ))}
    </group>
  );
}

/** Preview of the run currently being drawn. */
export function WallDrawPreview() {
  const draft = useEditor((s) => s.wallDraft);
  const hover = useEditor((s) => s.wallHover);

  const points = useMemo(() => {
    const all = hover ? [...draft, hover] : draft;
    return all.map((p) => new THREE.Vector3(mmToWorld(p.xMm), 0.02, mmToWorld(p.zMm)));
  }, [draft, hover]);

  if (points.length === 0) return null;

  const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);

  return (
    <group name="wall-draft">
      {points.length > 1 ? (
        <primitive object={new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: '#0072FD' }))} />
      ) : null}
      {draft.map((point, i) => (
        <mesh key={i} position={[mmToWorld(point.xMm), 0.05, mmToWorld(point.zMm)]}>
          <sphereGeometry args={[0.07, 12, 12]} />
          <meshBasicMaterial color="#0072FD" />
        </mesh>
      ))}
    </group>
  );
}
