import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import type { SceneObject } from '@novira/shared';
import { http } from '../lib/api';
import { useEditor } from './editorStore';
import { Spinner } from '../components/Spinner';

interface CollectionRow {
  id: number;
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

  return (
    <div className="flex-1 overflow-y-auto px-2 py-2">
      <ul className="space-y-1">
        {data.map((collection) => (
          <li key={collection.id} className="relative">
            <button type="button" disabled={readOnly || place.isPending}
              onClick={() => place.mutate(collection.id)}
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
            <button type="button" aria-label="Delete collection"
              onClick={() => remove.mutate(collection.id)}
              className="icon-btn absolute right-1 top-1 h-6 w-6">
              <Trash2 className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
