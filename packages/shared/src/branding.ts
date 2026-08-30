/**
 * Branding: dimensional text and artwork.
 *
 * This is the part of the platform where a planner puts a client's identity
 * into the room — a couple's names cut in acrylic, a sponsor logo backlit
 * behind a bar, a monogram projected onto a dance floor. It is not decoration
 * bolted onto the editor; for a lot of events it *is* the design brief.
 *
 * Two things shape the model:
 *
 * 1. **Everything is a real material.** "Make the artwork glow" and "make the
 *    letters look like glass" are the two things people actually ask for, so
 *    emission and transmission are first-class properties with sane ranges,
 *    not buried numeric fields. A backlit sign and a frosted acrylic panel are
 *    both one control away.
 *
 * 2. **Extrude and intrude are the same axis.** Raised lettering and engraved
 *    lettering are the same job seen from either side, so depth is signed
 *    rather than being two separate object types: positive stands proud of the
 *    backing, negative is cut into it. That keeps the UI to one slider that
 *    crosses zero, which is how Spline and SketchUp both treat push/pull.
 *
 * Lengths are integer millimetres, as everywhere else.
 */

/* ── Materials ─────────────────────────────────────────────────────────── */

export const BRAND_FINISHES = [
  'matte',
  'satin',
  'gloss',
  'metal',
  'brushed-metal',
  'acrylic',
  'frosted-acrylic',
  'glass',
  'neon',
  'backlit',
  'mirror',
  'wood',
] as const;
export type BrandFinish = (typeof BRAND_FINISHES)[number];

/**
 * A physical description of a surface.
 *
 * These map onto `MeshPhysicalMaterial`, so the names mean what they mean in
 * the renderer rather than being an invented abstraction.
 */
export interface BrandMaterial {
  color: string;
  /** 0 = dielectric, 1 = metal. */
  metalness: number;
  /** 0 = mirror-smooth, 1 = fully diffuse. */
  roughness: number;
  /** Light the surface gives off. This is what "make it glow" means. */
  emissiveColor: string;
  /** 0 turns emission off. Above ~1 blooms under the bloom pass. */
  emissiveIntensity: number;
  /** 0 = opaque, 1 = fully transmissive. Glass and acrylic live here. */
  transmission: number;
  /** How far light travels through the body, in millimetres. */
  thicknessMm: number;
  /** Index of refraction. 1.5 is glass, 1.49 acrylic. */
  ior: number;
  /** Surface haze. Frosted acrylic is transmission 1 with high roughness. */
  opacity: number;
  /** Clear lacquer over the base, as on a painted sign. */
  clearcoat: number;
}

export const DEFAULT_BRAND_MATERIAL: BrandMaterial = {
  color: '#e7e3da',
  metalness: 0,
  roughness: 0.45,
  emissiveColor: '#000000',
  emissiveIntensity: 0,
  transmission: 0,
  thicknessMm: 12,
  ior: 1.5,
  opacity: 1,
  clearcoat: 0,
};

/**
 * Named finishes.
 *
 * Every one of these is a real thing a fabricator would quote for, which is
 * the point: a planner picks "brushed metal" and gets something a supplier
 * would recognise, rather than guessing at five sliders.
 */
export const FINISH_PRESETS: Record<BrandFinish, Partial<BrandMaterial> & { label: string; note: string }> = {
  matte: {
    label: 'Matte',
    note: 'Flat painted board. Reads cleanly at any distance.',
    metalness: 0, roughness: 0.9, transmission: 0, emissiveIntensity: 0, clearcoat: 0,
  },
  satin: {
    label: 'Satin',
    note: 'Soft sheen, the default for painted signage.',
    metalness: 0, roughness: 0.45, transmission: 0, emissiveIntensity: 0, clearcoat: 0.2,
  },
  gloss: {
    label: 'Gloss',
    note: 'Lacquered. Picks up highlights from the room.',
    metalness: 0, roughness: 0.08, transmission: 0, emissiveIntensity: 0, clearcoat: 1,
  },
  metal: {
    label: 'Polished metal',
    note: 'Mirror-finish brass or steel lettering.',
    metalness: 1, roughness: 0.12, transmission: 0, emissiveIntensity: 0, clearcoat: 0,
  },
  'brushed-metal': {
    label: 'Brushed metal',
    note: 'Directional grain. The usual choice for corporate marks.',
    metalness: 1, roughness: 0.38, transmission: 0, emissiveIntensity: 0, clearcoat: 0,
  },
  acrylic: {
    label: 'Clear acrylic',
    note: 'Laser-cut perspex. Nearly invisible edge-on.',
    metalness: 0, roughness: 0.05, transmission: 0.92, ior: 1.49, emissiveIntensity: 0, clearcoat: 0.4,
  },
  'frosted-acrylic': {
    label: 'Frosted acrylic',
    note: 'Diffuses whatever is behind it. Hides fixings well.',
    metalness: 0, roughness: 0.62, transmission: 0.85, ior: 1.49, emissiveIntensity: 0, clearcoat: 0,
  },
  glass: {
    label: 'Glass',
    note: 'Heavier and more refractive than acrylic.',
    metalness: 0, roughness: 0.02, transmission: 1, ior: 1.52, emissiveIntensity: 0, clearcoat: 0.3,
  },
  neon: {
    label: 'Neon',
    note: 'Glowing tube. Set the colour, not the brightness, first.',
    metalness: 0, roughness: 0.3, transmission: 0, emissiveIntensity: 3.2, clearcoat: 0,
  },
  backlit: {
    label: 'Backlit',
    note: 'Halo-lit letters or an illuminated panel.',
    metalness: 0, roughness: 0.55, transmission: 0.25, emissiveIntensity: 1.4, clearcoat: 0,
  },
  mirror: {
    label: 'Mirror',
    note: 'Reflects the room. Striking behind a top table.',
    metalness: 1, roughness: 0.02, transmission: 0, emissiveIntensity: 0, clearcoat: 0,
  },
  wood: {
    label: 'Wood',
    note: 'Stained ply or oak. Warm under tungsten.',
    metalness: 0, roughness: 0.75, transmission: 0, emissiveIntensity: 0, clearcoat: 0.1,
  },
};

/** Apply a finish over a material, keeping anything the finish does not set. */
export function applyFinish(base: BrandMaterial, finish: BrandFinish): BrandMaterial {
  const preset = FINISH_PRESETS[finish];
  const { label: _label, note: _note, ...values } = preset;
  const next = { ...base, ...values };
  // A neon or backlit finish is meaningless without a lit colour, so seed it
  // from the body colour the first time it is chosen.
  if ((finish === 'neon' || finish === 'backlit') && next.emissiveColor === '#000000') {
    next.emissiveColor = base.color;
  }
  return next;
}

/* ── Type ──────────────────────────────────────────────────────────────── */

export const BRAND_FONTS = [
  { key: 'helvetiker_regular', label: 'Helvetiker', weight: 'Regular' },
  { key: 'helvetiker_bold', label: 'Helvetiker', weight: 'Bold' },
  { key: 'optimer_regular', label: 'Optimer', weight: 'Regular' },
  { key: 'optimer_bold', label: 'Optimer', weight: 'Bold' },
  { key: 'gentilis_regular', label: 'Gentilis', weight: 'Regular' },
  { key: 'gentilis_bold', label: 'Gentilis', weight: 'Bold' },
  { key: 'droid_sans_regular', label: 'Droid Sans', weight: 'Regular' },
  { key: 'droid_sans_bold', label: 'Droid Sans', weight: 'Bold' },
  { key: 'droid_serif_regular', label: 'Droid Serif', weight: 'Regular' },
  { key: 'droid_serif_bold', label: 'Droid Serif', weight: 'Bold' },
  { key: 'droid_sans_mono_regular', label: 'Droid Mono', weight: 'Regular' },
] as const;
export type BrandFontKey = (typeof BRAND_FONTS)[number]['key'];

export const TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const;
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number];

/**
 * A backing panel behind the lettering.
 *
 * Required for engraved text — you cannot cut into nothing — and optional for
 * raised text, where it is the difference between free-standing letters and a
 * plaque.
 */
export interface BrandBacking {
  enabled: boolean;
  /** Margin around the text bounds. */
  paddingMm: number;
  thicknessMm: number;
  /** 0 is a square panel; larger rounds the corners. */
  cornerRadiusMm: number;
  material: BrandMaterial;
}

export const DEFAULT_BACKING: BrandBacking = {
  enabled: false,
  paddingMm: 60,
  thicknessMm: 18,
  cornerRadiusMm: 12,
  material: { ...DEFAULT_BRAND_MATERIAL, color: '#3a3631', roughness: 0.7 },
};

export interface Text3DSceneObjectData {
  content: string;
  font: BrandFontKey;
  /** Cap height of the lettering. */
  sizeMm: number;
  /**
   * Signed depth. Positive stands proud of the backing (extrude); negative is
   * cut into it (intrude). Zero is a flat cut-out with no thickness.
   */
  depthMm: number;
  bevelEnabled: boolean;
  bevelSizeMm: number;
  bevelThicknessMm: number;
  bevelSegments: number;
  /** Higher is smoother on curves, at a cost in triangles. */
  curveSegments: number;
  letterSpacingMm: number;
  lineHeight: number;
  alignment: TextAlignment;
  finish: BrandFinish;
  material: BrandMaterial;
  backing: BrandBacking;
}

export const DEFAULT_TEXT_3D: Text3DSceneObjectData = {
  content: 'Celebrate',
  font: 'helvetiker_bold',
  sizeMm: 300,
  depthMm: 60,
  bevelEnabled: true,
  bevelSizeMm: 2,
  bevelThicknessMm: 3,
  bevelSegments: 3,
  curveSegments: 8,
  letterSpacingMm: 0,
  lineHeight: 1.2,
  alignment: 'center',
  finish: 'satin',
  material: { ...DEFAULT_BRAND_MATERIAL },
  backing: { ...DEFAULT_BACKING },
};

/* ── Artwork ───────────────────────────────────────────────────────────── */

export const ARTWORK_MOUNTS = ['free', 'panel', 'floor', 'banner'] as const;
export type ArtworkMount = (typeof ARTWORK_MOUNTS)[number];

export interface ArtworkSceneObjectData {
  /** Where the image lives. Uploads and search results both end up here. */
  imageUrl: string;
  /** Kept for attribution when the image came from a search. */
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  license?: string | null;
  attribution?: string | null;

  widthMm: number;
  heightMm: number;
  /** Native pixel aspect, used to keep resizing honest. */
  aspectRatio: number;
  /** Lock height to width × aspect. */
  lockAspect: boolean;

  mount: ArtworkMount;
  /** Depth of the substrate the image is printed on. */
  thicknessMm: number;
  cornerRadiusMm: number;
  /** Show the image on both faces rather than only the front. */
  doubleSided: boolean;
  /** Cut the image out of its background where the source has alpha. */
  useAlpha: boolean;

  finish: BrandFinish;
  material: BrandMaterial;
  /**
   * Drive emission from the image itself, so a backlit print glows in its own
   * colours rather than a flat tint. This is the difference between a lightbox
   * and a panel with a lamp behind it.
   */
  emitFromImage: boolean;
}

export const DEFAULT_ARTWORK: ArtworkSceneObjectData = {
  imageUrl: '',
  widthMm: 1200,
  heightMm: 800,
  aspectRatio: 1.5,
  lockAspect: true,
  mount: 'panel',
  thicknessMm: 18,
  cornerRadiusMm: 0,
  doubleSided: false,
  useAlpha: true,
  finish: 'matte',
  material: { ...DEFAULT_BRAND_MATERIAL, color: '#ffffff', roughness: 0.85 },
  emitFromImage: false,
};

/* ── Helpers ───────────────────────────────────────────────────────────── */

/**
 * Whether the depth setting means "cut into the backing".
 *
 * Engraving needs something to engrave, so this also answers whether a backing
 * panel must be forced on.
 */
export function isEngraved(depthMm: number): boolean {
  return depthMm < 0;
}

/** Font file served from the web app's public directory. */
export function fontUrl(font: BrandFontKey): string {
  return `/fonts/${font}.typeface.json`;
}

/**
 * Rough triangle cost of a text object.
 *
 * Bevel segments and curve segments multiply quickly, and a long headline at
 * high smoothness can outweigh every piece of furniture in the room. The panel
 * shows this so the cost is visible before the viewport slows down.
 */
export function estimateTextTriangles(data: Text3DSceneObjectData): number {
  const glyphs = data.content.replace(/\s/g, '').length;
  if (!glyphs) return 0;
  const perGlyph = data.curveSegments * 8 + (data.bevelEnabled ? data.bevelSegments * 24 : 0) + 24;
  const backing = data.backing.enabled ? 12 : 0;
  return glyphs * perGlyph + backing;
}

/** Licences we are willing to place in a client-facing design. */
export const COMMERCIAL_LICENSES = ['cc0', 'pdm', 'by', 'by-sa'] as const;

export function licenseAllowsCommercial(license: string | null | undefined): boolean {
  if (!license) return false;
  return (COMMERCIAL_LICENSES as readonly string[]).includes(license.toLowerCase());
}
