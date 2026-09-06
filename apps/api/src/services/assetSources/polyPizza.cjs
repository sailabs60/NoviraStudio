const TIMEOUT_MS = 120000;
/** Public site search returns at most this many rows per request (Limit is ignored above this). */
const PUBLIC_PAGE_CAP = 32;
/** Official API v1.1 max rows per page (see https://poly.pizza/docs/api/v1.1). */
const V11_PAGE_SIZE = 32;
const V11_BASE = 'https://api.poly.pizza/v1.1';

function getAuthToken() {
    return process.env.POLYPIZZA_AUTH_TOKEN || process.env.POLYPIZZA_API_KEY || '';
}

function polyPizzaHeaders() {
    const h = {
        Accept: 'application/json',
        'User-Agent': process.env.POLYPIZZA_USER_AGENT || 'Novira/1.0 (+https://poly.pizza) asset-catalog',
    };
    const token = getAuthToken();
    if (token) h['x-auth-token'] = token;
    return h;
}

const safeFetchJson = async (url, options = {}, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            ...options,
            headers: { ...polyPizzaHeaders(), ...options.headers },
            signal: controller.signal
        });
        if (!res.ok) {
            console.warn(`[PolyPizza] HTTP ${res.status} from ${url}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') console.warn(`[PolyPizza] Fetch failed: ${err.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

/**
 * The GLB that belongs to a public search row.
 *
 * Poly Pizza's public search does not publish a download URL, and its official
 * API wants a key — but every model is served from the same CDN under the same
 * uuid as its preview image, only with a `.glb` extension instead of `.webp`.
 * Deriving it turns the whole Poly Pizza shelf from browse-only into something
 * that actually drops into the scene, with no key and no account.
 *
 * Everything here is CC0 or CC-BY, so re-serving the bytes is within licence;
 * the row keeps its `licence` field either way so attribution survives.
 */
function publicGlbFromPreview(previewUrl) {
    const raw = String(previewUrl || '').trim();
    if (!raw) return null;
    const m = raw.match(/^https:\/\/static\.poly\.pizza\/([0-9a-f-]{36})\.(?:webp|png|jpg|jpeg)$/i);
    return m ? `https://static.poly.pizza/${m[1]}.glb` : null;
}

/** Legacy public JSON shape from https://poly.pizza/api/search/… */
function normalizePublic(item) {
    const derived = publicGlbFromPreview(item.previewUrl);
    return {
        assetType: 'model',
        source: 'polypizza',
        sourceLabel: 'Poly Pizza',
        sourceAssetId: item.publicID || String(item.id),
        name: item.title || item.alt || 'Untitled',
        description: `By ${item.creator?.username || 'Unknown'}`,
        thumbnailUrl: item.previewUrl || null,
        viewerUrl: item.publicID ? `https://poly.pizza/m/${item.publicID}` : null,
        modelUrl: derived,
        loadableInScene: Boolean(derived),
        applicableInEditor: Boolean(derived),
        format: 'glb',
        license: item.licence || 'CC0',
        categories: [],
        tags: (item.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 2),
        faceCount: null
    };
}

/** Official API v1.1 row — includes direct GLB `Download` when licensed. */
function normalizeV11(item) {
    const id = item?.ID;
    const creator = item?.Creator?.Username || 'Unknown';
    const download = item?.Download || null;
    return {
        assetType: 'model',
        source: 'polypizza',
        sourceLabel: 'Poly Pizza',
        sourceAssetId: id || String(item?.id || ''),
        name: item?.Title || 'Untitled',
        description: item?.Attribution || `By ${creator}`,
        thumbnailUrl: item?.Thumbnail || null,
        viewerUrl: id ? `https://poly.pizza/m/${id}` : null,
        modelUrl: download,
        loadableInScene: Boolean(download),
        format: download ? 'glb' : 'gltf',
        license: item?.Licence || 'CC0',
        categories: item?.Category ? [item.Category] : [],
        tags: Array.isArray(item?.Tags) ? item.Tags : [],
        faceCount: item?.['Tri Count'] ?? null
    };
}

/** Long “recommended” queries must not fan out into dozens of HTTP calls (whole source hits the registry timeout). */
const MAX_POLYPIZZA_TERMS = 5;

function buildSearchTerms(query) {
    const qTrim = query.trim();
    if (!qTrim) return [];
    const words = qTrim.split(/\s+/).filter(w => w.length >= 2);
    if (!words.length) return [qTrim];

    if (qTrim.length <= 72) return [qTrim];

    const out = [];
    const seen = new Set();
    for (const w of words) {
        if (out.length >= MAX_POLYPIZZA_TERMS) break;
        if (seen.has(w)) continue;
        seen.add(w);
        out.push(w);
    }
    if (!out.length) out.push(qTrim.slice(0, 64));
    return out;
}

/** Public search: no pagination (Skip is ignored); at most PUBLIC_PAGE_CAP rows. */
async function fetchPublicSinglePage(q) {
    const qs = new URLSearchParams({ Limit: String(PUBLIC_PAGE_CAP) });
    const url = `https://poly.pizza/api/search/${encodeURIComponent(q)}?${qs}`;
    const payload = await safeFetchJson(url);
    const list = payload?.results;
    if (!Array.isArray(list)) {
        console.warn(`[PolyPizza] Public: no results array for "${q}"`);
        return [];
    }
    console.log(`[PolyPizza] Public term "${q}" → ${list.length} (site cap ~${PUBLIC_PAGE_CAP}, count=${payload?.count ?? '?'})`);
    return list;
}

function v11SearchUrl(q, page) {
    const qs = new URLSearchParams({ limit: String(V11_PAGE_SIZE), page: String(page) });
    return `${V11_BASE}/search/${encodeURIComponent(q)}?${qs}`;
}

/** Authenticated v1.1: fetch page 1, then remaining pages in parallel batches (faster for large totals). */
async function fetchV11AllPagesForTerm(q) {
    const maxPages = Math.max(1, parseInt(process.env.POLYPIZZA_MAX_V11_PAGES, 10) || 5000);
    const batchSize = Math.max(1, parseInt(process.env.POLYPIZZA_V11_PAGE_CONCURRENCY, 10) || 6);

    const firstPayload = await safeFetchJson(v11SearchUrl(q, 1));
    const firstList = Array.isArray(firstPayload?.results) ? firstPayload.results : [];
    if (!firstList.length) {
        console.log(`[PolyPizza] v1.1 term "${q}" → 0 models`);
        return [];
    }

    const byPage = new Map([[1, firstList]]);
    const totalKnown = typeof firstPayload.total === 'number';
    let total = totalKnown ? firstPayload.total : firstList.length;

    if (firstList.length < V11_PAGE_SIZE) {
        console.log(`[PolyPizza] v1.1 term "${q}" → ${firstList.length} models (API total=${totalKnown ? total : '?'})`);
        return firstList;
    }

    if (!totalKnown) {
        const out = [...firstList];
        let page = 2;
        while (page <= maxPages) {
            const payload = await safeFetchJson(v11SearchUrl(q, page));
            const list = Array.isArray(payload?.results) ? payload.results : [];
            if (!list.length) break;
            out.push(...list);
            if (list.length < V11_PAGE_SIZE) break;
            page += 1;
        }
        if (page > maxPages && out.length % V11_PAGE_SIZE === 0) {
            console.warn(`[PolyPizza] v1.1 term "${q}" sequential stop at POLYPIZZA_MAX_V11_PAGES=${maxPages}`);
        }
        console.log(`[PolyPizza] v1.1 term "${q}" → ${out.length} models (no total field — sequential pages)`);
        return out;
    }

    const totalPages = Math.min(Math.ceil(total / V11_PAGE_SIZE), maxPages);
    if (totalPages <= 1) {
        console.log(`[PolyPizza] v1.1 term "${q}" → ${firstList.length} models (API total=${total})`);
        return firstList;
    }

    const pageNums = [];
    for (let p = 2; p <= totalPages; p++) pageNums.push(p);

    for (let i = 0; i < pageNums.length; i += batchSize) {
        const chunk = pageNums.slice(i, i + batchSize);
        const settled = await Promise.allSettled(
            chunk.map(async (page) => {
                const payload = await safeFetchJson(v11SearchUrl(q, page));
                const list = Array.isArray(payload?.results) ? payload.results : [];
                return { page, list };
            })
        );
        for (const s of settled) {
            if (s.status === 'fulfilled' && s.value.list.length) {
                byPage.set(s.value.page, s.value.list);
            } else if (s.status === 'rejected') {
                console.warn(`[PolyPizza] v1.1 term "${q}" page failed: ${s.reason?.message}`);
            }
        }
    }

    const ordered = [];
    for (let p = 1; p <= totalPages; p++) {
        const rows = byPage.get(p);
        if (rows?.length) ordered.push(...rows);
    }

    if (ordered.length < total && totalPages >= maxPages) {
        console.warn(`[PolyPizza] v1.1 term "${q}" stopped at POLYPIZZA_MAX_V11_PAGES=${maxPages} (${ordered.length}/${total})`);
    }
    console.log(`[PolyPizza] v1.1 term "${q}" → ${ordered.length} models (API total=${total}, pages=${totalPages}, concurrency=${batchSize})`);
    return ordered;
}

async function search(category, query) {
    if (category !== 'models') return [];

    const uniqueTerms = buildSearchTerms(query);
    if (!uniqueTerms.length) return [];

    const tokenPresent = Boolean(getAuthToken());

    async function collectRaw(useAuthPath) {
        const fetchTerm = useAuthPath ? fetchV11AllPagesForTerm : fetchPublicSinglePage;
        const allItems = new Map();
        const results = await Promise.allSettled(uniqueTerms.map(q => fetchTerm(q)));
        for (const result of results) {
            if (result.status === 'fulfilled') {
                for (const item of result.value) {
                    const key = useAuthPath ? item.ID : (item.publicID || String(item.id));
                    if (key && !allItems.has(key)) allItems.set(key, item);
                }
            } else {
                console.warn(`[PolyPizza] Term failed: ${result.reason?.message}`);
            }
        }
        return [...allItems.values()];
    }

    let useV11 = tokenPresent;
    let raw = await collectRaw(useV11);
    let normalize = useV11 ? normalizeV11 : normalizePublic;

    // Invalid/expired token yields HTTP 401 and zero rows — fall back to public search instead of an empty catalog.
    if (useV11 && raw.length === 0) {
        console.warn('[PolyPizza] v1.1 returned no models with a token set (often HTTP 401). Retrying public poly.pizza search; fix or remove POLYPIZZA_AUTH_TOKEN / POLYPIZZA_API_KEY in .env if downloads should use v1.1.');
        raw = await collectRaw(false);
        normalize = normalizePublic;
        useV11 = false;
    }

    console.log(`[PolyPizza] ${useV11 ? 'API v1.1' : 'public'} — ${uniqueTerms.length} terms → ${raw.length} unique models`);
    return raw.map(normalize);
}

module.exports = {
    categories: ['models'],
    search
};
