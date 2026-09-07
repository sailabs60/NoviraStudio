import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, invalidate, useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  Grid,
  GizmoHelper,
  GizmoViewport,
  OrbitControls,
  TransformControls,
  useGLTF,
  Html,
} from '@react-three/drei';
import * as THREE from 'three';
import {
  mmToWorld,
  nearestSegment,
  type CurtainSceneObject,
  type StageSceneObject,
  type Text3DSceneObject,
  type ArtworkSceneObject,
  type DrawingSceneObject,
  DRAW_KIND_INFO,
  findSnap,
  type TentSceneObject,
  orthoSnap,
  segmentAngleDeg,
  snapPoint,
  worldToMm,
  type CatalogSceneObject,
  type OpeningSceneObject,
  type SceneObject,
  type ShapeSceneObject,
  type WallPoint,
  type TrussSceneObject,
  type LedScreenSceneObject,
  type BoothSceneObject,
  type LightFixtureSceneObject,
  type ConstraintSceneObject,
  type Vec3,
} from '@novira/shared';
import { useEditor } from './editorStore';
import { ModelBoundary, useModelReachable } from './ModelBoundary';
import { Text3DObject } from './Text3DObject';
import { ArtworkObject } from './ArtworkObject';
import { SelectionToolbar } from './SelectionToolbar';
import { DrawingObject, DraftPreview } from './Drawings';
import { useEditorShallow } from './selectors';
import { useCollaboration } from './useCollaboration';
import { PeerCursors, PeerSelections } from './Presence';
import { useVisibleObjects } from './selectors';
import { registerCapture } from './capture';
import { SceneEnvironment } from './SceneEnvironment';
import { Walls, WallDrawPreview } from './Walls';
import { Stage3D } from './Stage3D';
import { Curtain3D } from './Curtain3D';
import { Tent3D } from './Tent3D';
import { Truss3D } from './Truss3D';
import { LedScreen3D } from './LedScreen3D';
import { LedQuickPanel } from './LedQuickPanel';
import { TransformRail } from './TransformRail';
import { Booth3D } from './Booth3D';
import { LightFixture3D } from './LightFixture3D';
import { Constraint3D, ConstraintDrawPreview } from './Constraint3D';
import { WalkthroughCamera } from './WalkthroughCamera';
import { isSoftwareRenderer, useRendererProfile } from './rendererProfile';
import { applyFinishes, clearFinishes } from './finishRenderer';
import { registerPicking } from './picking';
import { StudioStage3D, ToneMapping } from './StudioStage3D';
import { DropPreview } from './DropPreview';
import { beginFloorDrag, registerFloorDrag, useFloorDrag } from './useFloorDrag';

const DEG = Math.PI / 180;

/**
 * Set the instant a box-select drag resolves to a selection, and read (and
 * cleared) by the ground plane's own click handler.
 *
 * The ground plane treats any click as "deselect everything", which is
 * exactly right for a plain click and exactly wrong for the click-shaped
 * pointerup that ends a box-select drag — react-three-fiber's synthetic click
 * fires on pointerdown+pointerup hitting the same mesh with no minimum drag
 * distance of its own, so without this the ground's handler would silently
 * wipe the selection `BoxSelect` had just made a moment earlier.
 */
let boxSelectJustResolved = false;

/**
 * Read a vector out of the document without trusting it.
 *
 * Scene documents come from a database, from imports, from collaborators and
 * from older schema versions, and any of those can hand back an object missing
 * a field the renderer treats as mandatory. Reading `positionMm.x` off one of
 * those throws — and a throw in a component that sits *outside* the per-object
 * error boundary takes the whole Canvas down and loses the WebGL context, so
 * one bad row in a plan makes the entire editor go blank.
 *
 * The fix is not another boundary. It is to stop reading unvalidated values as
 * though they were validated: a missing coordinate becomes zero, the object
 * appears at the origin where somebody can see it and fix it, and the plan
 * keeps rendering.
 */
function vec3(value: unknown, fallback = 0): { x: number; y: number; z: number } {
  const v = value as { x?: unknown; y?: unknown; z?: unknown } | null | undefined;
  const n = (raw: unknown) => (typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback);
  return { x: n(v?.x), y: n(v?.y), z: n(v?.z) };
}

/** Self-hosted Draco decoder; see the note in LoadedModel. */
const DRACO_DECODER_PATH = '/draco/';

/* ── One placed catalogue model ────────────────────────────────────────── */

function CatalogModel({ object, selected }: { object: CatalogSceneObject; selected: boolean }) {
  const cached = useEditor((s) => s.itemCache[object.catalogItemId]);
  const url = object.modelUrl || cached?.modelUrl;
  const reachable = useModelReachable(url);
  if (!url) return <PlaceholderBox object={object} selected={selected} />;

  // The boundary sits outside the Suspense on purpose: Suspense handles the
  // pending state, the boundary handles a rejection. Without it, one model that
  // fails to fetch unmounts the whole Canvas and loses the WebGL context.
  const placeholder = <PlaceholderBox object={object} selected={selected} />;

  // Never hand the loader a URL that will fail: drei reports that from an
  // async callback, which no error boundary can intercept. The boundary below
  // still guards malformed-but-reachable files.
  if (reachable !== 'ok') return placeholder;
  return (
    <ModelBoundary fallback={placeholder} label={url}>
      <Suspense fallback={placeholder}>
        <LoadedModel url={url} object={object} selected={selected} />
      </Suspense>
    </ModelBoundary>
  );
}

function LoadedModel({
  url,
  object,
  selected,
}: {
  url: string;
  object: CatalogSceneObject;
  selected: boolean;
}) {
  /*
   * Decode Draco from our own host rather than drei's default Google CDN.
   * Most community-sourced assets are Draco-compressed, so the decoder is on
   * the critical path for the catalogue — a blocked or unreachable CDN would
   * mean those models silently fail to render.
   */
  const { scene } = useGLTF(url, DRACO_DECODER_PATH);

  /*
   * Each placement needs its own copy of the graph — the same catalogue model
   * may appear a hundred times in one plan and they must not share transforms
   * or material overrides.
   */
  const instance = useMemo(() => {
    const copy = scene.clone(true);
    copy.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        node.material = (node.material as THREE.Material).clone();
      }
    });
    return copy;
  }, [scene]);

  // Per-material colour overrides, applied by glTF material name.
  useEffect(() => {
    if (!object.materialColors) return;
    instance.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const material = node.material as THREE.MeshStandardMaterial;
      const override = object.materialColors?.[material.name];
      if (override) material.color.set(override);
    });
  }, [instance, object.materialColors]);

  useEffect(() => {
    instance.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        const material = node.material as THREE.MeshStandardMaterial;
        material.transparent = (object.opacity ?? 1) < 1;
        material.opacity = object.opacity ?? 1;
        material.emissive?.set(selected ? '#0059C4' : '#000000');
        material.emissiveIntensity = selected ? 0.22 : 0;
      }
    });
  }, [instance, selected, object.opacity]);

  /*
   * A building, once it is actually here, gets the camera pulled back to it.
   *
   * Opening a plan set in the Almasi Ballroom put the camera nine metres from
   * the origin — which is *inside* a room fifty-one metres across, facing a
   * blank white wall. The plan had loaded perfectly and looked broken.
   *
   * It has to happen here rather than when the venue is applied, because the
   * bounds are only real once the glTF has been fetched and built; framing
   * before that measures four constraint markers and nothing else. Suspense
   * guarantees this effect runs after the geometry exists.
   *
   * Only for venue shells, and only when the designer has not already moved
   * the camera — moving someone's view out from under them is worse than an
   * awkward first frame.
   */
  const isVenueShell = Boolean(object.venueId);
  useEffect(() => {
    if (!isVenueShell) return;
    if (useEditor.getState().cameraTouched) return;
    useEditor.getState().requestFrameAll();
  }, [isVenueShell, instance]);

  return <primitive object={instance} />;
}

/** Shown while a model loads, or when a catalogue row has no usable URL. */
function PlaceholderBox({ object, selected }: { object: SceneObject; selected: boolean }) {
  const size = (object as CatalogSceneObject).dimensionsMm ?? { width: 600, depth: 600, height: 600 };
  return (
    <mesh position={[0, mmToWorld(size.height) / 2, 0]} castShadow>
      <boxGeometry args={[mmToWorld(size.width), mmToWorld(size.height), mmToWorld(size.depth)]} />
      <meshStandardMaterial color={selected ? '#0072FD' : '#8894a6'} transparent opacity={0.55} wireframe />
    </mesh>
  );
}

/* ── Procedural shapes ─────────────────────────────────────────────────── */

function ShapeMesh({ object, selected }: { object: ShapeSceneObject; selected: boolean }) {
  const w = mmToWorld(object.widthMm);
  const d = mmToWorld(object.depthMm);
  const h = mmToWorld(Math.max(object.extrudeMm, 2));
  const color = selected ? '#0072FD' : object.fillColor;

  const geometry = useMemo(() => {
    switch (object.kind) {
      case 'circle':
        return <cylinderGeometry args={[w / 2, w / 2, h, 48]} />;
      case 'triangle':
        return <cylinderGeometry args={[w / 2, w / 2, h, 3]} />;
      case 'star':
        return <cylinderGeometry args={[w / 2, w / 2, h, 10]} />;
      default:
        return <boxGeometry args={[w, h, d]} />;
    }
  }, [object.kind, w, d, h]);

  return (
    <mesh position={[0, h / 2, 0]} receiveShadow castShadow>
      {geometry}
      <meshStandardMaterial color={color} transparent opacity={object.fillOpacity ?? 1} roughness={0.8} />
    </mesh>
  );
}

/**
 * Keep one object's rendered meshes in step with its finishes.
 *
 * The retry is not defensive padding. A catalogue model arrives through
 * Suspense, so the group is mounted and empty for a few hundred milliseconds
 * before its meshes exist — applying finishes once on mount would paint
 * nothing and look like the feature had failed. The loop stops as soon as
 * there is geometry to paint, or after a couple of seconds if the model never
 * loads at all.
 */
function useObjectFinishes(
  ref: React.RefObject<THREE.Group>,
  finishes: SceneObject['finishes']
) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    let cancelled = false;
    let attempts = 0;

    const paint = () => {
      if (cancelled || !ref.current) return;
      let meshes = 0;
      ref.current.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) meshes += 1;
      });
      applyFinishes(ref.current, finishes);
      attempts += 1;
      if (!meshes && attempts < 8) window.setTimeout(paint, 300);
    };
    paint();

    return () => {
      cancelled = true;
    };
  }, [ref, finishes]);

  useEffect(() => {
    const root = ref.current;
    return () => {
      if (root) clearFinishes(root);
    };
  }, [ref]);
}

/* ── Wrapper that applies the object transform ─────────────────────────── */

function SceneNode({ object, selected }: { object: SceneObject; selected: boolean }) {
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const units = useEditor((s) => s.scene.units);
  const showMeasurements = useEditor((s) => s.showMeasurements);
  const readOnly = useEditor((s) => s.readOnly);
  const tool = useEditor((s) => s.tool);
  const pendingItem = useEditor((s) => s.pendingItem);
  const sceneShadows = useEditor((s) => s.scene.lighting.shadowsEnabled);
  const rendererProfile = useRendererProfile();
  const shadowsEnabled = sceneShadows && rendererProfile.shadowMapSize > 0;
  const highlighted = useEditor((s) => s.highlightIds.includes(object.id));

  const onClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      /*
       * While a drawing tool is active, let the click through to the ground.
       *
       * Objects sit in front of the floor, so swallowing the event here means
       * every drafting click that lands on a table selects the table instead of
       * placing a point — and drafting is done over a room full of furniture,
       * so that is most of them. Same for the wall tool.
       *
       * An armed item is the same situation: the click means "put it here",
       * not "select whatever happens to be under the cursor", and a room busy
       * enough to be worth adding to is exactly the one where something is
       * always under the cursor.
       */
      if (tool === 'draw' || tool === 'wall' || tool === 'constraint') return;
      if (pendingItem) return;

      // The pointerup ending a box-select drag can land on an object as
      // easily as on the ground, and looks the same as a click either way —
      // see `boxSelectJustResolved`.
      if (boxSelectJustResolved) {
        boxSelectJustResolved = false;
        return;
      }

      event.stopPropagation();
      if (readOnly) return;
      toggleSelect(object.id, event.shiftKey || event.ctrlKey || event.metaKey);
    },
    [object.id, toggleSelect, readOnly, tool, pendingItem]
  );

  /**
   * Double-click to go to it.
   *
   * The other half of framing: F frames what is already selected, and this
   * selects and frames in one gesture — which is what a double-click means in
   * every 3D tool, and the fastest way across a large plan.
   */
  const onDoubleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      if (tool === 'draw' || tool === 'wall') return;
      event.stopPropagation();
      const s = useEditor.getState();
      if (!s.selectedIds.includes(object.id)) s.select([object.id]);

      /*
       * A screen opens its own editor rather than framing.
       *
       * Content, curve and panel type are judged by looking at the wall, so
       * the controls belong over the wall. Framing is still one keypress away
       * on F, and every other object type keeps double-click meaning "go to
       * this", which is the universal 3D convention.
       */
      if (object.type === 'led' && !s.readOnly) {
        s.setLedQuickEditId(object.id);
        return;
      }

      s.requestFrameSelection();
    },
    [object.id, object.type, tool]
  );

  /**
   * Right-press to push this object around the floor.
   *
   * The gesture people reach for constantly, and the one the gizmo is worst
   * at. It slides along the plan only — the height comes from whatever surface
   * ends up underneath, never from the pointer — so an object can be pushed up
   * onto a stage and back off it without ever hovering or sinking.
   */
  const onPointerDown = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (tool !== 'select' || readOnly || object.locked) return;
      if (event.nativeEvent.button !== 2) return;
      if (!beginFloorDrag(object.id, event.nativeEvent)) return;

      event.stopPropagation();
      event.nativeEvent.preventDefault();
      // Pushing something is a way of choosing it, so it selects too.
      if (!useEditor.getState().selectedIds.includes(object.id)) toggleSelect(object.id, false);
    },
    [object.id, object.locked, readOnly, tool, toggleSelect]
  );

  /*
   * Finishes are applied here, at the group, rather than inside each of the
   * dozen renderers below. That is what makes "a material works on every kind
   * of object" true rather than aspirational: a truss, a stand, a curtain and
   * an imported glTF all end up as meshes under this group, and one traversal
   * paints whichever of them the finish names.
   */
  const groupRef = useRef<THREE.Group>(null);
  useObjectFinishes(groupRef, object.finishes);

  // Read defensively — see `vec3`. A row missing a transform lands at the
  // origin at full size, which is visible and fixable; throwing here is not.
  const at = vec3(object.positionMm);
  const rotation = vec3(object.rotationDeg);
  const scale = vec3(object.scale, 1);

  return (
    <group
      ref={groupRef}
      name={object.id}
      userData={{ objectId: object.id }}
      position={[mmToWorld(at.x), mmToWorld(at.y), mmToWorld(at.z)]}
      rotation={[rotation.x * DEG, rotation.y * DEG, rotation.z * DEG]}
      scale={[scale.x, scale.y, scale.z]}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
    >
      {object.type === 'catalog' || object.type === 'opening' ? (
        <CatalogModel object={object as CatalogSceneObject} selected={selected} />
      ) : object.type === 'shape' ? (
        <ShapeMesh object={object} selected={selected} />
      ) : object.type === 'stage' ? (
        <Stage3D stage={object as StageSceneObject} selected={selected} />
      ) : object.type === 'curtain' ? (
        <Curtain3D curtain={object as CurtainSceneObject} selected={selected} showHandles={selected} />
      ) : object.type === 'tent' ? (
        <Tent3D tent={object as TentSceneObject} selected={selected} showSlots={selected} />
      ) : object.type === 'text3d' ? (
        <Text3DObject object={object as Text3DSceneObject} selected={selected} />
      ) : object.type === 'artwork' ? (
        <ArtworkObject object={object as ArtworkSceneObject} selected={selected} />
      ) : object.type === 'drawing' ? (
        <DrawingObject
          object={object as DrawingSceneObject}
          selected={selected}
          units={units}
          showMeasurements={showMeasurements}
        />
      ) : object.type === 'truss' ? (
        <Truss3D truss={object as TrussSceneObject} selected={selected} />
      ) : object.type === 'led' ? (
        <LedScreen3D screen={object as LedScreenSceneObject} selected={selected} />
      ) : object.type === 'booth' ? (
        <Booth3D booth={object as BoothSceneObject} selected={selected} />
      ) : object.type === 'light' ? (
        <LightFixture3D
          light={object as LightFixtureSceneObject}
          selected={selected}
          shadowsEnabled={shadowsEnabled}
        />
      ) : object.type === 'constraint' ? (
        <Constraint3D constraint={object as ConstraintSceneObject} selected={selected} />
      ) : (
        <PlaceholderBox object={object} selected={selected} />
      )}
      {selected || highlighted ? <SelectionRing object={object} highlighted={highlighted && !selected} /> : null}
    </group>
  );
}

/**
 * Footprint ring under the selection — readable in both top and perspective.
 *
 * Also used to point at an object a check has flagged, in a different colour,
 * so "show me" from a finding lands somewhere visible without changing what is
 * selected.
 */
function SelectionRing({ object, highlighted = false }: { object: SceneObject; highlighted?: boolean }) {
  const size =
    object.type === 'catalog'
      ? ((object as CatalogSceneObject).dimensionsMm ?? { width: 800, depth: 800 })
      : { width: (object as ShapeSceneObject).widthMm ?? 800, depth: (object as ShapeSceneObject).depthMm ?? 800 };
  const radius = mmToWorld(Math.max(size.width, size.depth)) / 2 + 0.05;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
      <ringGeometry args={[radius, radius + (highlighted ? 0.06 : 0.035), 48]} />
      <meshBasicMaterial
        color={highlighted ? '#f59e0b' : '#0072FD'}
        transparent
        opacity={0.95}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/* ── The floor, when the plan has specified one ────────────────────────── */

/**
 * The room's own floor finish.
 *
 * Separate from the shadow-catching ground plane below, and only rendered when
 * a material has actually been applied — an empty plan should show the grid,
 * not a grey slab, because the grid is what tells you the scale of what you
 * are about to draw.
 *
 * It is sized to the plan rather than to a fixed number. A fixed 80 m slab
 * looks like the world has been paved: it runs past the walls, swallows the
 * grid, and makes a 6 m stand read as a speck. Measuring the walls and objects
 * instead means the floor stops where the room does, with a metre of margin so
 * it does not look clipped.
 */
function FinishedFloor() {
  const finish = useEditor((s) => s.scene.floorFinish);
  const walls = useEditor((s) => s.scene.walls.segments);
  const objects = useEditor((s) => s.scene.objects);
  const ref = useRef<THREE.Mesh>(null);

  const size = useMemo(() => {
    let maxMm = 0;
    for (const segment of walls) {
      const a = segment?.start;
      const b = segment?.end;
      if (!a || !b) continue;
      maxMm = Math.max(
        maxMm,
        Math.abs(a.xMm ?? 0), Math.abs(a.zMm ?? 0),
        Math.abs(b.xMm ?? 0), Math.abs(b.zMm ?? 0)
      );
    }
    for (const object of objects) {
      const at = vec3(object.positionMm);
      maxMm = Math.max(maxMm, Math.abs(at.x), Math.abs(at.z));
    }
    // A 10 m floor is the floor of a small room; 120 m is a large hall and
    // also the extent of the grid, so there is no point going past it.
    const metres = Math.min(120, Math.max(10, (maxMm / 1000) * 2 + 4));
    return metres;
  }, [walls, objects]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    if (!finish) {
      clearFinishes(mesh);
      return;
    }
    // `'*'` — the floor is one surface, so there is nothing to name.
    applyFinishes(mesh, { '*': finish });
  }, [finish]);

  useEffect(() => {
    const mesh = ref.current;
    return () => {
      if (mesh) clearFinishes(mesh);
    };
  }, []);

  if (!finish) return null;

  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0005, 0]} receiveShadow raycast={() => null}>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial color={finish.colorHex} roughness={finish.roughness} metalness={finish.metalness} />
    </mesh>
  );
}

/* ── Ground: receives shadows and placement clicks ─────────────────────── */

function Ground() {
  const pendingItem = useEditor((s) => s.pendingItem);
  const setPendingItem = useEditor((s) => s.setPendingItem);
  const addObjects = useEditor((s) => s.addObjects);
  const clearSelection = useEditor((s) => s.clearSelection);
  const setPlaceHover = useEditor((s) => s.setPlaceHover);
  const snapToGrid = useEditor((s) => s.snapToGrid);
  const gridSizeMm = useEditor((s) => s.scene.gridSizeMm);

  const wallSegments = useEditor((s) => s.scene.walls.segments);
  const wallDrawing = useEditor((s) => s.wallDrawing);
  const wallDraft = useEditor((s) => s.wallDraft);
  const addWallPoint = useEditor((s) => s.addWallPoint);
  const setWallHover = useEditor((s) => s.setWallHover);
  const tool = useEditor((st) => st.tool);
  const constraintDraft = useEditorShallow((st) => st.constraintDraft);
  const constraintKind = useEditor((st) => st.constraintKind);
  const addConstraintPoint = useEditor((st) => st.addConstraintPoint);
  const setConstraintHover = useEditor((st) => st.setConstraintHover);
  const finishConstraint = useEditor((st) => st.finishConstraint);
  const drawKind = useEditor((st) => st.drawKind);
  const drawDraft = useEditorShallow((st) => st.drawDraft);
  const addDrawPoint = useEditor((st) => st.addDrawPoint);
  const setDrawHover = useEditor((st) => st.setDrawHover);
  const finishDrawing = useEditor((st) => st.finishDrawing);
  const finishWallRun = useEditor((s) => s.finishWallRun);
  const selectWall = useEditor((s) => s.selectWall);

  /**
   * Turn a hit on the ground plane into a plan point.
   *
   * Grid snapping applies first, then orthogonal snapping against the previous
   * point — rooms are overwhelmingly square, and a run that is 0.4° out never
   * closes cleanly.
   */
  const toPlanPoint = useCallback(
    (x: number, z: number): WallPoint => {
      let point: WallPoint = { xMm: worldToMm(x), zMm: worldToMm(z) };
      if (snapToGrid && gridSizeMm > 0) point = snapPoint(point, gridSizeMm);
      const previous = wallDraft[wallDraft.length - 1];
      if (previous) point = orthoSnap(previous, point);
      return point;
    },
    [snapToGrid, gridSizeMm, wallDraft]
  );

  /**
   * Snap the drafting cursor.
   *
   * Endpoints and midpoints of existing walls win over the grid, because
   * clicking near the end of a wall almost always means exactly there — which
   * is the difference between a dimension that reads 5.00 m and one that reads
   * 4.97 m for no reason anyone can see.
   */
  const snapDraftPoint = useCallback(
    (xWorld: number, zWorld: number) => {
      const cursor = { xMm: worldToMm(xWorld), zMm: worldToMm(zWorld) };
      const segments = useEditor.getState().scene.walls.segments.map((seg) => ({
        start: seg.start,
        end: seg.end,
      }));
      return findSnap(cursor, {
        gridMm: gridSizeMm,
        segments,
        anchor: drawDraft[drawDraft.length - 1] ?? null,
        enableGrid: snapToGrid,
      }).point;
    },
    [gridSizeMm, snapToGrid, drawDraft]
  );

  const onPointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (wallDrawing) {
        setWallHover(toPlanPoint(event.point.x, event.point.z));
        return;
      }
      if (tool === 'draw') {
        setDrawHover(snapDraftPoint(event.point.x, event.point.z));
        return;
      }
      if (tool === 'constraint') {
        setConstraintHover(snapDraftPoint(event.point.x, event.point.z));
        return;
      }
      /*
       * Track where an armed item would land, so the ghost follows the cursor.
       * Snapped here rather than in the ghost, so what is previewed is exactly
       * what the click will commit.
       */
      if (pendingItem) {
        let x = worldToMm(event.point.x);
        let z = worldToMm(event.point.z);
        if (snapToGrid && gridSizeMm > 0) {
          x = Math.round(x / gridSizeMm) * gridSizeMm;
          z = Math.round(z / gridSizeMm) * gridSizeMm;
        }
        setPlaceHover({ xMm: x, zMm: z });
        // On-demand rendering: without this the ghost would only redraw when
        // something else happened to ask for a frame, so it would lag or stick.
        invalidate();
      }
    },
    [
      wallDrawing, setWallHover, toPlanPoint, tool, setDrawHover, snapDraftPoint,
      setConstraintHover, pendingItem, setPlaceHover, snapToGrid, gridSizeMm,
    ]
  );

  const onClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();

      // The pointerup ending a box-select drag looks like a click to
      // three.js — same mesh under both pointerdown and pointerup — but the
      // selection it just made is not this handler's to undo.
      if (boxSelectJustResolved) {
        boxSelectJustResolved = false;
        return;
      }

      if (tool === 'constraint') {
        const point = snapDraftPoint(event.point.x, event.point.z);
        // Clicking the first point again closes an area, as it closes a room.
        const first = constraintDraft[0];
        if (first && constraintDraft.length >= 3) {
          const near = Math.hypot(point.xMm - first.xMm, point.zMm - first.zMm) < 500;
          if (near) {
            finishConstraint();
            return;
          }
        }
        addConstraintPoint(point);
        return;
      }

      if (tool === 'draw') {
        const point = snapDraftPoint(event.point.x, event.point.z);
        // Clicking the first point again closes a zone, as it closes a room.
        const first = drawDraft[0];
        if (first && drawDraft.length >= 3 && DRAW_KIND_INFO[drawKind].closes) {
          const near = Math.hypot(point.xMm - first.xMm, point.zMm - first.zMm) < 400;
          if (near) {
            finishDrawing();
            return;
          }
        }
        addDrawPoint(point);
        return;
      }

      if (wallDrawing) {
        const point = toPlanPoint(event.point.x, event.point.z);
        // Clicking the first point again closes the loop.
        const first = wallDraft[0];
        if (first && wallDraft.length >= 3) {
          const closeEnough = Math.hypot(point.xMm - first.xMm, point.zMm - first.zMm) < 400;
          if (closeEnough) {
            finishWallRun(true);
            return;
          }
        }
        addWallPoint(point);
        return;
      }

      if (!pendingItem) {
        clearSelection();
        selectWall(null);
        return;
      }

      let x = worldToMm(event.point.x);
      let z = worldToMm(event.point.z);

      /*
       * Doors and windows are openings, not props: they belong to a wall
       * segment at an offset along it, so the wall can be split around them and
       * they follow if that wall is later edited. Dropping one away from any
       * wall is a no-op rather than leaving a door standing in open air.
       */
      if (pendingItem.categorySlug === 'doors-windows') {
        const hit = nearestSegment(wallSegments, { xMm: x, zMm: z }, 2000);
        if (!hit) {
          setPendingItem(null);
          return;
        }
        const isWindow = /window/i.test(pendingItem.name);
        const width = pendingItem.widthMm ?? 915;
        const height = pendingItem.heightMm ?? 2032;
        // Keep the opening fully inside the wall it belongs to.
        const length = Math.hypot(
          hit.segment.end.xMm - hit.segment.start.xMm,
          hit.segment.end.zMm - hit.segment.start.zMm
        );
        const along = Math.min(Math.max(hit.alongMm, width / 2), Math.max(width / 2, length - width / 2));
        const angle = segmentAngleDeg(hit.segment.start, hit.segment.end);
        const centre = {
          x: hit.segment.start.xMm + ((hit.segment.end.xMm - hit.segment.start.xMm) * along) / (length || 1),
          z: hit.segment.start.zMm + ((hit.segment.end.zMm - hit.segment.start.zMm) * along) / (length || 1),
        };
        const opening: OpeningSceneObject = {
          id: crypto.randomUUID(),
          type: 'opening',
          name: pendingItem.name,
          catalogItemId: pendingItem.id,
          openingKind: isWindow ? 'window' : 'door',
          wallSegmentId: hit.segment.id,
          offsetAlongMm: Math.round(along),
          widthMm: width,
          heightMm: Math.min(height, hit.segment.heightMm),
          // A window sits on a sill; a door starts at the floor.
          bottomMm: isWindow ? Math.min(900, Math.max(0, hit.segment.heightMm - height - 100)) : 0,
          positionMm: { x: Math.round(centre.x), y: 0, z: Math.round(centre.z) },
          rotationDeg: { x: 0, y: -angle, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        };
        addObjects([opening]);
        setPendingItem(null);
        return;
      }

      if (snapToGrid && gridSizeMm > 0) {
        x = Math.round(x / gridSizeMm) * gridSizeMm;
        z = Math.round(z / gridSizeMm) * gridSizeMm;
      }
      const object: CatalogSceneObject = {
        id: crypto.randomUUID(),
        type: 'catalog',
        name: pendingItem.name,
        catalogItemId: pendingItem.id,
        modelUrl: pendingItem.modelUrl,
        dimensionsMm: {
          width: pendingItem.widthMm ?? 600,
          depth: pendingItem.depthMm ?? 600,
          height: pendingItem.heightMm ?? 600,
        },
        // Cached so the seating chart can read the layout without a round
        // trip back to the catalogue.
        seatsDefault: pendingItem.seatsDefault ?? null,
        tableShape: pendingItem.tableShape ?? null,
        positionMm: { x, y: 0, z },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
      addObjects([object]);
      setPendingItem(null);
    },
    [
      wallDrawing, wallDraft, toPlanPoint, addWallPoint, finishWallRun,
      pendingItem, addObjects, setPendingItem, clearSelection, selectWall,
      snapToGrid, gridSizeMm, wallSegments,
      /*
       * The drafting state has to be listed here.
       *
       * Without it the callback closes over whatever `tool` was on first
       * render — `select` — and every drafting click is silently ignored. It
       * appeared to work now and then only because an unrelated dependency
       * happened to change and rebuild the closure, which is the worst kind of
       * bug to be on the receiving end of.
       */
      tool, drawKind, drawDraft, addDrawPoint, finishDrawing, snapDraftPoint,
      constraintDraft, constraintKind, addConstraintPoint, finishConstraint,
    ]
  );

  // Right-click ends an open run without closing it.
  const onContextMenu = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      if (!wallDrawing) return;
      event.stopPropagation();
      event.nativeEvent.preventDefault();
      finishWallRun(false);
    },
    [wallDrawing, finishWallRun]
  );

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={onClick}
        onPointerMove={onPointerMove}
        onContextMenu={onContextMenu}
      >
        <planeGeometry args={[400, 400]} />
        <shadowMaterial opacity={0.22} />
      </mesh>

      {/*
        The underside of the slab.

        The interactive ground is a `shadowMaterial`, which is transparent by
        design — it exists to catch shadows, not to be seen. That left the
        floor see-through from below, so a camera that dipped under it looked
        straight up into the room through the backs of everything, which reads
        as a rendering fault rather than a view.

        This is a second plane facing *down*, sitting a hair under the first.
        `BackSide` means it is invisible from above and costs nothing in the
        normal view; from beneath it is a solid floor. It never takes a
        raycast, so it cannot steal a placement click from the ground.
      */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} raycast={() => null}>
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial color="#aeb6c2" side={THREE.FrontSide} />
      </mesh>
    </>
  );
}


/**
 * The calibrated drawing, laid flat on the floor.
 *
 * Sized from its own pixel dimensions × the calibration, so what is traced over
 * it comes out at true scale. Dimmed and non-interactive by default so tracing
 * cannot accidentally select or move it.
 *
 * Split into a gate and a loader because `useLoader` cannot be called
 * conditionally and throws on an empty URL — mounting it with no plan set took
 * the whole canvas down.
 */
function FloorPlanPlane() {
  const plan = useEditor((s) => s.scene.floorPlan);
  if (!plan?.imageUrl) return null;
  return (
    <Suspense fallback={null}>
      <FloorPlanTexture
        url={plan.imageUrl}
        widthMm={plan.widthPx * plan.mmPerPixel}
        depthMm={plan.heightPx * plan.mmPerPixel}
        originMm={plan.originMm}
        rotationDeg={plan.rotationDeg}
        opacity={plan.opacity}
        locked={plan.locked}
      />
    </Suspense>
  );
}

function FloorPlanTexture({
  url, widthMm, depthMm, originMm, rotationDeg, opacity, locked,
}: {
  url: string;
  widthMm: number;
  depthMm: number;
  originMm: { x: number; y: number; z: number };
  rotationDeg: number;
  opacity: number;
  locked: boolean;
}) {
  const texture = useLoader(THREE.TextureLoader, url);
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, rotationDeg * DEG]}
      position={[mmToWorld(originMm.x), 0.002, mmToWorld(originMm.z)]}
      raycast={locked ? () => null : undefined}
    >
      <planeGeometry args={[mmToWorld(widthMm), mmToWorld(depthMm)]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} toneMapped={false} />
    </mesh>
  );
}

/* ── Transform gizmo bound to the current selection ────────────────────── */

function SelectionGizmo({ orbitRef }: { orbitRef: React.MutableRefObject<any> }) {
  const selectedIds = useEditor((s) => s.selectedIds);
  const objects = useEditor((s) => s.scene.objects);
  const transformMode = useEditor((s) => s.transformMode);
  const snapToGrid = useEditor((s) => s.snapToGrid);
  const gridSizeMm = useEditor((s) => s.scene.gridSizeMm);
  const rotationSnapDeg = useEditor((s) => s.scene.rotationSnapDeg);
  const updateObject = useEditor((s) => s.updateObject);
  const readOnly = useEditor((s) => s.readOnly);
  const { scene } = useThree();

  const target = selectedIds.length === 1 ? selectedIds[0] : null;
  const object = target ? objects.find((o) => o.id === target) : null;
  const node = target ? scene.getObjectByName(target) : null;

  if (!object || !node || readOnly || object.locked) return null;

  /*
   * Rotation is yaw only.
   *
   * Furniture in a room turns about the vertical axis and nothing else. Three
   * rings let someone tip a banquet table onto its side by grabbing the wrong
   * one, and cluttered the object they were trying to look at. Objects that
   * genuinely tilt — artwork on a wall, a drape — are still edited numerically
   * in the properties panel.
   */
  const rotateOnly = transformMode === 'rotate';

  return (
    <>
      {rotateOnly ? <RotationReadout object={object} node={node} /> : null}
      <TransformControls
        object={node}
        mode={transformMode}
        size={rotateOnly ? 1.15 : 0.9}
        showX={!rotateOnly}
        showY
        showZ={!rotateOnly}
        translationSnap={snapToGrid ? mmToWorld(gridSizeMm) : null}
        rotationSnap={rotationSnapDeg ? rotationSnapDeg * DEG : null}
        onMouseDown={() => {
          if (orbitRef.current) orbitRef.current.enabled = false;
        }}
        onMouseUp={() => {
          if (orbitRef.current) orbitRef.current.enabled = true;
          /*
           * Write the gizmo's result back into the document in millimetres.
           *
           * Y is floored at zero: the grid is the ground, and nothing in a
           * real room is buried in the slab. Without this the move gizmo will
           * happily drag a table down through the floor, where it is both
           * invisible and still counted in the schedule.
           */
          updateObject(object.id, {
            positionMm: {
              x: worldToMm(node.position.x),
              y: Math.max(0, worldToMm(node.position.y)),
              z: worldToMm(node.position.z),
            },
            rotationDeg: {
              x: Math.round(node.rotation.x / DEG),
              y: Math.round(node.rotation.y / DEG),
              z: Math.round(node.rotation.z / DEG),
            },
            scale: { x: node.scale.x, y: node.scale.y, z: node.scale.z },
          } as Partial<SceneObject>);
        }}
      />
    </>
  );
}

/**
 * The live angle while rotating.
 *
 * A rotation ring with no number on it is a guess. This shows the yaw as it
 * turns, and the snap increment it is landing on, so someone squaring a top
 * table to a wall can see when they have got there.
 */
function RotationReadout({ object, node }: { object: SceneObject; node: THREE.Object3D }) {
  const rotationSnapDeg = useEditor((s) => s.scene.rotationSnapDeg);
  const [angle, setAngle] = useState(Math.round(object.rotationDeg.y));

  // Read from the node rather than the document: during a drag the gizmo has
  // moved the node but nothing has been committed yet.
  useFrame(() => {
    const next = Math.round(((node.rotation.y / DEG) % 360 + 360) % 360);
    setAngle((current) => (current === next ? current : next));
  });

  return (
    <Html
      position={[node.position.x, node.position.y + 0.9, node.position.z]}
      center
      style={{ pointerEvents: 'none' }}
      zIndexRange={[35, 0]}
    >
      <div className="whitespace-nowrap rounded-full border border-line bg-surface-strong/95 px-2.5 py-1 text-xs font-semibold tabular-nums text-ink shadow-lg backdrop-blur">
        {angle}°
        {rotationSnapDeg ? (
          <span className="ml-1.5 font-normal text-ink-subtle">snap {rotationSnapDeg}°</span>
        ) : null}
      </div>
    </Html>
  );
}

/* ── Camera rig ────────────────────────────────────────────────────────── */

/**
 * Keeping the frame loop alive while something is happening.
 *
 * The viewport runs on demand rather than continuously — see the note on
 * `<Canvas>` — which means a frame is drawn only when react-three-fiber is told
 * one is needed. React state changes do that on their own, and drei's controls
 * do it while they are being used. Three things do not:
 *
 *  · **Damping.** OrbitControls keeps easing for a beat after the mouse stops,
 *    and those frames have to be asked for or the camera stops mid-glide.
 *  · **Hover and cursor sharing.** Moving the pointer over the canvas changes
 *    what is under it, and a collaborator's cursor is reported from the frame
 *    loop.
 *  · **Gizmo drags.** The transform controls move a node directly; nothing in
 *    React knows about it until the drag commits.
 *
 * So any pointer activity opens a short window during which frames keep being
 * requested. A second is long enough to cover damping and short enough that an
 * idle editor really does go quiet.
 */
function FrameKeepAlive() {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const canvas = gl.domElement;
    let until = 0;
    let raf = 0;

    const pump = () => {
      if (performance.now() > until) {
        raf = 0;
        return;
      }
      invalidate();
      raf = requestAnimationFrame(pump);
    };

    const wake = () => {
      until = performance.now() + 1000;
      if (!raf) raf = requestAnimationFrame(pump);
    };

    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'wheel'] as const) {
      canvas.addEventListener(type, wake, { passive: true });
    }
    // A resize changes the projection and must repaint even with no input.
    window.addEventListener('resize', wake);

    return () => {
      for (const type of ['pointermove', 'pointerdown', 'pointerup', 'wheel'] as const) {
        canvas.removeEventListener(type, wake);
      }
      window.removeEventListener('resize', wake);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [gl]);

  return null;
}

/**
 * Expose a one-shot render + the canvas so exports can read a live frame.
 * `preserveDrawingBuffer` would cost memory on every frame; this costs nothing
 * until someone actually exports.
 */
function CaptureBridge() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    registerCapture({
      canvas: gl.domElement,
      render: () => gl.render(scene, camera),
      // Asked of the context rather than assumed from the Canvas props, so
      // that turning the flag off would slow captures down rather than
      // silently start capturing blank images.
      preserved: gl.getContext().getContextAttributes()?.preserveDrawingBuffer === true,
    });
    /*
     * The same three objects, published separately for picking. A drag from a
     * side panel arrives as a DOM event that never reaches react-three-fiber's
     * own pointer system, so the drop layer raycasts against the live scene
     * itself — and that needs the renderer, the graph and the camera.
     */
    registerPicking({ gl, scene, camera });
    return () => {
      registerCapture(null);
      registerPicking(null);
    };
  }, [gl, scene, camera]);

  return null;
}

/**
 * Flying to a saved view.
 *
 * Eased rather than cut, and over eight hundred milliseconds — long enough for
 * the eye to keep track of which way the room turned, short enough not to feel
 * like waiting. A hard cut between two vantage points in a space somebody does
 * not know is disorienting: they arrive not knowing whether they moved or the
 * building did.
 *
 * OrbitControls owns the camera, so its target is animated too and `update()`
 * is called each frame — setting the camera position alone would be undone on
 * the next frame by the controls' own bookkeeping.
 */
function ViewFlight({ orbitRef }: { orbitRef: React.MutableRefObject<any> }) {
  const request = useEditor((s) => s.viewRequest);
  const { camera } = useThree();
  const flight = useRef<{
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    fromFov: number;
    toFov: number;
    start: number;
  } | null>(null);

  useEffect(() => {
    if (!request) return;
    const controls = orbitRef.current;
    const view = request.view;

    flight.current = {
      from: camera.position.clone(),
      to: new THREE.Vector3(
        mmToWorld(view.positionMm.x),
        mmToWorld(view.positionMm.y),
        mmToWorld(view.positionMm.z)
      ),
      fromTarget: controls?.target?.clone() ?? new THREE.Vector3(),
      toTarget: new THREE.Vector3(
        mmToWorld(view.targetMm.x),
        mmToWorld(view.targetMm.y),
        mmToWorld(view.targetMm.z)
      ),
      fromFov: (camera as THREE.PerspectiveCamera).fov ?? 50,
      toFov: view.fov || 50,
      start: performance.now(),
    };
    invalidate();
  }, [request, camera, orbitRef]);

  useFrame(() => {
    const move = flight.current;
    if (!move) return;

    const DURATION = 800;
    const t = Math.min(1, (performance.now() - move.start) / DURATION);
    // Ease in and out: the arrival matters more than the departure.
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    camera.position.lerpVectors(move.from, move.to, eased);
    const controls = orbitRef.current;
    if (controls?.target) {
      controls.target.lerpVectors(move.fromTarget, move.toTarget, eased);
      controls.update();
    }
    const perspective = camera as THREE.PerspectiveCamera;
    if (perspective.isPerspectiveCamera) {
      perspective.fov = move.fromFov + (move.toFov - move.fromFov) * eased;
      perspective.updateProjectionMatrix();
    }

    if (t >= 1) flight.current = null;
    else invalidate();
  });

  return null;
}

/**
 * Read the camera where it is now, so a view can be saved from it.
 *
 * Published rather than lifted into React state: the camera moves every frame
 * while somebody is orbiting, and mirroring that into the store would re-render
 * the entire editor sixty times a second to serve one button.
 */
let readCamera: (() => { positionMm: Vec3; targetMm: Vec3; fov: number } | null) | null = null;

export function currentCamera() {
  return readCamera ? readCamera() : null;
}

function CameraReader({ orbitRef }: { orbitRef: React.MutableRefObject<any> }) {
  const { camera, scene, invalidate: invalidateFrame } = useThree();

  /*
   * The live scene, reachable from the browser console in development.
   *
   * Geometry correctness is the one thing a screenshot cannot settle: a curved
   * LED wall and a broken one look similar at a glance, and the question is
   * whether the cabinets actually sit on the arc and whether the content mesh
   * follows them. Reading the built world positions answers that directly.
   *
   * react-three-fiber stopped exposing its root on the canvas element, so this
   * is the supported way in. Development only.
   */
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return;
    (window as unknown as { __NOVIRA_THREE__?: unknown }).__NOVIRA_THREE__ = {
      scene,
      camera,
      controls: orbitRef,
      invalidate: invalidateFrame,
    };
  }, [scene, camera, orbitRef, invalidateFrame]);

  useEffect(() => {
    readCamera = () => {
      const target = orbitRef.current?.target ?? new THREE.Vector3();
      return {
        positionMm: {
          x: Math.round(worldToMm(camera.position.x)),
          y: Math.round(worldToMm(camera.position.y)),
          z: Math.round(worldToMm(camera.position.z)),
        },
        targetMm: {
          x: Math.round(worldToMm(target.x)),
          y: Math.round(worldToMm(target.y)),
          z: Math.round(worldToMm(target.z)),
        },
        fov: Math.round((camera as THREE.PerspectiveCamera).fov ?? 50),
      };
    };

    /*
     * A camera the screenshot scripts can aim.
     *
     * Whether a length of truss reads as truss is a judgement about its ends
     * and its joints, and making it means rendering the corner large and
     * looking at it. Playwright can drive the orbit controls by dragging, but
     * not to a repeatable position — and a comparison shot is worthless if the
     * two frames are not from the same place. This is the smallest hook that
     * makes those renders reproducible; it reads and writes nothing the
     * interface does not already expose through Saved views.
     */
    const w = window as unknown as {
      __noviraSetCamera?: (position: [number, number, number], target: [number, number, number]) => void;
    };
    w.__noviraSetCamera = (position, target) => {
      camera.position.set(position[0], position[1], position[2]);
      const controls = orbitRef.current;
      if (controls) {
        controls.target.set(target[0], target[1], target[2]);
        controls.update();
      } else {
        camera.lookAt(target[0], target[1], target[2]);
      }
      invalidate();
    };

    return () => {
      readCamera = null;
      delete w.__noviraSetCamera;
    };
  }, [camera, orbitRef]);

  return null;
}

function CameraRig({ orbitRef }: { orbitRef: React.MutableRefObject<any> }) {
  const cameraMode = useEditor((s) => s.cameraMode);
  const { camera } = useThree();

  useEffect(() => {
    if (cameraMode === 'top') {
      camera.position.set(0, 26, 0.001);
      camera.lookAt(0, 0, 0);
    } else {
      camera.position.set(10, 8, 10);
      camera.lookAt(0, 0, 0);
    }
    orbitRef.current?.target.set(0, 0, 0);
    orbitRef.current?.update();
  }, [cameraMode, camera, orbitRef]);

  return null;
}

/**
 * Resume wherever this plan's camera was left, instead of the generic
 * three-quarter framing `CameraRig` gives a mode toggle.
 *
 * Keyed on `planId` rather than on the scene itself — the scene changes
 * constantly as the plan is edited, and re-applying a stored camera position
 * on every edit would fight the person currently dragging it. Opening a
 * *different* plan is the one moment this should act, so a plan actually
 * remembers where it was left rather than always opening on the same
 * catalogue-default view.
 */
function CameraRestore({ orbitRef }: { orbitRef: React.MutableRefObject<any> }) {
  const { camera } = useThree();
  const planId = useEditor((s) => s.planId);
  const appliedFor = useRef<number | null>(null);

  useEffect(() => {
    if (planId == null || appliedFor.current === planId) return;
    appliedFor.current = planId;

    const cam = useEditor.getState().scene.camera;
    camera.position.set(mmToWorld(cam.positionMm.x), mmToWorld(cam.positionMm.y), mmToWorld(cam.positionMm.z));
    const controls = orbitRef.current;
    const targetWorld = new THREE.Vector3(
      mmToWorld(cam.targetMm.x),
      mmToWorld(cam.targetMm.y),
      mmToWorld(cam.targetMm.z)
    );
    if (controls) {
      controls.target.copy(targetWorld);
      controls.update();
    } else {
      camera.lookAt(targetWorld);
    }
    const perspective = camera as THREE.PerspectiveCamera;
    if (perspective.isPerspectiveCamera) {
      perspective.fov = cam.fov || 50;
      perspective.updateProjectionMatrix();
    }
    invalidate();
  }, [planId, camera, orbitRef]);

  return null;
}

/*
 * -- Trackpad and wheel navigation ---------------------------------------
 *
 * The gesture layer that makes this viewport usable without a three-button
 * mouse, which is what most people are actually holding.
 *
 * The browser hands us exactly one event for all of it, `wheel`, and the job
 * is telling three very different physical gestures apart inside it:
 *
 *  - **Pinch on a trackpad.** Browsers report this as a wheel event with
 *    `ctrlKey` forced true, a convention IE10 started and Chrome and Firefox
 *    both adopted. It is indistinguishable from a real Ctrl+wheel by design,
 *    which is fine here because we want both to mean the same thing: zoom.
 *  - **Two-finger scroll on a trackpad.** A plain wheel event, but with small
 *    fractional deltas arriving in a dense stream and, crucially, a non-zero
 *    `deltaX` whenever the fingers drift sideways. This is the gesture that
 *    had no meaning in the old scheme, and giving it "pan" is what removes
 *    the middle-mouse-button requirement.
 *  - **A real mouse wheel.** Large, discrete, quantised deltas (100, 120,
 *    150) with `deltaX` always exactly zero, or `deltaMode` reporting lines
 *    rather than pixels. A mouse has no pan gesture to offer, so for a wheel
 *    the only sensible meaning is zoom.
 *
 * The delta magnitudes genuinely do vary across browser, OS and hardware, so
 * the classifier does not lean on any single threshold: a horizontal
 * component or a fractional delta each prove a trackpad on their own, and
 * once proven we remember it for the rest of the session. A device that
 * never produces either is treated as a wheel, which is the safe default:
 * the worst case is that scrolling zooms, which is what a wheel user expects
 * anyway.
 */

/** Above this, with no fractional part and no deltaX, it is a mouse wheel. */
const WHEEL_DELTA_FLOOR = 45;
/** Trackpad pans track the fingers one to one. */
const TRACKPAD_PAN_SCALE = 1.0;
/** Pinch deltas are small, so they need a larger multiplier than a wheel. */
const PINCH_ZOOM_SCALE = 0.011;
const WHEEL_ZOOM_SCALE = 0.0016;

/**
 * Pan and zoom the camera from trackpad gestures, with no modifier keys.
 *
 * OrbitControls own wheel handling only ever dollies, so it is switched off
 * (`enableZoom={false}`) and replaced wholesale here. That way one place
 * decides what a given gesture means, rather than two handlers racing over
 * the same event.
 *
 * Both operations are written against the controls target as well as the
 * camera, because that target is what every other part of the viewport
 * orbits and frames around. Moving the camera without moving the target is
 * what makes a view slowly start rotating about a point behind you.
 */
/*
 * The floor is solid.
 *
 * In a real room you cannot get your eye under the ground, you cannot see the
 * underside of the slab, and you cannot put a chair inside it. The viewport
 * should behave the same way, and three separate routes were letting it break:
 * orbiting is limited by `maxPolarAngle`, but *panning* moves the camera and
 * its target together and *flying* moves the camera outright, so both could
 * end up below zero — at which point the room is seen from underneath through
 * the back of the floor, which reads as a rendering fault rather than a view.
 *
 * Clamping every frame rather than per gesture is deliberate: it is one rule
 * in one place that holds no matter which input moved the camera, including
 * ones added later.
 */
const EYE_FLOOR_M = 0.05;
/** The orbit target may sit on the floor but never beneath it. */
const TARGET_FLOOR_M = 0;

function GroundClamp({ orbitRef }: { orbitRef: React.MutableRefObject<any> }) {
  const { camera } = useThree();

  useFrame(() => {
    let corrected = false;

    if (camera.position.y < EYE_FLOOR_M) {
      camera.position.y = EYE_FLOOR_M;
      corrected = true;
    }

    const controls = orbitRef.current;
    if (controls?.target && controls.target.y < TARGET_FLOOR_M) {
      controls.target.y = TARGET_FLOOR_M;
      corrected = true;
    }

    if (corrected) {
      // `update()` re-derives the spherical coordinates from the corrected
      // positions; without it the controls keep their own stale idea of where
      // the camera is and snap it back below ground on the next input.
      controls?.update?.();
      invalidate();
    }
  });

  return null;
}

function TrackpadNavigation({ orbitRef }: { orbitRef: React.MutableRefObject<any> }) {
  const { camera, gl, size } = useThree();
  // Once a device proves it is a trackpad it stays one: a slow, careful
  // two-finger drag can produce a stream of whole-number deltas that would
  // otherwise be misread as a wheel halfway through the gesture.
  const isTrackpad = useRef(false);

  useEffect(() => {
    const dom = gl.domElement;

    /*
     * Record where a gesture left the camera, so the view survives a reload.
     *
     * Debounced, because a pan fires on every wheel event and each commit
     * walks the scene draft: writing the pose sixty times a second turns a
     * smooth two-finger drag into a stutter. A quarter second after the
     * fingers stop is soon enough for something only read on load.
     */
    let poseTimer = 0;
    const rememberPose = () => {
      window.clearTimeout(poseTimer);
      poseTimer = window.setTimeout(() => {
        const cam = currentCamera();
        if (cam) useEditor.getState().setCameraPose(cam);
      }, 250);
    };

    /**
     * Move the camera along its own screen plane, so dragging two fingers
     * down moves the view down no matter what angle the camera sits at. The
     * distance is scaled by how far away the target is, so a pan covers the
     * same amount of *screen* whether you are inspecting a chair or looking
     * at the whole hall.
     */
    const panBy = (dx: number, dy: number) => {
      const controls = orbitRef.current;
      if (!controls) return;
      const offset = camera.position.clone().sub(controls.target);
      const distance = offset.length();
      // Matches OrbitControls own pan maths: the visible height at the
      // target distance, divided by the viewport height, is the world
      // distance that one pixel represents.
      const fov = ((camera as THREE.PerspectiveCamera).fov ?? 50) * DEG;
      const perPixel = (2 * distance * Math.tan(fov / 2)) / size.height;

      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      const move = right.multiplyScalar(-dx * perPixel).add(up.multiplyScalar(dy * perPixel));

      camera.position.add(move);
      controls.target.add(move);
      controls.update();
      invalidate();
      rememberPose();
    };

    /**
     * Dolly the camera toward or away from the point under the cursor.
     *
     * Zooming at the middle of the screen turns every approach to a corner
     * of the plan into zoom, pan, zoom, pan. Zooming at the cursor means you
     * point at a thing and arrive at it, which is the single biggest
     * difference between a viewport that feels accurate and one that feels
     * like wrestling.
     */
    const zoomToward = (clientX: number, clientY: number, amount: number) => {
      const controls = orbitRef.current;
      if (!controls) return;
      const scale = Math.exp(amount);

      const offset = camera.position.clone().sub(controls.target);
      const distance = offset.length();
      const next = THREE.MathUtils.clamp(
        distance * scale,
        controls.minDistance ?? 0.4,
        controls.maxDistance ?? 400
      );
      // At the stops, dollying does nothing, but the cursor pull below would
      // still slide the view, which reads as drift. Stop entirely.
      if (Math.abs(next - distance) < 1e-6) return;

      camera.position.copy(controls.target).add(offset.multiplyScalar(next / distance));

      /*
       * Pull the target toward the cursor by the fraction we just closed.
       * Zooming ten per cent of the way in moves the target ten per cent of
       * the way toward whatever is under the pointer, so the thing you are
       * pointing at converges on the centre as you arrive. This is the
       * behaviour OrbitControls own `zoomToCursor` produces, reimplemented
       * because this handler has taken the wheel over.
       */
      const closed = 1 - next / distance;
      if (Math.abs(closed) > 1e-6) {
        const rect = dom.getBoundingClientRect();
        const ndc = new THREE.Vector3(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1,
          0.5
        );
        const ray = ndc.unproject(camera).sub(camera.position).normalize();
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const along = ray.dot(forward);
        if (along > 0.01) {
          const hit = camera.position.clone().addScaledVector(ray, next / along);
          const shift = hit.sub(controls.target).multiplyScalar(closed);
          controls.target.add(shift);
          camera.position.add(shift);
        }
      }

      controls.update();
      invalidate();
      rememberPose();
    };

    const onWheel = (e: WheelEvent) => {
      const controls = orbitRef.current;
      if (!controls || !controls.enabled) return;
      // Flying owns the input while it is held.
      if (useEditor.getState().flying) return;
      e.preventDefault();

      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);

      // Evidence of a trackpad: sideways movement, or sub-pixel precision.
      if (absX > 0 || (e.deltaMode === 0 && absY > 0 && absY < WHEEL_DELTA_FLOOR)) {
        isTrackpad.current = true;
      }

      useEditor.getState().markCameraTouched();

      /*
       * Pinch, or Ctrl+wheel: the same event either way, and the same
       * meaning. Zoom toward the cursor so the point under the fingers is
       * the point that stays put, which is what makes a pinch feel like it
       * is grabbing the model rather than scaling the screen.
       */
      if (e.ctrlKey || e.metaKey) {
        zoomToward(e.clientX, e.clientY, e.deltaY * (isTrackpad.current ? PINCH_ZOOM_SCALE : WHEEL_ZOOM_SCALE));
        return;
      }

      /*
       * A plain wheel on a real mouse has nothing else it could mean, so it
       * zooms: the convention every 3D tool shares, and the first thing a
       * mouse user will try.
       */
      if (!isTrackpad.current) {
        zoomToward(e.clientX, e.clientY, e.deltaY * WHEEL_ZOOM_SCALE);
        return;
      }

      /*
       * Two-finger scroll on a trackpad: pan. Shift swaps it to zoom for
       * anyone carrying that reflex over from another tool, but nothing here
       * *requires* a modifier, which is the whole point of this handler.
       */
      if (e.shiftKey && absX === 0) {
        zoomToward(e.clientX, e.clientY, e.deltaY * PINCH_ZOOM_SCALE);
        return;
      }
      panBy(e.deltaX * TRACKPAD_PAN_SCALE, e.deltaY * TRACKPAD_PAN_SCALE);
    };

    /*
     * Safari reports pinches as its own proprietary gesture events instead
     * of Ctrl+wheel, so without these a Mac user in Safari has no zoom.
     * `scale` is cumulative across the gesture, hence the running previous
     * value rather than a per-event delta.
     */
    const gestureCentre = { x: 0, y: 0 };
    let lastScale = 1;
    const onGestureStart = (e: any) => {
      e.preventDefault();
      lastScale = 1;
      gestureCentre.x = e.clientX;
      gestureCentre.y = e.clientY;
    };
    const onGestureChange = (e: any) => {
      e.preventDefault();
      if (useEditor.getState().flying) return;
      const ratio = e.scale / (lastScale || 1);
      lastScale = e.scale;
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      zoomToward(gestureCentre.x, gestureCentre.y, -Math.log(ratio));
    };

    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('gesturestart', onGestureStart as EventListener);
    dom.addEventListener('gesturechange', onGestureChange as EventListener);
    return () => {
      window.clearTimeout(poseTimer);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('gesturestart', onGestureStart as EventListener);
      dom.removeEventListener('gesturechange', onGestureChange as EventListener);
    };
  }, [camera, gl, orbitRef, size.height]);

  return null;
}

const FLY_MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);

/**
 * Arrow keys drive the camera too, always.
 *
 * They are the one set of movement keys nothing else in this editor wants, so
 * unlike WASD they need no mode and no modifier — press one and the view
 * moves. That makes the viewport navigable the moment it is focused, with no
 * shortcut to learn, which is what someone reaching for the arrows expects.
 *
 * Left and right *orbit* rather than strafe, and up and down dolly rather than
 * fly, because that is what arrows do in every map and model viewer: they turn
 * the view around what you are looking at instead of walking you off the plan.
 */
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
/** Radians per second of orbit, and metres per second of dolly. */
const ARROW_ORBIT_SPEED = 1.15;
/** World up, shared so the frame loop allocates nothing. */
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const ARROW_DOLLY_SPEED = 0.55;
const FLY_LOOK_SPEED = 0.0025;
const FLY_SPEED = 6;
const FLY_BOOST = 2.4;

/**
 * Hold Shift and the right button to fly, the way Enscape, Twinmotion and
 * Unreal do it: the convention anyone who has ever looked around a rendered
 * building already knows.
 *
 * It sits behind Shift because the bare right-drag was reassigned to pan.
 * Panning is the move every user makes constantly and the one a trackpad has
 * no other way to reach; flying is the move an experienced user goes looking
 * for, and will find in the navigation hint.
 *
 * OrbitControls owns the camera the rest of the time, so the trick is not
 * fighting it: drei's wrapper only calls `controls.update()` — the thing that
 * would otherwise snap the camera straight back — while `controls.enabled` is
 * true, so disabling it for the duration of the hold is sufficient to drive
 * the camera directly. The pointerdown listener is registered in the capture
 * phase so it always disables the controls before their own native listener
 * on the same element can start a pan.
 */
function FlyNavigation({ orbitRef }: { orbitRef: React.MutableRefObject<any> }) {
  const { camera, gl } = useThree();
  const setFlying = useEditor((s) => s.setFlying);
  const pressed = useRef<Set<string>>(new Set());
  const active = useRef(false);
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));

  useEffect(() => {
    const dom = gl.domElement;

    const endFly = (pointerId?: number) => {
      if (!active.current) return;
      active.current = false;
      pressed.current.clear();
      setFlying(false);
      const controls = orbitRef.current;
      if (controls) {
        // Put the orbit target back out in front of wherever flying left the
        // camera, rather than leaving it wherever it last orbited around —
        // otherwise the next plain drag orbits around a stale, distant point.
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        controls.target.copy(camera.position).addScaledVector(forward, 6);
        controls.enabled = true;
        controls.update();
      }
      if (pointerId != null) {
        try {
          dom.releasePointerCapture(pointerId);
        } catch {
          /* already released */
        }
      }
      const cam = currentCamera();
      if (cam) useEditor.getState().setCameraPose(cam);
      invalidate();
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onPointerDown = (e: PointerEvent) => {
      // Shift+right-drag. A plain right-drag pans, because panning is the
      // move everybody needs and flying is the one experts go looking for.
      // Walk mode is the other way in, and needs no button at all.
      if (e.button !== 2 || !e.shiftKey) return;
      e.preventDefault();
      active.current = true;
      setFlying(true);
      useEditor.getState().markCameraTouched();
      const controls = orbitRef.current;
      if (controls) controls.enabled = false;
      euler.current.setFromQuaternion(camera.quaternion);
      dom.setPointerCapture(e.pointerId);
      invalidate();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 2) endFly(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!active.current) return;
      euler.current.y -= (e.movementX ?? 0) * FLY_LOOK_SPEED;
      euler.current.x -= (e.movementY ?? 0) * FLY_LOOK_SPEED;
      euler.current.x = THREE.MathUtils.clamp(euler.current.x, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
      camera.quaternion.setFromEuler(euler.current);
      invalidate();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // Never steal a keystroke meant for a text field.
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      // A modified key belongs to a shortcut, not to the camera.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const walking = useEditor.getState().walkMode;

      // Escape leaves walk mode, as it does in every modal navigation.
      if (e.code === 'Escape' && walking) {
        e.preventDefault();
        useEditor.getState().setWalkMode(false);
        pressed.current.clear();
        return;
      }

      /*
       * The camera keys are live while a right-drag is held *or* while walk
       * mode is on. Outside both, W A S D Q E belong to the transform
       * shortcuts they have always belonged to.
       */
      if ((active.current || walking) && FLY_MOVE_KEYS.has(e.code)) {
        e.preventDefault();
        pressed.current.add(e.code);
        // Kick the on-demand renderer, or the frame loop never starts.
        invalidate();
        return;
      }
      if ((active.current || walking) && (e.code === 'ShiftLeft' || e.code === 'ShiftRight')) {
        pressed.current.add(e.code);
        return;
      }

      // Arrows need no mode at all.
      if (ARROW_KEYS.has(e.code)) {
        e.preventDefault();
        pressed.current.add(e.code);
        invalidate();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => pressed.current.delete(e.code);
    const onBlur = () => endFly();

    // Capture phase: guarantees `controls.enabled = false` lands before
    // OrbitControls' own bubble-phase listener on the same element sees the
    // same right-click and starts its default pan.
    dom.addEventListener('pointerdown', onPointerDown, { capture: true });
    dom.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      dom.removeEventListener('pointerdown', onPointerDown, { capture: true });
      dom.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [camera, gl, orbitRef, setFlying]);

  useFrame((_, delta) => {
    if (!pressed.current.size) return;
    /*
     * Keep the frames coming while a key is held.
     *
     * The viewport renders on demand, and a held key fires exactly one
     * keydown — so without asking for the next frame here the camera moved a
     * single step and stopped, which looked like the key doing nothing at
     * all. Requesting a frame at the top of the loop, before any early
     * return, is what turns a held key into continuous motion.
     */
    invalidate();

    const walking = useEditor.getState().walkMode;
    const controls = orbitRef.current;
    const clamped = Math.min(delta, 0.1);
    const boost = pressed.current.has('ShiftLeft') || pressed.current.has('ShiftRight') ? FLY_BOOST : 1;
    let moved = false;

    /* ── W A S D Q E: walk the camera ──────────────────────────────── */
    if (active.current || walking) {
      const step = FLY_SPEED * boost * clamped;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const move = new THREE.Vector3();
      if (pressed.current.has('KeyW')) move.add(forward);
      if (pressed.current.has('KeyS')) move.sub(forward);
      if (pressed.current.has('KeyD')) move.add(right);
      if (pressed.current.has('KeyA')) move.sub(right);
      if (pressed.current.has('KeyE')) move.y += 1;
      if (pressed.current.has('KeyQ')) move.y -= 1;
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(step);
        camera.position.add(move);
        /*
         * Walking without a held button leaves OrbitControls in charge, and it
         * will drag the camera back to its own idea of where it should be on
         * the next update unless the target travels with it. Held-button
         * flying disables the controls instead, so this only applies to walk
         * mode.
         */
        if (walking && !active.current && controls) controls.target.add(move);
        moved = true;
      }
    }

    /* ── Arrows: orbit and dolly, no mode required ─────────────────── */
    if (controls) {
      const target = controls.target as THREE.Vector3;
      const offset = camera.position.clone().sub(target);
      let changed = false;

      const yaw = (pressed.current.has('ArrowLeft') ? 1 : 0) - (pressed.current.has('ArrowRight') ? 1 : 0);
      if (yaw !== 0) {
        // Turn around the target, which is what an arrow means in a viewer.
        offset.applyAxisAngle(UP_AXIS, yaw * ARROW_ORBIT_SPEED * boost * clamped);
        changed = true;
      }

      const dolly = (pressed.current.has('ArrowUp') ? 1 : 0) - (pressed.current.has('ArrowDown') ? 1 : 0);
      if (dolly !== 0) {
        // Proportional, so one press covers the same fraction of the distance
        // whether you are inspecting a chair or looking at the whole hall.
        const factor = Math.exp(-dolly * ARROW_DOLLY_SPEED * boost * clamped);
        const next = THREE.MathUtils.clamp(
          offset.length() * factor,
          controls.minDistance ?? 0.4,
          controls.maxDistance ?? 400
        );
        offset.setLength(next);
        changed = true;
      }

      if (changed) {
        camera.position.copy(target).add(offset);
        controls.update?.();
        moved = true;
      }
    }

    if (moved) invalidate();
  });

  return null;
}

/**
 * Publish where the selection is on screen, so the quick toolbar can sit
 * beside it instead of over it.
 *
 * The projected bounding box of the selected meshes, not the object's origin:
 * a toolbar placed at a table's centre is a toolbar in the middle of the
 * table. The box's top edge is what the toolbar hangs off, which is why it is
 * measured rather than guessed.
 *
 * Measured on a frame tick and only published when it has actually moved by a
 * pixel or two — this runs while somebody is orbiting, and pushing an
 * unchanged value into the store on every frame would re-render the whole
 * editor for nothing.
 */
function SelectionAnchor() {
  const { scene, camera, size } = useThree();
  const selectedIds = useEditorShallow((s) => s.selectedIds);
  const setSelectionAnchor = useEditor((s) => s.setSelectionAnchor);
  const last = useRef<{ x: number; top: number; bottom: number } | null>(null);

  useEffect(() => {
    if (!selectedIds.length) {
      last.current = null;
      setSelectionAnchor(null);
    }
  }, [selectedIds, setSelectionAnchor]);

  useFrame(() => {
    if (!selectedIds.length) return;
    const wanted = new Set(selectedIds);

    const box = new THREE.Box3();
    scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      let owner: THREE.Object3D | null = node;
      while (owner && !owner.userData?.objectId) owner = owner.parent;
      if (!owner || !wanted.has(String(owner.userData.objectId))) return;
      box.expandByObject(node);
    });
    if (box.isEmpty()) return;

    // Project all eight corners: a box that is behind the camera on one
    // corner and in front on another has no single sensible screen point,
    // and taking only the centre would put the toolbar over tall objects.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i += 1) {
      corner.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z
      );
      corner.project(camera);
      if (corner.z > 1) return; // behind the camera — no honest position
      const sx = (corner.x * 0.5 + 0.5) * size.width;
      const sy = (-corner.y * 0.5 + 0.5) * size.height;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }

    const next = { x: Math.round((minX + maxX) / 2), top: Math.round(minY), bottom: Math.round(maxY) };
    const previous = last.current;
    if (
      previous &&
      Math.abs(previous.x - next.x) < 2 &&
      Math.abs(previous.top - next.top) < 2 &&
      Math.abs(previous.bottom - next.bottom) < 2
    ) {
      return;
    }
    last.current = next;
    setSelectionAnchor(next);
  });

  return null;
}

const BOX_SELECT_THRESHOLD_PX = 4;

/**
 * Hold Ctrl (or Cmd) and drag to select everything inside a rectangle —
 * add Shift too, and the enclosed objects join the current selection instead
 * of replacing it, the same rule a plain click already follows.
 *
 * Left-drag is already orbit, and unconditionally so — three's OrbitControls
 * does not raycast, it grabs any left-drag on the canvas regardless of what
 * is under the cursor. Gating this behind a modifier is what lets both
 * gestures live on the same button without one stealing the other: a plain
 * drag still orbits exactly as it always has, and only a modified one is
 * ever treated as a selection rectangle.
 *
 * Objects are tested by their own stored position projected to screen space,
 * not by a full bounding box — the same simplification Table Designer and
 * the seating chart already make, and enough for "drag a box over this
 * cluster of chairs" to work the way it looks like it should.
 */
function BoxSelect({ orbitRef }: { orbitRef: React.MutableRefObject<any> }) {
  const { camera, gl, size } = useThree();
  const setBoxSelectRect = useEditor((s) => s.setBoxSelectRect);
  const active = useRef(false);
  const dragged = useRef(false);
  const additive = useRef(false);
  const start = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const dom = gl.domElement;
    const toLocal = (e: PointerEvent) => {
      const rect = dom.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
      if (useEditor.getState().tool !== 'select') return;
      e.preventDefault();
      active.current = true;
      dragged.current = false;
      additive.current = e.shiftKey;
      start.current = toLocal(e);
      const controls = orbitRef.current;
      if (controls) controls.enabled = false;
      setBoxSelectRect({ x0: start.current.x, y0: start.current.y, x1: start.current.x, y1: start.current.y });
      dom.setPointerCapture(e.pointerId);
      invalidate();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!active.current) return;
      const p = toLocal(e);
      /*
       * Set the moment the drag is unambiguous, not at pointerup.
       *
       * The pointerup that ends this drag reaches react-three-fiber's own
       * click handling for whatever is under the cursor before it reaches
       * this file's own window-level listener — bubbling goes canvas first,
       * window last — so setting the flag in the pointerup handler is
       * already too late to suppress that click. Setting it here, on an
       * earlier and entirely separate pointermove event, sidesteps the
       * ordering question altogether.
       */
      if (
        !dragged.current &&
        (Math.abs(p.x - start.current.x) >= BOX_SELECT_THRESHOLD_PX ||
          Math.abs(p.y - start.current.y) >= BOX_SELECT_THRESHOLD_PX)
      ) {
        dragged.current = true;
        boxSelectJustResolved = true;
      }
      setBoxSelectRect({ x0: start.current.x, y0: start.current.y, x1: p.x, y1: p.y });
      invalidate();
    };

    const finish = (pointerId?: number) => {
      if (!active.current) return;
      active.current = false;
      const controls = orbitRef.current;
      if (controls) controls.enabled = true;
      if (pointerId != null) {
        try {
          dom.releasePointerCapture(pointerId);
        } catch {
          /* already released */
        }
      }
      setBoxSelectRect(null);
      invalidate();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!active.current) return;
      const wasDragged = dragged.current;
      const p = toLocal(e);
      const minX = Math.min(start.current.x, p.x);
      const maxX = Math.max(start.current.x, p.x);
      const minY = Math.min(start.current.y, p.y);
      const maxY = Math.max(start.current.y, p.y);
      const wasAdditive = additive.current;
      finish(e.pointerId);

      // Never moved past the threshold — the ground or object under the
      // cursor answers this as the plain click it was, deselecting or
      // toggling as it always has.
      if (!wasDragged) return;

      const state = useEditor.getState();
      const hits: string[] = [];
      const v = new THREE.Vector3();
      for (const object of state.scene.objects) {
        if (object.type === 'constraint' && !state.scene.showConstraints) continue;
        v.set(mmToWorld(object.positionMm.x), mmToWorld(object.positionMm.y), mmToWorld(object.positionMm.z));
        v.project(camera);
        // Behind the camera — three still projects a point, but it is not
        // actually on screen, and would otherwise land inside almost any box.
        if (v.z > 1) continue;
        const sx = (v.x * 0.5 + 0.5) * size.width;
        const sy = (-v.y * 0.5 + 0.5) * size.height;
        if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) hits.push(object.id);
      }

      if (hits.length) {
        state.select(wasAdditive ? [...new Set([...state.selectedIds, ...hits])] : hits);
      } else if (!wasAdditive) {
        state.clearSelection();
      }
    };

    const onBlur = () => finish();

    // Capture phase: guarantees `controls.enabled = false` lands before
    // OrbitControls' own bubble-phase listener on the same element sees the
    // same left-click and starts its default orbit.
    dom.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('blur', onBlur);
    return () => {
      dom.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [camera, gl, orbitRef, setBoxSelectRect, size]);

  return null;
}

/**
 * Installs the right-drag gesture and keeps the frame loop awake while it runs.
 *
 * The viewport renders on demand, and a drag driven by window-level pointer
 * events changes the scene outside React's knowledge — without the invalidate
 * the object would move in the document and not on screen until the next click.
 */
function FloorDragBridge({ orbitRef }: { orbitRef: React.MutableRefObject<any> }) {
  const { begin, dragging } = useFloorDrag(orbitRef);

  useEffect(() => {
    registerFloorDrag(begin);
    return () => registerFloorDrag(null);
  }, [begin]);

  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    const pump = () => {
      invalidate();
      raf = requestAnimationFrame(pump);
    };
    raf = requestAnimationFrame(pump);
    return () => cancelAnimationFrame(raf);
  }, [dragging]);

  return null;
}

/* ── Scene ─────────────────────────────────────────────────────────────── */

function SceneContents({ orbitRef }: { orbitRef: React.MutableRefObject<any> }) {
  // Shallow-compared: safe to derive an array here (see editor/selectors.ts).
  const objects = useVisibleObjects();
  const selectedIds = useEditor((s) => s.selectedIds);
  const showGrid = useEditor((s) => s.showGrid);
  const walls = useEditorShallow((s) => s.scene.walls.segments);
  const lighting = useEditor((s) => s.scene.lighting);
  const cameraMode = useEditor((s) => s.cameraMode);
  const showConstraints = useEditor((s) => s.scene.showConstraints);
  /*
   * On a machine with no working GPU, the shadow pass is what makes the editor
   * unusable rather than merely slow — a 26-object plan measured 2 fps with
   * shadows and 57 without. See `rendererProfile.ts`.
   */
  const profile = useRendererProfile();
  const shadowsWanted = lighting.shadowsEnabled && profile.shadowMapSize > 0;

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  /*
   * Fit the shadow camera to what is actually in the plan.
   *
   * It used to be a fixed 80 m square, which on a 1024 px map is thirteen
   * texels to the metre — a chair leg is a third of one, so its shadow was a
   * grey smudge or nothing at all, and every object read as floating. Sized
   * to the content instead, a single round table gets the whole map, and the
   * shadows are what tell you the chairs are standing on the floor.
   */
  const shadowExtent = useMemo(() => {
    let maxMm = 0;
    for (const object of objects) {
      const at = vec3(object.positionMm);
      maxMm = Math.max(maxMm, Math.abs(at.x), Math.abs(at.z));
    }
    for (const segment of walls) {
      for (const point of [segment?.start, segment?.end]) {
        if (!point) continue;
        maxMm = Math.max(maxMm, Math.abs(point.xMm ?? 0), Math.abs(point.zMm ?? 0));
      }
    }
    // A little past the furthest thing, never smaller than a small room and
    // never larger than the old fixed frustum.
    return THREE.MathUtils.clamp(mmToWorld(maxMm) * 1.35 + 4, 8, 40);
  }, [objects, walls]);

  return (
    <>
      <CameraRig orbitRef={orbitRef} />
      <CameraRestore orbitRef={orbitRef} />
      <CaptureBridge />
      <FrameKeepAlive />
      <FloorDragBridge orbitRef={orbitRef} />
      <ViewFlight orbitRef={orbitRef} />
      <CameraReader orbitRef={orbitRef} />

      {/*
       * Image-based lighting when the renderer can take it, with an analytic
       * rig underneath either way — see SceneEnvironment for why it is guarded.
       */}
      <SceneEnvironment
        preset={lighting.preset}
        customUrl={lighting.customHdriUrl ?? null}
        intensity={0.45 * (lighting.intensity ?? 1)}
        background={Boolean(lighting.showEnvironmentBackground)}
        rotationDeg={lighting.environmentRotationDeg ?? 0}
      />
      <ToneMapping />
      <StudioStage3D />
      {/*
        Ambient follows the chosen look. A concert look with the same ambient as
        a daylight one is not a concert look — the whole difference between them
        is how much of the room is *not* lit.
      */}
      {/*
        The analytic rig underneath the environment.
        
        Deliberately restrained now that tone mapping owns exposure and the
        environment map does most of the lifting: a soft sky/ground hemisphere
        for fill, one key with a real shadow, and a cool rim from behind so
        objects separate from the backdrop instead of dissolving into it. Piling
        on ambient is what makes a 3D view look flat and plastic.
      */}
      {/*
       * Rebalanced down, because the sum was the problem.
       *
       * Ambient 0.28 + hemisphere 0.5 + key 1.35 + fill 0.32 + an environment
       * map at 0.85 is over three times a full exposure. Every mid-tone
       * clipped to white, which is why a concrete floor rendered as paper and
       * why the shadows — which were being drawn correctly — had nothing left
       * to darken. The key still does the shaping; there is simply room below
       * white for it to shape into now.
       */}
      <ambientLight intensity={0.05} />
      <hemisphereLight args={['#eef3fb', '#aab2bf', 0.14]} />
      <directionalLight
        position={[lighting.position.x, lighting.heightZ, lighting.position.z]}
        intensity={0.95}
        castShadow={shadowsWanted}
        shadow-mapSize={[profile.shadowMapSize || 512, profile.shadowMapSize || 512]}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
        shadow-camera-far={120}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-9, 7, -7]} intensity={0.14} color="#dce8ff" />

      {showGrid ? (
        profile.software ? (
          /*
           * A plain line grid on a software renderer.
           *
           * drei's Grid is a shaded plane with a distance fade, which means a
           * full-screen fragment shader every frame. On a CPU rasteriser that
           * is one of the two most expensive things in the scene, and the
           * difference between it and line segments is invisible from a normal
           * working distance.
           *
           * It is deliberately short — 60 m rather than 120 — because a line
           * grid has no distance fade, so a large one draws hairlines all the
           * way to the horizon and streaks the backdrop. Ending it well inside
           * the studio is the closest a plain grid gets to fading out.
           */
          <gridHelper args={[60, 30, '#c9d2de', '#e3e8ef']} position={[0, 0.012, 0]} />
        ) : (
          /*
           * A drafting grid, not a wireframe.
           *
           * One metre cells with a five metre section line, both barely there,
           * and a fade that dissolves them well before the horizon — so the
           * grid tells you the scale of what is under the cursor and then gets
           * out of the way. It sits slightly above the floor so it reads as
           * marked on it rather than fighting it for the same pixels.
           */
          <Grid
            args={[120, 120]}
            position={[0, 0.012, 0]}
            cellSize={1}
            cellThickness={0.6}
            cellColor="#c6cfdb"
            sectionSize={5}
            sectionThickness={1.1}
            sectionColor="#a9b5c6"
            fadeDistance={58}
            fadeStrength={1.6}
            followCamera={false}
            infiniteGrid
          />
        )
      ) : null}

      <FinishedFloor />
      <Ground />
      <FloorPlanPlane />
      <Walls />
      <WallDrawPreview />
      <DraftPreview />
      <ConstraintDrawPreview />
      <WalkthroughCamera orbitRef={orbitRef} />
      <FlyNavigation orbitRef={orbitRef} />
      <BoxSelect orbitRef={orbitRef} />
      <TrackpadNavigation orbitRef={orbitRef} />
      <GroundClamp orbitRef={orbitRef} />
      <SelectionAnchor />

      {objects
        .filter((object) => showConstraints || object.type !== 'constraint')
        .map((object) => (
          // Boundary per object, not per scene: a single malformed or
          // unloadable object must not be able to unmount the Canvas and take
          // the whole plan with it. It disappears, and the rest still renders.
          <ModelBoundary key={object.id} fallback={null} label={object.id}>
            <SceneNode object={object} selected={selected.has(object.id)} />
          </ModelBoundary>
        ))}

      <FrameAll orbitRef={orbitRef} />
      <SelectionGizmo orbitRef={orbitRef} />
      <Collaborators />
      <DropPreview />

      <OrbitControls
        ref={orbitRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        /*
         * Pan on the screen plane rather than along the ground.
         *
         * Dragging up should move the view up, whatever angle the camera is
         * at. Ground-plane panning sends the view sliding away into the
         * distance the moment the camera is anywhere near level.
         */
        screenSpacePanning
        /*
         * The wheel belongs to `TrackpadNavigation`, which is the only place
         * that can tell a two-finger pan from a pinch from a mouse wheel.
         * Leaving this on would mean two handlers fighting over one event.
         */
        enableZoom={false}
        /*
         * Right-drag pans, so a plain two-button mouse can do everything
         * without a middle button or a keyboard. Fly moved to Shift+right,
         * which is the trade that buys it: panning is the move everybody
         * needs constantly, flying is the one experts reach for.
         */
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.PAN,
        }}
        /* One finger orbits, two pan and pinch: the phone convention. */
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        maxPolarAngle={cameraMode === 'top' ? 0.001 : Math.PI / 2.05}
        minDistance={0.4}
        maxDistance={400}
        onStart={() => useEditor.getState().markCameraTouched()}
        onEnd={() => {
          const cam = currentCamera();
          if (cam) useEditor.getState().setCameraPose(cam);
        }}
      />

      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#e5484d', '#30a46c', '#0072FD']} labelColor="#0b1220" />
      </GizmoHelper>
    </>
  );
}

/**
 * Mounts the in-viewport LED editor when a screen has been double-clicked.
 *
 * A gate rather than logic inside the panel: the panel takes a screen and
 * renders it, so it never has to reason about the object having been deleted
 * or deselected underneath it.
 */
function LedQuickEditor() {
  const id = useEditor((s) => s.ledQuickEditId);
  const setId = useEditor((s) => s.setLedQuickEditId);
  const screen = useEditor((s) =>
    id ? (s.scene.objects.find((o) => o.id === id && o.type === 'led') as LedScreenSceneObject | undefined) : undefined
  );

  // The screen can go away while its editor is open — deleted, or undone.
  useEffect(() => {
    if (id && !screen) setId(null);
  }, [id, screen, setId]);

  if (!screen) return null;
  return <LedQuickPanel screen={screen} onClose={() => setId(null)} />;
}

export function Viewport() {
  const orbitRef = useRef<any>(null);
  const pendingItem = useEditor((s) => s.pendingItem);
  const softwareRenderer = isSoftwareRenderer();
  // A walkthrough is animation: it needs every frame. Everything else does not.
  const playing = useEditor((s) => s.playing);

  return (
    <div className="relative h-full w-full bg-canvas [&>div>canvas]:!outline-none">
      {/*
        Outside the Canvas on purpose: a fixed pill at the top of the viewport
        rather than a bar that follows the selection around and covers what is
        behind it.
      */}
      <TransformRail />
      <SelectionToolbar />
      <LedQuickEditor />
      <Canvas
        /*
         * `shadows` and the pixel ratio are decided before react-three-fiber
         * exists, so the renderer is probed directly. On a software rasteriser
         * both are turned down: a device pixel ratio of 1.5 is 2.25× the
         * fragments for no visible gain when the frame already takes seconds.
         */
        shadows={!softwareRenderer}
        dpr={softwareRenderer ? 1 : [1, 1.5]}
        /*
         * On demand, not continuously.
         *
         * A plan is static almost all of the time — someone is reading it,
         * typing in a panel, or thinking. Redrawing an unchanged scene sixty
         * times a second buys nothing and costs everything on a machine without
         * a real GPU, where a single frame of a fifty-object plan takes most of
         * a second. Measured on a software rasteriser, this is the difference
         * between an editor at 0.4 frames per second where every click appears
         * to do nothing, and one that is idle until you touch it.
         *
         * React state changes request a frame on their own, and
         * `<FrameKeepAlive>` covers the three cases they do not. A walkthrough
         * is real animation, so it goes back to a continuous loop.
         */
        frameloop={playing ? 'always' : 'demand'}
        gl={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
        camera={{ fov: 50, near: 0.1, far: 800, position: [10, 8, 10] }}
      >
        <Suspense
          fallback={
            <Html center>
              <span className="text-sm text-ink-muted">Loading 3D scene…</span>
            </Html>
          }
        >
          <SceneContents orbitRef={orbitRef} />
        </Suspense>
      </Canvas>

      {pendingItem ? (
        <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
          <div className="pointer-events-auto rounded-full border border-primary/40 bg-primary/15 px-4 py-1.5 text-xs font-medium text-primary backdrop-blur">
            Click the floor to place <strong className="font-semibold">{pendingItem.name}</strong> — Esc to cancel
          </div>
        </div>
      ) : null}
      <NavHint />
      <BoxSelectOverlay />
    </div>
  );
}

/**
 * Where the navigation scheme lives for anyone who has not found it yet.
 *
 * Bottom-left: the gizmo compass already owns bottom-right, and the bottom
 * toolbar is a separate row below the canvas rather than an overlay on it, so
 * nothing here competes with either.
 */
/**
 * The navigation cheatsheet.
 *
 * Grouped by what the user is holding rather than by action, because that is
 * the question someone actually has: they know they want to pan, and they
 * need to know what *their* hardware does. A trackpad user reading a row
 * about the middle mouse button learns nothing.
 *
 * The trackpad column comes first deliberately. It is the device most people
 * are on, and it was the one the old scheme served worst: with pan on the
 * middle button and box-select behind Ctrl, a laptop user had no way to pan
 * at all.
 */
const NAV_GROUPS: Array<{ heading: string; rows: Array<[string, string]> }> = [
  {
    heading: 'Trackpad',
    rows: [
      ['Two fingers', 'Pan around'],
      ['Pinch', 'Zoom in and out'],
      ['Drag', 'Orbit'],
      ['Shift + two fingers', 'Zoom'],
    ],
  },
  {
    heading: 'Mouse',
    rows: [
      ['Left-drag', 'Orbit'],
      ['Right-drag', 'Pan around'],
      ['Scroll', 'Zoom to the cursor'],
      ['Shift + right-drag', 'Fly: WASD, Q/E, Shift boosts'],
    ],
  },
  {
    heading: 'Keyboard',
    rows: [
      ['Arrow keys', 'Turn and move in — no mode needed'],
      ['Walk button', 'W A S D to move, Q E down and up, Esc leaves'],
      ['Double-click', 'Go to that object'],
      ['F', 'Frame the selection'],
      ['Ctrl+A', 'Select everything'],
      ['Ctrl-drag', 'Box-select'],
      ['Numpad 7/1/3', 'Top, front, side'],
      ['Numpad 0', 'Frame everything'],
    ],
  },
];

/**
 * The navigation scheme, for anyone who has not found it yet.
 *
 * A chip rather than a sentence: the full map is three columns, which is a
 * wall of text to leave permanently over someone plan, and one line is not
 * enough to be worth reading. So it sits closed, says the two gestures that
 * cover almost everything, and opens on hover or click for the rest.
 *
 * It opens on **click** as well as hover because a hover-only disclosure is
 * invisible to touch, and a tablet user needs this more than anyone.
 *
 * Bottom-left, because the gizmo compass owns bottom-right and the bottom
 * toolbar is a row below the canvas rather than an overlay on it.
 */
function NavHint() {
  const flying = useEditor((s) => s.flying);
  const [open, setOpen] = useState(false);

  if (flying) {
    return (
      <div className="pointer-events-none absolute bottom-3 left-3">
        <div className="rounded-full border border-primary/40 bg-primary/15 px-2.5 py-1 text-[10px] font-medium text-primary backdrop-blur">
          Flying: WASD move, Q/E down and up, mouse look, Shift boost
        </div>
      </div>
    );
  }

  return (
    <div className="group absolute bottom-3 left-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded-full border border-line/70 bg-surface/70 px-2.5 py-1 text-[10px] font-medium text-ink-subtle backdrop-blur transition hover:border-line hover:text-ink-muted"
      >
        Two fingers to pan, pinch to zoom &middot;{' '}
        <span className="font-semibold">all the ways to move</span>
      </button>

      <div
        className={`absolute bottom-full left-0 mb-1.5 w-[520px] ${
          open ? 'block' : 'hidden group-hover:block'
        }`}
      >
        <div className="panel p-3 shadow-xl">
          <div className="grid grid-cols-3 gap-3">
            {NAV_GROUPS.map((group) => (
              <div key={group.heading}>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-subtle">
                  {group.heading}
                </p>
                <dl className="space-y-1">
                  {group.rows.map(([key, what]) => (
                    <div key={key}>
                      <dt className="text-[10px] font-semibold leading-tight text-ink">{key}</dt>
                      <dd className="text-[10px] leading-tight text-ink-subtle">{what}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The live drag rectangle for box-select — a 2D overlay, not a 3D one. */
function BoxSelectOverlay() {
  const rect = useEditor((s) => s.boxSelectRect);
  if (!rect) return null;
  const left = Math.min(rect.x0, rect.x1);
  const top = Math.min(rect.y0, rect.y1);
  const width = Math.abs(rect.x1 - rect.x0);
  const height = Math.abs(rect.y1 - rect.y0);
  return (
    <div
      className="pointer-events-none absolute border border-primary bg-primary/10"
      style={{ left, top, width, height }}
    />
  );
}

/**
 * Other people in this plan.
 *
 * Lives inside the Canvas so cursors are placed in the scene rather than on
 * the screen — two planners looking from opposite sides still see each other
 * pointing at the same chair.
 */
function Collaborators() {
  const planId = useEditor((s) => s.planId);
  const objects = useEditorShallow((s) => s.scene.objects);
  const selectedIds = useEditorShallow((s) => s.selectedIds);
  const scene = useEditor((s) => s.scene);

  const { peers, sendCursor, sendSelection, sendScene } = useCollaboration(planId);

  // Broadcast our own selection so others can see what we are holding.
  useEffect(() => {
    sendSelection(selectedIds);
  }, [selectedIds, sendSelection]);

  // And our edits. The hook debounces and skips anything applied remotely.
  useEffect(() => {
    sendScene(scene);
  }, [scene, sendScene]);

  // Report the pointer in plan space, throttled inside the hook.
  useFrame(({ pointer, raycaster, camera }) => {
    if (!peers.length) return;
    raycaster.setFromCamera(pointer, camera);
    const target = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(GROUND_PLANE, target);
    sendCursor(hit ? { xMm: target.x * 1000, zMm: target.z * 1000 } : null);
  });

  const positions = useMemo(() => {
    const map = new Map<string, { xMm: number; zMm: number }>();
    for (const object of objects) {
      if (!object.positionMm) continue;
      map.set(object.id, { xMm: object.positionMm.x, zMm: object.positionMm.z });
    }
    return map;
  }, [objects]);

  if (!peers.length) return null;

  return (
    <>
      <PeerCursors peers={peers} />
      <PeerSelections peers={peers} positions={positions} />
    </>
  );
}

/** The floor, for turning a pointer ray into a plan position. */
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/**
 * Pull the camera back to take in the whole plan.
 *
 * Adding a venue is the case that made this necessary: a generated ballroom
 * is twenty-odd metres across and arrives centred on the origin, so the
 * camera ends up inside a wall and it looks as though nothing happened.
 *
 * The bounds are measured from the rendered scene rather than the document,
 * so a model that turned out larger than its declared size is still framed
 * correctly.
 */
function FrameAll({ orbitRef }: { orbitRef: React.MutableRefObject<any> }) {
  const frameRequest = useEditor((s) => s.frameRequest);
  const { scene, camera } = useThree();
  const pending = useRef(0);

  useEffect(() => {
    pending.current = frameRequest;
  }, [frameRequest]);

  /*
   * Done on a frame tick rather than in an effect.
   *
   * OrbitControls keeps its own spherical position and writes it back to the
   * camera on every update, so moving the camera from an effect is undone on
   * the next frame — which is why the camera appeared not to move at all.
   * Setting the target first and then calling `update()` from inside the loop
   * makes the controls adopt the new position as their own.
   */
  useFrame(() => {
    if (!pending.current) return;
    const controls = orbitRef.current;
    if (!controls) return;
    pending.current = 0;

    const state = useEditor.getState();
    const wanted = state.frameMode === 'selection' ? new Set(state.selectedIds) : null;

    const box = new THREE.Box3();
    scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      // Only placed content: the ground grid and the gizmos would blow the
      // bounds out to something meaningless.
      let owner: THREE.Object3D | null = node;
      while (owner && !owner.userData?.objectId) owner = owner.parent;
      if (!owner) return;
      // Framing a selection measures only what is selected.
      if (wanted && !wanted.has(String(owner.userData.objectId))) return;
      box.expandByObject(node);
    });
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;

    const perspective = camera as THREE.PerspectiveCamera;
    const fov = ((perspective.fov ?? 50) * Math.PI) / 180;
    // A little past the exact fit, so the subject is not jammed to the edges.
    const distance = (radius / Math.sin(fov / 2)) * 1.4;

    /*
     * Framing everything picks the hero three-quarter angle; framing a
     * selection keeps the angle you are already looking from. Snapping the
     * view around every time somebody focuses a chair is disorienting — the
     * request was "get closer to this", not "show me this from somewhere
     * else".
     */
    const keepAngle = wanted && camera.position.distanceTo(controls.target) > 0.001;
    const direction = keepAngle
      ? camera.position.clone().sub(controls.target).normalize()
      : new THREE.Vector3(0.75, 0.6, 1).normalize();

    controls.target.copy(centre);
    camera.position.copy(centre.clone().add(direction.multiplyScalar(distance)));
    camera.updateProjectionMatrix();
    controls.update();
    // Remember where framing left the camera, like any other move.
    const cam = currentCamera();
    if (cam) useEditor.getState().setCameraPose(cam);
  });

  return null;
}
