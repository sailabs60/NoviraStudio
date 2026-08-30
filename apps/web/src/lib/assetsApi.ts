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

  resolve: async (asset: Pick<ProviderAsset, 'source' | 'sourceAssetId' | 'modelUrl' | 'viewerUrl'>): Promise<ResolvedAsset> => {
    const { data } = await http.post<ResolvedAsset>('/assets/resolve', {
      source: asset.source,
      sourceAssetId: asset.sourceAssetId,
      modelUrl: asset.modelUrl ?? null,
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
  if (url.startsWith('/') || url.startsWith('data:') || url.startsWith('blob:')) return url;
  return `/api/assets/proxy?url=${encodeURIComponent(url)}`;
}
