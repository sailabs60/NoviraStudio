/**
 * Swapping one object for another, or making a new one to take its place.
 *
 * Two things a plan needs constantly and had no way to do:
 *
 *   · **Replace** — this table is right in every way except that it should be
 *     the 1.5 m round, not the 1.8 m. The position, the rotation and the chairs
 *     around it are all correct and must survive; only the model changes.
 *   · **Regenerate** — nothing in the catalogue is the right thing, so make
 *     one, and put it exactly where this stands.
 *
 * Both were previously "delete it, find a replacement, place it, rotate it back,
 * and hope you remember where it was", which on one object is annoying and
 * across a set is unusable.
 *
 * ## Why the transform is what survives
 *
 * The arrangement is the expensive part of a plan. Deciding *which* chair takes
 * a moment; deciding where 480 of them go is the work. So every path here keeps
 * the transform and changes what stands in it, which is also what makes
 * "replace all the chairs" safe to say to the assistant.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw, Repeat, Search, Sparkles, X } from 'lucide-react';
import type { CatalogItemDto, CatalogSceneObject, SceneObject } from '@novira/shared';
import { useEditor } from './editorStore';
import { api } from '../lib/api';
import { pollJob } from '../lib/spatialApi';
import { studio } from '../lib/studioApi';
import { toast } from '../components/ui';

export function ReplaceSection({ object, readOnly }: { object: CatalogSceneObject; readOnly: boolean }) {
  const [mode, setMode] = useState<null | 'replace' | 'regenerate'>(null);

  return (
    <section className="ed-section">
      <h3 className="ed-section-title">Replace</h3>
      <div className="flex gap-1.5">
        <button
          type="button"
          className="ed-action flex-1 justify-center"
          disabled={readOnly || object.locked}
          onClick={() => setMode(mode === 'replace' ? null : 'replace')}
        >
          <Repeat className="h-3.5 w-3.5" /> Swap model
        </button>
        <button
          type="button"
          className="ed-action flex-1 justify-center"
          disabled={readOnly || object.locked}
          onClick={() => setMode(mode === 'regenerate' ? null : 'regenerate')}
        >
          <Sparkles className="h-3.5 w-3.5" /> Regenerate
        </button>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-ink-subtle">
        Both keep exactly where this stands — position, rotation and scale survive the swap.
      </p>

      {mode === 'replace' ? <SwapModel object={object} onDone={() => setMode(null)} /> : null}
      {mode === 'regenerate' ? <Regenerate object={object} onDone={() => setMode(null)} /> : null}
    </section>
  );
}

/* ── Swap for another catalogue model ──────────────────────────────────── */

function SwapModel({ object, onDone }: { object: CatalogSceneObject; onDone: () => void }) {
  const updateObject = useEditor((s) => s.updateObject);
  const cacheItems = useEditor((s) => s.cacheItems);
  const scene = useEditor((s) => s.scene);
  const [query, setQuery] = useState('');
  const [alsoGroup, setAlsoGroup] = useState(false);

  /*
   * Search the same category first.
   *
   * Replacing a chair almost always means a different chair. Searching the
   * whole catalogue puts a chandelier and a bar in front of someone looking for
   * a seat, and they have to read past them every time.
   */
  const { data, isFetching } = useQuery({
    queryKey: ['replace-search', object.catalogItemId, query],
    queryFn: async () => {
      const cached = useEditor.getState().itemCache[object.catalogItemId];
      const category = (cached as unknown as { categorySlug?: string })?.categorySlug;
      const result = await api.catalog.items({
        ...(category ? { category } : {}),
        ...(query.trim() ? { q: query.trim() } : {}),
        limit: 24,
      } as never);
      return result.items ?? [];
    },
    staleTime: 60_000,
  });

  /** How many others in the plan share this model, so the offer is honest. */
  const peers = useMemo(
    () =>
      scene.objects.filter(
        (o) => (o as CatalogSceneObject).catalogItemId === object.catalogItemId && o.id !== object.id
      ),
    [scene.objects, object.catalogItemId, object.id]
  );

  const swap = (item: CatalogItemDto) => {
    cacheItems([item]);

    const patch: Partial<SceneObject> = {
      catalogItemId: item.id,
      modelUrl: item.modelUrl ?? undefined,
      name: item.name,
      dimensionsMm: {
        width: item.widthMm ?? 600,
        depth: item.depthMm ?? 600,
        height: item.heightMm ?? 600,
      },
      seatsDefault: (item as unknown as { seatsDefault?: number | null }).seatsDefault ?? null,
      tableShape:
        (item as unknown as { tableShape?: 'round' | 'rectangular' | 'other' | null }).tableShape ?? null,
    } as Partial<SceneObject>;

    const targets = alsoGroup ? [object, ...peers] : [object];
    for (const target of targets) updateObject(target.id, patch);

    toast(
      'success',
      targets.length === 1
        ? `Swapped for ${item.name}. It kept its place.`
        : `Swapped ${targets.length} objects for ${item.name}. Every position kept.`,
      { label: 'Undo', onClick: () => useEditor.getState().undo() }
    );
    onDone();
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-subtle" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search this category…"
          className="ed-field w-full pl-7"
        />
      </div>

      {peers.length ? (
        <label className="flex cursor-pointer items-start gap-1.5 text-[10px] leading-snug text-ink-subtle">
          <input
            type="checkbox"
            checked={alsoGroup}
            onChange={(e) => setAlsoGroup(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Replace all {peers.length + 1} of these in the plan, not just this one. Each keeps its own
            position.
          </span>
        </label>
      ) : null}

      {isFetching ? (
        <p className="flex items-center gap-1.5 text-[10px] text-ink-subtle">
          <Loader2 className="h-3 w-3 animate-spin" /> Searching…
        </p>
      ) : null}

      <div className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto">
        {(data ?? [])
          .filter((item) => item.id !== object.catalogItemId)
          .map((item) => (
            <button
              key={item.id}
              type="button"
              className="group rounded border border-line p-1 text-left hover:border-primary"
              onClick={() => swap(item)}
              title={`${item.name} — ${item.widthMm ?? '?'} × ${item.depthMm ?? '?'} × ${item.heightMm ?? '?'} mm`}
            >
              {item.previewImage ? (
                <img src={item.previewImage} alt="" className="aspect-square w-full rounded object-cover" loading="lazy" />
              ) : (
                <span className="flex aspect-square w-full items-center justify-center rounded bg-surface-sunken text-[9px] text-ink-subtle">
                  no image
                </span>
              )}
              <span className="mt-1 block truncate text-[9px] text-ink group-hover:text-primary">{item.name}</span>
            </button>
          ))}
      </div>
    </div>
  );
}

/* ── Make a new one to stand here ──────────────────────────────────────── */

function Regenerate({ object, onDone }: { object: CatalogSceneObject; onDone: () => void }) {
  const updateObject = useEditor((s) => s.updateObject);
  const planId = useEditor((s) => s.planId);
  const [prompt, setPrompt] = useState(object.name ?? '');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const run = async () => {
    if (!prompt.trim()) {
      toast('error', 'Say what should stand here.');
      return;
    }
    setRunning(true);
    setProgress(3);
    try {
      const started = await studio.textTo3d({
        prompt: prompt.trim(),
        planId: planId ?? undefined,
        refine: true,
      });
      const finished = await pollJob(started.id, (job) => setProgress(job.progress), { intervalMs: 2500 });

      if (finished.status !== 'completed' || !finished.output) {
        toast('error', finished.errorMessage ?? 'That did not generate. Nothing was charged.');
        return;
      }
      const output = finished.output as { modelUrl?: string; url?: string };
      const modelUrl = output.modelUrl ?? output.url;
      if (!modelUrl) {
        toast('error', 'The generator returned nothing usable.');
        return;
      }

      /*
       * Keep the dimensions this object already had.
       *
       * A generated mesh has no inherent size, and the object standing here has
       * a measured one that the rest of the plan was laid out around. Taking
       * the old size and putting the new model in it is what stops a
       * regenerated chair arriving four metres tall.
       */
      updateObject(object.id, {
        modelUrl,
        name: prompt.trim(),
      } as Partial<SceneObject>);

      toast('success', 'Regenerated, at the same size and in the same place.', {
        label: 'Undo',
        onClick: () => useEditor.getState().undo(),
      });
      onDone();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'That did not generate.');
    } finally {
      setRunning(false);
      setProgress(0);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={2}
        placeholder="a brushed brass lectern with a curved front"
        className="ed-field w-full resize-y"
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          className="ed-action-primary flex-1 justify-center"
          onClick={run}
          disabled={running}
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {running ? `Making it… ${progress}%` : 'Make it'}
        </button>
        <button type="button" className="ed-action px-2" onClick={onDone} aria-label="Cancel">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-[10px] leading-relaxed text-ink-subtle">
        The new model takes this one's size and place, so the layout around it still works.
      </p>
    </div>
  );
}
