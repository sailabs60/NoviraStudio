/**
 * Safe derived selectors.
 *
 * ── The bug this exists to prevent ──────────────────────────────────────────
 *
 * zustand compares the previous and next selector result with `Object.is`. A
 * selector that *derives* a value — `objects.filter(...)`, `ids.map(...)`,
 * `{ a, b }` — returns a fresh reference on every store read, so the comparison
 * always says "changed", the component re-renders, the selector runs again, and
 * the loop never terminates. In this app that hung the browser tab hard enough
 * that Playwright reported `Target crashed`, with no error in the console to
 * explain it.
 *
 * The workaround was to subscribe to primitives and derive inside `useMemo`.
 * That works but is easy to forget, and forgetting it fails catastrophically
 * rather than visibly.
 *
 * ── The actual fix ──────────────────────────────────────────────────────────
 *
 * `useShallow` compares one level deep, so an array or object of stable members
 * is treated as unchanged when its contents are unchanged. Every derived
 * selector in the editor goes through the hooks below, which apply it by
 * construction — you cannot use one of these and reintroduce the loop.
 */
import { useShallow } from 'zustand/react/shallow';
import type { SceneObject } from '@novira/shared';
import { useEditor } from './editorStore';

/**
 * Subscribe to a derived value, compared shallowly.
 *
 * Use this for anything that builds a new array or object. For a plain scalar
 * (`s.title`, `s.dirty`) call `useEditor` directly — reference equality is
 * already correct there and cheaper.
 */
export function useEditorShallow<T>(selector: (state: ReturnType<typeof useEditor.getState>) => T): T {
  return useEditor(useShallow(selector));
}

/** Objects the viewport should draw, honouring isolate mode. */
export function useVisibleObjects(): SceneObject[] {
  return useEditorShallow((s) => {
    const shown = s.scene.objects.filter((o) => !o.hidden);
    if (!s.isolateMode) return shown;
    const isolated = new Set(s.isolatedIds);
    return shown.filter((o) => isolated.has(o.id));
  });
}

/** The currently selected objects, in scene order. */
export function useSelectedObjects(): SceneObject[] {
  return useEditorShallow((s) => {
    if (!s.selectedIds.length) return EMPTY;
    const wanted = new Set(s.selectedIds);
    return s.scene.objects.filter((o) => wanted.has(o.id));
  });
}

/** Catalogue ids referenced by the scene, for hydrating the model cache. */
export function useReferencedCatalogIds(): number[] {
  return useEditorShallow((s) => {
    const ids = new Set<number>();
    for (const object of s.scene.objects) {
      if (object.type === 'catalog') ids.add(object.catalogItemId);
      if (object.type === 'tent' || object.type === 'opening') ids.add(object.catalogItemId);
    }
    return [...ids].sort((a, b) => a - b);
  });
}

/**
 * A stable empty array.
 *
 * `[]` is a fresh reference each call, which defeats even a shallow compare's
 * fast path and causes needless re-renders on every store write.
 */
const EMPTY: SceneObject[] = [];
