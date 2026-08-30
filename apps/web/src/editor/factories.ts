/**
 * Object factories.
 *
 * One place that knows how to make a well-formed scene object of each new type.
 * Panels, the concept generator, the marketplace importer and the keyboard
 * shortcuts all create objects, and without this they would each carry their
 * own idea of what a sensible default truss is — which is how three of them end
 * up subtly different and one of them broken.
 *
 * Every factory returns something immediately usable: real dimensions, a real
 * name, and defaults chosen from what people actually specify rather than from
 * whatever was easiest to type.
 */
import {
  BOOTH_TYPE_SPECS,
  DEFAULT_TRUSS_SYSTEM,
  fixtureDefaults,
  ledPanel,
  LED_PRESETS,
  trussShapePoints,
  constraintDefaults,
  type BoothSceneObject,
  type BoothType,
  type ConstraintKind,
  type ConstraintSceneObject,
  type LedFrame,
  type LedScreenSceneObject,
  type LightFixtureKey,
  type LightFixtureSceneObject,
  type LightRole,
  type SceneObject,
  type TrussSceneObject,
  type TrussShape,
  type Vec3,
  type WallPoint,
} from '@novira/shared';

export function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

function base(position: Vec3 = ORIGIN) {
  return {
    id: newId(),
    positionMm: { ...position },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

/* ── Truss ─────────────────────────────────────────────────────────────── */

export interface TrussOptions {
  shape?: TrussShape;
  systemKey?: string;
  widthMm?: number;
  depthMm?: number;
  trimHeightMm?: number;
  legType?: TrussSceneObject['legType'];
  position?: Vec3;
  name?: string;
}

export function createTruss(options: TrussOptions = {}): TrussSceneObject {
  const shape = options.shape ?? 'goalpost';
  const widthMm = options.widthMm ?? 8000;
  const depthMm = options.depthMm ?? 6000;
  const closed = shape === 'square' || shape === 'circle';

  return {
    ...base(options.position),
    type: 'truss',
    name: options.name ?? `${shape === 'goalpost' ? 'Goalpost' : 'Truss'} run`,
    systemKey: options.systemKey ?? DEFAULT_TRUSS_SYSTEM,
    shape,
    points: trussShapePoints(shape, widthMm, depthMm),
    closed,
    // 5 m trim clears a stage and a screen and still fits a 6 m ceiling. It is
    // the height most goalposts are actually rigged at.
    trimHeightMm: options.trimHeightMm ?? 5000,
    legType: options.legType ?? (closed ? 'flown' : 'base-plate'),
    hangingLoadKg: 0,
    color: '#c2c7ce',
    showBracing: true,
  };
}

/* ── LED ───────────────────────────────────────────────────────────────── */

export interface LedOptions {
  presetKey?: string;
  panelKey?: string;
  columns?: number;
  rows?: number;
  bottomMm?: number;
  frame?: LedFrame;
  curveDeg?: number;
  position?: Vec3;
  name?: string;
}

export function createLedScreen(options: LedOptions = {}): LedScreenSceneObject {
  const preset = LED_PRESETS.find((p) => p.key === options.presetKey) ?? LED_PRESETS[0]!;
  return {
    ...base(options.position),
    type: 'led',
    name: options.name ?? preset.label,
    panelKey: options.panelKey ?? preset.panelKey,
    columns: options.columns ?? preset.columns,
    rows: options.rows ?? preset.rows,
    bottomMm: options.bottomMm ?? preset.bottomMm,
    frame: options.frame ?? preset.frame,
    curveDeg: options.curveDeg ?? preset.curveDeg,
    contentUrl: null,
    contentColor: '#0b1220',
    // Enough glow to read as a light source in the room without washing out the
    // objects in front of it, which is what a screen at full brightness does.
    glowIntensity: 0.6,
    brightness: 0.8,
  };
}

/** The size a screen would be if it were built to a target width and height. */
export function fitLed(panelKey: string, targetWidthMm: number, targetHeightMm: number) {
  const panel = ledPanel(panelKey);
  const columns = Math.max(1, Math.round(targetWidthMm / panel.widthMm));
  const rows = Math.max(1, Math.round(targetHeightMm / panel.heightMm));
  return { columns, rows, widthMm: columns * panel.widthMm, heightMm: rows * panel.heightMm };
}

/* ── Booth ─────────────────────────────────────────────────────────────── */

export interface BoothOptions {
  boothType?: BoothType;
  widthMm?: number;
  depthMm?: number;
  heightMm?: number;
  standNumber?: string;
  exhibitorName?: string;
  position?: Vec3;
  rotationDeg?: number;
}

export function createBooth(options: BoothOptions = {}): BoothSceneObject {
  const boothType = options.boothType ?? 'shell-scheme';
  const spec = BOOTH_TYPE_SPECS[boothType];
  const object: BoothSceneObject = {
    ...base(options.position),
    type: 'booth',
    name: options.exhibitorName || options.standNumber || spec.label,
    boothType,
    widthMm: options.widthMm ?? 3000,
    depthMm: options.depthMm ?? 3000,
    // Start at the height the organiser normally permits, not at the maximum:
    // a stand that starts illegal is a bad first impression of the checker.
    heightMm: options.heightMm ?? Math.min(2500, spec.typicalHeightLimitMm),
    walls: [...spec.defaultWalls],
    wallFinish: 'modular-system',
    wallColor: '#e6e3dc',
    floorFinish: 'carpet',
    floorColor: '#4b5563',
    platformHeightMm: 0,
    fascia: spec.fascia,
    fasciaHeightMm: 300,
    fasciaText: options.exhibitorName ?? '',
    fasciaColor: '#1f2937',
    storeRoom: false,
    counter: true,
    standNumber: options.standNumber,
    exhibitorName: options.exhibitorName,
  };
  if (options.rotationDeg) object.rotationDeg = { x: 0, y: options.rotationDeg, z: 0 };
  return object;
}

/* ── Lighting ──────────────────────────────────────────────────────────── */

export interface LightOptions {
  fixture?: LightFixtureKey;
  role?: LightRole;
  position?: Vec3;
  targetMm?: Vec3;
  color?: string;
  channel?: string;
  name?: string;
}

export function createLight(options: LightOptions = {}): LightFixtureSceneObject {
  const fixture = options.fixture ?? 'par-can';
  const defaults = fixtureDefaults(fixture);
  const position = options.position ?? { x: 0, y: 4000, z: 0 };
  return {
    ...base(position),
    type: 'light',
    name: options.name ?? defaults.fixture,
    ...defaults,
    ...(options.role ? { role: options.role } : {}),
    ...(options.color ? { color: options.color } : {}),
    ...(options.channel ? { channel: options.channel } : {}),
    // Aim at the floor directly below by default. A fixture pointing nowhere
    // looks broken, and "straight down" is the only aim that is never wrong.
    targetMm: options.targetMm ?? { x: position.x, y: 0, z: position.z },
  };
}

/* ── Constraints ───────────────────────────────────────────────────────── */

export interface ConstraintOptions {
  kind: ConstraintKind;
  points?: WallPoint[];
  position?: Vec3;
  label?: string;
}

export function createConstraint(options: ConstraintOptions): ConstraintSceneObject {
  const defaults = constraintDefaults(options.kind);
  return {
    ...base(options.position),
    type: 'constraint',
    name: options.label ?? defaults.label,
    ...defaults,
    ...(options.label ? { label: options.label } : {}),
    points: options.points ?? defaults.points,
  };
}

/** A rectangular constraint area, centred on a point. */
export function constraintRectangle(kind: ConstraintKind, centre: Vec3, widthMm: number, depthMm: number, label?: string) {
  const halfW = widthMm / 2;
  const halfD = depthMm / 2;
  return createConstraint({
    kind,
    position: centre,
    label,
    points: [
      { xMm: -halfW, zMm: -halfD },
      { xMm: halfW, zMm: -halfD },
      { xMm: halfW, zMm: halfD },
      { xMm: -halfW, zMm: halfD },
    ],
  });
}

/* ── Naming ────────────────────────────────────────────────────────────── */

/**
 * A unique display name.
 *
 * "Goalpost run" twice in an object list is the point at which a plan becomes
 * hard to talk about, and numbering by hand is a chore nobody does. Counts the
 * existing objects of the same base name rather than the total, so deleting the
 * third of four does not produce two objects called "Truss 4".
 */
export function uniqueName(objects: SceneObject[], baseName: string): string {
  const taken = new Set(objects.map((o) => o.name).filter(Boolean));
  if (!taken.has(baseName)) return baseName;
  for (let n = 2; n < 999; n += 1) {
    const candidate = `${baseName} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${baseName} ${Date.now()}`;
}
