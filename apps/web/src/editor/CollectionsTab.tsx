import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import type { SceneObject } from '@novira/shared';
import { http } from '../lib/api';
import { useEditor } from './editorStore';
import { Spinner } from '../components/Spinner';

interface CollectionRow {
  id: number;
  scope: 'local' | 'global';
  name: string;
  objectCount: number;
  summary: string | null;
  previewUrl: string | null;
}

/**
 * Saved object groups.
 *
 * Placing one drops every member back at its stored offset from the group's own
 * centre, so a lounge set arrives arranged rather than as a pile at the origin.
 */
export function CollectionsTab() {
  const qc = useQueryClient();
  const addObjects = useEditor((s) => s.addObjects);
  const readOnly = useEditor((s) => s.readOnly);

  const { data, isLoading } = useQuery({
    queryKey: ['collections'],
    queryFn: async () => (await http.get<{ items: CollectionRow[] }>('/collections')).data.items,
  });

  const place = useMutation({
    mutationFn: async (id: number) =>
      (await http.get<{ objects: SceneObject[] }>(`/collections/${id}`)).data,
    onSuccess: (payload) => {
      const objects = payload.objects ?? [];
      if (!objects.length) return;

      // Re-centre on the origin, then give each member a fresh id.
      const centre = objects.reduce(
        (acc, o) => ({ x: acc.x + o.positionMm.x, z: acc.z + o.positionMm.z }),
        { x: 0, z: 0 }
      );
      centre.x /= objects.length;
      centre.z /= objects.length;

      addObjects(
        objects.map((o) => ({
          ...structuredClone(o),
          id: crypto.randomUUID(),
          positionMm: {
            x: o.positionMm.x - centre.x,
            y: o.positionMm.y,
            z: o.positionMm.z - centre.z,
          },
          locked: false,
        })) as SceneObject[]
      );
    },
  });

  const remove = useMutation({
    mutationFn: async (id: number) => (await http.delete(`/collections/${id}`)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['collections'] }),
  });

  if (isLoading) {
    return (
      <div className="flex-1 py-10">
        <Spinner label="Loading collections…" />
      </div>
    );
  }

  if (!data?.length) {
    return (
      <div className="flex-1 px-3 py-6">
        <p className="text-center text-xs leading-relaxed text-ink-subtle">
          No collections yet. Select objects in the plan, then use Templates → Save as collection.
        </p>
      </div>
    );
  }

  const prebuilt = data.filter((c) => c.scope === 'global');
  const mine = data.filter((c) => c.scope === 'local');

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2">
      {prebuilt.length ? (
        <CollectionGroup
          title="Prebuilt"
          hint="Ready-made sets — a full table, a lounge corner, a check-in desk. Placing one keeps every piece arranged."
          items={prebuilt}
          disabled={readOnly || place.isPending}
          onPlace={(id) => place.mutate(id)}
        />
      ) : null}
      {mine.length ? (
        <CollectionGroup
          title="Yours"
          items={mine}
          disabled={readOnly || place.isPending}
          onPlace={(id) => place.mutate(id)}
          onRemove={(id) => remove.mutate(id)}
        />
      ) : null}
    </div>
  );
}

function CollectionGroup({
  title,
  hint,
  items,
  disabled,
  onPlace,
  onRemove,
}: {
  title: string;
  hint?: string;
  items: CollectionRow[];
  disabled: boolean;
  onPlace: (id: number) => void;
  onRemove?: (id: number) => void;
}) {
  return (
    <div className="mb-2">
      <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">{title}</p>
      {hint ? <p className="px-1 pb-1.5 text-[10px] leading-relaxed text-ink-subtle">{hint}</p> : null}
      <ul className="space-y-1">
        {items.map((collection) => (
          <li key={collection.id} className="relative">
            <button type="button" disabled={disabled}
              onClick={() => onPlace(collection.id)}
              className="ed-item-card w-full">
              {collection.previewUrl ? (
                <img src={collection.previewUrl} alt="" className="ed-thumb" loading="lazy" />
              ) : (
                <span className="ed-thumb flex items-center justify-center text-[9px] text-ink-subtle">
                  {collection.objectCount}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink">{collection.name}</span>
                <span className="block text-[10px] text-ink-subtle">
                  {collection.objectCount} object{collection.objectCount === 1 ? '' : 's'}
                </span>
                {collection.summary ? (
                  <span className="block truncate text-[9px] text-success">{collection.summary}</span>
                ) : null}
              </span>
            </button>
            {onRemove ? (
              <button type="button" aria-label="Delete collection"
                onClick={() => onRemove(collection.id)}
                className="icon-btn absolute right-1 top-1 h-6 w-6">
                <Trash2 className="h-3 w-3" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
