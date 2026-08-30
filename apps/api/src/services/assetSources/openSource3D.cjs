const TIMEOUT_MS = 30000;
const DEFAULT_HEADERS = { Accept: 'application/json', 'User-Agent': 'Novira/1.0 asset-registry' };

const safeFetchJson = async (url, options = {}, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            ...options,
            headers: { ...DEFAULT_HEADERS, ...options.headers },
            signal: controller.signal
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        console.warn(`[OpenSource3D] Fetch failed: ${err.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

const BASE = 'https://raw.githubusercontent.com/ToxSam/open-source-3d-assets/main/data';

let _allAssets = null;
let _cacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000;

async function getAllAssets() {
    const now = Date.now();
    if (_allAssets && now - _cacheTime < CACHE_TTL) return _allAssets;

    console.log('[OpenSource3D] Fetching project index...');
    const projects = await safeFetchJson(`${BASE}/projects.json`);
    if (!Array.isArray(projects) || !projects.length) {
        console.warn('[OpenSource3D] No projects found');
        return [];
    }

    console.log(`[OpenSource3D] Found ${projects.length} projects, resolving asset files...`);

    const assetResults = await Promise.allSettled(
        projects.map(async (proj) => {
            if (!proj.asset_data_file) return [];
            const assets = await safeFetchJson(`${BASE}/${proj.asset_data_file}`, {}, 15000);
            if (!Array.isArray(assets)) return [];
            return assets.map(a => ({ ...a, _project: proj }));
        })
    );

    const all = [];
    for (const result of assetResults) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            all.push(...result.value);
        }
    }

    console.log(`[OpenSource3D] Resolved ${all.length} total assets with GLB URLs`);
    _allAssets = all;
    _cacheTime = now;
    return all;
}

async function search(category, query) {
    if (category !== 'models') return [];

    const assets = await getAllAssets();
    if (!assets.length) return [];

    const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);

    const scored = assets
        .filter(a => a.model_file_url)
        .map(a => {
            const tags = (a.metadata?.attributes || []).map(attr => attr.value || '').join(' ');
            const bag = `${a.name || ''} ${a.description || ''} ${tags} ${a._project?.name || ''} ${a._project?.description || ''}`.toLowerCase();
            const matchCount = words.length ? words.filter(w => bag.includes(w)).length : 1;
            return { a, matchCount };
        })
        .filter(i => i.matchCount > 0)
        .sort((a, b) => b.matchCount - a.matchCount);

    return scored.map(({ a }) => ({
        assetType: 'model',
        source: 'opensource3d',
        sourceLabel: 'Open Source 3D',
        sourceAssetId: a.id || a.name,
        name: a.name || 'Untitled',
        description: (a.description || '').slice(0, 300),
        thumbnailUrl: a.thumbnail_url || null,
        viewerUrl: a._project?.github_url || null,
        modelUrl: a.model_file_url,
        loadableInScene: true,
        format: 'glb',
        license: a._project?.license || 'CC0',
        categories: (a.metadata?.attributes || []).filter(attr => attr.trait_type === 'Category').map(attr => attr.value),
        tags: (a.metadata?.attributes || []).map(attr => attr.value).filter(Boolean),
        faceCount: null
    }));
}

module.exports = {
    categories: ['models'],
    search
};
