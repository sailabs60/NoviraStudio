/**
 * Turning a search row into a file the viewport can load.
 *
 * Most libraries do not put a download URL in their search results, and for
 * good reason: the link is signed, it expires, and handing one out per row
 * would mean minting thousands of them for models nobody opens. So a row says
 * *whether* it can be loaded, and the URL is fetched the moment someone
 * actually wants it.
 *
 * That second step is what this module is. Each provider needs a different
 * shape of request, several need a key, and every one of them can refuse — so
 * the result is deliberately a small union that distinguishes "here it is",
 * "you can have it but not from us", and "this needs a key the server does not
 * have". The UI shows a different affordance for each, which is the only way
 * a designer is never surprised by a button that does nothing.
 */
import { randomUUID } from 'node:crypto';

const TIMEOUT_MS = 20_000;
const UA = 'Novira/1.0 (asset resolver)';

export type ResolvedAsset =
  | { status: 'ready'; url: string; format: 'glb' | 'gltf' | 'zip'; expiresInSec?: number }
  | { status: 'external'; url: string; reason: string }
  | { status: 'unavailable'; reason: string };

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': UA, ...headers },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Sketchfab ─────────────────────────────────────────────────────────── */

interface SketchfabDownload {
  gltf?: { url?: string; size?: number; expires?: number };
  glb?: { url?: string; size?: number; expires?: number };
}

/**
 * Sketchfab's download endpoint needs an account token, and the account has to
 * have accepted the model's licence. Both failure modes are reported as
 * "external" rather than "unavailable", because the model genuinely is
 * obtainable — just not by this server on this user's behalf.
 */
async function resolveSketchfab(uid: string, viewerUrl?: string): Promise<ResolvedAsset> {
  const token = (process.env.SKETCHFAB_API_TOKEN ?? '').trim();
  const fallback = viewerUrl ?? `https://sketchfab.com/3d-models/${uid}`;
  if (!token) {
    return {
      status: 'external',
      url: fallback,
      reason: 'Sketchfab downloads need an account. Open it there, then import the file.',
    };
  }

  const payload = await getJson<SketchfabDownload>(
    `https://api.sketchfab.com/v3/models/${encodeURIComponent(uid)}/download`,
    { Authorization: `Token ${token}` }
  );

  const glb = payload?.glb?.url;
  if (glb) return { status: 'ready', url: glb, format: 'glb', expiresInSec: payload?.glb?.expires };
  const gltf = payload?.gltf?.url;
  // The glTF download is a zip of the whole asset directory.
  if (gltf) return { status: 'ready', url: gltf, format: 'zip', expiresInSec: payload?.gltf?.expires };

  return {
    status: 'external',
    url: fallback,
    reason: 'This model is not downloadable with the configured Sketchfab account.',
  };
}

/* ── BlenderKit ────────────────────────────────────────────────────────── */

interface BlenderKitFile {
  fileType?: string;
  downloadUrl?: string;
}
interface BlenderKitRow {
  assetBaseId?: string;
  name?: string;
  isFree?: boolean;
  files?: BlenderKitFile[];
}

/**
 * BlenderKit resolves without credentials, but only with a `scene_uuid` on the
 * request — without it the signed-URL endpoint answers 403. The URL that comes
 * back expires, which is why it is fetched here at click time rather than
 * cached with the row.
 */
async function resolveBlenderKit(assetBaseId: string): Promise<ResolvedAsset> {
  const search = await getJson<{ results?: BlenderKitRow[] }>(
    `https://www.blenderkit.com/api/v1/search/?query=asset_base_id:${encodeURIComponent(assetBaseId)}&page_size=1`
  );
  const row = search?.results?.[0];
  if (!row) {
    return { status: 'unavailable', reason: 'BlenderKit no longer lists that asset.' };
  }
  if (row.isFree === false) {
    return {
      status: 'external',
      url: `https://www.blenderkit.com/asset-gallery-detail/${assetBaseId}/`,
      reason: 'This asset is part of BlenderKit’s paid library.',
    };
  }

  const file = (row.files ?? []).find((f) => f.fileType === 'gltf' && f.downloadUrl);
  if (!file?.downloadUrl) {
    return {
      status: 'external',
      url: `https://www.blenderkit.com/asset-gallery-detail/${assetBaseId}/`,
      reason: 'BlenderKit publishes this one only as a Blender file.',
    };
  }

  const separator = file.downloadUrl.includes('?') ? '&' : '?';
  const resolved = await getJson<{ filePath?: string }>(
    `${file.downloadUrl}${separator}scene_uuid=${randomUUID()}`
  );
  if (!resolved?.filePath) {
    return { status: 'unavailable', reason: 'BlenderKit refused the download link.' };
  }
  return { status: 'ready', url: resolved.filePath, format: 'gltf' };
}

/* ── Poly Pizza ────────────────────────────────────────────────────────── */

/**
 * Poly Pizza's public API hands back a direct GLB, but only with a key. Its
 * search rows already carry the URL when one is available, so reaching here
 * means the row was viewer-only.
 */
async function resolvePolyPizza(id: string, viewerUrl?: string): Promise<ResolvedAsset> {
  const key = (process.env.POLY_PIZZA_API_KEY ?? '').trim();
  const fallback = viewerUrl ?? `https://poly.pizza/m/${id}`;
  if (!key) {
    return {
      status: 'external',
      url: fallback,
      reason: 'Poly Pizza downloads need an API key on the server.',
    };
  }
  const payload = await getJson<{ Download?: string }>(
    `https://api.poly.pizza/v1.1/model/${encodeURIComponent(id)}`,
    { 'x-auth-token': key }
  );
  if (payload?.Download) return { status: 'ready', url: payload.Download, format: 'glb' };
  return { status: 'external', url: fallback, reason: 'That model has no direct download.' };
}

/* ── The door ──────────────────────────────────────────────────────────── */

export interface ResolveRequest {
  source: string;
  sourceAssetId: string;
  /** Already-known direct URL, when the search row carried one. */
  modelUrl?: string | null;
  viewerUrl?: string | null;
}

export async function resolveAsset(req: ResolveRequest): Promise<ResolvedAsset> {
  // Providers that publish a direct URL in the search row need nothing further.
  if (req.modelUrl) {
    const format = /\.glb(\?|$)/i.test(req.modelUrl)
      ? 'glb'
      : /\.zip(\?|$)/i.test(req.modelUrl)
        ? 'zip'
        : 'gltf';
    return { status: 'ready', url: req.modelUrl, format };
  }

  switch (req.source.toLowerCase()) {
    case 'sketchfab':
      return resolveSketchfab(req.sourceAssetId, req.viewerUrl ?? undefined);
    case 'blenderkit':
      return resolveBlenderKit(req.sourceAssetId);
    case 'polypizza':
      return resolvePolyPizza(req.sourceAssetId, req.viewerUrl ?? undefined);
    default:
      return req.viewerUrl
        ? {
            status: 'external',
            url: req.viewerUrl,
            reason: 'This library does not offer a direct download.',
          }
        : { status: 'unavailable', reason: 'No download is published for this asset.' };
  }
}
