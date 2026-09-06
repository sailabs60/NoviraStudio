/**
 * Serving a multi-file glTF that the browser can actually load.
 *
 * A `.gltf` is JSON with *relative* references to a `.bin` and a folder of
 * textures. That is fine when the whole bundle sits in one directory, and it
 * is not how several of these libraries publish. Poly Haven is the case that
 * matters: its glTF says `textures/foo_diff_1k.jpg`, but the file actually
 * lives under `/Models/jpg/1k/<slug>/foo_diff_1k.jpg` — a different branch of
 * the CDN entirely. Resolved relative to the glTF, every one of those paths is
 * a 404, so the model arrives with no textures or does not arrive at all.
 *
 * Poly Haven publishes the true mapping in its files API, under `include`.
 * This module fetches the glTF, rewrites every `uri` to the absolute URL the
 * provider says it is, and routes each one through our own proxy so the
 * browser gets same-origin bytes with CORS headers it will accept.
 *
 * The rewritten document is small — a few kilobytes of JSON — so it is
 * returned as a data URI. That avoids inventing a storage lifecycle for
 * something a user may never drop into the scene, and it means the viewport
 * loads a single self-describing URL.
 */

const UA = 'Novira/1.0 (gltf rewrite)';
const TIMEOUT_MS = 20_000;
/** Well past any real glTF document; a guard against fetching something huge. */
const MAX_GLTF_BYTES = 8 * 1024 * 1024;

interface GltfDoc {
  buffers?: Array<{ uri?: string }>;
  images?: Array<{ uri?: string }>;
}

async function getText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_GLTF_BYTES) return null;
    const text = await res.text();
    return text.length > MAX_GLTF_BYTES ? null : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(url: string): Promise<T | null> {
  const text = await getText(url);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Send a URL back through our own proxy, so the browser sees CORS headers. */
function viaProxy(absolute: string, publicBase: string): string {
  return `${publicBase.replace(/\/$/, '')}/api/assets/proxy?url=${encodeURIComponent(absolute)}`;
}

interface PolyHavenInclude {
  [relativePath: string]: { url?: string };
}

/**
 * The include map for a Poly Haven model at a given resolution.
 *
 * Keys are exactly the relative URIs written inside the glTF, which is what
 * makes the rewrite a straight lookup rather than a guess at path shapes.
 */
async function polyHavenIncludes(slug: string, resolution: string): Promise<PolyHavenInclude | null> {
  const files = await getJson<Record<string, Record<string, { gltf?: { include?: PolyHavenInclude } }>>>(
    `https://api.polyhaven.com/files/${encodeURIComponent(slug)}`
  );
  const node = files?.gltf?.[resolution]?.gltf;
  return node?.include ?? null;
}

/**
 * Read the slug and resolution out of a Poly Haven glTF URL.
 *
 * `.../Models/gltf/1k/mid_century_lounge_chair/mid_century_lounge_chair_1k.gltf`
 */
function parsePolyHavenGltfUrl(url: string): { slug: string; resolution: string } | null {
  const m = url.match(/\/Models\/gltf\/([^/]+)\/([^/]+)\/[^/]+\.gltf(?:\?|$)/i);
  return m ? { resolution: m[1]!, slug: m[2]! } : null;
}

/**
 * Rewrite a Poly Haven glTF into a self-contained data URI.
 *
 * Returns null when this is not a Poly Haven glTF, or when anything about the
 * rewrite fails — the caller then serves the original URL, which is no worse
 * than the behaviour before this existed.
 */
export async function rewritePolyHavenGltf(url: string, publicBase: string): Promise<string | null> {
  const parsed = parsePolyHavenGltfUrl(url);
  if (!parsed) return null;

  const [doc, includes] = await Promise.all([
    getJson<GltfDoc>(url),
    polyHavenIncludes(parsed.slug, parsed.resolution),
  ]);
  if (!doc || !includes) return null;

  const base = new URL(url);
  const absolutise = (uri: string): string => {
    const mapped = includes[uri]?.url;
    if (mapped) return mapped;
    // Not in the include map: resolve it against the glTF's own directory,
    // which is correct for any bundle that is laid out the ordinary way.
    return new URL(uri, base).toString();
  };

  let rewrote = 0;
  for (const list of [doc.buffers, doc.images]) {
    for (const entry of list ?? []) {
      // Data URIs are already self-contained and must be left alone.
      if (!entry?.uri || entry.uri.startsWith('data:')) continue;
      entry.uri = viaProxy(absolutise(entry.uri), publicBase);
      rewrote += 1;
    }
  }
  if (!rewrote) return null;

  const json = JSON.stringify(doc);
  return `data:model/gltf+json;base64,${Buffer.from(json, 'utf8').toString('base64')}`;
}
