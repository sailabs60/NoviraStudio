const TIMEOUT_MS = 20000;
const PAGE_SIZE = 20;
const PAGE_CONCURRENCY = 5;
const MAX_PAGES = Math.max(1, parseInt(process.env.OPENVERSE_MAX_PAGES, 10) || 20);
const UA = { 'User-Agent': process.env.OPENVERSE_USER_AGENT || 'Novira/1.0 (event design; https://openverse.org)' };

const safeFetchJson = async (url, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { headers: UA, signal: controller.signal });
        if (!res.ok) {
            console.warn(`[Openverse] HTTP ${res.status}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') console.warn(`[Openverse] Fetch failed: ${err.message}`);
        return null;
    } finally {
        clearTimeout(t);
    }
};

function normalize(hit) {
    const tags = Array.isArray(hit.tags) ? hit.tags.map(t => (typeof t === 'string' ? t : t?.name)).filter(Boolean) : [];
    const lic = [hit.license, hit.license_version].filter(Boolean).join(' ').toUpperCase() || 'CC';
    return {
        assetType: 'image',
        source: 'openverse',
        sourceLabel: 'Openverse',
        sourceAssetId: hit.id,
        name: hit.title || 'Image',
        description: hit.attribution || tags.slice(0, 8).join(', '),
        thumbnailUrl: typeof hit.thumbnail === 'string' ? hit.thumbnail : hit.thumbnail?.url || hit.url,
        viewerUrl: hit.foreign_landing_url || hit.detail_url || null,
        imageUrl: hit.url || null,
        imageWidth: hit.width || null,
        imageHeight: hit.height || null,
        loadableInScene: false,
        license: lic,
        categories: [],
        tags
    };
}

function searchUrl(query, page) {
    const params = new URLSearchParams({
        q: query,
        page: String(page),
        page_size: String(PAGE_SIZE),
    });
    return `https://api.openverse.org/v1/images/?${params}`;
}

async function search(category, query) {
    if (category !== 'images') return [];

    const first = await safeFetchJson(searchUrl(query, 1));
    if (!first?.results?.length) return [];

    /* One registry call must finish under the server per-source timeout; cap pages (slice still paginates in UI). */
    const pageCount = Math.min(first.page_count || 1, MAX_PAGES);
    const byPage = new Map([[1, first.results]]);

    if (pageCount > 1) {
        const rest = [];
        for (let p = 2; p <= pageCount; p++) rest.push(p);

        for (let i = 0; i < rest.length; i += PAGE_CONCURRENCY) {
            const chunk = rest.slice(i, i + PAGE_CONCURRENCY);
            const settled = await Promise.allSettled(
                chunk.map(p => safeFetchJson(searchUrl(query, p)))
            );
            for (let j = 0; j < settled.length; j++) {
                const s = settled[j];
                const pageNum = chunk[j];
                if (s.status === 'fulfilled' && s.value?.results?.length) {
                    byPage.set(pageNum, s.value.results);
                }
            }
        }
    }

    const seen = new Set();
    const ordered = [];
    for (let p = 1; p <= pageCount; p++) {
        const rows = byPage.get(p);
        if (!rows) continue;
        for (const hit of rows) {
            if (hit?.id && !seen.has(hit.id)) {
                seen.add(hit.id);
                ordered.push(hit);
            }
        }
    }

    console.log(`[Openverse] "${query}" → ${ordered.length} images (${pageCount} pages, cap ${MAX_PAGES}, concurrency ${PAGE_CONCURRENCY})`);
    return ordered.map(normalize);
}

module.exports = {
    categories: ['images'],
    search
};
