/**
 * The online asset registry.
 *
 * Novira ships a curated catalogue of a few hundred measured models. That is
 * the *floor*, not the ceiling: eighteen public providers — Sketchfab,
 * BlenderKit, Poly Haven, ambientCG, Poly Pizza, Smithsonian, Khronos,
 * Europeana, NASA, Thingiverse, MyMiniFactory, Free3D, Openverse, Unsplash,
 * Pexels, Pixabay and Pinterest — are searched live and merged into one ranked
 * list, so what a designer can reach is measured in millions rather than
 * hundreds.
 *
 * The fan-out itself lives in `assetSources/index.cjs`, which is CommonJS and
 * deliberately left that way: each provider is a small, independent adapter
 * that gets rewritten whenever an upstream API changes, and keeping them as
 * plain modules means a broken provider is a fifty-line fix rather than a
 * compile error across the server. This file is the typed door to it.
 *
 * Two behaviours make it feel instant rather than merely capable:
 *
 *  · **One fan-out, many pages.** The first request for a query pays for the
 *    whole fan-out and caches the ranked list. Every later page is a slice of
 *    that array, so scrolling to result 400 costs nothing. This is what makes
 *    honest infinite scroll possible — the pages are consistent with each other
 *    because they come from one ordering, not from eighteen independently
 *    paginated APIs.
 *
 *  · **Warm before asked.** On boot, and on a slow repeating timer, the shelves
 *    the UI opens on are searched in the background. By the time someone opens
 *    the asset drawer the first screen is already in memory.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/* ── The shape every provider normalises to ────────────────────────────── */

export type AssetCategory = 'models' | 'materials' | 'hdris' | 'images';

export const ASSET_CATEGORIES: AssetCategory[] = ['models', 'materials', 'hdris', 'images'];

export interface ProviderAsset {
  assetType: 'model' | 'material' | 'hdri' | 'image';
  source: string;
  sourceLabel: string;
  sourceAssetId: string;
  name: string;
  description?: string;
  thumbnailUrl?: string | null;
  viewerUrl?: string | null;
  /** A glTF/GLB the viewport can load directly. Null when only browsable. */
  modelUrl?: string | null;
  /**
   * A provider endpoint that mints a real download URL when asked.
   *
   * Distinct from `modelUrl`, which is the file itself. Some libraries —
   * BlenderKit is the one that matters here — publish a stable per-file
   * endpoint that has to be exchanged for a short-lived signed CDN link.
   * Carrying it on the row means resolving is a single call at drop time
   * rather than a fresh search followed by a second call.
   */
  downloadApiUrl?: string | null;
  /** An equirectangular HDR/EXR for image-based lighting. */
  hdriUrl?: string | null;
  /** PBR maps, keyed by channel: colour, normal, roughness, metalness, ao… */
  materialMaps?: Record<string, string | null> | null;
  imageUrl?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  license?: string | null;
  attribution?: string | null;
  categories?: string[];
  tags?: string[];
  loadableInScene?: boolean;
  applicableInEditor?: boolean;
  accessTier?: 'free_download' | 'licensed' | 'requires_purchase' | 'external_only';
  accessLabel?: string;
  purchaseUrl?: string | null;
  triangleCount?: number | null;
  projectFitScore?: number;
  queryRelevanceScore?: number;
}

export interface PagedAssets {
  items: ProviderAsset[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  applicableOnly: boolean;
}

interface RegistryModule {
  RECOMMENDED_QUERIES: Record<AssetCategory, string>;
  getPagedSearch(
    category: string,
    query: string,
    offset: number,
    limit: number,
    options?: { applicableOnly?: boolean }
  ): Promise<PagedAssets>;
  searchByCategory(category: string, query: string): Promise<ProviderAsset[]>;
}

const registry = require('./assetSources/index.cjs') as RegistryModule;

export const RECOMMENDED_QUERIES = registry.RECOMMENDED_QUERIES;

/* ── Search ────────────────────────────────────────────────────────────── */

export interface AssetSearchOptions {
  category: AssetCategory;
  q?: string;
  offset?: number;
  limit?: number;
  /**
   * Whether to drop rows the editor cannot actually use.
   *
   * Materials and HDRIs default to `true` because a material with no maps is
   * useless in a viewport — showing it is a promise the tool cannot keep.
   * Models default to `false` because a Sketchfab model that has to be bought
   * is still worth *seeing*: the row says so plainly and links out.
   */
  applicableOnly?: boolean;
}

export async function searchAssets(opts: AssetSearchOptions): Promise<PagedAssets> {
  const category = ASSET_CATEGORIES.includes(opts.category) ? opts.category : 'models';
  const query = (opts.q ?? '').trim() || RECOMMENDED_QUERIES[category] || category;
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 48), 1), 120);

  return registry.getPagedSearch(category, query, offset, limit, {
    applicableOnly: opts.applicableOnly,
  });
}

/* ── Providers, described for the UI ───────────────────────────────────── */

export interface ProviderInfo {
  key: string;
  label: string;
  supplies: AssetCategory[];
  /** What this source is good for, in the words a designer would use. */
  note: string;
  /** Whether an API key is needed and present. */
  keyEnv: string | null;
  configured: boolean;
  homepage: string;
}

const PROVIDERS: Omit<ProviderInfo, 'configured'>[] = [
  {
    key: 'sketchfab',
    label: 'Sketchfab',
    supplies: ['models'],
    note: 'The largest library of published 3D work. Downloadable models come straight into the scene; the rest link out.',
    keyEnv: 'SKETCHFAB_API_TOKEN',
    homepage: 'https://sketchfab.com',
  },
  {
    key: 'blenderkit',
    label: 'BlenderKit',
    supplies: ['models', 'materials', 'hdris'],
    note: 'Production-grade furniture, props and PBR materials, built for interiors.',
    keyEnv: 'BLENDERKIT_API_KEY',
    homepage: 'https://www.blenderkit.com',
  },
  {
    key: 'polyhaven',
    label: 'Poly Haven',
    supplies: ['models', 'materials', 'hdris'],
    note: 'CC0 throughout. The best environment lighting available anywhere, free.',
    keyEnv: null,
    homepage: 'https://polyhaven.com',
  },
  {
    key: 'ambientcg',
    label: 'ambientCG',
    supplies: ['materials', 'hdris'],
    note: 'Thousands of scanned CC0 surfaces — concrete, timber, fabric, metal — with full PBR maps.',
    keyEnv: null,
    homepage: 'https://ambientcg.com',
  },
  {
    key: 'polypizza',
    label: 'Poly Pizza',
    supplies: ['models'],
    note: 'Low-poly props that stay fast in a big scene. Ideal for filling a hall.',
    keyEnv: null,
    homepage: 'https://poly.pizza',
  },
  {
    key: 'opensource3d',
    label: 'Open Source 3D',
    supplies: ['models'],
    note: 'Curated open glTF collections, all directly loadable.',
    keyEnv: null,
    homepage: 'https://github.com/KhronosGroup',
  },
  {
    key: 'khronos',
    label: 'Khronos samples',
    supplies: ['models'],
    note: 'The reference glTF models. Small, correct, and useful for testing materials.',
    keyEnv: null,
    homepage: 'https://github.com/KhronosGroup/glTF-Sample-Assets',
  },
  {
    key: 'smithsonian',
    label: 'Smithsonian',
    supplies: ['models'],
    note: 'Museum-scanned objects released to the public domain.',
    keyEnv: null,
    homepage: 'https://www.si.edu/openaccess',
  },
  {
    key: 'europeana',
    label: 'Europeana',
    supplies: ['models'],
    note: 'European cultural heritage scans — sculpture, artefacts, architectural detail.',
    keyEnv: 'EUROPEANA_API_KEY',
    homepage: 'https://www.europeana.eu',
  },
  {
    key: 'nasa3d',
    label: 'NASA 3D',
    supplies: ['models'],
    note: 'Public-domain spacecraft and hardware. Occasionally exactly what a launch event needs.',
    keyEnv: null,
    homepage: 'https://science.nasa.gov/3d-resources/',
  },
  {
    key: 'thingiverse',
    label: 'Thingiverse',
    supplies: ['models'],
    note: 'Fabrication-ready parts — brackets, fixings, jigs.',
    keyEnv: 'THINGIVERSE_TOKEN',
    homepage: 'https://www.thingiverse.com',
  },
  {
    key: 'myminifactory',
    label: 'MyMiniFactory',
    supplies: ['models'],
    note: 'Printable props and decorative pieces, checked for printability.',
    keyEnv: 'MYMINIFACTORY_KEY',
    homepage: 'https://www.myminifactory.com',
  },
  {
    key: 'free3d',
    label: 'Free3D',
    supplies: ['models'],
    note: 'A broad general library. Mixed licensing, always stated on the row.',
    keyEnv: null,
    homepage: 'https://free3d.com',
  },
  {
    key: 'openverse',
    label: 'Openverse',
    supplies: ['images'],
    note: 'Openly licensed imagery aggregated across the web.',
    keyEnv: null,
    homepage: 'https://openverse.org',
  },
  {
    key: 'unsplash',
    label: 'Unsplash',
    supplies: ['images'],
    note: 'High-resolution photography for boards, backdrops and deck covers.',
    keyEnv: 'UNSPLASH_ACCESS_KEY',
    homepage: 'https://unsplash.com',
  },
  {
    key: 'pexels',
    label: 'Pexels',
    supplies: ['images'],
    note: 'Free photography and video stills, strong on events and interiors.',
    keyEnv: 'PEXELS_API_KEY',
    homepage: 'https://www.pexels.com',
  },
  {
    key: 'pixabay',
    label: 'Pixabay',
    supplies: ['images'],
    note: 'Photography, illustration and vector art under one permissive licence.',
    keyEnv: 'PIXABAY_API_KEY',
    homepage: 'https://pixabay.com',
  },
  {
    key: 'pinterest',
    label: 'Pinterest',
    supplies: ['images'],
    note: 'Reference and mood only. Pins link back to their source and are never re-hosted.',
    keyEnv: null,
    homepage: 'https://www.pinterest.com',
  },
];

export function providerCatalogue(): ProviderInfo[] {
  return PROVIDERS.map((p) => ({
    ...p,
    // A provider with no key requirement is always on. One that needs a key is
    // reported honestly rather than failing silently at search time.
    configured: p.keyEnv ? Boolean((process.env[p.keyEnv] ?? '').trim()) : true,
  }));
}

/* ── Curated shelves ───────────────────────────────────────────────────── */

/**
 * The rows the asset drawer opens on.
 *
 * A search box facing an empty result set is the least useful interface in
 * software: it demands that the user already know what exists. Shelves invert
 * that — you browse first, and search when browsing stops being enough.
 *
 * Each shelf is an ordinary query, so a shelf and a search are the same code
 * path and there is no second ranking to keep in step.
 */
export interface Shelf {
  key: string;
  label: string;
  category: AssetCategory;
  query: string;
  note: string;
}

export const SHELVES: Shelf[] = [
  // Models — ordered the way a stand actually gets built.
  { key: 'seating', label: 'Seating', category: 'models', query: 'chair stool bench sofa armchair lounge seating', note: 'Chairs, benches, lounge and banquet seating.' },
  { key: 'tables', label: 'Tables', category: 'models', query: 'table desk round banquet cocktail counter bar table', note: 'Banquet, cocktail, meeting and bar tables.' },
  { key: 'stands', label: 'Exhibition stands', category: 'models', query: 'exhibition booth stand kiosk pop-up display counter', note: 'Shells, kiosks, counters and pop-ups.' },
  { key: 'staging', label: 'Staging & rigging', category: 'models', query: 'stage riser platform truss rigging podium lectern', note: 'Decks, risers, truss and podiums.' },
  { key: 'av', label: 'AV & screens', category: 'models', query: 'led screen monitor projector speaker line array av rack', note: 'Screens, speakers, racks and control.' },
  { key: 'lighting-models', label: 'Lighting', category: 'models', query: 'stage light moving head par can fresnel lamp chandelier pendant', note: 'Fixtures, lamps and decorative lighting.' },
  { key: 'greenery', label: 'Greenery & decor', category: 'models', query: 'plant tree planter greenery vase flowers decor rug', note: 'Planting, florals and soft decor.' },
  { key: 'people', label: 'People & scale', category: 'models', query: 'human person people figure crowd scale character', note: 'Scale figures — the fastest way to make a render read.' },
  { key: 'catering', label: 'Catering & bar', category: 'models', query: 'bar counter buffet catering glass bottle food drink tray', note: 'Bars, buffets, glassware and service.' },
  { key: 'vehicles', label: 'Vehicles', category: 'models', query: 'car van truck vehicle forklift trolley cart', note: 'For launches, and for checking load-in access.' },
  { key: 'signage', label: 'Signage & wayfinding', category: 'models', query: 'sign signage banner wayfinding totem directory board', note: 'Totems, banners and directional signage.' },
  { key: 'barriers', label: 'Barriers & crowd', category: 'models', query: 'barrier fence crowd control stanchion rope queue', note: 'Stanchions, barriers and queue management.' },

  // Materials.
  { key: 'floor', label: 'Flooring', category: 'materials', query: 'floor wood parquet plank vinyl carpet tile concrete floor', note: 'Timber, carpet, vinyl and stone floors.' },
  { key: 'fabric', label: 'Fabric & drape', category: 'materials', query: 'fabric cloth velvet canvas linen drape curtain upholstery', note: 'Drape, upholstery and soft surfaces.' },
  { key: 'metal', label: 'Metal', category: 'materials', query: 'metal steel brushed aluminium brass copper chrome', note: 'Brushed, polished, anodised and raw.' },
  { key: 'timber', label: 'Timber', category: 'materials', query: 'wood oak walnut pine plywood birch veneer timber', note: 'Sheet goods, veneers and solid timber.' },
  { key: 'concrete', label: 'Concrete & stone', category: 'materials', query: 'concrete stone marble granite terrazzo plaster stucco', note: 'Poured, polished, cast and clad.' },
  { key: 'glass', label: 'Glass & acrylic', category: 'materials', query: 'glass acrylic perspex frosted mirror transparent', note: 'Clear, frosted, tinted and mirrored.' },

  // Environment lighting.
  { key: 'hdri-studio', label: 'Studio', category: 'hdris', query: 'studio softbox white cyclorama product lighting', note: 'Clean, controlled light for a product shot.' },
  { key: 'hdri-interior', label: 'Interior', category: 'hdris', query: 'interior hall lobby atrium warehouse loft gallery', note: 'Halls, lobbies and industrial interiors.' },
  { key: 'hdri-day', label: 'Daylight', category: 'hdris', query: 'sunny overcast noon daylight sky field park', note: 'Open sky, from harsh sun to soft overcast.' },
  { key: 'hdri-evening', label: 'Evening', category: 'hdris', query: 'sunset dusk golden hour night city street evening', note: 'Golden hour and after dark.' },

  // Reference.
  { key: 'img-stages', label: 'Stage design', category: 'images', query: 'stage design concert keynote set design scenic', note: 'Built work to design against.' },
  { key: 'img-booths', label: 'Stand design', category: 'images', query: 'exhibition stand design trade show booth', note: 'Exhibition stands, photographed on the floor.' },
  { key: 'img-interiors', label: 'Interiors', category: 'images', query: 'event interior venue banquet gala ballroom styling', note: 'Rooms, dressed.' },
  { key: 'img-lighting', label: 'Lighting looks', category: 'images', query: 'stage lighting design concert lighting wash beam haze', note: 'Looks to brief a lighting designer with.' },
  { key: 'img-branding', label: 'Branding & graphics', category: 'images', query: 'event branding graphics signage backdrop logo wall', note: 'Applied graphics and brand walls.' },
];

export function shelvesFor(category: AssetCategory): Shelf[] {
  return SHELVES.filter((s) => s.category === category);
}

/* ── The background warmer ─────────────────────────────────────────────── */

/**
 * Warm the shelves nobody has asked for yet.
 *
 * The brief is explicit that a user should never sit watching a spinner while a
 * drawer fills. The only way to honour that is to have done the work already,
 * so the server searches the opening shelves on boot and keeps them warm
 * afterwards.
 *
 * It is deliberately slow and sequential. This is background work subsidising a
 * later click, and it must never compete with a request someone is actually
 * waiting on — so one shelf at a time, with a gap between, and every failure
 * swallowed.
 */
const WARM_DELAY_MS = Math.max(500, Number(process.env.ASSET_WARM_DELAY_MS ?? 2500));
const WARM_INTERVAL_MS = Math.max(60_000, Number(process.env.ASSET_WARM_INTERVAL_MS ?? 8 * 60_000));

/** The shelves worth paying for up front: the first thing each category shows. */
const WARM_KEYS = ['seating', 'tables', 'stands', 'staging', 'floor', 'fabric', 'hdri-studio', 'img-stages'];

let warming = false;

async function warmOnce(): Promise<void> {
  if (warming) return;
  warming = true;
  try {
    // The default view of every category, first — that is what opens.
    for (const category of ASSET_CATEGORIES) {
      try {
        await searchAssets({ category, offset: 0, limit: 1 });
      } catch {
        /* a provider being down must never stop the warmer */
      }
      await sleep(WARM_DELAY_MS);
    }
    for (const key of WARM_KEYS) {
      const shelf = SHELVES.find((s) => s.key === key);
      if (!shelf) continue;
      try {
        await searchAssets({ category: shelf.category, q: shelf.query, offset: 0, limit: 1 });
      } catch {
        /* as above */
      }
      await sleep(WARM_DELAY_MS);
    }
  } finally {
    warming = false;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

let warmTimer: NodeJS.Timeout | null = null;

export function startAssetWarmer(): void {
  if (warmTimer) return;
  if ((process.env.ASSET_WARM ?? 'on').toLowerCase() === 'off') return;

  // Not immediately — let the server finish coming up and serve any request
  // that is already queued before spending bandwidth on speculation.
  setTimeout(() => void warmOnce(), 8_000).unref?.();
  warmTimer = setInterval(() => void warmOnce(), WARM_INTERVAL_MS);
  warmTimer.unref?.();
}
