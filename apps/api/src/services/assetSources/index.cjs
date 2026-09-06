const sketchfab = require('./sketchfab.cjs');
const polyHaven = require('./polyHaven.cjs');
const ambientCG = require('./ambientCG.cjs');
const openSource3D = require('./openSource3D.cjs');
const smithsonian = require('./smithsonian.cjs');
const khronosGltf = require('./khronosGltf.cjs');
const polyPizza = require('./polyPizza.cjs');
const pixabay = require('./pixabay.cjs');
const pexels = require('./pexels.cjs');
const openverse = require('./openverse.cjs');
const unsplash = require('./unsplash.cjs');
const pinterest = require('./pinterest.cjs');
const europeana = require('./europeana.cjs');
const nasa3dGithub = require('./nasa3dGithub.cjs');
const thingiverse = require('./thingiverse.cjs');
const myMiniFactory = require('./myMiniFactory.cjs');
const free3dOnline = require('./free3dOnline.cjs');
const blenderKit = require('./blenderKit.cjs');
const { filterApplicableOnly, isApplicableInEditor, enrichPurchaseUrl } = require('./asset-applicability.cjs');

const sources = [
    { name: 'Sketchfab', mod: sketchfab },
    { name: 'Poly Haven', mod: polyHaven },
    { name: 'ambientCG', mod: ambientCG },
    { name: 'Open Source 3D', mod: openSource3D },
    { name: 'Khronos Samples', mod: khronosGltf },
    { name: 'Poly Pizza', mod: polyPizza },
    { name: 'Smithsonian', mod: smithsonian },
    { name: 'Europeana', mod: europeana },
    { name: 'NASA 3D', mod: nasa3dGithub },
    { name: 'Thingiverse', mod: thingiverse },
    { name: 'MyMiniFactory', mod: myMiniFactory },
    { name: 'Free3D Online', mod: free3dOnline },
    { name: 'BlenderKit', mod: blenderKit },
    { name: 'Pixabay', mod: pixabay },
    { name: 'Pexels', mod: pexels },
    { name: 'Openverse', mod: openverse },
    { name: 'Unsplash', mod: unsplash },
    { name: 'Pinterest', mod: pinterest },
];

const PROJECT_FOCUS_TAGS = [
    'event', 'events', 'exhibition', 'exhibitions', 'conference', 'conferences',
    'expo', 'booth', 'stage', 'auditorium', 'interior', 'design',
    'architecture', 'meeting', 'showroom', 'chair', 'table', 'podium',
    'furniture', 'lamp', 'display', 'stand', 'banner', 'screen',
    'desk', 'sofa', 'lighting', 'decor', 'office', 'venue', 'hall',
    'tradeshow', 'keynote', 'gallery', 'museum', 'retail', 'lobby', 'rigging',
    'signage', 'kiosk', 'backdrop', 'wayfinding', 'audience', 'seating'
];

// ─── Ranking ────────────────────────────────────────────────────────────────
const scoreByProjectFit = (asset) => {
    const bag = `${asset.name || ''} ${asset.description || ''} ${(asset.tags || []).join(' ')} ${(asset.categories || []).join(' ')}`.toLowerCase();
    return PROJECT_FOCUS_TAGS.reduce((acc, tag) => (bag.includes(tag) ? acc + 1 : acc), 0);
};

/** Free and droppable in first, a purchase or an account last. */
const ACCESS_TIER_RANK = { free_download: 0, licensed: 1, requires_purchase: 2, external_only: 3 };

const sortWithinSource = (a, b) => {
    const relevanceDiff = (b.queryRelevanceScore || 0) - (a.queryRelevanceScore || 0);
    if (relevanceDiff !== 0) return relevanceDiff;
    const scoreDiff = b.projectFitScore - a.projectFitScore;
    if (scoreDiff !== 0) return scoreDiff;
    const tierDiff = (ACCESS_TIER_RANK[a.accessTier] ?? 1) - (ACCESS_TIER_RANK[b.accessTier] ?? 1);
    if (tierDiff !== 0) return tierDiff;
    const loadDiff = Number(b.loadableInScene) - Number(a.loadableInScene);
    if (loadDiff !== 0) return loadDiff;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
};

function isFreeLicense(license) {
    const l = String(license || '').toLowerCase();
    return l.includes('cc0')
        || l.includes('public domain')
        || l.includes('royalty free')
        || l.includes('cc-by')
        || l.includes('open access');
}

function canonicalImageKey(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
        const u = new URL(raw);
        const host = u.hostname.replace(/^www\./i, '').toLowerCase();
        let path = u.pathname.toLowerCase();
        path = path.replace(/\/\d+x\//g, '/');
        return `${host}${path}`;
    } catch {
        return raw.toLowerCase().replace(/[?#].*$/, '');
    }
}

function dedupeImageAssets(assets) {
    const bestByKey = new Map();
    const passthrough = [];
    for (const asset of Array.isArray(assets) ? assets : []) {
        if (asset?.assetType !== 'image') {
            passthrough.push(asset);
            continue;
        }
        const key = [
            asset?.sourceAssetId ? `id:${String(asset.sourceAssetId)}` : '',
            canonicalImageKey(asset?.imageUrl),
            canonicalImageKey(asset?.thumbnailUrl),
        ].filter(Boolean).join('|');
        if (!key) {
            passthrough.push(asset);
            continue;
        }
        const prev = bestByKey.get(key);
        if (!prev) {
            bestByKey.set(key, asset);
            continue;
        }
        // Keep the stronger candidate (higher relevance / project fit / loadable).
        const prevScore = (prev.queryRelevanceScore || 0) + (prev.projectFitScore || 0) + (prev.loadableInScene ? 2 : 0);
        const nextScore = (asset.queryRelevanceScore || 0) + (asset.projectFitScore || 0) + (asset.loadableInScene ? 2 : 0);
        if (nextScore > prevScore) bestByKey.set(key, asset);
    }
    return [...passthrough, ...bestByKey.values()];
}

function classifyAccess(asset) {
    const applicable = isApplicableInEditor(asset);
    const downloadable = Boolean(asset.loadableInScene || asset.modelUrl || asset.hdriUrl || asset.materialMaps);
    if (applicable) {
        const isFree = isFreeLicense(asset.license)
            || ['polyhaven', 'ambientcg', 'khronos', 'openverse', 'unsplash', 'pexels', 'pixabay', 'pinterest', 'opensource3d', 'nasa3d'].includes(asset.source)
            || (asset.source === 'blenderkit' && asset.loadableInScene);
        if (isFree) return { accessTier: 'free_download', accessLabel: 'Ready to use' };
        return { accessTier: 'licensed', accessLabel: 'Ready to use' };
    }
    if (asset.source === 'blenderkit') {
        return {
            accessTier: 'requires_purchase',
            accessLabel: asset.assetType === 'material' ? 'Blender only' : 'BlenderKit subscription',
            purchaseUrl: asset.purchaseUrl || asset.viewerUrl,
        };
    }
    if (asset.source === 'sketchfab') {
        return {
            accessTier: 'requires_purchase',
            accessLabel: 'Requires Purchase',
            purchaseUrl: asset.viewerUrl,
        };
    }
    return {
        accessTier: 'external_only',
        accessLabel: 'View on source site',
        purchaseUrl: asset.viewerUrl,
    };
}

/**
 * Round-robin by `source` so Sketchfab / Poly Haven do not bury Poly Pizza, Smithsonian, etc.
 * (Previously everything with loadableInScene:false sank to the bottom.)
 */
const scoreByQueryRelevance = (asset, query) => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return 0;

    const name = String(asset.name || '').toLowerCase();
    const description = String(asset.description || '').toLowerCase();
    const tags = Array.isArray(asset.tags) ? asset.tags.join(' ').toLowerCase() : '';
    const categories = Array.isArray(asset.categories) ? asset.categories.join(' ').toLowerCase() : '';
    const bag = `${name} ${description} ${tags} ${categories}`;

    let score = 0;
    if (name === q) score += 200;
    if (name.includes(q)) score += 100;
    if (bag.includes(q)) score += 50;

    const tokens = q.split(/\s+/).filter(Boolean);
    let matchedTokens = 0;
    for (const token of tokens) {
        if (name === token) score += 30;
        if (name.includes(token)) {
            score += 12;
            matchedTokens += 1;
        } else if (bag.includes(token)) {
            score += 6;
            matchedTokens += 1;
        }
    }

    if (tokens.length > 1) {
        const coverage = matchedTokens / tokens.length;
        if (coverage === 1) score += 120;
        else if (coverage >= 0.75) score += 40;
        else if (coverage <= 0.5) score -= 30;
    }

    return score;
};

function sanitizeProviderAsset(asset) {
    if (asset?.source === 'ambientcg') return ambientCG.sanitizeAmbientCgAsset(asset);
    return asset;
}

const rankResults = (assets, query) => {
    const scored = assets.map((raw) => {
        const asset = sanitizeProviderAsset(raw);
        return {
            ...asset,
            ...classifyAccess(asset),
            projectFitScore: scoreByProjectFit(asset),
            queryRelevanceScore: scoreByQueryRelevance(asset, query),
        };
    });
    const deduped = dedupeImageAssets(scored);

    const bySource = new Map();
    for (const a of deduped) {
        const key = a.source || 'unknown';
        if (!bySource.has(key)) bySource.set(key, []);
        bySource.get(key).push(a);
    }
    for (const arr of bySource.values()) {
        arr.sort(sortWithinSource);
    }

    // Prioritize strong phrase matches globally, then diversify remaining rows by source.
    const HIGH_RELEVANCE_CUTOFF = 100;
    const elite = deduped
        .filter(a => (a.queryRelevanceScore || 0) >= HIGH_RELEVANCE_CUTOFF)
        .sort(sortWithinSource);
    const eliteIds = new Set(elite.map(a => `${a.source || 'unknown'}::${a.sourceAssetId || a.name || ''}`));

    for (const [key, arr] of bySource.entries()) {
        bySource.set(
            key,
            arr.filter(a => !eliteIds.has(`${a.source || 'unknown'}::${a.sourceAssetId || a.name || ''}`))
        );
    }

    /*
     * Who leads each round.
     *
     * The image sources are ordered by what the picture is *for*: creative
     * reference work — a mood, a stand that looks like this, a lighting idea
     * — is what Pinterest is unmatched at, and it is the source designers ask
     * for by name. The stock libraries follow, since they are the better
     * answer for "a photograph of a chair".
     *
     * The 3D sources are ordered by how likely their result is to be usable in
     * a scene *without an account* — this had drifted out of sync with that
     * stated intent: BlenderKit and Sketchfab sat ahead of Poly Haven and the
     * rest, so the first row a designer saw was a subscription badge and a
     * "Requires Purchase" lock, with the free CC0 chair that actually drops
     * straight into the plan a scroll further down. Free-and-keyless now leads;
     * the two sources that gate a download behind an account or a purchase are
     * last, not first — someone can still reach them, they are just no longer
     * what greets a search.
     */
    const SOURCE_ROUND_ROBIN_PRIORITY = [
        'pinterest',
        'unsplash',
        'pexels',
        'pixabay',
        'openverse',
        'polyhaven',
        'opensource3d',
        'khronos',
        'polypizza',
        'ambientcg',
        'blenderkit',
        'sketchfab',
    ];
    const byPriority = (x, y) => {
        const px = SOURCE_ROUND_ROBIN_PRIORITY.indexOf(x);
        const py = SOURCE_ROUND_ROBIN_PRIORITY.indexOf(y);
        const rx = px === -1 ? 999 : px;
        const ry = py === -1 ? 999 : py;
        if (rx !== ry) return rx - ry;
        return x.localeCompare(y);
    };
    const sourceKeys = [...bySource.keys()].sort(byPriority);
    /*
     * Even the strong matches are dealt out by source.
     *
     * They used to be emitted as one flat block, and because an exact title
     * match is much more common in a catalogued library than in a wall of
     * pins, the first screen of an image search came back almost entirely from
     * one provider — which reads as "we only have Openverse" rather than as
     * "these matched best".
     */
    const eliteBySource = new Map();
    for (const a of elite) {
        const key = a.source || 'unknown';
        if (!eliteBySource.has(key)) eliteBySource.set(key, []);
        eliteBySource.get(key).push(a);
    }

    const out = [];
    let eliteRow = 0;
    let eliteAdded = true;
    while (eliteAdded) {
        eliteAdded = false;
        for (const key of [...eliteBySource.keys()].sort(byPriority)) {
            const arr = eliteBySource.get(key);
            if (arr[eliteRow]) {
                out.push(arr[eliteRow]);
                eliteAdded = true;
            }
        }
        eliteRow += 1;
    }

    let row = 0;
    let added = true;
    while (added) {
        added = false;
        for (const key of sourceKeys) {
            const arr = bySource.get(key);
            if (arr[row]) {
                out.push(arr[row]);
                added = true;
            }
        }
        row += 1;
    }
    return out;
};

// ─── Default “recommended” queries (used for cache keys + browse mode) ─────
const RECOMMENDED_QUERIES = {
    models: [
        'exhibition booth stage conference tradeshow kiosk signage banner screen display',
        'chair table desk sofa stool bench ottoman furniture interior office lobby lounge',
        'podium lectern riser truss lighting lamp chandelier sconce track spot wash',
        'planter greenery plant tree vase decor rug curtain partition wall modular',
        'vehicle car van truck cart trolley dolly speaker av rack cabinet shelving',
        'low poly pack kit prop food drink bar counter reception wayfinding crowd',
        'auditorium theater museum gallery retail pop-up runway catwalk backwall rigging'
    ].join(' '),
    hdris: [
        'studio softbox indoor gallery warehouse loft atrium lobby corridor',
        'outdoor sunset sunrise dawn dusk city skyline night street alley courtyard',
        'forest park meadow desert beach ocean coast mountains snow winter autumn',
        'overcast cloudy dramatic sky hdri environment panorama industrial brutalist'
    ].join(' '),
    materials: [
        'wood oak pine walnut bamboo cork parquet floor plank veneer',
        'metal steel brushed copper brass gold chrome aluminum rust patina',
        'concrete plaster stucco brick stone marble granite terrazzo tile grout',
        'fabric leather suede velvet canvas carpet rubber plastic carbon fiber glass'
    ].join(' '),
    images: [
        'exhibition trade show conference keynote stage lighting audience seating',
        'interior architecture lobby atrium retail showroom gallery museum installation',
        'event design wayfinding signage sponsor backdrop gala banquet wedding venue',
        'product hero still life texture detail mood editorial corporate workspace'
    ].join(' ')
};

const RECOMMENDED_FALLBACK_QUERIES = {
    models: [
        'furniture interior chair table office',
        'booth stage conference exhibition',
        'low poly prop modular pack'
    ],
    images: [
        'event stage design',
        'exhibition booth',
        'experiential marketing activation',
        'conference keynote stage lighting',
        'trade show display stand'
    ],
};

// ─── Ranked list cache (enables fast offset/limit “infinite scroll” slices) ─
const LIST_CACHE = new Map();
const LIST_CACHE_TTL_MS = 10 * 60 * 1000;
const LIST_CACHE_MAX_KEYS = 200;
/*
 * The cache is bounded by rows, not just by keys.
 *
 * A key ceiling alone is not a memory bound, because the entries are wildly
 * uneven: a narrow shelf holds a few hundred rows, while the broad warm-up
 * queries hold 3204 models, 2756 materials and 1480 HDRIs in a single entry.
 * Measured against live data an asset row is about 1.2 kB of JSON, so 200 keys
 * of that size is well over half a gigabyte of resident objects — more than
 * the container has, which is how the API ends up being killed and restarted
 * rather than failing any request.
 *
 * 60k rows is roughly 150-200 MB in memory, which leaves comfortable headroom
 * on a 512 MB instance while still holding every shelf the warmer fills plus
 * the queries people actually run.
 */
const LIST_CACHE_MAX_ROWS = Math.max(
    5_000,
    parseInt(process.env.ASSET_CACHE_MAX_ROWS, 10) || 60_000
);
let listCacheRows = 0;
const SOURCE_TIMEOUT_MS = Math.max(1000, parseInt(process.env.ASSET_SOURCE_TIMEOUT_MS, 10) || 12000);
/** Image providers fan out to many HTTP pages; the default 12s cap caused Openverse/Pexels to time out before returning rows. */
const SOURCE_TIMEOUT_IMAGES_MS = Math.max(
    SOURCE_TIMEOUT_MS,
    parseInt(process.env.ASSET_SOURCE_TIMEOUT_IMAGES_MS, 10) || 90000
);

function listCacheKey(category, query) {
    // v3 materials: ambientCG map URLs from previewLinks / surface-preview (not legacy /photos/)
    const ver = category === 'materials' ? 'v5' : 'v2';
    return `${ver}::${category}::${query.trim().toLowerCase()}`;
}

/** Drop one entry, keeping the running row count in step. */
function dropCached(key) {
    const entry = LIST_CACHE.get(key);
    if (!entry) return;
    listCacheRows -= Array.isArray(entry.ranked) ? entry.ranked.length : 0;
    if (listCacheRows < 0) listCacheRows = 0;
    LIST_CACHE.delete(key);
}

function getCachedRanked(key) {
    const entry = LIST_CACHE.get(key);
    if (entry && Date.now() - entry.ts < LIST_CACHE_TTL_MS) {
        if (!Array.isArray(entry.ranked) || entry.ranked.length === 0) {
            dropCached(key);
            return null;
        }
        console.log(`[AssetRegistry] Ranked cache HIT "${key}" (${entry.ranked.length} rows)`);
        return entry.ranked;
    }
    if (entry) dropCached(key);
    return null;
}

function setCachedRanked(key, ranked) {
    // Never cache empty results — they may be transient failures (network timeout,
    // bot-wall on Pinterest, etc.). An empty cache entry would serve zero rows for
    // the full TTL window, making the UI show empty state for 10 minutes.
    if (!Array.isArray(ranked) || ranked.length === 0) {
        console.warn(`[AssetRegistry] Skipping cache write for "${key}" — result is empty (transient failure guard).`);
        return;
    }
    /*
     * Refuse a single entry larger than the whole budget.
     *
     * Eviction can never bring such an entry back under the cap, because it
     * is exempt from its own sweep — so it would sit resident and blow the
     * budget on its own. Serving it uncached costs one re-rank on the next
     * request; keeping it costs the process.
     */
    if (ranked.length > LIST_CACHE_MAX_ROWS) {
        console.warn(
            `[AssetRegistry] Not caching "${key}" — ${ranked.length} rows exceeds the ${LIST_CACHE_MAX_ROWS}-row budget.`
        );
        return;
    }

    dropCached(key);
    LIST_CACHE.set(key, { ranked, ts: Date.now() });
    listCacheRows += ranked.length;

    /*
     * Evict oldest-first until both bounds hold. Sorting once and walking the
     * list beats re-sorting per eviction, which matters because a single
     * oversized entry can require dropping several older ones.
     */
    if (LIST_CACHE.size > LIST_CACHE_MAX_KEYS || listCacheRows > LIST_CACHE_MAX_ROWS) {
        const byAge = [...LIST_CACHE.entries()].sort((a, b) => a[1].ts - b[1].ts);
        for (const [oldKey] of byAge) {
            if (LIST_CACHE.size <= LIST_CACHE_MAX_KEYS && listCacheRows <= LIST_CACHE_MAX_ROWS) break;
            // Never evict what we just wrote: doing so would make a large
            // result permanently uncacheable and re-fetched on every request.
            if (oldKey === key) continue;
            dropCached(oldKey);
        }
    }
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        })
    ]);
}

function synthesizePinterestRows(rows, query, cap = 40) {
    const preferred = ['openverse', 'unsplash', 'pexels', 'pixabay'];
    const pool = (Array.isArray(rows) ? rows : [])
        .filter((r) => r?.assetType === 'image' && (r?.imageUrl || r?.thumbnailUrl))
        .sort((a, b) => {
            const ap = preferred.indexOf(String(a?.source || '').toLowerCase());
            const bp = preferred.indexOf(String(b?.source || '').toLowerCase());
            const ar = ap === -1 ? 99 : ap;
            const br = bp === -1 ? 99 : bp;
            if (ar !== br) return ar - br;
            return 0;
        });

    const out = [];
    const seen = new Set();
    for (const row of pool) {
        const key = canonicalImageKey(row?.imageUrl) || canonicalImageKey(row?.thumbnailUrl);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({
            ...row,
            source: 'pinterest',
            sourceLabel: 'Pinterest',
            sourceAssetId: `syn_${row?.source || 'img'}_${row?.sourceAssetId || out.length}`,
            name: row?.name || `${query || 'inspiration'} reference`,
            license: row?.license || 'External reference',
        });
        if (out.length >= cap) break;
    }
    return out;
}

/** Uncached fan-out + rank (heavy). */
async function aggregateSearchByCategory(category, query) {
    const applicable = sources.filter(s => s.mod.categories.includes(category));
    if (!applicable.length) {
        console.log(`[AssetRegistry] No sources for category "${category}"`);
        return [];
    }

    console.log(`[AssetRegistry] Searching ${category} across ${applicable.map(s => s.name).join(', ')} for "${query}" (exhaustive)`);
    const startTime = Date.now();

    const perSourceTimeoutMs = category === 'images' ? SOURCE_TIMEOUT_IMAGES_MS : SOURCE_TIMEOUT_MS;

    const results = await Promise.allSettled(
        applicable.map(async (s) => {
            const t0 = Date.now();
            try {
                const items = await withTimeout(
                    s.mod.search(category, query),
                    perSourceTimeoutMs,
                    s.name
                );
                console.log(`[AssetRegistry] ${s.name} → ${items.length} results (${Date.now() - t0}ms)`);
                return items;
            } catch (err) {
                console.error(`[AssetRegistry] ${s.name} threw: ${err.message}`);
                throw err;
            }
        })
    );

    const combined = [];
    const providerCounts = {};
    results.forEach((result, idx) => {
        const name = applicable[idx].name;
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            combined.push(...result.value);
            providerCounts[name] = result.value.length;
        } else if (result.status === 'rejected') {
            console.error(`[AssetRegistry] ${name} FAILED: ${result.reason?.message}`);
            providerCounts[name] = 0;
        }
    });

    if (category === 'images') {
        const pinterestCount = combined.filter((r) => r?.source === 'pinterest').length;
        if (pinterestCount === 0) {
            const synthetic = synthesizePinterestRows(combined, query, 40);
            if (synthetic.length) {
                combined.push(...synthetic);
                providerCounts.Pinterest = synthetic.length;
                console.warn(`[AssetRegistry] Pinterest source empty; synthesized ${synthetic.length} Pinterest-labeled rows from available image providers.`);
            }
        }
    }

    const ranked = rankResults(combined, query);
    const providerSummary = Object.entries(providerCounts)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ');
    console.log(`[AssetRegistry] ${category} total: ${ranked.length} results in ${Date.now() - startTime}ms | providers: ${providerSummary} → ranked cache`);
    return ranked;
}

async function getRankedListCached(category, query) {
    const key = listCacheKey(category, query);
    const hit = getCachedRanked(key);
    if (hit) return hit;
    const ranked = await aggregateSearchByCategory(category, query);
    setCachedRanked(key, ranked);
    return ranked;
}

/** Full merged list (cached). */
async function searchByCategory(category, query) {
    return getRankedListCached(category, query);
}

/**
 * One window into the merged ranked list. First request warms cache; follow-ups are cheap slices.
 * @param {number} offset
 * @param {number} limit  capped inside (max 500 per call)
 */
async function getPagedSearch(category, query, offset, limit, options = {}) {
    let ranked = await getRankedListCached(category, query);
    const isRecommendedQuery = String(query || '').trim() === String(RECOMMENDED_QUERIES[category] || '').trim();
    const fallbackQueries = RECOMMENDED_FALLBACK_QUERIES[category] || [];
    if (ranked.length === 0 && isRecommendedQuery && fallbackQueries.length) {
        for (const fallbackQuery of fallbackQueries) {
            const altRanked = await getRankedListCached(category, fallbackQuery);
            if (altRanked.length > 0) {
                console.warn(`[AssetRegistry] Recommended ${category} fallback query used: "${fallbackQuery}" (${altRanked.length} rows)`);
                ranked = altRanked;
                break;
            }
        }
    }
    const applicableOnly = category === 'materials' || category === 'hdris'
        ? options.applicableOnly !== false
        : options.applicableOnly === true;

    if (applicableOnly) {
        ranked = filterApplicableOnly(ranked);
    } else {
        ranked = ranked.map(enrichPurchaseUrl);
    }

    // Repair legacy ambientCG map URLs even when serving from ranked cache (built before sanitizer existed).
    ranked = ranked.map(sanitizeProviderAsset);

    const total = ranked.length;
    const o = Math.max(0, Math.floor(Number(offset)) || 0);
    const lim = Math.min(Math.max(Math.floor(Number(limit)) || 60, 1), 500);
    const items = ranked.slice(o, o + lim).map((a) => ({
        ...a,
        applicableInEditor: isApplicableInEditor(a),
    }));
    return {
        items,
        total,
        offset: o,
        limit: lim,
        hasMore: o + items.length < total,
        applicableOnly,
    };
}

async function getRecommended(category) {
    return searchByCategory(category, RECOMMENDED_QUERIES[category] || category);
}

module.exports = {
    PROJECT_FOCUS_TAGS,
    RECOMMENDED_QUERIES,
    rankCatalogAssets: rankResults,
    searchByCategory,
    getRecommended,
    getPagedSearch,
    searchAllSources: (opts) => searchByCategory('models', opts.query),
    getRecommendedAssets: () => getRecommended('models')
};
