/**
 * The lighting engine.
 *
 * Lighting is what separates a render that looks like a plan from one that
 * looks like the event, so the controls here are the ones a lighting designer
 * actually reaches for — fixture type, beam angle, intensity, colour, gobo —
 * and not the raw three.js parameters underneath them.
 *
 * Two decisions shape this module:
 *
 * **Fixtures are named, not numeric.** "Source Four 26°" is something you hire.
 * `spotLight, angle 0.227` is not. Every fixture below carries the real beam
 * angle, output and power draw, so the same object that lights the render also
 * feeds the power budget and the equipment list.
 *
 * **Auto Light Scene is a rig, not a preset colour.** Pressing it works out
 * where the stage is, where the audience is, and hangs a key, a fill, a back
 * rim and a wash accordingly. A preset that only changed the ambient colour
 * would look like a filter; this looks like a lighting plot.
 */
import type { SceneObject, Vec3 } from './scene.js';

/* ── Fixture types ─────────────────────────────────────────────────────── */

export const LIGHT_FIXTURES = [
  'profile-spot',
  'fresnel',
  'par-can',
  'wash',
  'moving-head-spot',
  'moving-head-wash',
  'beam',
  'blinder',
  'strip-batten',
  'uplighter',
  'follow-spot',
  'gobo-projector',
  'pinspot',
  'floor-wash',
] as const;
export type LightFixtureKey = (typeof LIGHT_FIXTURES)[number];

export interface LightFixtureSpec {
  key: LightFixtureKey;
  label: string;
  note: string;
  /** Default cone angle, full width in degrees. */
  beamAngleDeg: number;
  /** Range the beam can be zoomed to, where the fixture zooms at all. */
  minBeamDeg: number;
  maxBeamDeg: number;
  /** Soft edge as a fraction of the cone. A profile is hard; a wash is not. */
  softness: number;
  /** Relative brightness, 1 being a typical LED PAR at full. */
  intensity: number;
  /** Electrical draw, for the power budget. */
  wattage: number;
  weightKg: number;
  /** Whether it is normally rigged overhead, on the floor, or either. */
  mount: 'rigged' | 'floor' | 'either';
  /** Whether the fixture projects a pattern. */
  canGobo: boolean;
  /** Whether it throws a visible beam in haze — decides the volumetric default. */
  volumetric: boolean;
  defaultColor: string;
  /** Typical distance the fixture is designed to throw, in millimetres. */
  throwMm: number;
}

export const LIGHT_FIXTURE_SPECS: Record<LightFixtureKey, LightFixtureSpec> = {
  'profile-spot': {
    key: 'profile-spot',
    label: 'Profile spot',
    note: 'Hard-edged, shutters to shape. The fixture that lights a lectern cleanly.',
    beamAngleDeg: 26,
    minBeamDeg: 15,
    maxBeamDeg: 50,
    softness: 0.15,
    intensity: 1.6,
    wattage: 300,
    weightKg: 8.5,
    mount: 'rigged',
    canGobo: true,
    volumetric: true,
    defaultColor: '#fff4e2',
    throwMm: 9000,
  },
  fresnel: {
    key: 'fresnel',
    label: 'Fresnel',
    note: 'Soft-edged and blends invisibly with its neighbours. The classic stage wash.',
    beamAngleDeg: 40,
    minBeamDeg: 15,
    maxBeamDeg: 65,
    softness: 0.55,
    intensity: 1.3,
    wattage: 200,
    weightKg: 6.5,
    mount: 'rigged',
    canGobo: false,
    volumetric: true,
    defaultColor: '#fff1d9',
    throwMm: 7000,
  },
  'par-can': {
    key: 'par-can',
    label: 'LED PAR',
    note: 'The workhorse colour fixture. Cheap, bright, everywhere.',
    beamAngleDeg: 30,
    minBeamDeg: 10,
    maxBeamDeg: 45,
    softness: 0.4,
    intensity: 1.0,
    wattage: 120,
    weightKg: 3.2,
    mount: 'either',
    canGobo: false,
    volumetric: true,
    defaultColor: '#ffffff',
    throwMm: 6000,
  },
  wash: {
    key: 'wash',
    label: 'LED wash',
    note: 'Wide, even colour across a surface. What you light a backdrop with.',
    beamAngleDeg: 55,
    minBeamDeg: 25,
    maxBeamDeg: 80,
    softness: 0.7,
    intensity: 1.1,
    wattage: 200,
    weightKg: 5.0,
    mount: 'either',
    canGobo: false,
    volumetric: false,
    defaultColor: '#ffffff',
    throwMm: 6000,
  },
  'moving-head-spot': {
    key: 'moving-head-spot',
    label: 'Moving head spot',
    note: 'Motorised, gobos and colour on a wheel. The programmable workhorse.',
    beamAngleDeg: 20,
    minBeamDeg: 8,
    maxBeamDeg: 40,
    softness: 0.2,
    intensity: 1.8,
    wattage: 350,
    weightKg: 22,
    mount: 'either',
    canGobo: true,
    volumetric: true,
    defaultColor: '#ffffff',
    throwMm: 14000,
  },
  'moving-head-wash': {
    key: 'moving-head-wash',
    label: 'Moving head wash',
    note: 'Motorised soft wash with zoom. Colours a room and moves with it.',
    beamAngleDeg: 45,
    minBeamDeg: 12,
    maxBeamDeg: 65,
    softness: 0.65,
    intensity: 1.5,
    wattage: 400,
    weightKg: 20,
    mount: 'either',
    canGobo: false,
    volumetric: true,
    defaultColor: '#ffffff',
    throwMm: 12000,
  },
  beam: {
    key: 'beam',
    label: 'Beam',
    note: 'A tight parallel shaft in haze. Nothing lands on a surface; it is the beam itself.',
    beamAngleDeg: 4,
    minBeamDeg: 2,
    maxBeamDeg: 10,
    softness: 0.05,
    intensity: 2.4,
    wattage: 280,
    weightKg: 17,
    mount: 'either',
    canGobo: true,
    volumetric: true,
    defaultColor: '#dbe7ff',
    throwMm: 25000,
  },
  blinder: {
    key: 'blinder',
    label: 'Blinder',
    note: 'Points at the audience for the hit. Two or four cells of raw warm light.',
    beamAngleDeg: 70,
    minBeamDeg: 60,
    maxBeamDeg: 90,
    softness: 0.8,
    intensity: 2.6,
    wattage: 650,
    weightKg: 9,
    mount: 'rigged',
    canGobo: false,
    volumetric: false,
    defaultColor: '#ffd9a0',
    throwMm: 12000,
  },
  'strip-batten': {
    key: 'strip-batten',
    label: 'Strip / batten',
    note: 'A linear bar for cyc and set washes, or a floor edge.',
    beamAngleDeg: 60,
    minBeamDeg: 40,
    maxBeamDeg: 90,
    softness: 0.75,
    intensity: 0.9,
    wattage: 150,
    weightKg: 4.5,
    mount: 'either',
    canGobo: false,
    volumetric: false,
    defaultColor: '#ffffff',
    throwMm: 3000,
  },
  uplighter: {
    key: 'uplighter',
    label: 'Uplighter',
    note: 'Battery LED against a wall or pillar. The whole look of most gala rooms.',
    beamAngleDeg: 25,
    minBeamDeg: 15,
    maxBeamDeg: 45,
    softness: 0.5,
    intensity: 0.8,
    wattage: 15,
    weightKg: 2.4,
    mount: 'floor',
    canGobo: false,
    volumetric: false,
    defaultColor: '#8b5cf6',
    throwMm: 5000,
  },
  'follow-spot': {
    key: 'follow-spot',
    label: 'Follow spot',
    note: 'Operated live to keep a person lit as they move.',
    beamAngleDeg: 12,
    minBeamDeg: 5,
    maxBeamDeg: 22,
    softness: 0.25,
    intensity: 2.2,
    wattage: 700,
    weightKg: 32,
    mount: 'rigged',
    canGobo: false,
    volumetric: true,
    defaultColor: '#fff8ec',
    throwMm: 30000,
  },
  'gobo-projector': {
    key: 'gobo-projector',
    label: 'Gobo projector',
    note: 'A fixed pattern or logo thrown onto a wall or floor.',
    beamAngleDeg: 22,
    minBeamDeg: 10,
    maxBeamDeg: 40,
    softness: 0.1,
    intensity: 1.4,
    wattage: 200,
    weightKg: 7,
    mount: 'either',
    canGobo: true,
    volumetric: true,
    defaultColor: '#ffffff',
    throwMm: 8000,
  },
  pinspot: {
    key: 'pinspot',
    label: 'Pinspot',
    note: 'A narrow shaft on a centrepiece or a cake. Small and specific.',
    beamAngleDeg: 8,
    minBeamDeg: 5,
    maxBeamDeg: 14,
    softness: 0.2,
    intensity: 1.1,
    wattage: 30,
    weightKg: 0.9,
    mount: 'rigged',
    canGobo: false,
    volumetric: false,
    defaultColor: '#fffaf0',
    throwMm: 6000,
  },
  'floor-wash': {
    key: 'floor-wash',
    label: 'Floor wash',
    note: 'Sits on the deck and washes upward across a backdrop or drape.',
    beamAngleDeg: 65,
    minBeamDeg: 40,
    maxBeamDeg: 90,
    softness: 0.8,
    intensity: 1.0,
    wattage: 180,
    weightKg: 5.5,
    mount: 'floor',
    canGobo: false,
    volumetric: false,
    defaultColor: '#ffffff',
    throwMm: 5000,
  },
};

export const LIGHT_FIXTURE_LIST: LightFixtureSpec[] = LIGHT_FIXTURES.map((k) => LIGHT_FIXTURE_SPECS[k]);

/* ── Gobos ─────────────────────────────────────────────────────────────── */

export const GOBO_PATTERNS = ['none', 'breakup', 'leaves', 'stars', 'window', 'lines', 'dots', 'logo'] as const;
export type GoboPattern = (typeof GOBO_PATTERNS)[number];

export const GOBO_INFO: Record<GoboPattern, { label: string; note: string }> = {
  none: { label: 'Open (no gobo)', note: 'A clean beam.' },
  breakup: { label: 'Breakup', note: 'Irregular texture that stops a wash looking flat.' },
  leaves: { label: 'Foliage', note: 'Dappled leaf shadow — garden parties and marquees.' },
  stars: { label: 'Stars', note: 'Scattered points across a ceiling or drape.' },
  window: { label: 'Window', note: 'Hard frames of light, as if daylight were coming in.' },
  lines: { label: 'Linear', note: 'Parallel bars. Reads as architecture rather than decoration.' },
  dots: { label: 'Dots', note: 'Even circles; good on a dance floor.' },
  logo: { label: 'Custom logo', note: 'A client monogram cut as a steel or glass gobo.' },
};

/* ── Roles, used by Auto Light Scene ───────────────────────────────────── */

export const LIGHT_ROLES = ['key', 'fill', 'rim', 'wash', 'accent', 'audience', 'practical'] as const;
export type LightRole = (typeof LIGHT_ROLES)[number];

export const LIGHT_ROLE_INFO: Record<LightRole, { label: string; note: string }> = {
  key: { label: 'Key', note: 'The main light on faces. Everything else is judged against it.' },
  fill: { label: 'Fill', note: 'Softens the shadow the key leaves. Never brighter than the key.' },
  rim: { label: 'Back / rim', note: 'From behind, separating people from the backdrop.' },
  wash: { label: 'Wash', note: 'Colour across a surface — a backdrop, a wall, a floor.' },
  accent: { label: 'Accent', note: 'Picks out one thing: a logo, a cake, a centrepiece.' },
  audience: { label: 'Audience', note: 'Light on the room, so a camera sees more than a black void.' },
  practical: { label: 'Practical', note: 'A fixture that is part of the set and visible in shot.' },
};

/* ── Looks ─────────────────────────────────────────────────────────────── */

export interface LightingLook {
  key: string;
  label: string;
  note: string;
  /** Colour of the key light. */
  keyColor: string;
  fillColor: string;
  rimColor: string;
  /** Two colours the room wash alternates between. */
  washColors: [string, string];
  /** Overall level, 1 being a normally exposed room. */
  level: number;
  /** How much of the room sits in shadow. Higher is more dramatic. */
  contrast: number;
  /** Haze density; beams are invisible without it. */
  haze: number;
  /** Ambient bounce, which is what makes a room feel bright rather than lit. */
  ambient: number;
  gobo: GoboPattern;
  /** Suggested environment preset from the scene lighting list. */
  environment: string;
}

/**
 * The four looks the brief names, plus the two everyone asks for next. Each is
 * a complete relationship between key, fill, rim and room — changing one colour
 * without the others is what makes amateur lighting look amateur.
 */
export const LIGHTING_LOOKS: LightingLook[] = [
  {
    key: 'corporate-summit',
    label: 'Corporate summit',
    note: 'Even, neutral, camera-safe. Faces read correctly and the brand colour lives on the walls.',
    keyColor: '#fff6e8',
    fillColor: '#eef2ff',
    rimColor: '#dbeafe',
    washColors: ['#1d4ed8', '#0ea5e9'],
    level: 1.0,
    contrast: 0.35,
    haze: 0.15,
    ambient: 0.55,
    gobo: 'none',
    environment: 'st_fagans_interior',
  },
  {
    key: 'gala-dinner',
    label: 'Gala dinner',
    note: 'Warm and low. Tables lit enough to eat by, walls in colour, everything else soft.',
    keyColor: '#ffd9a8',
    fillColor: '#ffcf94',
    rimColor: '#ffe6c2',
    washColors: ['#7c3aed', '#c026d3'],
    level: 0.62,
    contrast: 0.65,
    haze: 0.25,
    ambient: 0.28,
    gobo: 'breakup',
    environment: 'dikhololo_night',
  },
  {
    key: 'tech-launch',
    label: 'Tech launch',
    note: 'Cool, hard and graphic. Deep shadow, sharp beams, one accent colour.',
    keyColor: '#eaf2ff',
    fillColor: '#93c5fd',
    rimColor: '#38bdf8',
    washColors: ['#0f172a', '#2563eb'],
    level: 0.8,
    contrast: 0.8,
    haze: 0.45,
    ambient: 0.18,
    gobo: 'lines',
    environment: 'studio_small_03',
  },
  {
    key: 'concert',
    label: 'Concert',
    note: 'Saturated, high contrast, beams doing the work. The room disappears.',
    keyColor: '#ffffff',
    fillColor: '#0072FD',
    rimColor: '#f43f5e',
    washColors: ['#db2777', '#22d3ee'],
    level: 0.9,
    contrast: 0.92,
    haze: 0.7,
    ambient: 0.1,
    gobo: 'dots',
    environment: 'dikhololo_night',
  },
  {
    key: 'wedding-warm',
    label: 'Wedding',
    note: 'Candle-warm, gentle contrast, foliage texture on the walls.',
    keyColor: '#ffe3bd',
    fillColor: '#ffd7ae',
    rimColor: '#fff0d6',
    washColors: ['#f59e0b', '#f472b6'],
    level: 0.7,
    contrast: 0.5,
    haze: 0.2,
    ambient: 0.35,
    gobo: 'leaves',
    environment: 'venice_sunset',
  },
  {
    key: 'exhibition-daylight',
    label: 'Exhibition daylight',
    note: 'Flat, bright and neutral, matching a hall lit from the roof. Stands read as built.',
    keyColor: '#ffffff',
    fillColor: '#f8fafc',
    rimColor: '#ffffff',
    washColors: ['#e2e8f0', '#cbd5e1'],
    level: 1.15,
    contrast: 0.18,
    haze: 0.0,
    ambient: 0.8,
    gobo: 'none',
    environment: 'empty_warehouse_01',
  },
];

export const LIGHTING_LOOK_MAP: Record<string, LightingLook> = Object.fromEntries(
  LIGHTING_LOOKS.map((l) => [l.key, l])
);

export function lightingLook(key: string | undefined | null): LightingLook {
  return LIGHTING_LOOK_MAP[key ?? ''] ?? LIGHTING_LOOKS[0]!;
}

/* ── A placed fixture ──────────────────────────────────────────────────── */

export interface LightFixtureData {
  fixture: LightFixtureKey;
  role: LightRole;
  color: string;
  /** Multiplier on the fixture's own output. 1 is full. */
  intensity: number;
  beamAngleDeg: number;
  softness: number;
  /** Aim point, in plan-space millimetres, absolute rather than relative — a
   *  light that keeps aiming at the lectern when it is moved is the behaviour
   *  people expect from a rig. */
  targetMm: Vec3;
  gobo: GoboPattern;
  goboRotationDeg: number;
  /** Draw the cone in haze. */
  volumetric: boolean;
  castShadow: boolean;
  /** Fixtures with the same channel are dimmed and coloured together. */
  channel: string;
  /** Turned off without being deleted, exactly like a rig check. */
  muted?: boolean;
}

export const DEFAULT_LIGHT_FIXTURE: LightFixtureData = {
  fixture: 'par-can',
  role: 'wash',
  color: '#ffffff',
  intensity: 1,
  beamAngleDeg: 30,
  softness: 0.4,
  targetMm: { x: 0, y: 0, z: 0 },
  gobo: 'none',
  goboRotationDeg: 0,
  volumetric: false,
  castShadow: false,
  channel: 'A',
};

export function fixtureDefaults(key: LightFixtureKey): LightFixtureData {
  const spec = LIGHT_FIXTURE_SPECS[key];
  return {
    ...DEFAULT_LIGHT_FIXTURE,
    fixture: key,
    color: spec.defaultColor,
    beamAngleDeg: spec.beamAngleDeg,
    softness: spec.softness,
    volumetric: spec.volumetric,
    castShadow: spec.key === 'profile-spot' || spec.key === 'gobo-projector',
  };
}

/* ── Power and equipment ───────────────────────────────────────────────── */

export interface LightingLoadLine {
  fixture: LightFixtureKey;
  label: string;
  count: number;
  wattsEach: number;
  wattsTotal: number;
  weightKg: number;
}

export interface LightingLoad {
  lines: LightingLoadLine[];
  totalWatts: number;
  totalWeightKg: number;
  /** Total draw as 230 V single-phase amps. */
  amps230: number;
  /** How many 16 A circuits that needs, at 80 % loading. */
  circuits16A: number;
  /** DMX universes, at 512 channels and a nominal channel count per fixture. */
  dmxUniverses: number;
  fixtureCount: number;
}

/**
 * Channels per fixture. Moving lights eat DMX; a dumb PAR does not. Approximate
 * by class rather than by exact profile, which is the level of accuracy that is
 * useful before a real patch exists.
 */
const DMX_CHANNELS: Partial<Record<LightFixtureKey, number>> = {
  'moving-head-spot': 24,
  'moving-head-wash': 20,
  beam: 20,
  'profile-spot': 6,
  'gobo-projector': 4,
  wash: 8,
  'par-can': 6,
  'strip-batten': 10,
  uplighter: 6,
  blinder: 4,
  fresnel: 2,
  'follow-spot': 1,
  pinspot: 1,
  'floor-wash': 6,
};

export function lightingLoad(fixtures: Array<{ fixture: LightFixtureKey }>): LightingLoad {
  const counts = new Map<LightFixtureKey, number>();
  for (const f of fixtures) counts.set(f.fixture, (counts.get(f.fixture) ?? 0) + 1);

  const lines: LightingLoadLine[] = [];
  let totalWatts = 0;
  let totalWeightKg = 0;
  let channels = 0;

  for (const [key, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const spec = LIGHT_FIXTURE_SPECS[key];
    const watts = spec.wattage * count;
    lines.push({
      fixture: key,
      label: spec.label,
      count,
      wattsEach: spec.wattage,
      wattsTotal: watts,
      weightKg: Math.round(spec.weightKg * count * 10) / 10,
    });
    totalWatts += watts;
    totalWeightKg += spec.weightKg * count;
    channels += (DMX_CHANNELS[key] ?? 4) * count;
  }

  const amps230 = Math.round((totalWatts / 230) * 10) / 10;
  return {
    lines,
    totalWatts,
    totalWeightKg: Math.round(totalWeightKg * 10) / 10,
    amps230,
    // 80 % of a 16 A circuit is the figure electricians design to.
    circuits16A: Math.ceil(amps230 / (16 * 0.8)) || 0,
    dmxUniverses: Math.max(channels > 0 ? 1 : 0, Math.ceil(channels / 512)),
    fixtureCount: fixtures.length,
  };
}

/* ── Auto Light Scene ──────────────────────────────────────────────────── */

export interface AutoLightSubject {
  /** Centre of the thing being lit, in plan millimetres. */
  centreMm: Vec3;
  widthMm: number;
  depthMm: number;
  /** Height of the deck or surface the subject stands on. */
  heightMm: number;
  kind: 'stage' | 'screen' | 'backdrop' | 'table' | 'booth' | 'room';
}

export interface AutoLightRequest {
  look: string;
  subjects: AutoLightSubject[];
  /** Room extents, so a wash can be placed against the walls. */
  roomWidthMm: number;
  roomDepthMm: number;
  /** Trim height available to rig at. */
  trimHeightMm: number;
  /** Where the audience is, so rim light goes behind the subject and not in front. */
  audienceCentreMm?: Vec3;
}

export interface AutoLightPlacement extends LightFixtureData {
  /** Position of the fixture itself. */
  positionMm: Vec3;
  name: string;
}

/**
 * Build a rig.
 *
 * The classic three-point setup is the spine — key at 45° to one side and
 * above, fill opposite and lower, rim behind — with a wash for the room and
 * accents on anything that deserves picking out. It is generated from the
 * geometry rather than hard-coded positions, so it lands correctly whatever
 * size the stage is and wherever it sits in the room.
 */
export function autoLightScene(request: AutoLightRequest): AutoLightPlacement[] {
  const look = lightingLook(request.look);
  const out: AutoLightPlacement[] = [];
  const trim = Math.max(2500, request.trimHeightMm);

  const primary =
    request.subjects.find((s) => s.kind === 'stage') ??
    request.subjects.find((s) => s.kind === 'screen') ??
    request.subjects[0] ??
    null;

  const audience = request.audienceCentreMm ?? { x: 0, y: 0, z: (request.roomDepthMm / 2) * 0.6 };

  if (primary) {
    const target: Vec3 = {
      x: primary.centreMm.x,
      // Aim at chest height on the deck, not at the floor — this is what makes
      // faces read rather than shoes.
      y: primary.heightMm + 1400,
      z: primary.centreMm.z,
    };

    // Which way the audience lies, so front lights sit in front and rims behind.
    const toAudience = Math.sign(audience.z - primary.centreMm.z) || 1;
    const frontOffset = Math.max(4000, primary.depthMm * 1.4);
    const sideOffset = Math.max(2500, primary.widthMm * 0.45);

    out.push({
      ...fixtureDefaults('profile-spot'),
      name: 'Key — stage front left',
      role: 'key',
      color: look.keyColor,
      intensity: 1.0 * look.level,
      castShadow: true,
      volumetric: look.haze > 0.2,
      channel: 'KEY',
      targetMm: target,
      positionMm: {
        x: primary.centreMm.x - sideOffset,
        y: trim,
        z: primary.centreMm.z + frontOffset * toAudience,
      },
    });

    out.push({
      ...fixtureDefaults('fresnel'),
      name: 'Fill — stage front right',
      role: 'fill',
      color: look.fillColor,
      // Fill is deliberately below the key. Matching them flattens every face.
      intensity: (1 - look.contrast) * 0.9 * look.level,
      volumetric: false,
      channel: 'FILL',
      targetMm: target,
      positionMm: {
        x: primary.centreMm.x + sideOffset,
        y: trim * 0.85,
        z: primary.centreMm.z + frontOffset * toAudience,
      },
    });

    out.push({
      ...fixtureDefaults('moving-head-spot'),
      name: 'Rim — upstage',
      role: 'rim',
      color: look.rimColor,
      intensity: 1.2 * look.level,
      volumetric: look.haze > 0.1,
      channel: 'RIM',
      targetMm: target,
      positionMm: {
        x: primary.centreMm.x,
        y: trim,
        z: primary.centreMm.z - frontOffset * 0.7 * toAudience,
      },
    });

    // A backdrop or screen behind the stage gets its own wash so it is not lit
    // by spill from the key, which always reads as a hot patch in the middle.
    const backdrop = request.subjects.find((s) => s.kind === 'screen' || s.kind === 'backdrop');
    if (backdrop) {
      const washCount = Math.max(2, Math.min(8, Math.ceil(backdrop.widthMm / 2500)));
      for (let i = 0; i < washCount; i += 1) {
        const t = washCount === 1 ? 0.5 : i / (washCount - 1);
        const x = backdrop.centreMm.x - backdrop.widthMm / 2 + backdrop.widthMm * t;
        out.push({
          ...fixtureDefaults('floor-wash'),
          name: `Backdrop wash ${i + 1}`,
          role: 'wash',
          color: i % 2 === 0 ? look.washColors[0] : look.washColors[1],
          intensity: 0.9 * look.level,
          channel: 'BACK',
          targetMm: { x, y: backdrop.heightMm + 2000, z: backdrop.centreMm.z },
          positionMm: { x, y: 300, z: backdrop.centreMm.z + 1200 * toAudience },
        });
      }
    }

    // Audience light, so a camera sees a room rather than a black void. Kept
    // deliberately dim in the high-contrast looks.
    out.push({
      ...fixtureDefaults('wash'),
      name: 'Audience wash',
      role: 'audience',
      color: look.fillColor,
      intensity: Math.max(0.15, (1 - look.contrast) * 0.7) * look.level,
      channel: 'AUD',
      targetMm: { x: audience.x, y: 1200, z: audience.z },
      positionMm: { x: audience.x, y: trim, z: primary.centreMm.z + frontOffset * 0.4 * toAudience },
    });
  }

  /*
   * Room uplighters against the walls. This is the single change that makes a
   * plain room look like an event, and it is priced per fixture, so the count
   * is derived from the perimeter rather than picked.
   */
  const perimeterMm = 2 * (request.roomWidthMm + request.roomDepthMm);
  const upCount = Math.max(0, Math.min(48, Math.round(perimeterMm / 3000)));
  const halfW = request.roomWidthMm / 2;
  const halfD = request.roomDepthMm / 2;
  for (let i = 0; i < upCount; i += 1) {
    const t = i / upCount;
    const perimeterAt = t * perimeterMm;
    let x = 0;
    let z = 0;
    if (perimeterAt < request.roomWidthMm) {
      x = -halfW + perimeterAt;
      z = -halfD;
    } else if (perimeterAt < request.roomWidthMm + request.roomDepthMm) {
      x = halfW;
      z = -halfD + (perimeterAt - request.roomWidthMm);
    } else if (perimeterAt < 2 * request.roomWidthMm + request.roomDepthMm) {
      x = halfW - (perimeterAt - request.roomWidthMm - request.roomDepthMm);
      z = halfD;
    } else {
      x = -halfW;
      z = halfD - (perimeterAt - 2 * request.roomWidthMm - request.roomDepthMm);
    }
    out.push({
      ...fixtureDefaults('uplighter'),
      name: `Uplighter ${i + 1}`,
      role: 'wash',
      color: i % 2 === 0 ? look.washColors[0] : look.washColors[1],
      intensity: 0.85 * look.level,
      gobo: 'none',
      channel: 'UP',
      targetMm: { x: Math.round(x * 0.92), y: Math.min(trim, 4000), z: Math.round(z * 0.92) },
      positionMm: { x: Math.round(x * 0.97), y: 120, z: Math.round(z * 0.97) },
    });
  }

  // Accents: one pinspot per banquet table, one gobo per booth, capped so a
  // 60-table room does not generate 60 fixtures no one asked for.
  const accents = request.subjects.filter((s) => s.kind === 'table' || s.kind === 'booth').slice(0, 24);
  for (const [i, subject] of accents.entries()) {
    const isTable = subject.kind === 'table';
    out.push({
      ...fixtureDefaults(isTable ? 'pinspot' : 'gobo-projector'),
      name: isTable ? `Table pinspot ${i + 1}` : `Booth gobo ${i + 1}`,
      role: 'accent',
      color: look.keyColor,
      intensity: 0.9 * look.level,
      gobo: isTable ? 'none' : look.gobo,
      channel: 'ACC',
      targetMm: { x: subject.centreMm.x, y: subject.heightMm, z: subject.centreMm.z },
      positionMm: { x: subject.centreMm.x, y: trim, z: subject.centreMm.z },
    });
  }

  return out;
}

/**
 * Read subjects out of a scene document's objects.
 *
 * Auto Light Scene needs to know what is worth lighting; this is the only
 * place that maps scene object types onto lighting subjects, so adding a new
 * object type that deserves light is a one-line change here.
 */
export function subjectsFromObjects(objects: SceneObject[]): AutoLightSubject[] {
  const subjects: AutoLightSubject[] = [];
  for (const object of objects) {
    if (object.hidden) continue;
    const centre = object.positionMm;
    if (!centre) continue;

    if (object.type === 'stage') {
      const stage = object as SceneObject & { deckColumns: number; deckRows: number; deckHeightMm: number };
      subjects.push({
        centreMm: centre,
        widthMm: (stage.deckColumns ?? 1) * 1219,
        depthMm: (stage.deckRows ?? 1) * 1219,
        heightMm: stage.deckHeightMm ?? 0,
        kind: 'stage',
      });
    } else if (object.type === 'led') {
      const led = object as SceneObject & { columns: number; rows: number; bottomMm: number; panelKey: string };
      subjects.push({
        centreMm: centre,
        widthMm: (led.columns ?? 1) * 500,
        depthMm: 500,
        heightMm: led.bottomMm ?? 0,
        kind: 'screen',
      });
    } else if (object.type === 'curtain') {
      const curtain = object as SceneObject & { middleWidthMm: number; heightMm: number };
      subjects.push({
        centreMm: centre,
        widthMm: curtain.middleWidthMm ?? 4000,
        depthMm: 400,
        heightMm: 0,
        kind: 'backdrop',
      });
    } else if (object.type === 'booth') {
      const booth = object as SceneObject & { widthMm: number; depthMm: number; heightMm: number };
      subjects.push({
        centreMm: centre,
        widthMm: booth.widthMm ?? 3000,
        depthMm: booth.depthMm ?? 3000,
        heightMm: booth.heightMm ?? 2500,
        kind: 'booth',
      });
    } else if (object.type === 'catalog') {
      const item = object as SceneObject & {
        tableShape?: string | null;
        dimensionsMm?: { width: number; depth: number; height: number };
      };
      if (item.tableShape && item.dimensionsMm) {
        subjects.push({
          centreMm: centre,
          widthMm: item.dimensionsMm.width,
          depthMm: item.dimensionsMm.depth,
          heightMm: item.dimensionsMm.height,
          kind: 'table',
        });
      }
    }
  }
  return subjects;
}
