import { useEffect } from 'react';
import { Copy, Move, RotateCw, Scaling, Trash2 } from 'lucide-react';
import { useEditor } from './editorStore';
import { useSelectedObjects } from './selectors';

/**
 * The selection toolbar.
 *
 * A fixed pill at the top of the viewport rather than a bar floating over the
 * selection. Two reasons, both learned the hard way from the floating version:
 * it moved every time the object moved, so the button you wanted was never
 * twice in the same place; and it sat on top of whatever was behind the
 * selection, which in a room full of tables is always something you need to
 * see.
 *
 * The mode buttons switch the transform gizmo. They are the same keys the
 * status bar already advertises — G, R, E — so the toolbar and the keyboard
 * agree.
 */

const MODES = [
  { mode: 'translate' as const, label: 'Move', icon: Move, key: 'g' },
  { mode: 'rotate' as const, label: 'Rotate', icon: RotateCw, key: 'r' },
  { mode: 'scale' as const, label: 'Scale', icon: Scaling, key: 'e' },
];

export function SelectionToolbar() {
  const selected = useSelectedObjects();
  const readOnly = useEditor((s) => s.readOnly);
  const transformMode = useEditor((s) => s.transformMode);
  const setTransformMode = useEditor((s) => s.setTransformMode);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const tool = useEditor((s) => s.tool);

  // The keyboard shortcuts the status bar promises.
  useEffect(() => {
    if (!selected.length || readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const mode = MODES.find((m) => m.key === e.key.toLowerCase());
      if (mode) {
        e.preventDefault();
        setTransformMode(mode.mode);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.length, readOnly, setTransformMode]);

  // Drafting has its own interaction; a transform bar there is noise.
  if (!selected.length || readOnly || tool === 'draw' || tool === 'wall') return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
      <div
        data-testid="selection-toolbar"
        className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-line bg-surface-strong/95 p-1 shadow-xl backdrop-blur"
      >
        {MODES.map(({ mode, label, icon: Icon, key }) => (
          <button
            key={mode}
            type="button"
            title={`${label} (${key.toUpperCase()})`}
            onClick={() => setTransformMode(mode)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
              transformMode === mode
                ? 'bg-primary text-primary-fg'
                : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}

        <span className="mx-0.5 h-5 w-px bg-line" />

        <button
          type="button"
          title="Duplicate (Shift+Drag)"
          onClick={duplicateSelected}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-surface-muted hover:text-ink"
        >
          <Copy className="h-3.5 w-3.5" />
          Duplicate
        </button>

        <button
          type="button"
          title="Delete (Del)"
          onClick={deleteSelected}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-danger transition hover:bg-danger/15"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>

        {selected.length > 1 ? (
          <span className="px-2 text-xs font-semibold text-ink-subtle">{selected.length}</span>
        ) : null}
      </div>
    </div>
  );
}
