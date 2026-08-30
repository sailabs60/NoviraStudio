const TIMEOUT_MS = 20000;
const UA = { Accept: 'application/json', 'User-Agent': 'Novira/1.0 asset-registry' };

const safeFetchJson = async (url, headers, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal, headers: { ...UA, ...headers } });
        if (!res.ok) {
            console.warn(`[MyMiniFactory] HTTP ${res.status}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') console.warn(`[MyMiniFactory] ${err.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

function normalize(item) {
    const id = item?.id;
    return {
        assetType: 'model',
        source: 'myminifactory',
        sourceLabel: 'MyMiniFactory',
        sourceAssetId: String(id),
        name: item?.name || item?.filename || 'Untitled',
        description: (item?.description || '').slice(0, 280),
        thumbnailUrl: item?.images?.[0]?.url || item?.thumbnail_url || item?.previewImage || null,
        viewerUrl: item?.url || (id ? `https://www.myminifactory.com/object/${id}` : null),
        modelUrl: item?.download_url || null,
        // Scene editor uses GLTFLoader only; STL/OBJ/3MF are preview/download via site, not in-scene.
        loadableInScene: Boolean(item?.download_url && /\.(glb|gltf)$/i.test(String(item.download_url))),
        format: item?.download_url
            ? (String(item.download_url).match(/\.(stl|3mf|obj|glb|gltf)$/i)?.[1] || 'stl').toLowerCase()
            : 'stl',
        license: item?.license || 'Varies',
        categories: [],
        tags: [],
        faceCount: null
    };
}

/**
 * MyMiniFactory API v2 — requires API key from your account / developer settings.
 * https://www.myminifactory.com/api/v2
 * Set MYMINIFACTORY_API_KEY in .env
 */
async function search(category, query) {
    if (category !== 'models') return [];

    const key = process.env.MYMINIFACTORY_API_KEY;
    if (!key) return [];

    const q = encodeURIComponent(String(query || '').trim() || 'figure');
    const url = `https://www.myminifactory.com/api/v2/search?q=${q}&page=1&per_page=24`;
    const payload = await safeFetchJson(url, { Authorization: `Bearer ${key}` });
    const items = payload?.items || payload?.objects || payload?.hits;
    if (!Array.isArray(items)) {
        console.log('[MyMiniFactory] No items array in response');
        return [];
    }
    console.log(`[MyMiniFactory] → ${items.length} objects`);
    return items.map(normalize).filter(i => i.sourceAssetId);
}

module.exports = {
    categories: ['models'],
    search
};
