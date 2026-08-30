import { useCallback, useEffect, useRef, useState } from 'react';
import type { SceneObject } from '@novira/shared';
import { useEditor } from './editorStore';
import { pickPlacement, surfaceHeightAt } from './picking';

/**
 * Sliding an object across the floor with the right mouse button.
 *
 * The gizmo is precise and slow: click the object, find the arrow, drag the
 * right axis. That is the correct tool for nudging a screen 40 mm left, and the
 * wrong one for the thing people actually do most — pushing furniture around a
 * room to see how it feels. This is that gesture: right-press an object,
 * push it, let go.
 *
 * Four decisions make it behave rather than fight the user:
 *
 *  · **Along the floor only.** The height is never taken from the pointer. It
 *    is read from whatever surface is under the object's new position, so a
 *    chair pushed onto a stage climbs onto it and one pushed off comes back
 *    down — and nothing ever ends up hovering or buried.
 *
 *  · **The grab point is kept.** The object moves by the pointer's *delta*,
 *    not to the pointer, so it does not jump so its origin snaps under the
 *    cursor the moment the drag starts.
 *
 *  · **One undo entry.** Live updates go through `commitQuiet`, which does not
 *    touch history; the original position is restored and re-applied once on
 *    release so a single Ctrl+Z puts it back where it was, rather than
 *    replaying two hundred mouse positions.
 *
 *  · **Orbit stands down.** OrbitControls owns right-drag for panning, so it is
 *    disabled for the duration and the context menu is suppressed — otherwise
 *    the camera pans while the chair moves, and a menu opens on release.
 */

export interface FloorDragState {
  objectId: string | null;
  /** Where it is right now, for the read-out. */
  positionMm: { x: number; y: number; z: number } | null;
  /** True while the object is standing on something other than the ground. */
  onSurface: boolean;
}

interface DragSession {
  objectId: string;
  /** Where it started, so undo has something to return to. */
  origin: { x: number; y: number; z: number };
  /** Offset between the object's origin and the point that was grabbed. */
  grabOffset: { x: number; z: number };
  pointerId: number;
  locked: boolean;
  moved: boolean;
  /** Where it settled on the previous move, so the next search starts there. */
  lastY?: number;
}

export function useFloorDrag(orbitRef: React.MutableRefObject<any>) {
  const [state, setState] = useState<FloorDragState>({ objectId: null, positionMm: null, onSurface: false });
  const session = useRef<DragSession | null>(null);

  /** Begin a drag. Called from an object's own right-button pointer-down. */
  const begin = useCallback(
    (objectId: string, event: { clientX: number; clientY: number; pointerId: number }) => {
      const editor = useEditor.getState();
      if (editor.readOnly) return false;

      const object = editor.scene.objects.find((o) => o.id === objectId);
      if (!object || object.locked) return false;

      const spot = pickPlacement(event.clientX, event.clientY, objectId);
      if (!spot) return false;

      const origin = {
        x: Math.round(object.positionMm?.x ?? 0),
        y: Math.round(object.positionMm?.y ?? 0),
        z: Math.round(object.positionMm?.z ?? 0),
      };

      session.current = {
        objectId,
        origin,
        // Keep the grab point: the object moves with the pointer rather than
        // teleporting its origin under it.
        grabOffset: { x: origin.x - spot.xMm, z: origin.z - spot.zMm },
        pointerId: event.pointerId,
        locked: false,
        moved: false,
      };

      if (orbitRef.current) orbitRef.current.enabled = false;
      setState({ objectId, positionMm: origin, onSurface: spot.onSurface });
      return true;
    },
    [orbitRef]
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = session.current;
      if (!drag || event.pointerId !== drag.pointerId) return;

      // Excluding the object itself: it is under the cursor for the whole
      // gesture, and reading the pointer's ground position off its own surface
      // makes it accelerate away. See `pickPlacement`.
      const spot = pickPlacement(event.clientX, event.clientY, drag.objectId);
      if (!spot) return;

      const editor = useEditor.getState();
      const grid = editor.scene.gridSizeMm;
      const snap = editor.snapToGrid && grid > 0;

      let x = spot.xMm + drag.grabOffset.x;
      let z = spot.zMm + drag.grabOffset.z;
      if (snap) {
        x = Math.round(x / grid) * grid;
        z = Math.round(z / grid) * grid;
      }

      /*
       * The height is read from the world at the object's *new* footprint, not
       * from where the cursor happens to be. Using the cursor's own hit point
       * would let an object climb a wall the pointer grazed on its way past.
       * The object is excluded so it cannot stand on itself.
       *
       * The search starts 2.5 m above where the object already is, not at the
       * top of the world. Inside a building model, a ray from above the roof
       * finds the roof — so a chair slid across the ballroom would end up on
       * top of the hotel. From just overhead it can still step onto a stage or
       * a riser, and cannot leave the storey it is standing on.
       */
      const y = surfaceHeightAt(x, z, drag.objectId, (drag.lastY ?? drag.origin.y) + 2_500);

      drag.moved = true;
      drag.lastY = y;
      // Quiet: two hundred pointer moves must not become two hundred undo steps.
      editor.commitQuiet((draft) => {
        const index = draft.objects.findIndex((o) => o.id === drag.objectId);
        if (index >= 0) {
          draft.objects[index] = {
            ...draft.objects[index]!,
            positionMm: { x, y, z },
          } as SceneObject;
        }
      });

      setState({ objectId: drag.objectId, positionMm: { x, y, z }, onSurface: Math.abs(y) > 20 });
    };

    const finish = (event: PointerEvent) => {
      const drag = session.current;
      if (!drag || (event.pointerId !== drag.pointerId && event.type !== 'pointercancel')) return;
      session.current = null;

      if (orbitRef.current) orbitRef.current.enabled = true;
      setState({ objectId: null, positionMm: null, onSurface: false });

      if (!drag.moved) return;

      /*
       * One history entry for the whole gesture.
       *
       * The live updates were quiet, so `past` still holds the scene as it was
       * before the drag. Putting the object back and committing the final
       * position in a single pass is what makes Ctrl+Z return it to where it
       * started rather than to the previous mouse position.
       */
      const editor = useEditor.getState();
      const current = editor.scene.objects.find((o) => o.id === drag.objectId);
      if (!current) return;
      const settled = current.positionMm;

      editor.commitQuiet((draft) => {
        const index = draft.objects.findIndex((o) => o.id === drag.objectId);
        if (index >= 0) {
          draft.objects[index] = { ...draft.objects[index]!, positionMm: drag.origin } as SceneObject;
        }
      });
      editor.commit((draft) => {
        const index = draft.objects.findIndex((o) => o.id === drag.objectId);
        if (index >= 0) {
          draft.objects[index] = { ...draft.objects[index]!, positionMm: settled } as SceneObject;
        }
      });
    };

    // Suppress the browser menu for the whole gesture, not just on the object:
    // the pointer is very often over the canvas rather than the mesh on release.
    const onContextMenu = (event: MouseEvent) => {
      if (session.current) event.preventDefault();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [orbitRef]);

  return { state, begin, dragging: state.objectId !== null };
}

/* ── Sharing the gesture with the scene graph ──────────────────────────── */

/**
 * The active drag, published for the objects to read.
 *
 * `SceneNode` is rendered per object deep inside the Canvas and needs to start
 * a drag from its own pointer event. Threading a callback down through a dozen
 * renderers for one gesture is worse than a module-level handle that the
 * viewport installs once.
 */
let starter: ((objectId: string, event: { clientX: number; clientY: number; pointerId: number }) => boolean) | null =
  null;

export function registerFloorDrag(
  begin: ((objectId: string, event: { clientX: number; clientY: number; pointerId: number }) => boolean) | null
) {
  starter = begin;
}

export function beginFloorDrag(
  objectId: string,
  event: { clientX: number; clientY: number; pointerId: number }
): boolean {
  return starter ? starter(objectId, event) : false;
}
