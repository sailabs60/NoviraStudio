import { create } from 'zustand';
import {
  createEmptyScene,
  migrateScene,
  type CatalogItemDto,
  rebuildBlueprint,
  segmentsFromRun,
  type SceneDocument,
  type SceneObject,
  type TableGroup,
  type UnitSystem,
  type WallPoint,
  type WallSegment,
  DRAW_KIND_INFO,
  DEFAULT_DRAWING_STYLE,
  type DrawKind,
  type DrawingStyle,
  type DrawingSceneObject,
  type ConstraintKind,
  type SceneRenderSettings,
  type SceneWalkthrough,
  type CameraShot,
  type SurfaceFinish,
  type SavedView,
  type Vec3,
} from '@novira/shared';
import { createConstraint } from './factories';

/** Stable id for a new object. */
function newObjectId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type Tool = 'select' | 'box-select' | 'line' | 'shape' | 'wall' | 'draw' | 'constraint';

/**
 * The left rail's sections.
 *
 * Named for what a planner is doing rather than for what the code calls it —
 * "Site", not "constraints"; "Cost", not "takeoff" — because the rail is the
 * first thing a new user reads and it has to be legible without training.
 */
export type WorkPanel =
  | 'add'
  | 'build'
  | 'finish'
  /**
   * The AI section.
   *
   * A first-class part of the work rather than a button in the header. Making
   * a room, branding it and asking for changes are three parts of one job, and
   * scattering them across a header button, a floating assistant and a tab
   * inside it meant nobody found the second and third.
   */
  | 'ai'
  | 'site'
  | 'light'
  | 'cost'
  | 'check'
  | 'present'
  | 'review'
  /**
   * Everything that is not part of designing the room.
   *
   * Cost, Check and Review are all things you do *to* a finished plan rather
   * than steps in making one, and nine flat icons in a rail is more than
   * anyone scans. They live behind this.
   */
  | 'more'
  /**
   * Not a rail section any more.
   *
   * Properties live in the right-hand dock, which follows the selection on its
   * own. The value is kept so `focusObject` still has a way of saying "and show
   * me its properties" without every caller having to know where that panel
   * moved to.
   */
  | 'properties';
export type TransformMode = 'translate' | 'rotate' | 'scale';

/**
 * Undo/redo.
 *
 * History holds whole scene documents rather than diffs. Scenes are small
 * relative to available memory (a few hundred objects of plain JSON), and the
 * simplicity is worth far more here than the bytes: every mutation path gets
 * correct undo for free, including the generative ones that rewrite dozens of
 * objects at once.
 */
const HISTORY_LIMIT = 60;

interface EditorState {
  planId: number | null;
  title: string;
  units: UnitSystem;
  readOnly: boolean;

  scene: SceneDocument;
  past: SceneDocument[];
  future: SceneDocument[];

  selectedIds: string[];
  isolatedIds: string[];
  isolateMode: boolean;

  tool: Tool;
  transformMode: TransformMode;
  cameraMode: 'perspective' | 'top';
  snapToGrid: boolean;
  showGrid: boolean;

  /** Item chosen in the catalogue, awaiting a click in the viewport. */
  pendingItem: CatalogItemDto | null;

  /* -- The work panel ------------------------------------------------- */
  /** Which section of the left rail is open. */
  workPanel: WorkPanel;
  setWorkPanel: (panel: WorkPanel) => void;
  /** Select an object and open the panel that edits it. */
  focusObject: (id: string, panel?: WorkPanel) => void;

  /* -- Site constraints ----------------------------------------------- */
  constraintKind: ConstraintKind;
  constraintDraft: WallPoint[];
  constraintHover: WallPoint | null;
  setConstraintKind: (kind: ConstraintKind) => void;
  addConstraintPoint: (point: WallPoint) => void;
  setConstraintHover: (point: WallPoint | null) => void;
  finishConstraint: () => void;
  cancelConstraint: () => void;

  /* -- Presentation and document settings ----------------------------- */
  setRender: (patch: Partial<SceneRenderSettings>) => void;
  setWalkthrough: (patch: Partial<SceneWalkthrough>) => void;
  setShots: (shots: CameraShot[]) => void;
  setRegion: (regionCode: string) => void;
  setRateCard: (rateCardId: number | null) => void;
  toggleConstraintsVisible: () => void;
  toggleCollisionCheck: () => void;

  /** Walkthrough playback, driven by the viewport. */
  playing: boolean;
  playhead: number;
  setPlaying: (playing: boolean) => void;
  setPlayhead: (ms: number) => void;

  /** Objects a finding wants pointed at, cleared automatically. */
  highlightIds: string[];
  setHighlight: (ids: string[]) => void;

  dirty: boolean;
  saving: boolean;
  lastSavedAt: number | null;
  saveError: string | null;

  /** Catalogue rows for items present in the scene, so the canvas can render them. */
  itemCache: Record<number, CatalogItemDto>;

  load: (plan: { id: number; title: string; units: UnitSystem; scene: unknown; readOnly: boolean }) => void;
  cacheItems: (items: CatalogItemDto[]) => void;

  commit: (mutate: (draft: SceneDocument) => void) => void;
  /** Update the document without pushing an undo entry. */
  commitQuiet: (mutate: (draft: SceneDocument) => void) => void;
  replaceScene: (next: SceneDocument) => void;
  undo: () => void;
  redo: () => void;

  select: (ids: string[]) => void;
  toggleSelect: (id: string, additive: boolean) => void;
  clearSelection: () => void;

  /**
   * The live drag rectangle for box-select, in canvas CSS pixels.
   *
   * Read by an HTML overlay outside the Canvas — the rectangle is a 2D UI
   * element, not a 3D one — while the detection that turns it into a
   * selection runs inside the Canvas, where the camera lives. The store is
   * the simplest thing both sides already share.
   */
  boxSelectRect: { x0: number; y0: number; x1: number; y1: number } | null;
  setBoxSelectRect: (rect: { x0: number; y0: number; x1: number; y1: number } | null) => void;

  /**
   * Where the selection is on screen, in canvas pixels, so the quick toolbar
   * can sit beside it.
   *
   * `x` is the horizontal centre of the selection and `top`/`bottom` are the
   * edges of its projected bounding box — enough for the toolbar to place
   * itself clear of the object rather than over it, and to flip underneath
   * when there is no room above. Computed inside the Canvas, where the camera
   * is; consumed outside it, where the HTML is.
   */
  selectionAnchor: { x: number; top: number; bottom: number } | null;
  setSelectionAnchor: (anchor: { x: number; top: number; bottom: number } | null) => void;

  /**
   * The LED screen whose in-viewport editor is open, if any.
   *
   * Opened by double-clicking a screen. Held in the store rather than in the
   * viewport's own state because the panel is drawn outside the Canvas — the
   * 3D object knows it was double-clicked, and the HTML that has to appear is
   * a sibling of the Canvas, not a child.
   */
  ledQuickEditId: string | null;
  setLedQuickEditId: (id: string | null) => void;

  setTool: (tool: Tool) => void;
  setTransformMode: (mode: TransformMode) => void;
  setCameraMode: (mode: 'perspective' | 'top') => void;
  setCameraPose: (pose: { positionMm: Vec3; targetMm: Vec3; fov: number }) => void;
  /**
   * Bumped when something wants the camera pulled back to show everything.
   *
   * A counter rather than a boolean: two requests in a row must both fire,
   * and the viewport owns the camera so it cannot be moved from here.
   */
  /**
   * Which part of which object a clicked material should land on.
   *
   * Null means "the whole object", which is what a click has always meant and
   * what most drops mean. Set by choosing a row in the Finishes list, and
   * cleared whenever the selection changes — a target left pointing at an
   * object nobody has selected any more is how a click ends up painting
   * something off-screen.
   */
  finishTarget: { objectId: string; part: string } | null;
  setFinishTarget: (target: { objectId: string; part: string } | null) => void;

  frameRequest: number;
  /**
   * Has the designer moved the camera themselves since this plan opened?
   *
   * Used to decide whether an arriving venue may pull the view back to frame
   * the building. Taking the camera away from someone who has just positioned
   * it is worse than an awkward opening shot, so this is the veto.
   */
  cameraTouched: boolean;
  markCameraTouched: () => void;
  requestFrameAll: () => void;
  /**
   * Frame just what is selected, rather than the whole plan.
   *
   * The move people make constantly in every 3D tool — pick a thing, press a
   * key, arrive at it — and the one that makes a large plan navigable at all,
   * because framing everything from across a 40 m hall puts you back where
   * you started.
   */
  requestFrameSelection: () => void;
  frameMode: 'all' | 'selection';

  /**
   * Held-right-click fly navigation is active.
   *
   * While true, the keyboard map's single-letter shortcuts stand down — 's'
   * moving the camera backward must not also toggle snap — and WASD/QE are
   * read directly by the viewport instead.
   */
  flying: boolean;
  setFlying: (flying: boolean) => void;

  /**
   * Walk mode: W A S D Q E drive the camera on their own.
   *
   * Held-button flying is the convention every renderer uses, and it exists
   * because those six keys are not free — E is scale, S is snap, R is rotate.
   * Making them move the camera *all* the time would silently break the
   * transform shortcuts, so instead this is a mode: while it is on the camera
   * keys are the camera's and the conflicting shortcuts stand down; while it
   * is off nothing changes. Blender, Godot and Unreal all resolve it this way
   * rather than by asking the user to hold a modifier forever.
   *
   * Escape leaves, which is what every modal navigation does.
   */
  walkMode: boolean;
  setWalkMode: (walk: boolean) => void;
  toggleWalkMode: () => void;

  /* ── Saved views ──────────────────────────────────────────────────────
   * Named camera positions the designer keeps so a client can navigate the
   * scene without knowing how to orbit one. The request counter is how the
   * viewport is told to fly somewhere: the camera lives in three.js, not in
   * the document, so a plain state field would be applied once and then
   * ignored when the same view is picked twice.
   */
  viewRequest: { view: SavedView; at: number } | null;
  goToView: (view: SavedView) => void;
  addView: (view: Omit<SavedView, 'id' | 'createdAt'>) => void;
  renameView: (id: string, name: string) => void;
  removeView: (id: string) => void;
  moveView: (id: string, direction: -1 | 1) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  toggleIsolate: () => void;
  setPendingItem: (item: CatalogItemDto | null) => void;

  addObjects: (objects: SceneObject[]) => void;
  updateObject: (id: string, patch: Partial<SceneObject>) => void;
  updateObjects: (ids: string[], patch: Partial<SceneObject>) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  toggleLockSelected: () => void;

  /* ── Surface finishes ────────────────────────────────────────────────
   * A material is applied to one part of one object, or to `'*'` for all of
   * it. Undoable, because painting the wrong surface is the single most
   * common thing to want back.
   */
  applyFinish: (objectId: string, part: string, finish: SurfaceFinish) => void;
  clearFinish: (objectId: string, part: string) => void;
  clearAllFinishes: (objectId: string) => void;
  setFloorFinish: (finish: SurfaceFinish | null) => void;
  setEnvironmentHdri: (url: string | null, label?: string | null) => void;

  /** Replace a table group and all the objects it previously generated. */
  upsertTableGroup: (group: TableGroup, generated: SceneObject[]) => void;
  removeTableGroup: (groupId: string) => void;

  /* ── Walls ─────────────────────────────────────────────────────────── */
  /** Points placed so far in the run being drawn. */
  wallDraft: WallPoint[];
  /** Where the cursor currently is, for the rubber-band preview. */
  wallHover: WallPoint | null;
  wallDrawing: boolean;
  selectedWallId: string | null;
  selectedFloorId: string | null;
  /* ── Drafting ────────────────────────────────────────────────────── */
  /** Points placed so far in the annotation being drawn. */
  drawDraft: WallPoint[];
  drawHover: WallPoint | null;
  /**
   * Where an armed item would land, in mm, tracked as the cursor crosses the
   * floor. Click-to-place needs the same full-size ghost that drag-and-drop
   * gets: seeing a 2.4 m counter stand in the room before committing to it is
   * the whole difference between placing and guessing.
   */
  placeHover: { xMm: number; zMm: number } | null;
  drawKind: DrawKind;
  drawStyle: DrawingStyle;
  /** Height the annotation is drawn at; a rig plan sits above the floor. */
  drawElevationMm: number;
  /** Show computed lengths and areas against every annotation. */
  showMeasurements: boolean;
  setDrawKind: (kind: DrawKind) => void;
  setDrawStyle: (patch: Partial<DrawingStyle>) => void;
  setDrawElevation: (mm: number) => void;
  toggleMeasurements: () => void;
  addDrawPoint: (point: WallPoint) => void;
  setDrawHover: (point: WallPoint | null) => void;
  setPlaceHover: (point: { xMm: number; zMm: number } | null) => void;
  finishDrawing: () => void;
  cancelDrawing: () => void;

  /** Wall type chosen for the next tent sidewall fill. */
  tentWallType: string;
  setTentWallType: (value: string) => void;

  startWallDraw: () => void;
  addWallPoint: (point: WallPoint) => void;
  setWallHover: (point: WallPoint | null) => void;
  finishWallRun: (closed?: boolean) => void;
  cancelWallDraw: () => void;
  clearAllWalls: () => void;
  selectWall: (id: string | null) => void;
  selectFloor: (id: string | null) => void;
  updateWall: (id: string, patch: Partial<WallSegment>) => void;
  updateAllWalls: (patch: Partial<WallSegment>) => void;
  deleteWall: (id: string) => void;
  updateFloor: (id: string, patch: Partial<{ color: string; textureAssetId: number | null; textureTileSizeM: number }>) => void;
  addRoom: (segments: WallSegment[]) => void;

  markSaving: (saving: boolean) => void;
  markSaved: () => void;
  setSaveError: (message: string | null) => void;
}

const clone = <T,>(value: T): T => structuredClone(value);

/**
 * Keep an object on or above the floor.
 *
 * The grid is the ground, and in a real room nothing is buried in the slab —
 * you cannot see it, you cannot reach it, and a schedule that counts it is
 * wrong. Objects reached negative Y from several directions: the move gizmo,
 * a typed value in the properties panel, and imported models whose own origin
 * sits at their centre rather than their base.
 *
 * Applying it here means every write goes through one rule, rather than each
 * caller remembering. A patch that does not touch position is passed straight
 * through untouched, so this costs nothing on the common path.
 */
function keepAboveGround<T extends Partial<SceneObject>>(patch: T): T {
  const position = (patch as { positionMm?: { x: number; y: number; z: number } }).positionMm;
  if (!position || position.y >= 0) return patch;
  return { ...patch, positionMm: { ...position, y: 0 } };
}

export const useEditor = create<EditorState>((set, get) => ({
  planId: null,
  title: '',
  units: 'imperial',
  readOnly: false,

  scene: createEmptyScene('imperial'),
  past: [],
  future: [],

  selectedIds: [],
  isolatedIds: [],
  isolateMode: false,

  tool: 'select',
  transformMode: 'translate',
  cameraMode: 'perspective',
  finishTarget: null,
  frameRequest: 0,
  cameraTouched: false,
  snapToGrid: false,
  showGrid: true,

  pendingItem: null,

  dirty: false,
  saving: false,
  lastSavedAt: null,
  saveError: null,

  itemCache: {},

  /*
   * The AI section is what a plan opens on.
   *
   * It is the first thing most people want — describe the event and have it
   * built — and leaving the rail on the catalogue meant that path was found
   * only by people who already knew it existed.
   */
  workPanel: 'ai',
  constraintKind: 'keep-clear',
  constraintDraft: [],
  constraintHover: null,
  playing: false,
  playhead: 0,
  highlightIds: [],

  wallDraft: [],
  drawDraft: [],
  drawHover: null,
  placeHover: null,
  drawKind: 'dimension',
  drawStyle: { ...DEFAULT_DRAWING_STYLE },
  drawElevationMm: 0,
  showMeasurements: true,
  wallHover: null,
  wallDrawing: false,
  selectedWallId: null,
  selectedFloorId: null,
  tentWallType: 'solid',

  setTentWallType: (tentWallType) => set({ tentWallType }),

  load: (plan) => {
    const scene = migrateScene(plan.scene);
    set({
      planId: plan.id,
      title: plan.title,
      units: plan.units,
      readOnly: plan.readOnly,
      scene,
      past: [],
      future: [],
      selectedIds: [],
      isolatedIds: [],
      isolateMode: false,
      cameraMode: scene.camera.mode,
      // A newly opened plan has not been looked around yet.
      cameraTouched: false,
      showGrid: scene.showGrid,
      snapToGrid: scene.snapToGrid,
      dirty: false,
      saveError: null,
      lastSavedAt: Date.now(),
      wallDraft: [],
      wallHover: null,
      wallDrawing: false,
      selectedWallId: null,
      selectedFloorId: null,
    });
  },

  cacheItems: (items) =>
    set((s) => ({
      itemCache: { ...s.itemCache, ...Object.fromEntries(items.map((i) => [i.id, i])) },
    })),

  commit: (mutate) => {
    const { scene, past, readOnly } = get();
    if (readOnly) return;
    const next = clone(scene);
    mutate(next);
    set({
      scene: next,
      past: [...past, scene].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
    });
  },

  /*
   * View preferences — camera mode, grid, snap — live in the scene so they
   * persist, but they are not edits. Routing them through `commit` deep-cloned
   * the whole document and pushed an undo entry on every keypress, which made
   * tapping T/P slow on a large plan and filled the undo stack with changes no
   * one would ever want to undo.
   */
  commitQuiet: (mutate) => {
    const { scene, readOnly } = get();
    if (readOnly) return;
    const next = clone(scene);
    mutate(next);
    set({ scene: next, dirty: true });
  },

  replaceScene: (next) => {
    const { scene, past } = get();
    set({ scene: next, past: [...past, scene].slice(-HISTORY_LIMIT), future: [], dirty: true });
  },

  undo: () => {
    const { past, scene, future } = get();
    const previous = past[past.length - 1];
    if (!previous) return;
    set({
      scene: previous,
      past: past.slice(0, -1),
      future: [scene, ...future].slice(0, HISTORY_LIMIT),
      dirty: true,
      // Selections can reference objects that no longer exist after an undo.
      selectedIds: get().selectedIds.filter((id) => previous.objects.some((o) => o.id === id)),
    });
  },

  redo: () => {
    const { future, scene, past } = get();
    const next = future[0];
    if (!next) return;
    set({
      scene: next,
      future: future.slice(1),
      past: [...past, scene].slice(-HISTORY_LIMIT),
      dirty: true,
      selectedIds: get().selectedIds.filter((id) => next.objects.some((o) => o.id === id)),
    });
  },

  select: (ids) => set({ selectedIds: ids }),

  toggleSelect: (id, additive) =>
    set((s) => {
      if (!additive) return { selectedIds: [id] };
      return s.selectedIds.includes(id)
        ? { selectedIds: s.selectedIds.filter((x) => x !== id) }
        : { selectedIds: [...s.selectedIds, id] };
    }),

  clearSelection: () => set({ selectedIds: [] }),

  boxSelectRect: null,
  setBoxSelectRect: (boxSelectRect) => set({ boxSelectRect }),

  selectionAnchor: null,
  setSelectionAnchor: (selectionAnchor) => set({ selectionAnchor }),

  ledQuickEditId: null,
  setLedQuickEditId: (ledQuickEditId) => set({ ledQuickEditId }),

  setTool: (tool) => {
    // Leaving a drawing tool abandons a half-drawn run rather than leaving it
    // floating with no way to finish it.
    if (get().tool === 'wall' && tool !== 'wall') get().cancelWallDraw();
    if (get().tool === 'draw' && tool !== 'draw') get().cancelDrawing();
    set({ tool, pendingItem: tool === 'select' ? get().pendingItem : null });
    if (tool === 'wall') set({ selectedIds: [] });
  },
  setTransformMode: (transformMode) => set({ transformMode }),

  setFinishTarget: (finishTarget) => set({ finishTarget }),

  frameMode: 'all',
  requestFrameAll: () => set((s) => ({ frameRequest: s.frameRequest + 1, frameMode: 'all' })),
  requestFrameSelection: () =>
    set((s) => ({
      frameRequest: s.frameRequest + 1,
      // Nothing selected is a request to see everything, not a request to
      // fly to the origin and look at nothing.
      frameMode: s.selectedIds.length ? 'selection' : 'all',
    })),

  markCameraTouched: () => {
    if (!get().cameraTouched) set({ cameraTouched: true });
  },

  flying: false,
  setFlying: (flying) => set({ flying }),

  walkMode: false,
  setWalkMode: (walkMode) => set({ walkMode }),
  toggleWalkMode: () => set((s) => ({ walkMode: !s.walkMode })),

  viewRequest: null,
  goToView: (view) => set({ viewRequest: { view, at: Date.now() } }),

  addView: (view) =>
    get().commit((draft) => {
      draft.views = [
        ...(draft.views ?? []),
        { ...view, id: newObjectId(), createdAt: new Date().toISOString() },
      ];
    }),

  renameView: (id, name) =>
    get().commit((draft) => {
      draft.views = (draft.views ?? []).map((view) => (view.id === id ? { ...view, name } : view));
    }),

  removeView: (id) =>
    get().commit((draft) => {
      draft.views = (draft.views ?? []).filter((view) => view.id !== id);
    }),

  /*
   * Order matters: the strip a client sees is a tour, and the designer decides
   * where it starts. Swapping with the neighbour rather than exposing a
   * drag-to-reorder keeps it to two buttons per row.
   */
  moveView: (id, direction) =>
    get().commit((draft) => {
      const views = [...(draft.views ?? [])];
      const index = views.findIndex((view) => view.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= views.length) return;
      [views[index], views[target]] = [views[target]!, views[index]!];
      draft.views = views;
    }),

  setCameraMode: (cameraMode) => {
    if (get().cameraMode === cameraMode) return;
    set({ cameraMode });
    get().commitQuiet((draft) => {
      draft.camera.mode = cameraMode;
    });
  },

  /**
   * Remember where the camera is, so reopening this plan resumes the same
   * view instead of the generic three-quarter default. Called after an orbit,
   * pan, zoom or fly settles — not on every frame while one is in progress,
   * which would flood the document with writes for a value nobody reads until
   * the plan is reopened.
   */
  setCameraPose: (pose) => {
    get().commitQuiet((draft) => {
      draft.camera.positionMm = pose.positionMm;
      draft.camera.targetMm = pose.targetMm;
      draft.camera.fov = pose.fov;
    });
  },

  toggleGrid: () => {
    const showGrid = !get().showGrid;
    set({ showGrid });
    get().commitQuiet((draft) => {
      draft.showGrid = showGrid;
    });
  },

  toggleSnap: () => {
    const snapToGrid = !get().snapToGrid;
    set({ snapToGrid });
    get().commitQuiet((draft) => {
      draft.snapToGrid = snapToGrid;
    });
  },

  /**
   * Isolate hides everything except the selection. Entering with nothing
   * selected is a no-op rather than an empty viewport.
   */
  toggleIsolate: () =>
    set((s) => {
      if (s.isolateMode) return { isolateMode: false, isolatedIds: [] };
      if (!s.selectedIds.length) return s;
      return { isolateMode: true, isolatedIds: [...s.selectedIds] };
    }),

  // Disarming also drops the hover, so a cancelled placement leaves no ghost
  // standing in the room.
  setPendingItem: (pendingItem) => set({ pendingItem, placeHover: null }),

  addObjects: (objects) => {
    get().commit((draft) => {
      // Dropped and imported objects land on the floor, never through it.
      draft.objects.push(...objects.map((o) => keepAboveGround(o) as SceneObject));
    });
    set((s) => ({
      selectedIds: objects.map((o) => o.id),
      // New objects join an active isolation, otherwise they vanish on creation.
      isolatedIds: s.isolateMode ? [...s.isolatedIds, ...objects.map((o) => o.id)] : s.isolatedIds,
    }));
  },

  updateObject: (id, patch) =>
    get().commit((draft) => {
      const index = draft.objects.findIndex((o) => o.id === id);
      const safe = keepAboveGround(patch);
      if (index >= 0) draft.objects[index] = { ...draft.objects[index]!, ...safe } as SceneObject;
    }),

  updateObjects: (ids, patch) =>
    get().commit((draft) => {
      const safe = keepAboveGround(patch);
      for (const id of ids) {
        const index = draft.objects.findIndex((o) => o.id === id);
        if (index >= 0) draft.objects[index] = { ...draft.objects[index]!, ...safe } as SceneObject;
      }
    }),

  applyFinish: (objectId, part, finish) =>
    get().commit((draft) => {
      const index = draft.objects.findIndex((o) => o.id === objectId);
      if (index < 0) return;
      const object = draft.objects[index]!;
      draft.objects[index] = {
        ...object,
        finishes: { ...(object.finishes ?? {}), [part]: finish },
      } as SceneObject;
    }),

  clearFinish: (objectId, part) =>
    get().commit((draft) => {
      const index = draft.objects.findIndex((o) => o.id === objectId);
      if (index < 0) return;
      const object = draft.objects[index]!;
      if (!object.finishes) return;
      const next = { ...object.finishes };
      delete next[part];
      draft.objects[index] = {
        ...object,
        finishes: Object.keys(next).length ? next : undefined,
      } as SceneObject;
    }),

  clearAllFinishes: (objectId) =>
    get().commit((draft) => {
      const index = draft.objects.findIndex((o) => o.id === objectId);
      if (index < 0) return;
      draft.objects[index] = { ...draft.objects[index]!, finishes: undefined } as SceneObject;
    }),

  setFloorFinish: (finish) =>
    get().commit((draft) => {
      draft.floorFinish = finish;
    }),

  setEnvironmentHdri: (url, label = null) =>
    get().commit((draft) => {
      draft.lighting = { ...draft.lighting, customHdriUrl: url, customHdriLabel: label };
    }),

  deleteSelected: () => {
    const ids = new Set(get().selectedIds);
    if (!ids.size) return;
    get().commit((draft) => {
      // Locked objects are protected from deletion, not just from dragging.
      draft.objects = draft.objects.filter((o) => !ids.has(o.id) || o.locked);
    });
    set({ selectedIds: [] });
  },

  duplicateSelected: () => {
    const { scene, selectedIds } = get();
    const originals = scene.objects.filter((o) => selectedIds.includes(o.id));
    if (!originals.length) return;
    const offset = scene.gridSizeMm || 305;
    const copies = originals.map((o) => ({
      ...clone(o),
      id: crypto.randomUUID(),
      positionMm: { ...o.positionMm, x: o.positionMm.x + offset, z: o.positionMm.z + offset },
      locked: false,
    })) as SceneObject[];
    get().addObjects(copies);
  },

  toggleLockSelected: () => {
    const { scene, selectedIds } = get();
    const anyUnlocked = scene.objects.some((o) => selectedIds.includes(o.id) && !o.locked);
    get().updateObjects(selectedIds, { locked: anyUnlocked } as Partial<SceneObject>);
  },

  /**
   * A table group owns its output. Regenerating drops every object carrying the
   * group id and replaces them, which is what keeps chairs and place settings
   * in step when the table, seat count or layout changes.
   */
  upsertTableGroup: (group, generated) => {
    get().commit((draft) => {
      draft.objects = draft.objects.filter((o) => o.groupId !== group.id);
      draft.objects.push(...generated);
      const index = draft.tableGroups.findIndex((g) => g.id === group.id);
      if (index >= 0) draft.tableGroups[index] = group;
      else draft.tableGroups.push(group);
    });
    set({ selectedIds: [] });
  },

  removeTableGroup: (groupId) => {
    get().commit((draft) => {
      draft.objects = draft.objects.filter((o) => o.groupId !== groupId);
      draft.tableGroups = draft.tableGroups.filter((g) => g.id !== groupId);
    });
    set({ selectedIds: [] });
  },


  /* ── Walls ─────────────────────────────────────────────────────────── */

  /* ── Drafting ────────────────────────────────────────────────────── */

  setDrawKind: (drawKind) => set({ drawKind, drawDraft: [], drawHover: null }),

  setDrawStyle: (patch) => set((st) => ({ drawStyle: { ...st.drawStyle, ...patch } })),

  setDrawElevation: (drawElevationMm) => set({ drawElevationMm }),

  // A view preference, so it goes through commitQuiet and never lands in undo.
  toggleMeasurements: () => set((st) => ({ showMeasurements: !st.showMeasurements })),

  setDrawHover: (drawHover) => set({ drawHover }),
  setPlaceHover: (placeHover) => set({ placeHover }),

  /**
   * Add a point, and finish automatically once the shape has all it needs.
   *
   * A rectangle is done at two clicks and a dimension at two points; making
   * someone press Enter after the last click of a two-click shape is friction
   * for nothing.
   */
  addDrawPoint: (point) => {
    const next = [...get().drawDraft, point];
    const needed = DRAW_KIND_INFO[get().drawKind].pointsNeeded;
    set({ drawDraft: next });
    if (needed > 0 && next.length >= needed) get().finishDrawing();
  },

  finishDrawing: () => {
    const { drawDraft, drawKind, drawStyle, drawElevationMm } = get();
    const info = DRAW_KIND_INFO[drawKind];
    /*
     * How many points this shape needs before it means anything.
     *
     * A shape that states its own count is taken at its word. Treating every
     * closing shape as needing three points was wrong for rectangles and
     * circles, which close but are defined by two: two clicks completed the
     * shape, this check then rejected it, and neither tool could draw anything
     * at all.
     *
     * Free-form shapes have no declared count, so a closed one needs three
     * points to enclose anything and an open one needs two to be a line.
     */
    const minimum = info.pointsNeeded > 0 ? info.pointsNeeded : info.closes ? 3 : 2;
    if (drawDraft.length < minimum) {
      set({ drawDraft: [], drawHover: null });
      return;
    }

    const object: DrawingSceneObject = {
      id: newObjectId(),
      type: 'drawing',
      name: info.label,
      drawKind,
      points: drawDraft,
      elevationMm: drawElevationMm,
      positionMm: { x: 0, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      ...drawStyle,
    };

    get().addObjects([object]);
    set({ drawDraft: [], drawHover: null });
  },

  cancelDrawing: () => set({ drawDraft: [], drawHover: null }),

  startWallDraw: () => set({ wallDrawing: true, wallDraft: [], wallHover: null, selectedIds: [] }),

  addWallPoint: (point) => set((s) => ({ wallDraft: [...s.wallDraft, point] })),

  setWallHover: (wallHover) => set({ wallHover }),

  /**
   * Commit the drawn run.
   *
   * Floors are re-derived from the whole segment set rather than just the new
   * run, because a run can close a loop with walls drawn earlier — the room a
   * user sees is a property of the graph, not of one gesture.
   */
  finishWallRun: (closed = false) => {
    const { wallDraft } = get();
    if (wallDraft.length >= 2) {
      const created = segmentsFromRun(wallDraft, { closed });
      get().commit((draft) => {
        const segments = [...draft.walls.segments, ...created];
        draft.walls = rebuildBlueprint(segments, draft.walls.floors);
      });
    }
    set({ wallDraft: [], wallHover: null, wallDrawing: false });
  },

  cancelWallDraw: () => set({ wallDraft: [], wallHover: null, wallDrawing: false }),

  clearAllWalls: () => {
    get().commit((draft) => {
      draft.walls = { segments: [], floors: [] };
    });
    set({ selectedWallId: null, selectedFloorId: null });
  },

  selectWall: (id) => set({ selectedWallId: id, selectedFloorId: null, selectedIds: [] }),
  selectFloor: (id) => set({ selectedFloorId: id, selectedWallId: null, selectedIds: [] }),

  updateWall: (id, patch) =>
    get().commit((draft) => {
      const index = draft.walls.segments.findIndex((w) => w.id === id);
      if (index >= 0) draft.walls.segments[index] = { ...draft.walls.segments[index]!, ...patch };
    }),

  updateAllWalls: (patch) =>
    get().commit((draft) => {
      draft.walls.segments = draft.walls.segments.map((w) => ({ ...w, ...patch }));
    }),

  deleteWall: (id) => {
    get().commit((draft) => {
      const segments = draft.walls.segments.filter((w) => w.id !== id);
      draft.walls = rebuildBlueprint(segments, draft.walls.floors);
      // An opening whose wall is gone has nothing to sit in.
      draft.objects = draft.objects.filter((o) => o.type !== 'opening' || o.wallSegmentId !== id);
    });
    set({ selectedWallId: null });
  },

  updateFloor: (id, patch) =>
    get().commit((draft) => {
      const index = draft.walls.floors.findIndex((f) => f.id === id);
      if (index >= 0) draft.walls.floors[index] = { ...draft.walls.floors[index]!, ...patch };
    }),

  addRoom: (segments) => {
    get().commit((draft) => {
      draft.walls = rebuildBlueprint([...draft.walls.segments, ...segments], draft.walls.floors);
    });
  },

  /* -- The work panel ------------------------------------------------- */

  setWorkPanel: (workPanel) => {
    // Leaving the site panel abandons a half-drawn area rather than leaving it
    // floating with no way to finish it - the same rule the wall tool follows.
    if (get().workPanel === 'site' && workPanel !== 'site') get().cancelConstraint();
    set({ workPanel });
    if (workPanel !== 'site' && get().tool === 'constraint') set({ tool: 'select' });
  },

  focusObject: (id, panel) => {
    set({ selectedIds: [id], highlightIds: [id] });
    /*
     * `'properties'` is deliberately not routed anywhere. The right-hand dock
     * switches to Properties on its own whenever a selection appears, so
     * forcing the left panel to change as well would throw away whatever the
     * user had open on the other side of the screen for no gain.
     */
    if (panel && panel !== 'properties') get().setWorkPanel(panel);
    /*
     * The highlight is a flash, not a mode. Leaving it on would make every
     * subsequent selection look like it had been flagged by a check.
     */
    window.setTimeout(() => {
      if (useEditor.getState().highlightIds.includes(id)) set({ highlightIds: [] });
    }, 2600);
  },

  setHighlight: (highlightIds) => set({ highlightIds }),

  /* -- Site constraints ----------------------------------------------- */

  setConstraintKind: (constraintKind) => set({ constraintKind, constraintDraft: [], constraintHover: null }),

  addConstraintPoint: (point) => {
    const next = [...get().constraintDraft, point];
    set({ constraintDraft: next, tool: 'constraint' });
    /*
     * A point constraint - a rigging point, a power outlet - is complete at one
     * click. Making someone press Enter to place a single point is friction for
     * nothing, and these are the constraints people place most of.
     */
    const kind = get().constraintKind;
    if (kind === 'rigging-point' || kind === 'power') get().finishConstraint();
  },

  setConstraintHover: (constraintHover) => set({ constraintHover }),

  finishConstraint: () => {
    const { constraintDraft, constraintKind } = get();
    const isPoint = constraintKind === 'rigging-point' || constraintKind === 'power';
    if (constraintDraft.length < (isPoint ? 1 : 3)) {
      set({ constraintDraft: [], constraintHover: null });
      return;
    }

    /*
     * Points are stored relative to the object's own origin, as every other
     * path-carrying object does, so dragging the constraint moves its geometry
     * with it rather than leaving the outline behind.
     */
    const centre = constraintDraft.reduce(
      (acc, p) => ({ x: acc.x + p.xMm / constraintDraft.length, z: acc.z + p.zMm / constraintDraft.length }),
      { x: 0, z: 0 }
    );
    const local = constraintDraft.map((p) => ({
      xMm: Math.round(p.xMm - centre.x),
      zMm: Math.round(p.zMm - centre.z),
    }));

    const object = createConstraint({
      kind: constraintKind,
      points: local,
      position: { x: Math.round(centre.x), y: 0, z: Math.round(centre.z) },
    });

    get().addObjects([object]);
    set({ constraintDraft: [], constraintHover: null });
  },

  cancelConstraint: () => set({ constraintDraft: [], constraintHover: null }),

  /* -- Presentation and document settings ----------------------------- */

  setRender: (patch) =>
    get().commitQuiet((draft) => {
      draft.render = { ...draft.render, ...patch };
    }),

  setWalkthrough: (patch) =>
    get().commitQuiet((draft) => {
      draft.walkthrough = { ...draft.walkthrough, ...patch };
    }),

  /*
   * Shots are an edit, not a view preference. Losing a camera move someone
   * spent ten minutes on, with no undo, would be unforgivable - so this one
   * goes through commit while the settings around it do not.
   */
  setShots: (shots) =>
    get().commit((draft) => {
      draft.walkthrough = { ...draft.walkthrough, shots };
    }),

  setRegion: (regionCode) =>
    get().commitQuiet((draft) => {
      draft.regionCode = regionCode;
    }),

  setRateCard: (rateCardId) =>
    get().commitQuiet((draft) => {
      draft.rateCardId = rateCardId;
    }),

  toggleConstraintsVisible: () =>
    get().commitQuiet((draft) => {
      draft.showConstraints = !draft.showConstraints;
    }),

  toggleCollisionCheck: () =>
    get().commitQuiet((draft) => {
      draft.collisionCheck = !draft.collisionCheck;
    }),

  setPlaying: (playing) => set({ playing }),
  setPlayhead: (playhead) => set({ playhead }),

  markSaving: (saving) => set({ saving }),
  markSaved: () => set({ dirty: false, saving: false, lastSavedAt: Date.now(), saveError: null }),
  setSaveError: (saveError) => set({ saveError, saving: false }),
}));

/*
 * Derived views of the scene live in `editor/selectors.ts`, where they are
 * wrapped in `useShallow`. Deriving an array inside a plain zustand selector
 * re-renders forever — see the note in that file.
 */

/*
 * The store, reachable from the browser console in development.
 *
 * Navigation is the one part of this editor whose correctness cannot be seen
 * in a screenshot: a pan and a zoom both just "change the view", and telling
 * them apart needs the camera position and its distance to the orbit target.
 * Exposing the store is what lets an end-to-end test — or a person poking at
 * a viewport that feels wrong — read those numbers directly.
 *
 * Development only, so nothing is added to the production bundle.
 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __NOVIRA_STORE__?: typeof useEditor }).__NOVIRA_STORE__ = useEditor;
}
