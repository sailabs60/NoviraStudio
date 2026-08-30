const TIMEOUT_MS = 15000;
const PER_PAGE = 200;
const MAX_PAGES = Math.max(1, parseInt(process.env.PIXABAY_MAX_PAGES, 10) || 20);

const safeFetchJson = async (url, options = {}, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) {
            console.warn(`[Pixabay] HTTP ${res.status}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') console.warn(`[Pixabay] Fetch failed: ${err.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

function normalizeHit(hit) {
    return {
        assetType: 'image',
        source: 'pixabay',
        sourceLabel: 'Pixabay',
        sourceAssetId: String(hit.id),
        name: (hit.tags || 'Image').split(',')[0].trim(),
        description: hit.tags || '',
        thumbnailUrl: hit.previewURL || hit.webformatURL,
        viewerUrl: hit.pageURL,
        imageUrl: hit.largeImageURL || hit.webformatURL,
        imageWidth: hit.imageWidth,
        imageHeight: hit.imageHeight,
        loadableInScene: false,
        license: 'Pixabay License',
        categories: [],
        tags: (hit.tags || '').split(',').map(t => t.trim()).filter(Boolean)
    };
}

function buildUrl(apiKey, query, page) {
    const params = new URLSearchParams({
        key: apiKey,
        q: query,
        per_page: String(PER_PAGE),
        page: String(page),
        image_type: 'photo',
        safesearch: 'true',
        order: 'popular'
    });
    return `https://pixabay.com/api/?${params}`;
}

async function search(category, query) {
    if (category !== 'images') return [];

    const apiKey = process.env.PIXABAY_API_KEY;
    if (!apiKey) {
        console.log('[Pixabay] Skipped - no PIXABAY_API_KEY in env');
        return [];
    }

    const first = await safeFetchJson(buildUrl(apiKey, query, 1));
    if (!first?.hits?.length) return [];

    const totalHits = first.totalHits || first.hits.length;
    const totalPages = Math.min(Math.ceil(totalHits / PER_PAGE), MAX_PAGES);
    const seenIds = new Set();
    const all = [];

    for (const hit of first.hits) {
        seenIds.add(hit.id);
        all.push(hit);
    }

    if (totalPages > 1) {
        const remainingPages = [];
        for (let p = 2; p <= totalPages; p++) remainingPages.push(p);

        const pages = await Promise.allSettled(
            remainingPages.map(p => safeFetchJson(buildUrl(apiKey, query, p)))
        );

        for (const page of pages) {
            if (page.status === 'fulfilled' && page.value?.hits) {
                for (const hit of page.value.hits) {
                    if (!seenIds.has(hit.id)) {
                        seenIds.add(hit.id);
                        all.push(hit);
                    }
                }
            }
        }
    }

    console.log(`[Pixabay] Exhausted ${totalPages} pages (cap ${MAX_PAGES}) → ${all.length} images (API reported ${totalHits})`);
    return all.map(normalizeHit);
}

module.exports = {
    categories: ['images'],
    search
};
