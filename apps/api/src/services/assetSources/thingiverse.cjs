const TIMEOUT_MS = 20000;
const UA = { Accept: 'application/json', 'User-Agent': 'Novira/1.0 asset-registry' };

const safeFetchJson = async (url, headers, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal, headers: { ...UA, ...headers } });
        if (!res.ok) {
            console.warn(`[Thingiverse] HTTP ${res.status}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') console.warn(`[Thingiverse] ${err.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

function normalize(thing) {
    const id = thing?.id;
    const img = thing?.default_image;
    const thumb = typeof img === 'string' ? img : (img?.url || img?.sizes?.[4]?.url || thing?.thumbnail || null);
    return {
        assetType: 'model',
        source: 'thingiverse',
        sourceLabel: 'Thingiverse',
        sourceAssetId: String(id),
        name: thing?.name || 'Untitled',
        description: (thing?.description || '').slice(0, 280),
        thumbnailUrl: thumb,
        viewerUrl: thing?.public_url || (id ? `https://www.thingiverse.com/thing:${id}` : null),
        modelUrl: null,
        loadableInScene: false,
        format: 'stl',
        license: thing?.license || 'CC (varies)',
        categories: [],
        tags: (thing?.tags || []).map(t => (typeof t === 'string' ? t : t?.name)).filter(Boolean),
        faceCount: null
    };
}

/**
 * MakerBot Thingiverse API — OAuth / personal token.
 * Create an app: https://www.thingiverse.com/developers
 * Set THINGIVERSE_ACCESS_TOKEN in .env (user access token after OAuth or dev token).
 */
async function search(category, query) {
    if (category !== 'models') return [];

    const token = process.env.THINGIVERSE_ACCESS_TOKEN;
    if (!token) {
        return [];
    }

    const q = encodeURIComponent(String(query || '').trim() || '3d');
    const tok = encodeURIComponent(token);
    const url = `https://api.thingiverse.com/search/things?q=${q}&page=1&per_page=30&access_token=${tok}`;
    const payload = await safeFetchJson(url, {});
    const hits = Array.isArray(payload) ? payload : (payload?.hits || payload?.results);
    if (!Array.isArray(hits)) {
        console.log('[Thingiverse] No results or invalid response');
        return [];
    }
    console.log(`[Thingiverse] → ${hits.length} things`);
    return hits.map(normalize).filter(i => i.sourceAssetId);
}

module.exports = {
    categories: ['models'],
    search
};
