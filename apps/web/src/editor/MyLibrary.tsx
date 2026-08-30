import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, FolderOpen, Trash2 } from 'lucide-react';
import { formatLength, type CatalogItemDto } from '@novira/shared';
import { assets } from '../lib/assetsApi';
import { LazyImage } from '../components/LazyImage';
import { useEditor } from './editorStore';
import { draggableProps } from './useDropTarget';
import { toast } from '../components/ui';

/**
 * What this account has imported from an online library and copied onto our
 * own storage — measured, permanent, and usable in any plan.
 *
 * Removing one would break every plan that already placed it, so it is
 * deactivated rather than deleted and the panel says so.
 */
export function MyLibrary() {
  const queryClient = useQueryClient();
  const units = useEditor((s) => s.units);
  const cacheItems = useEditor((s) => s.cacheItems);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['assets', 'imported'],
    queryFn: () => assets.imported(),
    staleTime: 60_000,
  });

  useMemo(() => {
    if (items.length) cacheItems(items);
    return null;
  }, [items, cacheItems]);

  const remove = useMutation({
    mutationFn: (id: number) => assets.removeImported(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets', 'imported'] });
      toast('success', 'Removed from your library. Plans that already use it are unaffected.');
    },
    onError: () => toast('error', 'That could not be removed.'),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-1.5 p-3" aria-hidden>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="overflow-hidden rounded-lg border border-line">
            <div className="nv-shimmer aspect-square w-full bg-surface-muted" />
            <div className="border-t border-line p-2">
              <div className="h-2 w-3/4 rounded bg-surface-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="px-5 py-12 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-muted text-ink-subtle">
          <FolderOpen className="h-5 w-5" />
        </span>
        <p className="mt-3 text-sm font-semibold text-ink">Nothing imported yet</p>
        <p className="mx-auto mt-1 max-w-[230px] text-xs leading-relaxed text-ink-subtle">
          Drag a model from the Online tab into the plan and it is copied here — measured, permanent, and usable in
          every project.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((item) => (
          <ImportedCard key={item.id} item={item} units={units} onRemove={() => remove.mutate(item.id)} />
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-ink-subtle">
        Removing an item takes it out of this list. Plans that already use it keep working — the model is kept so a
        saved layout never loses a piece.
      </p>
    </div>
  );
}

function ImportedCard({
  item,
  units,
  onRemove,
}: {
  item: CatalogItemDto;
  units: 'metric' | 'imperial';
  onRemove: () => void;
}) {
  const setPendingItem = useEditor((s) => s.setPendingItem);

  const dims = [item.widthMm, item.depthMm, item.heightMm]
    .filter((v): v is number => typeof v === 'number')
    .map((v) => formatLength(v, units, { bare: units === 'metric' }))
    .join(' × ');

  return (
    <figure
      {...draggableProps({ kind: 'catalog', item })}
      className="group relative cursor-grab overflow-hidden rounded-lg border border-line bg-surface transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-card active:cursor-grabbing"
      onClick={() => setPendingItem(item)}
      title={`${item.name}${dims ? ` — ${dims}` : ''}`}
    >
      <LazyImage
        src={item.previewImage}
        alt={item.name}
        ratio="1 / 1"
        wrapperClassName="w-full"
        fallback={<Box className="h-5 w-5 text-ink-subtle/60" />}
      />
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        className="absolute right-1.5 top-1.5 rounded bg-surface/90 p-1 text-ink-subtle opacity-0 shadow-btn transition hover:text-danger group-hover:opacity-100"
        aria-label={`Remove ${item.name} from your library`}
      >
        <Trash2 className="h-3 w-3" />
      </button>
      <figcaption className="border-t border-line px-2 py-1.5">
        <p className="truncate text-[11px] font-semibold leading-tight text-ink">{item.name}</p>
        {dims ? <p className="mt-0.5 truncate text-[9px] tabular-nums text-success">{dims}</p> : null}
        {item.sourceLabel ? (
          <p className="mt-0.5 truncate text-[9px] text-ink-subtle">{item.sourceLabel}</p>
        ) : null}
      </figcaption>
    </figure>
  );
}
