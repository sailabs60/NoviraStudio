import { useMemo } from 'react';
import { Line, Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  DRAW_KIND_INFO,
  areaSqM,
  distanceMm,
  formatLength,
  measureDrawing,
  resolveDrawPoints,
  type DrawingSceneObject,
  type WallPoint,
} from '@novira/shared';
import { useEditor } from './editorStore';
import { useEditorShallow } from './selectors';

/**
 * Drafted annotation, rendered in the scene.
 *
 * Drawn as flat geometry lying at its own elevation rather than as a screen
 * overlay, so it stays registered with the room when the camera moves. A
 * dimension is most useful looking straight down, but it has to still be in the
 * right place when the model is spun round for a client.
 *
 * Lines use drei's `Line`, which draws a real screen-space width — a hairline
 * mesh would vanish at plan zoom, which is exactly where these matter most.
 */

const M = 0.001;

/** Plan point to world position at a given elevation. */
function toWorld(p: WallPoint, elevationMm: number): [number, number, number] {
  return [p.xMm * M, elevationMm * M, p.zMm * M];
}

/** Screen-space line width, scaled from the drawn millimetre width. */
function lineWidth(strokeWidthMm: number): number {
  return Math.max(1, Math.min(8, strokeWidthMm / 12));
}

function DimensionAnnotation({
  object,
  units,
}: {
  object: DrawingSceneObject;
  units: 'metric' | 'imperial';
}) {
  const [a, b] = object.points;
  if (!a || !b) return null;

  const offset = object.offsetMm ?? 400;

  /*
   * Offset the dimension line perpendicular to the span it measures, the way a
   * drawing does — sitting it on top of the thing being measured makes both
   * unreadable.
   */
  const dx = b.xMm - a.xMm;
  const dz = b.zMm - a.zMm;
  const length = Math.hypot(dx, dz) || 1;
  const nx = (-dz / length) * offset;
  const nz = (dx / length) * offset;

  const a2 = { xMm: a.xMm + nx, zMm: a.zMm + nz };
  const b2 = { xMm: b.xMm + nx, zMm: b.zMm + nz };
  const mid = { xMm: (a2.xMm + b2.xMm) / 2, zMm: (a2.zMm + b2.zMm) / 2 };

  const y = object.elevationMm;
  const label = object.text?.trim() || formatLength(Math.round(distanceMm(a, b)), units);

  return (
    <group>
      {/* Witness lines from the measured points out to the dimension line. */}
      <Line points={[toWorld(a, y), toWorld(a2, y)]} color={object.strokeColor}
        lineWidth={1} dashed transparent opacity={0.6} />
      <Line points={[toWorld(b, y), toWorld(b2, y)]} color={object.strokeColor}
        lineWidth={1} dashed transparent opacity={0.6} />
      {/* The dimension line itself. */}
      <Line points={[toWorld(a2, y), toWorld(b2, y)]} color={object.strokeColor}
        lineWidth={lineWidth(object.strokeWidthMm)} />

      <Text
        position={[mid.xMm * M, y * M + 0.02, mid.zMm * M]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={object.textSizeMm * M}
        color={object.strokeColor}
        anchorX="center"
        anchorY="middle"
        outlineWidth={object.textSizeMm * M * 0.06}
        outlineColor="#0b0f14"
      >
        {label}
      </Text>
    </group>
  );
}

function LabelAnnotation({ object }: { object: DrawingSceneObject }) {
  const point = object.points[0];
  if (!point || !object.text?.trim()) return null;

  return (
    <Text
      position={[point.xMm * M, object.elevationMm * M + 0.02, point.zMm * M]}
      rotation={[-Math.PI / 2, 0, 0]}
      fontSize={object.textSizeMm * M}
      color={object.strokeColor}
      anchorX="center"
      anchorY="middle"
      maxWidth={4}
      outlineWidth={object.textSizeMm * M * 0.06}
      outlineColor="#0b0f14"
    >
      {object.text}
    </Text>
  );
}

/** A filled region for a closed shape — a zone, a keep-clear area. */
function Fill({ object, points }: { object: DrawingSceneObject; points: WallPoint[] }) {
  const geometry = useMemo(() => {
    if (points.length < 3 || !object.fillColor || object.fillOpacity <= 0) return null;
    const shape = new THREE.Shape();
    shape.moveTo(points[0]!.xMm * M, points[0]!.zMm * M);
    for (const p of points.slice(1)) shape.lineTo(p.xMm * M, p.zMm * M);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, [points, object.fillColor, object.fillOpacity]);

  if (!geometry) return null;

  return (
    <mesh
      geometry={geometry}
      // ShapeGeometry is built in XY; lay it flat.
      rotation={[Math.PI / 2, 0, 0]}
      position={[0, object.elevationMm * M + 0.004, 0]}
    >
      <meshBasicMaterial
        color={object.fillColor!}
        transparent
        opacity={object.fillOpacity}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

export function DrawingObject({
  object,
  selected,
  units,
  showMeasurements,
}: {
  object: DrawingSceneObject;
  selected: boolean;
  units: 'metric' | 'imperial';
  showMeasurements: boolean;
}) {
  const resolved = useMemo(
    () => resolveDrawPoints(object.drawKind, object.points),
    [object.drawKind, object.points]
  );
  const measurement = useMemo(
    () => measureDrawing(object.drawKind, object.points),
    [object.drawKind, object.points]
  );

  if (object.drawKind === 'dimension') {
    return <DimensionAnnotation object={object} units={units} />;
  }
  if (object.drawKind === 'label') {
    return <LabelAnnotation object={object} />;
  }
  if (resolved.length < 2) return null;

  const closes = DRAW_KIND_INFO[object.drawKind].closes;
  const y = object.elevationMm;
  const worldPoints = resolved.map((p) => toWorld(p, y));
  if (closes) worldPoints.push(worldPoints[0]!);

  // Centre of the shape, for its measurement caption.
  const centre = resolved.reduce(
    (acc, p) => ({ xMm: acc.xMm + p.xMm / resolved.length, zMm: acc.zMm + p.zMm / resolved.length }),
    { xMm: 0, zMm: 0 }
  );

  return (
    <group>
      <Fill object={object} points={closes ? resolved : []} />
      <Line
        points={worldPoints}
        color={selected ? '#a5b4fc' : object.strokeColor}
        lineWidth={lineWidth(object.strokeWidthMm) * (selected ? 1.6 : 1)}
        dashed={object.dashed}
        dashSize={0.12}
        gapSize={0.08}
      />

      {showMeasurements ? (
        <Text
          position={[centre.xMm * M, y * M + 0.02, centre.zMm * M]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={object.textSizeMm * M * 0.8}
          color={object.strokeColor}
          anchorX="center"
          anchorY="middle"
          outlineWidth={object.textSizeMm * M * 0.05}
          outlineColor="#0b0f14"
        >
          {object.text?.trim()
            ? object.text
            : measurement.hasArea
              ? `${areaSqM(measurement.areaMm2)} m²`
              : formatLength(Math.round(measurement.lengthMm), units)}
        </Text>
      ) : null}
    </group>
  );
}

/** The run being drawn, before it is committed. */
export function DrawingPreview({
  drawKind,
  points,
  hover,
  style,
  elevationMm,
  units,
}: {
  drawKind: DrawingSceneObject['drawKind'];
  points: WallPoint[];
  hover: WallPoint | null;
  style: { strokeColor: string; strokeWidthMm: number; dashed: boolean };
  elevationMm: number;
  units: 'metric' | 'imperial';
}) {
  const all = hover ? [...points, hover] : points;
  const resolved = useMemo(() => resolveDrawPoints(drawKind, all), [drawKind, all]);
  if (resolved.length < 2) return null;

  const worldPoints = resolved.map((p) => toWorld(p, elevationMm));
  if (DRAW_KIND_INFO[drawKind].closes && resolved.length > 2) worldPoints.push(worldPoints[0]!);

  const measurement = measureDrawing(drawKind, all);
  const last = resolved[resolved.length - 1]!;

  return (
    <group>
      <Line
        points={worldPoints}
        color={style.strokeColor}
        lineWidth={lineWidth(style.strokeWidthMm)}
        dashed
        dashSize={0.1}
        gapSize={0.06}
        transparent
        opacity={0.85}
      />
      {/* Live readout, so the length is known before the click. */}
      <Text
        position={[last.xMm * M, elevationMm * M + 0.05, last.zMm * M]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.16}
        color="#e2e8f0"
        anchorX="left"
        anchorY="bottom"
        outlineWidth={0.01}
        outlineColor="#0b0f14"
      >
        {measurement.hasArea && resolved.length > 2
          ? `${areaSqM(measurement.areaMm2)} m²`
          : formatLength(Math.round(measurement.lengthMm), units)}
      </Text>
    </group>
  );
}

/**
 * The annotation currently being drawn.
 *
 * Reads straight from the store so the viewport does not have to thread the
 * draft through, matching how the wall preview works.
 */
export function DraftPreview() {
  const draft = useEditorShallow((s) => s.drawDraft);
  const hover = useEditor((s) => s.drawHover);
  const drawKind = useEditor((s) => s.drawKind);
  const style = useEditorShallow((s) => s.drawStyle);
  const elevationMm = useEditor((s) => s.drawElevationMm);
  const units = useEditor((s) => s.scene.units);

  if (!draft.length) return null;

  return (
    <DrawingPreview
      drawKind={drawKind}
      points={draft}
      hover={hover}
      style={style}
      elevationMm={elevationMm}
      units={units}
    />
  );
}