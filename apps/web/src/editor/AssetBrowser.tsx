import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  Box,
  Check,
  ExternalLink,
  Eye,
  Image as ImageIcon,
  Loader2,
  Lock,
  RotateCw,
  Search,
  Sun,
  X,
} from 'lucide-react';
import { assets, type AssetCategory, type ProviderAsset, type Shelf } from '../lib/assetsApi';
import { LazyImage } from '../components/LazyImage';
import { ModelPreview, type PreviewSubject } from './ModelPreview';
import { useAssetFeed, useWarmShelves } from './useAssetFeed';
import { draggableProps, materialPayloadFromAsset } from './useDropTarget';
import { useDrag } from './dragStore';

/**
 * The online library.
 *
 * One component serves models, materials, environments and reference images,
 * because they differ only in what a row *is* — everything about finding one is
 * identical, and three near-copies of a search-and-scroll surface is how a
 * product ends up with three subtly different behaviours nobody intended.
 *
 * Two decisions carry most of the design:
 *
 *  · **Shelves before search.** A search box facing an empty grid demands that
 *    you already know what exists across eighteen libraries. Shelves are a
 *    curated first answer — "Seating", "Exhibition stands", "Flooring" — and
 *    the search box is there for when browsing runs out. Underneath they are
 *    the same query, so there is no second ranking to keep in step.
 *
 *  · **Nothing is hidden about access.** A Sketchfab model that needs an
 *    account says so on the row and offers the link, rather than accepting a
 *    drag and failing afterwards. A library that over-promises is worse than a
 *    smaller one that does not.
 */

export function AssetBrowser({
  category,
  /** Restrict to rows the viewport can actually load. */
  usableOnly,
  /** Extra shelves to offer above the built-in ones. */
  emptyHint,
}: {
  category: AssetCategory;
  usableOnly?: boolean;
  emptyHint?: string;
}) {
  const [shelfKey, setShelfKey] = useState<string | null>(null);
  const [rawSearch, setRawSearch] = useState('');
  /*
   * Inspecting before committing.
   *
   * A thumbnail is one angle a stranger chose. For a 3D asset that is not
   * enough to decide with — you cannot see whether the back is modelled or
   * whether it is one object or three — so a card opens a real viewer.
   */
  const [inspecting, setInspecting] = useState<ProviderAsset | null>(null);
  const search = useDebounced(rawSearch, 320);

  const { data: shelves = [] } = useQuery({
    queryKey: ['asset-shelves', category],
    queryFn: () => assets.shelves(category),
    staleTime: 60 * 60_000,
  });

  // Open on the first shelf rather than on an unfiltered firehose: the default
  // query is a hundred-word catch-all, and its results are correspondingly
  // unfocused. A named shelf is a better first impression.
  useEffect(() => {
    if (!shelfKey && shelves.length) setShelfKey(shelves[0]!.key);
  }, [shelves, shelfKey]);

  const shelf = shelves.find((s) => s.key === shelfKey) ?? null;
  const query = search.trim() || shelf?.query || '';

  const feed = useAssetFeed({
    category,
    query,
    usable: usableOnly,
    enabled: Boolean(query) || !shelves.length,
  });

  /*
   * Warm the neighbouring shelves.
   *
   * Someone browsing shelf 3 is far more likely to open 2 or 4 next than
   * shelf 12, so those are the ones worth paying for in advance. Warming all
   * of them would mean eighteen provider fan-outs for a panel the user may
   * close in five seconds.
   */
  const neighbours = useMemo(() => {
    if (search.trim() || !shelf) return [];
    const index = shelves.findIndex((s) => s.key === shelf.key);
    return [shelves[index + 1], shelves[index + 2], shelves[index - 1]]
      .filter((s): s is Shelf => Boolean(s))
      .map((s) => ({ category, query: s.query, usable: usableOnly }));
  }, [shelves, shelf, search, category, usableOnly]);

  useWarmShelves(neighbours, neighbours.length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Search ─────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 pb-2 pt-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
          <input
            className="ed-field pl-8 pr-8"
            placeholder={placeholderFor(category)}
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            aria-label={`Search ${category}`}
          />
          {rawSearch ? (
            <button
              type="button"
              onClick={() => setRawSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-subtle hover:text-ink"
              aria-label="Clear the search"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Shelves ────────────────────────────────────────────────── */}
      {shelves.length && !search.trim() ? (
        <div className="shrink-0 pb-2">
          <div className="nv-no-scrollbar flex gap-1.5 overflow-x-auto px-3 pb-0.5">
            {shelves.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setShelfKey(entry.key)}
                title={entry.note}
                className={`chip shrink-0 whitespace-nowrap transition ${
                  entry.key === shelfKey ? 'chip-active' : 'hover:border-line-strong'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* ── Count ──────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-1.5 text-[10px] text-ink-subtle">
        {feed.isLoading ? (
          <span className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Searching the libraries…
          </span>
        ) : feed.total ? (
          <>
            <span className="tabular-nums">
              {feed.items.length.toLocaleString()} of {feed.total.toLocaleString()}
            </span>
            {shelf && !search.trim() ? <span className="truncate">· {shelf.note}</span> : null}
          </>
        ) : null}
      </div>

      {/* ── Results ────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {feed.isLoading ? (
          <ResultsSkeleton category={category} />
        ) : feed.error ? (
          <FeedError onRetry={feed.refetch} />
        ) : !feed.items.length ? (
          <p className="px-1 py-10 text-center text-xs leading-relaxed text-ink-subtle">
            {search.trim()
              ? `Nothing matched “${search.trim()}”. Try a simpler word — the libraries index by object name, not by description.`
              : (emptyHint ?? 'No results from the libraries just now.')}
          </p>
        ) : (
          <>
            <div className={gridFor(category)}>
              {feed.items.map((asset, index) => (
                <AssetCard
                  key={`${asset.source}:${asset.sourceAssetId}:${index}`}
                  asset={asset}
                  category={category}
                  eager={index < 8}
                  onInspect={() => setInspecting(asset)}
                />
              ))}
            </div>

            {/*
              The sentinel sits inside the scroll container and fires 800 px
              early, so the next page is already in flight while there is still
              a screenful left to look at.
            */}
            <div ref={feed.sentinelRef} className="h-4" aria-hidden />

            {feed.isFetchingNextPage ? (
              <p className="flex items-center justify-center gap-1.5 py-3 text-[11px] text-ink-subtle">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading more…
              </p>
            ) : !feed.hasNextPage && feed.items.length > 12 ? (
              <p className="py-3 text-center text-[11px] text-ink-subtle">
                That is everything for this search.
              </p>
            ) : null}
          </>
        )}
      </div>

      <ModelPreview
        open={Boolean(inspecting)}
        subject={inspecting ? subjectFor(inspecting) : null}
        onClose={() => setInspecting(null)}
      />
    </div>
  );
}

/** An online row, described for the preview window. */
function subjectFor(asset: ProviderAsset): PreviewSubject {
  const usable = asset.applicableInEditor ?? asset.loadableInScene ?? false;
  return {
    modelUrl: asset.assetType === 'model' && usable ? asset.modelUrl ?? null : null,
    imageUrl: asset.imageUrl ?? asset.thumbnailUrl ?? null,
    name: asset.name,
    description: asset.description,
    sourceLabel: asset.sourceLabel,
    license: asset.license,
    attribution: asset.attribution,
    externalUrl: asset.purchaseUrl ?? asset.viewerUrl ?? null,
    meta: [
      { label: 'Availability', value: asset.accessLabel ?? (usable ? 'Ready to use' : 'External') },
      ...(asset.faceCount || asset.triangleCount
        ? [{ label: 'Triangles', value: (asset.faceCount ?? asset.triangleCount ?? 0).toLocaleString() }]
        : []),
      ...(asset.imageWidth && asset.imageHeight
        ? [{ label: 'Pixels', value: `${asset.imageWidth} × ${asset.imageHeight}` }]
        : []),
    ],
  };
}

/* ── One row ───────────────────────────────────────────────────────────── */

function AssetCard({
  asset,
  category,
  eager,
  onInspect,
}: {
  asset: ProviderAsset;
  category: AssetCategory;
  eager: boolean;
  onInspect: () => void;
}) {
  const dragging = useDrag((s) => s.payload);
  const usable = asset.applicableInEditor ?? asset.loadableInScene ?? false;
  const external = !usable && (asset.purchaseUrl || asset.viewerUrl);

  const payload = useMemo(() => {
    if (category === 'materials') return materialPayloadFromAsset(asset);
    if (category === 'hdris') return { kind: 'hdri' as const, asset };
    if (category === 'images') return { kind: 'image' as const, asset };
    return { kind: 'asset' as const, asset };
  }, [asset, category]);

  const isDragged =
    dragging &&
    ((dragging.kind === 'material' && dragging.finish.materialId === `${asset.source}:${asset.sourceAssetId}`) ||
      ('asset' in dragging && dragging.asset === asset));

  const drag = usable ? draggableProps(payload) : {};

  const thumb = asset.thumbnailUrl ?? asset.imageUrl ?? null;

  return (
    <figure
      {...drag}
      title={`${asset.name} — ${asset.sourceLabel}${asset.license ? ` · ${asset.license}` : ''}`}
      className={`group relative overflow-hidden rounded-lg border bg-surface transition ${
        isDragged
          ? 'border-primary ring-2 ring-primary/30'
          : usable
            ? 'cursor-grab border-line hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-card active:cursor-grabbing'
            : 'border-line'
      }`}
    >
      <button
        type="button"
        onClick={onInspect}
        className="block w-full"
        aria-label={`Inspect ${asset.name}`}
        title="Open a full preview"
      >
        <LazyImage
          src={thumb}
          alt={asset.name}
          eager={eager}
          ratio={category === 'images' ? '3 / 4' : '1 / 1'}
          wrapperClassName="w-full"
          fallback={<PlaceholderIcon category={category} />}
        />
      </button>

      {/* The access badge. Always present, never a surprise at drop time. */}
      {!usable ? (
        <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-ink/75 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur">
          <Lock className="h-2.5 w-2.5" />
          {asset.accessLabel ?? 'External'}
        </span>
      ) : null}

      <figcaption className="border-t border-line px-2 py-1.5">
        <p className="truncate text-[11px] font-semibold leading-tight text-ink">{asset.name}</p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-[9px] text-ink-subtle">
          <span className="truncate">{asset.sourceLabel}</span>
          {asset.license ? <span className="truncate opacity-70">· {asset.license}</span> : null}
        </p>
      </figcaption>

      {/*
        The hover affordance. A card that can be dragged says so; one that
        cannot offers the only thing it can — the link to where it lives.
      */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[38px] flex justify-center gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={onInspect}
          className="pointer-events-auto flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[9px] font-bold text-ink shadow-btn"
        >
          <Eye className="h-2.5 w-2.5" /> Inspect
        </button>
        {usable ? (
          <span className="rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold text-primary-fg shadow-btn">
            Drag in
          </span>
        ) : external ? (
          <a
            href={asset.purchaseUrl ?? asset.viewerUrl ?? '#'}
            target="_blank"
            rel="noreferrer noopener"
            className="pointer-events-auto flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[9px] font-bold text-ink shadow-btn"
          >
            <ExternalLink className="h-2.5 w-2.5" /> Open source
          </a>
        ) : null}
      </div>
    </figure>
  );
}

function PlaceholderIcon({ category }: { category: AssetCategory }) {
  const Icon = category === 'images' ? ImageIcon : category === 'hdris' ? Sun : Box;
  return <Icon className="h-5 w-5 text-ink-subtle/60" />;
}

/* ── Chrome ────────────────────────────────────────────────────────────── */

function ResultsSkeleton({ category }: { category: AssetCategory }) {
  return (
    <div className={gridFor(category)} aria-hidden>
      {Array.from({ length: 9 }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-lg border border-line">
          <div
            className="nv-shimmer w-full bg-surface-muted"
            style={{ aspectRatio: category === 'images' ? '3 / 4' : '1 / 1' }}
          />
          <div className="space-y-1 border-t border-line p-2">
            <div className="h-2 w-3/4 rounded bg-surface-muted" />
            <div className="h-1.5 w-1/2 rounded bg-surface-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="px-2 py-10 text-center">
      <AlertCircle className="mx-auto h-5 w-5 text-warning" />
      <p className="mt-2 text-xs font-semibold text-ink">The libraries did not answer</p>
      <p className="mx-auto mt-1 max-w-[220px] text-[11px] leading-relaxed text-ink-subtle">
        This is usually one provider timing out. Trying again normally works, and the built-in catalogue is
        unaffected.
      </p>
      <button type="button" className="btn-secondary btn-sm mx-auto mt-3" onClick={onRetry}>
        <RotateCw className="h-3 w-3" /> Try again
      </button>
    </div>
  );
}

function gridFor(category: AssetCategory): string {
  // Images get a tighter, taller grid: they are scanned, not read.
  return category === 'images' ? 'grid grid-cols-2 gap-1.5' : 'grid grid-cols-2 gap-1.5';
}

function placeholderFor(category: AssetCategory): string {
  switch (category) {
    case 'materials':
      return 'Search materials — oak, brushed steel, carpet…';
    case 'hdris':
      return 'Search environments — studio, sunset, warehouse…';
    case 'images':
      return 'Search reference — stage design, brand wall…';
    default:
      return 'Search millions of models — chair, truss, kiosk…';
  }
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/* ── The provider list, for the panel footer ───────────────────────────── */

/**
 * Which libraries are being searched.
 *
 * Worth showing, and worth computing rather than typing into a heading: it is
 * the difference between "we have a lot of models" and a checkable claim, and
 * it is where someone finds out that Sketchfab downloads need a key on this
 * server.
 */
export function ProviderSummary({ category }: { category: AssetCategory }) {
  const { data } = useQuery({
    queryKey: ['asset-providers'],
    queryFn: () => assets.providers(),
    staleTime: 60 * 60_000,
  });
  const [open, setOpen] = useState(false);

  if (!data) return null;
  const relevant = data.items.filter((p) => p.supplies.includes(category));
  const live = relevant.filter((p) => p.configured);

  return (
    <div className="shrink-0 border-t border-line px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-[10px] text-ink-subtle hover:text-ink"
        aria-expanded={open}
      >
        <span className="flex h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
        <span className="flex-1 truncate">
          Searching {live.length} of {relevant.length} libraries
        </span>
        <span className="underline decoration-dotted">{open ? 'hide' : 'which?'}</span>
      </button>

      {open ? (
        <ul className="mt-2 space-y-1">
          {relevant.map((provider) => (
            <li key={provider.key} className="flex items-start gap-1.5 text-[10px] leading-snug">
              {provider.configured ? (
                <Check className="mt-0.5 h-2.5 w-2.5 shrink-0 text-success" />
              ) : (
                <Lock className="mt-0.5 h-2.5 w-2.5 shrink-0 text-ink-subtle" />
              )}
              <span className="min-w-0">
                <a
                  href={provider.homepage}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-semibold text-ink hover:text-primary"
                >
                  {provider.label}
                </a>
                <span className="block text-ink-subtle">
                  {provider.configured ? provider.note : `Needs ${provider.keyEnv} on the server.`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
