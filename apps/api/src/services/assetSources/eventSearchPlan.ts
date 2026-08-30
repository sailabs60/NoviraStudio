/**
 * What to search a general-purpose 3D library for.
 *
 * Poly Haven can simply be enumerated — it is small enough to classify the
 * whole library. Search-based sources cannot: they need to be asked for
 * something specific, so the catalogue is only as good as the questions.
 *
 * The order here is deliberate and is the pipeline's priority order. It runs
 * from the items every event needs anywhere in the world — seating, tables,
 * staging, bars, linen, lighting — outwards to the specialised and decorative.
 * A planner in any market can lay out a room from the first two tiers alone;
 * regional or ornamental pieces are worth having but never at the cost of
 * leaving a universal category empty.
 *
 * Terms are phrased the way uploaders title things, not the way our own
 * taxonomy names them. Nothing here decides what an asset *is* — that stays
 * with `assetClassifier` and `assetVerification`, which measure the downloaded
 * geometry. These are only the questions asked.
 */

export interface SearchTerm {
  /** Query sent to the source. */
  query: string;
  /** Category this is expected to land in; used for reporting, not for truth. */
  expect: string;
  /** Lower runs first. */
  tier: 1 | 2 | 3;
}

export const EVENT_SEARCH_PLAN: SearchTerm[] = [
  /* ── Tier 1: no event happens without these ────────────────────────── */
  { query: 'banquet chair', expect: 'chairs', tier: 1 },
  { query: 'chiavari chair', expect: 'chairs', tier: 1 },
  { query: 'folding chair', expect: 'chairs', tier: 1 },
  { query: 'stacking chair', expect: 'chairs', tier: 1 },
  { query: 'dining chair', expect: 'chairs', tier: 1 },
  { query: 'bar stool', expect: 'chairs', tier: 1 },

  { query: 'banquet table', expect: 'tables', tier: 1 },
  { query: 'round dining table', expect: 'tables', tier: 1 },
  { query: 'trestle table', expect: 'tables', tier: 1 },
  { query: 'cocktail table', expect: 'tables', tier: 1 },
  { query: 'conference table', expect: 'tables', tier: 1 },

  { query: 'bar counter', expect: 'bars-catering', tier: 1 },
  { query: 'cocktail bar', expect: 'bars-catering', tier: 1 },
  { query: 'buffet counter', expect: 'bars-catering', tier: 1 },
  { query: 'chafing dish', expect: 'bars-catering', tier: 1 },
  { query: 'beverage dispenser', expect: 'bars-catering', tier: 1 },

  { query: 'stage platform', expect: 'staging', tier: 1 },
  { query: 'lectern podium', expect: 'staging', tier: 1 },
  { query: 'stage riser', expect: 'staging', tier: 1 },
  { query: 'truss', expect: 'staging', tier: 1 },

  { query: 'marquee tent', expect: 'tents', tier: 1 },
  { query: 'event tent', expect: 'tents', tier: 1 },
  { query: 'canopy tent', expect: 'tents', tier: 1 },
  { query: 'gazebo', expect: 'tents', tier: 1 },

  /* ── Tier 2: needed to dress and run the room ──────────────────────── */
  { query: 'tablecloth', expect: 'linens', tier: 2 },
  { query: 'table runner', expect: 'linens', tier: 2 },
  { query: 'napkin', expect: 'linens', tier: 2 },

  { query: 'curtain drape', expect: 'draping', tier: 2 },
  { query: 'stage backdrop', expect: 'draping', tier: 2 },

  { query: 'chandelier', expect: 'lighting', tier: 2 },
  { query: 'pendant light', expect: 'lighting', tier: 2 },
  { query: 'floor lamp', expect: 'lighting', tier: 2 },
  { query: 'string lights', expect: 'lighting', tier: 2 },
  { query: 'uplighter', expect: 'lighting', tier: 2 },

  { query: 'loudspeaker', expect: 'av-production', tier: 2 },
  { query: 'projector screen', expect: 'av-production', tier: 2 },
  { query: 'microphone stand', expect: 'av-production', tier: 2 },
  { query: 'stage light', expect: 'av-production', tier: 2 },
  { query: 'dj booth', expect: 'av-production', tier: 2 },

  { query: 'dinner plate', expect: 'tableware', tier: 2 },
  { query: 'wine glass', expect: 'tableware', tier: 2 },
  { query: 'champagne flute', expect: 'tableware', tier: 2 },
  { query: 'cutlery set', expect: 'tableware', tier: 2 },
  { query: 'water goblet', expect: 'tableware', tier: 2 },

  { query: 'sofa', expect: 'lounge', tier: 2 },
  { query: 'armchair', expect: 'lounge', tier: 2 },
  { query: 'ottoman', expect: 'lounge', tier: 2 },
  { query: 'coffee table', expect: 'lounge', tier: 2 },

  { query: 'dance floor', expect: 'dance-floors', tier: 2 },

  /* ── Tier 3: dressing, signage and outdoor ─────────────────────────── */
  { query: 'welcome sign', expect: 'signage', tier: 3 },
  { query: 'sign stand', expect: 'signage', tier: 3 },
  { query: 'easel', expect: 'signage', tier: 3 },
  { query: 'banner stand', expect: 'signage', tier: 3 },

  { query: 'patio umbrella', expect: 'outdoor', tier: 3 },
  { query: 'patio heater', expect: 'outdoor', tier: 3 },
  { query: 'garden bench', expect: 'outdoor', tier: 3 },
  { query: 'fire pit', expect: 'outdoor', tier: 3 },

  { query: 'potted plant', expect: 'plants', tier: 3 },
  { query: 'flower vase', expect: 'plants', tier: 3 },
  { query: 'palm tree plant', expect: 'plants', tier: 3 },
  { query: 'topiary', expect: 'plants', tier: 3 },

  { query: 'candle holder', expect: 'decor', tier: 3 },
  { query: 'lantern', expect: 'decor', tier: 3 },
  { query: 'floral centerpiece', expect: 'centerpieces', tier: 3 },
  { query: 'candelabra', expect: 'centerpieces', tier: 3 },
];

/** The plan, in run order. */
export function searchPlan(maxTier = 3): SearchTerm[] {
  return EVENT_SEARCH_PLAN.filter((t) => t.tier <= maxTier).sort((a, b) => a.tier - b.tier);
}
