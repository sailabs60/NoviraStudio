/**
 * BlenderKit as an asset source.
 *
 * Poly Haven is excellent but small — 521 models, only a fraction of which are
 * event furniture — and it leaves whole categories of the catalogue empty.
 * BlenderKit is the largest source that can actually be used here, because its
 * search and its download endpoint both work anonymously: the download call
 * needs a `scene_uuid` query parameter (any UUID) and returns a short-lived
 * signed URL to a real GLB. No API key, no OAuth.
 *
 * Two things are taken seriously here:
 *
 * 1. **Licensing.** Only assets the API marks free are considered, and the
 *    licence and author are recorded on every item so attribution survives into
 *    the catalogue. Anything else is skipped rather than quietly ingested.
 *
 * 2. **Identity.** Asset titles on a community site are unreliable — a listing
 *    called "chair" may be a chair, a room containing a chair, or something
 *    else entirely. Nothing here decides what an asset *is*; that stays with
 *    `assetClassifier` (head-noun analysis) and `assetVerification`
 *    (dimensions, geometry, materials), exactly as for Poly Haven.
 */
import { randomUUID } from 'node:crypto';

const API_BASE = 'https://www.blenderkit.com/api/v1';
const TIMEOUT_MS = 20_000;
const USER_AGENT = 'Novira/0.1 (event-planning asset pipeline)';

export interface BlenderKitFile {
  fileType: string;
  fileThumbnail?: string;
  fileThumbnailLarge?: string;
  downloadUrl?: string;
}

export interface BlenderKitAsset {
  assetBaseId: string;
  id: string;
  name: string;
  description?: string;
  assetType: string;
  isFree: boolean;
  license: string;
  /** Display name of the uploader. */
  author?: { firstName?: string; lastName?: string; id?: number };
  thumbnailMiddleUrl?: string;
  thumbnailLargeUrl?: string;
  files?: BlenderKitFile[];
  /** BlenderKit's own dimension hint, in metres, when present. */
  dimensions?: number[];
  category?: string;
  tags?: string[];
}

async function getJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search models.
 *
 * `query` is BlenderKit's own search string. Results are filtered to free
 * models that actually ship a glTF — a `.blend`-only asset is useless to a web
 * renderer, and converting Blender files is out of scope.
 */
export async function search(query: string, pageSize = 60): Promise<BlenderKitAsset[]> {
  const url =
    `${API_BASE}/search/?query=${encodeURIComponent(`${query} asset_type:model`)}` +
    `&page_size=${pageSize}`;
  const data = await getJson<{ results?: BlenderKitAsset[] }>(url);
  const results = data?.results ?? [];
  return results.filter(
    (asset) =>
      asset.isFree &&
      asset.assetType === 'model' &&
      (asset.files ?? []).some((f) => f.fileType === 'gltf' && f.downloadUrl)
  );
}

/**
 * Resolve an asset's glTF to a downloadable URL.
 *
 * The `scene_uuid` parameter is what makes this work without credentials;
 * without it the endpoint answers 403. The returned URL is signed and expires,
 * so it must be fetched promptly rather than stored.
 */
export async function resolveModelUrl(asset: BlenderKitAsset): Promise<string | null> {
  const file = (asset.files ?? []).find((f) => f.fileType === 'gltf' && f.downloadUrl);
  if (!file?.downloadUrl) return null;

  const separator = file.downloadUrl.includes('?') ? '&' : '?';
  const resolved = await getJson<{ filePath?: string }>(
    `${file.downloadUrl}${separator}scene_uuid=${randomUUID()}`
  );
  return resolved?.filePath ?? null;
}

/** Best available preview image for an asset. */
export function thumbnailUrl(asset: BlenderKitAsset): string | null {
  if (asset.thumbnailLargeUrl) return asset.thumbnailLargeUrl;
  if (asset.thumbnailMiddleUrl) return asset.thumbnailMiddleUrl;
  const file = (asset.files ?? []).find((f) => f.fileType === 'thumbnail');
  return file?.fileThumbnailLarge ?? file?.fileThumbnail ?? null;
}

/** Human-readable attribution, as the licence requires. */
export function attributionFor(asset: BlenderKitAsset): string {
  const author = [asset.author?.firstName, asset.author?.lastName].filter(Boolean).join(' ').trim();
  const who = author || 'BlenderKit contributor';
  return `${asset.name} by ${who} (BlenderKit, ${asset.license})`;
}

export function sourceUrlFor(asset: BlenderKitAsset): string {
  return `https://www.blenderkit.com/asset-gallery-detail/${asset.assetBaseId}/`;
}

/**
 * Licences we are willing to ingest.
 *
 * BlenderKit's free tier is predominantly `royalty_free` and CC0-family
 * licences. Anything outside this list is skipped rather than guessed at,
 * because getting licensing wrong in a commercial product is not recoverable.
 */
const ACCEPTED_LICENCES = new Set(['royalty_free', 'cc0', 'cc-0', 'public_domain']);

export function licenceAcceptable(asset: BlenderKitAsset): boolean {
  return ACCEPTED_LICENCES.has((asset.license ?? '').toLowerCase());
}
