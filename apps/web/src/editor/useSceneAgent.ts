import { useCallback, useMemo, useState } from 'react';
import {
  builtInMaterial,
  deriveLedScreen,
  fitLedScreen,
  toFinish,
  STAGE_DECK_SIZE_MM,
  type SceneObject,
} from '@novira/shared';
import { useEditor, type WorkPanel } from './editorStore';
import { studio, type AgentOperation, type SceneSnapshot } from '../lib/studioApi';
import { toast } from '../components/ui';

/**
 * The assistant's hands.
 *
 * The model proposes; this applies. Keeping the two apart is the whole safety
 * argument: every operation the assistant can perform is in the switch below,
 * each one goes through the editor's own store, and therefore through undo —
 * so the worst an unexpected suggestion can do is one Ctrl+Z.
 *
 * The snapshot it works from is deliberately lossy. Positions in millimetres,
 * names and types, and nothing else — no material graphs, no wall geometry, no
 * catalogue rows. It is enough to answer "what is in my plan" and "move the
 * chair to the table", and small enough to send on every turn without the
 * context bill.
 */

/** What the assistant is allowed to see. */
export function buildSnapshot(): SceneSnapshot {
  const state = useEditor.getState();
  const scene = state.scene;

  const bounds = scene.walls.segments.reduce(
    (acc, segment) => ({
      minX: Math.min(acc.minX, segment.start.xMm, segment.end.xMm),
      maxX: Math.max(acc.maxX, segment.start.xMm, segment.end.xMm),
      minZ: Math.min(acc.minZ, segment.start.zMm, segment.end.zMm),
      maxZ: Math.max(acc.maxZ, segment.start.zMm, segment.end.zMm),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  );

  const hasRoom = Number.isFinite(bounds.minX) && bounds.maxX > bounds.minX;

  return {
    title: state.title,
    units: scene.units,
    regionCode: scene.regionCode,
    objectCount: scene.objects.length,
    ...(hasRoom
      ? { roomWidthMm: Math.round(bounds.maxX - bounds.minX), roomDepthMm: Math.round(bounds.maxZ - bounds.minZ) }
      : {}),
    /*
     * The object list is capped, because a generated event runs to several
     * hundred objects and all of them would not fit in a context window.
     */
    objects: scene.objects.slice(0, 200).map((object) => ({
      id: object.id,
      name: object.name ?? object.type,
      type: object.type,
      positionMm: {
        x: Math.round(object.positionMm?.x ?? 0),
        y: Math.round(object.positionMm?.y ?? 0),
        z: Math.round(object.positionMm?.z ?? 0),
      },
      ...sizeOf(object),
      ...(roleOf(object) ? { role: roleOf(object) } : {}),
    })),
    groups: summariseGroups(scene.objects),
    selection: describeSelection(scene.objects, state.selectedIds),
  };
}

/**
 * The objects the user is pointing at, described properly.
 *
 * Everything else in the snapshot is a sample or a summary, because a whole
 * event does not fit. The selection is the exception: it is small, and it is
 * what the next sentence is most likely about. "Make this 5 metres wide" and
 * "rotate these to face the stage" are unanswerable without it, and they are
 * how people actually talk to a tool with something already highlighted.
 *
 * Capped at a handful of objects. Selecting 480 chairs and asking about "these"
 * is a set instruction, and the group summary already carries every id.
 */
function describeSelection(
  objects: SceneObject[],
  selectedIds: string[]
): SceneSnapshot['selection'] {
  if (!selectedIds.length) return undefined;

  const groupSizes = new Map<string, number>();
  for (const object of objects) {
    const group = (object as SceneObject & { groupId?: string | null }).groupId;
    if (group) groupSizes.set(group, (groupSizes.get(group) ?? 0) + 1);
  }

  const chosen = objects.filter((o) => selectedIds.includes(o.id));

  return {
    count: chosen.length,
    ids: selectedIds.slice(0, 500),
    objects: chosen.slice(0, 6).map((object) => {
      const size = sizeOf(object);
      const dims =
        typeof size.widthMm === 'number'
          ? { width: size.widthMm, depth: size.depthMm ?? 0, height: size.heightMm ?? 0 }
          : undefined;
      const group = (object as SceneObject & { groupId?: string | null }).groupId ?? null;
      return {
        id: object.id,
        name: object.name ?? object.type,
        type: object.type,
        ...(roleOf(object) ? { role: roleOf(object) } : {}),
        positionMm: {
          x: Math.round(object.positionMm?.x ?? 0),
          y: Math.round(object.positionMm?.y ?? 0),
          z: Math.round(object.positionMm?.z ?? 0),
        },
        rotationDeg: {
          x: Math.round(object.rotationDeg?.x ?? 0),
          y: Math.round(object.rotationDeg?.y ?? 0),
          z: Math.round(object.rotationDeg?.z ?? 0),
        },
        scale: {
          x: object.scale?.x ?? 1,
          y: object.scale?.y ?? 1,
          z: object.scale?.z ?? 1,
        },
        ...(dims ? { dimensionsMm: dims } : {}),
        ...((object as { catalogItemId?: number }).catalogItemId
          ? { catalogItemId: (object as { catalogItemId?: number }).catalogItemId }
          : {}),
        ...(group ? { groupId: group, groupCount: groupSizes.get(group) ?? 1 } : {}),
        ...(object.finishes && Object.keys(object.finishes).length
          ? { materials: Object.keys(object.finishes) }
          : {}),
      };
    }),
  };
}

const roleOf = (object: SceneObject): string | undefined =>
  (object as SceneObject & { assemblyRole?: string }).assemblyRole;

/**
 * Count the repeated sets in a plan, with every id.
 *
 * The cap above is what makes this necessary. "Replace all the chairs" against
 * a 480-chair banquet used to reach the 200 the model could see and leave the
 * rest, which is worse than refusing — the plan ends up half changed and the
 * user has to find which half. Grouping is cheap, always complete, and turns a
 * whole-set instruction into an exact one.
 *
 * Sets are keyed on what a person would call them: the catalogue item for a
 * placed model, otherwise the kind of thing it is.
 */
function summariseGroups(objects: SceneObject[]): SceneSnapshot['groups'] {
  const map = new Map<string, { label: string; role?: string; ids: string[] }>();

  for (const object of objects) {
    const catalogId = (object as SceneObject & { catalogItemId?: number }).catalogItemId;
    const generated = (object as SceneObject & { generatedRole?: string }).generatedRole;
    const role = roleOf(object);

    const key = catalogId ? `catalog:${catalogId}` : `type:${object.type}:${generated ?? ''}`;
    /*
     * Name the set, not the first thing in it.
     *
     * These objects are named per placement — "Table 1 chair 1", "Table 12
     * chair 7" — so taking the first one's name labelled a set of 480 chairs
     * "Table 1 chair 1", which reads as one chair and invites an instruction
     * that touches one. The generated role is what the set actually is.
     */
    const label = generated
      ? `${generated}s`
      : catalogId
        ? (object.name ?? `catalogue item ${catalogId}`).replace(/\s*—.*$/, '')
        : role
          ? `${role} ${object.type}s`
          : `${object.type}s`;

    const entry = map.get(key);
    if (entry) entry.ids.push(object.id);
    else map.set(key, { label, role, ids: [object.id] });
  }

  return [...map.values()]
    // A set of one is not a set; it is already in the object list.
    .filter((entry) => entry.ids.length > 1)
    .sort((a, b) => b.ids.length - a.ids.length)
    .slice(0, 30)
    .map((entry) => ({ label: entry.label, role: entry.role, count: entry.ids.length, ids: entry.ids }));
}

/**
 * How big an object actually is, in millimetres.
 *
 * Placed catalogue models carry their dimensions and shapes carry a width and
 * depth, but the procedural types carry neither: a stage is a count of decks, a
 * screen is a grid of cabinets, a truss is a span. Returning nothing for those
 * meant that selecting the LED wall and saying "make this five metres wide" had
 * no current width to work from, which is the one thing that instruction needs.
 * So the size is derived from what each type is actually made of.
 */
function sizeOf(object: SceneObject) {
  const dims = (object as { dimensionsMm?: { width: number; depth: number; height: number } }).dimensionsMm;
  if (dims) return { widthMm: dims.width, depthMm: dims.depth, heightMm: dims.height };

  if (object.type === 'stage') {
    const stage = object as unknown as { deckColumns: number; deckRows: number; deckHeightMm: number };
    return {
      widthMm: stage.deckColumns * STAGE_DECK_SIZE_MM,
      depthMm: stage.deckRows * STAGE_DECK_SIZE_MM,
      heightMm: stage.deckHeightMm,
    };
  }

  if (object.type === 'led') {
    const derived = deriveLedScreen(object as never);
    return {
      widthMm: Math.round(derived.widthMm),
      depthMm: Math.round(derived.panel.depthMm),
      heightMm: Math.round(derived.heightMm),
    };
  }

  const wide = object as { widthMm?: number; depthMm?: number; heightMm?: number };
  if (typeof wide.widthMm === 'number') {
    return { widthMm: wide.widthMm, depthMm: wide.depthMm ?? null, heightMm: wide.heightMm ?? null };
  }
  return {};
}

/* ── Applying what came back ───────────────────────────────────────────── */

/**
 * Perform one operation and say, in plain English, what happened.
 *
 * The sentence matters as much as the change. An assistant that silently
 * rearranges a plan is alarming; one that says "moved the Dining Chair to the
 * table" leaves the user in charge of deciding whether that was right.
 */
/** "the 480 chairs" / "the stage" — how a person would refer to what changed. */
function describe(objects: SceneObject[]): string {
  if (objects.length === 1) return objects[0]!.name ?? objects[0]!.type;

  /*
   * Generated objects are named per placement — "Table 12 chair 7" — so
   * stripping a trailing number is not enough to find what they have in
   * common; it produced "480 objects", which tells the user nothing about
   * what just changed. The generated role is the actual noun.
   */
  const roles = new Set(
    objects.map((o) => (o as SceneObject & { generatedRole?: string }).generatedRole).filter(Boolean)
  );
  if (roles.size === 1) {
    const role = [...roles][0]!;
    return `${objects.length} ${role}${/s$/.test(role) ? '' : 's'}`;
  }

  const types = new Set(objects.map((o) => o.type));
  if (types.size === 1) {
    const type = [...types][0]!;
    return `${objects.length} ${type}${/s$/.test(type) ? '' : 's'}`;
  }

  return `${objects.length} objects`;
}

/** Scale stays in a range where an object is still recognisably itself. */
const clampScale = (value: number): number => Math.max(0.05, Math.min(20, Number(value.toFixed(4))));

async function apply(operation: AgentOperation): Promise<string | null> {
  const editor = useEditor.getState();
  const nameOf = (id: string) => editor.scene.objects.find((o) => o.id === id)?.name ?? 'that object';

  switch (operation.action) {
    case 'select': {
      const ids = operation.ids.filter((id) => editor.scene.objects.some((o) => o.id === id));
      if (!ids.length) return null;
      editor.select(ids);
      return `Selected ${ids.length === 1 ? nameOf(ids[0]!) : `${ids.length} objects`}.`;
    }

    case 'move': {
      if (!editor.scene.objects.some((o) => o.id === operation.id)) return null;
      editor.updateObject(operation.id, { positionMm: operation.positionMm } as Partial<SceneObject>);
      return `Moved ${nameOf(operation.id)} to ${(operation.positionMm.x / 1000).toFixed(2)} m, ${(
        operation.positionMm.z / 1000
      ).toFixed(2)} m.`;
    }

    case 'rotate': {
      const object = editor.scene.objects.find((o) => o.id === operation.id);
      if (!object) return null;
      editor.updateObject(operation.id, {
        rotationDeg: { ...object.rotationDeg, y: operation.rotationDeg },
      } as Partial<SceneObject>);
      return `Rotated ${nameOf(operation.id)} to ${Math.round(operation.rotationDeg)}°.`;
    }

    case 'recolour': {
      const material = builtInMaterial(operation.materialId);
      if (!material) return null;
      editor.applyFinish(operation.id, '*', toFinish(material));
      return `Finished ${nameOf(operation.id)} in ${material.label}.`;
    }

    case 'delete': {
      const ids = operation.ids.filter((id) => editor.scene.objects.some((o) => o.id === id));
      if (!ids.length) return null;
      const names = ids.map(nameOf);
      editor.select(ids);
      editor.deleteSelected();
      return `Removed ${names.length === 1 ? names[0] : `${names.length} objects`}. Undo brings them back.`;
    }

    case 'duplicate': {
      const object = editor.scene.objects.find((o) => o.id === operation.id);
      if (!object) return null;
      const count = Math.min(Math.max(1, Math.round(operation.count)), 40);
      const spacing = Math.max(100, Math.round(operation.spacingMm));
      const copies: SceneObject[] = Array.from({ length: count }, (_, index) => ({
        ...structuredClone(object),
        id: crypto.randomUUID(),
        positionMm: { ...object.positionMm, x: object.positionMm.x + spacing * (index + 1) },
      }));
      editor.addObjects(copies);
      return `Added ${count} more ${nameOf(operation.id)}, ${(spacing / 1000).toFixed(2)} m apart.`;
    }

    /* -- Set-wide operations ------------------------------------------- */

    /**
     * Move a set by a delta.
     *
     * "Move the stage two metres forward" is relative, and `move` is absolute —
     * answering a relative instruction with an absolute position means working
     * out coordinates the model does not reliably have. Nudging preserves every
     * spacing inside the set, so a stage and its screen stay together.
     */
    case 'nudge': {
      const objects = editor.scene.objects.filter((o) => operation.ids.includes(o.id));
      if (!objects.length) return null;
      for (const object of objects) {
        editor.updateObject(object.id, {
          positionMm: {
            x: Math.round(object.positionMm.x + (operation.deltaMm.x ?? 0)),
            y: Math.round(object.positionMm.y + (operation.deltaMm.y ?? 0)),
            z: Math.round(object.positionMm.z + (operation.deltaMm.z ?? 0)),
          },
        } as Partial<SceneObject>);
      }
      const metres = (n: number) => (n / 1000).toFixed(2).replace(/\.00$/, '');
      const parts = [
        operation.deltaMm.x ? `${metres(operation.deltaMm.x)} m across` : '',
        operation.deltaMm.z ? `${metres(operation.deltaMm.z)} m along` : '',
        operation.deltaMm.y ? `${metres(operation.deltaMm.y)} m up` : '',
      ].filter(Boolean);
      return `Moved ${describe(objects)} ${parts.join(' and ')}.`;
    }

    case 'scale': {
      const objects = editor.scene.objects.filter((o) => operation.ids.includes(o.id));
      if (!objects.length) return null;
      for (const object of objects) {
        editor.updateObject(object.id, {
          scale: {
            x: clampScale(object.scale.x * (operation.scale.x ?? 1)),
            y: clampScale(object.scale.y * (operation.scale.y ?? 1)),
            z: clampScale(object.scale.z * (operation.scale.z ?? 1)),
          },
        } as Partial<SceneObject>);
      }
      return `Scaled ${describe(objects)}.`;
    }

    /**
     * Change an object's real dimensions rather than its scale factor.
     *
     * "Make the stage two metres wider" is a statement about millimetres, and
     * answering it with a scale multiplier stretches the decking texture and
     * makes the parts list wrong. Objects that carry real dimensions get them
     * set; the rest fall back to scale, which is the honest approximation.
     */
    case 'resize': {
      const object = editor.scene.objects.find((o) => o.id === operation.id);
      if (!object) return null;
      /*
       * A stage is not sized in millimetres; it is a count of 4-foot decks.
       * Setting a width on it would be ignored, so the request is converted
       * into the nearest whole number of decks — which is also the only size a
       * stage can actually be built at, and what the parts list counts.
       */
      if (object.type === 'stage') {
        const stage = object as unknown as { deckColumns: number; deckRows: number };
        const patch: Record<string, number> = {};
        if (operation.dimensionsMm.width) {
          patch.deckColumns = Math.max(1, Math.round(operation.dimensionsMm.width / STAGE_DECK_SIZE_MM));
        }
        if (operation.dimensionsMm.depth) {
          patch.deckRows = Math.max(1, Math.round(operation.dimensionsMm.depth / STAGE_DECK_SIZE_MM));
        }
        if (operation.dimensionsMm.height) patch.deckHeightMm = Math.round(operation.dimensionsMm.height);
        if (!Object.keys(patch).length) return null;
        editor.updateObject(operation.id, patch as Partial<SceneObject>);
        const w = (patch.deckColumns ?? stage.deckColumns) * STAGE_DECK_SIZE_MM;
        const d = (patch.deckRows ?? stage.deckRows) * STAGE_DECK_SIZE_MM;
        return `Resized ${nameOf(operation.id)} to ${(w / 1000).toFixed(1)} × ${(d / 1000).toFixed(1)} m — ${patch.deckColumns ?? stage.deckColumns} × ${patch.deckRows ?? stage.deckRows} decks.`;
      }

      /*
       * An LED wall is a grid of cabinets, so a width is a column count.
       *
       * Setting millimetres on it would be ignored the same way it was on a
       * stage, and a wall that is not a whole number of cabinets cannot be
       * built. Fitting rounds to the nearest real size, which is also what a
       * screen supplier would quote.
       */
      if (object.type === 'led') {
        const screen = object as unknown as { panelKey: string; columns: number; rows: number };
        const derived = deriveLedScreen(object as never);
        const fitted = fitLedScreen(
          screen.panelKey,
          operation.dimensionsMm.width ?? derived.widthMm,
          operation.dimensionsMm.height ?? derived.heightMm
        );
        editor.updateObject(operation.id, {
          columns: fitted.columns,
          rows: fitted.rows,
        } as Partial<SceneObject>);
        return `Resized ${nameOf(operation.id)} to ${(fitted.widthMm / 1000).toFixed(1)} × ${(fitted.heightMm / 1000).toFixed(1)} m — ${fitted.columns} × ${fitted.rows} cabinets.`;
      }

      const dims = (object as { dimensionsMm?: { width: number; depth: number; height: number } }).dimensionsMm;
      if (dims) {
        editor.updateObject(operation.id, {
          dimensionsMm: {
            width: Math.round(operation.dimensionsMm.width ?? dims.width),
            depth: Math.round(operation.dimensionsMm.depth ?? dims.depth),
            height: Math.round(operation.dimensionsMm.height ?? dims.height),
          },
        } as Partial<SceneObject>);
      } else {
        const flat = object as { widthMm?: number; depthMm?: number; heightMm?: number };
        const patch: Record<string, number> = {};
        if (operation.dimensionsMm.width && typeof flat.widthMm === 'number') {
          patch.widthMm = Math.round(operation.dimensionsMm.width);
        }
        if (operation.dimensionsMm.depth && typeof flat.depthMm === 'number') {
          patch.depthMm = Math.round(operation.dimensionsMm.depth);
        }
        if (operation.dimensionsMm.height && typeof flat.heightMm === 'number') {
          patch.heightMm = Math.round(operation.dimensionsMm.height);
        }
        if (!Object.keys(patch).length) return null;
        editor.updateObject(operation.id, patch as Partial<SceneObject>);
      }
      const said = Object.entries(operation.dimensionsMm)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => `${k} ${((v as number) / 1000).toFixed(2)} m`)
        .join(', ');
      return `Resized ${nameOf(operation.id)} to ${said}.`;
    }

    /**
     * Swap the model under a set, keeping every transform.
     *
     * This is what "replace all the chairs with black chairs" means: the same
     * 480 places, a different chair in each. Rebuilding them would lose the
     * arrangement, which is the part that took the work.
     */
    case 'replace_asset': {
      const objects = editor.scene.objects.filter((o) => operation.ids.includes(o.id));
      if (!objects.length) return null;

      const item = useEditor.getState().itemCache[operation.catalogItemId];
      for (const object of objects) {
        const patch: Record<string, unknown> = { catalogItemId: operation.catalogItemId };
        if (item) {
          patch.modelUrl = item.modelUrl ?? undefined;
          patch.dimensionsMm = {
            width: item.widthMm ?? 600,
            depth: item.depthMm ?? 600,
            height: item.heightMm ?? 600,
          };
          // The old name described the old model, so it would lie afterwards.
          patch.name = operation.name ?? item.name;
        } else if (operation.name) {
          patch.name = operation.name;
        }
        editor.updateObject(object.id, patch as Partial<SceneObject>);
      }
      return `Replaced ${describe(objects)} with ${operation.name ?? item?.name ?? 'the new model'}. Positions kept.`;
    }

    case 'set_material': {
      const material = builtInMaterial(operation.materialId);
      if (!material) return null;
      const objects = editor.scene.objects.filter((o) => operation.ids.includes(o.id));
      if (!objects.length) return null;
      for (const object of objects) {
        editor.applyFinish(object.id, operation.part ?? '*', toFinish(material));
      }
      return `Finished ${describe(objects)} in ${material.label}.`;
    }

    /**
     * Put an image on a set.
     *
     * LED screens carry content; banners and shapes carry artwork. Both are
     * "the picture on that surface" to the person asking, so one operation
     * covers them and the object type decides which field it lands in.
     */
    case 'set_artwork': {
      const objects = editor.scene.objects.filter((o) => operation.ids.includes(o.id));
      if (!objects.length) return null;
      let applied = 0;
      for (const object of objects) {
        if (object.type === 'led') {
          editor.updateObject(object.id, { contentUrl: operation.imageUrl } as Partial<SceneObject>);
          applied += 1;
        } else {
          editor.updateObject(object.id, { imageUrl: operation.imageUrl } as Partial<SceneObject>);
          applied += 1;
        }
      }
      if (!applied) return null;
      return `Put the artwork on ${describe(objects)}.`;
    }

    case 'set_light': {
      const objects = editor.scene.objects.filter(
        (o) => operation.ids.includes(o.id) && o.type === 'light'
      );
      if (!objects.length) return null;
      for (const object of objects) {
        const patch: Record<string, unknown> = {};
        if (operation.colorHex) patch.colorHex = operation.colorHex;
        if (typeof operation.intensity === 'number') {
          patch.intensity = Math.max(0, Math.min(10, operation.intensity));
        }
        if (Object.keys(patch).length) editor.updateObject(object.id, patch as Partial<SceneObject>);
      }
      return `Adjusted ${describe(objects)}.`;
    }

    /**
     * Add more of something already in the plan.
     *
     * "Add 50 more chairs" needs somewhere to put them. They are laid out in a
     * block beside the set they copy, at that set's own spacing, so they arrive
     * ordered and visible rather than stacked on the original.
     */
    case 'add_more': {
      const source = editor.scene.objects.find((o) => o.id === operation.likeId);
      if (!source) return null;
      const count = Math.min(Math.max(1, Math.round(operation.count)), 500);

      // Spacing from the source's own footprint, so chairs pack like chairs and
      // tables like tables.
      const size = (source as { dimensionsMm?: { width: number; depth: number } }).dimensionsMm;
      const spacing = Math.max(700, Math.round((size?.width ?? 800) * 1.35));

      // Beside the existing set rather than on top of it.
      const peers = editor.scene.objects.filter(
        (o) => (o as { catalogItemId?: number }).catalogItemId === (source as { catalogItemId?: number }).catalogItemId
      );
      const rightEdge = peers.reduce((max, o) => Math.max(max, o.positionMm.x), source.positionMm.x);

      const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
      const copies: SceneObject[] = Array.from({ length: count }, (_, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return {
          ...structuredClone(source),
          id: crypto.randomUUID(),
          // A fresh group: these are new, not members of the set they copy.
          groupId: null,
          positionMm: {
            x: Math.round(rightEdge + spacing * (column + 2)),
            y: source.positionMm.y,
            z: Math.round(source.positionMm.z + spacing * row),
          },
        } as SceneObject;
      });
      editor.addObjects(copies);
      return `Added ${count} more ${source.name ?? source.type}, in a block beside the existing ones.`;
    }

    case 'focus': {
      if (!editor.scene.objects.some((o) => o.id === operation.id)) return null;
      editor.focusObject(operation.id);
      return `Looking at ${nameOf(operation.id)}.`;
    }

    case 'open_panel': {
      const panels: WorkPanel[] = ['add', 'build', 'finish', 'site', 'light', 'cost', 'check', 'present', 'review'];
      if (!panels.includes(operation.panel as WorkPanel)) return null;
      editor.setWorkPanel(operation.panel as WorkPanel);
      return `Opened ${operation.panel}.`;
    }

    case 'apply_look': {
      editor.setRender({ look: operation.look });
      return `Applied the ${operation.look.replace(/-/g, ' ')} look.`;
    }

    case 'generate_3d': {
      /*
       * Generation is a paid, minutes-long job, so it is started and reported
       * rather than awaited — the conversation carries on while the mesh
       * builds, and the result lands in the library either way.
       */
      try {
        const started = await studio.textTo3d({ prompt: operation.prompt, planId: editor.planId ?? undefined });
        void studio.wait(started.id).then((finished) => {
          if (finished.status === 'completed') {
            toast('success', `${operation.name} finished generating. It is in your AI studio library.`);
          }
        });
        return `Generating ${operation.name}. It takes about a minute and will appear in your library.`;
      } catch (error) {
        return `I could not start that generation — ${error instanceof Error ? error.message : 'the service refused it'}.`;
      }
    }

    case 'survey':
      return operation.note;

    default:
      return null;
  }
}

/* ── The hook ──────────────────────────────────────────────────────────── */

/**
 * The operation applier, reachable from a test.
 *
 * `apply` is deliberately private — nothing in the app should be able to run an
 * agent operation except the agent — but a browser test has to be able to prove
 * that replacing 480 chairs keeps 480 positions, and that is not provable
 * through the chat UI without a live model in the loop.
 */
export const applyOperationForTest = import.meta.env.DEV
  ? (operation: AgentOperation) => apply(operation)
  : undefined;

export interface AgentMessage {
  id: string;
  role: 'you' | 'novira' | 'action';
  text: string;
}

export function useSceneAgent() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const readOnly = useEditor((s) => s.readOnly);

  const push = useCallback((role: AgentMessage['role'], text: string) => {
    setMessages((current) => [...current, { id: crypto.randomUUID(), role, text }]);
  }, []);

  const send = useCallback(
    async (text: string, imageDataUrl?: string | null) => {
      const message = text.trim();
      if (!message || thinking) return;

      push('you', message);
      setThinking(true);

      try {
        const history = messages
          .filter((m) => m.role !== 'action')
          .slice(-8)
          .map((m) => ({ role: m.role === 'you' ? ('user' as const) : ('assistant' as const), content: m.text }));

        const answer = await studio.agent({
          message,
          snapshot: buildSnapshot(),
          history,
          imageDataUrl,
        });

        push('novira', answer.reply);

        if (readOnly && answer.operations.length) {
          push('action', 'This plan is read-only, so nothing was changed.');
        } else {
          for (const operation of answer.operations) {
            const result = await apply(operation);
            if (result) push('action', result);
          }
        }
      } catch (error) {
        push(
          'novira',
          error instanceof Error ? error.message : 'I could not reach the assistant just then. Try again in a moment.'
        );
      } finally {
        setThinking(false);
      }
    },
    [messages, push, readOnly, thinking]
  );

  const clear = useCallback(() => setMessages([]), []);

  return useMemo(() => ({ messages, thinking, send, clear }), [messages, thinking, send, clear]);
}

/* ── Smart suggestions ─────────────────────────────────────────────────── */

/**
 * One contextual next step, on request.
 *
 * Not on a timer. An interface that interrupts every two minutes with advice
 * is one people learn to dismiss without reading, and the suggestion is only
 * worth anything if it arrives when someone has actually paused. So it is
 * fetched when the dock is opened and when the user asks for another.
 *
 * `avoid` carries what has already been shown this session, so the model does
 * not offer the same idea twice.
 */
export function useSmartSuggestion() {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await studio.suggest({ snapshot: buildSnapshot(), avoid: seen });
      if (result.suggestion) {
        setSuggestion(result.suggestion);
        setSeen((current) => [...current, result.suggestion!].slice(-8));
        setUnavailable(null);
      } else {
        setUnavailable(result.reason ?? 'No suggestion just now.');
      }
    } catch {
      setUnavailable('The assistant could not be reached.');
    } finally {
      setLoading(false);
    }
  }, [loading, seen]);

  return { suggestion, loading, unavailable, fetch, dismiss: () => setSuggestion(null) };
}
