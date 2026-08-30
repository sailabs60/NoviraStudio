/**
 * Head-noun classification.
 *
 * A first attempt at this matched taxonomy terms anywhere in an asset's name,
 * description or tags. It produced exactly the failure the catalogue cannot
 * tolerate: "Bench Vice" filed as a bench, "Wicker Basket" as a table,
 * "Carrot Cake" as a plate, "Gate Latch" as a door.
 *
 * The fix is linguistic rather than statistical. In an English compound noun
 * the **last** noun is the head — the thing the phrase actually denotes.
 * "Bench vice" is a vice; "dining table" is a table; "table lamp" is a lamp.
 * So we read the name from the right, take the longest phrase at the tail that
 * we recognise, and treat that as the identity.
 *
 * The vocabulary is a **whitelist**: an asset whose head noun we do not know is
 * rejected rather than guessed at. That is the conservative direction — a
 * missing chair costs nothing, a basket sold as a table corrupts a client's
 * layout.
 */

import { TAXONOMY, GLOBAL_REJECT_TERMS, type TaxonomyEntry } from './assetTaxonomy.js';

/**
 * Head nouns per taxonomy entry, longest-first within each entry.
 *
 * Multi-word heads matter: "coffee table" must beat "table", and "bar stool"
 * must beat "stool", otherwise the more specific item is never reached.
 */
const HEADS: Record<string, string[]> = {
  'round-table-60': ['round table', 'banquet table', 'circular table'],
  'rectangular-table': ['rectangular table', 'trestle table', 'dining table', 'buffet table', 'conference table', 'table'],
  'cocktail-table': ['cocktail table', 'poseur table', 'highboy table', 'bistro table', 'pub table'],
  'coffee-table': ['coffee table', 'sofa table', 'low table'],
  'side-table': ['side table', 'end table', 'console table', 'accent table', 'nightstand', 'night stand'],

  'banquet-chair': ['banquet chair', 'dining chair', 'stacking chair', 'event chair', 'conference chair', 'chiavari chair', 'tiffany chair', 'chair'],
  'folding-chair': ['folding chair', 'resin chair', 'ceremony chair', 'garden chair'],
  'outdoor-chair': ['deck chair', 'beach chair', 'patio chair', 'lawn chair', 'adirondack chair'],
  'bar-stool': ['bar stool', 'barstool', 'counter stool', 'high stool', 'bar chair'],
  stool: ['stool', 'ottoman', 'pouffe', 'pouf', 'footstool'],
  bench: ['bench', 'pew', 'street seating', 'seating'],

  sofa: ['sofa', 'couch', 'settee', 'loveseat', 'love seat', 'chesterfield'],
  armchair: ['armchair', 'arm chair', 'lounge chair', 'club chair', 'wingback chair', 'accent chair', 'tub chair', 'easy chair'],
  sectional: ['sectional', 'modular sofa', 'corner sofa'],

  tent: ['tent', 'marquee', 'pavilion'],
  canopy: ['canopy', 'awning', 'pergola', 'gazebo'],

  'stage-deck': ['stage deck', 'stage platform', 'riser', 'staging deck', 'platform'],
  lectern: ['lectern', 'podium', 'pulpit'],
  truss: ['truss', 'trussing'],

  drape: ['drape', 'drapes', 'curtain', 'curtains', 'backdrop', 'valance'],

  'dance-floor': ['dance floor', 'floor panel', 'parquet floor'],
  rug: ['rug', 'area rug', 'runner rug', 'carpet'],

  'bar-counter': ['bar counter', 'cocktail bar', 'drinks bar', 'reception desk', 'serving counter', 'buffet counter', 'counter'],
  'chafing-dish': ['chafing dish', 'chafer', 'catering tray', 'buffet warmer'],
  'ice-bucket': ['ice bucket', 'champagne bucket', 'wine cooler', 'drinks cooler'],

  plate: ['plate', 'charger plate', 'dinner plate', 'side plate', 'platter'],
  glass: ['wine glass', 'champagne flute', 'water glass', 'tumbler', 'goblet', 'goblets', 'cocktail glass', 'beer glass', 'flute', 'glassware'],
  cutlery: ['fork', 'knife', 'spoon', 'cutlery', 'flatware', 'silverware', 'teaspoon'],
  napkin: ['napkin', 'serviette'],

  linen: ['tablecloth', 'table cloth', 'table skirt', 'table runner', 'linen'],

  centerpiece: ['centerpiece', 'centrepiece', 'flower arrangement', 'floral arrangement', 'bouquet'],
  vase: ['vase', 'urn'],
  candle: ['candle', 'candelabra', 'candlestick', 'votive', 'tea light'],

  chandelier: ['chandelier', 'pendant light', 'hanging light', 'ceiling light'],
  'floor-lamp': ['floor lamp', 'standing lamp', 'torchiere'],
  'table-lamp': ['table lamp', 'desk lamp', 'bedside lamp', 'lamp'],
  uplight: ['uplight', 'up light', 'par can', 'stage light', 'moving head', 'wash light', 'spotlight'],
  'string-lights': ['string lights', 'festoon lights', 'fairy lights', 'bistro lights'],
  lantern: ['lantern'],

  speaker: ['speaker', 'loudspeaker', 'subwoofer', 'line array'],
  microphone: ['microphone', 'mic stand'],
  screen: ['projector screen', 'projection screen', 'led wall', 'video wall', 'display screen'],

  'potted-plant': ['potted plant', 'houseplant', 'house plant', 'indoor plant'],
  planter: ['planter', 'planter box', 'plant pot', 'flower pot', 'planter pot'],
  tree: ['tree'],
  hedge: ['hedge', 'greenery wall', 'green wall'],

  arch: ['wedding arch', 'ceremony arch', 'floral arch', 'chuppah', 'arbour', 'arbor'],
  easel: ['easel', 'sign stand', 'sandwich board'],
  stanchion: ['stanchion', 'rope barrier', 'queue post', 'velvet rope', 'crowd barrier'],
  heater: ['patio heater', 'outdoor heater', 'gas heater'],
  umbrella: ['parasol', 'patio umbrella', 'garden umbrella', 'market umbrella'],

  door: ['door', 'doorway'],
  window: ['window'],
};

/**
 * Head nouns that are explicitly *not* event items.
 *
 * Strictly redundant against a whitelist, but naming the reason makes the sync
 * report readable — "head noun 'vice' is not an event item" is a far better
 * audit line than a bare rejection.
 */
const NON_EVENT_HEADS = new Set([
  'vice', 'drill', 'press', 'basket', 'cake', 'bread', 'fruit', 'vegetable',
  'transceiver', 'radio', 'latch', 'handle', 'knob', 'hinge', 'lock', 'bolt', 'screw',
  'debris', 'trunk', 'log', 'branch', 'rock', 'stone', 'boulder', 'brick',
  'barrel', 'crate', 'box', 'bag', 'sack', 'bucket', 'can', 'bottle', 'jar', 'jug',
  'camera', 'register', 'phone', 'laptop', 'computer', 'keyboard', 'monitor',
  'car', 'truck', 'van', 'bike', 'bicycle', 'motorcycle', 'boat', 'cart',
  'tool', 'hammer', 'wrench', 'saw', 'axe', 'shovel', 'ladder', 'toolbox',
  'sign', 'poster', 'book', 'newspaper', 'clock', 'mirror', 'painting', 'statue',
  'bed', 'daybed', 'mattress', 'wardrobe', 'dresser', 'cabinet', 'shelf', 'shelving',
  'bookshelf', 'sink', 'toilet', 'bathtub', 'stove', 'oven', 'fridge', 'refrigerator',
  'megaphone', 'boombox', 'guitar', 'piano', 'drum', 'helmet', 'shoe', 'hat',
  'fence', 'gate', 'wall', 'roof', 'stair', 'staircase', 'column', 'pillar',
  'pot', 'pan', 'kettle', 'teapot', 'mug', 'cup', 'bowl',
]);

/** Trailing tokens that are variant markers, not part of the name. */
const VARIANT_TAIL = /\b(?:\d{1,3}|[ivxlc]+|[a-z])$/i;

interface PhraseEntry {
  key: string;
  words: string[];
}

/** All heads, ordered longest-first so specific phrases win. */
const PHRASE_INDEX: PhraseEntry[] = Object.entries(HEADS)
  .flatMap(([key, phrases]) => phrases.map((p) => ({ key, words: p.split(/\s+/) })))
  .sort((a, b) => b.words.length - a.words.length);

const MAX_PHRASE = Math.max(...PHRASE_INDEX.map((p) => p.words.length));

const BY_KEY = new Map(TAXONOMY.map((t) => [t.key, t]));

export interface HeadClassification {
  entry: TaxonomyEntry | null;
  confidence: number;
  head: string | null;
  reasons: string[];
}

/**
 * Modifier refinement.
 *
 * The head noun gives the family; the words in front of it choose the member.
 * "Round wooden table" and "wooden table" share a head but are different
 * catalogue items, and "ceiling lamp" is not a table lamp. Each rule fires only
 * when the head already matched, so it refines rather than reclassifies.
 *
 * A `to` of `null` means the modifier disqualifies the asset outright — an
 * office chair or a barber's chair is furniture, but it is not event furniture.
 */
const MODIFIER_RULES: Array<{ heads: string[]; modifiers: string[]; to: string | null; why: string }> = [
  // Tables
  { heads: ['rectangular-table'], modifiers: ['round', 'circular'], to: 'round-table-60', why: 'round table' },
  { heads: ['rectangular-table'], modifiers: ['tea', 'small', 'bedside'], to: 'side-table', why: 'small occasional table' },
  { heads: ['rectangular-table', 'round-table-60'], modifiers: ['pool', 'billiard', 'ping', 'operating', 'picnic', 'work', 'drafting', 'sewing'], to: null, why: 'not an event table' },

  // Lamps — the head "lamp" defaults to a table lamp, so overhead and wall
  // fittings have to be pulled out explicitly.
  { heads: ['table-lamp'], modifiers: ['ceiling', 'hanging', 'pendant', 'suspended'], to: 'chandelier', why: 'overhead fitting' },
  { heads: ['table-lamp'], modifiers: ['wall', 'sconce'], to: 'uplight', why: 'wall fitting' },
  { heads: ['table-lamp'], modifiers: ['floor', 'standing'], to: 'floor-lamp', why: 'floor-standing fitting' },
  { heads: ['table-lamp', 'chandelier'], modifiers: ['street', 'traffic', 'head', 'oil', 'kerosene'], to: null, why: 'not an event fitting' },

  // Chairs
  { heads: ['banquet-chair'], modifiers: ['folding'], to: 'folding-chair', why: 'folding chair' },
  { heads: ['banquet-chair'], modifiers: ['monobloc', 'plastic', 'resin', 'garden', 'patio'], to: 'folding-chair', why: 'stackable outdoor chair' },
  { heads: ['banquet-chair'], modifiers: ['arm', 'lounge', 'club', 'wing', 'tub', 'easy'], to: 'armchair', why: 'soft seating' },
  { heads: ['banquet-chair'], modifiers: ['bar', 'counter', 'high'], to: 'bar-stool', why: 'raised seating' },
  {
    heads: ['banquet-chair', 'folding-chair', 'stool'],
    modifiers: ['barber', 'dentist', 'office', 'gaming', 'car', 'baby', 'electric', 'massage', 'salon', 'wheel'],
    to: null,
    why: 'specialist chair, not event seating',
  },

  // Structures
  { heads: ['tent'], modifiers: ['camping', 'backpacking', 'dome', 'circus', 'refugee', 'army', 'military'], to: null, why: 'not an event tent' },
  { heads: ['door', 'window'], modifiers: ['car', 'garage', 'castle', 'dungeon', 'vault', 'airlock', 'rollershutter', 'roller'], to: null, why: 'not an event opening' },

  // Plants
  { heads: ['tree'], modifiers: ['dead', 'fallen', 'burnt', 'bare', 'quiver', 'joshua'], to: null, why: 'landscape scenery, not event greenery' },

  // Seating benches
  { heads: ['bench'], modifiers: ['work', 'weight', 'press', 'test', 'lab'], to: null, why: 'not seating' },
];

function refineByModifiers(
  entry: TaxonomyEntry,
  tokens: string[],
  headLength: number,
  byKey: Map<string, TaxonomyEntry>
): { entry: TaxonomyEntry | null; why: string | null } {
  const modifiers = tokens.slice(0, Math.max(0, tokens.length - headLength));
  if (!modifiers.length) return { entry, why: null };

  for (const rule of MODIFIER_RULES) {
    if (!rule.heads.includes(entry.key)) continue;
    const hit = rule.modifiers.find((m) => modifiers.includes(m));
    if (!hit) continue;
    if (rule.to === null) return { entry: null, why: `modifier "${hit}" — ${rule.why}` };
    const refined = byKey.get(rule.to);
    if (refined) return { entry: refined, why: `modifier "${hit}" refines to ${refined.key} (${rule.why})` };
  }
  return { entry, why: null };
}

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Drop trailing variant markers: "Sofa 01" → ["sofa"], "Chandelier 02" → ["chandelier"]. */
function stripVariantTail(tokens: string[]): string[] {
  const out = [...tokens];
  while (out.length > 1 && VARIANT_TAIL.test(out[out.length - 1]!)) out.pop();
  return out;
}

/**
 * Classify by head noun.
 *
 * Reads the name from the right and returns the longest recognised phrase at
 * the tail. Tags and description are used only to *reject*, never to identify —
 * marketplace tags are keyword spam and are the reason the naive matcher failed.
 */
export function classifyByHead(input: {
  name: string;
  description?: string | null;
  tags?: string[];
  categories?: string[];
}): HeadClassification {
  const reasons: string[] = [];
  const rawName = (input.name || '').trim();
  if (!rawName) return { entry: null, confidence: 0, head: null, reasons: ['no name'] };

  const bag = [rawName, input.description ?? '', (input.tags ?? []).join(' '), (input.categories ?? []).join(' ')]
    .join(' ')
    .toLowerCase();

  for (const term of GLOBAL_REJECT_TERMS) {
    if (bag.includes(term)) {
      return { entry: null, confidence: 0, head: null, reasons: [`disqualifying term "${term}"`] };
    }
  }

  const tokens = stripVariantTail(tokenize(rawName));
  if (!tokens.length) return { entry: null, confidence: 0, head: null, reasons: ['name has no usable words'] };

  // Walk the tail, longest phrase first.
  for (let len = Math.min(MAX_PHRASE, tokens.length); len >= 1; len -= 1) {
    const tail = tokens.slice(tokens.length - len);
    const phrase = tail.join(' ');

    const nonEvent = len === 1 && NON_EVENT_HEADS.has(phrase);
    if (nonEvent) {
      return {
        entry: null,
        confidence: 0,
        head: phrase,
        reasons: [`head noun "${phrase}" is not an event item`],
      };
    }

    const match = PHRASE_INDEX.find((p) => p.words.length === len && p.words.join(' ') === phrase);
    if (!match) continue;

    const entry = BY_KEY.get(match.key);
    if (!entry) continue;

    // Reject terms still apply — they catch qualifiers the head noun cannot,
    // e.g. a "camping tent" whose head is legitimately "tent".
    const blocked = entry.reject?.find((r) => bag.includes(r));
    if (blocked) {
      return {
        entry: null,
        confidence: 0,
        head: phrase,
        reasons: [`head "${phrase}" matched ${entry.key} but "${blocked}" disqualifies it`],
      };
    }

    // The head gives the family; the words in front of it choose the member.
    const refined = refineByModifiers(entry, tokens, len, BY_KEY);
    if (!refined.entry) {
      return { entry: null, confidence: 0, head: phrase, reasons: [refined.why ?? 'disqualified by modifier'] };
    }

    // A multi-word head is a much stronger signal than a bare one, and a head
    // that is the entire name is stronger still.
    let confidence = len >= 2 ? 92 : 74;
    if (tokens.length === len) confidence = Math.min(100, confidence + 6);
    reasons.push(`head noun "${phrase}" → ${entry.key}`);
    if (refined.why) {
      reasons.push(refined.why);
      confidence = Math.min(100, confidence + 8);
    }
    return { entry: refined.entry, confidence, head: phrase, reasons };
  }

  return {
    entry: null,
    confidence: 0,
    head: tokens[tokens.length - 1] ?? null,
    reasons: [`head noun "${tokens[tokens.length - 1]}" is not in the event vocabulary`],
  };
}
