import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Image as ImageIcon, RotateCcw, Search, Upload, X } from 'lucide-react';
import {
  BUILT_IN_MATERIALS,
  DEFAULT_ARTWORK,
  searchMaterials,
  type ArtworkSceneObject,
} from '@novira/shared';
import { assets } from '../lib/assetsApi';
import { MaterialSwatch } from './MaterialLibrary';
import { useEditor } from './editorStore';
import { useSelectedObjects } from './selectors';
import { LazyImage } from '../components/LazyImage';
import { ImportFlow } from './ImportFlow';
import { toast } from '../components/ui';

/**
 * The two things people reach for straight after selecting something.
 *
 * Both already existed, and both were three or four steps away: changing a
 * finish meant opening the Finish rail, finding the material and dragging it
 * onto the right surface; putting a client's artwork on a stage meant the
 * Create panel, the art tab, and a drop onto the floor followed by dragging
 * the panel into position. Neither is hard — they are just far, and they are
 * the two edits an event designer makes over and over.
 *
 * These are popovers hung off the selection toolbar rather than a bar that
 * follows the object around the viewport. The toolbar sits in one fixed place
 * for the same reason it always has (see `SelectionToolbar`): a control that
 * moves with the selection is never twice in the same place, and one drawn
 * over the selection covers the thing being edited. Anchoring here keeps both
 * the button and the window it opens somewhere the eye already knows, and
 * clear of the object itself.
 */

type QuickAction = 'material' | 'art';

export function ObjectQuickActions({
  action,
  onClose,
}: {
  action: QuickAction;
  onClose: () => void;
}) {
  /*
   * Escape closes, as it does for every other window in the editor — and
   * only closes.
   *
   * Registered in the capture phase and stopping there, because the editor's
   * own Escape handler is a window-level listener that clears the selection.
   * Without this, dismissing the window would also deselect the object it was
   * opened for, and the toolbar it hangs off would vanish with it.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  return (
    <>
      {/* Click anywhere else to dismiss. */}
      <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-20 cursor-default" onClick={onClose} />
      <div className="pointer-events-auto absolute left-1/2 top-14 z-30 w-[340px] -translate-x-1/2">
        <div className="panel overflow-hidden p-0 shadow-xl">
          {action === 'material' ? <MaterialQuickPick onClose={onClose} /> : <ArtQuickPick onClose={onClose} />}
        </div>
      </div>
    </>
  );
}

function PopoverHeader({ title, hint, onClose }: { title: string; hint: string; onClose: () => void }) {
  return (
    <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[10px] leading-snug text-ink-subtle">{hint}</p>
      </div>
      <button type="button" onClick={onClose} className="icon-btn h-6 w-6 shrink-0" aria-label="Close">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/* ── Material ──────────────────────────────────────────────────────────── */

function MaterialQuickPick({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('');
  const selected = useSelectedObjects();
  const clearAllFinishes = useEditor((s) => s.clearAllFinishes);

  const materials = useMemo(
    () => (search.trim() ? searchMaterials(search) : BUILT_IN_MATERIALS).slice(0, 36),
    [search]
  );

  const applied = selected.filter((o) => Object.keys(o.finishes ?? {}).length).length;

  return (
    <>
      <PopoverHeader
        title="Material"
        hint={
          selected.length === 1
            ? 'Click a finish to apply it to this object.'
            : `Click a finish to apply it to all ${selected.length} selected.`
        }
        onClose={onClose}
      />

      <div className="px-3 pt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
          <input
            className="ed-field pl-8"
            placeholder="Fabric, timber, metal…"
            value={search}
            autoFocus
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="max-h-[280px] overflow-y-auto p-3">
        {materials.length ? (
          <div className="grid grid-cols-4 gap-1.5">
            {materials.map((material) => (
              <MaterialSwatch key={material.materialId} material={material} />
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-[11px] text-ink-subtle">Nothing matches that.</p>
        )}
      </div>

      <div className="border-t border-line px-3 py-2">
        <button
          type="button"
          className="ed-action w-full justify-center border border-line"
          disabled={!applied}
          onClick={() => {
            for (const object of selected) clearAllFinishes(object.id);
            toast('success', applied === 1 ? 'Finish removed — back to the original.' : 'Finishes removed.');
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {applied ? 'Reset to the original material' : 'No finish applied'}
        </button>
      </div>
    </>
  );
}

/* ── Artwork ───────────────────────────────────────────────────────────── */

/**
 * Where a graphic panel goes when it is added from a selection.
 *
 * In front of the selection and facing the way the plan opens, standing at a
 * fixed clearance rather than in the middle of it — a logo dropped inside a
 * stage is invisible, and one at the origin is a hunt. The width follows the
 * image's own proportions at a 2 m panel height, the same size a dragged
 * image already becomes.
 */
function artworkPlacement(selected: ReturnType<typeof useSelectedObjects>) {
  if (!selected.length) return { x: 0, z: 0 };
  const xs = selected.map((o) => o.positionMm.x);
  const zs = selected.map((o) => o.positionMm.z);
  return {
    x: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length),
    z: Math.round(Math.max(...zs) + 1500),
  };
}

function ArtQuickPick({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('logo');
  const [query, setQuery] = useState('logo');
  const [uploadOpen, setUploadOpen] = useState(false);
  const selected = useSelectedObjects();
  const addObjects = useEditor((s) => s.addObjects);

  const { data, isLoading } = useQuery({
    queryKey: ['assets', 'images', 'quick', query],
    queryFn: () => assets.search({ category: 'images', q: query, limit: 24 }),
    staleTime: 60_000,
  });

  const place = (asset: { name: string; imageUrl?: string | null; thumbnailUrl?: string | null; imageWidth?: number | null; imageHeight?: number | null; sourceLabel?: string | null; viewerUrl?: string | null; license?: string | null; attribution?: string | null }) => {
    const url = asset.imageUrl ?? asset.thumbnailUrl;
    if (!url) {
      toast('error', 'That image could not be read.');
      return;
    }
    const aspect =
      asset.imageWidth && asset.imageHeight && asset.imageHeight > 0 ? asset.imageWidth / asset.imageHeight : 1.5;
    const heightMm = 2000;
    const spot = artworkPlacement(selected);

    addObjects([
      {
        ...DEFAULT_ARTWORK,
        id: crypto.randomUUID(),
        type: 'artwork',
        name: asset.name.slice(0, 80),
        imageUrl: url,
        sourceLabel: asset.sourceLabel ?? null,
        sourceUrl: asset.viewerUrl ?? null,
        license: asset.license ?? null,
        attribution: asset.attribution ?? null,
        widthMm: Math.round(heightMm * aspect),
        heightMm,
        aspectRatio: aspect,
        mount: 'free',
        positionMm: { x: spot.x, y: 0, z: spot.z },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      } as ArtworkSceneObject,
    ]);
    toast('success', `${asset.name} placed in front of the selection.`);
    onClose();
  };

  return (
    <>
      <PopoverHeader
        title="Add art"
        hint="Placed standing in front of what you have selected, at 2 m tall — move it from there."
        onClose={onClose}
      />

      <div className="px-3 pt-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim() || 'logo');
          }}
          className="relative"
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
          <input
            className="ed-field pl-8"
            placeholder="Search artwork, patterns, backdrops…"
            value={search}
            autoFocus
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
      </div>

      <div className="max-h-[280px] overflow-y-auto p-3">
        {isLoading ? (
          <div className="grid grid-cols-3 gap-1.5" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="nv-shimmer aspect-square rounded-lg bg-surface-muted" />
            ))}
          </div>
        ) : data?.items.length ? (
          <div className="grid grid-cols-3 gap-1.5">
            {data.items.map((asset) => (
              <button
                key={`${asset.source}:${asset.sourceAssetId}`}
                type="button"
                onClick={() => place(asset)}
                title={`${asset.name} — click to place`}
                className="overflow-hidden rounded-lg border border-line transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-card"
              >
                <LazyImage
                  src={asset.thumbnailUrl ?? asset.imageUrl ?? undefined}
                  alt={asset.name}
                  ratio="1 / 1"
                  wrapperClassName="w-full"
                  fallback={<ImageIcon className="h-4 w-4 text-ink-subtle/60" />}
                />
              </button>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-[11px] text-ink-subtle">
            Nothing came back for that. Try a different word, or upload your own below.
          </p>
        )}
      </div>

      <div className="border-t border-line px-3 py-2">
        <button
          type="button"
          className="ed-action w-full justify-center border border-line"
          onClick={() => setUploadOpen(true)}
        >
          <Upload className="h-3.5 w-3.5" /> Upload your own artwork
        </button>
      </div>

      <ImportFlow open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </>
  );
}
