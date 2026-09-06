import { Footprints, Move, RotateCw, Scaling } from 'lucide-react';
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
  const walkMode = useEditor((s) => s.walkMode);
  const toggleWalkMode = useEditor((s) => s.toggleWalkMode);

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
  const idle = selected.length === 0 && !walkMode;

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

      {/*
        Walk mode, added under the three modes rather than among them: it is
        about moving the camera, not about what a drag does to an object.

        It exists because W A S D Q E are already scale, snap and the transform
        modes, so making them drive the camera all the time would silently
        break those. As a mode the same keys mean two things without either
        surprising anybody — the arrangement Blender, Godot and Unreal all
        settled on — and while it is on the transform shortcuts stand down.
      */}
      <span aria-hidden className="mx-auto my-0.5 h-px w-6 bg-line" />
      <button
        type="button"
        title={
          walkMode
            ? 'Stop walking (Esc). W A S D move, Q E drop and rise, Shift is faster'
            : 'Walk with W A S D (Q E for down and up). Esc leaves.'
        }
        aria-pressed={walkMode}
        onClick={toggleWalkMode}
        className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
          walkMode
            ? 'bg-primary text-primary-fg shadow-sm'
            : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
        }`}
      >
        <Footprints className="h-4 w-4" />
        <span className="sr-only">Walk</span>
      </button>
    </div>
  );
}
