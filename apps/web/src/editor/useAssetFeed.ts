import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { assets, type AssetCategory, type AssetPage, type ProviderAsset } from '../lib/assetsApi';

/**
 * An endless library that is never waiting on you.
 *
 * Three separate mechanisms, and the difference between them is the whole
 * point — conflating them is what produces a grid that spins every time you
 * flick the wheel:
 *
 *  · **Infinite paging.** Pages come from one server-side ordering, so page 4
 *    really is the continuation of page 3. Merging eighteen independently
 *    paginated APIs client-side cannot do that; it produces duplicates and
 *    holes that look like bugs in the search.
 *
 *  · **A sentinel that fires early.** The trigger sits *before* the end of the
 *    list, with a generous root margin, so the next page starts loading while
 *    there is still a screenful left to look at. By the time the user reaches
 *    the bottom, there is no bottom.
 *
 *  · **Speculative warming.** The shelves nobody has opened yet are fetched
 *    quietly in the background, one at a time, after the page is idle. Opening
 *    a drawer then costs a cache read.
 *
 * Images are handled separately, by the `LazyImage` component — a thumbnail
 * must not be requested until it is near the viewport, or a 2,000-row grid
 * opens two thousand connections and stalls the page it was meant to speed up.
 */

const PAGE_SIZE = 48;

export interface AssetFeed {
  items: ProviderAsset[];
  total: number;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: unknown;
  /** Attach to a sentinel element near the end of the list. */
  sentinelRef: (node: HTMLElement | null) => void;
  loadMore: () => void;
  refetch: () => void;
}

export function assetFeedKey(category: AssetCategory, query: string, usable?: boolean) {
  return ['assets', category, query.trim().toLowerCase(), usable ?? 'auto'] as const;
}

export function useAssetFeed(params: {
  category: AssetCategory;
  query?: string;
  usable?: boolean;
  enabled?: boolean;
  pageSize?: number;
}): AssetFeed {
  const { category, query = '', usable, enabled = true, pageSize = PAGE_SIZE } = params;

  const result = useInfiniteQuery({
    queryKey: assetFeedKey(category, query, usable),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      assets.search({ category, q: query || undefined, offset: pageParam as number, limit: pageSize, usable }),
    getNextPageParam: (last: AssetPage) => (last.hasMore ? last.offset + last.items.length : undefined),
    enabled,
    /*
     * Five minutes. The upstream libraries do not change faster than that, and
     * a shorter window would re-run an eighteen-provider fan-out every time
     * someone switched tabs and came back.
     */
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });

  const items = useMemo(
    () => (result.data?.pages ?? []).flatMap((page) => page.items),
    [result.data]
  );

  const total = result.data?.pages?.[0]?.total ?? 0;

  /*
   * The sentinel.
   *
   * `rootMargin` is deliberately most of a screen: the request goes out while
   * the user is still a page away from the end, which is the difference
   * between "endless" and "loads when you hit the bottom".
   */
  const observer = useRef<IntersectionObserver | null>(null);
  const fetchRef = useRef(result);
  fetchRef.current = result;

  const sentinelRef = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    if (!node) return;
    observer.current = new IntersectionObserver(
      (entries) => {
        const r = fetchRef.current;
        if (entries.some((e) => e.isIntersecting) && r.hasNextPage && !r.isFetchingNextPage) {
          void r.fetchNextPage();
        }
      },
      { rootMargin: '800px 0px', threshold: 0 }
    );
    observer.current.observe(node);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return {
    items,
    total,
    isLoading: result.isLoading,
    isFetchingNextPage: result.isFetchingNextPage,
    hasNextPage: Boolean(result.hasNextPage),
    error: result.error,
    sentinelRef,
    loadMore: () => {
      if (result.hasNextPage && !result.isFetchingNextPage) void result.fetchNextPage();
    },
    refetch: () => void result.refetch(),
  };
}

/* ── Speculative warming ───────────────────────────────────────────────── */

/**
 * Fetch a shelf's first page into the cache without rendering it.
 *
 * Used for the shelves next to the open one, and on app boot for the shelves
 * the editor opens with. Failures are swallowed on purpose — this is work
 * nobody asked for, and a provider being down must not surface as an error on
 * a screen the user is not even looking at.
 */
export async function warmShelf(
  client: QueryClient,
  category: AssetCategory,
  query: string,
  usable?: boolean
): Promise<void> {
  const key = assetFeedKey(category, query, usable);
  if (client.getQueryData(key)) return;
  try {
    await client.prefetchInfiniteQuery({
      queryKey: key,
      initialPageParam: 0,
      queryFn: ({ pageParam }) =>
        assets.search({ category, q: query || undefined, offset: pageParam as number, limit: PAGE_SIZE, usable }),
      staleTime: 5 * 60_000,
    });
  } catch {
    /* speculative work never surfaces */
  }
}

/**
 * Warm a list of shelves in the background, gently.
 *
 * Sequential with a gap, and scheduled through `requestIdleCallback` where the
 * browser offers it, so speculation always yields to whatever the user is
 * actually doing. Returns a cancel function; a component that unmounts halfway
 * through must be able to stop the queue rather than keep spending bandwidth
 * for a screen that has gone.
 */
export function warmShelves(
  client: QueryClient,
  shelves: Array<{ category: AssetCategory; query: string; usable?: boolean }>,
  opts: { gapMs?: number } = {}
): () => void {
  const gapMs = opts.gapMs ?? 900;
  let cancelled = false;
  let timer: number | undefined;

  const idle = (fn: () => void) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (ric) ric(fn, { timeout: 3000 });
    else fn();
  };

  const step = (index: number) => {
    if (cancelled || index >= shelves.length) return;
    idle(() => {
      if (cancelled) return;
      const shelf = shelves[index]!;
      void warmShelf(client, shelf.category, shelf.query, shelf.usable).finally(() => {
        timer = window.setTimeout(() => step(index + 1), gapMs);
      });
    });
  };

  timer = window.setTimeout(() => step(0), 400);

  return () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
}

/** Warm a set of shelves for as long as the calling component is mounted. */
export function useWarmShelves(
  shelves: Array<{ category: AssetCategory; query: string; usable?: boolean }>,
  enabled = true
) {
  const client = useQueryClient();
  // Compared by value: the caller almost always builds this array inline, and
  // an identity comparison would restart the queue on every render.
  const signature = shelves.map((s) => `${s.category}:${s.query}:${s.usable ?? ''}`).join('|');

  useEffect(() => {
    if (!enabled || !shelves.length) return;
    return warmShelves(client, shelves);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, signature, enabled]);
}
