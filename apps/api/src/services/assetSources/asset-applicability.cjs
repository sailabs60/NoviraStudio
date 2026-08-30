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
