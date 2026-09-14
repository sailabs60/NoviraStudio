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
  type VenueSite,
  refineSiteFromModel,
  type SiteBoundsMm,
} from '@novira/shared';
import { createConstraint } from './factories';

/** Stable id for a new object. */
function newObjectId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type Tool = 'select' | 'box-select' | 'line' | 'shape' | 'wall' | 'draw' | 'constraint';

/** The selection's projected screen box — see `selectionAnchor`. */
export interface SelectionAnchor {
  /** Horizontal centre, kept because almost every consumer wants it. */
  x: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

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
  /**
   * Reposition objects during a live gesture.
   *
   * The drag path, kept apart from `commitQuiet` because that one clones the
   * whole document and a drag calls it on every pointer move. See the
   * implementation for the measurements.
   */
  moveObjectsLive: (moves: Array<{ id: string; positionMm: Vec3 }>) => void;
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
   * All four edges of the projected bounding box, plus its horizontal centre —
   * enough for the toolbar to find a position that does not overlap the object
   * at all, rather than one that merely avoids its middle. The horizontal pair
   * matters as much as the vertical: a stage or an LED wall is many times wider
   * than it is tall on screen, and a toolbar placed from the vertical extent
   * alone lands on top of it. Computed inside the Canvas, where the camera is;
   * consumed outside it, where the HTML is.
   */
  selectionAnchor: SelectionAnchor | null;
  setSelectionAnchor: (anchor: SelectionAnchor | null) => void;

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
  /**
   * Frame the venue itself, ignoring everything modelled around it.
   *
   * The request a designer means by "show me the room". Framing *everything*
   * on a plan set in a real hotel measures the forecourt and the car park the
   * model happens to include, and lands the camera somewhere over the roof;
   * this measures only the interior the plan records (see `venueSite`), so the
   * view arrives inside the hall looking at the floor people are working on.
   */
  requestFrameVenue: () => void;
  frameMode: 'all' | 'selection' | 'venue';

  /* -- The room the plan is set in ------------------------------------ */
  /**
   * Convenience read of `scene.venueSite`, which is the authority.
   *
   * Mirrored onto the store root because it is consulted on every placement
   * and on every camera frame, and reaching through `scene` for it in a
   * `useEditor` selector re-runs that selector on every unrelated scene edit.
   */
  venueSite: VenueSite | null;
  /** Record the room a newly applied venue describes. */
  setVenueSite: (site: VenueSite | null) => void;
  /**
   * Tell the site what the building's mesh actually turned out to be.
   *
   * Called once by the viewport when a venue shell finishes loading, because
   * only the rendered geometry can answer two questions the record cannot:
   *
   *  · **How much of the model is not the room** — a record describing a 51 m
   *    ballroom may arrive as a 51 m box or as a whole hotel, and that ratio
   *    decides whether focusing on the venue is worth doing at all.
   *  · **Where in the model the room actually is.** The record says how big it
   *    is; nobody recorded where, so every consumer assumed the origin. On the
   *    Johari Rotana the ballroom sits 12.3 m off-centre, which is why framing
   *    the "room" landed the camera in a corridor. See `measureVenue.ts`.
   */
  measureVenueModel: (measured: {
    modelBoundsMm: SiteBoundsMm;
    /** Where the room was found, when it could be picked out of the mesh. */
    roomBoundsMm?: SiteBoundsMm | null;
    roomFloorMm?: number | null;
  }) => void;
  /** Which storey new objects land on, and the camera is held to. */
  setActiveFloor: (floorId: string) => void;
  /**
   * Keep the camera inside the venue rather than letting it drift outside.
   *
   * On by default whenever a site exists, and switchable because inspecting
   * the outside of a building you have imported is a legitimate thing to want
   * — it is simply never what somebody laying out chairs meant to do.
   */
  confineToVenue: boolean;
  toggleConfineToVenue: () => void;

  /* -- How much frame there is to spend ------------------------------- */
  /**
   * What the renderer is currently coping with, measured rather than guessed.
   *
   * `moving` is true while the view is being navigated and for a beat after;
   * `heavy` is true when frames have been taking long enough that the full
   * scene cannot be drawn at an interactive rate. Together they are the signal
   * the expensive parts of the render read to stand down during a gesture and
   * come back the instant it ends — see `useFrameBudget` for why a viewport
   * that does not do this stops answering clicks entirely on a large plan.
   */
  frameBudget: { moving: boolean; heavy: boolean };
  setFrameBudget: (budget: { moving: boolean; heavy: boolean }) => void;

  /**
   * The last thing placed, for a moment afterwards.
   *
   * A placement that succeeds and says nothing looks exactly like one that
   * failed — which is why the most common thing a new user does after clicking
   * the floor is click it again, and end up with two of everything. This is
   * what the confirmation reads, and it clears itself.
   */
  lastPlaced: { name: string; at: number } | null;
  notePlaced: (name: string) => void;

  /**
   * Bumped whenever something wants the left panel opened as well as chosen.
   *
   * Whether the sidebar is open is layout, and layout belongs to the page that
   * owns it — but `setWorkPanel` is called from inside the viewport, from the
   * command palette and from the plan itself, none of which can reach that
   * page's state. A counter rather than a boolean, because two requests in a
   * row must both be honoured even if the user shut the panel in between.
   */
  panelRequest: number;
  requestPanel: (panel: WorkPanel) => void;
  /**
   * The same, for the properties dock on the right.
   *
   * "Edit" on the quick menu means *show me this object's settings*, and the
   * dock it shows them in can perfectly well be closed — in which case the
   * button appeared to do nothing at all, which is the worst outcome for the
   * most obvious entry in the menu.
   */
  propertiesRequest: number;
  requestProperties: () => void;

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
  showMeasurements: false,
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
      // The room, mirrored out of the document it is stored in — see the note
      // on `venueSite` in the state interface.
      venueSite: scene.venueSite ?? null,
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

  /**
   * Move objects during a live gesture, without cloning the whole plan.
   *
   * ## Why this is separate from `commitQuiet`
   *
   * `commitQuiet` deep-clones the scene document. That is entirely correct for
   * what it was written for — a setting changed once when a key is pressed —
   * and entirely wrong for a drag, which calls it on **every pointer move**.
   *
   * On the 504-object banquet used to measure this, the document is a few
   * hundred kilobytes of JSON and `structuredClone` of it costs several
   * milliseconds. Pushing a chair across the room therefore cloned the entire
   * plan sixty times a second, on the main thread, in competition with the
   * renderer that was already struggling — which is precisely the "the viewport
   * feels off while I am moving something" the drag is supposed to feel smooth
   * during. It also produced a fresh object identity for every one of the plan's
   * objects on every move, so every memo keyed on the objects array — the
   * instancing batcher, the visible-object selector, the shadow extent — was
   * invalidated and recomputed each time as well.
   *
   * ## What it does instead
   *
   * Copies the array and replaces only the entries that moved. The document
   * object is new, and so is `objects`, so React and zustand both see the change
   * — but the several hundred objects that did not move keep their identity, so
   * everything memoised on them stays memoised. Nothing else in the document is
   * touched or copied at all.
   *
   * History is deliberately untouched, exactly as `commitQuiet` leaves it: the
   * gesture writes one undo entry when it *ends*, not two hundred as it runs.
   */
  moveObjectsLive: (moves) => {
    const { scene, readOnly } = get();
    if (readOnly || !moves.length) return;

    const byId = new Map(moves.map((move) => [move.id, move.positionMm]));
    let changed = false;
    const objects = scene.objects.map((object) => {
      const next = byId.get(object.id);
      if (!next) return object;
      const at = object.positionMm;
      // An identical position is not a change, and writing one would discard
      // this object's identity for nothing.
      if (at && at.x === next.x && at.y === next.y && at.z === next.z) return object;
      changed = true;
      return { ...object, positionMm: next } as SceneObject;
    });

    if (!changed) return;
    set({ scene: { ...scene, objects }, dirty: true });
  },

  replaceScene: (next) => {
    const { scene, past } = get();
    set({
      scene: next,
      past: [...past, scene].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      // Applying a venue arrives through here, so this is where the room the
      // plan is set in changes.
      venueSite: next.venueSite ?? null,
    });
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
      // Undoing past the point a venue was applied has to take the room with
      // it, or placement keeps snapping to a floor that is no longer there.
      venueSite: previous.venueSite ?? null,
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
      venueSite: next.venueSite ?? null,
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
  requestFrameAll: () =>
    set((s) => ({
      frameRequest: s.frameRequest + 1,
      /*
       * "Everything" means the room, once there is a room.
       *
       * On a plan set in a real building, framing every mesh in the scene
       * measures whatever the model carries around the hall — a forecourt, a
       * car park, the neighbouring wing — and the camera ends up far enough
       * out that the event reads as a smudge on a roof. Once a venue has told
       * the plan where its walls stop, Fit means fit *that*, which is what
       * somebody pressing it in a ballroom was asking for either way.
       */
      frameMode: s.venueSite ? 'venue' : 'all',
    })),
  requestFrameVenue: () =>
    set((s) => ({
      frameRequest: s.frameRequest + 1,
      // No room recorded: the honest answer is still "show me everything".
      frameMode: s.venueSite ? 'venue' : 'all',
    })),
  requestFrameSelection: () =>
    set((s) => ({
      frameRequest: s.frameRequest + 1,
      // Nothing selected is a request to see the room, not a request to fly
      // to the origin and look at nothing.
      frameMode: s.selectedIds.length ? 'selection' : s.venueSite ? 'venue' : 'all',
    })),

  /* ── The room ──────────────────────────────────────────────────────── */

  venueSite: null,
  confineToVenue: true,

  setVenueSite: (site) => {
    set({ venueSite: site });
    get().commitQuiet((draft) => {
      draft.venueSite = site;
    });
  },

  /*
   * Written quietly and only when the figure actually moves.
   *
   * This is called from the render loop's own "the shell has loaded" effect,
   * and a commit there would put a scene clone — and a dirty flag — on the
   * critical path of the first frame after a 100 MB building arrives, which is
   * already the slowest moment in the editor.
   */
  measureVenueModel: ({ modelBoundsMm, roomBoundsMm, roomFloorMm }) => {
    const site = get().venueSite;
    if (!site) return;

    let next = refineSiteFromModel(site, modelBoundsMm);

    /*
     * Move the room to where it was actually found.
     *
     * The recorded dimensions stay authoritative — a person measured those —
     * but the *position* comes from the mesh, because nothing recorded it and
     * assuming the origin is what put the camera in a corridor. Both the site's
     * own interior and the storey being designed on are moved together, so
     * framing, placement and confinement all agree about where the room is.
     */
    if (roomBoundsMm) {
      const floorMm = typeof roomFloorMm === 'number' ? roomFloorMm : 0;
      /*
       * Only when it has actually moved.
       *
       * This runs every time the shell finishes loading, which is every time
       * the plan is opened. Rewriting the same rectangle each time would mark
       * the document dirty on load and trigger an autosave of a plan nobody
       * has edited — which is both a wasted write and, worse, a "saving…"
       * flicker that makes the editor look like it is doing something behind
       * the user's back.
       */
      const already =
        next.interiorMm.minX === roomBoundsMm.minX &&
        next.interiorMm.maxX === roomBoundsMm.maxX &&
        next.interiorMm.minZ === roomBoundsMm.minZ &&
        next.interiorMm.maxZ === roomBoundsMm.maxZ;
      if (already) {
        if (next === site) return;
        set({ venueSite: next });
        get().commitQuiet((draft) => {
          draft.venueSite = next;
        });
        return;
      }

      next = {
        ...next,
        interiorMm: roomBoundsMm,
        floors: next.floors.map((floor) =>
          // Only the storey the room was found on: a mezzanine above it keeps
          // its own extent, which is the whole reason storeys are separate.
          Math.abs(floor.elevationMm - floorMm) <= 1200
            ? { ...floor, boundsMm: roomBoundsMm, elevationMm: floorMm }
            : floor
        ),
      };
    }

    if (next === site) return;
    set({ venueSite: next });
    get().commitQuiet((draft) => {
      draft.venueSite = next;
    });
  },

  setActiveFloor: (floorId) => {
    const site = get().venueSite;
    if (!site || site.activeFloorId === floorId) return;
    if (!site.floors.some((f) => f.id === floorId)) return;
    const next: VenueSite = { ...site, activeFloorId: floorId };
    set({ venueSite: next });
    get().commitQuiet((draft) => {
      draft.venueSite = next;
    });
    // Changing storey is a navigation, so the view goes with it — arriving on
    // a floor you cannot see is the same as not arriving.
    set((s) => ({ frameRequest: s.frameRequest + 1, frameMode: 'venue' }));
  },

  toggleConfineToVenue: () => set((s) => ({ confineToVenue: !s.confineToVenue })),

  panelRequest: 0,
  requestPanel: (panel) =>
    set((s) => ({ workPanel: panel, panelRequest: s.panelRequest + 1 })),
  propertiesRequest: 0,
  requestProperties: () => set((s) => ({ propertiesRequest: s.propertiesRequest + 1 })),

  lastPlaced: null,
  notePlaced: (name) => {
    set({ lastPlaced: { name, at: Date.now() } });
    /*
     * Cleared on a timer rather than by the component, so the message has the
     * same life whether or not the viewport happens to re-render — and so a
     * second placement during the window simply replaces it rather than
     * stacking two confirmations on top of each other.
     */
    window.setTimeout(() => {
      const current = get().lastPlaced;
      if (current && Date.now() - current.at >= 2400) set({ lastPlaced: null });
    }, 2500);
  },

  frameBudget: { moving: false, heavy: false },
  setFrameBudget: (budget) =>
    set((s) =>
      // Written from the frame loop, so it must not produce a new object — and
      // therefore a re-render of everything subscribed — on every frame.
      s.frameBudget.moving === budget.moving && s.frameBudget.heavy === budget.heavy
        ? s
        : { frameBudget: budget }
    ),

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
