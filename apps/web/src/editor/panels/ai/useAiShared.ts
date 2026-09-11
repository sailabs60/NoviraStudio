/**
 * The two things every AI tab needs to know about the plan.
 *
 * Both were duplicated in the Studio panel before this section existed, and a
 * second copy of "how big is the room" is exactly the kind of thing that drifts
 * out of step and produces a layout for a room nobody has.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CatalogItemDto } from '@novira/shared';
import { useEditor } from '../../editorStore';
import { api } from '../../../lib/api';

export interface Venue {
  widthMm: number;
  depthMm: number;
  /** 0 when the walls do not say. */
  heightMm: number;
}

/**
 * The room already in the plan, measured from its walls.
 *
 * If a venue is loaded, the layout has to be planned for *that* room. Deriving
 * one from the guest count instead is how a plan comes out physically
 * impossible in the space it was made for.
 */
export function useVenue(): Venue | null {
  const segments = useEditor((s) => s.scene.walls.segments);

  return useMemo(() => {
    if (segments.length < 3) return null;
    const xs = segments.flatMap((s) => [s.start.xMm, s.end.xMm]);
    const zs = segments.flatMap((s) => [s.start.zMm, s.end.zMm]);
    const widthMm = Math.round(Math.max(...xs) - Math.min(...xs));
    const depthMm = Math.round(Math.max(...zs) - Math.min(...zs));
    if (widthMm < 3000 || depthMm < 3000) return null;
    const heightMm = Math.round(Math.max(...segments.map((s) => s.heightMm || 0))) || 0;
    return { widthMm, depthMm, heightMm: heightMm > 2000 ? heightMm : 0 };
  }, [segments]);
}

/**
 * The catalogue a room is furnished from, loaded once.
 *
 * A 500-guest banquet asks for a round table and a chair 528 times between
 * them; a query per placement would take longer than the whole rest of a build.
 */
export function useAiCatalogue(): CatalogItemDto[] | undefined {
  const { data } = useQuery({
    queryKey: ['ai-catalogue'],
    queryFn: async () => {
      const categories = ['tables', 'chairs', 'decor', 'signage', 'plants', 'lounge', 'bars-catering'];
      const pages = await Promise.all(
        categories.map((category) =>
          api.catalog.items({ category, limit: 100 } as never).catch(() => ({ items: [] }))
        )
      );
      return pages.flatMap((page) => page.items ?? []);
    },
    staleTime: 300_000,
  });
  return data;
}
