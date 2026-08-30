/**
 * Event-item taxonomy.
 *
 * This is the domain knowledge that lets the pipeline decide whether a model
 * *actually is* what its provider says it is. Asset marketplaces are full of
 * mislabelled and ambiguous rows — "Sofa Table" is a table, "Chair Lift" is
 * neither, "Bar" might be a counter, a chocolate bar or a metal bar — so a
 * name match alone is never enough to admit something into the catalogue.
 *
 * Each entry carries:
 *   · `match`   — terms that positively identify the item
 *   · `reject`  — terms that disqualify it even when `match` hits
 *   · `dims`    — plausible real-world extents in millimetres
 *
 * The dimension ranges are the strongest signal available: a "sofa" 300 mm
 * wide is not a sofa, and a "chair" three metres tall is not a chair. They are
 * deliberately generous — they exist to catch nonsense, not to enforce a
 * particular product line.
 */

import type { CatalogCategorySlug } from '@novira/shared';

export interface DimensionRange {
  /** Largest horizontal extent. */
  widthMm: [number, number];
  /** Vertical extent. */
  heightMm: [number, number];
  /** Smallest horizontal extent. Optional — many props are near-square in plan. */
  depthMm?: [number, number];
}

export interface TaxonomyEntry {
  key: string;
  label: string;
  category: CatalogCategorySlug;
  /** Terms that identify this item. Matched against name, tags and description. */
  match: string[];
  /** Terms that disqualify, even if `match` hit. */
  reject?: string[];
  dims: DimensionRange;
  /** Round tables etc. — used to populate catalog_item.table_shape. */
  tableShape?: 'round' | 'rectangular' | 'other';
  /** Default seat count for a table of this size. */
  seats?: number;
  /** Items a free-plan user may place. */
  freePlan?: boolean;
}

/**
 * Terms that disqualify *any* asset from an event catalogue. These are the
 * recurring false positives from generic 3D marketplaces: game props, weapons,
 * anatomy, vehicles-as-scenery, scanned artefacts and so on.
 */
export const GLOBAL_REJECT_TERMS = [
  'weapon', 'gun', 'rifle', 'pistol', 'sword', 'knife blade', 'ammo', 'grenade', 'tank',
  'zombie', 'monster', 'creature', 'dragon', 'skeleton', 'skull', 'corpse', 'gore',
  'character rig', 'lowpoly character', 'avatar', 'anatomy', 'organ', 'dinosaur',
  'spaceship', 'spacecraft', 'satellite', 'rocket', 'asteroid', 'planet', 'moon lander',
  'minecraft', 'roblox', 'fortnite', 'pokemon', 'anime', 'cartoon character',
  'terrain', 'landscape', 'mountain range', 'island', 'cliff',
  'test model', 'sample model', 'placeholder', 'untitled', 'uv test', 'material test',
  'sci-fi', 'scifi', 'fantasy', 'medieval castle', 'dungeon',
  'human body', 'hand rigged', 'face scan', 'photogrammetry scan of person',
];

/**
 * Words that flip the meaning of a head noun. "coffee table" is a table, not a
 * coffee; "sofa table" is a table, not a sofa; "table lamp" is a lamp.
 */
export const HEAD_NOUN_TRAPS: Array<{ pattern: RegExp; actualKey: string }> = [
  { pattern: /\bsofa\s+table\b/i, actualKey: 'coffee-table' },
  { pattern: /\bcoffee\s+table\b/i, actualKey: 'coffee-table' },
  { pattern: /\bside\s+table\b/i, actualKey: 'side-table' },
  { pattern: /\bconsole\s+table\b/i, actualKey: 'side-table' },
  { pattern: /\btable\s+lamp\b/i, actualKey: 'table-lamp' },
  { pattern: /\bfloor\s+lamp\b/i, actualKey: 'floor-lamp' },
  { pattern: /\btable\s+cloth\b|\btablecloth\b/i, actualKey: 'linen' },
  { pattern: /\bbar\s+stool\b|\bbarstool\b/i, actualKey: 'bar-stool' },
  { pattern: /\bhigh\s*chair\b/i, actualKey: 'bar-stool' },
  { pattern: /\bchair\s+lift\b|\bchairlift\b/i, actualKey: '__reject__' },
  { pattern: /\bwheel\s*chair\b/i, actualKey: '__reject__' },
  { pattern: /\bdeck\s*chair\b|\bbeach\s+chair\b/i, actualKey: 'outdoor-chair' },
  { pattern: /\bchocolate\s+bar\b|\bcandy\s+bar\b|\bgranola\s+bar\b/i, actualKey: '__reject__' },
  { pattern: /\bcrow\s*bar\b|\brebar\b|\bmetal\s+bar\b/i, actualKey: '__reject__' },
  { pattern: /\bstage\s+coach\b|\bstagecoach\b/i, actualKey: '__reject__' },
  { pattern: /\bplant\s*pot\b|\bflower\s*pot\b/i, actualKey: 'planter' },
];

/** mm helpers so the table below reads in the units the trade actually uses. */
const inch = (n: number) => Math.round(n * 25.4);
const ft = (n: number) => Math.round(n * 304.8);

export const TAXONOMY: TaxonomyEntry[] = [
  /* ── Tables ──────────────────────────────────────────────────────── */
  {
    key: 'round-table-60',
    label: 'Round Table 60"',
    category: 'tables',
    match: ['round table', 'banquet table', 'dining table round', 'circular table'],
    reject: ['coffee', 'side', 'console', 'lamp', 'cloth', 'picnic'],
    dims: { widthMm: [inch(48), inch(84)], heightMm: [inch(26), inch(32)] },
    tableShape: 'round',
    seats: 8,
    freePlan: true,
  },
  {
    key: 'rectangular-table',
    label: 'Rectangular Banquet Table',
    category: 'tables',
    match: ['rectangular table', 'banquet table', 'trestle table', 'dining table', 'buffet table', 'conference table'],
    reject: ['coffee', 'side', 'console', 'lamp', 'cloth', 'pool table', 'ping pong'],
    dims: { widthMm: [ft(4), ft(10)], heightMm: [inch(26), inch(32)], depthMm: [inch(24), inch(48)] },
    tableShape: 'rectangular',
    seats: 8,
    freePlan: true,
  },
  {
    key: 'cocktail-table',
    label: 'Cocktail / Poseur Table',
    category: 'tables',
    match: ['cocktail table', 'poseur table', 'highboy table', 'bistro table', 'standing table', 'pub table'],
    reject: ['cloth'],
    dims: { widthMm: [inch(20), inch(40)], heightMm: [inch(36), inch(46)] },
    tableShape: 'round',
    seats: 4,
  },
  {
    key: 'coffee-table',
    label: 'Coffee Table',
    category: 'lounge',
    match: ['coffee table', 'sofa table', 'low table'],
    reject: ['lamp', 'cloth'],
    dims: { widthMm: [inch(24), inch(60)], heightMm: [inch(12), inch(22)] },
    tableShape: 'rectangular',
  },
  {
    key: 'side-table',
    label: 'Side Table',
    category: 'lounge',
    match: ['side table', 'end table', 'console table', 'accent table', 'nightstand'],
    reject: ['lamp', 'cloth'],
    dims: { widthMm: [inch(12), inch(36)], heightMm: [inch(16), inch(34)] },
  },

  /* ── Chairs & seating ────────────────────────────────────────────── */
  {
    key: 'banquet-chair',
    label: 'Banquet Chair',
    category: 'chairs',
    match: ['banquet chair', 'chiavari', 'tiffany chair', 'dining chair', 'stacking chair', 'event chair', 'conference chair'],
    reject: ['lift', 'wheelchair', 'high chair', 'car seat', 'sofa'],
    dims: { widthMm: [inch(14), inch(26)], heightMm: [inch(28), inch(46)] },
    freePlan: true,
  },
  {
    key: 'folding-chair',
    label: 'Folding Chair',
    category: 'chairs',
    match: ['folding chair', 'resin chair', 'garden chair', 'ceremony chair'],
    reject: ['lift', 'wheelchair', 'table'],
    dims: { widthMm: [inch(14), inch(24)], heightMm: [inch(28), inch(42)] },
    freePlan: true,
  },
  {
    key: 'outdoor-chair',
    label: 'Outdoor Chair',
    category: 'chairs',
    match: ['deck chair', 'beach chair', 'patio chair', 'lawn chair', 'adirondack'],
    reject: ['lift', 'wheelchair'],
    dims: { widthMm: [inch(16), inch(34)], heightMm: [inch(24), inch(46)] },
  },
  {
    key: 'bar-stool',
    label: 'Bar Stool',
    category: 'chairs',
    match: ['bar stool', 'barstool', 'counter stool', 'high stool'],
    reject: ['lift', 'table'],
    dims: { widthMm: [inch(12), inch(24)], heightMm: [inch(24), inch(48)] },
  },
  {
    key: 'stool',
    label: 'Stool',
    category: 'chairs',
    match: ['stool', 'ottoman', 'pouffe', 'pouf', 'footstool'],
    reject: ['bar stool', 'counter stool', 'lift'],
    dims: { widthMm: [inch(10), inch(30)], heightMm: [inch(12), inch(26)] },
  },
  {
    key: 'bench',
    label: 'Bench',
    category: 'chairs',
    match: ['bench', 'pew', 'settle bench'],
    reject: ['work bench', 'workbench', 'bench press', 'test bench'],
    dims: { widthMm: [ft(3), ft(8)], heightMm: [inch(14), inch(40)] },
  },

  /* ── Lounge & soft seating ───────────────────────────────────────── */
  {
    key: 'sofa',
    label: 'Sofa',
    category: 'lounge',
    match: ['sofa', 'couch', 'settee', 'loveseat', 'love seat', 'chesterfield', 'davenport'],
    // "Sofa table" is furniture but it is a *table*; the trap list re-routes it.
    reject: ['table', 'bed', 'sofa bed', 'cushion only', 'pillow', 'cover', 'throw'],
    dims: { widthMm: [ft(4), ft(12)], heightMm: [inch(22), inch(42)], depthMm: [inch(26), inch(50)] },
  },
  {
    key: 'armchair',
    label: 'Armchair',
    category: 'lounge',
    match: ['armchair', 'arm chair', 'lounge chair', 'club chair', 'wingback', 'accent chair', 'tub chair', 'easy chair'],
    reject: ['table', 'lift', 'wheelchair', 'office chair'],
    dims: { widthMm: [inch(24), inch(48)], heightMm: [inch(24), inch(48)], depthMm: [inch(24), inch(46)] },
  },
  {
    key: 'sectional',
    label: 'Sectional / Modular Seating',
    category: 'lounge',
    match: ['sectional', 'modular sofa', 'corner sofa', 'l shaped sofa'],
    reject: ['table'],
    dims: { widthMm: [ft(6), ft(16)], heightMm: [inch(22), inch(42)] },
  },

  /* ── Tents & structures ──────────────────────────────────────────── */
  {
    key: 'tent',
    label: 'Tent / Marquee',
    category: 'tents',
    match: ['marquee', 'frame tent', 'pole tent', 'party tent', 'event tent', 'canopy tent', 'gazebo', 'pavilion tent'],
    reject: ['camping tent', 'backpacking', 'dome tent', 'teepee toy', 'circus poster'],
    dims: { widthMm: [ft(10), ft(120)], heightMm: [ft(6), ft(40)] },
  },
  {
    key: 'canopy',
    label: 'Canopy / Pop-up',
    category: 'tents',
    match: ['canopy', 'pop up tent', 'awning', 'shade structure', 'pergola'],
    reject: ['camping'],
    dims: { widthMm: [ft(6), ft(40)], heightMm: [ft(6), ft(20)] },
  },

  /* ── Staging ─────────────────────────────────────────────────────── */
  {
    key: 'stage-deck',
    label: 'Stage Deck / Riser',
    category: 'staging',
    match: ['stage deck', 'stage platform', 'riser', 'staging deck', 'podium platform'],
    reject: ['stagecoach', 'stage coach', 'backstage pass'],
    dims: { widthMm: [ft(3), ft(10)], heightMm: [inch(4), inch(60)] },
  },
  {
    key: 'lectern',
    label: 'Lectern / Podium',
    category: 'staging',
    match: ['lectern', 'podium', 'pulpit', 'speaker stand'],
    reject: ['stage deck', 'platform'],
    dims: { widthMm: [inch(16), inch(36)], heightMm: [inch(36), inch(56)] },
  },
  {
    key: 'truss',
    label: 'Truss',
    category: 'staging',
    match: ['truss', 'lighting truss', 'trussing', 'goal post truss'],
    reject: ['bridge truss', 'roof truss'],
    dims: { widthMm: [ft(1), ft(40)], heightMm: [inch(8), ft(30)] },
  },

  /* ── Draping ─────────────────────────────────────────────────────── */
  {
    key: 'drape',
    label: 'Drape / Backdrop',
    category: 'draping',
    match: ['drape', 'curtain', 'backdrop', 'pipe and drape', 'valance', 'swag fabric'],
    reject: ['shower curtain', 'curtain wall', 'window blind'],
    dims: { widthMm: [ft(2), ft(40)], heightMm: [ft(3), ft(25)] },
  },

  /* ── Dance floors & rugs ─────────────────────────────────────────── */
  {
    key: 'dance-floor',
    label: 'Dance Floor Panel',
    category: 'dance-floors',
    match: ['dance floor', 'floor panel', 'parquet floor'],
    reject: ['flooring texture', 'floor plan'],
    dims: { widthMm: [ft(2), ft(30)], heightMm: [10, inch(6)] },
  },
  {
    key: 'rug',
    label: 'Rug',
    category: 'dance-floors',
    match: ['rug', 'carpet piece', 'area rug', 'runner rug'],
    reject: ['carpet texture', 'wall'],
    dims: { widthMm: [ft(2), ft(20)], heightMm: [2, inch(3)] },
  },

  /* ── Bars & catering ─────────────────────────────────────────────── */
  {
    key: 'bar-counter',
    label: 'Bar / Counter',
    category: 'bars-catering',
    match: ['bar counter', 'cocktail bar', 'drinks bar', 'reception desk', 'serving counter', 'buffet counter'],
    reject: ['chocolate bar', 'candy bar', 'granola', 'crowbar', 'rebar', 'metal bar', 'bar chart', 'bar stool'],
    dims: { widthMm: [ft(3), ft(20)], heightMm: [inch(34), inch(50)] },
  },
  {
    key: 'chafing-dish',
    label: 'Chafing Dish / Catering',
    category: 'bars-catering',
    match: ['chafing dish', 'chafer', 'catering tray', 'buffet warmer', 'serving dish'],
    dims: { widthMm: [inch(10), inch(30)], heightMm: [inch(4), inch(20)] },
  },
  {
    key: 'ice-bucket',
    label: 'Ice Bucket / Cooler',
    category: 'bars-catering',
    match: ['ice bucket', 'champagne bucket', 'wine cooler', 'drinks cooler'],
    dims: { widthMm: [inch(6), inch(24)], heightMm: [inch(6), inch(30)] },
  },

  /* ── Tableware ───────────────────────────────────────────────────── */
  {
    key: 'plate',
    label: 'Plate',
    category: 'tableware',
    match: ['plate', 'dinner plate', 'charger plate', 'side plate', 'dish'],
    reject: ['license plate', 'number plate', 'plate armor', 'steel plate', 'tectonic'],
    dims: { widthMm: [inch(5), inch(15)], heightMm: [5, inch(3)] },
    freePlan: true,
  },
  {
    key: 'glass',
    label: 'Glassware',
    category: 'tableware',
    match: ['wine glass', 'champagne flute', 'water glass', 'tumbler', 'goblet', 'cocktail glass', 'beer glass'],
    reject: ['glass pane', 'glass window', 'glass material', 'eyeglass', 'magnifying'],
    dims: { widthMm: [inch(2), inch(5)], heightMm: [inch(3), inch(11)] },
    freePlan: true,
  },
  {
    key: 'cutlery',
    label: 'Flatware',
    category: 'tableware',
    match: ['fork', 'knife', 'spoon', 'cutlery', 'flatware', 'silverware', 'teaspoon'],
    reject: ['forklift', 'fork lift', 'combat knife', 'hunting knife', 'butcher', 'pocket knife', 'road fork'],
    dims: { widthMm: [inch(0.5), inch(4)], heightMm: [3, inch(12)] },
    freePlan: true,
  },
  {
    key: 'napkin',
    label: 'Napkin',
    category: 'tableware',
    match: ['napkin', 'serviette'],
    dims: { widthMm: [inch(4), inch(24)], heightMm: [2, inch(6)] },
  },

  /* ── Linens ──────────────────────────────────────────────────────── */
  {
    key: 'linen',
    label: 'Table Linen',
    category: 'linens',
    match: ['tablecloth', 'table cloth', 'linen', 'table skirt', 'table runner', 'overlay cloth'],
    reject: ['bed linen', 'bedsheet', 'towel'],
    dims: { widthMm: [inch(24), ft(12)], heightMm: [10, inch(40)] },
  },

  /* ── Centerpieces & florals ──────────────────────────────────────── */
  {
    key: 'centerpiece',
    label: 'Centerpiece',
    category: 'centerpieces',
    match: ['centerpiece', 'centrepiece', 'flower arrangement', 'floral arrangement', 'bouquet', 'vase with flowers'],
    reject: ['garden bed', 'field'],
    dims: { widthMm: [inch(4), inch(30)], heightMm: [inch(4), inch(40)] },
  },
  {
    key: 'vase',
    label: 'Vase',
    category: 'centerpieces',
    match: ['vase', 'urn', 'flower pot ceramic'],
    reject: ['planter box'],
    dims: { widthMm: [inch(3), inch(20)], heightMm: [inch(4), inch(40)] },
  },
  {
    key: 'candle',
    label: 'Candle / Candelabra',
    category: 'centerpieces',
    match: ['candle', 'candelabra', 'candlestick', 'votive', 'tea light', 'hurricane lamp'],
    reject: ['candle texture'],
    dims: { widthMm: [inch(1), inch(20)], heightMm: [inch(1), inch(40)] },
  },

  /* ── Lighting ────────────────────────────────────────────────────── */
  {
    key: 'chandelier',
    label: 'Chandelier',
    category: 'lighting',
    match: ['chandelier', 'pendant light', 'hanging light', 'ceiling light'],
    reject: ['street light', 'traffic light'],
    dims: { widthMm: [inch(8), ft(8)], heightMm: [inch(8), ft(8)] },
  },
  {
    key: 'floor-lamp',
    label: 'Floor Lamp',
    category: 'lighting',
    match: ['floor lamp', 'standing lamp', 'torchiere'],
    reject: ['street lamp', 'table lamp'],
    dims: { widthMm: [inch(8), inch(30)], heightMm: [inch(40), inch(84)] },
  },
  {
    key: 'table-lamp',
    label: 'Table Lamp',
    category: 'lighting',
    match: ['table lamp', 'desk lamp', 'bedside lamp'],
    reject: ['floor lamp', 'street'],
    dims: { widthMm: [inch(4), inch(24)], heightMm: [inch(8), inch(36)] },
  },
  {
    key: 'uplight',
    label: 'Uplight / Par Can',
    category: 'lighting',
    match: ['uplight', 'up light', 'par can', 'par 64', 'stage light', 'moving head', 'spotlight fixture', 'wash light'],
    reject: ['street light', 'headlight', 'traffic'],
    dims: { widthMm: [inch(4), inch(20)], heightMm: [inch(4), inch(30)] },
  },
  {
    key: 'string-lights',
    label: 'String Lights / Festoon',
    category: 'lighting',
    match: ['string light', 'festoon', 'fairy light', 'bistro light'],
    dims: { widthMm: [ft(3), ft(60)], heightMm: [inch(1), ft(3)] },
  },
  {
    key: 'lantern',
    label: 'Lantern',
    category: 'lighting',
    match: ['lantern', 'storm lantern', 'paper lantern'],
    reject: ['street'],
    dims: { widthMm: [inch(3), inch(20)], heightMm: [inch(4), inch(30)] },
  },

  /* ── AV & production ─────────────────────────────────────────────── */
  {
    key: 'speaker',
    label: 'PA Speaker',
    category: 'av-production',
    match: ['pa speaker', 'loudspeaker', 'stage speaker', 'subwoofer', 'monitor speaker', 'line array'],
    reject: ['speaker phone', 'speaker person', 'headphone'],
    dims: { widthMm: [inch(8), inch(40)], heightMm: [inch(10), inch(60)] },
  },
  {
    key: 'microphone',
    label: 'Microphone',
    category: 'av-production',
    match: ['microphone', 'mic stand', 'mic'],
    reject: ['micro chip', 'microscope', 'microwave', 'microphone icon'],
    dims: { widthMm: [inch(1), inch(16)], heightMm: [inch(2), inch(72)] },
  },
  {
    key: 'screen',
    label: 'Projection Screen / Display',
    category: 'av-production',
    match: ['projection screen', 'projector screen', 'led wall', 'display screen', 'video wall', 'tv screen', 'monitor display'],
    reject: ['phone screen', 'window screen', 'screen door', 'sunscreen'],
    dims: { widthMm: [ft(2), ft(30)], heightMm: [ft(1), ft(20)] },
  },

  /* ── Plants & greenery ───────────────────────────────────────────── */
  {
    key: 'potted-plant',
    label: 'Potted Plant',
    category: 'plants',
    match: ['potted plant', 'houseplant', 'indoor plant', 'ficus', 'palm plant', 'monstera', 'fern pot'],
    reject: ['plant texture', 'power plant', 'plantation', 'grass patch'],
    dims: { widthMm: [inch(6), ft(6)], heightMm: [inch(6), ft(12)] },
  },
  {
    key: 'planter',
    label: 'Planter',
    category: 'plants',
    match: ['planter', 'plant pot', 'flower pot', 'planter box'],
    reject: ['power plant'],
    dims: { widthMm: [inch(6), ft(6)], heightMm: [inch(6), ft(4)] },
  },
  {
    key: 'tree',
    label: 'Tree',
    category: 'plants',
    match: ['tree', 'olive tree', 'topiary', 'palm tree'],
    reject: ['tree texture', 'family tree', 'christmas tree ornament', 'forest'],
    dims: { widthMm: [ft(1), ft(30)], heightMm: [ft(2), ft(50)] },
  },
  {
    key: 'hedge',
    label: 'Hedge / Greenery Wall',
    category: 'plants',
    match: ['hedge', 'greenery wall', 'boxwood', 'green wall panel'],
    dims: { widthMm: [ft(1), ft(20)], heightMm: [ft(1), ft(12)] },
  },

  /* ── Decor ───────────────────────────────────────────────────────── */
  {
    key: 'arch',
    label: 'Ceremony Arch',
    category: 'decor',
    match: ['wedding arch', 'ceremony arch', 'floral arch', 'chuppah', 'moon gate', 'arbour', 'arbor'],
    reject: ['archway building', 'architecture'],
    dims: { widthMm: [ft(3), ft(20)], heightMm: [ft(5), ft(16)] },
  },
  {
    key: 'easel',
    label: 'Easel / Sign Stand',
    category: 'signage',
    match: ['easel', 'sign stand', 'a-frame sign', 'sandwich board'],
    dims: { widthMm: [inch(16), inch(48)], heightMm: [inch(24), inch(84)] },
  },
  {
    key: 'stanchion',
    label: 'Stanchion / Rope Barrier',
    category: 'outdoor',
    match: ['stanchion', 'rope barrier', 'queue post', 'velvet rope', 'crowd barrier', 'bollard post'],
    reject: ['traffic bollard concrete'],
    dims: { widthMm: [inch(8), inch(30)], heightMm: [inch(30), inch(48)] },
  },
  {
    key: 'heater',
    label: 'Patio Heater',
    category: 'outdoor',
    match: ['patio heater', 'outdoor heater', 'mushroom heater', 'gas heater'],
    reject: ['radiator', 'water heater'],
    dims: { widthMm: [inch(12), inch(40)], heightMm: [ft(3), ft(9)] },
  },
  {
    key: 'umbrella',
    label: 'Parasol / Umbrella',
    category: 'outdoor',
    match: ['parasol', 'patio umbrella', 'garden umbrella', 'market umbrella'],
    reject: ['rain umbrella handheld'],
    dims: { widthMm: [ft(3), ft(16)], heightMm: [ft(5), ft(12)] },
  },

  /* ── Doors & windows ─────────────────────────────────────────────── */
  {
    key: 'door',
    label: 'Door',
    category: 'doors-windows',
    match: ['door', 'doorway', 'double door', 'entrance door'],
    reject: ['door handle', 'doorknob', 'car door', 'garage door opener', 'trapdoor'],
    dims: { widthMm: [inch(24), inch(96)], heightMm: [inch(72), inch(108)] },
    freePlan: true,
  },
  {
    key: 'window',
    label: 'Window',
    category: 'doors-windows',
    match: ['window', 'casement window', 'sash window'],
    reject: ['window curtain', 'car window', 'shop window display', 'windows logo'],
    dims: { widthMm: [inch(16), inch(120)], heightMm: [inch(16), inch(96)] },
    freePlan: true,
  },
];

const BY_KEY = new Map(TAXONOMY.map((t) => [t.key, t]));
export const taxonomyByKey = (key: string): TaxonomyEntry | undefined => BY_KEY.get(key);

/** Normalise a text bag for matching. */
export function textBag(parts: Array<string | string[] | null | undefined>): string {
  return parts
    .flatMap((p) => (Array.isArray(p) ? p : [p]))
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[_\-/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ClassificationResult {
  entry: TaxonomyEntry | null;
  /** 0–100. How confident the name/tag match is, before geometry is considered. */
  confidence: number;
  reasons: string[];
}

/**
 * Decide what an asset claims to be, from its text alone.
 *
 * Returns `null` when nothing matches, when a global reject term is present,
 * or when a head-noun trap routes the asset to `__reject__`.
 */
export function classifyByText(input: {
  name: string;
  description?: string | null;
  tags?: string[];
  categories?: string[];
}): ClassificationResult {
  const reasons: string[] = [];
  const name = (input.name || '').toLowerCase();
  const bag = textBag([input.name, input.description, input.tags, input.categories]);

  if (!bag) return { entry: null, confidence: 0, reasons: ['empty metadata'] };

  for (const term of GLOBAL_REJECT_TERMS) {
    if (bag.includes(term)) {
      return { entry: null, confidence: 0, reasons: [`global reject term: "${term}"`] };
    }
  }

  // Head-noun traps run first: they re-route compounds whose head noun differs
  // from the word a naive match would latch onto.
  for (const trap of HEAD_NOUN_TRAPS) {
    if (trap.pattern.test(bag)) {
      if (trap.actualKey === '__reject__') {
        return { entry: null, confidence: 0, reasons: [`disqualifying phrase: ${trap.pattern.source}`] };
      }
      const entry = BY_KEY.get(trap.actualKey);
      if (entry) {
        reasons.push(`head-noun trap routed to "${entry.key}"`);
        return { entry, confidence: 88, reasons };
      }
    }
  }

  let best: { entry: TaxonomyEntry; score: number; why: string } | null = null;

  for (const entry of TAXONOMY) {
    if (entry.reject?.some((r) => bag.includes(r))) continue;

    let score = 0;
    let why = '';
    for (const term of entry.match) {
      if (name === term) {
        score = Math.max(score, 100);
        why = `name is exactly "${term}"`;
      } else if (new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}\\b`, 'i').test(name)) {
        score = Math.max(score, 85);
        why ||= `name contains "${term}"`;
      } else if (new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}\\b`, 'i').test(bag)) {
        score = Math.max(score, 55);
        why ||= `metadata mentions "${term}"`;
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { entry, score, why };
  }

  if (!best) return { entry: null, confidence: 0, reasons: ['no taxonomy term matched'] };
  reasons.push(best.why);
  return { entry: best.entry, confidence: best.score, reasons };
}
