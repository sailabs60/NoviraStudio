import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { siteFromVenueSpec, type VenueSpec } from '@novira/shared';
import { spatial } from '../lib/spatialApi';
import { useEditor } from './editorStore';
import { toast } from '../components/ui';

/**
 * Putting a venue into the plan, in one place.
 *
 * There were two ways to reach a venue from the editor and they behaved
 * differently. The Site panel applied it properly. The card on the templates
 * shelf — the one somebody actually sees when they open a new plan and press
 * *Start from…* — was a **link to another page**. It navigated away from the
 * plan to a library screen, where the venue could be admired and not used, and
 * the designer had to come back and find the Site panel anyway.
 *
 * "Open venue" was never the verb. The verb is *use this one*, and it is the
 * only thing anybody wants from a venue card in a plan they are building. So
 * the apply path lives here, both surfaces call it, and the card on the shelf
 * does the thing its picture implies.
 *
 * ## Why the site record is written here rather than on the server
 *
 * The server writes the objects — the shell, the constraints, the floor
 * polygon — because those are the plan's contents. What it cannot sensibly
 * write is the editor's *understanding* of the room, because that understanding
 * is a client-side concept that the viewport refines once the geometry is in
 * memory (how much of the model is actually exterior, which is only knowable
 * from the mesh). Deriving it here from the spec the server just returned keeps
 * one source of truth and one round trip.
 */
export function useApplyVenue() {
  const queryClient = useQueryClient();
  const planId = useEditor((s) => s.planId);
  const replaceScene = useEditor((s) => s.replaceScene);
  const setVenueSite = useEditor((s) => s.setVenueSite);
  const requestFrameVenue = useEditor((s) => s.requestFrameVenue);
  const readOnly = useEditor((s) => s.readOnly);

  /** The venue currently being applied, so a card can show its own spinner. */
  const [applying, setApplying] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const apply = useCallback(
    async (venueId: number): Promise<boolean> => {
      if (!planId || readOnly) return false;
      setApplying(venueId);
      try {
        const result = await spatial.venues.applyToPlan(venueId, planId);
        const spec = result.venue as VenueSpec;

        /*
         * The room, recorded before the scene is swapped in.
         *
         * Order matters: `replaceScene` pushes an undo entry, and the site has
         * to be part of the document that entry captures — otherwise undoing
         * the venue would leave the editor still believing it is standing in a
         * ballroom that is no longer in the plan.
         */
        const shell = result.scene.objects.find(
          (object) => object.type === 'catalog' && (object as { venueId?: number | null }).venueId
        );
        const site = siteFromVenueSpec(spec, shell?.id ?? null);

        replaceScene({ ...result.scene, venueSite: site });
        setVenueSite(site);
        setWarnings(result.warnings);

        void queryClient.invalidateQueries({ queryKey: ['plan-review'] });

        toast(
          'success',
          spec.modelUrl
            ? `${spec.name} is in the plan — the building, plus ${result.applied} constraints. It may take a moment to load.`
            : `${spec.name}: ${result.applied} constraints applied to this plan.`
        );

        /*
         * Show the room.
         *
         * `requestFrameVenue` rather than "fit everything": the whole reason
         * the site record exists is that a real venue's model carries a great
         * deal that is not the room, and framing all of it lands the camera
         * over a roof. This frames the floor somebody is about to work on.
         */
        requestFrameVenue();
        return true;
      } catch {
        toast('error', 'Could not apply that venue. Check that the plan is saved and try again.');
        return false;
      } finally {
        setApplying(null);
      }
    },
    [planId, readOnly, replaceScene, setVenueSite, requestFrameVenue, queryClient]
  );

  return { apply, applying, warnings, setWarnings };
}
