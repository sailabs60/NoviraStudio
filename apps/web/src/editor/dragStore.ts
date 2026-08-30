import { create } from 'zustand';
import type { CatalogItemDto, SurfaceFinish } from '@novira/shared';
import type { ProviderAsset } from '../lib/assetsApi';

/**
 * What is currently being dragged, and where it would land.
 *
 * A separate store from the editor's, on purpose. Drag state changes on every
 * pointer move — dozens of times a second — and putting that in the document
 * store would re-run every selector subscribed to the scene, drop frames in
 * the viewport, and pollute the undo history with cursor movement. Here it is
 * a small object that only the drag surfaces subscribe to.
 *
 * The design goal is that a drag never asks the user to imagine anything:
 *
 *  · a chip follows the cursor showing what is held,
 *  · a ghost of the actual model stands on the floor where it would land,
 *  · dropping a material lights up the exact part it would paint,
 *  · and an illegal target says so before the mouse comes up.
 */

export type DragPayload =
  | { kind: 'catalog'; item: CatalogItemDto }
  /** An online model that has not been imported yet. */
  | { kind: 'asset'; asset: ProviderAsset }
  | { kind: 'material'; finish: SurfaceFinish }
  | { kind: 'hdri'; asset: ProviderAsset }
  | { kind: 'image'; asset: ProviderAsset };

/** What the drop would do, given where the cursor is right now. */
export type DropIntent =
  | { type: 'none' }
  | {
      type: 'place';
      xMm: number;
      /** The surface height found under the cursor — see `pickPlacement`. */
      yMm: number;
      zMm: number;
      snapped: boolean;
      /** True when it landed on real geometry rather than the ground plane. */
      onSurface: boolean;
    }
  /** Paint one part of one object. */
  | { type: 'paint'; objectId: string; objectName: string; part: string; partLabel: string }
  /** Paint the floor, when a material is dropped on empty ground. */
  | { type: 'paint-floor' }
  | { type: 'environment' }
  | { type: 'reject'; reason: string };

interface DragState {
  payload: DragPayload | null;
  /** Cursor position in client pixels, for the chip that follows it. */
  pointer: { x: number; y: number } | null;
  /** Whether the cursor is currently over the viewport. */
  overViewport: boolean;
  intent: DropIntent;
  /** Set while an online asset is being fetched on drop. */
  busy: string | null;

  begin: (payload: DragPayload) => void;
  move: (x: number, y: number) => void;
  setOverViewport: (over: boolean) => void;
  setIntent: (intent: DropIntent) => void;
  setBusy: (label: string | null) => void;
  end: () => void;
}

export const useDrag = create<DragState>((set) => ({
  payload: null,
  pointer: null,
  overViewport: false,
  intent: { type: 'none' },
  busy: null,

  begin: (payload) => set({ payload, intent: { type: 'none' }, overViewport: false }),
  move: (x, y) => set({ pointer: { x, y } }),
  setOverViewport: (overViewport) =>
    set((s) => ({ overViewport, intent: overViewport ? s.intent : { type: 'none' } })),
  setIntent: (intent) => set({ intent }),
  setBusy: (busy) => set({ busy }),
  end: () => set({ payload: null, pointer: null, overViewport: false, intent: { type: 'none' } }),
}));

/** A short human label for whatever is being dragged. */
export function payloadLabel(payload: DragPayload): string {
  switch (payload.kind) {
    case 'catalog':
      return payload.item.name;
    case 'material':
      return payload.finish.label;
    default:
      return payload.asset.name;
  }
}

/** The thumbnail for whatever is being dragged, if it has one. */
export function payloadThumbnail(payload: DragPayload): string | null {
  switch (payload.kind) {
    case 'catalog':
      return payload.item.previewImage ?? null;
    case 'material':
      return payload.finish.previewUrl ?? payload.finish.maps?.color ?? null;
    default:
      return payload.asset.thumbnailUrl ?? payload.asset.imageUrl ?? null;
  }
}

/**
 * The MIME type used on the native drag.
 *
 * A custom type rather than `text/plain`, so a drag from Novira is
 * distinguishable from a file or a link dragged in from the desktop — those
 * are handled by the import flow and must not be mistaken for a catalogue
 * placement.
 */
export const DRAG_MIME = 'application/x-novira-asset';
