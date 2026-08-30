const TIMEOUT_MS = 20000;
const DEFAULT_HEADERS = { Accept: 'application/json', 'User-Agent': 'Novira/1.0 asset-registry' };

const safeFetchJson = async (url, options = {}, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal, headers: { ...DEFAULT_HEADERS, ...options.headers } });
        if (!res.ok) {
            console.warn(`[Europeana] HTTP ${res.status}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') console.warn(`[Europeana] ${err.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

function shortLicense(rights) {
    const r = Array.isArray(rights) ? rights[0] : rights;
    if (!r) return 'Varies';
    if (r.includes('zero/1.0')) return 'CC0';
    if (r.includes('by-nc-nd')) return 'CC BY-NC-ND';
    if (r.includes('by/')) return 'CC BY';
    return 'Open / varies';
}

function normalize(raw) {
    const title = Array.isArray(raw.title) ? raw.title[0]
        : (raw.dcTitleLangAware?.en?.[0] || raw.dcTitleLangAware?.def?.[0] || 'Untitled');
    const rawId = raw.id || raw.guid || '';
    const id = String(rawId).replace(/^https?:\/\/[^/]+/i, '');
    const thumb = Array.isArray(raw.edmPreview) ? raw.edmPreview[0] : null;
    const view = Array.isArray(raw.edmIsShownAt) ? raw.edmIsShownAt[0] : (raw.guid || null);
    const embed = Array.isArray(raw.edmIsShownBy) ? raw.edmIsShownBy[0] : null;
    const sketchfabEmbed = typeof embed === 'string' && embed.includes('sketchfab.com') && embed.includes('/embed')
        ? embed
        : null;

    return {
        assetType: 'model',
        source: 'europeana',
        sourceLabel: 'Europeana (3D)',
        sourceAssetId: (id ? id.replace(/\//g, '_').replace(/^_+/, '') : '') || `europeana-${String(title).slice(0, 60).replace(/\W+/g, '-')}`,
        name: title,
        description: (Array.isArray(raw.dcDescription) ? raw.dcDescription[0] : (raw.dcDescriptionLangAware?.en?.[0] || '')).slice(0, 280),
        thumbnailUrl: thumb,
        viewerUrl: view,
        viewerEmbedUrl: sketchfabEmbed,
        modelUrl: null,
        loadableInScene: false,
        format: null,
        license: shortLicense(raw.rights),
        categories: [],
        tags: [],
        faceCount: null
    };
}

/**
 * Europeana Record API — 3D objects. Register a key: https://pro.europeana.eu/page/get-api
 * Falls back to public `apidemo` key (rate-limited); set EUROPEANA_API_KEY in production.
 */
async function search(category, query) {
    if (category !== 'models') return [];

    const wskey = process.env.EUROPEANA_API_KEY || 'apidemo';
    const q = String(query || '').trim() || '*';
    const params = new URLSearchParams({
        wskey,
        query: q,
        qf: 'TYPE:3D',
        rows: '36',
        profile: 'rich'
    });
    const payload = await safeFetchJson(`https://api.europeana.eu/record/v2/search.json?${params}`);
    const items = payload?.items;
    if (!Array.isArray(items) || !items.length) {
        console.log('[Europeana] No 3D results');
        return [];
    }
    console.log(`[Europeana] 3D → ${items.length} items`);
    return items.map(normalize).filter(i => i.name && i.sourceAssetId);
}

module.exports = {
    categories: ['models'],
    search
};
