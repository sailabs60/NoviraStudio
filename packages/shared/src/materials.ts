/**
 * Surface finishes.
 *
 * A finish is a real, measured material applied to a real surface: 18 mm birch
 * ply on a stand's fascia, grey loop-pile carpet on a hall floor, brushed
 * stainless on a counter edge. That framing decides the whole design of this
 * module.
 *
 * Two consequences follow, and both matter more than they look:
 *
 *  · **A finish belongs to a part, not to an object.** A reception counter has
 *    a laminate top, a painted body and a metal kick. Painting the whole thing
 *    one colour is what a toy does. So finishes are stored keyed by the part
 *    they were dropped on, with `'*'` reserved for "the whole object" — which
 *    is what you get when you drop onto something that has only one part.
 *
 *  · **Tiling is in millimetres, not in repeats.** A "2× repeat" means nothing
 *    on a surface whose size you have not been told. A 300 mm tile is a
 *    300 mm tile whether it lands on a coffee table or a 40 m backwall, and it
 *    stays right when the object is resized. Every finish carries a real-world
 *    tile size, and the renderer derives the repeat from the surface.
 *
 * The built-in library below is the offline floor. The online providers —
 * ambientCG, Poly Haven, BlenderKit — extend it to thousands of scanned
 * surfaces, and an imported one becomes an ordinary `SurfaceFinish` with the
 * same fields, so nothing downstream has to know where a material came from.
 */

/* ── The finish ────────────────────────────────────────────────────────── */

export const MAP_CHANNELS = ['color', 'normal', 'roughness', 'metalness', 'ao', 'displacement'] as const;
export type MapChannel = (typeof MAP_CHANNELS)[number];

export type MaterialMaps = Partial<Record<MapChannel, string>>;

export interface SurfaceFinish {
  /** Stable id: `builtin:oak-natural`, or `ambientcg:Wood062`. */
  materialId: string;
  label: string;
  /** Where it came from, for attribution and for the licence line. */
  source?: string;
  license?: string;
  /** Texture maps. All optional — a finish can be a plain tinted surface. */
  maps?: MaterialMaps;
  /** Real-world width of one tile of the texture, in millimetres. */
  tileMm: number;
  /** Rotation of the texture on the surface, in degrees. */
  rotationDeg?: number;
  /** Base colour, applied as a tint over the colour map or alone without one. */
  colorHex: string;
  roughness: number;
  metalness: number;
  /** 0 keeps the surface flat; higher values push the normal map. */
  normalScale?: number;
  /** Emissive strength, for LED faces, neon and backlit graphics. */
  emissiveIntensity?: number;
  /** 1 is opaque. Below 1 turns the surface transparent. */
  opacity?: number;
  /** Thumbnail for the library row. */
  previewUrl?: string;
}

/**
 * The finishes applied to one object.
 *
 * Keyed by part name — the glTF material name for a catalogue model, or one of
 * the procedural builders' named surfaces (`top`, `body`, `frame`, `fascia`…).
 * `'*'` applies to everything that has no more specific entry, which is what
 * makes "drop a material on a simple object" work without the user ever
 * learning that parts exist.
 */
export type FinishMap = Record<string, SurfaceFinish>;

export const WHOLE_OBJECT = '*';

/** The finish that should be used for one part, honouring the `'*'` fallback. */
export function finishForPart(finishes: FinishMap | undefined, part: string): SurfaceFinish | null {
  if (!finishes) return null;
  return finishes[part] ?? finishes[WHOLE_OBJECT] ?? null;
}

/**
 * How many times a tile repeats across a surface.
 *
 * Clamped at both ends: below 1 the texture stretches into a blur, and above a
 * few hundred it aliases into noise and costs fill rate for nothing.
 */
export function tileRepeat(surfaceMm: number, tileMm: number): number {
  if (!Number.isFinite(surfaceMm) || !Number.isFinite(tileMm) || tileMm <= 0) return 1;
  return Math.min(400, Math.max(0.05, surfaceMm / tileMm));
}

/* ── Families ──────────────────────────────────────────────────────────── */

export const MATERIAL_FAMILIES = [
  'timber',
  'panel',
  'metal',
  'stone',
  'concrete',
  'fabric',
  'carpet',
  'glass',
  'plastic',
  'paint',
  'light',
] as const;
export type MaterialFamily = (typeof MATERIAL_FAMILIES)[number];

export interface MaterialFamilyInfo {
  key: MaterialFamily;
  label: string;
  /** What this family is used for on an event build. */
  note: string;
}

export const MATERIAL_FAMILY_INFO: Record<MaterialFamily, MaterialFamilyInfo> = {
  timber: { key: 'timber', label: 'Timber', note: 'Solid and veneered wood — floors, tops, slatted screens.' },
  panel: { key: 'panel', label: 'Sheet & panel', note: 'Ply, MDF and laminate: what a stand is actually made of.' },
  metal: { key: 'metal', label: 'Metal', note: 'Truss, frames, counter edges and trims.' },
  stone: { key: 'stone', label: 'Stone', note: 'Marble, granite and terrazzo, for surfaces that must read expensive.' },
  concrete: { key: 'concrete', label: 'Concrete & plaster', note: 'The hall you are usually standing in.' },
  fabric: { key: 'fabric', label: 'Fabric', note: 'Drape, upholstery, stretch and printed textile.' },
  carpet: { key: 'carpet', label: 'Carpet & floor covering', note: 'Loop pile, needlefelt and vinyl — priced per square metre.' },
  glass: { key: 'glass', label: 'Glass & acrylic', note: 'Vitrines, balustrades and lit acrylic.' },
  plastic: { key: 'plastic', label: 'Plastic & composite', note: 'Moulded furniture, ACM and solid surface.' },
  paint: { key: 'paint', label: 'Paint', note: 'Flat, eggshell and gloss, in any colour you name.' },
  light: { key: 'light', label: 'Light-emitting', note: 'LED faces, neon, edge-lit graphics and backlit fabric.' },
};

/* ── The built-in library ──────────────────────────────────────────────── */

export interface BuiltInMaterial extends SurfaceFinish {
  family: MaterialFamily;
  /** Search terms a designer would type. */
  tags: string[];
  /**
   * Indicative supply-and-fix cost per square metre, in minor units of the
   * rate card's currency. Used by the estimator when a finish is specified,
   * and left null where the material is not sold by area.
   */
  costPerSqM?: number | null;
}

function m(
  id: string,
  label: string,
  family: MaterialFamily,
  colorHex: string,
  roughness: number,
  metalness: number,
  tileMm: number,
  tags: string[],
  extra: Partial<BuiltInMaterial> = {}
): BuiltInMaterial {
  return {
    materialId: `builtin:${id}`,
    label,
    family,
    colorHex,
    roughness,
    metalness,
    tileMm,
    tags,
    source: 'Novira',
    license: 'Included',
    costPerSqM: null,
    ...extra,
  };
}

/**
 * Sixty-odd finishes covering what actually gets specified on an event build.
 *
 * Every one is a plain tinted PBR surface with no texture map, which is a
 * deliberate choice rather than a shortcut: they load instantly, they render
 * identically on a laptop with no GPU, and they are correct enough for a
 * layout. Photographic detail is what the online libraries are for, and
 * swapping one in changes only the `maps` field.
 */
export const BUILT_IN_MATERIALS: BuiltInMaterial[] = [
  // Timber.
  m('oak-natural', 'Oak, natural', 'timber', '#c8a675', 0.62, 0, 180, ['wood', 'oak', 'floor', 'warm'], { costPerSqM: 6500 }),
  m('oak-smoked', 'Oak, smoked', 'timber', '#6f5540', 0.6, 0, 180, ['wood', 'oak', 'dark', 'floor'], { costPerSqM: 7200 }),
  m('walnut', 'American walnut', 'timber', '#5b4130', 0.5, 0, 180, ['wood', 'walnut', 'luxury', 'dark'], { costPerSqM: 9800 }),
  m('ash-pale', 'Ash, pale', 'timber', '#ddc9a8', 0.65, 0, 180, ['wood', 'ash', 'light', 'scandi'], { costPerSqM: 6000 }),
  m('pine-raw', 'Pine, unfinished', 'timber', '#d9bd8c', 0.82, 0, 160, ['wood', 'pine', 'raw', 'cheap'], { costPerSqM: 3200 }),
  m('bamboo', 'Bamboo', 'timber', '#c9ab77', 0.6, 0, 150, ['wood', 'bamboo', 'sustainable'], { costPerSqM: 5400 }),
  m('parquet-herringbone', 'Parquet, herringbone', 'timber', '#b08a5c', 0.55, 0, 600, ['floor', 'parquet', 'herringbone'], { costPerSqM: 12000 }),
  m('timber-slat', 'Timber slat screen', 'timber', '#a9855c', 0.6, 0, 120, ['slat', 'screen', 'batten', 'acoustic'], { costPerSqM: 14000 }),
  m('charred-timber', 'Charred timber', 'timber', '#2f2b28', 0.72, 0, 180, ['shou sugi ban', 'black', 'wood'], { costPerSqM: 11000 }),

  // Sheet and panel — the fabric of an exhibition stand.
  m('birch-ply', 'Birch plywood, 18 mm', 'panel', '#e0c79c', 0.68, 0, 1200, ['ply', 'plywood', 'birch', 'stand'], { costPerSqM: 4800 }),
  m('ply-edge', 'Plywood, exposed edge', 'panel', '#d3bb98', 0.7, 0, 1200, ['ply', 'edge', 'exposed'], { costPerSqM: 5200 }),
  m('mdf-raw', 'MDF, raw', 'panel', '#b39a78', 0.85, 0, 1200, ['mdf', 'raw', 'unpainted'], { costPerSqM: 2600 }),
  m('mdf-sprayed', 'MDF, sprayed', 'panel', '#f2f3f5', 0.35, 0, 1200, ['mdf', 'painted', 'sprayed', 'smooth'], { costPerSqM: 6800 }),
  m('laminate-white', 'Laminate, white', 'panel', '#f7f8fa', 0.28, 0, 1200, ['laminate', 'white', 'counter'], { costPerSqM: 5600 }),
  m('laminate-black', 'Laminate, black', 'panel', '#191b1e', 0.3, 0, 1200, ['laminate', 'black', 'counter'], { costPerSqM: 5600 }),
  m('acm-white', 'Composite panel, white', 'panel', '#fafbfc', 0.3, 0.05, 1200, ['acm', 'dibond', 'cladding'], { costPerSqM: 8200 }),
  m('foamex', 'Foam PVC, printed', 'panel', '#eceff3', 0.75, 0, 1000, ['foamex', 'print', 'signage'], { costPerSqM: 3400 }),
  m('acoustic-felt', 'Acoustic felt panel', 'panel', '#6c7480', 0.95, 0, 600, ['acoustic', 'felt', 'pet'], { costPerSqM: 9500 }),

  // Metal.
  m('steel-brushed', 'Stainless, brushed', 'metal', '#b8bcc2', 0.34, 0.92, 400, ['steel', 'stainless', 'brushed'], { costPerSqM: 14000 }),
  m('steel-polished', 'Stainless, mirror', 'metal', '#d5d9de', 0.08, 0.98, 400, ['steel', 'mirror', 'polished'], { costPerSqM: 19000 }),
  m('aluminium-mill', 'Aluminium, mill finish', 'metal', '#b0b4b8', 0.42, 0.85, 400, ['aluminium', 'truss', 'extrusion'] ),
  m('aluminium-anodised', 'Aluminium, black anodised', 'metal', '#3a3d41', 0.4, 0.8, 400, ['aluminium', 'black', 'anodised']),
  m('brass', 'Brass, satin', 'metal', '#b79655', 0.32, 0.9, 400, ['brass', 'gold', 'luxury', 'trim'], { costPerSqM: 22000 }),
  m('copper', 'Copper', 'metal', '#a8603c', 0.35, 0.9, 400, ['copper', 'warm', 'trim']),
  m('blackened-steel', 'Blackened steel', 'metal', '#33363a', 0.55, 0.85, 400, ['steel', 'black', 'industrial']),
  m('galvanised', 'Galvanised steel', 'metal', '#9aa1a8', 0.6, 0.8, 400, ['galvanised', 'deck', 'industrial']),
  m('powder-white', 'Powder coat, white', 'metal', '#f4f6f8', 0.45, 0.3, 400, ['powder', 'coat', 'white', 'frame']),
  m('powder-black', 'Powder coat, black', 'metal', '#1c1e21', 0.45, 0.3, 400, ['powder', 'coat', 'black', 'frame']),

  // Stone.
  m('marble-carrara', 'Carrara marble', 'stone', '#eceef0', 0.16, 0, 900, ['marble', 'white', 'luxury'], { costPerSqM: 34000 }),
  m('marble-nero', 'Nero Marquina', 'stone', '#1a1c1f', 0.15, 0, 900, ['marble', 'black', 'luxury'], { costPerSqM: 38000 }),
  m('granite', 'Granite, flamed', 'stone', '#787b80', 0.72, 0, 700, ['granite', 'grey', 'hard']),
  m('terrazzo', 'Terrazzo', 'stone', '#dcd7cd', 0.4, 0, 800, ['terrazzo', 'speckled', 'floor'], { costPerSqM: 26000 }),
  m('travertine', 'Travertine', 'stone', '#d8c8ac', 0.55, 0, 800, ['travertine', 'warm', 'stone']),
  m('slate', 'Slate', 'stone', '#3f4448', 0.7, 0, 700, ['slate', 'dark', 'floor']),

  // Concrete and plaster — the venue itself.
  m('concrete-poured', 'Concrete, power floated', 'concrete', '#a5a8ab', 0.78, 0, 2000, ['concrete', 'floor', 'hall'], { costPerSqM: 0 }),
  m('concrete-board', 'Board-marked concrete', 'concrete', '#9b9ea1', 0.8, 0, 1400, ['concrete', 'board', 'brutalist']),
  m('plaster-smooth', 'Plaster, smooth', 'concrete', '#eae7e2', 0.85, 0, 1600, ['plaster', 'wall', 'white']),
  m('microcement', 'Microcement', 'concrete', '#c4c0b9', 0.6, 0, 1600, ['microcement', 'seamless', 'floor'], { costPerSqM: 15000 }),
  m('brick-red', 'Brick, red', 'concrete', '#8d4c3a', 0.86, 0, 460, ['brick', 'wall', 'warehouse']),
  m('brick-white', 'Brick, painted white', 'concrete', '#e6e3de', 0.86, 0, 460, ['brick', 'white', 'loft']),

  // Fabric.
  m('velvet-navy', 'Velvet, navy', 'fabric', '#1d2a44', 0.92, 0, 400, ['velvet', 'drape', 'navy', 'luxury'], { costPerSqM: 8400 }),
  m('velvet-emerald', 'Velvet, emerald', 'fabric', '#154736', 0.92, 0, 400, ['velvet', 'green', 'drape'], { costPerSqM: 8400 }),
  m('wool-grey', 'Wool, mid grey', 'fabric', '#7d8189', 0.9, 0, 300, ['wool', 'upholstery', 'grey'], { costPerSqM: 7200 }),
  m('linen-natural', 'Linen, natural', 'fabric', '#d8cdb8', 0.94, 0, 300, ['linen', 'natural', 'soft'], { costPerSqM: 5600 }),
  m('molton-black', 'Molton, black', 'fabric', '#141517', 0.98, 0, 500, ['molton', 'drape', 'masking', 'black'], { costPerSqM: 2400 }),
  m('stretch-white', 'Stretch fabric, white', 'fabric', '#f5f6f8', 0.86, 0, 800, ['stretch', 'lycra', 'projection'], { costPerSqM: 4800 }),
  m('leather-tan', 'Leather, tan', 'fabric', '#8c5c38', 0.55, 0, 350, ['leather', 'tan', 'upholstery'], { costPerSqM: 21000 }),
  m('leather-black', 'Leather, black', 'fabric', '#212326', 0.5, 0, 350, ['leather', 'black', 'upholstery'], { costPerSqM: 21000 }),
  m('printed-textile', 'Printed textile', 'fabric', '#e8eaee', 0.88, 0, 1000, ['print', 'graphic', 'sublimation'], { costPerSqM: 5200 }),

  // Floor coverings — the ones the take-off actually prices.
  m('carpet-grey', 'Event carpet, grey', 'carpet', '#63676d', 0.96, 0, 800, ['carpet', 'grey', 'floor'], { costPerSqM: 1400 }),
  m('carpet-charcoal', 'Event carpet, charcoal', 'carpet', '#33373c', 0.96, 0, 800, ['carpet', 'charcoal', 'floor'], { costPerSqM: 1400 }),
  m('carpet-red', 'Event carpet, red', 'carpet', '#8e2027', 0.96, 0, 800, ['carpet', 'red', 'floor', 'gala'], { costPerSqM: 1600 }),
  m('carpet-loop-blue', 'Loop pile, blue', 'carpet', '#2b4a72', 0.95, 0, 800, ['carpet', 'blue', 'loop'], { costPerSqM: 2600 }),
  m('vinyl-wood', 'Vinyl, wood effect', 'carpet', '#b5946a', 0.6, 0, 200, ['vinyl', 'lvt', 'floor'], { costPerSqM: 3800 }),
  m('vinyl-black', 'Dance floor, black', 'carpet', '#1a1c1e', 0.35, 0, 2000, ['dance', 'floor', 'black', 'harlequin'], { costPerSqM: 4200 }),
  m('astroturf', 'Artificial grass', 'carpet', '#4a7a3c', 0.95, 0, 300, ['grass', 'astro', 'green'], { costPerSqM: 2200 }),

  // Glass and acrylic.
  m('glass-clear', 'Glass, clear', 'glass', '#dfeaf2', 0.05, 0, 1200, ['glass', 'clear', 'vitrine'], { opacity: 0.24 }),
  m('glass-frosted', 'Glass, frosted', 'glass', '#e6edf2', 0.55, 0, 1200, ['glass', 'frosted', 'privacy'], { opacity: 0.62 }),
  m('glass-bronze', 'Glass, bronze tint', 'glass', '#8a7355', 0.08, 0, 1200, ['glass', 'tinted', 'bronze'], { opacity: 0.4 }),
  m('mirror', 'Mirror', 'glass', '#e8ecef', 0.02, 1, 1200, ['mirror', 'reflective']),
  m('acrylic-white', 'Acrylic, opal', 'glass', '#f3f5f7', 0.3, 0, 1000, ['acrylic', 'opal', 'diffuser'], { opacity: 0.82 }),

  // Plastic and composite.
  m('solid-surface', 'Solid surface (Corian)', 'plastic', '#f1f2f3', 0.32, 0, 1200, ['corian', 'solid surface', 'counter'], { costPerSqM: 28000 }),
  m('polycarbonate', 'Polycarbonate, twin-wall', 'plastic', '#dfe6ea', 0.4, 0, 600, ['polycarbonate', 'translucent'], { opacity: 0.6 }),
  m('rubber-stud', 'Rubber, studded', 'plastic', '#2e3134', 0.9, 0, 300, ['rubber', 'floor', 'stud']),

  // Paint — the most-specified finish on any stand.
  m('paint-white', 'Paint, brilliant white', 'paint', '#fbfcfd', 0.62, 0, 2000, ['paint', 'white', 'wall'], { costPerSqM: 1800 }),
  m('paint-warm-white', 'Paint, warm white', 'paint', '#f4f1ea', 0.62, 0, 2000, ['paint', 'off white', 'warm']),
  m('paint-light-grey', 'Paint, light grey', 'paint', '#d5d8dc', 0.62, 0, 2000, ['paint', 'grey']),
  m('paint-charcoal', 'Paint, charcoal', 'paint', '#2e3236', 0.62, 0, 2000, ['paint', 'dark', 'charcoal']),
  m('paint-black-matt', 'Paint, dead matt black', 'paint', '#111315', 0.98, 0, 2000, ['paint', 'black', 'matt', 'stage']),
  m('paint-brand', 'Paint, brand colour', 'paint', '#0072FD', 0.6, 0, 2000, ['paint', 'brand', 'colour', 'accent']),
  m('gloss-white', 'Lacquer, gloss white', 'paint', '#ffffff', 0.08, 0, 2000, ['gloss', 'lacquer', 'shiny']),

  // Light-emitting.
  m('led-face', 'LED screen face', 'light', '#0d1014', 0.4, 0, 250, ['led', 'screen', 'video'], { emissiveIntensity: 0.9 }),
  m('neon-blue', 'Neon, blue', 'light', '#0072FD', 0.3, 0, 200, ['neon', 'blue', 'sign'], { emissiveIntensity: 2.4 }),
  m('neon-warm', 'Neon, warm white', 'light', '#ffd9a8', 0.3, 0, 200, ['neon', 'warm', 'sign'], { emissiveIntensity: 2.2 }),
  m('backlit-fabric', 'Backlit fabric', 'light', '#fdf6ec', 0.85, 0, 1000, ['backlit', 'lightbox', 'fabric'], { emissiveIntensity: 1.1 }),
  m('edge-lit-acrylic', 'Edge-lit acrylic', 'light', '#cfe8ff', 0.2, 0, 800, ['edge lit', 'acrylic', 'sign'], { emissiveIntensity: 1.5, opacity: 0.8 }),
];

const BY_ID = new Map(BUILT_IN_MATERIALS.map((mat) => [mat.materialId, mat]));

export function builtInMaterial(materialId: string): BuiltInMaterial | undefined {
  return BY_ID.get(materialId);
}

export function materialsInFamily(family: MaterialFamily): BuiltInMaterial[] {
  return BUILT_IN_MATERIALS.filter((mat) => mat.family === family);
}

/** Free-text search across label, family and tags. */
export function searchMaterials(query: string): BuiltInMaterial[] {
  const q = query.trim().toLowerCase();
  if (!q) return BUILT_IN_MATERIALS;
  const terms = q.split(/\s+/).filter(Boolean);
  return BUILT_IN_MATERIALS.filter((mat) => {
    const bag = `${mat.label} ${mat.family} ${mat.tags.join(' ')}`.toLowerCase();
    return terms.every((term) => bag.includes(term));
  });
}

/** Strip a library entry down to what a scene stores. */
export function toFinish(mat: BuiltInMaterial | SurfaceFinish): SurfaceFinish {
  return {
    materialId: mat.materialId,
    label: mat.label,
    source: mat.source,
    license: mat.license,
    maps: mat.maps,
    tileMm: mat.tileMm,
    rotationDeg: mat.rotationDeg,
    colorHex: mat.colorHex,
    roughness: mat.roughness,
    metalness: mat.metalness,
    normalScale: mat.normalScale,
    emissiveIntensity: mat.emissiveIntensity,
    opacity: mat.opacity,
    previewUrl: mat.previewUrl,
  };
}

/**
 * Turn a provider's material row into a finish.
 *
 * ambientCG and Poly Haven both hand back a bag of map URLs under varying
 * channel names. Normalising here rather than at each call site means a new
 * provider needs one mapping entry, not a change everywhere a material is
 * applied.
 */
export function finishFromProviderMaps(input: {
  materialId: string;
  label: string;
  source?: string;
  license?: string;
  maps: Record<string, string | null | undefined>;
  previewUrl?: string;
  /** Providers publish a physical size for scanned surfaces; default 1 m. */
  tileMm?: number;
}): SurfaceFinish {
  const pick = (...names: string[]): string | undefined => {
    for (const name of names) {
      const value = input.maps[name];
      if (typeof value === 'string' && value) return value;
    }
    return undefined;
  };

  return {
    materialId: input.materialId,
    label: input.label,
    source: input.source,
    license: input.license,
    previewUrl: input.previewUrl,
    tileMm: input.tileMm && input.tileMm > 0 ? input.tileMm : 1000,
    colorHex: '#ffffff',
    roughness: 1,
    metalness: 0,
    normalScale: 1,
    maps: {
      color: pick('color', 'colour', 'diffuse', 'albedo', 'basecolor', 'base_color', 'Color', 'Diffuse'),
      normal: pick('normal', 'normalGL', 'normal_gl', 'nor_gl', 'Normal', 'NormalGL'),
      roughness: pick('roughness', 'rough', 'Roughness'),
      metalness: pick('metalness', 'metallic', 'metal', 'Metalness'),
      ao: pick('ao', 'ambientOcclusion', 'ambient_occlusion', 'AO'),
      displacement: pick('displacement', 'height', 'disp', 'Displacement'),
    },
  };
}
