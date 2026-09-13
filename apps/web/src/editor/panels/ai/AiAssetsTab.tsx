/**
 * Everything the AI has made for this account, and the one button that puts it
 * in the room.
 *
 * ## The gap this closes
 *
 * Generating was never the problem. A model or an image would generate, land in
 * a grid, and then — nothing. The grid on the 3D tab was per-session state in a
 * React component, so reloading the page or switching tabs lost it. The
 * *durable* record of what had been generated lived only on a separate page
 * (`/ai-studio`, "Your library"), which is not in the editor at all, and the
 * one action that page offered was "Add to my library", which copies the asset
 * into the catalogue and then leaves the designer to go and find it there.
 *
 * So the honest description of the old flow was: generate a thing, navigate
 * away from your plan to see it, import it into a catalogue, navigate back,
 * search the catalogue for it, and place it. Six steps, four of them
 * navigation, and every one of them a place to lose the thread. A generator
 * whose output cannot reach the scene has done the easy half of the work.
 *
 * ## What this is
 *
 * The same durable list — the server's record of every generation, which
 * survives reloads and is copied onto Novira's own storage so a provider's
 * expiring link cannot break it — brought into the editor, beside the plan,
 * with the actions that matter to somebody holding a plan:
 *
 *  · **A 3D model places into the scene.** One click arms it, the next click
 *    puts it on the floor, at a height the designer can correct first — because
 *    a generated mesh has no inherent size and a chair that arrives four metres
 *    tall is not a chair.
 *  · **An image goes onto a surface.** Straight onto the LED screens and
 *    artwork panels already in the plan when there are any, and otherwise as a
 *    free-standing graphic panel in front of the camera. An image generator
 *    that leaves a PNG in a gallery has, again, done the easy half.
 *  · **Anything can be kept.** "Save to my library" is still here, because a
 *    generation worth reusing across projects belongs in the catalogue — but it
 *    is now the secondary action rather than the only one.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Boxes,
  Check,
  Image as ImageIcon,
  Loader2,
  MonitorPlay,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  DEFAULT_ARTWORK,
  type ArtworkSceneObject,
  type CatalogItemDto,
  type LedScreenSceneObject,
  type SceneObject,
} from '@novira/shared';
import { useEditor } from '../../editorStore';
import { studio, type Creation } from '../../../lib/studioApi';
import { draggableProps } from '../../useDropTarget';
import type { DragPayload } from '../../dragStore';
import type { ProviderAsset } from '../../../lib/assetsApi';
import { assets } from '../../../lib/assetsApi';
import { currentCamera } from '../../Viewport';
import { toast } from '../../../components/ui';

type Filter = 'all' | 'model' | 'image';

/**
 * A believable real height for a generated thing, from what it was called.
 *
 * A mesh generator has no idea how big anything is. These are the figures a
 * production manager would give, and they are only a starting point — the
 * number is editable before anything is placed, which is the part that makes a
 * generated object usable in a plan drawn in millimetres.
 */
const HEIGHT_HINTS: Array<{ test: RegExp; mm: number }> = [
  { test: /chair|stool|seat/i, mm: 900 },
  { test: /table|desk/i, mm: 750 },
  { test: /lectern|podium|pulpit/i, mm: 1200 },
  { test: /plant|palm|tree|planter/i, mm: 1800 },
  { test: /sofa|settee|couch/i, mm: 800 },
  { test: /bar|counter/i, mm: 1100 },
  { test: /arch|entrance|gate/i, mm: 3000 },
  { test: /screen|wall|banner|backdrop/i, mm: 2400 },
  { test: /booth|stand|kiosk/i, mm: 2500 },
  { test: /statue|sculpture|installation/i, mm: 2200 },
];

const suggestHeightMm = (name: string): number =>
  HEIGHT_HINTS.find((hint) => hint.test.test(name))?.mm ?? 900;

export function AiAssetsTab() {
  const queryClient = useQueryClient();
  const readOnly = useEditor((s) => s.readOnly);

  const [filter, setFilter] = useState<Filter>('all');
  /** Per-creation height overrides, before anything is placed. */
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const { data: creations = [], isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['studio', 'creations'],
    queryFn: () => studio.creations(),
    staleTime: 30_000,
    /*
     * A generation that was running when the panel was opened has to be seen
     * to finish. Polling stops as soon as nothing is in flight, so an idle
     * panel costs one request when it opens and nothing afterwards.
     */
    refetchInterval: (query) => {
      const rows = query.state.data as Creation[] | undefined;
      const running = rows?.some((row) => row.status === 'queued' || row.status === 'in_progress');
      return running ? 4000 : false;
    },
  });

  const shown = useMemo(
    () =>
      creations.filter((row) => {
        if (filter !== 'all' && row.kind !== filter) return false;
        // A failed or cancelled generation has nothing to place and nothing to
        // look at; the studio page is where those are reviewed.
        return row.status !== 'cancelled';
      }),
    [creations, filter]
  );

  const running = creations.filter((row) => row.status === 'queued' || row.status === 'in_progress').length;

  return (
    <div className="space-y-3">
      <div className="ai-card">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="ai-card-head">
              <span className="ai-card-icon">
                <Sparkles className="h-4 w-4" />
              </span>
              <h3 className="ai-card-title">Generated assets</h3>
            </div>
            <p className="ai-card-note">
              Everything the AI has made for you, kept on Novira&rsquo;s own storage. Place a model in the room, or
              put an image on a screen — without leaving the plan.
            </p>
          </div>
          <button
            type="button"
            className="ai-btn shrink-0 px-2 py-1"
            onClick={() => void refetch()}
            disabled={isRefetching}
            title="Look for anything new"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {running ? (
          <p className="mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            {running} still generating — {running === 1 ? 'it appears' : 'they appear'} here when done.
          </p>
        ) : null}

        <div className="mt-3 flex gap-1">
          {(
            [
              ['all', 'Everything'],
              ['model', '3D models'],
              ['image', 'Images'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`ai-pill ${filter === value ? 'ai-pill-active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-2" aria-hidden>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="overflow-hidden rounded-xl border border-line">
              <div className="nv-shimmer aspect-square w-full bg-surface-muted" />
              <div className="space-y-1 border-t border-line p-2">
                <div className="h-2 w-3/4 rounded bg-surface-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : !shown.length ? (
        <div className="ai-card flex flex-col items-center py-8 text-center">
          <Sparkles className="h-6 w-6 text-ink-subtle" />
          <p className="mt-2 text-[12px] font-semibold text-ink">Nothing generated yet</p>
          <p className="mt-0.5 max-w-[230px] text-[11px] leading-relaxed text-ink-muted">
            Make something on the <strong className="font-semibold text-ink">3D</strong> or{' '}
            <strong className="font-semibold text-ink">Artwork</strong> tab and it appears here, ready to place.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {shown.map((creation) => (
            <AssetCard
              key={creation.id}
              creation={creation}
              readOnly={readOnly}
              heightMm={heights[creation.id] ?? suggestHeightMm(creation.prompt)}
              busy={busy === creation.id}
              onHeight={(mm) => setHeights((prev) => ({ ...prev, [creation.id]: mm }))}
              onBusy={setBusy}
              onChanged={() => void queryClient.invalidateQueries({ queryKey: ['studio', 'creations'] })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── One generated asset ───────────────────────────────────────────────── */

function AssetCard({
  creation,
  readOnly,
  heightMm,
  busy,
  onHeight,
  onBusy,
  onChanged,
}: {
  creation: Creation;
  readOnly: boolean;
  heightMm: number;
  busy: boolean;
  onHeight: (mm: number) => void;
  onBusy: (id: string | null) => void;
  onChanged: () => void;
}) {
  const setPendingItem = useEditor((s) => s.setPendingItem);
  const cacheItems = useEditor((s) => s.cacheItems);
  const addObjects = useEditor((s) => s.addObjects);
  const updateObjects = useEditor((s) => s.updateObjects);
  /*
   * How many surfaces in the plan can carry an image.
   *
   * A **count**, not the objects. `filter` builds a new array on every call,
   * and a zustand selector that returns a new reference every time is compared
   * by identity — so it reported a change on every render, re-rendered, built
   * another array, and the card climbed straight into React's update-depth
   * limit and took the tab down with it. A number compares equal to itself.
   *
   * The objects themselves are read from the store at the moment the button is
   * pressed, which is the only moment they are needed.
   */
  const surfaceCount = useEditor(
    (s) => s.scene.objects.reduce((n, o) => (o.type === 'led' || o.type === 'artwork' ? n + 1 : n), 0)
  );
  const [saved, setSaved] = useState(false);

  const pending = creation.status === 'queued' || creation.status === 'in_progress';
  const failed = creation.status === 'failed';
  const usable = creation.status === 'completed' && Boolean(creation.resultUrl);
  const name = (creation.prompt || 'Generated asset').slice(0, 80);

  /**
   * Arm the cursor with a generated model, so it lands where the designer
   * clicks.
   *
   * The same path a catalogue item takes, deliberately: it inherits the ghost
   * that follows the cursor, the grid snapping, the surface-height search that
   * stands it on a stage rather than inside one, and the Shift-to-keep-placing
   * behaviour. A second, parallel placement path for generated models would drift
   * out of step with all of that within a release.
   *
   * The id is negative so it can never collide with a real catalogue row, and
   * is derived from the creation's own id so re-arming the same asset reuses
   * the same cache entry rather than filling the cache with duplicates.
   */
  const placeModel = () => {
    if (readOnly || !creation.resultUrl) return;
    const dto = {
      id: -Math.abs(hashToInt(creation.id)),
      name,
      modelUrl: creation.resultUrl,
      previewImage: creation.thumbnailUrl,
      widthMm: null,
      depthMm: null,
      heightMm,
      description: creation.refinedPrompt ?? `Generated from: ${creation.prompt}`,
    } as unknown as CatalogItemDto;

    cacheItems([dto]);
    setPendingItem(dto);
    toast('success', `${name} is ready — click the floor to place it. Hold Shift to place several.`);
  };

  /**
   * Put a generated image onto the surfaces in the plan that carry one.
   *
   * Every LED screen and artwork panel already placed, in one action, because
   * that is what "use this artwork" means once a stage has been built: the
   * designer is choosing what the room shows, not decorating one panel.
   *
   * With no such surface in the plan there is nothing to put it on, so one is
   * made — a free-standing 2 m graphic panel, in front of wherever the camera
   * is looking, which is the only placement that is guaranteed to be visible.
   */
  const placeImage = () => {
    if (readOnly || !creation.resultUrl) return;
    const url = creation.resultUrl;

    // Read at the moment of the click rather than subscribed to — see the note
    // on `surfaceCount`.
    const objects = useEditor.getState().scene.objects;
    const led = objects.filter((o) => o.type === 'led').map((o) => o.id);
    const art = objects.filter((o) => o.type === 'artwork').map((o) => o.id);

    if (led.length || art.length) {
      if (led.length) updateObjects(led, { contentUrl: url } as Partial<LedScreenSceneObject>);
      if (art.length) updateObjects(art, { imageUrl: url } as Partial<ArtworkSceneObject>);
      const total = led.length + art.length;
      toast('success', `Shown on ${total} surface${total === 1 ? '' : 's'} in the plan.`, {
        label: 'Undo',
        onClick: () => useEditor.getState().undo(),
      });
      return;
    }

    /*
     * Where a panel with nothing to hang on goes.
     *
     * Three metres in front of where the camera is looking, on the floor. The
     * origin is the wrong answer — on a plan already laid out that is under a
     * table — and so is the camera's own position, which puts the panel inside
     * the viewer. In front of the view is the one place it is certain to be
     * seen the moment it appears.
     */
    const camera = currentCamera();
    const spot = camera
      ? { x: Math.round(camera.targetMm.x), z: Math.round(camera.targetMm.z) }
      : { x: 0, z: 0 };

    addObjects([
      {
        ...DEFAULT_ARTWORK,
        id: crypto.randomUUID(),
        type: 'artwork',
        name,
        imageUrl: url,
        sourceLabel: 'Generated in Novira',
        license: 'Yours to use',
        widthMm: 3000,
        heightMm: 2000,
        aspectRatio: 1.5,
        mount: 'free',
        positionMm: { x: spot.x, y: 0, z: spot.z },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      } as ArtworkSceneObject as SceneObject,
    ]);
    toast('success', 'Placed as a graphic panel — move it or mount it on a wall from the properties panel.');
  };

  /** Keep it in the catalogue, for other plans. */
  const saveToLibrary = async () => {
    if (!creation.resultUrl) return;
    onBusy(creation.id);
    try {
      await assets.import({
        assetType: creation.kind === 'model' ? 'model' : 'image',
        source: 'novira-ai',
        sourceLabel: 'Generated in Novira',
        sourceAssetId: creation.id,
        name,
        description: creation.refinedPrompt ?? undefined,
        modelUrl: creation.kind === 'model' ? creation.resultUrl : null,
        thumbnailUrl: creation.thumbnailUrl,
        imageUrl: creation.kind === 'image' ? creation.resultUrl : null,
        license: 'Generated · yours to use',
        loadableInScene: creation.kind === 'model',
      } as never);
      setSaved(true);
      toast('success', 'Kept in your library — it is in Create → My assets for every plan.');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'That could not be saved.');
    } finally {
      onBusy(null);
    }
  };

  const remove = async () => {
    onBusy(creation.id);
    try {
      await studio.removeCreation(creation.id);
      onChanged();
      toast('success', 'Removed. Anything already placed keeps working.');
    } catch {
      toast('error', 'That could not be removed.');
    } finally {
      onBusy(null);
    }
  };

  /*
   * What this card hands the viewport when it is dragged into it.
   *
   * The same payload shapes the catalogue and the online libraries already use,
   * so a generated asset inherits the whole drop interaction rather than needing
   * a parallel one: the ghost that stands on the floor at full size, the
   * surface-height search that puts it on a stage rather than inside one, the
   * snap, and — for an image — the decal behaviour when it is released over an
   * object rather than over the floor.
   *
   * A model is dragged as a `catalog` item because that is what it becomes once
   * placed. An image is dragged as an `image`, which is the payload that knows
   * how to become either a printed panel or a graphic on a surface.
   */
  const dragPayload: DragPayload | null = !usable || !creation.resultUrl
    ? null
    : creation.kind === 'model'
      ? {
          kind: 'catalog',
          item: {
            id: -Math.abs(hashToInt(creation.id)),
            name,
            modelUrl: creation.resultUrl,
            previewImage: creation.thumbnailUrl,
            widthMm: null,
            depthMm: null,
            heightMm,
            description: creation.refinedPrompt ?? `Generated from: ${creation.prompt}`,
          } as unknown as CatalogItemDto,
        }
      : {
          kind: 'image',
          asset: {
            source: 'novira-ai',
            sourceAssetId: creation.id,
            name,
            imageUrl: creation.resultUrl,
            thumbnailUrl: creation.thumbnailUrl,
            sourceLabel: 'Generated in Novira',
            license: 'Yours to use',
          } as unknown as ProviderAsset,
        };

  return (
    <figure
      {...(dragPayload ? draggableProps(dragPayload) : {})}
      className={`group relative flex flex-col overflow-hidden rounded-xl border border-line bg-surface ${
        dragPayload && !readOnly ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
      title={
        dragPayload && !readOnly
          ? creation.kind === 'model'
            ? 'Drag into the plan, or use the button below'
            : 'Drag onto an object to print it on, or onto the floor for a standing panel'
          : undefined
      }
    >
      <span className="relative block aspect-square w-full overflow-hidden bg-surface-sunken">
        {creation.thumbnailUrl || (creation.kind === 'image' && creation.resultUrl) ? (
          <img
            src={creation.thumbnailUrl ?? creation.resultUrl ?? undefined}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            {creation.kind === 'model' ? (
              <Boxes className="h-5 w-5 text-ink-subtle" />
            ) : (
              <ImageIcon className="h-5 w-5 text-ink-subtle" />
            )}
          </span>
        )}

        <span className="absolute left-1.5 top-1.5 rounded bg-ink/70 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white backdrop-blur">
          {creation.kind === 'model' ? '3D' : '2D'}
        </span>

        {pending ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-surface/85 backdrop-blur">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-[10px] font-bold tabular-nums text-ink-muted">{creation.progress}%</span>
          </span>
        ) : null}

        {failed ? (
          <span className="absolute inset-x-1.5 bottom-1.5 rounded bg-danger/90 px-1.5 py-0.5 text-center text-[9px] font-bold text-white">
            Failed · refunded
          </span>
        ) : null}

        {/*
          The drag hint, on hover.

          Dragging is the faster gesture and the one a designer coming from any
          other library in this product will try first — but nothing about a
          tile announces that it can be dragged, so it needs saying. It appears
          on hover rather than permanently, because a card carrying a permanent
          instruction is a card that has stopped being a picture of the thing.
        */}
        {usable && !readOnly ? (
          <span className="pointer-events-none absolute inset-x-1.5 bottom-1.5 rounded-md bg-ink/70 px-1.5 py-0.5 text-center text-[9px] font-semibold text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
            {creation.kind === 'model' ? 'Drag into the plan' : 'Drag onto an object'}
          </span>
        ) : null}

        {usable ? (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="absolute right-1.5 top-1.5 rounded-md bg-surface/90 p-1 text-ink-subtle opacity-0 shadow-btn transition hover:text-danger group-hover:opacity-100"
            aria-label={`Remove ${name}`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        ) : null}
      </span>

      <figcaption className="flex min-w-0 flex-1 flex-col border-t border-line p-2">
        <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-ink" title={creation.prompt}>
          {creation.prompt || 'Untitled'}
        </p>

        {usable && creation.kind === 'model' ? (
          <label className="mt-1.5 block">
            {/*
              The height, stated before it is placed.

              This is the whole difference between a generated mesh and a
              usable one. The generator returns geometry at an arbitrary scale,
              and a plan drawn in millimetres cannot take that — so the figure
              is offered, editable, at the moment it matters, rather than left
              to be discovered after a four-metre chair is standing in the room.
            */}
            <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-subtle">
              How tall is it?
            </span>
            <span className="mt-0.5 flex items-center gap-1">
              <input
                type="number"
                min={50}
                max={30000}
                step={10}
                className="ed-field w-full tabular-nums"
                value={heightMm}
                onChange={(e) => onHeight(Number(e.target.value) || heightMm)}
              />
              <span className="text-[10px] text-ink-subtle">mm</span>
            </span>
          </label>
        ) : null}

        {usable ? (
          <div className="mt-1.5 space-y-1">
            {creation.kind === 'model' ? (
              <button
                type="button"
                className="ai-btn-primary w-full px-2 py-1.5 text-[11px]"
                onClick={placeModel}
                disabled={readOnly}
              >
                <Plus className="h-3 w-3" /> Place in the room
              </button>
            ) : (
              <button
                type="button"
                className="ai-btn-primary w-full px-2 py-1.5 text-[11px]"
                onClick={placeImage}
                disabled={readOnly}
                title={
                  surfaceCount
                    ? `Show it on the ${surfaceCount} screen${
                        surfaceCount === 1 ? '' : 's'
                      } and panel${surfaceCount === 1 ? '' : 's'} in this plan`
                    : 'Stand it in the plan as a graphic panel'
                }
              >
                <MonitorPlay className="h-3 w-3" />
                {surfaceCount ? `Show on ${surfaceCount}` : 'Put it in the room'}
              </button>
            )}

            <button
              type="button"
              className="ai-btn w-full border border-line px-2 py-1 text-[10px]"
              onClick={() => void saveToLibrary()}
              disabled={busy || saved}
            >
              {saved ? <Check className="h-3 w-3 text-success" /> : null}
              {saved ? 'In your library' : 'Keep for other plans'}
            </button>
          </div>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * A stable small integer from a creation's id.
 *
 * Used only to give a generated model a catalogue id that cannot collide with
 * a real row (it is negated by the caller) and that is the same every time the
 * same asset is armed — so re-placing one does not add a new cache entry per
 * click. A weak hash is entirely adequate: a collision costs a shared cache
 * entry between two generated assets, and the model URL is carried on the
 * placement itself regardless.
 */
function hashToInt(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  // Kept well inside a safe integer range, and never zero.
  return (Math.abs(hash) % 2_000_000_000) + 1;
}
