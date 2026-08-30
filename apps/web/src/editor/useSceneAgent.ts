import { useCallback, useMemo, useState } from 'react';
import { builtInMaterial, toFinish, type SceneObject } from '@novira/shared';
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
    // Capped: a 400-object plan would blow the context window, and the first
    // 200 are enough to answer anything anyone actually asks.
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
    })),
  };
}

function sizeOf(object: SceneObject) {
  const dims = (object as { dimensionsMm?: { width: number; depth: number; height: number } }).dimensionsMm;
  if (dims) return { widthMm: dims.width, depthMm: dims.depth, heightMm: dims.height };
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
