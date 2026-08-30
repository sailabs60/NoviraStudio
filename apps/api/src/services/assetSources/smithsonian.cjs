const TIMEOUT_MS = 15000;
const ROWS = 100;

const safeFetchJson = async (url, options = {}, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') console.warn(`[Smithsonian] Fetch failed: ${err.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

const asArray = (v) => (!v ? [] : Array.isArray(v) ? v : [v]);

function pickTitle(item) {
    const t = item?.title;
    if (typeof t === 'string' && t.trim()) return t.trim();
    if (t && typeof t.content === 'string' && t.content.trim()) return t.content.trim();

    const desc = item?.content?.descriptiveNonRepeating || {};
    const dt = desc?.title;
    if (typeof dt === 'string' && dt.trim()) return dt.trim();
    if (dt && typeof dt.content === 'string' && dt.content.trim()) return dt.content.trim();

    const indexed = item?.content?.indexedStructured || {};
    const nameArr = indexed?.name;
    if (Array.isArray(nameArr) && nameArr[0]) return String(nameArr[0]).trim();
    if (typeof indexed?.object_name === 'string') return indexed.object_name.trim();

    return '';
}

function normalizeItem(item) {
    const desc = item?.content?.descriptiveNonRepeating || {};
    const media = desc?.online_media?.media || [];
    const thumb = media[0]?.thumbnail || media[0]?.content || null;
    const guid = item?.id || desc?.guid || item?.linked_id || null;
    const title = pickTitle(item);
    const name = title || (guid ? `Smithsonian ${String(guid).slice(0, 12)}…` : 'Smithsonian object');

    return {
        assetType: 'model',
        source: 'smithsonian',
        sourceLabel: 'Smithsonian',
        sourceAssetId: guid,
        name,
        description: (item?.content?.freetext?.notes?.[0] || '').slice(0, 240) || '',
        thumbnailUrl: thumb,
        viewerUrl: guid ? `https://3d.si.edu/object/${guid}` : null,
        modelUrl: null,
        loadableInScene: false,
        format: null,
        license: 'Open Access',
        categories: [],
        tags: [],
        faceCount: null
    };
}

function buildUrl(apiKey, query, start) {
    const params = new URLSearchParams({
        api_key: apiKey,
        q: `${query} 3D`,
        rows: String(ROWS),
        start: String(start)
    });
    return `https://api.si.edu/openaccess/api/v1.0/search?${params}`;
}

async function search(category, query) {
    if (category !== 'models') return [];

    const apiKey = process.env.SMITHSONIAN_API_KEY;
    if (!apiKey) {
        console.warn('[Smithsonian] SMITHSONIAN_API_KEY is not set — Smithsonian search is disabled (403 without a key).');
        return [];
    }

    const first = await safeFetchJson(buildUrl(apiKey, query, 0));
    const firstRows = asArray(first?.response?.rows);
    const numFound = first?.response?.rowCount || firstRows.length;
    const allRows = [...firstRows];

    if (numFound > ROWS) {
        const offsets = [];
        for (let start = ROWS; start < numFound; start += ROWS) offsets.push(start);

        const pages = await Promise.allSettled(
            offsets.map(start => safeFetchJson(buildUrl(apiKey, query, start)))
        );

        for (const page of pages) {
            if (page.status === 'fulfilled') {
                allRows.push(...asArray(page.value?.response?.rows));
            }
        }
    }

    console.log(`[Smithsonian] Exhausted ${Math.ceil(numFound / ROWS)} pages → ${allRows.length} items (API reported ${numFound})`);
    return allRows.map(normalizeItem).filter(i => i.sourceAssetId || i.name);
}

module.exports = {
    categories: ['models'],
    search
};
