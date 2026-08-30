const TIMEOUT_MS = 9000;
const PUBLIC_LIMIT = 48;
const MAX_DIRECT_RESOLVE = 8;
const API_BASE = 'https://free3d.online';
const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'you',
    'model', 'models', 'pack', 'asset', 'assets', '3d'
]);

const QUERY_SYNONYMS = {
    venue: ['event', 'stage', 'hall', 'auditorium', 'conference', 'exhibition', 'booth'],
    event: ['venue', 'conference', 'stage', 'auditorium', 'exhibition'],
    conference: ['venue', 'event', 'meeting', 'stage', 'booth'],
    exhibition: ['venue', 'event', 'booth', 'gallery', 'showroom'],
    booth: ['venue', 'exhibition', 'event', 'display'],
};

function getAgentToken() {
    return process.env.FREE3D_AGENT_TOKEN || process.env.FREE3D_API_TOKEN || '';
}

function authHeaders() {
    const token = getAgentToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
}

const safeFetchJson = async (url, options = {}, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            ...options,
            headers: {
                Accept: 'application/json',
                'User-Agent': 'Novira/1.0 asset-registry',
                ...(options.headers || {}),
            },
            signal: controller.signal,
        });
        if (!res.ok) {
            console.warn(`[Free3D] HTTP ${res.status} from ${url}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') console.warn(`[Free3D] Fetch failed: ${err.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

function asArray(v) {
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
}

function firstNonEmpty(...vals) {
    for (const v of vals) {
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
}

function toAbsoluteUrl(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const v = raw.trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    if (v.startsWith('//')) return `https:${v}`;
    if (v.startsWith('/')) return `${API_BASE}${v}`;
    return `${API_BASE}/${v.replace(/^\.?\//, '')}`;
}

function normalizeRow(row) {
    const guid = firstNonEmpty(
        row?.guid,
        row?.productGuid,
        row?.product_guid,
        row?.modelGuid,
        row?.model_guid,
        row?.id,
        row?.modelId
    );
    const tags = asArray(row?.tags || row?.keywords).filter(Boolean).map((x) => String(x));
    const categories = asArray(row?.categories || row?.category).filter(Boolean).map((x) => String(x));
    const directUrl = firstNonEmpty(
        row?.downloadUrl,
        row?.directUrl,
        row?.direct_download_url,
        // Prefer source/default GLB before ultra-low LOD variants to avoid crushed-looking meshes.
        row?.glbUrl,
        row?.glb10kUrl,
        row?.glb100kUrl,
        row?.glb1kUrl,
        row?.modelUrl,
        row?.model_url,
        row?.gltfUrl
    );
    const format = firstNonEmpty(row?.format, row?.ext, row?.fileExt, row?.file_ext);
    const preview = row?.preview || row?.poster || row?.imageSet || {};
    const imageObj = row?.image && typeof row.image === 'object' ? row.image : null;
    const thumbCandidate = firstNonEmpty(
        row?.thumbnailUrl,
        row?.thumbnail,
        row?.thumb,
        row?.posterUrl,
        row?.previewSmallUrl,
        row?.previewMediumUrl,
        row?.previewLargeUrl,
        preview?.small,
        preview?.smallUrl,
        preview?.medium,
        preview?.mediumUrl,
        preview?.large,
        preview?.largeUrl,
        row?.preview_url,
        row?.imageUrl,
        imageObj?.url,
        imageObj?.src,
        typeof row?.image === 'string' ? row.image : null
    );
    const resolvedCandidateUrl = toAbsoluteUrl(directUrl);
    const isBrowserDownloadRoute = Boolean(resolvedCandidateUrl && /\/download\/[^/]+\/glb/i.test(resolvedCandidateUrl));
    // Free3D browser download routes commonly require site auth/cookies and can return HTML.
    // Treat them as non-loadable until we resolve a direct file URL through agent auth.
    const resolvedModelUrl = isBrowserDownloadRoute ? null : resolvedCandidateUrl;
    const resolvedViewerUrl = toAbsoluteUrl(firstNonEmpty(
        row?.viewerUrl,
        row?.modelPageUrl,
        row?.url,
        guid ? `/model/${encodeURIComponent(guid)}` : null
    ));
    return {
        assetType: 'model',
        source: 'free3d',
        sourceLabel: 'Free3D Online',
        sourceAssetId: guid,
        name: firstNonEmpty(row?.name, row?.title) || 'Untitled',
        description: String(row?.description || '').slice(0, 320),
        thumbnailUrl: toAbsoluteUrl(thumbCandidate),
        viewerUrl: resolvedViewerUrl,
        modelUrl: resolvedModelUrl,
        loadableInScene: Boolean(resolvedModelUrl),
        format: format ? String(format).toLowerCase() : (resolvedModelUrl ? 'glb' : null),
        license: firstNonEmpty(row?.license, row?.licenseType, row?.license_type_string) || null,
        categories: categories.length ? categories : asArray(row?.category).map((x) => String(x)).filter(Boolean),
        tags,
        faceCount: row?.triCount || row?.faceCount || null,
        _raw: row,
    };
}

function collectRows(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    const directKeys = ['data', 'results', 'items', 'models', 'rows', 'hits'];
    for (const key of directKeys) {
        if (Array.isArray(payload[key])) return payload[key];
        if (payload[key] && Array.isArray(payload[key].items)) return payload[key].items;
    }
    return [];
}

function tokenizeQuery(q) {
    const base = String(q || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
    const expanded = new Set(base);
    for (const token of base) {
        const syns = QUERY_SYNONYMS[token] || [];
        syns.forEach((s) => {
            if (s.length >= 3 && !STOP_WORDS.has(s)) expanded.add(s);
        });
    }
    return [...expanded];
}

function queryMatchScore(entry, tokens) {
    if (!tokens.length) return 0;
    const bag = `${entry.name || ''} ${entry.description || ''} ${(entry.categories || []).join(' ')} ${(entry.tags || []).join(' ')}`.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const t of tokens) {
        if (bag.includes(t)) {
            matched += 1;
            score += (entry.name || '').toLowerCase().includes(t) ? 10 : 5;
        }
    }
    if (matched === tokens.length) score += 20;
    return score;
}

function collectDownloadRequests(node, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
        node.forEach((child) => collectDownloadRequests(child, out));
        return out;
    }

    const body = node?.downloadRequest?.body;
    if (body && body.guid && body.format && body.lod && body.relativePath) {
        out.push({
            guid: body.guid,
            format: String(body.format).toLowerCase(),
            lod: String(body.lod).toLowerCase(),
            relativePath: body.relativePath,
        });
    }

    const required = ['guid', 'format', 'lod', 'relativePath'];
    const hasTuple = required.every((k) => node[k] != null);
    if (hasTuple) {
        out.push({
            guid: node.guid,
            format: String(node.format).toLowerCase(),
            lod: String(node.lod).toLowerCase(),
            relativePath: node.relativePath,
        });
    }

    Object.values(node).forEach((child) => collectDownloadRequests(child, out));
    return out;
}

function pickBestDownloadRequest(reqs, guid) {
    const uniq = [];
    const seen = new Set();
    for (const r of reqs) {
        if (!r || !r.guid || !r.format || !r.lod || !r.relativePath) continue;
        if (String(r.guid) !== String(guid)) continue;
        const key = `${r.guid}|${r.format}|${r.lod}|${r.relativePath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        uniq.push(r);
    }
    if (!uniq.length) return null;

    const fmtRank = (f) => (f === 'glb' ? 0 : f === 'gltf' ? 1 : f === 'fbx' ? 2 : 3);
    // Prefer 10k as the best quality/perf default for direct API selections.
    const lodRank = (lod) => (lod === '10k' ? 0 : lod === '100k' ? 1 : lod === '1k' ? 2 : 3);
    uniq.sort((a, b) => {
        const fr = fmtRank(a.format) - fmtRank(b.format);
        if (fr !== 0) return fr;
        const lr = lodRank(a.lod) - lodRank(b.lod);
        if (lr !== 0) return lr;
        return String(a.relativePath).localeCompare(String(b.relativePath));
    });
    return uniq[0];
}

async function resolveDirectDownloadUrl(guid) {
    const token = getAgentToken();
    if (!guid || !token) return null;

    const formatsPayload = await safeFetchJson(
        `${API_BASE}/api/download/formats/${encodeURIComponent(guid)}`,
        { headers: { ...authHeaders() } },
        8000
    );
    if (!formatsPayload) return null;

    const reqs = collectDownloadRequests(formatsPayload);
    const selected = pickBestDownloadRequest(reqs, guid);
    if (!selected) return null;

    const directPayload = await safeFetchJson(
        `${API_BASE}/api/download/direct`,
        {
            method: 'POST',
            headers: {
                ...authHeaders(),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(selected),
        },
        8000
    );
    return firstNonEmpty(directPayload?.downloadUrl, directPayload?.directUrl) || null;
}

async function search(category, query) {
    if (category !== 'models') return [];

    const q = String(query || '').trim();
    const hasUserQuery = q.length > 0;
    const searchUrl = `${API_BASE}/api-embeddings/?q=${encodeURIComponent(hasUserQuery ? q : '3d')}&limit=${PUBLIC_LIMIT}&offset=0`;
    const searchPayload = await safeFetchJson(searchUrl, {}, TIMEOUT_MS);
    let merged = collectRows(searchPayload);

    // Only use browse to fill empty/default discovery mode; never pollute explicit query intent.
    if (!hasUserQuery && merged.length < 12) {
        const browseUrl = `${API_BASE}/api-embeddings/browse?limit=${PUBLIC_LIMIT}&offset=0`;
        const browsePayload = await safeFetchJson(browseUrl, {}, TIMEOUT_MS);
        merged = [...merged, ...collectRows(browsePayload)];
    }

    const byId = new Map();
    for (const row of merged) {
        const normalized = normalizeRow(row);
        if (!normalized.sourceAssetId) continue;
        const score = Number(row?.score ?? row?.lexicalScore ?? row?.embeddingScore ?? 0);
        normalized._providerScore = Number.isFinite(score) ? score : 0;
        if (!byId.has(normalized.sourceAssetId)) byId.set(normalized.sourceAssetId, normalized);
    }

    let list = [...byId.values()];
    const tokens = tokenizeQuery(q);
    if (tokens.length) {
        const scored = list
            .map((entry) => ({
                entry,
                localScore: queryMatchScore(entry, tokens),
            }))
            .sort((a, b) => {
                if (b.localScore !== a.localScore) return b.localScore - a.localScore;
                return (b.entry._providerScore || 0) - (a.entry._providerScore || 0);
            });

        const matched = scored.filter(({ localScore }) => localScore > 0).map(({ entry }) => entry);
        // Guardrail: never collapse to zero if provider already returned valid rows.
        list = matched.length ? matched : scored.map(({ entry }) => entry);
    } else {
        list.sort((a, b) => (b._providerScore || 0) - (a._providerScore || 0));
    }

    if (!list.length) {
        console.log('[Free3D] No rows from search for query:', q || '(default)');
        return [];
    }

    const tokenPresent = Boolean(getAgentToken());
    const unresolved = list.filter((x) => !x.modelUrl).slice(0, MAX_DIRECT_RESOLVE);
    if (unresolved.length && tokenPresent) {
        const settled = await Promise.allSettled(
            unresolved.map(async (entry) => {
                const direct = await resolveDirectDownloadUrl(entry.sourceAssetId);
                if (!direct) return;
                entry.modelUrl = direct;
                entry.loadableInScene = true;
                const ext = direct.split('?')[0].split('.').pop();
                if (!entry.format && ext) entry.format = String(ext).toLowerCase();
            })
        );
        settled.forEach((s) => {
            if (s.status === 'rejected') {
                console.warn(`[Free3D] direct resolve failed: ${s.reason?.message || s.reason}`);
            }
        });
    }

    if (!tokenPresent) {
        // Make source behavior explicit in logs when download URLs are auth-gated.
        const loadableCount = list.filter((x) => x.loadableInScene).length;
        if (loadableCount === 0) {
            console.warn('[Free3D] No FREE3D_AGENT_TOKEN configured; results are viewer-only until direct download auth is enabled.');
        }
    } else {
        // With agent token configured, bridge endpoint can resolve downloadable GLB per-guid on demand.
        list.forEach((entry) => {
            if (entry.sourceAssetId) entry.loadableInScene = true;
        });
    }

    console.log(`[Free3D] ${list.length} models (loadable=${list.filter((x) => x.loadableInScene).length})`);
    return list;
}

module.exports = {
    categories: ['models'],
    search,
};
