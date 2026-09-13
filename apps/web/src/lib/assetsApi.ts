import type { CatalogItemDto } from '@novira/shared';
import { http } from './api';

/**
 * The online asset libraries, from the browser.
 *
 * Everything here is designed around one promise the brief makes: a designer
 * scrolling a library should never be waiting. That shapes three things —
 * pages are small and consistent, the next page is fetched before the current
 * one runs out, and a preview never waits on a download.
 */

export type AssetCategory = 'models' | 'materials' | 'hdris' | 'images';

export interface ProviderAsset {
  assetType: 'model' | 'material' | 'hdri' | 'image';
  source: string;
  sourceLabel: string;
  sourceAssetId: string;
  name: string;
  description?: string;
  thumbnailUrl?: string | null;
  viewerUrl?: string | null;
  modelUrl?: string | null;
  /** Provider endpoint the server exchanges for a signed download URL. */
  downloadApiUrl?: string | null;
  hdriUrl?: string | null;
  materialMaps?: Record<string, string | null> | null;
  imageUrl?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  license?: string | null;
  attribution?: string | null;
  categories?: string[];
  tags?: string[];
  loadableInScene?: boolean;
  applicableInEditor?: boolean;
  accessTier?: 'free_download' | 'licensed' | 'requires_purchase' | 'external_only';
  accessLabel?: string;
  purchaseUrl?: string | null;
  faceCount?: number | null;
  triangleCount?: number | null;
  /**
   * For a plain-JSON glTF (as opposed to a packed `.glb`): every sibling file
   * it references by relative path — its geometry buffer and its textures —
   * mapped to where each one actually lives. Poly Haven's model format is
   * exactly this shape. Carried through import so the server can fetch the
   * whole bundle rather than just the JSON, which loads and then 404s on its
   * own buffer.
   */
  gltfIncludes?: Record<string, string> | null;
}

export interface AssetPage {
  items: ProviderAsset[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  applicableOnly: boolean;
}

export interface Shelf {
  key: string;
  label: string;
  category: AssetCategory;
  query: string;
  note: string;
}

export interface ProviderInfo {
  key: string;
  label: string;
  supplies: AssetCategory[];
  note: string;
  keyEnv: string | null;
  configured: boolean;
  homepage: string;
}

export type ResolvedAsset =
  | { status: 'ready'; url: string; format: 'glb' | 'gltf' | 'zip'; expiresInSec?: number }
  | { status: 'external'; url: string; reason: string }
  | { status: 'unavailable'; reason: string };

export const assets = {
  search: async (params: {
    category: AssetCategory;
    q?: string;
    offset?: number;
    limit?: number;
    usable?: boolean;
  }): Promise<AssetPage> => {
    const { data } = await http.get<AssetPage>('/assets/search', {
      params: {
        category: params.category,
        q: params.q || undefined,
        offset: params.offset ?? 0,
        limit: params.limit ?? 48,
        usable: params.usable === undefined ? undefined : String(params.usable),
      },
    });
    return data;
  },

  shelves: async (category?: AssetCategory): Promise<Shelf[]> => {
    const { data } = await http.get<{ items: Shelf[] }>('/assets/shelves', { params: { category } });
    return data.items;
  },

  providers: async (): Promise<{ items: ProviderInfo[]; activeCount: number; totalCount: number }> => {
    const { data } = await http.get('/assets/providers');
    return data;
  },

  resolve: async (
    asset: Pick<
      ProviderAsset,
      'source' | 'sourceAssetId' | 'modelUrl' | 'downloadApiUrl' | 'viewerUrl'
    >
  ): Promise<ResolvedAsset> => {
    const { data } = await http.post<ResolvedAsset>('/assets/resolve', {
      source: asset.source,
      sourceAssetId: asset.sourceAssetId,
      modelUrl: asset.modelUrl ?? null,
      // Without this a BlenderKit row falls back to a search by id, which is
      // both slower and how these stopped resolving in the first place.
      downloadApiUrl: asset.downloadApiUrl ?? null,
      viewerUrl: asset.viewerUrl ?? null,
    });
    return data;
  },

  /** Pull an online model into the user's own library as a real catalogue row. */
  import: async (asset: ProviderAsset, categorySlug?: string): Promise<{ item: CatalogItemDto; reused: boolean }> => {
    const { data } = await http.post('/assets/import', {
      source: asset.source,
      sourceAssetId: asset.sourceAssetId,
      name: asset.name,
      modelUrl: asset.modelUrl ?? null,
      previewImage: asset.thumbnailUrl ?? null,
      viewerUrl: asset.viewerUrl ?? null,
      sourceLabel: asset.sourceLabel ?? null,
      license: asset.license ?? null,
      attribution: asset.attribution ?? null,
      description: asset.description ?? null,
      tags: asset.tags?.slice(0, 40) ?? [],
      categorySlug: categorySlug ?? null,
      gltfIncludes: asset.gltfIncludes ?? null,
    });
    return data;
  },

  imported: async (): Promise<CatalogItemDto[]> => {
    const { data } = await http.get<{ items: CatalogItemDto[] }>('/assets/imported');
    return data.items;
  },

  removeImported: async (id: number): Promise<void> => {
    await http.delete(`/assets/imported/${id}`);
  },
};

/**
 * Route a remote URL through our own origin.
 *
 * Providers rarely send CORS headers, and a browser treats a missing header as
 * a refusal — so a texture that loads perfectly in a new tab fails silently in
 * a canvas. Anything that will be *read* by WebGL or a canvas has to come
 * through here; a plain `<img>` on the page does not, which is why thumbnails
 * are left alone and only the pixels we sample are proxied.
 */
export function proxied(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  /*
   * Anything already reachable without the proxy is left exactly as it is.
   *
   * This is not only an optimisation. The proxy refuses localhost and private
   * addresses — it has to, or an authenticated open proxy becomes a
   * server-side request forgery — so routing our *own* asset URLs through it
   * turns a working file into a 403. In development the API serves generated
   * models from `http://localhost:4100/static/...`, which is a different origin
   * from the Vite dev server on 5174 and therefore looks remote; it is not.
   *
   * So the test is "will a browser fetch this without complaint", answered by
   * comparing origins, rather than "does it start with a slash".
   */
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (isSameOrigin(url)) return url;
  // Double-wrapping a proxy URL produces a request for a request.
  if (url.includes('/api/assets/proxy')) return url;
  /*
   * Our own API on another port, which is the development setup.
   *
   * Vite proxies `/api` and `/static` through to the API server, so the path
   * alone is same-origin from the browser's point of view — and the file is
   * ours, so there is nothing to protect against.
   */
  const local = localApiPath(url);
  if (local) return local;
  return `/api/assets/proxy?url=${encodeURIComponent(url)}`;
}

/**
 * Our own API's URL, reduced to the path the page can fetch directly.
 *
 * The API advertises absolute URLs for the files it stores, built from
 * `PUBLIC_BASE_URL`. In production that is the same host as the site and
 * `isSameOrigin` catches it; in development it is a second port, which looks
 * cross-origin but is proxied by Vite at `/static` and `/api`. Returning the
 * bare path uses that proxy instead of ours.
 */
function localApiPath(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const servedByUs = parsed.pathname.startsWith('/static/') || parsed.pathname.startsWith('/api/');
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (servedByUs && loopback) return `${parsed.pathname}${parsed.search}`;
  } catch {
    /* not a URL we can read — fall through to the proxy */
  }
  return undefined;
}

/**
 * The same, for anything WebGL will fetch — models above all.
 *
 * ## Why a model needs this even more than a texture does
 *
 * A cross-origin image that a canvas merely *displays* is fine; one it reads
 * pixels from is not. A **model** is always the second case: three.js fetches
 * the glTF with `fetch`, so a provider that sends no `Access-Control-Allow-Origin`
 * header fails outright — and it fails *inside the loader's own async callback*,
 * where no React error boundary can reach it. On the deployed site that took
 * the WebGL context down with it, so one generated asset with an expiring
 * signed URL blanked the entire editor.
 *
 * Generated assets are exactly where this bites. Tripo hands back a signed
 * CloudFront URL with no CORS headers and a deadline on it, and that URL was
 * being written straight into the scene document — so the plan was one
 * unopenable link away from a white screen, forever.
 *
 * ## Why it is applied at the loader rather than at the call sites
 *
 * Because the bad URLs are already saved. Plans written before this fix carry
 * raw provider URLs in their documents, and fixing only the places that *create*
 * placements would leave every one of those still crashing. Routing at the
 * point of loading covers the ones already in the database as well as the ones
 * made from here on.
 */
export function proxiedModel(url: string | null | undefined): string | undefined {
  return proxied(url);
}

/**
 * Is this URL one a browser will fetch cross-origin without complaint?
 *
 * Our own origin and inline data are always safe. Everything else has to go
 * through the proxy before it is handed to a loader or a reachability check —
 * a cross-origin HEAD is refused by the same policy that refuses the GET, so
 * checking the raw URL answers "broken" for assets that are perfectly fine.
 */
export function isSameOrigin(url: string): boolean {
  if (url.startsWith('/') || url.startsWith('data:') || url.startsWith('blob:')) return true;
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}
