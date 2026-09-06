import { Move, RotateCw, Scaling } from 'lucide-react';
import { useEditor } from './editorStore';
import { useSelectedObjects } from './selectors';

/**
 * Move, rotate, scale — pinned to the top-left of the viewport.
 *
 * These three are different in kind from everything else that acts on a
 * selection. They are *modes*: one of them is always active, they are switched
 * constantly while arranging a room, and which one is on changes what dragging
 * the gizmo does. A mode belongs somewhere fixed, where the muscle memory can
 * settle, rather than in a menu that appears beside whatever is selected and
 * therefore never twice in the same place.
 *
 * So they sit in the corner, stacked downward, always in that order — the same
 * order and the same keys (G, R, E) the status bar advertises, and the same
 * arrangement every other 3D tool puts them in.
 *
 * The one-off actions — duplicate, delete, material, artwork — stay on the
 * quick menu beside the selection, because those are things you do *to* the
 * thing you are looking at, and having them under the cursor is worth more
 * than having them in a fixed place.
 */

const MODES = [
  { mode: 'translate' as const, label: 'Move', icon: Move, key: 'g' },
  { mode: 'rotate' as const, label: 'Rotate', icon: RotateCw, key: 'r' },
  { mode: 'scale' as const, label: 'Scale', icon: Scaling, key: 'e' },
];

export function TransformRail() {
  const selected = useSelectedObjects();
  const readOnly = useEditor((s) => s.readOnly);
  const transformMode = useEditor((s) => s.transformMode);
  const setTransformMode = useEditor((s) => s.setTransformMode);
  const tool = useEditor((s) => s.tool);

  // Drafting has its own interaction; a transform mode there means nothing.
  if (readOnly || tool === 'draw' || tool === 'wall') return null;

  /*
   * Dimmed rather than hidden when nothing is selected.
   *
   * The rail is a fixed part of the frame, and a control that disappears and
   * reappears in the corner of the eye is more distracting than one that sits
   * quietly greyed. It also keeps the mode visible, which is worth knowing
   * before you select something.
   */
  const idle = selected.length === 0;

  return (
    <div
      data-testid="transform-rail"
      className={`pointer-events-auto absolute left-3 top-3 z-20 flex flex-col gap-1 rounded-xl border border-line bg-surface-strong/95 p-1 shadow-lg backdrop-blur transition-opacity ${
        idle ? 'opacity-55' : 'opacity-100'
      }`}
    >
      {MODES.map(({ mode, label, icon: Icon, key }) => {
        const active = transformMode === mode;
        return (
          <button
            key={mode}
            type="button"
            title={`${label} (${key.toUpperCase()})`}
            aria-pressed={active}
            onClick={() => setTransformMode(mode)}
            className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
              active
                ? 'bg-primary text-primary-fg shadow-sm'
                : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
