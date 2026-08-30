/**
 * Optional reference images from https://unsplash.com/developers
 * Set UNSPLASH_ACCESS_KEY in .env (Application → Access Key).
 */
const TIMEOUT_MS = 15000;
const PER_PAGE = 30;
const MAX_PAGES = Math.max(1, parseInt(process.env.UNSPLASH_MAX_PAGES, 10) || 20);

const safeFetchJson = async (url, headers, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { headers, signal: controller.signal });
        if (!res.ok) {
            console.warn(`[Unsplash] HTTP ${res.status}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') console.warn(`[Unsplash] Fetch failed: ${err.message}`);
        return null;
    } finally {
        clearTimeout(t);
    }
};

function normalize(photo) {
    const urls = photo?.urls || {};
    return {
        assetType: 'image',
        source: 'unsplash',
        sourceLabel: 'Unsplash',
        sourceAssetId: photo.id,
        name: photo.description || photo.alt_description || 'Photo',
        description: photo.alt_description || '',
        thumbnailUrl: urls.small || urls.thumb,
        viewerUrl: photo.links?.html || null,
        imageUrl: urls.full || urls.regular || urls.small,
        imageWidth: photo.width,
        imageHeight: photo.height,
        loadableInScene: false,
        license: 'Unsplash License',
        categories: [],
        tags: (photo.alt_description || '').split(/\s+/).filter(w => w.length > 2),
    };
}

async function search(category, query) {
    if (category !== 'images') return [];

    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
        return [];
    }

    const headers = {
        Authorization: `Client-ID ${accessKey}`,
        'Accept-Version': 'v1',
    };

    const first = await safeFetchJson(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${PER_PAGE}&page=1`,
        headers
    );
    if (!first?.results?.length) return [];

    const totalPages = Math.min(first.total_pages || 1, MAX_PAGES);
    const all = [...first.results];
    const seen = new Set(all.map(p => p.id));

    if (totalPages > 1) {
        const maxPages = totalPages;
        const pages = [];
        for (let p = 2; p <= maxPages; p++) pages.push(p);

        const settled = await Promise.allSettled(
            pages.map(p => safeFetchJson(
                `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${PER_PAGE}&page=${p}`,
                headers
            ))
        );

        for (const s of settled) {
            if (s.status === 'fulfilled' && s.value?.results) {
                for (const photo of s.value.results) {
                    if (photo?.id && !seen.has(photo.id)) {
                        seen.add(photo.id);
                        all.push(photo);
                    }
                }
            }
        }
    }

    console.log(`[Unsplash] "${query}" → ${all.length} photos (pages ${totalPages}/${MAX_PAGES} cap)`);
    return all.map(normalize);
}

module.exports = {
    categories: ['images'],
    search
};
