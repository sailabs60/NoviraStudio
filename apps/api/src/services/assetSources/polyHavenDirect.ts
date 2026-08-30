/**
 * Poly Haven — direct download adapter.
 *
 * The primary catalogue source. Everything on Poly Haven is CC0, the models are
 * hand-authored rather than scraped, and the naming is disciplined
 * (`ArmChair_01`, `CoffeeTable_01`, `Chandelier_02`), which makes it far more
 * trustworthy than a general marketplace. It is also modelled at real-world
 * scale in metres, so the unit inference in `gltfInspect` almost always agrees
 * with the file rather than having to correct it.
 *
 * glTF here is a multi-file bundle (`.gltf` + `.bin` + textures). We mirror the
 * whole bundle onto our own storage preserving relative paths, so the loader
 * resolves textures without reaching back out to the provider — a model in a
 * saved plan must not break because an upstream URL moved.
 */
import { downloadToAssets } from '../storage.js';

const API = 'https://api.polyhaven.com';
const UA = 'Novira/1.0 (event asset pipeline)';

export interface PolyHavenAsset {
  slug: string;
  name: string;
  categories: string[];
  tags: string[];
  authors: string[];
  thumbnailUrl: string;
}

interface PolyHavenFileNode {
  url?: string;
  size?: number;
  md5?: string;
  include?: Record<string, { url: string; size: number; md5: string }>;
}

async function getJson<T>(url: string, timeoutMs = 60_000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: controller.signal });
    if (!res.ok) {
      console.warn(`[polyhaven] HTTP ${res.status} ${url}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[polyhaven] ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Every model in the library, with the metadata needed for classification. */
export async function listModels(): Promise<PolyHavenAsset[]> {
  const payload = await getJson<Record<string, {
    name?: string;
    categories?: string[];
    tags?: string[];
    authors?: Record<string, string>;
    thumbnail_url?: string;
  }>>(`${API}/assets?t=models`);
  if (!payload) return [];

  return Object.entries(payload).map(([slug, row]) => ({
    slug,
    // Poly Haven's `name` is a tidy human label; the slug is the id.
    name: row.name || slug.replace(/_/g, ' '),
    categories: row.categories ?? [],
    tags: row.tags ?? [],
    authors: Object.keys(row.authors ?? {}),
    thumbnailUrl: row.thumbnail_url ?? `https://cdn.polyhaven.com/asset_img/thumbs/${slug}.png?width=512`,
  }));
}

export interface DownloadedModel {
  /** Local path of the root .gltf, for inspection. */
  localPath: string;
  /** Public URL the web client loads. */
  modelUrl: string;
  totalBytes: number;
  fileCount: number;
}

/**
 * Mirror one model's glTF bundle.
 *
 * `resolution` trades texture size against download weight — 1k is the right
 * default for a browser-based planner that may hold hundreds of items in one
 * scene.
 */
export async function downloadModel(
  slug: string,
  resolution: '1k' | '2k' | '4k' = '1k'
): Promise<DownloadedModel | null> {
  const files = await getJson<Record<string, Record<string, Record<string, PolyHavenFileNode>>>>(
    `${API}/files/${encodeURIComponent(slug)}`
  );
  const gltfGroup = files?.gltf?.[resolution]?.gltf ?? files?.gltf?.['1k']?.gltf;
  if (!gltfGroup?.url) {
    console.warn(`[polyhaven] ${slug}: no glTF bundle at ${resolution}`);
    return null;
  }

  const base = `polyhaven/${slug}`;
  let totalBytes = 0;
  let fileCount = 0;

  // The .gltf references its .bin and textures by relative path; mirroring the
  // `include` map verbatim keeps those references valid on our own host.
  const includes = gltfGroup.include ?? {};
  for (const [relative, node] of Object.entries(includes)) {
    if (!node?.url) continue;
    try {
      const saved = await downloadToAssets(node.url, `${base}/${relative}`, { maxBytes: 60 * 1024 * 1024 });
      totalBytes += saved.size;
      fileCount += 1;
    } catch (err) {
      console.warn(`[polyhaven] ${slug}: dependency ${relative} failed — ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  try {
    const rootName = `${slug}.gltf`;
    const root = await downloadToAssets(gltfGroup.url, `${base}/${rootName}`, { maxBytes: 20 * 1024 * 1024 });
    totalBytes += root.size;
    fileCount += 1;
    return { localPath: root.path, modelUrl: root.url, totalBytes, fileCount };
  } catch (err) {
    console.warn(`[polyhaven] ${slug}: root glTF failed — ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/** HDRIs, for the lighting presets. */
export async function listHdris(): Promise<Array<{ slug: string; name: string }>> {
  const payload = await getJson<Record<string, { name?: string }>>(`${API}/assets?t=hdris`);
  if (!payload) return [];
  return Object.entries(payload).map(([slug, row]) => ({ slug, name: row.name || slug }));
}

export async function hdriUrl(slug: string, resolution = '1k'): Promise<string | null> {
  const files = await getJson<Record<string, Record<string, Record<string, PolyHavenFileNode>>>>(
    `${API}/files/${encodeURIComponent(slug)}`
  );
  return files?.hdri?.[resolution]?.hdr?.url ?? null;
}

/** PBR textures, for the material library. */
export interface PolyHavenTexture {
  slug: string;
  name: string;
  categories: string[];
  tags: string[];
}

export async function listTextures(): Promise<PolyHavenTexture[]> {
  const payload = await getJson<Record<string, {
    name?: string;
    categories?: string[];
    tags?: string[];
  }>>(`${API}/assets?t=textures`);
  if (!payload) return [];
  return Object.entries(payload).map(([slug, row]) => ({
    slug,
    name: row.name || slug.replace(/_/g, ' '),
    categories: row.categories ?? [],
    tags: row.tags ?? [],
  }));
}

export async function textureMaps(
  slug: string,
  resolution = '1k'
): Promise<Record<string, string> | null> {
  const files = await getJson<Record<string, Record<string, Record<string, PolyHavenFileNode>>>>(
    `${API}/files/${encodeURIComponent(slug)}`
  );
  if (!files) return null;
  const wanted: Record<string, string> = {};
  const pick = (key: string, mapName: string) => {
    const url = files[key]?.[resolution]?.jpg?.url ?? files[key]?.[resolution]?.png?.url;
    if (url) wanted[mapName] = url;
  };
  pick('Diffuse', 'diffuse');
  pick('diff', 'diffuse');
  pick('nor_gl', 'normal');
  pick('Rough', 'roughness');
  pick('rough', 'roughness');
  pick('arm', 'arm');
  pick('Metal', 'metalness');
  pick('Displacement', 'displacement');
  return Object.keys(wanted).length ? wanted : null;
}
