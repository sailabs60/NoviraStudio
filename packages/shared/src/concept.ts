/**
 * The concept generator.
 *
 * "Modern banking summit stage with a curved LED wall" has to become a room:
 * a stage of the right size, a screen in front of it, seating that faces it,
 * truss over it and a lighting look to match. That is the request in the brief,
 * and it is doable well before any model is involved.
 *
 * **This layer is deterministic on purpose.** An LLM is excellent at reading a
 * sentence and terrible at producing a 12.8 m stage that is actually 12.8 m.
 * So the language model's job — where one is configured at all — is only to
 * turn prose into the `ConceptBrief` below. Everything after that is
 * arithmetic, which means the room is the size it says it is, the seats fit,
 * and the same brief always produces the same layout.
 *
 * Without a model configured, `parseBrief` reads the prompt directly. It is a
 * keyword parser and it says so, but it handles the sentences people actually
 * type, and it means the feature works on an account with no AI credits at all.
 */
import { DEFAULT_BOOTH_REGULATIONS, generateBoothGrid, type BoothType } from './booth.js';
import { fitLedScreen, LED_PRESETS } from './led.js';
import { LIGHTING_LOOKS } from './lighting.js';
import { TRUSS_SHAPE_INFO, type TrussShape } from './truss.js';

/* ── The brief ─────────────────────────────────────────────────────────── */

export const EVENT_KINDS = [
  'conference',
  'summit',
  'gala-dinner',
  'wedding',
  'product-launch',
  'concert',
  'exhibition',
  'awards',
  'workshop',
  'reception',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_KIND_INFO: Record<EventKind, { label: string; note: string; seating: SeatingStyle; look: string }> = {
  conference: { label: 'Conference', note: 'Rows facing a stage, screens either side.', seating: 'theatre', look: 'corporate-summit' },
  summit: { label: 'Summit', note: 'Fewer, better seats and a large single screen.', seating: 'theatre', look: 'corporate-summit' },
  'gala-dinner': { label: 'Gala dinner', note: 'Round tables, a dance floor and a small stage.', seating: 'banquet', look: 'gala-dinner' },
  wedding: { label: 'Wedding', note: 'Ceremony rows or banquet rounds, warm and low.', seating: 'banquet', look: 'wedding-warm' },
  'product-launch': { label: 'Product launch', note: 'A reveal position, press seating and a hard graphic look.', seating: 'theatre', look: 'tech-launch' },
  concert: { label: 'Concert', note: 'Open floor, large stage, heavy rig.', seating: 'standing', look: 'concert' },
  exhibition: { label: 'Exhibition', note: 'A grid of stands with aisles between.', seating: 'exhibition', look: 'exhibition-daylight' },
  awards: { label: 'Awards', note: 'Banquet rounds facing a stage with a long screen.', seating: 'banquet', look: 'gala-dinner' },
  workshop: { label: 'Workshop', note: 'Cabaret or classroom tables, everyone able to write.', seating: 'cabaret', look: 'corporate-summit' },
  reception: { label: 'Reception', note: 'Standing, cocktail tables, bars at the edges.', seating: 'standing', look: 'gala-dinner' },
};

export const SEATING_STYLES = ['theatre', 'banquet', 'cabaret', 'classroom', 'standing', 'u-shape', 'exhibition'] as const;
export type SeatingStyle = (typeof SEATING_STYLES)[number];

export const SEATING_STYLE_INFO: Record<SeatingStyle, { label: string; areaPerPersonSqM: number; note: string }> = {
  theatre: { label: 'Theatre rows', areaPerPersonSqM: 0.75, note: 'Chairs in rows facing one way. The densest seated layout.' },
  banquet: { label: 'Banquet rounds', areaPerPersonSqM: 1.55, note: 'Round tables of ten with service gangways.' },
  cabaret: { label: 'Cabaret', areaPerPersonSqM: 1.75, note: 'Rounds with the stage-facing seats left empty.' },
  classroom: { label: 'Classroom', areaPerPersonSqM: 1.9, note: 'Trestle tables in rows, a writing surface each.' },
  standing: { label: 'Standing', areaPerPersonSqM: 0.65, note: 'No seating; cocktail tables and bars at the edges.' },
  'u-shape': { label: 'U-shape', areaPerPersonSqM: 2.4, note: 'Tables around three sides, everyone facing in.' },
  exhibition: { label: 'Exhibition floor', areaPerPersonSqM: 2.0, note: 'Stands on a grid with aisles.' },
};

export interface ConceptBrief {
  /** What kind of event this is. */
  eventKind: EventKind;
  seating: SeatingStyle;
  /** Expected attendance. Drives every size below. */
  attendance: number;
  /** Room the event is going into, if known. */
  roomWidthMm: number;
  roomDepthMm: number;
  roomHeightMm: number;
  /** Whether the brief asked for a stage, and how it should feel. */
  stage: boolean;
  stageProminence: 'small' | 'standard' | 'large';
  /** Screen shape asked for. */
  screen: 'none' | 'flat' | 'curved' | 'dual' | 'wrap';
  /** Truss over the stage. */
  truss: TrussShape | 'none';
  /** Named lighting look. */
  look: string;
  /** Extras the sentence mentioned. */
  danceFloor: boolean;
  bar: boolean;
  registration: boolean;
  catering: boolean;
  /** Exhibition only. */
  boothCount: number;
  boothType: BoothType;
  /** Free text kept for the record and shown back to the user. */
  prompt: string;
  /** Words the parser recognised, so the user can see what it understood. */
  understood: string[];
  /** Words it could not place, so the user can rephrase. */
  ignored: string[];
}

export const DEFAULT_BRIEF: ConceptBrief = {
  eventKind: 'conference',
  seating: 'theatre',
  attendance: 200,
  roomWidthMm: 24000,
  roomDepthMm: 32000,
  roomHeightMm: 6000,
  stage: true,
  stageProminence: 'standard',
  screen: 'flat',
  truss: 'goalpost',
  look: 'corporate-summit',
  danceFloor: false,
  bar: false,
  registration: false,
  catering: false,
  boothCount: 0,
  boothType: 'shell-scheme',
  prompt: '',
  understood: [],
  ignored: [],
};

/* ── Parsing ───────────────────────────────────────────────────────────── */

interface Keyword<T> {
  words: string[];
  value: T;
}

const EVENT_WORDS: Keyword<EventKind>[] = [
  { words: ['summit', 'forum', 'symposium'], value: 'summit' },
  { words: ['conference', 'convention', 'congress', 'seminar'], value: 'conference' },
  { words: ['gala', 'dinner', 'banquet', 'fundraiser'], value: 'gala-dinner' },
  { words: ['wedding', 'bridal', 'nikah', 'reception dinner'], value: 'wedding' },
  { words: ['launch', 'unveiling', 'reveal', 'keynote'], value: 'product-launch' },
  { words: ['concert', 'gig', 'festival', 'live music', 'dj'], value: 'concert' },
  { words: ['exhibition', 'expo', 'trade show', 'tradeshow', 'showcase', 'fair'], value: 'exhibition' },
  { words: ['awards', 'ceremony', 'prize'], value: 'awards' },
  { words: ['workshop', 'training', 'masterclass', 'breakout'], value: 'workshop' },
  { words: ['cocktail', 'networking', 'mixer', 'drinks'], value: 'reception' },
];

const SEATING_WORDS: Keyword<SeatingStyle>[] = [
  { words: ['theatre', 'theater', 'rows', 'auditorium'], value: 'theatre' },
  { words: ['banquet', 'rounds', 'round tables', 'seated dinner'], value: 'banquet' },
  { words: ['cabaret'], value: 'cabaret' },
  { words: ['classroom', 'trestle', 'writing'], value: 'classroom' },
  { words: ['standing', 'cocktail', 'reception style'], value: 'standing' },
  { words: ['u-shape', 'u shape', 'boardroom', 'horseshoe'], value: 'u-shape' },
];

const SCREEN_WORDS: Keyword<ConceptBrief['screen']>[] = [
  { words: ['curved led', 'curved screen', 'curved wall', 'curve'], value: 'curved' },
  { words: ['dual screen', 'two screens', 'side screens', 'twin'], value: 'dual' },
  { words: ['wrap', 'wraparound', 'immersive', '360'], value: 'wrap' },
  { words: ['led wall', 'screen', 'led', 'projection', 'video wall'], value: 'flat' },
  { words: ['no screen', 'without screen'], value: 'none' },
];

const LOOK_WORDS: Keyword<string>[] = [
  { words: ['corporate', 'business', 'banking', 'professional', 'summit'], value: 'corporate-summit' },
  { words: ['gala', 'elegant', 'luxury', 'black tie', 'warm'], value: 'gala-dinner' },
  { words: ['tech', 'launch', 'futuristic', 'modern', 'minimal', 'sleek'], value: 'tech-launch' },
  { words: ['concert', 'party', 'club', 'high energy', 'dramatic'], value: 'concert' },
  { words: ['wedding', 'romantic', 'candlelit', 'soft'], value: 'wedding-warm' },
  { words: ['exhibition', 'expo', 'daylight', 'bright', 'hall'], value: 'exhibition-daylight' },
];

const TRUSS_WORDS: Keyword<TrussShape | 'none'>[] = [
  { words: ['goalpost', 'goal post', 'stage frame'], value: 'goalpost' },
  { words: ['mother grid', 'grid', 'square truss'], value: 'square' },
  { words: ['arch', 'archway', 'entrance arch'], value: 'arch' },
  { words: ['circle truss', 'ring', 'circular truss'], value: 'circle' },
  { words: ['no truss', 'without truss'], value: 'none' },
];

function findKeyword<T>(text: string, table: Keyword<T>[], understood: string[]): T | null {
  for (const entry of table) {
    for (const word of entry.words) {
      if (text.includes(word)) {
        understood.push(word);
        return entry.value;
      }
    }
  }
  return null;
}

/**
 * Read a prompt into a brief.
 *
 * Longest-phrase-first inside each table, so "curved led wall" is not consumed
 * by "led". Numbers are matched with their unit attached — "500 guests" is
 * attendance, "24 m" is a room dimension — because a bare number in a sentence
 * about an event could be either and guessing wrong produces a room for 24
 * people or a 500-metre hall.
 */
export function parseBrief(prompt: string, base: Partial<ConceptBrief> = {}): ConceptBrief {
  const text = ` ${prompt.toLowerCase().replace(/[^\w\s.-]/g, ' ').replace(/\s+/g, ' ')} `;
  const understood: string[] = [];

  const eventKind = findKeyword(text, EVENT_WORDS, understood) ?? base.eventKind ?? DEFAULT_BRIEF.eventKind;
  const kindInfo = EVENT_KIND_INFO[eventKind];

  const seating = findKeyword(text, SEATING_WORDS, understood) ?? base.seating ?? kindInfo.seating;
  const screen = findKeyword(text, SCREEN_WORDS, understood) ?? base.screen ?? DEFAULT_BRIEF.screen;
  const look = findKeyword(text, LOOK_WORDS, understood) ?? base.look ?? kindInfo.look;
  const truss = findKeyword(text, TRUSS_WORDS, understood) ?? base.truss ?? DEFAULT_BRIEF.truss;

  // Attendance: a number followed by a people word.
  const attendanceMatch =
    text.match(/(\d[\d,]*)\s*(?:people|guests|attendees|pax|delegates|seats|visitors)/) ??
    text.match(/(?:for|of)\s+(\d[\d,]*)\s/);
  const attendance = attendanceMatch
    ? Math.max(1, Number(attendanceMatch[1]!.replace(/,/g, '')))
    : base.attendance ?? DEFAULT_BRIEF.attendance;
  if (attendanceMatch) understood.push(`${attendance} attendees`);

  // Room: "24 x 32 m" or "24m x 32m".
  const roomMatch = text.match(/(\d+(?:\.\d+)?)\s*m?\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)\s*m/);
  let roomWidthMm = base.roomWidthMm ?? 0;
  let roomDepthMm = base.roomDepthMm ?? 0;
  if (roomMatch) {
    roomWidthMm = Math.round(Number(roomMatch[1]) * 1000);
    roomDepthMm = Math.round(Number(roomMatch[2]) * 1000);
    understood.push(`${roomMatch[1]} × ${roomMatch[2]} m room`);
  }

  const boothMatch = text.match(/(\d+)\s*(?:stands|booths|exhibitors)/);
  const boothCount = boothMatch
    ? Number(boothMatch[1])
    : eventKind === 'exhibition'
      ? Math.max(6, Math.round(attendance / 25))
      : base.boothCount ?? 0;
  if (boothMatch) understood.push(`${boothCount} stands`);

  const has = (...words: string[]) => {
    for (const word of words) {
      if (text.includes(word)) {
        understood.push(word);
        return true;
      }
    }
    return false;
  };

  const danceFloor = has('dance floor', 'dancefloor', 'dancing');
  const bar = has('bar', 'drinks station', 'cocktail bar');
  const registration = has('registration', 'check-in', 'checkin', 'welcome desk');
  const catering = has('catering', 'buffet', 'food station', 'canapes');
  const stage = !text.includes('no stage') && (has('stage', 'platform', 'riser', 'podium') || kindInfo.seating !== 'exhibition');

  const stageProminence: ConceptBrief['stageProminence'] = has('large stage', 'main stage', 'big stage')
    ? 'large'
    : has('small stage', 'low stage', 'modest')
      ? 'small'
      : 'standard';

  /*
   * Room size, if the sentence did not give one. Derived from attendance and
   * the seating allowance rather than picked, and laid out on a 3:4 proportion,
   * which is the shape most function rooms are and which puts everyone within a
   * sensible distance of the stage.
   */
  if (!roomWidthMm || !roomDepthMm) {
    const areaSqM = attendance * SEATING_STYLE_INFO[seating].areaPerPersonSqM * 1.45;
    const width = Math.sqrt(areaSqM * 0.75);
    roomWidthMm = Math.max(8000, Math.round((width * 1000) / 500) * 500);
    roomDepthMm = Math.max(10000, Math.round(((areaSqM / width) * 1000) / 500) * 500);
  }

  const roomHeightMm =
    base.roomHeightMm ??
    (eventKind === 'exhibition' || eventKind === 'concert' ? 8000 : attendance > 400 ? 7000 : 5500);

  // Anything left that looks like a content word and was not matched.
  const stopWords = new Set([
    'a', 'an', 'the', 'with', 'and', 'for', 'of', 'in', 'on', 'at', 'to', 'plus',
    'need', 'want', 'would', 'like', 'please', 'create', 'design', 'build', 'make', 'set', 'up',
    'event', 'room', 'space', 'guests', 'people', 'attendees', 'm', 'x', 'by',
  ]);
  const matched = new Set(understood.flatMap((u) => u.split(/\s+/)));
  const ignored = [
    ...new Set(
      text
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 3 && !stopWords.has(w) && !matched.has(w) && !/^\d/.test(w))
    ),
  ].slice(0, 8);

  return {
    eventKind,
    seating,
    attendance,
    roomWidthMm,
    roomDepthMm,
    roomHeightMm,
    stage,
    stageProminence,
    screen,
    truss,
    look,
    danceFloor,
    bar,
    registration,
    catering,
    boothCount,
    boothType: base.boothType ?? DEFAULT_BRIEF.boothType,
    prompt,
    understood: [...new Set(understood)],
    ignored,
  };
}

/* ── The generated concept ─────────────────────────────────────────────── */

export interface ConceptElement {
  kind:
    | 'stage'
    | 'screen'
    | 'truss'
    | 'seating'
    | 'booth-grid'
    | 'dance-floor'
    | 'bar'
    | 'registration'
    | 'catering';
  label: string;
  /** Centre of the element in plan millimetres. */
  xMm: number;
  zMm: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  rotationDeg: number;
  /** Type-specific parameters the caller turns into a real scene object. */
  params: Record<string, unknown>;
  /** Why it was placed where it was, shown in the review step. */
  rationale: string;
}

export interface ConceptCamera {
  name: string;
  positionMm: { x: number; y: number; z: number };
  targetMm: { x: number; y: number; z: number };
  fov: number;
  note: string;
}

export interface ConceptResult {
  brief: ConceptBrief;
  elements: ConceptElement[];
  cameras: ConceptCamera[];
  /** Room the layout was fitted into. */
  roomWidthMm: number;
  roomDepthMm: number;
  roomHeightMm: number;
  /** Named look to apply. */
  look: string;
  /** Plain-English account of what was made and why. */
  summary: string[];
  warnings: string[];
}

/** Stage size by attendance — the figures a production manager would use. */
function stageSize(attendance: number, prominence: ConceptBrief['stageProminence']) {
  const base =
    attendance < 100
      ? { width: 4877, depth: 2438, height: 305 }
      : attendance < 300
        ? { width: 7315, depth: 3658, height: 457 }
        : attendance < 800
          ? { width: 9754, depth: 4877, height: 610 }
          : { width: 14630, depth: 6096, height: 914 };
  const factor = prominence === 'large' ? 1.35 : prominence === 'small' ? 0.7 : 1;
  return {
    width: Math.round((base.width * factor) / 1219) * 1219,
    depth: Math.round((base.depth * factor) / 1219) * 1219,
    height: base.height,
  };
}

/**
 * Build the layout.
 *
 * The room is laid out front to back: stage against the far wall, screen at the
 * stage line, seating in the middle third, and service — bars, catering,
 * registration — at the back where arriving guests meet it first. That ordering
 * is not arbitrary; it is how every one of these rooms is actually set, because
 * it keeps late arrivals away from the front and puts service on the route out.
 */
export function generateConcept(brief: ConceptBrief): ConceptResult {
  const elements: ConceptElement[] = [];
  const summary: string[] = [];
  const warnings: string[] = [];

  const halfW = brief.roomWidthMm / 2;
  const halfD = brief.roomDepthMm / 2;

  // The stage sits against the far wall, a metre clear of it for cable and crew.
  const stageBackClearance = 1500;
  let audienceFrontZ = -halfD + 3000;

  if (brief.eventKind === 'exhibition' || brief.seating === 'exhibition') {
    const size = brief.boothType === 'island' ? { w: 6000, d: 6000 } : { w: 3000, d: 3000 };
    const columns = Math.max(1, Math.floor((brief.roomWidthMm - 6000) / (size.w + 1000)));
    const rows = Math.max(1, Math.ceil(brief.boothCount / columns));
    const grid = generateBoothGrid({
      columns,
      rows,
      boothWidthMm: size.w,
      boothDepthMm: size.d,
      aisleWidthMm: DEFAULT_BOOTH_REGULATIONS.aisleWidthMm,
      backToBack: true,
      gapMm: 0,
    });
    elements.push({
      kind: 'booth-grid',
      label: `${grid.length} stands, ${columns} × ${rows}`,
      xMm: 0,
      zMm: 0,
      widthMm: columns * size.w,
      depthMm: rows * size.d,
      heightMm: 2500,
      rotationDeg: 0,
      params: {
        placements: grid,
        boothType: brief.boothType,
        widthMm: size.w,
        depthMm: size.d,
        aisleWidthMm: DEFAULT_BOOTH_REGULATIONS.aisleWidthMm,
      },
      rationale: `Back-to-back rows so one ${(DEFAULT_BOOTH_REGULATIONS.aisleWidthMm / 1000).toFixed(1)} m aisle serves two rows of stands — half the aisles for the same number of exhibitors.`,
    });
    summary.push(`${grid.length} stands laid out ${columns} across and ${rows} deep, back to back.`);

    if (brief.registration) {
      elements.push({
        kind: 'registration',
        label: 'Registration',
        xMm: 0,
        zMm: halfD - 2500,
        widthMm: 6000,
        depthMm: 2000,
        heightMm: 1100,
        rotationDeg: 0,
        params: {},
        rationale: 'At the entrance end, so visitors are badged before they reach the first stand.',
      });
    }
  } else {
    /* ── Stage ───────────────────────────────────────────────────────── */
    let stageZ = -halfD + stageBackClearance;
    let stageDepth = 0;

    if (brief.stage) {
      const size = stageSize(brief.attendance, brief.stageProminence);
      stageDepth = size.depth;
      stageZ = -halfD + stageBackClearance + size.depth / 2;
      elements.push({
        kind: 'stage',
        label: `Stage ${(size.width / 1000).toFixed(1)} × ${(size.depth / 1000).toFixed(1)} m`,
        xMm: 0,
        zMm: Math.round(stageZ),
        widthMm: size.width,
        depthMm: size.depth,
        heightMm: size.height,
        rotationDeg: 0,
        params: {
          deckColumns: Math.round(size.width / 1219),
          deckRows: Math.round(size.depth / 1219),
          deckHeightMm: size.height,
        },
        rationale: `Sized for ${brief.attendance} people: ${(size.height / 1000).toFixed(2)} m high so the back row can see over the front, and ${stageBackClearance} mm off the wall for crew and cable.`,
      });
      summary.push(
        `A ${(size.width / 1000).toFixed(1)} × ${(size.depth / 1000).toFixed(1)} m stage at ${(size.height / 1000).toFixed(2)} m, against the far wall.`
      );
      audienceFrontZ = stageZ + size.depth / 2 + 2000;
    }

    /* ── Screen ──────────────────────────────────────────────────────── */
    if (brief.screen !== 'none') {
      // Screen height from room depth: the back row should be no further than
      // eight screen heights away, so the screen is derived from the room.
      const targetHeight = Math.max(2500, Math.min(brief.roomHeightMm - 2000, (brief.roomDepthMm / 8) * 1.05));
      const targetWidth = brief.screen === 'wrap' ? brief.roomWidthMm * 0.8 : targetHeight * (16 / 9);
      const preset = LED_PRESETS.find((p) => p.key === (brief.screen === 'curved' ? 'curved-backdrop' : 'summit-16x9'))!;
      const fitted = fitLedScreen(preset.panelKey, targetWidth, targetHeight);
      const bottomMm = brief.stage ? stageSize(brief.attendance, brief.stageProminence).height + 300 : 1200;

      const screens: Array<{ x: number; label: string }> =
        brief.screen === 'dual'
          ? [
              { x: -Math.round(halfW * 0.45), label: 'Left screen' },
              { x: Math.round(halfW * 0.45), label: 'Right screen' },
            ]
          : [{ x: 0, label: 'Main screen' }];

      for (const s of screens) {
        elements.push({
          kind: 'screen',
          label: `${s.label} ${(fitted.widthMm / 1000).toFixed(1)} × ${(fitted.heightMm / 1000).toFixed(1)} m`,
          xMm: s.x,
          zMm: Math.round(stageZ - stageDepth / 2 - 400),
          widthMm: fitted.widthMm,
          depthMm: 500,
          heightMm: fitted.heightMm,
          rotationDeg: 0,
          params: {
            panelKey: preset.panelKey,
            columns: brief.screen === 'dual' ? Math.ceil(fitted.columns / 2) : fitted.columns,
            rows: fitted.rows,
            bottomMm,
            frame: 'ground-support',
            curveDeg: brief.screen === 'curved' ? 24 : brief.screen === 'wrap' ? 45 : 0,
          },
          rationale: `Height set so the back row at ${(brief.roomDepthMm / 1000).toFixed(0)} m is within eight screen heights — the limit for readable text.`,
        });
      }
      summary.push(
        `${screens.length === 2 ? 'Two side screens' : `A ${brief.screen} LED wall`} at ${(fitted.widthMm / 1000).toFixed(1)} × ${(fitted.heightMm / 1000).toFixed(1)} m, bottom of image at ${(bottomMm / 1000).toFixed(2)} m.`
      );
    }

    /* ── Truss ───────────────────────────────────────────────────────── */
    if (brief.truss !== 'none' && brief.stage) {
      const size = stageSize(brief.attendance, brief.stageProminence);
      const trimHeight = Math.min(brief.roomHeightMm - 800, Math.max(5000, size.height + 5500));
      elements.push({
        kind: 'truss',
        label: `${TRUSS_SHAPE_INFO[brief.truss as TrussShape].label} over the stage`,
        xMm: 0,
        zMm: Math.round(stageZ),
        widthMm: size.width + 2000,
        depthMm: size.depth,
        heightMm: trimHeight,
        rotationDeg: 0,
        params: {
          shape: brief.truss,
          systemKey: brief.attendance > 500 ? 'f44-square' : 'f34-square',
          trimHeightMm: trimHeight,
          legType: brief.roomHeightMm > 7000 ? 'flown' : 'base-plate',
        },
        rationale: `Trimmed at ${(trimHeight / 1000).toFixed(1)} m — clear of the ${(brief.roomHeightMm / 1000).toFixed(1)} m ceiling and high enough for the beam angles to cover the stage.`,
      });
      summary.push(`A ${TRUSS_SHAPE_INFO[brief.truss as TrussShape].label.toLowerCase()} at ${(trimHeight / 1000).toFixed(1)} m trim.`);
    }

    /* ── Seating ─────────────────────────────────────────────────────── */
    if (brief.seating !== 'standing') {
      const perPerson = SEATING_STYLE_INFO[brief.seating].areaPerPersonSqM;
      const neededSqM = brief.attendance * perPerson;
      const availableDepth = halfD - audienceFrontZ - 3000;
      const seatingDepth = Math.min(availableDepth, (neededSqM * 1_000_000) / (brief.roomWidthMm * 0.8));

      if (seatingDepth > availableDepth * 0.98) {
        warnings.push(
          `${brief.attendance} people at ${perPerson} m² each needs about ${Math.round(neededSqM)} m², which is more than this room gives once the stage is in. Reduce the number, change the layout, or use a larger space.`
        );
      }

      elements.push({
        kind: 'seating',
        label: `${SEATING_STYLE_INFO[brief.seating].label} for ${brief.attendance}`,
        xMm: 0,
        zMm: Math.round(audienceFrontZ + seatingDepth / 2),
        widthMm: Math.round(brief.roomWidthMm * 0.8),
        depthMm: Math.round(Math.max(2000, seatingDepth)),
        heightMm: 900,
        rotationDeg: 0,
        params: {
          style: brief.seating,
          attendance: brief.attendance,
          areaPerPersonSqM: perPerson,
          tablesOfTen: brief.seating === 'banquet' || brief.seating === 'cabaret' ? Math.ceil(brief.attendance / 10) : 0,
        },
        rationale: `${perPerson} m² per person for ${SEATING_STYLE_INFO[brief.seating].label.toLowerCase()}, including the gangways, starting ${(2000 / 1000).toFixed(1)} m clear of the stage.`,
      });
      summary.push(`${SEATING_STYLE_INFO[brief.seating].label} for ${brief.attendance}, ${Math.round(neededSqM)} m² allowed.`);
    }

    /* ── Extras, along the back wall ─────────────────────────────────── */
    const backZ = halfD - 2500;
    let backX = -halfW + 3000;
    const placeBack = (
      kind: ConceptElement['kind'],
      label: string,
      widthMm: number,
      depthMm: number,
      heightMm: number,
      rationale: string
    ) => {
      elements.push({
        kind,
        label,
        xMm: Math.round(backX + widthMm / 2),
        zMm: Math.round(backZ),
        widthMm,
        depthMm,
        heightMm,
        rotationDeg: 0,
        params: {},
        rationale,
      });
      backX += widthMm + 2000;
    };

    if (brief.registration) {
      placeBack('registration', 'Registration desk', 4000, 900, 1100, 'At the entrance end, so guests are badged before they reach the room.');
    }
    if (brief.bar) {
      placeBack('bar', 'Bar', 4000, 900, 1067, 'Away from the stage, so a queue never blocks the view or the audio.');
    }
    if (brief.catering) {
      placeBack('catering', 'Catering station', 6000, 900, 900, 'On the back wall with clear access behind it for replenishment.');
    }
    if (brief.danceFloor) {
      const side = Math.round(Math.min(8000, Math.max(4000, Math.sqrt(brief.attendance * 0.5) * 1000)));
      elements.push({
        kind: 'dance-floor',
        label: `Dance floor ${(side / 1000).toFixed(1)} m square`,
        xMm: 0,
        zMm: Math.round(audienceFrontZ + 1000 + side / 2),
        widthMm: side,
        depthMm: side,
        heightMm: 25,
        rotationDeg: 0,
        params: {},
        rationale: 'Sized on the rule that a third of guests dance at once, at half a square metre each, and placed between stage and tables.',
      });
      summary.push(`A ${(side / 1000).toFixed(1)} m dance floor between the stage and the tables.`);
    }
  }

  /* ── Cameras ───────────────────────────────────────────────────────── */

  const cameras: ConceptCamera[] = [
    {
      name: 'Guest view',
      positionMm: { x: 0, y: 1650, z: halfD * 0.55 },
      targetMm: { x: 0, y: 1800, z: -halfD * 0.55 },
      fov: 55,
      note: 'Standing eye height at the back of the room. The honest view — this is what most people will actually see.',
    },
    {
      name: 'Hero three-quarter',
      positionMm: { x: halfW * 0.75, y: brief.roomHeightMm * 0.45, z: halfD * 0.5 },
      targetMm: { x: 0, y: 1500, z: -halfD * 0.35 },
      fov: 40,
      note: 'The angle a client expects on the first page of a deck.',
    },
    {
      name: 'Plan',
      positionMm: { x: 0, y: Math.max(brief.roomWidthMm, brief.roomDepthMm) * 0.95, z: 1 },
      targetMm: { x: 0, y: 0, z: 0 },
      fov: 45,
      note: 'Straight down, for the layout drawing.',
    },
  ];

  const look = LIGHTING_LOOKS.find((l) => l.key === brief.look)?.key ?? 'corporate-summit';

  return {
    brief,
    elements,
    cameras,
    roomWidthMm: brief.roomWidthMm,
    roomDepthMm: brief.roomDepthMm,
    roomHeightMm: brief.roomHeightMm,
    look,
    summary,
    warnings,
  };
}

/**
 * The instruction handed to a language model when one is configured.
 *
 * Kept here rather than in the API so the contract and the type it must satisfy
 * live side by side — the schema below is exactly `ConceptBrief` minus the
 * fields the parser fills in afterwards.
 */
export const CONCEPT_SYSTEM_PROMPT = `You convert an event description into a strict JSON brief for a spatial layout engine.

Return ONLY a JSON object with these keys and no prose:
{
  "eventKind": one of ${EVENT_KINDS.join(' | ')},
  "seating": one of ${SEATING_STYLES.join(' | ')},
  "attendance": integer,
  "roomWidthMm": integer or 0 if not stated,
  "roomDepthMm": integer or 0 if not stated,
  "roomHeightMm": integer or 0 if not stated,
  "stage": boolean,
  "stageProminence": "small" | "standard" | "large",
  "screen": "none" | "flat" | "curved" | "dual" | "wrap",
  "truss": "none" | ${Object.keys(TRUSS_SHAPE_INFO).join(' | ')},
  "look": one of ${LIGHTING_LOOKS.map((l) => l.key).join(' | ')},
  "danceFloor": boolean,
  "bar": boolean,
  "registration": boolean,
  "catering": boolean,
  "boothCount": integer,
  "boothType": "shell-scheme" | "inline" | "corner" | "peninsula" | "island" | "double-decker"
}

Rules:
- Never invent dimensions the user did not give. Use 0 and let the engine derive them.
- Infer attendance only when the text implies a scale; otherwise use 0.
- Choose the look from the mood words, not from the event type alone.`;
