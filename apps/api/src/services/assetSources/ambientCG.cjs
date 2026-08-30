const TIMEOUT_MS = 20000;
const PAGE_SIZE = 100;
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
        if (!res.ok) {
            console.warn(`[ambientCG] HTTP ${res.status} from ${url}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') console.warn(`[ambientCG] Fetch failed: ${err.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

function getThumb(item) {
    return item.previewImage?.['256-PNG']
        || item.previewImage?.['256-WEBP']
        || item.previewImage?.['128-PNG']
        || null;
}

function firstAbsoluteHdrUrl(value, depth = 0) {
    if (depth > 30 || value == null) return null;
    if (typeof value === 'string') {
        const s = value.trim();
        if (/^https?:\/\/.+\.hdr(\?|$)/i.test(s)) return s;
        return null;
    }
    if (Array.isArray(value)) {
        for (const el of value) {
            const u = firstAbsoluteHdrUrl(el, depth + 1);
            if (u) return u;
        }
        return null;
    }
    if (typeof value === 'object') {
        for (const v of Object.values(value)) {
            const u = firstAbsoluteHdrUrl(v, depth + 1);
            if (u) return u;
        }
    }
    return null;
}

/** Direct download pattern when API search misses an asset id (common for catalog cache rows). */
function hdriZipUrlForAssetId(assetId, preferRes = '1K') {
    const id = String(assetId || '').trim();
    if (!id) return null;
    return `https://ambientcg.com/get?file=${encodeURIComponent(`${id}_${preferRes}.zip`)}`;
}

/** ambientCG v2 ships HDRIs as ZIP archives containing OpenEXR (`*_HDR.exr`), not bare .hdr URLs. */
function pickHdriZipDownload(item, preferRes = '1K') {
    if (!item) return null;
    const zips = item.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads;
    if (!Array.isArray(zips) || !zips.length) return null;
    return zips.find((d) => d.attribute === preferRes)
        || zips.find((d) => String(d.attribute || '').toUpperCase().includes(preferRes))
        || zips[0];
}

function normalizeHdri(item) {
    const id = item.assetId;
    let hdriUrl = null;

    const dlCats = item.downloadFolders?.default?.downloadFiletypeCategories;
    const hdrOnly = dlCats?.hdri?.downloads;
    if (hdrOnly?.length) {
        const best = hdrOnly.find(d => d.attribute === '1K') || hdrOnly.find(d => d.attribute?.includes?.('1K')) || hdrOnly[0];
        const link = best?.fullDownloadPath || best?.downloadLink;
        if (link && /\.hdr($|\?)/i.test(link)) hdriUrl = link;
    }

    if (!hdriUrl) {
        hdriUrl = firstAbsoluteHdrUrl(item.downloadData);
    }

    const zipDl = pickHdriZipDownload(item);
    const zipUrl = zipDl?.fullDownloadPath || zipDl?.downloadLink || null;
    const hasDirectHdr = Boolean(hdriUrl && /\.hdr($|\?)/i.test(hdriUrl));
    /** Direct .hdr when published; otherwise server extracts EXR/HDR from the 1K ZIP via /ambientcg/hdri/:id */
    const loadableInScene = hasDirectHdr || Boolean(zipUrl);

    return {
        assetType: 'hdri',
        source: 'ambientcg',
        sourceLabel: 'ambientCG',
        sourceAssetId: id,
        name: item.displayName || id,
        description: item.description || '',
        thumbnailUrl: getThumb(item),
        viewerUrl: `https://ambientcg.com/view?id=${id}`,
        hdriUrl: hasDirectHdr ? hdriUrl : null,
        hdriZipUrl: zipUrl,
        loadableInScene,
        license: 'CC0',
        categories: [item.category].filter(Boolean),
        tags: item.tags || []
    };
}

function stripUrlQuery(url) {
    if (!url) return null;
    return String(url).split('?')[0];
}

/** ambientCG v2 embeds per-map URLs in previewLinks (pbr.one material-shading hash). */
function materialMapsFromPreviewLinks(previewLinks = []) {
    const shading = (Array.isArray(previewLinks) ? previewLinks : []).find((p) =>
        /material-shading/i.test(String(p?.url || '')),
    );
    if (!shading?.url) return null;

    const hash = String(shading.url).split('#')[1] || '';
    if (!hash) return null;

    const params = new URLSearchParams(hash);
    const materialMaps = {
        diffuse: stripUrlQuery(params.get('color_url')),
        normal: stripUrlQuery(params.get('normal_url')),
        roughness: stripUrlQuery(params.get('roughness_url')),
        ao: stripUrlQuery(params.get('ambientocclusion_url')),
        displacement: stripUrlQuery(params.get('displacement_url')),
        metalness: stripUrlQuery(params.get('metalness_url')),
    };
    return Object.values(materialMaps).some(Boolean) ? materialMaps : null;
}

function compactMaterialMaps(materialMaps) {
    const out = {};
    for (const [key, value] of Object.entries(materialMaps || {})) {
        if (value) out[key] = value;
    }
    return out;
}

/**
 * CDN surface-preview: Color / Normal / Roughness are reliably published.
 * AO and Displacement SQ tiles are often missing (404) — only use when previewLinks provide URLs.
 */
function materialMapsFromSurfacePreview(id) {
    const base = `https://acg-media.struffelproductions.com/file/ambientCG-Web/media/surface-preview/${id}`;
    return compactMaterialMaps({
        diffuse: `${base}/${id}_SQ_Color.jpg`,
        normal: `${base}/${id}_SQ_NormalDX.jpg`,
        roughness: `${base}/${id}_SQ_Roughness.jpg`,
    });
}

function normalizeMaterial(item) {
    const id = item.assetId;

    const maps = {};
    if (item.maps && typeof item.maps === 'object' && !Array.isArray(item.maps)) {
        for (const [mapType, mapData] of Object.entries(item.maps)) {
            const url = mapData?.['1K-JPG'] || mapData?.['1K-PNG'] || Object.values(mapData || {})[0];
            if (url) maps[mapType.toLowerCase()] = url;
        }
    }

    let materialMaps = materialMapsFromPreviewLinks(item.previewLinks);
    if (!materialMaps) {
        materialMaps = {
            diffuse: maps.color || maps.diffuse || null,
            normal: maps.normalgl || maps.normal || null,
            roughness: maps.roughness || null,
            ao: maps.ambientocclusion || maps.ao || null,
            displacement: maps.displacement || maps.height || null,
            metalness: maps.metalness || null,
        };
    }

    const hasMaps = Object.values(materialMaps).some(Boolean);
    if (!hasMaps) {
        materialMaps = materialMapsFromSurfacePreview(id);
    } else if (Object.values(materialMaps).some((u) => /\/media\/photos\/ambientCG\//i.test(String(u || '')))) {
        // Legacy fallback URLs (404 on CDN) — replace with surface-preview tiles.
        materialMaps = materialMapsFromSurfacePreview(id);
    }

    const compacted = compactMaterialMaps(materialMaps);
    return {
        assetType: 'material',
        source: 'ambientcg',
        sourceLabel: 'ambientCG',
        sourceAssetId: id,
        name: item.displayName || id,
        description: item.description || '',
        thumbnailUrl: getThumb(item),
        viewerUrl: `https://ambientcg.com/view?id=${id}`,
        materialMaps: compacted,
        loadableInScene: Boolean(compacted.diffuse),
        license: 'CC0',
        categories: [item.category].filter(Boolean),
        tags: item.tags || []
    };
}

function buildUrl(apiType, q, offset) {
    const params = new URLSearchParams({
        type: apiType,
        q,
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort: 'Popular',
        include: 'downloadData,previewData,tagData,mapData,fileData'
    });
    return `https://ambientcg.com/api/v2/full_json?${params}`;
}

async function exhaustQuery(apiType, q) {
    const first = await safeFetchJson(buildUrl(apiType, q, 0));
    if (!first) return [];

    const items = first.foundAssets || [];
    const total = first.numberOfResults || items.length;

    if (total <= PAGE_SIZE) return items;

    const offsets = [];
    for (let off = PAGE_SIZE; off < total; off += PAGE_SIZE) offsets.push(off);

    const pages = await Promise.allSettled(
        offsets.map(off => safeFetchJson(buildUrl(apiType, q, off)))
    );

    for (const page of pages) {
        if (page.status === 'fulfilled' && page.value?.foundAssets) {
            items.push(...page.value.foundAssets);
        }
    }

    return items;
}

async function searchType(apiType, normalizer, query) {
    const words = query.split(/\s+/).filter(w => w.length >= 2);
    const queries = words.length > 1 ? [...new Set(words)] : [query];
    if (!queries.includes('')) queries.push('');

    const allItems = new Map();

    const results = await Promise.allSettled(
        queries.map(q => exhaustQuery(apiType, q))
    );

    for (const result of results) {
        if (result.status === 'fulfilled') {
            for (const item of result.value) {
                if (item.assetId && !allItems.has(item.assetId)) {
                    allItems.set(item.assetId, item);
                }
            }
        }
    }

    const items = [...allItems.values()];
    console.log(`[ambientCG] ${apiType}: exhausted ${queries.length} queries → ${items.length} unique assets`);
    return items.map(normalizer).filter(Boolean);
}

async function search(category, query) {
    switch (category) {
        case 'hdris': return searchType('HDRI', normalizeHdri, query);
        case 'materials': return searchType('Material', normalizeMaterial, query);
        default: return [];
    }
}

/** Repair legacy /photos/ambientCG URLs on cached or older registry rows at serve time. */
function sanitizeAmbientCgAsset(asset) {
    if (!asset || asset.source !== 'ambientcg' || !asset.materialMaps) return asset;
    const broken = Object.values(asset.materialMaps).some((u) =>
        /\/media\/photos\/ambientCG\//i.test(String(u || '')),
    );
    if (!broken || !asset.sourceAssetId) return asset;
    const core = materialMapsFromSurfacePreview(String(asset.sourceAssetId));
    const merged = { ...core };
    for (const slot of ['ao', 'displacement', 'metalness']) {
        const u = asset.materialMaps?.[slot];
        if (u && !/\/media\/photos\/ambientCG\//i.test(String(u))) {
            merged[slot] = u;
        }
    }
    return { ...asset, materialMaps: compactMaterialMaps(merged) };
}

function syntheticHdriItem(assetId, zipUrl) {
    return {
        assetId,
        dataType: 'HDRI',
        downloadFolders: {
            default: {
                downloadFiletypeCategories: {
                    zip: {
                        downloads: [{
                            fullDownloadPath: zipUrl,
                            downloadLink: zipUrl,
                            attribute: '1K',
                            filetype: 'zip',
                        }],
                    },
                },
            },
        },
    };
}

async function probeHdriZipUrl(zipUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const res = await fetch(zipUrl, {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'follow',
            headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'], Accept: 'application/zip,*/*' },
        });
        return res.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchHdriAssetById(assetId) {
    const id = String(assetId || '').trim();
    if (!id) return null;

    const params = new URLSearchParams({
        type: 'HDRI',
        q: id,
        limit: '8',
        include: 'downloadData',
    });
    const payload = await safeFetchJson(`https://ambientcg.com/api/v2/full_json?${params}`);
    const rows = payload?.foundAssets || [];
    const exact = rows.find((a) => a.assetId === id);
    if (exact) return exact;

    const fuzzy = rows.find((a) => String(a.assetId || '').toLowerCase() === id.toLowerCase());
    if (fuzzy) return fuzzy;

    const zipUrl = hdriZipUrlForAssetId(id);
    if (zipUrl && await probeHdriZipUrl(zipUrl)) {
        return syntheticHdriItem(id, zipUrl);
    }

    return null;
}

module.exports = {
    categories: ['hdris', 'materials'],
    search,
    sanitizeAmbientCgAsset,
    pickHdriZipDownload,
    hdriZipUrlForAssetId,
    fetchHdriAssetById,
};
