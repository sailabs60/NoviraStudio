/**
 * Whether an asset can be used inside the Novira web editor (not just browsed externally).
 */

function hasMaterialMaps(asset) {
    const maps = asset?.materialMaps;
    return Boolean(maps && typeof maps === 'object' && Object.values(maps).some(Boolean));
}

function blenderKitPurchaseUrl(asset) {
    const viewer = asset?.viewerUrl ? String(asset.viewerUrl) : '';
    if (viewer && !/\/api\/v1\//i.test(viewer)) return viewer;
    if (asset?.sourceAssetId) {
        return `https://www.blenderkit.com/asset/${encodeURIComponent(String(asset.sourceAssetId))}/`;
    }
    return 'https://www.blenderkit.com/plans/pricing';
}

function isApplicableInEditor(asset) {
    if (!asset) return false;
    const type = String(asset.assetType || '').toLowerCase();

    if (type === 'material') {
        return hasMaterialMaps(asset);
    }
    if (type === 'hdri') {
        if (asset.source === 'blenderkit') {
            return Boolean(asset.loadableInScene && asset.sourceAssetId);
        }
        return Boolean(asset.loadableInScene || asset.hdriUrl);
    }
    if (type === 'model') {
        if (asset.source === 'blenderkit') {
            return Boolean(asset.loadableInScene && asset.sourceAssetId);
        }
        return Boolean(asset.loadableInScene || asset.modelUrl);
    }
    /*
     * An image is usable when there is an image to use.
     *
     * No image provider sets `loadableInScene` — the flag exists for models
     * and environments — so falling through to it filtered out every single
     * photograph whenever the "usable only" filter was on, which is the
     * default the asset drawer opens with. The drawer showed an empty
     * Images tab while the providers were returning hundreds of rows.
     */
    if (type === 'image') {
        return Boolean(asset.imageUrl || asset.thumbnailUrl);
    }
    return Boolean(asset.loadableInScene);
}

function enrichPurchaseUrl(asset) {
    if (!asset || asset.purchaseUrl) return asset;
    if (asset.source === 'blenderkit' && !isApplicableInEditor(asset)) {
        return { ...asset, purchaseUrl: blenderKitPurchaseUrl(asset) };
    }
    if (asset.source === 'sketchfab' && !asset.loadableInScene && asset.viewerUrl) {
        return { ...asset, purchaseUrl: asset.viewerUrl };
    }
    return asset;
}

function filterApplicableOnly(assets) {
    return (Array.isArray(assets) ? assets : [])
        .map(enrichPurchaseUrl)
        .filter(isApplicableInEditor);
}

module.exports = {
    hasMaterialMaps,
    isApplicableInEditor,
    enrichPurchaseUrl,
    filterApplicableOnly,
    blenderKitPurchaseUrl,
};
