const TIMEOUT_MS = 25000;
const REPO = 'nasa/NASA-3D-Resources';
const PRINTING_PATH = '3D Printing';

const githubHeaders = () => {
    const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'Novira/1.0 asset-registry' };
    if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    return h;
};

/** Prefer a PNG/JPEG in the same GitHub folder as the mesh (NASA often ships a render next to the STL/GLB). */
function pickThumbnailFromContents(sub, dirName) {
    if (!Array.isArray(sub) || !dirName) return null;
    const images = sub.filter(
        (f) => f.type === 'file' && f.download_url && /\.(png|jpe?g|webp)$/i.test(f.name)
    );
    if (!images.length) return null;

    const lowerDir = String(dirName).toLowerCase();
    const dirSlug = lowerDir.replace(/[^a-z0-9]+/g, '');
    const scored = images.map((img) => {
        let score = 0;
        const n = String(img.name).toLowerCase();
        const base = n.replace(/\.(png|jpe?g|webp)$/i, '');

        if (n === `${lowerDir}.png` || n === `${lowerDir}.jpg` || n === `${lowerDir}.jpeg` || n === `${lowerDir}.webp`) {
            score += 220;
        } else if (base === lowerDir || base.replace(/[^a-z0-9]+/g, '') === dirSlug) {
            score += 180;
        } else if (lowerDir.length >= 4 && n.includes(lowerDir.slice(0, Math.min(28, lowerDir.length)))) {
            score += 90;
        } else if (dirSlug.length >= 6 && base.replace(/[^a-z0-9]+/g, '').includes(dirSlug.slice(0, 12))) {
            score += 55;
        } else {
            const firstTok = lowerDir.split(/[^a-z0-9]+/).filter((w) => w.length >= 4)[0];
            if (firstTok && (n.startsWith(firstTok) || base.startsWith(firstTok))) score += 65;
        }

        if (/preview|thumb|render|image|photo|screenshot/i.test(img.name)) score += 35;
        if (/\.png$/i.test(img.name)) score += 12;
        if (/\.jpe?g$/i.test(img.name)) score += 6;

        const sz = Number(img.size) || 0;
        score += Math.min(40, sz / 80000);

        return { img, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].img.download_url;
}

const safeFetchJson = async (url, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal, headers: githubHeaders() });
        if (!res.ok) {
            console.warn(`[NASA3D] HTTP ${res.status} ${url}`);
            return null;
        }
        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') console.warn(`[NASA3D] ${err.message}`);
        return null;
    } finally {
        clearTimeout(timeout);
    }
};

/**
 * Lists NASA public-domain 3D assets from GitHub (3D Printing folder).
 * Optional GITHUB_TOKEN raises rate limits. GLB preferred; STL listed as view/download via modelUrl.
 */
async function search(category, query) {
    if (category !== 'models') return [];

    const baseUrl = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(PRINTING_PATH)}`;
    const list = await safeFetchJson(baseUrl);
    if (!Array.isArray(list)) return [];

    const q = String(query || '').trim().toLowerCase();
    const words = q.split(/\s+/).filter(w => w.length > 2);

    let dirs = list.filter(e => e.type === 'dir' && e.name);
    if (words.length) {
        dirs = dirs.filter(d => words.some(w => d.name.toLowerCase().includes(w)));
    }
    const maxDirs = Math.max(4, parseInt(process.env.NASA3D_MAX_FOLDERS, 10) || 14);
    dirs = dirs.slice(0, maxDirs);

    const out = [];
    for (const dir of dirs) {
        if (!dir.url) continue;
        const sub = await safeFetchJson(dir.url, 12000);
        if (!Array.isArray(sub)) continue;

        const glb = sub.find(f => f.type === 'file' && /\.glb$/i.test(f.name));
        const gltf = sub.find(f => f.type === 'file' && /\.gltf$/i.test(f.name));
        const stl = sub.find(f => f.type === 'file' && /\.stl$/i.test(f.name));
        const file = glb || gltf || stl;
        if (!file?.download_url) continue;

        const isGlb = Boolean(glb);
        const isGltf = Boolean(gltf);
        const thumbnailUrl = pickThumbnailFromContents(sub, dir.name);
        out.push({
            assetType: 'model',
            source: 'nasa3d',
            sourceLabel: 'NASA 3D Resources',
            sourceAssetId: dir.name.replace(/[^\w-]+/g, '_').slice(0, 120),
            name: dir.name,
            description: 'NASA public-domain 3D resource (GitHub).',
            thumbnailUrl,
            viewerUrl: `https://github.com/${REPO}/tree/master/${PRINTING_PATH}/${encodeURIComponent(dir.name)}`,
            modelUrl: file.download_url,
            loadableInScene: Boolean(file.download_url),
            format: isGlb ? 'glb' : (isGltf ? 'gltf' : 'stl'),
            license: 'Public Domain (NASA)',
            categories: ['space', 'science'],
            tags: ['nasa', 'space'],
            faceCount: null
        });
    }

    console.log(`[NASA3D] → ${out.length} models (${dirs.length} folders scanned)`);
    return out;
}

module.exports = {
    categories: ['models'],
    search
};
