const TIMEOUT_MS = 12000;
const API_BASE = 'https://www.blenderkit.com/api/v1';
const PAGE_SIZE = 64;

function getToken() {
    return process.env.BLENDERKIT_API_KEY || process.env.BLENDERKIT_TOKEN || '';
}

function headers() {
    const h = {
        Accept: 'application/json',
        'User-Agent': 'Novira/1.0 asset-registry',
    };
    const token = getToken();
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
}

const safeFetchJson = async (url, options = {}, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            ...options,
            headers: { ...headers(), ...(options.headers || {}) },
            signal: controller.signal,
        });
        if (!res.ok) {
            console.warn(`[BlenderKit] HTTP ${res.status} from ${url}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') console.warn(`[BlenderKit] Fetch failed: ${err.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

function asArray(v) {
    if (!v) return [];
    return Array.isArray(v) ? v : [v];
}

function pickThumb(files = []) {
    const thumb = files.find((f) => String(f.fileType || '').toLowerCase() === 'thumbnail');
    if (!thumb) return null;
    return (
        thumb.thumbnailLargeUrlNonsquaredWebp
        || thumb.thumbnailLargeUrlNonsquared
        || thumb.thumbnailMiddleUrlNonsquaredWebp
        || thumb.thumbnailMiddleUrlNonsquared
        || thumb.thumbnailLargeUrl
        || thumb.thumbnailMiddleUrl
        || thumb.thumbnailSmallUrlNonsquared
        || thumb.thumbnailSmallUrl
        || thumb.fileThumbnailLarge
        || thumb.fileThumbnail
        || null
    );
}

function bkAssetIsDownloadable(item) {
    if (!item) return false;
    if (item.canDownload === true) return true;
    if (item.isFree === true) return true;
    const access = String(item.access || item.accessLabel || '').toLowerCase();
    return access === 'free' || access === 'free download';
}

function bkAccessLabel(item) {
    if (!item) return null;
    if (item.isFree === true) return 'Free';
    if (item.canDownload === true) return 'Included';
    return 'Subscription';
}

function pickModelDownload(files = []) {
    const list = asArray(files);
    const score = (f) => {
        const t = String(f.fileType || '').toLowerCase();
        const n = String(f.filename || '').toLowerCase();
        const u = String(f.downloadUrl || f.url || '').toLowerCase();
        const looks = /\.(glb|gltf)($|\?)/i.test(n) || /\.(glb|gltf)($|\?)/i.test(u)
            || t === 'gltf' || t === 'gltf_godot' || t.includes('gltf');
        if (!looks) return 0;
        if (t === 'gltf') return 5;
        if (n.endsWith('.glb') || u.includes('.glb')) return 4;
        if (t === 'gltf_godot') return 2;
        return 1;
    };
    return [...list].sort((a, b) => score(b) - score(a)).find((f) => score(f) > 0) || null;
}

/*
 * `assetBaseId` first, deliberately.
 *
 * BlenderKit's search endpoint can be queried by `asset_base_id:<uuid>` and
 * cannot be queried by the numeric `id`. Handing out the numeric id means
 * every later lookup for that row returns zero results, which is exactly how
 * a drawer full of BlenderKit models ends up reporting "BlenderKit no longer
 * lists that asset" for assets it is still listing.
 */
function bkAssetId(item) {
    if (item?.assetBaseId != null) return String(item.assetBaseId);
    if (item?.id != null) return String(item.id);
    return null;
}

/** Public gallery page — never link to `/api/v1/assets/...` (Django REST HTML). */
function bkPublicAssetUrl(item) {
    const id = bkAssetId(item);
    if (id) return `https://www.blenderkit.com/asset/${encodeURIComponent(id)}/`;
    const raw = item?.webPath || item?.url || null;
    if (!raw) return 'https://www.blenderkit.com/hdr';
    const s = String(raw);
    if (/^https?:\/\//i.test(s)) {
        if (/\/api\/v1\//i.test(s)) return 'https://www.blenderkit.com/hdr';
        return s;
    }
    if (String(s).startsWith('/api/')) return 'https://www.blenderkit.com/hdr';
    return `https://www.blenderkit.com${s.startsWith('/') ? s : `/${s}`}`;
}

/** BlenderKit HDRs are usually OpenEXR per resolution (`resolution_1K`, …), not `.hdr`. */
function pickHdriDownload(files = []) {
    const list = asArray(files);
    const resPriority = ['resolution_1k', 'resolution_2k', 'resolution_0_5k', 'resolution_4k', 'resolution_8k', 'blend'];
    const score = (f) => {
        const t = String(f.fileType || '').toLowerCase();
        const n = String(f.filename || '').toLowerCase();
        const u = String(f.downloadUrl || f.url || '').toLowerCase();
        if (t === 'thumbnail' || /\.png($|\?)/i.test(n)) return 0;
        if (!f.downloadUrl && !f.url) return 0;
        if (/\.hdr($|\?)/i.test(n) || /\.hdr($|\?)/i.test(u)) return 100;
        if (/\.exr($|\?)/i.test(n) || /\.exr($|\?)/i.test(u)) {
            const idx = resPriority.indexOf(t);
            return idx >= 0 ? 90 - idx : 60;
        }
        if (/hdr|hdri/i.test(t)) return 40;
        return 0;
    };
    return [...list].sort((a, b) => score(b) - score(a)).find((f) => score(f) > 0) || null;
}

function normalizeModel(item) {
    const files = asArray(item?.files);
    const modelFile = pickModelDownload(files);
    const hasGltf = Boolean(modelFile?.downloadUrl || modelFile?.url);
    const canUseBridge = Boolean(hasGltf && bkAssetIsDownloadable(item));
    const sourceAssetId = bkAssetId(item);
    const viewerUrl = bkPublicAssetUrl(item);
    return {
        assetType: 'model',
        source: 'blenderkit',
        sourceLabel: 'BlenderKit',
        sourceAssetId,
        name: item?.name || 'Untitled',
        description: String(item?.description || '').slice(0, 320),
        thumbnailUrl: pickThumb(files),
        viewerUrl,
        purchaseUrl: viewerUrl,
        // Direct CDN URLs expire — editor always loads via `/asset-store/blenderkit/model/:id`.
        modelUrl: null,
        /*
         * The `/api/v1/downloads/<n>/` endpoint for this row's glTF file.
         *
         * Kept so resolving a row is one call to that endpoint rather than a
         * fresh search followed by a second call. It is not a CDN URL and does
         * not expire; it is exchanged for a short-lived signed one at the
         * moment somebody actually drops the model into the scene.
         */
        downloadApiUrl: modelFile?.downloadUrl || modelFile?.url || null,
        loadableInScene: canUseBridge,
        accessLabel: bkAccessLabel(item),
        accessTier: item?.isFree === true ? 'free' : 'paid',
        format: hasGltf
            ? (/\.gltf($|\?)/i.test(String(modelFile?.filename || modelFile?.downloadUrl || '')) ? 'gltf' : 'glb')
            : null,
        license: item?.license || null,
        categories: asArray(item?.category),
        tags: asArray(item?.tags).map((x) => String(x)),
        faceCount: null,
        applicableInEditor: canUseBridge,
    };
}

/** BlenderKit materials are .blend packs — not paintable in the web editor. */
function normalizeMaterial() {
    return null;
}

function normalizeHdri(item) {
    const files = asArray(item?.files);
    const hdri = pickHdriDownload(files);
    const hasHdr = Boolean(hdri?.downloadUrl || hdri?.url);
    const canUseBridge = Boolean(hasHdr && bkAssetIsDownloadable(item));
    const sourceAssetId = bkAssetId(item);
    const viewerUrl = bkPublicAssetUrl(item);
    return {
        assetType: 'hdri',
        source: 'blenderkit',
        sourceLabel: 'BlenderKit',
        sourceAssetId,
        name: item?.name || 'Untitled HDRI',
        description: String(item?.description || '').slice(0, 320),
        thumbnailUrl: pickThumb(files),
        viewerUrl,
        purchaseUrl: viewerUrl,
        hdriUrl: null,
        // Same exchange as a model: a stable per-file endpoint traded for a
        // signed CDN link at the moment the environment is actually applied.
        downloadApiUrl: hdri?.downloadUrl || hdri?.url || null,
        loadableInScene: canUseBridge,
        accessLabel: bkAccessLabel(item),
        accessTier: item?.isFree === true ? 'free' : 'paid',
        license: item?.license || null,
        categories: asArray(item?.category),
        tags: asArray(item?.tags).map((x) => String(x)),
        applicableInEditor: canUseBridge,
    };
}

async function queryAssets(assetType, query) {
    const q = String(query || '').trim();
    const tokenPresent = Boolean(getToken());
    let qWithFreeFilter = q;
    if (assetType === 'hdr') {
        qWithFreeFilter = q ? `${q} is_free:true` : 'is_free:true';
    } else if (!tokenPresent && assetType === 'model') {
        qWithFreeFilter = q ? `${q} is_free:true` : 'is_free:true';
    }
    const search = qWithFreeFilter
        ? `query=${encodeURIComponent(qWithFreeFilter)}+asset_type:${assetType}`
        : `query=asset_type:${assetType}`;
    const url = `${API_BASE}/search/?${search}&page_size=${PAGE_SIZE}`;
    const payload = await safeFetchJson(url);
    return asArray(payload?.results);
}

async function search(category, query) {
    if (category === 'models') {
        const rows = await queryAssets('model', query);
        console.log(`[BlenderKit] models ${rows.length} rows`);
        return rows.map(normalizeModel).filter((r) => r.sourceAssetId);
    }
    if (category === 'materials') {
        // Materials are Blender .blend libraries — use Poly Haven / ambientCG in the Materials tab.
        return [];
    }
    if (category === 'hdris') {
        const rows = await queryAssets('hdr', query);
        return rows.map(normalizeHdri).filter((r) => r.sourceAssetId && r.loadableInScene);
    }
    return [];
}

/** Normalize a single BlenderKit search row for API clients (BlenderKit tab). */
function normalizeSearchRow(item, assetType) {
    const t = String(assetType || 'model').toLowerCase();
    if (t === 'material' || t === 'materials') return null;
    if (t === 'hdr' || t === 'hdris') return normalizeHdri(item);
    return normalizeModel(item);
}

module.exports = {
    categories: ['models', 'materials', 'hdris'],
    search,
    normalizeSearchRow,
    normalizeModel,
    normalizeHdri,
};
