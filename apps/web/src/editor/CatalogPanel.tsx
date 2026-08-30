import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Box, Eye, Loader2, Lock, Search, ShieldCheck, X } from 'lucide-react';
import { formatLength, type CatalogItemDto } from '@novira/shared';
import { api } from '../lib/api';
import { useEditor } from './editorStore';
import { LazyImage } from '../components/LazyImage';
import { toast } from '../components/ui';
import { draggableProps } from './useDropTarget';
import { useDrag } from './dragStore';
import { ModelPreview, type PreviewSubject } from './ModelPreview';

/**
 * The measured catalogue.
 *
 * Everything here has been through the ingestion pipeline: the file was
 * downloaded, opened, measured, and its real width, depth and height written
 * down. That is what separates it from the online libraries next door — a
 * chair from this list is 470 mm wide because someone measured it, not because
 * its title said "chair".
 *
 * Which is why it stays the default tab even though it is a thousandth the
 * size. A plan built from measured objects can be costed, checked for
 * clearance and handed to a workshop; one built from whatever looked right
 * cannot.
 */

const PAGE_SIZE = 60;

export function CatalogPanel() {
  const [categorySlug, setCategorySlug] = useState('');
  const [rawSearch, setRawSearch] = useState('');
  const search = useDebounced(rawSearch, 260);

  const cacheItems = useEditor((s) => s.cacheItems);
  const units = useEditor((s) => s.units);
  /* Inspecting before placing — see ModelPreview for why a thumbnail is not enough. */
  const [inspecting, setInspecting] = useState<CatalogItemDto | null>(null);

  const { data: categories } = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: api.catalog.categories,
    staleTime: 10 * 60_000,
  });

  const feed = useInfiniteQuery({
    queryKey: ['catalog', 'items', categorySlug, search],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.catalog.items({
        categorySlug: categorySlug || undefined,
        q: search || undefined,
        limit: PAGE_SIZE,
        offset: pageParam as number,
      }),
    getNextPageParam: (last, pages) =>
      last.hasMore ? pages.reduce((sum, page) => sum + page.items.length, 0) : undefined,
    staleTime: 5 * 60_000,
  });

  const items = useMemo(() => (feed.data?.pages ?? []).flatMap((page) => page.items), [feed.data]);

  // Keep the viewport's cache warm so a placed model renders immediately.
  useEffect(() => {
    if (items.length) cacheItems(items);
  }, [items, cacheItems]);

  const populated = useMemo(() => (categories ?? []).filter((c) => (c.itemCount ?? 0) > 0), [categories]);
  const total = feed.data?.pages?.[0]?.total ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 px-3 pb-2 pt-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
          <input
            className="ed-field pl-8 pr-8"
            placeholder="Search the measured catalogue…"
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            aria-label="Search the catalogue"
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

        <div className="nv-no-scrollbar -mx-1 overflow-x-auto px-1">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setCategorySlug('')}
              className={`chip shrink-0 ${categorySlug === '' ? 'chip-active' : ''}`}
            >
              Everything
            </button>
            {populated.map((category) => (
              <button
                key={category.slug}
                type="button"
                onClick={() => setCategorySlug(category.slug)}
                className={`chip shrink-0 whitespace-nowrap ${categorySlug === category.slug ? 'chip-active' : ''}`}
              >
                {category.name}
                <span className="opacity-60">{category.itemCount}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {total ? (
        <p className="shrink-0 px-3 pb-1.5 text-[10px] tabular-nums text-ink-subtle">
          {items.length} of {total} measured items
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {feed.isLoading ? (
          <CatalogSkeleton />
        ) : !items.length ? (
          <p className="px-1 py-10 text-center text-xs leading-relaxed text-ink-subtle">
            {search
              ? `Nothing in the measured catalogue matches “${search}”. The online libraries next door will have it.`
              : 'Nothing in this category yet.'}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              {items.map((item, index) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  units={units}
                  eager={index < 8}
                  onInspect={() => setInspecting(item)}
                />
              ))}
            </div>

            <InfiniteSentinel
              onVisible={() => {
                if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
              }}
            />

            {feed.isFetchingNextPage ? (
              <p className="flex items-center justify-center gap-1.5 py-3 text-[11px] text-ink-subtle">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading more…
              </p>
            ) : null}
          </>
        )}
      </div>

      <ModelPreview
        open={Boolean(inspecting)}
        subject={inspecting ? catalogSubject(inspecting) : null}
        onClose={() => setInspecting(null)}
        addLabel="Place it in the plan"
        onAdd={
          inspecting
            ? () => {
                setPendingItemFromCatalogue(inspecting);
                setInspecting(null);
              }
            : undefined
        }
      />
    </div>
  );
}

/** Arm a catalogue item so the next click on the floor places it. */
function setPendingItemFromCatalogue(item: CatalogItemDto) {
  useEditor.getState().cacheItems([item]);
  useEditor.getState().setPendingItem(item);
  toast('info', `Click the floor to place ${item.name}.`);
}

/** A catalogue row, described for the preview window. */
function catalogSubject(item: CatalogItemDto): PreviewSubject {
  return {
    modelUrl: item.modelUrl,
    imageUrl: item.previewImage,
    name: item.name,
    description: item.description,
    sourceLabel: item.sourceLabel,
    license: item.license,
    attribution: item.attribution,
    dimensionsMm: { width: item.widthMm, depth: item.depthMm, height: item.heightMm },
    meta: [
      { label: 'Category', value: item.categorySlug.replace(/-/g, ' ') },
      ...(item.seatsDefault ? [{ label: 'Seats', value: String(item.seatsDefault) }] : []),
    ],
  };
}

/* ── One item ──────────────────────────────────────────────────────────── */

function ItemCard({
  item,
  units,
  eager,
  onInspect,
}: {
  item: CatalogItemDto;
  units: 'metric' | 'imperial';
  eager: boolean;
  onInspect: () => void;
}) {
  const pendingItem = useEditor((s) => s.pendingItem);
  const setPendingItem = useEditor((s) => s.setPendingItem);
  const dragging = useDrag((s) => s.payload);

  const locked = !item.isAccessible;
  const armed = pendingItem?.id === item.id;
  const isDragged = dragging?.kind === 'catalog' && dragging.item.id === item.id;

  const dims = [item.widthMm, item.depthMm, item.heightMm]
    .filter((v): v is number => typeof v === 'number')
    .map((v) => formatLength(v, units, { bare: units === 'metric' }))
    .join(' × ');

  const drag = locked ? {} : draggableProps({ kind: 'catalog', item });

  return (
    <figure
      {...drag}
      role="button"
      tabIndex={locked ? -1 : 0}
      aria-pressed={armed}
      onClick={() => {
        if (locked) return;
        setPendingItem(armed ? null : item);
      }}
      onKeyDown={(event) => {
        if (locked) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setPendingItem(armed ? null : item);
        }
      }}
      title={
        locked
          ? 'This model is available on Plus and Pro plans.'
          : `${item.name}${dims ? ` — ${dims}` : ''}. Drag into the plan, or click then click the floor.`
      }
      className={`group relative overflow-hidden rounded-lg border bg-surface text-left outline-none transition ${
        locked
          ? 'cursor-not-allowed border-line opacity-55'
          : isDragged || armed
            ? 'cursor-grab border-primary ring-2 ring-primary/30'
            : 'cursor-grab border-line hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-card focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40 active:cursor-grabbing'
      }`}
    >
      <LazyImage
        src={item.previewImage}
        alt={item.name}
        eager={eager}
        ratio="1 / 1"
        wrapperClassName="w-full"
        fallback={<Box className="h-5 w-5 text-ink-subtle/60" />}
      />

      {locked ? (
        <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-ink/75 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur">
          <Lock className="h-2.5 w-2.5" /> Plus
        </span>
      ) : null}

      {armed ? (
        <span className="absolute right-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-fg">
          Click the floor
        </span>
      ) : !locked ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onInspect();
          }}
          className="absolute right-1.5 top-1.5 rounded-md bg-surface/90 p-1 text-ink-subtle opacity-0 shadow-btn transition hover:text-ink group-hover:opacity-100"
          title="Open a full preview"
          aria-label={`Inspect ${item.name}`}
        >
          <Eye className="h-3 w-3" />
        </button>
      ) : null}

      <figcaption className="border-t border-line px-2 py-1.5">
        <p className="truncate text-[11px] font-semibold leading-tight text-ink">{item.name}</p>
        {dims ? <p className="mt-0.5 truncate text-[9px] tabular-nums text-success">{dims}</p> : null}
        {item.sourceLabel ? (
          <p className="mt-0.5 flex items-center gap-1 truncate text-[9px] text-ink-subtle">
            <ShieldCheck className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{item.sourceLabel}</span>
          </p>
        ) : null}
      </figcaption>
    </figure>
  );
}

/* ── Chrome ────────────────────────────────────────────────────────────── */

function CatalogSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-1.5" aria-hidden>
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-lg border border-line">
          <div className="nv-shimmer aspect-square w-full bg-surface-muted" />
          <div className="space-y-1 border-t border-line p-2">
            <div className="h-2 w-3/4 rounded bg-surface-muted" />
            <div className="h-1.5 w-1/2 rounded bg-surface-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Fires a callback when scrolled near, so the next page loads before the end. */
function InfiniteSentinel({ onVisible }: { onVisible: () => void }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onVisible();
      },
      { rootMargin: '600px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, onVisible]);

  return <div ref={setNode} className="h-4" aria-hidden />;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
