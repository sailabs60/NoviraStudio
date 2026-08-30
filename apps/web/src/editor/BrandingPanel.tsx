import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Image as ImageIcon,
  Loader2,
  Search,
  Sparkles,
  Type,
  Upload,
} from 'lucide-react';
import {
  BRAND_FONTS,
  DEFAULT_ARTWORK,
  DEFAULT_TEXT_3D,
  FINISH_PRESETS,
  applyFinish,
  estimateTextTriangles,
  type ArtworkSceneObject,
  type BrandFinish,
  type Text3DSceneObject,
} from '@novira/shared';
import { http, ApiClientError } from '../lib/api';
import { Modal } from '../components/Modal';
import { ImagePicker, type PickedImage } from '../components/ImagePicker';
import { useEditor } from './editorStore';

/**
 * The branding engine's entry point.
 *
 * The flow is deliberately the one Spline and SketchUp both settled on: pick
 * the thing, see it immediately, then refine. So there is no configuration
 * dialog to fill in before anything appears — choosing a headline or an image
 * drops a usable object into the plan straight away, and every control after
 * that edits it live in the viewport.
 *
 * Two consequences of that decision:
 *
 * - Depth is **one slider that crosses zero**, not an extrude/intrude toggle.
 *   Pushing past zero engraves. That is push/pull, and it is the single
 *   interaction people already know from SketchUp.
 * - Finishes come first, sliders second. "Brushed metal" is a thing a
 *   fabricator quotes; `metalness 1, roughness 0.38` is not. The raw values
 *   stay available underneath for anyone who wants them.
 */

interface ImageResult {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  width: number | null;
  height: number | null;
  license: string;
  attribution: string;
  attributionRequired: boolean;
  sourceUrl: string | null;
  provider: string | null;
}

function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Place new work in front of the camera target rather than always at origin. */
function placementPosition() {
  return { x: 0, y: 0, z: 0 };
}

export function BrandingPanel() {
  const readOnly = useEditor((s) => s.readOnly);
  const addObjects = useEditor((s) => s.addObjects);
  const select = useEditor((s) => s.select);

  const [open, setOpen] = useState<null | 'text' | 'artwork'>(null);

  /* ── Text ─────────────────────────────────────────────────────────────── */
  const [content, setContent] = useState('Sarah & James');
  const [font, setFont] = useState(DEFAULT_TEXT_3D.font);
  const [sizeMm, setSizeMm] = useState(DEFAULT_TEXT_3D.sizeMm);
  const [depthMm, setDepthMm] = useState(DEFAULT_TEXT_3D.depthMm);
  const [finish, setFinish] = useState<BrandFinish>('satin');

  const engraved = depthMm < 0;
  const triangles = useMemo(
    () => estimateTextTriangles({ ...DEFAULT_TEXT_3D, content, sizeMm, depthMm }),
    [content, sizeMm, depthMm]
  );

  function addText() {
    const material = applyFinish({ ...DEFAULT_TEXT_3D.material }, finish);
    const object: Text3DSceneObject = {
      ...DEFAULT_TEXT_3D,
      id: newId(),
      type: 'text3d',
      name: content.slice(0, 40) || 'Lettering',
      positionMm: placementPosition(),
      rotationDeg: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      content,
      font,
      sizeMm,
      depthMm,
      finish,
      material,
      backing: {
        ...DEFAULT_TEXT_3D.backing,
        // Engraving needs something to cut into, so the panel comes with it.
        enabled: engraved || DEFAULT_TEXT_3D.backing.enabled,
      },
    };
    addObjects([object]);
    select([object.id]);
    setOpen(null);
  }

  /* ── Artwork ──────────────────────────────────────────────────────────── */
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [transparent, setTransparent] = useState(false);
  const [orientation, setOrientation] = useState<'' | 'wide' | 'tall' | 'square'>('');
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const search = useQuery({
    queryKey: ['branding', 'search', submitted, transparent, orientation],
    queryFn: async () => {
      const params = new URLSearchParams({ q: submitted });
      if (transparent) params.set('transparent', 'true');
      if (orientation) params.set('orientation', orientation);
      return (await http.get<{ results: ImageResult[]; total: number }>(
        `/branding/images/search?${params}`
      )).data;
    },
    enabled: open === 'artwork' && submitted.length > 1,
  });

  const mine = useQuery({
    queryKey: ['branding', 'mine'],
    queryFn: async () =>
      (await http.get<{ items: Array<{ id: number; name: string; imageUrl: string; aspectRatio: number; license: string | null; attribution: string | null }> }>(
        '/branding/images/mine'
      )).data.items,
    enabled: open === 'artwork',
  });

  /**
   * Bring an image onto our own host before placing it.
   *
   * A remote texture taints the WebGL canvas, which silently breaks both PDF
   * export and AI Enhance — so this is not an optimisation, it is what makes
   * the rest of the platform keep working once artwork is in the scene.
   */
  const importImage = useMutation({
    mutationFn: async (result: ImageResult) =>
      (
        await http.post<{
          imageUrl: string;
          aspectRatio: number;
          widthPx: number;
          heightPx: number;
        }>('/branding/images/import', {
          url: result.url,
          title: result.title,
          license: result.license,
          attribution: result.attribution,
          sourceUrl: result.sourceUrl ?? undefined,
          provider: result.provider ?? undefined,
        })
      ).data,
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : 'Could not import that image.'),
  });

  async function placeArtwork(
    imageUrl: string,
    aspectRatio: number,
    meta: { title?: string; license?: string | null; attribution?: string | null; sourceUrl?: string | null; sourceLabel?: string | null } = {}
  ) {
    // Size to a sensible physical width and derive height from the true pixel
    // aspect, so an imported image is never stretched.
    const widthMm = 1200;
    const object: ArtworkSceneObject = {
      ...DEFAULT_ARTWORK,
      id: newId(),
      type: 'artwork',
      name: meta.title?.slice(0, 40) || 'Artwork',
      positionMm: placementPosition(),
      rotationDeg: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      imageUrl,
      aspectRatio,
      widthMm,
      heightMm: Math.round(widthMm / (aspectRatio || 1)),
      license: meta.license ?? null,
      attribution: meta.attribution ?? null,
      sourceUrl: meta.sourceUrl ?? null,
      sourceLabel: meta.sourceLabel ?? null,
    };
    addObjects([object]);
    select([object.id]);
    setOpen(null);
  }

  const uploadOwn = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return (
        await http.post<{ url: string; widthPx: number; heightPx: number }>(
          '/branding/images/upload',
          form,
          { headers: { 'Content-Type': 'multipart/form-data' } }
        )
      ).data;
    },
    onSuccess: (data) =>
      void placeArtwork(data.url, data.heightPx > 0 ? data.widthPx / data.heightPx : 1, {
        title: 'Uploaded artwork',
        license: 'own',
      }),
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : 'Could not upload that file.'),
  });

  const [browsing, setBrowsing] = useState(false);

  /**
   * Place something chosen from the wider libraries.
   *
   * It still goes through our own import rather than straight into the scene:
   * a remote texture taints the WebGL canvas, and a tainted canvas silently
   * breaks PDF export and AI Enhance. The licence is carried across as-is —
   * unknown stays unknown rather than becoming a claim we cannot support.
   */
  async function placeFromLibrary(image: PickedImage) {
    setError(null);
    try {
      const imported = await importImage.mutateAsync({
        id: image.url,
        title: image.name,
        url: image.url,
        thumbnail: image.safeUrl,
        width: image.width ?? null,
        height: image.height ?? null,
        license: image.license ?? 'unknown',
        attribution: image.attribution ?? image.sourceLabel ?? '',
        attributionRequired: Boolean(image.attribution),
        sourceUrl: image.sourceUrl ?? null,
        provider: image.sourceLabel ?? null,
      });
      await placeArtwork(imported.imageUrl, imported.aspectRatio, {
        title: image.name,
        license: image.license ?? 'unknown',
        attribution: image.attribution ?? null,
        sourceUrl: image.sourceUrl ?? null,
        sourceLabel: image.sourceLabel ?? null,
      });
    } catch {
      /* importImage already reported it. */
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <div className="grid grid-cols-2 gap-1">
        <button
          type="button"
          className="ed-action flex-col gap-1 py-2"
          disabled={readOnly}
          title="3D lettering"
          onClick={() => setOpen('text')}
        >
          <Type className="h-4 w-4" />
          <span className="text-[10px]">Text</span>
        </button>
        <button
          type="button"
          className="ed-action flex-col gap-1 py-2"
          disabled={readOnly}
          title="Artwork"
          onClick={() => setOpen('artwork')}
        >
          <ImageIcon className="h-4 w-4" />
          <span className="text-[10px]">Artwork</span>
        </button>
      </div>

      {/* ── Lettering ───────────────────────────────────────────────────── */}
      <Modal
        open={open === 'text'}
        title="Add lettering"
        description="Cut, raised or engraved. Everything here can be changed afterwards in the properties panel."
        onClose={() => setOpen(null)}
        width="max-w-2xl"
        footer={
          <>
            <span className="mr-auto text-xs text-ink-subtle">
              about {triangles.toLocaleString()} triangles
            </span>
            <button type="button" className="btn-secondary" onClick={() => setOpen(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!content.trim()}
              onClick={addText}
            >
              Add lettering
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="label">Words</span>
            <textarea
              className="input min-h-[64px] resize-y text-lg"
              value={content}
              autoFocus
              placeholder="Sarah &amp; James"
              onChange={(e) => setContent(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-subtle">Line breaks are kept.</p>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Typeface</span>
              <select
                className="input"
                value={font}
                onChange={(e) => setFont(e.target.value as typeof font)}
              >
                {BRAND_FONTS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label} · {f.weight}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="label mb-0">Cap height</span>
                <span className="text-xs font-semibold tabular-nums text-ink">{sizeMm} mm</span>
              </div>
              <input
                type="range"
                className="w-full accent-primary"
                min={50}
                max={2000}
                step={10}
                value={sizeMm}
                onChange={(e) => setSizeMm(Number(e.target.value))}
              />
            </label>
          </div>

          {/*
            One slider crossing zero, rather than an extrude/intrude toggle.
            Push past zero and the lettering cuts into its backing panel.
          */}
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="label mb-0">Depth</span>
              <span
                className={`text-xs font-semibold tabular-nums ${
                  engraved ? 'text-amber-400' : 'text-ink'
                }`}
              >
                {engraved ? `${Math.abs(depthMm)} mm engraved` : `${depthMm} mm raised`}
              </span>
            </div>
            <input
              type="range"
              className="w-full accent-primary"
              min={-40}
              max={300}
              step={2}
              value={depthMm}
              onChange={(e) => setDepthMm(Number(e.target.value))}
            />
            <div className="mt-1 flex justify-between text-[10px] text-ink-subtle">
              <span>engrave</span>
              <span>flat</span>
              <span>extrude</span>
            </div>
            {engraved ? (
              <p className="mt-1 text-xs text-amber-400/90">
                Engraved lettering is cut into a backing panel, which is added automatically.
              </p>
            ) : null}
          </div>

          <div>
            <span className="label">Finish</span>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
              {(Object.keys(FINISH_PRESETS) as BrandFinish[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFinish(key)}
                  className={`rounded-md border px-2 py-1.5 text-left text-xs transition ${
                    finish === key
                      ? 'border-primary bg-primary/10 text-ink'
                      : 'border-line text-ink-muted hover:text-ink'
                  }`}
                >
                  {FINISH_PRESETS[key].label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-subtle">{FINISH_PRESETS[finish].note}</p>
          </div>
        </div>
      </Modal>

      {/* ── Artwork ─────────────────────────────────────────────────────── */}
      <Modal
        open={open === 'artwork'}
        title="Add artwork"
        description="Search openly-licensed images, or bring in your own."
        onClose={() => setOpen(null)}
        width="max-w-3xl"
        footer={
          <button type="button" className="btn-secondary" onClick={() => setOpen(null)}>
            Close
          </button>
        }
      >
        {error ? <div className="notice-error mb-3">{error}</div> : null}

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="min-w-[200px] flex-1">
            <span className="label">Search</span>
            <div className="flex gap-1.5">
              <input
                className="input"
                value={query}
                placeholder="eucalyptus, monogram, gold foil…"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && setSubmitted(query.trim())}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSubmitted(query.trim())}
              >
                <Search className="h-3.5 w-3.5" />
              </button>
            </div>
          </label>

          <label className="flex items-center gap-1.5 pb-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={transparent}
              onChange={(e) => setTransparent(e.target.checked)}
            />
            Cut-out only
          </label>

          <select
            className="input w-auto"
            value={orientation}
            onChange={(e) => setOrientation(e.target.value as typeof orientation)}
          >
            <option value="">Any shape</option>
            <option value="wide">Wide</option>
            <option value="tall">Tall</option>
            <option value="square">Square</option>
          </select>

          <button
            type="button"
            className="btn-secondary"
            disabled={uploadOwn.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {uploadOwn.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Upload
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadOwn.mutate(file);
              e.target.value = '';
            }}
          />

          {/*
            The search above is licence-filtered, because most artwork here ends
            up printed on something a client pays for. This second door opens the
            whole library — Pinterest included — for the times a designer is
            after a look rather than a licence: a mock-up for tomorrow's review,
            a placeholder on a brand wall. Whatever it knows about the licence
            travels with the object, so the panel can say so later rather than
            leaving a fabricator to find out.
          */}
          <button type="button" className="btn-secondary" onClick={() => setBrowsing(true)}>
            <Search className="h-3.5 w-3.5" /> Browse everything
          </button>
        </div>

        <ImagePicker
          open={browsing}
          onClose={() => setBrowsing(false)}
          onPick={(image) => void placeFromLibrary(image)}
          title="Browse the image libraries"
          description="Pinterest, Unsplash, Pexels and the rest. Check the licence before anything here goes to print."
          initialQuery={query.trim() || 'event branding'}
        />

        {mine.data?.length ? (
          <div className="mb-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              Your artwork
            </p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {mine.data.slice(0, 12).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  title={a.name}
                  className="group overflow-hidden rounded-md border border-line bg-surface-muted/40 transition hover:border-primary"
                  onClick={() =>
                    void placeArtwork(a.imageUrl, a.aspectRatio, {
                      title: a.name,
                      license: a.license,
                      attribution: a.attribution,
                    })
                  }
                >
                  <img src={a.imageUrl} alt={a.name} className="h-16 w-full object-contain" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {search.isFetching ? (
          <div className="flex items-center gap-2 py-8 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Searching…
          </div>
        ) : null}

        {search.data ? (
          search.data.results.length ? (
            <>
              <p className="mb-2 text-xs text-ink-subtle">
                {search.data.results.length} of {search.data.total.toLocaleString()} results ·
                commercially usable licences only
              </p>
              <div className="grid max-h-[46vh] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
                {search.data.results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    title={`${r.title} — ${r.attribution}`}
                    disabled={importImage.isPending}
                    className="group overflow-hidden rounded-md border border-line bg-surface-muted/40 text-left transition hover:border-primary disabled:opacity-50"
                    onClick={async () => {
                      setError(null);
                      const imported = await importImage.mutateAsync(r);
                      await placeArtwork(imported.imageUrl, imported.aspectRatio, {
                        title: r.title,
                        license: r.license,
                        attribution: r.attributionRequired ? r.attribution : null,
                        sourceUrl: r.sourceUrl,
                        sourceLabel: r.provider,
                      });
                    }}
                  >
                    <img
                      src={r.thumbnail}
                      alt={r.title}
                      loading="lazy"
                      className="h-24 w-full object-cover"
                    />
                    <div className="p-1.5">
                      <p className="truncate text-[11px] font-medium text-ink">{r.title}</p>
                      <p className="text-[10px] uppercase text-ink-subtle">{r.license}</p>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="py-8 text-sm text-ink-muted">
              Nothing usable for “{submitted}”. Results are limited to licences that allow
              commercial use, which rules a lot out — try a broader word.
            </p>
          )
        ) : null}

        {!search.data && !search.isFetching && !mine.data?.length ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Sparkles className="h-5 w-5 text-ink-subtle" />
            <p className="text-sm text-ink-muted">
              Search for artwork, or upload your client&rsquo;s own.
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
