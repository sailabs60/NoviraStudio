const TIMEOUT_MS = 15000;
const PER_PAGE = 80;
const MAX_PAGES = Math.max(1, parseInt(process.env.PEXELS_MAX_PAGES, 10) || 20);

const safeFetchJson = async (url, options = {}, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) {
            console.warn(`[Pexels] HTTP ${res.status}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') console.warn(`[Pexels] Fetch failed: ${err.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

function normalizePhoto(photo) {
    return {
        assetType: 'image',
        source: 'pexels',
        sourceLabel: 'Pexels',
        sourceAssetId: String(photo.id),
        name: photo.alt || `Photo by ${photo.photographer}`,
        description: photo.alt || '',
        thumbnailUrl: photo.src?.small || photo.src?.tiny,
        viewerUrl: photo.url,
        imageUrl: photo.src?.large2x || photo.src?.large || photo.src?.original,
        imageWidth: photo.width,
        imageHeight: photo.height,
        loadableInScene: false,
        license: 'Pexels License',
        categories: [],
        tags: (photo.alt || '').split(/\s+/).filter(w => w.length > 3)
    };
}

function buildUrl(query, page) {
    const params = new URLSearchParams({
        query,
        per_page: String(PER_PAGE),
        page: String(page),
    });
    return `https://api.pexels.com/v1/search?${params}`;
}

async function search(category, query) {
    if (category !== 'images') return [];

    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) {
        console.log('[Pexels] Skipped - no PEXELS_API_KEY in env');
        return [];
    }

    const authHeaders = { Authorization: apiKey };

    const first = await safeFetchJson(buildUrl(query, 1), { headers: authHeaders });
    if (!first?.photos?.length) return [];

    const totalResults = first.total_results || first.photos.length;
    const totalPages = Math.min(Math.ceil(totalResults / PER_PAGE), MAX_PAGES);
    const seenIds = new Set();
    const all = [];

    for (const photo of first.photos) {
        seenIds.add(photo.id);
        all.push(photo);
    }

    if (totalPages > 1) {
        const remainingPages = [];
        for (let p = 2; p <= totalPages; p++) remainingPages.push(p);

        const pages = await Promise.allSettled(
            remainingPages.map(p => safeFetchJson(buildUrl(query, p), { headers: authHeaders }))
        );

        for (const page of pages) {
            if (page.status === 'fulfilled' && page.value?.photos) {
                for (const photo of page.value.photos) {
                    if (!seenIds.has(photo.id)) {
                        seenIds.add(photo.id);
                        all.push(photo);
                    }
                }
            }
        }
    }

    console.log(`[Pexels] Exhausted ${totalPages} pages (cap ${MAX_PAGES}) → ${all.length} photos (API reported ${totalResults})`);
    return all.map(normalizePhoto);
}

module.exports = {
    categories: ['images'],
    search
};
