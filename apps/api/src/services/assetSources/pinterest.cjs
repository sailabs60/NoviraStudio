/**
 * Pinterest reference images.
 *
 * Pinterest has no public search API. What it does have is the JSON resource
 * its own web client calls, which serves public pins without a key. This
 * provider talks to that endpoint the way a browser does, with a page cap and a
 * hard timeout, and returns an empty array on any failure rather than throwing.
 *
 * The empty return matters: the registry watches for it and, when Pinterest
 * yields nothing, synthesises a Pinterest-labelled shelf from the other image
 * providers so the mood-board section is never blank. So the correct behaviour
 * on a bot-wall, a rate limit or a shape change is to fail quietly and let that
 * fallback run — never to fail the whole search.
 *
 * Only public pin metadata and the CDN image URL are read. Nothing is
 * downloaded or re-hosted; a pin links back to its own page, which is the
 * attribution Pinterest asks for.
 */

const TIMEOUT_MS = Math.max(3000, parseInt(process.env.PINTEREST_TIMEOUT_MS, 10) || 14000);
const PAGE_SIZE = 25;
const MAX_PAGES = Math.max(1, parseInt(process.env.PINTEREST_MAX_PAGES, 10) || 6);

const BASE = 'https://www.pinterest.com/resource/BaseSearchResource/get/';

const HEADERS = {
  Accept: 'application/json, text/javascript, */*, q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
  'X-Pinterest-AppState': 'active',
  'X-APP-VERSION': 'ff4e6de',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Referer: 'https://www.pinterest.com/',
};

function buildUrl(query, bookmark) {
  const options = {
    query: String(query || '').slice(0, 180),
    scope: 'pins',
    rs: 'typed',
    page_size: PAGE_SIZE,
    ...(bookmark ? { bookmarks: [bookmark] } : {}),
  };
  const params = new URLSearchParams({
    source_url: `/search/pins/?q=${encodeURIComponent(query)}`,
    data: JSON.stringify({ options, context: {} }),
  });
  return `${BASE}?${params.toString()}`;
}

async function fetchPage(query, bookmark) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(buildUrl(query, bookmark), { headers: HEADERS, signal: controller.signal });
    if (!res.ok) {
      console.warn(`[Pinterest] HTTP ${res.status}`);
      return null;
    }
    const body = await res.json();
    const results = body?.resource_response?.data?.results;
    if (!Array.isArray(results)) return null;
    return { results, bookmark: body?.resource_response?.bookmark ?? null };
  } catch (err) {
    if (err.name !== 'AbortError') console.warn(`[Pinterest] Fetch failed: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pinterest returns a map of rendered sizes. The largest one is the useful one
 * for a reference board; `orig` is present on most pins and is what the pin
 * page itself shows.
 */
function pickImages(pin) {
  const images = pin?.images || {};
  const orig = images.orig || images['1200x'] || images['736x'] || images['564x'];
  const thumb = images['236x'] || images['474x'] || images['564x'] || orig;
  return {
    imageUrl: orig?.url || null,
    thumbnailUrl: thumb?.url || orig?.url || null,
    width: orig?.width ?? null,
    height: orig?.height ?? null,
  };
}

function normalise(pin) {
  const { imageUrl, thumbnailUrl, width, height } = pickImages(pin);
  if (!imageUrl && !thumbnailUrl) return null;

  const title =
    (pin?.grid_title || pin?.title || pin?.description || '').toString().trim() || 'Pinterest reference';

  return {
    assetType: 'image',
    source: 'pinterest',
    sourceLabel: 'Pinterest',
    sourceAssetId: String(pin?.id ?? ''),
    name: title.slice(0, 140),
    description: String(pin?.description || '').slice(0, 400),
    thumbnailUrl,
    imageUrl: imageUrl || thumbnailUrl,
    imageWidth: width,
    imageHeight: height,
    viewerUrl: pin?.id ? `https://www.pinterest.com/pin/${pin.id}/` : null,
    /*
     * A pin is a reference, never scene geometry. Marking it unloadable keeps
     * it out of the "drop into the viewport" paths and into the mood board,
     * which is the only place it belongs.
     */
    loadableInScene: false,
    license: 'External reference — link back to the pin',
    attribution: pin?.pinner?.full_name ? `Pinned by ${pin.pinner.full_name}` : null,
    categories: [],
    tags: String(title)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)
      .slice(0, 12),
  };
}

async function search(category, query) {
  if (category !== 'images') return [];

  const out = [];
  const seen = new Set();
  let bookmark = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(query, bookmark);
    if (!result || !result.results.length) break;

    for (const pin of result.results) {
      const row = normalise(pin);
      if (!row || !row.sourceAssetId || seen.has(row.sourceAssetId)) continue;
      seen.add(row.sourceAssetId);
      out.push(row);
    }

    bookmark = result.bookmark;
    // `-end-` is Pinterest's own end-of-feed sentinel.
    if (!bookmark || bookmark === '-end-') break;
  }

  console.log(`[Pinterest] "${query}" → ${out.length} pins`);
  return out;
}

module.exports = {
  categories: ['images'],
  search,
};
