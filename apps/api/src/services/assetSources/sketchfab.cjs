const TIMEOUT_MS = 20000;
const SF_PAGE_SIZE = Math.min(Math.max(parseInt(process.env.SKETCHFAB_PAGE_SIZE, 10) || 100, 1), 100);
/** Stops runaway pagination if `next` repeats or Sketchfab misbehaves. Set `0` for no cap (not recommended). */
const maxPagesPerTerm = () => {
    const raw = process.env.SKETCHFAB_MAX_PAGES_PER_TERM;
    if (raw === '0' || raw === '') return Infinity;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 10000;
};

/**
 * When false (default), search includes all discoverable models.
 * When true, only downloadable models are returned by Sketchfab.
 */
const requireDownloadable = () => String(process.env.SKETCHFAB_REQUIRE_DOWNLOADABLE || '').toLowerCase() === 'true';

const safeFetchJson = async (url, options = {}, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) {
            console.warn(`[Sketchfab] HTTP ${res.status} from ${url}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') console.warn(`[Sketchfab] Fetch failed: ${err.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

const asArray = (v) => (!v ? [] : Array.isArray(v) ? v : [v]);

const normalize = (item) => {
    const tags = asArray(item?.tags).map(t => (typeof t === 'string' ? t : t?.name)).filter(Boolean);
    const categories = asArray(item?.categories).map(c => (typeof c === 'string' ? c : c?.name)).filter(Boolean);

    // Sketchfab search reports download eligibility; final download can still 403 per account.
    const sketchfabDownloadable = Boolean(item?.isDownloadable);
    return {
        assetType: 'model',
        source: 'sketchfab',
        sourceLabel: 'Sketchfab',
        sourceAssetId: item?.uid || null,
        name: item?.name || 'Untitled',
        description: (item?.description || '').slice(0, 300),
        thumbnailUrl: item?.thumbnails?.images?.[1]?.url || item?.thumbnails?.images?.[0]?.url || null,
        viewerUrl: item?.viewerUrl || null,
        modelUrl: null,
        downloadUrl: null,
        sketchfabDownloadable,
        loadableInScene: sketchfabDownloadable,
        format: item?.archives?.glb ? 'glb' : (item?.archives?.gltf ? 'gltf' : null),
        license: item?.license?.label || null,
        categories,
        tags,
        faceCount: item?.faceCount || null
    };
};

async function exhaustPagesForTerm(term, headers) {
    const items = [];
    const firstParams = new URLSearchParams({
        type: 'models',
        q: term,
        count: String(SF_PAGE_SIZE)
    });
    if (requireDownloadable()) {
        firstParams.set('downloadable', 'true');
    }
    let nextUrl = `https://api.sketchfab.com/v3/search?${firstParams}`;
    const seenUrls = new Set();
    const cap = maxPagesPerTerm();
    let pages = 0;

    while (nextUrl) {
        if (Number.isFinite(cap) && pages >= cap) {
            console.warn(`[Sketchfab] Term "${term}" stopped at SKETCHFAB_MAX_PAGES_PER_TERM=${cap} (${items.length} hits)`);
            break;
        }
        if (seenUrls.has(nextUrl)) {
            console.warn(`[Sketchfab] Term "${term}" pagination repeated URL — stopping`);
            break;
        }
        seenUrls.add(nextUrl);

        const payload = await safeFetchJson(nextUrl, { headers });
        const results = asArray(payload?.results);
        items.push(...results);
        pages += 1;
        nextUrl = payload?.next || null;
        if (results.length < SF_PAGE_SIZE) break;
    }

    return items;
}

async function search(category, query) {
    if (category !== 'models') return [];

    const headers = { Accept: 'application/json', 'User-Agent': 'Novira/1.0 asset-registry' };
    const token = process.env.SKETCHFAB_API_TOKEN;
    if (token) headers.Authorization = `Token ${token}`;

    const normalizedQuery = String(query || '').trim();
    const words = normalizedQuery.split(/\s+/).filter(w => w.length >= 2);
    if (!words.length && normalizedQuery) words.push(normalizedQuery);

    // Preserve the full phrase first (matches provider behavior better), then add word terms.
    const uniqueTerms = [...new Set([normalizedQuery, ...words].filter(Boolean))];
    const batches = await Promise.all(
        uniqueTerms.map(term => exhaustPagesForTerm(term, headers))
    );

    const seenUids = new Set();
    const all = [];
    for (const batch of batches) {
        for (const item of batch) {
            if (item?.uid && !seenUids.has(item.uid)) {
                seenUids.add(item.uid);
                all.push(item);
            }
        }
    }

    console.log(`[Sketchfab] Exhausted ${uniqueTerms.length} terms → ${all.length} unique models (downloadableOnly=${requireDownloadable()})`);
    return all.map(normalize).filter(i => i.sourceAssetId);
}

module.exports = {
    categories: ['models'],
    search
};
