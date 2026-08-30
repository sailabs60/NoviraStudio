import { useCallback, useEffect, useRef } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_ARTWORK,
  finishFromProviderMaps,
  type ArtworkSceneObject,
  type CatalogItemDto,
  type CatalogSceneObject,
  type SurfaceFinish,
} from '@novira/shared';
import { useEditor } from './editorStore';
import { useDrag, type DragPayload, type DropIntent } from './dragStore';
import { pickPlacement, pickSurface } from './picking';
import { assets, proxied, type ProviderAsset } from '../lib/assetsApi';
import { toast } from '../components/ui';

/**
 * Dropping things into the 3D view.
 *
 * The whole interaction is built around one rule: **the user should know what
 * will happen before they let go.** Every pointer move recomputes the intent —
 * where it would land, which part it would paint, or why it cannot be dropped
 * here — and that intent drives both the cursor chip and the in-scene ghost.
 * The drop itself is then just "do the thing you were already showing".
 *
 * The second rule is that a drop never fails silently. An online model that
 * turns out to need an account says so, in the same place the drop happened,
 * and offers the link. That is the difference between a library that feels
 * infinite and one that feels broken.
 */

export interface DropTargetHandlers {
  onDragEnter: (event: ReactDragEvent) => void;
  onDragOver: (event: ReactDragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: ReactDragEvent) => void;
}

export function useDropTarget(): DropTargetHandlers {
  const queryClient = useQueryClient();
  const depth = useRef(0);

  /*
   * `dragover` fires at pointer-move frequency. Recomputing a raycast on every
   * one of them is affordable; re-rendering the store on every one is not — so
   * the intent is only written when it actually changes.
   */
  const lastIntentKey = useRef('');

  const updateIntent = useCallback((event: ReactDragEvent) => {
    const drag = useDrag.getState();
    const payload = drag.payload;
    if (!payload) return;

    drag.move(event.clientX, event.clientY);

    const editor = useEditor.getState();
    if (editor.readOnly) {
      writeIntent({ type: 'reject', reason: 'This plan is read-only' });
      return;
    }

    if (payload.kind === 'hdri') {
      writeIntent({ type: 'environment' });
      return;
    }

    if (payload.kind === 'material') {
      const hit = pickSurface(event.clientX, event.clientY);
      if (hit) {
        const object = editor.scene.objects.find((o) => o.id === hit.objectId);
        writeIntent({
          type: 'paint',
          objectId: hit.objectId,
          objectName: object?.name || 'this object',
          part: hit.part,
          partLabel: hit.partLabel,
        });
        return;
      }
      const ground = pickPlacement(event.clientX, event.clientY);
      writeIntent(ground ? { type: 'paint-floor' } : { type: 'none' });
      return;
    }

    // Models and images land on whatever surface is under the cursor.
    const spot = pickPlacement(event.clientX, event.clientY);
    if (!spot) {
      writeIntent({ type: 'none' });
      return;
    }
    const { snapToGrid, scene } = editor;
    const grid = scene.gridSizeMm;
    const snapped = snapToGrid && grid > 0;
    writeIntent({
      type: 'place',
      xMm: snapped ? Math.round(spot.xMm / grid) * grid : spot.xMm,
      yMm: spot.yMm,
      zMm: snapped ? Math.round(spot.zMm / grid) * grid : spot.zMm,
      snapped,
      onSurface: spot.onSurface,
    });
  }, []);

  const writeIntent = (intent: DropIntent) => {
    const key = JSON.stringify(intent);
    if (key === lastIntentKey.current) return;
    lastIntentKey.current = key;
    useDrag.getState().setIntent(intent);
  };

  const onDragEnter = useCallback(
    (event: ReactDragEvent) => {
      if (!useDrag.getState().payload) return;
      event.preventDefault();
      depth.current += 1;
      useDrag.getState().setOverViewport(true);
      updateIntent(event);
    },
    [updateIntent]
  );

  const onDragOver = useCallback(
    (event: ReactDragEvent) => {
      if (!useDrag.getState().payload) return;
      // Without this the browser refuses the drop and shows a "no entry" cursor.
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      updateIntent(event);
    },
    [updateIntent]
  );

  const onDragLeave = useCallback(() => {
    if (!useDrag.getState().payload) return;
    /*
     * `dragleave` fires when the pointer crosses into a *child* element too,
     * so a naive handler flickers the preview off and on across every overlay
     * in the viewport. Counting enter/leave pairs is the standard fix.
     */
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) {
      useDrag.getState().setOverViewport(false);
      lastIntentKey.current = '';
    }
  }, []);

  const onDrop = useCallback(
    (event: ReactDragEvent) => {
      const drag = useDrag.getState();
      const payload = drag.payload;
      if (!payload) return;
      event.preventDefault();
      depth.current = 0;

      /*
       * The final position is read from the drop event itself rather than from
       * the last `dragover` intent — the two can differ by a frame, and a chair
       * landing a few centimetres from where the ghost stood is exactly the
       * kind of imprecision that makes a tool feel cheap.
       */
      void performDrop(payload, event.clientX, event.clientY, queryClient).finally(() => {
        useDrag.getState().end();
        useDrag.getState().setBusy(null);
        lastIntentKey.current = '';
      });
    },
    [queryClient]
  );

  // A drag that ends anywhere — cancelled with Escape, dropped on the desktop —
  // must clear the preview. Without this the ghost can outlive the drag.
  useEffect(() => {
    const clear = () => {
      if (useDrag.getState().payload) useDrag.getState().end();
      depth.current = 0;
      lastIntentKey.current = '';
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

  return { onDragEnter, onDragOver, onDragLeave, onDrop };
}

/* ── Doing the thing ───────────────────────────────────────────────────── */

async function performDrop(
  payload: DragPayload,
  clientX: number,
  clientY: number,
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  const editor = useEditor.getState();
  if (editor.readOnly) {
    toast('info', 'This plan is read-only.');
    return;
  }

  switch (payload.kind) {
    case 'material':
      return dropMaterial(payload.finish, clientX, clientY);
    case 'hdri':
      return dropHdri(payload.asset);
    case 'image':
      return dropImage(payload.asset, clientX, clientY);
    case 'catalog':
      return dropCatalogItem(payload.item, clientX, clientY);
    case 'asset':
      return dropOnlineModel(payload.asset, clientX, clientY, queryClient);
    default:
      return;
  }
}

/**
 * Where a drop lands, snapped if snapping is on.
 *
 * The Y matters as much as the X and Z. A venue model whose ground floor sits
 * four metres above the origin — which is normal for a scanned or architect's
 * export — would otherwise swallow every chair placed in it, and the user would
 * see the object vanish and conclude the drop had failed.
 *
 * Snapping is deliberately applied to the plan axes only. Snapping the height
 * would lift objects off the very surface this went to the trouble of finding.
 */
function dropPoint(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
  const spot = pickPlacement(clientX, clientY);
  if (!spot) return null;
  const { snapToGrid, scene } = useEditor.getState();
  const grid = scene.gridSizeMm;
  if (snapToGrid && grid > 0) {
    return {
      x: Math.round(spot.xMm / grid) * grid,
      y: spot.yMm,
      z: Math.round(spot.zMm / grid) * grid,
    };
  }
  return { x: spot.xMm, y: spot.yMm, z: spot.zMm };
}

function dropMaterial(finish: SurfaceFinish, clientX: number, clientY: number): void {
  const editor = useEditor.getState();
  const hit = pickSurface(clientX, clientY);

  if (hit) {
    editor.applyFinish(hit.objectId, hit.part, finish);
    const object = editor.scene.objects.find((o) => o.id === hit.objectId);
    toast(
      'success',
      hit.part === '*'
        ? `${finish.label} applied to ${object?.name ?? 'the object'}.`
        : `${finish.label} applied to the ${hit.partLabel} of ${object?.name ?? 'the object'}.`
    );
    // Select what was just painted, so the properties panel opens on it and
    // the tiling and tint controls are one click away rather than a hunt.
    editor.focusObject(hit.objectId, 'properties');
    return;
  }

  if (pickPlacement(clientX, clientY)) {
    editor.setFloorFinish(finish);
    toast('success', `${finish.label} applied to the floor.`);
    return;
  }

  toast('info', 'Drop a material onto an object or onto the floor.');
}

function dropHdri(asset: ProviderAsset): void {
  const url = asset.hdriUrl ?? asset.modelUrl ?? null;
  if (!url) {
    toast('error', 'That environment has no usable image.');
    return;
  }
  // Through the proxy: an HDR read into a WebGL texture is subject to CORS,
  // and almost no provider sends the header.
  useEditor.getState().setEnvironmentHdri(proxied(url) ?? url, asset.name);
  toast('success', `Lighting the scene with ${asset.name}.`);
}

function dropImage(asset: ProviderAsset, clientX: number, clientY: number): void {
  const point = dropPoint(clientX, clientY);
  if (!point) {
    toast('info', 'Drop an image onto the floor of the plan.');
    return;
  }
  const url = asset.imageUrl ?? asset.thumbnailUrl;
  if (!url) {
    toast('error', 'That image could not be read.');
    return;
  }

  const aspect =
    asset.imageWidth && asset.imageHeight && asset.imageHeight > 0
      ? asset.imageWidth / asset.imageHeight
      : 1.5;
  // A sensible printed size: 2 m tall, width from the image's own aspect. That
  // is a graphic panel a person stands next to, which is what an image dropped
  // into an event plan almost always is.
  const heightMm = 2000;
  const widthMm = Math.round(heightMm * aspect);

  const artwork: ArtworkSceneObject = {
    ...DEFAULT_ARTWORK,
    id: crypto.randomUUID(),
    type: 'artwork',
    name: asset.name.slice(0, 80),
    imageUrl: proxied(url) ?? url,
    sourceLabel: asset.sourceLabel ?? null,
    sourceUrl: asset.viewerUrl ?? null,
    license: asset.license ?? null,
    attribution: asset.attribution ?? null,
    widthMm,
    heightMm,
    aspectRatio: aspect,
    // Free-standing rather than wall-mounted: there is no wall under the
    // cursor, and a panel that stands on the floor is what a dropped graphic
    // is in an event plan.
    mount: 'free',
    positionMm: { x: point.x, y: point.y, z: point.z },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };

  useEditor.getState().addObjects([artwork]);
  toast('success', `${asset.name} added as a printed panel.`);
}

function dropCatalogItem(item: CatalogItemDto, clientX: number, clientY: number): void {
  const point = dropPoint(clientX, clientY);
  if (!point) {
    toast('info', 'Drop onto the floor of the plan.');
    return;
  }

  const object: CatalogSceneObject = {
    id: crypto.randomUUID(),
    type: 'catalog',
    name: item.name,
    catalogItemId: item.id,
    modelUrl: item.modelUrl,
    dimensionsMm: {
      width: item.widthMm ?? 600,
      depth: item.depthMm ?? 600,
      height: item.heightMm ?? 600,
    },
    seatsDefault: item.seatsDefault ?? null,
    tableShape: item.tableShape ?? null,
    positionMm: { x: point.x, y: point.y, z: point.z },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };

  const editor = useEditor.getState();
  editor.cacheItems([item]);
  editor.addObjects([object]);
}

/**
 * A model from an online library.
 *
 * Import first, then place. The import is what makes the placement durable —
 * the file is copied onto our storage and measured, so the object has real
 * dimensions and still opens in a year when the provider has reorganised its
 * CDN. It costs a few seconds, which is why the drag chip says what is
 * happening rather than leaving a hole in the scene.
 */
async function dropOnlineModel(
  asset: ProviderAsset,
  clientX: number,
  clientY: number,
  queryClient: ReturnType<typeof useQueryClient>
): Promise<void> {
  const point = dropPoint(clientX, clientY);
  if (!point) {
    toast('info', 'Drop onto the floor of the plan.');
    return;
  }

  useDrag.getState().setBusy(`Fetching ${asset.name}…`);
  try {
    const { item, reused } = await assets.import(asset);
    dropCatalogItemAt(item, point);
    void queryClient.invalidateQueries({ queryKey: ['assets', 'imported'] });
    void queryClient.invalidateQueries({ queryKey: ['catalog'] });
    toast(
      'success',
      reused
        ? `${item.name} placed from your library.`
        : `${item.name} imported from ${asset.sourceLabel} and placed.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'That model could not be imported.';
    /*
     * The common case is a model that is genuinely obtainable but not by us —
     * a Sketchfab download that needs an account, a BlenderKit paid asset. The
     * server says so in the message, and the row already carries the link, so
     * the honest response is to repeat it and get out of the way.
     */
    toast('error', message);
  }
}

function dropCatalogItemAt(item: CatalogItemDto, point: { x: number; y: number; z: number }): void {
  const object: CatalogSceneObject = {
    id: crypto.randomUUID(),
    type: 'catalog',
    name: item.name,
    catalogItemId: item.id,
    modelUrl: item.modelUrl,
    dimensionsMm: {
      width: item.widthMm ?? 600,
      depth: item.depthMm ?? 600,
      height: item.heightMm ?? 600,
    },
    seatsDefault: item.seatsDefault ?? null,
    tableShape: item.tableShape ?? null,
    positionMm: { x: point.x, y: point.y, z: point.z },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
  const editor = useEditor.getState();
  editor.cacheItems([item]);
  editor.addObjects([object]);
}

/* ── Starting a drag, from anywhere ────────────────────────────────────── */

/**
 * The props a draggable library row needs.
 *
 * Centralised so every library — catalogue, online models, materials, HDRIs,
 * images — starts a drag the same way. The transparent drag image is the
 * important line: browsers otherwise paint a washed-out screenshot of the row,
 * which cannot show where the drop will land and looks nothing like the rest
 * of the interface.
 */
export function draggableProps(payload: DragPayload) {
  return {
    draggable: true,
    onDragStart: (event: ReactDragEvent) => {
      useDrag.getState().begin(payload);
      useDrag.getState().move(event.clientX, event.clientY);
      event.dataTransfer.effectAllowed = 'copy';
      // Some browsers cancel a drag with no data attached.
      event.dataTransfer.setData('text/plain', payloadName(payload));
      const ghost = transparentImage();
      if (ghost) event.dataTransfer.setDragImage(ghost, 0, 0);
    },
    onDragEnd: () => useDrag.getState().end(),
  };
}

function payloadName(payload: DragPayload): string {
  if (payload.kind === 'catalog') return payload.item.name;
  if (payload.kind === 'material') return payload.finish.label;
  return payload.asset.name;
}

let ghostImage: HTMLImageElement | null = null;

/** A 1×1 transparent GIF, so the browser's own drag image is invisible. */
function transparentImage(): HTMLImageElement | null {
  if (typeof document === 'undefined') return null;
  if (!ghostImage) {
    ghostImage = new Image();
    ghostImage.src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  }
  return ghostImage;
}

/** Build a drag payload from an online material row. */
export function materialPayloadFromAsset(asset: ProviderAsset): DragPayload {
  const maps = asset.materialMaps ?? {};
  const proxiedMaps: Record<string, string | undefined> = {};
  for (const [channel, url] of Object.entries(maps)) {
    if (url) proxiedMaps[channel] = proxied(url);
  }
  return {
    kind: 'material',
    finish: finishFromProviderMaps({
      materialId: `${asset.source}:${asset.sourceAssetId}`,
      label: asset.name,
      source: asset.sourceLabel,
      license: asset.license ?? undefined,
      previewUrl: asset.thumbnailUrl ?? undefined,
      maps: proxiedMaps,
    }),
  };
}
