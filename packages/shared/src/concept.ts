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
import {
  chairsAroundTable,
  cornerPositions,
  layoutAgainstWalls,
  layoutChandeliers,
  layoutDining,
  type Footprint,
} from './furnish.js';

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
  /**
   * The rest of the room.
   *
   * Everything below was previously dropped on the floor by the parser — a
   * prompt asking for "branded booths, chandeliers and a central walkway" was
   * understood as a bare stage. These are the things that make a render look
   * like an event rather than a seating diagram, so they are part of the brief.
   */
  chandeliers: boolean;
  spotlights: boolean;
  /** A clear route through the room, in millimetres. 0 for none. */
  walkwayWidthMm: number;
  /** Branded banners, logo walls and printed graphics around the room. */
  branding: boolean;
  /** Planting and soft decor. */
  plants: boolean;
  /** Carpet or a floor finish under the event. */
  carpet: boolean;
  /** Soft seating clusters. */
  lounge: boolean;
  /** Stands ringing the room rather than gridded in the middle. */
  boothsAroundPerimeter: boolean;
  /** Brand colours pulled from the prompt, as hex. Drives banners and lighting. */
  paletteHex: string[];
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
  chandeliers: false,
  spotlights: false,
  walkwayWidthMm: 0,
  branding: false,
  plants: false,
  carpet: false,
  lounge: false,
  boothsAroundPerimeter: false,
  paletteHex: [],
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
  {
    // "round dining tables" and "round tables of ten" are the same request as
    // "banquet"; the words in between should not hide it.
    words: [
      'banquet', 'rounds', 'round table', 'round dining', 'dining table',
      'seated dinner', 'gala dinner', 'dinner table',
    ],
    value: 'banquet',
  },
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
/**
 * Colour words a brief uses, as hex.
 *
 * Event briefs name colours in plain English — "blue and white", "gold and
 * black" — and those colours are load-bearing: they set the banners, the LED
 * artwork and the uplighting. The values are the saturated, screen-accurate
 * versions a designer would reach for, not the CSS keywords, because "blue" on
 * a banner means a brand blue and not `#0000ff`.
 */
const COLOUR_WORDS: Array<{ words: string[]; hex: string }> = [
  { words: ['blue', 'navy', 'cobalt'], hex: '#0B5FFF' },
  { words: ['white', 'ivory'], hex: '#F8FAFC' },
  { words: ['black', 'charcoal'], hex: '#111418' },
  { words: ['gold', 'golden', 'champagne'], hex: '#C9A227' },
  { words: ['silver', 'chrome'], hex: '#C0C6CE' },
  { words: ['red', 'crimson', 'scarlet'], hex: '#D32F2F' },
  { words: ['green', 'emerald'], hex: '#1E9E62' },
  { words: ['purple', 'violet', 'magenta'], hex: '#7C3AED' },
  { words: ['pink', 'rose', 'blush'], hex: '#EC4899' },
  { words: ['orange', 'amber'], hex: '#F59E0B' },
  { words: ['teal', 'turquoise'], hex: '#14B8A6' },
];

function readPalette(text: string, understood: string[]): string[] {
  const found: string[] = [];
  for (const entry of COLOUR_WORDS) {
    for (const word of entry.words) {
      // Word boundaries: "goldsmith" is not gold, and "reception" is not red.
      if (new RegExp(`\\b${word}\\b`).test(text)) {
        if (!found.includes(entry.hex)) {
          found.push(entry.hex);
          understood.push(word);
        }
        break;
      }
    }
  }
  return found.slice(0, 4);
}

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
   * The rest of the room.
   *
   * A prompt that asks for "branded booths, chandeliers and a central walkway"
   * is describing most of what the render will actually show, and all of it
   * used to fall into `ignored`. Reading these is what turns a seating diagram
   * into an event.
   */
  const chandeliers = has('chandelier', 'chandeliers', 'hanging light', 'pendant');
  const spotlights = has(
    'spotlight', 'spotlights', 'moving light', 'moving heads', 'profile',
    'event lighting', 'professional lighting', 'stage lighting', 'uplighter', 'uplighting'
  );
  const branding = has('branding', 'branded', 'brand', 'logo', 'banner', 'signage', 'graphics');
  const plants = has('plant', 'plants', 'planting', 'greenery', 'floral', 'flowers', 'foliage');
  const carpet = has('carpet', 'carpeted', 'floor finish', 'rug');
  const lounge = has('lounge', 'sofa', 'sofas', 'soft seating', 'breakout');
  const boothsAroundPerimeter = has('around the perimeter', 'around the edge', 'perimeter', 'around the room');

  /*
   * A walkway. "central walkway" implies one; an explicit width wins.
   *
   * 2.4 m is the default because it is the width two people pass comfortably
   * with a service trolley between them, which is what these routes are for.
   */
  const walkwayMatch = text.match(/(\d+(?:\.\d+)?)\s*m(?:etre|eter)?s?\s*(?:wide\s*)?(?:central\s*)?(?:walkway|aisle|gangway|runway)/);
  const walkwayWidthMm = walkwayMatch
    ? Math.round(Number(walkwayMatch[1]) * 1000)
    : has('walkway', 'central aisle', 'centre aisle', 'center aisle', 'gangway', 'runway', 'catwalk')
      ? 2400
      : 0;
  if (walkwayMatch) understood.push(`${walkwayMatch[1]} m walkway`);

  const paletteHex = readPalette(text, understood);

  /*
   * Room size, if the sentence did not give one. Derived from attendance and
   * the seating allowance rather than picked, and laid out on a 3:4 proportion,
   * which is the shape most function rooms are and which puts everyone within a
   * sensible distance of the stage.
   */
  if (!roomWidthMm || !roomDepthMm) {
    /*
     * 1.45 covers the stage, the gangways and the back-of-house strip for a
     * plain room. Anything the brief adds around the edges has to be paid for
     * on top of that, or the derived room is too small for the layout it was
     * derived from and every run ends in a shortfall warning.
     *
     * Stands ring the room at 1.6 m off the wall and 2 m deep, which is a 4.5 m
     * band on all four sides; a walkway takes a full-width strip. These are the
     * two that actually change the answer, so they are the two counted.
     */
    let allowance = 1.45;
    if (boothsAroundPerimeter) allowance += 0.35;
    if (walkwayWidthMm > 0) allowance += 0.1;
    /*
     * A dance floor is a hole in the seating, not a use of it: the guests it
     * serves still need their tables somewhere else. Without paying for it,
     * a 150-guest wedding derives a room whose whole middle is dance floor
     * and which then seats thirty.
     */
    if (danceFloor) allowance += 0.3;

    const areaSqM = attendance * SEATING_STYLE_INFO[seating].areaPerPersonSqM * allowance;
    const width = Math.sqrt(areaSqM * 0.75);
    roomWidthMm = Math.max(8000, Math.round((width * 1000) / 500) * 500);
    roomDepthMm = Math.max(10000, Math.round(((areaSqM / width) * 1000) / 500) * 500);

    /*
     * Depth has to hold the stack, not just the area.
     *
     * A function room is used front to back: stage, then dance floor, then
     * tables, then a service strip. Deriving depth from area alone spreads the
     * room sideways and leaves it too shallow for that stack — a 150-guest
     * wedding came out 23.5 m deep when the set needs 38 m, and two thirds of
     * the guests had nowhere to sit. So the stack is measured directly and the
     * room is deepened to fit it when the area figure falls short.
     */
    const TABLE_PITCH_MM = 3800;
    const roundsHere = seating === 'banquet' || seating === 'cabaret';
    if (roundsHere) {
      const stageDepth = stage ? (attendance < 300 ? 3700 : attendance < 800 ? 4900 : 6100) : 0;
      const danceDepth = danceFloor
        ? Math.min(8000, Math.max(4000, Math.sqrt(attendance * 0.5) * 1000)) + 2500
        : 0;
      /*
       * A central walkway runs the length of the room, so it costs a whole
       * column of tables for every row — not a slice of area. Counting it as
       * area leaves the room a column short from top to bottom.
       */
      /*
       * A central walkway costs more columns than its own width suggests.
       *
       * The walkway is a rectangle and a table's claimed footprint is the top
       * plus its ring of chairs — about 2.9 m. Any grid column whose centre
       * falls within half a table of the walkway edge is blocked, which for a
       * 2.4 m route is three columns of a 3.8 m grid, not one. Counting one
       * left the derived room two columns short in every row.
       */
      const walkwayColumns =
        walkwayWidthMm > 0 ? Math.ceil((walkwayWidthMm + 2900) / TABLE_PITCH_MM) + 1 : 0;

      /*
       * Pay for the walkway in width, not in depth.
       *
       * The columns it costs are lost from every row, so making the room
       * deeper to compensate just adds rows that are also a walkway short —
       * a 500-guest room grew to 76 m long and still seated 360. Widening
       * restores the lost columns directly and keeps the room a shape a venue
       * would recognise.
       */
      if (walkwayColumns > 0) {
        roomWidthMm += walkwayColumns * TABLE_PITCH_MM;
      }
      const widthForTables = roomWidthMm - (boothsAroundPerimeter ? 9000 : 2400);
      const columns = Math.max(1, Math.floor(widthForTables / TABLE_PITCH_MM) - walkwayColumns);
      const tableDepth = Math.ceil(Math.ceil(attendance / 10) / columns) * TABLE_PITCH_MM;
      // Stage clearance at the front, service strip at the back.
      const stackMm = 1500 + stageDepth + 2000 + danceDepth + tableDepth + 3000;
      if (stackMm > roomDepthMm) roomDepthMm = Math.round(stackMm / 500) * 500;
    }
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
    chandeliers,
    spotlights,
    walkwayWidthMm,
    branding,
    plants,
    carpet,
    lounge,
    boothsAroundPerimeter,
    paletteHex,
    prompt,
    understood: [...new Set(understood)],
    ignored,
  };
}

/* ── The generated concept ─────────────────────────────────────────────── */

/**
 * What a planned element is.
 *
 * The first group are structures the engine sizes from production figures.
 * The second are *furnished zones*: the plan says how much floor a thing needs
 * and what goes in it, and the assembly step fills it with real catalogue
 * objects — individual tables, individual chairs — rather than drawing a
 * coloured rectangle where furniture ought to be. That distinction is the
 * difference between a plan you can look at and a plan you can build.
 */
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
    | 'catering'
    /** Round tables with chairs around them, laid out and counted. */
    | 'dining'
    /** A run of clear floor nothing else may occupy. */
    | 'walkway'
    /** Carpet or a floor finish over a region. */
    | 'carpet'
    /** A hanging fixture at ceiling trim. */
    | 'chandelier'
    /** A moving or fixed light on truss or floor. */
    | 'spotlight'
    /** Branding: a banner, a logo wall, a printed graphic. */
    | 'banner'
    /** Planting and soft decor. */
    | 'plant'
    /** Soft seating: sofas and low tables. */
    | 'lounge';
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

    /*
     * Reserve the dance floor before the seating is laid out.
     *
     * The floor goes between the stage and the tables, so the tables have to
     * start behind it. Placing the floor afterwards — which is what used to
     * happen — left the seating region starting at the stage and the dance
     * floor stamped through the middle of it, and a 150-guest wedding seated
     * sixty.
     */
    const danceSideMm = brief.danceFloor
      ? Math.round(Math.min(8000, Math.max(4000, Math.sqrt(brief.attendance * 0.5) * 1000)))
      : 0;
    const danceFloorZ = danceSideMm ? audienceFrontZ + 1000 + danceSideMm / 2 : 0;
    if (danceSideMm) audienceFrontZ += 1000 + danceSideMm + 1500;

    /* ── Seating ─────────────────────────────────────────────────────── */
    if (brief.seating !== 'standing') {
      const perPerson = SEATING_STYLE_INFO[brief.seating].areaPerPersonSqM;
      const neededSqM = brief.attendance * perPerson;
      const availableDepth = halfD - audienceFrontZ - 3000;

      /*
       * How wide the seating actually gets to be, which is what the depth has
       * to be derived from. Using a different figure here from the one the
       * region is built with makes the depth answer a question nobody asked —
       * it under-reports how deep the set has to be, and the tables run out of
       * room before the guest count is met.
       */
      const seatingWidth = brief.roomWidthMm - (brief.boothsAroundPerimeter ? 9000 : 2400);

      /*
       * How deep the seating has to be.
       *
       * For rows, area over width is the right answer. For rounds it is not:
       * tables land on a 3.8 m grid, so the depth needed is however many rows
       * of that grid the guest count takes — and rounding that down to an area
       * figure can leave a region thinner than a single table, which places no
       * tables at all however much floor is free.
       */
      const TABLE_PITCH_MM = 3800;
      const rounds = brief.seating === 'banquet' || brief.seating === 'cabaret';
      const neededDepth = rounds
        ? Math.ceil(
            Math.ceil(brief.attendance / 10) / Math.max(1, Math.floor(seatingWidth / TABLE_PITCH_MM))
          ) * TABLE_PITCH_MM
        : (neededSqM * 1_000_000) / seatingWidth;

      const seatingDepth = Math.min(availableDepth, neededDepth);

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
        /*
         * The seating region runs nearly the full width of the room.
         *
         * It was 80 %, which on a 29 m room threw away nearly 3 m of usable
         * floor on each side and cost whole columns of tables. A 1.2 m margin
         * to the wall is what a banqueting team actually leaves — enough to
         * walk behind the outermost chairs, and no more.
         *
         * Stands around the perimeter are the exception: they stand 1.6 m off
         * the wall and are 2 m deep, so the seating has to start behind them
         * or the outermost table column lands inside a stand and is dropped.
         */
        widthMm: Math.round(seatingWidth),
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
      const side = danceSideMm;
      elements.push({
        kind: 'dance-floor',
        label: `Dance floor ${(side / 1000).toFixed(1)} m square`,
        xMm: 0,
        zMm: Math.round(danceFloorZ),
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

  /* ── Furnishing ────────────────────────────────────────────────────── */

  furnishRoom(brief, elements, summary, warnings);

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


/* -- Furnishing the room ------------------------------------------------ */

/**
 * Fill the room around the structure.
 *
 * By the time this runs, the stage, screen, truss and seating region are
 * already placed and sized. This pass turns the rest of the brief into real,
 * positioned elements: the tables that go in the seating region, the route
 * through them, the fixtures over them, the branding on the walls and the
 * planting in the corners.
 *
 * Everything already placed is registered as a footprint first, so nothing
 * added here can land on top of it. Order matters within the pass too - the
 * walkway is claimed before the tables are laid, so the tables part around it
 * rather than the walkway being cut through a set room.
 */
function furnishRoom(
  brief: ConceptBrief,
  elements: ConceptElement[],
  summary: string[],
  warnings: string[]
): void {
  const halfD = brief.roomDepthMm / 2;

  // Everything structural already on the floor is off limits. The seating
  // region is excluded because it is a region to fill, not an obstacle.
  const taken: Footprint[] = elements
    .filter((e) => e.kind !== 'seating')
    .map((e) => ({
      xMm: e.xMm,
      zMm: e.zMm,
      widthMm: e.widthMm,
      depthMm: e.depthMm,
      label: e.label,
    }));

  const seatingZone = elements.find((e) => e.kind === 'seating');

  /* -- Carpet, first, so everything else sits on top of it ------------- */
  if (brief.carpet) {
    elements.push({
      kind: 'carpet',
      label: 'Event carpet',
      xMm: 0,
      zMm: 0,
      widthMm: brief.roomWidthMm - 600,
      depthMm: brief.roomDepthMm - 600,
      heightMm: 12,
      rotationDeg: 0,
      params: { colorHex: brief.paletteHex[0] ?? '#1f2937' },
      rationale: 'Wall to wall with a 300 mm margin, so the edge is never the first thing a photograph shows.',
    });
  }

  /* -- The walkway, claimed before any furniture is laid --------------- */
  if (brief.walkwayWidthMm > 0 && seatingZone) {
    const runFromZ = seatingZone.zMm - seatingZone.depthMm / 2;
    const runToZ = halfD - 1000;
    const depth = Math.max(2000, runToZ - runFromZ);
    const walkway = {
      xMm: 0,
      zMm: Math.round(runFromZ + depth / 2),
      widthMm: brief.walkwayWidthMm,
      depthMm: Math.round(depth),
    };
    elements.push({
      kind: 'walkway',
      label: 'Central walkway',
      ...walkway,
      heightMm: 0,
      rotationDeg: 0,
      params: { colorHex: brief.paletteHex[0] ?? '#0B5FFF' },
      rationale: `A ${(brief.walkwayWidthMm / 1000).toFixed(1)} m route from the entrance to the stage, kept clear of furniture.`,
    });
    taken.push({ ...walkway, label: 'Walkway' });
    summary.push(`A ${(brief.walkwayWidthMm / 1000).toFixed(1)} m central walkway runs to the stage.`);
  }

  /* -- Stands around the perimeter ------------------------------------- */
  if (brief.boothsAroundPerimeter) {
    const count = brief.boothCount > 0 ? brief.boothCount : Math.max(6, Math.round(brief.attendance / 40));
    const stands = layoutAgainstWalls({
      roomWidthMm: brief.roomWidthMm,
      roomDepthMm: brief.roomDepthMm,
      count,
      insetMm: 1600,
      itemWidthMm: 3000,
      taken,
    });
    for (const stand of stands) {
      elements.push({
        kind: 'booth-grid',
        label: `Stand ${stand.index}`,
        xMm: stand.xMm,
        zMm: stand.zMm,
        widthMm: 3000,
        depthMm: 2000,
        heightMm: 2500,
        rotationDeg: stand.rotationDeg,
        params: {
          placements: [
            {
              centre: { xMm: stand.xMm, zMm: stand.zMm },
              rotationDeg: stand.rotationDeg,
              standNumber: String(stand.index),
            },
          ],
          boothType: brief.boothType,
          widthMm: 3000,
          depthMm: 2000,
        },
        rationale: 'Against the wall facing in, so the floor stays open and every stand is seen from the room.',
      });
      taken.push({ xMm: stand.xMm, zMm: stand.zMm, widthMm: 3200, depthMm: 2200, label: `Stand ${stand.index}` });
    }
    if (stands.length) summary.push(`${stands.length} branded stands around the perimeter, facing in.`);
  }

  /* -- Branding -------------------------------------------------------- */
  if (brief.branding) {
    const banners = layoutAgainstWalls({
      roomWidthMm: brief.roomWidthMm,
      roomDepthMm: brief.roomDepthMm,
      count: 6,
      insetMm: 250,
      itemWidthMm: 2400,
      taken,
    });
    for (const banner of banners) {
      elements.push({
        kind: 'banner',
        label: `Banner ${banner.index}`,
        xMm: banner.xMm,
        zMm: banner.zMm,
        widthMm: 2400,
        depthMm: 100,
        heightMm: 3000,
        rotationDeg: banner.rotationDeg,
        params: {
          colorHex: brief.paletteHex[0] ?? '#0B5FFF',
          accentHex: brief.paletteHex[1] ?? '#F8FAFC',
        },
        rationale: 'On the side walls facing in, where a camera catches it without it competing with the screen.',
      });
      taken.push({ xMm: banner.xMm, zMm: banner.zMm, widthMm: 2400, depthMm: 600, label: `Banner ${banner.index}` });
    }
    if (banners.length) summary.push(`${banners.length} branded banners in the room palette.`);
  }

  /* -- Chandeliers ----------------------------------------------------- */
  if (brief.chandeliers) {
    const points = layoutChandeliers({
      xMm: 0,
      zMm: 1000,
      widthMm: brief.roomWidthMm - 4000,
      depthMm: brief.roomDepthMm - 6000,
      roomHeightMm: brief.roomHeightMm,
      taken,
    });
    for (const point of points) {
      elements.push({
        kind: 'chandelier',
        label: `Chandelier ${point.index}`,
        xMm: point.xMm,
        zMm: point.zMm,
        widthMm: 1200,
        depthMm: 1200,
        heightMm: point.yMm,
        rotationDeg: 0,
        params: { trimMm: point.yMm },
        rationale: `Hung at ${(point.yMm / 1000).toFixed(1)} m, spaced so the pools of light overlap rather than leaving gaps.`,
      });
    }
    if (points.length) summary.push(`${points.length} chandeliers at ${(points[0]!.yMm / 1000).toFixed(1)} m trim.`);
  }

  /* -- Stage lighting -------------------------------------------------- */
  if (brief.spotlights) {
    const stage = elements.find((e) => e.kind === 'stage');
    const truss = elements.find((e) => e.kind === 'truss');
    if (stage) {
      // Along the truss if there is one, otherwise on the stage line.
      const spanW = (truss ?? stage).widthMm;
      const trimMm = truss ? truss.heightMm : 5000;
      const count = spanW > 12000 ? 8 : 6;
      for (let i = 0; i < count; i += 1) {
        const t = i / (count - 1);
        const xMm = Math.round(-spanW / 2 + spanW * t);
        elements.push({
          kind: 'spotlight',
          label: `Spot ${i + 1}`,
          xMm,
          zMm: stage.zMm,
          widthMm: 350,
          depthMm: 350,
          heightMm: trimMm,
          rotationDeg: 0,
          params: { trimMm, colorHex: brief.paletteHex[0] ?? '#ffffff' },
          rationale: 'Spaced along the truss so the wash covers the full width of the stage with no dark centre.',
        });
      }
      summary.push(`${count} moving heads along the truss, washing the stage.`);
    }
  }

  /* -- Dining: real tables, in real positions -------------------------- */
  if (seatingZone && (brief.seating === 'banquet' || brief.seating === 'cabaret')) {
    const layout = layoutDining({
      attendance: brief.attendance,
      xMm: seatingZone.xMm,
      zMm: seatingZone.zMm,
      widthMm: seatingZone.widthMm,
      depthMm: seatingZone.depthMm,
      taken,
    });

    for (const table of layout.tables) {
      const chairs = chairsAroundTable(table, table.seats, layout.tableDiameterMm);
      elements.push({
        kind: 'dining',
        label: `Table ${table.index}`,
        xMm: table.xMm,
        zMm: table.zMm,
        widthMm: layout.tableDiameterMm,
        depthMm: layout.tableDiameterMm,
        heightMm: 750,
        rotationDeg: 0,
        params: {
          seats: table.seats,
          tableDiameterMm: layout.tableDiameterMm,
          tableIndex: table.index,
          chairs,
        },
        rationale: `One of ${layout.tables.length} rounds, set at a ${(layout.pitchMm / 1000).toFixed(1)} m pitch so service can pass between them.`,
      });
      taken.push({
        xMm: table.xMm,
        zMm: table.zMm,
        widthMm: layout.tableDiameterMm + 1100,
        depthMm: layout.tableDiameterMm + 1100,
        label: `Table ${table.index}`,
      });
    }

    summary.push(
      `${layout.tables.length} round tables of ${layout.seatsPerTable}, seating ${layout.tables.length * layout.seatsPerTable}.`
    );
    if (layout.shortfall > 0) {
      warnings.push(
        `Only ${layout.tables.length} of the ${layout.tables.length + layout.shortfall} tables needed for ${brief.attendance} guests fit once the stage and walkway are in. Use a larger room, or seat ${layout.tables.length * layout.seatsPerTable}.`
      );
    }
  }

  /* -- Planting -------------------------------------------------------- */
  if (brief.plants) {
    let placed = 0;
    for (const corner of cornerPositions(brief.roomWidthMm, brief.roomDepthMm)) {
      elements.push({
        kind: 'plant',
        label: `Planting ${placed + 1}`,
        xMm: corner.xMm,
        zMm: corner.zMm,
        widthMm: 900,
        depthMm: 900,
        heightMm: 1800,
        rotationDeg: 0,
        params: {},
        rationale: 'In the corners, which no layout uses and every photograph includes.',
      });
      placed += 1;
    }
    if (placed) summary.push(`${placed} planters softening the corners.`);
  }

  /* -- Lounge ---------------------------------------------------------- */
  if (brief.lounge) {
    const spots = layoutAgainstWalls({
      roomWidthMm: brief.roomWidthMm,
      roomDepthMm: brief.roomDepthMm,
      count: 2,
      insetMm: 2600,
      itemWidthMm: 3000,
      taken,
    });
    for (const spot of spots) {
      elements.push({
        kind: 'lounge',
        label: `Lounge ${spot.index}`,
        xMm: spot.xMm,
        zMm: spot.zMm,
        widthMm: 3000,
        depthMm: 2400,
        heightMm: 800,
        rotationDeg: spot.rotationDeg,
        params: {},
        rationale: 'Off the main floor, so a conversation is possible without leaving the room.',
      });
      taken.push({ xMm: spot.xMm, zMm: spot.zMm, widthMm: 3200, depthMm: 2600, label: `Lounge ${spot.index}` });
    }
  }
}
