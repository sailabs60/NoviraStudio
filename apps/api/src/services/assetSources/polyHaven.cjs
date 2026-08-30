const TIMEOUT_MS = 30000;
const FILE_RESOLVE_CONCURRENCY = Math.max(1, parseInt(process.env.POLYHAVEN_FILE_CONCURRENCY, 10) || 40);

const safeFetchJson = async (url, options = {}, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) {
            console.warn(`[PolyHaven] HTTP ${res.status} from ${url}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') console.warn(`[PolyHaven] Fetch failed for ${url}: ${err.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

const asArray = (v) => (!v ? [] : Array.isArray(v) ? v : [v]);
const UA = { 'User-Agent': process.env.POLYHAVEN_USER_AGENT || 'Novira/1.0 asset-browser' };

const _cache = {};
const CACHE_TTL = 30 * 60 * 1000;

async function getAssetList(type) {
    const now = Date.now();
    if (_cache[type] && now - _cache[type].ts < CACHE_TTL) return _cache[type].data;

    console.log(`[PolyHaven] Fetching full ${type} catalog...`);
    const data = await safeFetchJson(`https://api.polyhaven.com/assets?t=${type}`, { headers: UA });

    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
        _cache[type] = { data, ts: now };
        console.log(`[PolyHaven] Cached entire ${type} catalog: ${Object.keys(data).length} entries`);
    } else {
        console.warn(`[PolyHaven] Got empty/null response for ${type}`);
    }
    return data;
}

function textMatch(entries, query) {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);

    if (!words.length) {
        return entries.map(([id, meta]) => ({ id, meta, matchCount: 1 }));
    }

    return entries
        .map(([id, meta]) => {
            const bag = `${id.replace(/_/g, ' ')} ${meta?.name || ''} ${(meta?.tags || []).join(' ')} ${(meta?.categories || []).join(' ')}`.toLowerCase();
            const matchCount = words.filter(w => bag.includes(w)).length;
            return { id, meta, matchCount };
        })
        .filter(i => i.matchCount > 0)
        .sort((a, b) => b.matchCount - a.matchCount);
}

function extractGltfBundle(filesInfo) {
    if (!filesInfo?.gltf) return null;
    for (const res of ['1k', '2k', '4k']) {
        const entry = filesInfo.gltf?.[res]?.gltf;
        if (entry?.url) {
            const includes = {};
            if (entry.include) {
                for (const [relPath, info] of Object.entries(entry.include)) {
                    if (info?.url) includes[relPath] = info.url;
                }
            }
            return { url: entry.url, includes };
        }
    }
    return null;
}

async function withConcurrency(taskFns, maxConcurrent) {
    const results = [];
    const executing = new Set();

    for (const fn of taskFns) {
        const p = fn().then(
            val => { executing.delete(p); return { status: 'fulfilled', value: val }; },
            err => { executing.delete(p); return { status: 'rejected', reason: err }; }
        );
        executing.add(p);
        results.push(p);
        if (executing.size >= maxConcurrent) await Promise.race(executing);
    }

    return Promise.all(results);
}

async function searchModels(query) {
    const payload = await getAssetList('models');
    if (!payload) return [];

    const entries = Object.entries(payload);
    const matched = textMatch(entries, query);
    console.log(`[PolyHaven] Models: ${matched.length} text matches; resolving GLTF URLs for all (concurrency ${FILE_RESOLVE_CONCURRENCY})`);

    const taskFns = matched.map(({ id, meta }) => async () => {
        const filesInfo = await safeFetchJson(`https://api.polyhaven.com/files/${id}`, { headers: UA }, 15000);
        const bundle = extractGltfBundle(filesInfo);
        return {
            assetType: 'model',
            source: 'polyhaven',
            sourceLabel: 'Poly Haven',
            sourceAssetId: id,
            name: meta?.name || id.replace(/_/g, ' '),
            description: meta?.description || '',
            thumbnailUrl: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?height=180`,
            viewerUrl: `https://polyhaven.com/a/${id}`,
            modelUrl: bundle?.url || null,
            gltfIncludes: bundle?.includes || null,
            loadableInScene: Boolean(bundle?.url),
            format: bundle ? 'gltf' : null,
            license: 'CC0',
            categories: asArray(meta?.categories),
            tags: asArray(meta?.tags),
            faceCount: meta?.polycount || null
        };
    });

    const results = await withConcurrency(taskFns, FILE_RESOLVE_CONCURRENCY);
    // Keep one row per matched model: fulfilled gets GLTF URLs; failed fetches stay view-only.
    return matched.map(({ id, meta }, i) => {
        const r = results[i];
        if (r?.status === 'fulfilled') return r.value;
        return {
            assetType: 'model',
            source: 'polyhaven',
            sourceLabel: 'Poly Haven',
            sourceAssetId: id,
            name: meta?.name || id.replace(/_/g, ' '),
            description: (meta?.description || '').slice(0, 200) || 'Poly Haven files request failed — open on site to load',
            thumbnailUrl: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?height=180`,
            viewerUrl: `https://polyhaven.com/a/${id}`,
            modelUrl: null,
            gltfIncludes: null,
            loadableInScene: false,
            format: null,
            license: 'CC0',
            categories: asArray(meta?.categories),
            tags: asArray(meta?.tags),
            faceCount: meta?.polycount || null
        };
    });
}

async function searchHdris(query) {
    const payload = await getAssetList('hdris');
    if (!payload) return [];
    const matched = textMatch(Object.entries(payload), query);
    console.log(`[PolyHaven] HDRIs: returning ${matched.length} of ${Object.keys(payload).length}`);

    return matched.map(({ id, meta }) => ({
        assetType: 'hdri',
        source: 'polyhaven',
        sourceLabel: 'Poly Haven',
        sourceAssetId: id,
        name: meta?.name || id.replace(/_/g, ' '),
        description: meta?.description || '',
        thumbnailUrl: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?height=180`,
        viewerUrl: `https://polyhaven.com/a/${id}`,
        hdriUrl: `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${id}_1k.hdr`,
        loadableInScene: true,
        license: 'CC0',
        categories: asArray(meta?.categories),
        tags: asArray(meta?.tags)
    }));
}

async function searchTextures(query) {
    const payload = await getAssetList('textures');
    if (!payload) return [];
    const matched = textMatch(Object.entries(payload), query);
    console.log(`[PolyHaven] Textures: returning ${matched.length} of ${Object.keys(payload).length}`);

    return matched.map(({ id, meta }) => {
        const base = `https://dl.polyhaven.org/file/ph-assets/Textures`;
        /** CDN paths use the texture slug without the API's `t_` prefix (e.g. t_brick_floor_002 → brick_floor_002). */
        const slug = id.startsWith('t_') ? id.slice(2) : id;
        return {
            assetType: 'material',
            source: 'polyhaven',
            sourceLabel: 'Poly Haven',
            sourceAssetId: id,
            name: meta?.name || id.replace(/_/g, ' '),
            description: meta?.description || '',
            thumbnailUrl: `https://cdn.polyhaven.com/asset_img/thumbs/${slug}.png?height=180`,
            viewerUrl: `https://polyhaven.com/a/${slug}`,
            materialMaps: {
                diffuse: `${base}/jpg/1k/${slug}/${slug}_diff_1k.jpg`,
                normal: `${base}/jpg/1k/${slug}/${slug}_nor_gl_1k.jpg`,
                roughness: `${base}/jpg/1k/${slug}/${slug}_rough_1k.jpg`,
                ao: `${base}/jpg/1k/${slug}/${slug}_ao_1k.jpg`,
                displacement: `${base}/jpg/1k/${slug}/${slug}_disp_1k.jpg`,
            },
            loadableInScene: true,
            license: 'CC0',
            categories: asArray(meta?.categories),
            tags: asArray(meta?.tags)
        };
    });
}

async function search(category, query) {
    switch (category) {
        case 'models': return searchModels(query);
        case 'hdris': return searchHdris(query);
        case 'materials': return searchTextures(query);
        default: return [];
    }
}

module.exports = {
    categories: ['models', 'hdris', 'materials'],
    search
};
