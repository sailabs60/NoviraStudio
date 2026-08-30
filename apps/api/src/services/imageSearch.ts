/**
 * Online image search for the branding engine.
 *
 * Openverse aggregates the openly-licensed image collections (Flickr, Wikimedia,
 * museum collections, Smithsonian and others) behind one API that needs no key,
 * and — crucially — it reports the licence per result. That last part is why it
 * is the source here rather than a stock site: artwork placed in a client
 * proposal has to be safe to use commercially, and a source that will not tell
 * you the licence cannot be checked.
 *
 * Results are filtered to licences that permit commercial use. `by` and `by-sa`
 * additionally require attribution, so the creator and the licence travel with
 * the image into the scene document and out again into the proposal PDF.
 */
import { licenseAllowsCommercial } from '@novira/shared';

const API = 'https://api.openverse.org/v1';
const TIMEOUT_MS = 15_000;
const USER_AGENT = 'Novira/0.1 (event planning platform)';
/** Openverse refuses anonymous requests above this, with a 401. */
const MAX_ANONYMOUS_PAGE_SIZE = 20;

export interface ImageResult {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  width: number | null;
  height: number | null;
  creator: string | null;
  license: string;
  licenseVersion: string | null;
  licenseUrl: string | null;
  sourceUrl: string | null;
  provider: string | null;
  /** Ready-made credit line, in the form the licence expects. */
  attribution: string;
  /** False when the licence permits use without a credit. */
  attributionRequired: boolean;
}

interface OpenverseResult {
  id: string;
  title?: string;
  url?: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  creator?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url?: string;
  provider?: string;
  attribution?: string;
}

function creditLine(r: OpenverseResult): string {
  if (r.attribution) return r.attribution.replace(/\s+/g, ' ').trim();
  const parts = [r.title ?? 'Untitled'];
  if (r.creator) parts.push(`by ${r.creator}`);
  if (r.license) parts.push(`(${r.license.toUpperCase()}${r.license_version ? ` ${r.license_version}` : ''})`);
  return parts.join(' ');
}

export interface SearchOptions {
  query: string;
  page?: number;
  pageSize?: number;
  /** Restrict to images with an alpha channel, for cut-out logos and marks. */
  transparentOnly?: boolean;
  /** Narrow by aspect: banners and backdrops are wide, signage is tall. */
  orientation?: 'wide' | 'tall' | 'square';
}

export async function searchImages(options: SearchOptions): Promise<{
  results: ImageResult[];
  total: number;
  page: number;
}> {
  const { query, page = 1, pageSize = MAX_ANONYMOUS_PAGE_SIZE, transparentOnly = false, orientation } = options;

  const params = new URLSearchParams({
    q: query,
    page: String(page),
    page_size: String(Math.min(pageSize, MAX_ANONYMOUS_PAGE_SIZE)),
    // Ask Openverse for commercial-use, modifiable work up front; the per-result
    // check below is the real gate, this just improves the hit rate.
    license_type: 'commercial,modification',
    mature: 'false',
  });
  if (transparentOnly) params.set('extension', 'png,svg');
  if (orientation === 'wide') params.set('aspect_ratio', 'wide');
  if (orientation === 'tall') params.set('aspect_ratio', 'tall');
  if (orientation === 'square') params.set('aspect_ratio', 'square');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}/images/?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[openverse] HTTP ${res.status}: ${detail.slice(0, 200)}`);
      return { results: [], total: 0, page };
    }

    const data = (await res.json()) as { results?: OpenverseResult[]; result_count?: number };
    const results: ImageResult[] = [];

    for (const r of data.results ?? []) {
      // The licence gate is applied here rather than trusted from the query,
      // because a result with no licence recorded must not be usable.
      if (!licenseAllowsCommercial(r.license)) continue;
      if (!r.url) continue;

      const license = (r.license ?? '').toLowerCase();
      results.push({
        id: r.id,
        title: r.title?.trim() || 'Untitled',
        url: r.url,
        thumbnail: r.thumbnail ?? r.url,
        width: r.width ?? null,
        height: r.height ?? null,
        creator: r.creator ?? null,
        license,
        licenseVersion: r.license_version ?? null,
        licenseUrl: r.license_url ?? null,
        sourceUrl: r.foreign_landing_url ?? null,
        provider: r.provider ?? null,
        attribution: creditLine(r),
        // CC0 and public domain need no credit; BY and BY-SA do.
        attributionRequired: license !== 'cc0' && license !== 'pdm',
      });
    }

    return { results, total: data.result_count ?? results.length, page };
  } catch (err) {
    console.warn(`[openverse] request failed: ${err instanceof Error ? err.message : String(err)}`);
    return { results: [], total: 0, page };
  } finally {
    clearTimeout(timer);
  }
}
