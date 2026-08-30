import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { SceneDocument } from '@novira/shared';
import * as collab from './collabConnection';

export type { Peer, CollabStatus } from './collabConnection';

/**
 * Live collaboration on one plan.
 *
 * A thin hook over a shared connection: several components in the editor want
 * presence at once, and each opening its own socket would make one planner
 * appear twice in their own room. `collabConnection` keeps exactly one socket
 * per plan and reference-counts it.
 *
 * `useSyncExternalStore` rather than local state, so every consumer sees the
 * same snapshot in the same render and there is no chance of the header and the
 * viewport disagreeing about who is present.
 */
export function useCollaboration(planId: number | null) {
  const subscribe = useCallback(
    (listener: () => void) => (planId ? collab.subscribe(planId, listener) : () => {}),
    [planId]
  );

  const snapshot = useSyncExternalStore(
    subscribe,
    () => (planId ? collab.getSnapshot(planId) : EMPTY),
    () => EMPTY
  );

  const actions = useMemo(
    () => ({
      sendCursor: (cursor: { xMm: number; zMm: number } | null) => {
        if (planId) collab.sendCursor(planId, cursor);
      },
      sendSelection: (selection: string[]) => {
        if (planId) collab.sendSelection(planId, selection);
      },
      sendScene: (scene: SceneDocument) => {
        if (planId) collab.sendScene(planId, scene);
      },
    }),
    [planId]
  );

  return { peers: snapshot.peers, status: snapshot.status, ...actions };
}

const EMPTY = { peers: [], status: 'idle' as const };
