const TIMEOUT_MS = 20000;

const safeFetchJson = async (url, options = {}, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        console.warn(`[Khronos] Fetch failed: ${err.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

const INDEX_URL = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/model-index.json';
const CDN_BASE = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models';

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000;

async function getModels() {
    const now = Date.now();
    if (_cache && now - _cacheTime < CACHE_TTL) return _cache;

    console.log('[Khronos] Fetching glTF sample model index...');
    const data = await safeFetchJson(INDEX_URL);
    if (Array.isArray(data) && data.length > 0) {
        _cache = data;
        _cacheTime = now;
        console.log(`[Khronos] Cached ${data.length} sample models`);
    }
    return _cache || [];
}

async function search(category, query) {
    if (category !== 'models') return [];

    const models = await getModels();
    if (!models.length) return [];

    const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);

    const scored = models
        .map(m => {
            const bag = `${m.name || ''} ${m.label || ''} ${(m.tags || []).join(' ')}`.toLowerCase();
            const matchCount = words.length ? words.filter(w => bag.includes(w)).length : 1;
            return { m, matchCount };
        })
        .filter(i => i.matchCount > 0)
        .sort((a, b) => b.matchCount - a.matchCount);

    return scored.map(({ m }) => {
        const glbVariant = m.variants?.glTF_Binary || m.variants?.['glTF-Binary'];
        const gltfVariant = m.variants?.glTF;
        let modelUrl = null;
        let format = null;

        if (glbVariant) {
            modelUrl = `${CDN_BASE}/${m.name}/glTF-Binary/${glbVariant}`;
            format = 'glb';
        } else if (gltfVariant) {
            modelUrl = `${CDN_BASE}/${m.name}/glTF/${gltfVariant}`;
            format = 'gltf';
        }

        return {
            assetType: 'model',
            source: 'khronos',
            sourceLabel: 'Khronos Samples',
            sourceAssetId: m.name,
            name: m.label || m.name,
            description: `Official Khronos glTF sample model: ${m.label || m.name}`,
            thumbnailUrl: m.screenshot ? `${CDN_BASE}/${m.name}/${m.screenshot}` : null,
            viewerUrl: `https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/${m.name}`,
            modelUrl,
            loadableInScene: Boolean(modelUrl),
            format,
            license: 'Various CC',
            categories: [],
            tags: m.tags || [],
            faceCount: null
        };
    });
}

module.exports = {
    categories: ['models'],
    search
};
