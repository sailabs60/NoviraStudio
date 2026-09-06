import { useEffect, useRef, useState } from 'react';
import { Brush, Copy, Lock, Move, RotateCw, Scaling, Sticker, Trash2, Unlock } from 'lucide-react';
import { useEditor } from './editorStore';
import { useSelectedObjects } from './selectors';
import { ObjectQuickActions } from './ObjectQuickActions';

/**
 * The quick toolbar, beside the thing it acts on.
 *
 * An earlier version of this floated over the selection and was pinned to the
 * top of the viewport instead, for two reasons that were both real: it moved
 * every time the object moved, so the button you wanted was never twice in
 * the same place; and it sat on top of whatever was behind the selection,
 * which in a room full of tables is always something you need to see.
 *
 * Both are solvable rather than fatal, and being beside the selection is
 * worth solving them for — the alternative is a round trip to the top of the
 * screen for every finish and every nudge:
 *
 *  · **It never covers the object.** The position comes from the projected
 *    bounding box of the selected meshes (see `SelectionAnchor`), and the bar
 *    hangs off the box's *top edge* with a fixed gap. It flips underneath
 *    when the selection is near the top of the viewport, and is clamped so it
 *    cannot leave the frame.
 *  · **It holds still while it is being used.** The anchor is frozen for as
 *    long as a transform drag is in progress and for a moment afterwards, so
 *    the bar does not slide out from under the cursor mid-gesture. Between
 *    edits it tracks the object, which is the whole point.
 *
 * The mode buttons switch the transform gizmo, on the same keys the status
 * bar advertises — G, R, E — so the toolbar and the keyboard agree.
 */

const MODES = [
  { mode: 'translate' as const, label: 'Move', icon: Move, key: 'g' },
  { mode: 'rotate' as const, label: 'Rotate', icon: RotateCw, key: 'r' },
  { mode: 'scale' as const, label: 'Scale', icon: Scaling, key: 'e' },
];

/** Clear of the selection, and of the fingertip that is dragging it. */
const GAP_PX = 18;
const BAR_WIDTH_PX = 470;

export function SelectionToolbar() {
  const selected = useSelectedObjects();
  const readOnly = useEditor((s) => s.readOnly);
  const transformMode = useEditor((s) => s.transformMode);
  const setTransformMode = useEditor((s) => s.setTransformMode);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const toggleLockSelected = useEditor((s) => s.toggleLockSelected);
  const tool = useEditor((s) => s.tool);
  const anchor = useEditor((s) => s.selectionAnchor);
  const [quick, setQuick] = useState<'material' | 'art' | null>(null);

  /*
   * Hold the last position through a drag.
   *
   * `dragging` is true from the moment a transform gesture starts until
   * shortly after it ends, and while it is true the bar keeps the coordinates
   * it had when the gesture began. Without this the bar chases the object
   * across the screen while you are dragging it, and the button you were
   * about to press has moved.
   */
  const frozen = useRef<typeof anchor>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button === 0 || e.button === 2) setDragging(true);
    };
    const onUp = () => window.setTimeout(() => setDragging(false), 260);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  if (!dragging) frozen.current = anchor;
  const placed = dragging ? (frozen.current ?? anchor) : anchor;

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

  // A window about the selection has no subject once the selection is gone.
  useEffect(() => {
    if (!selected.length) setQuick(null);
  }, [selected.length]);

  // Drafting has its own interaction; a transform bar there is noise.
  if (!selected.length || readOnly || tool === 'draw' || tool === 'wall') return null;

  const locked = selected.every((o) => o.locked);

  /*
   * Above the selection, unless there is no room — then below it. Clamped to
   * the frame on both axes so it is always reachable even when the object is
   * half off-screen.
   */
  const container = { width: window.innerWidth, height: window.innerHeight };
  const above = placed ? placed.top - GAP_PX : 64;
  const flip = above < 56;
  const top = placed ? (flip ? placed.bottom + GAP_PX : above) : 64;
  const left = placed ? placed.x : container.width / 2;

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{
        left: Math.round(Math.min(Math.max(left, BAR_WIDTH_PX / 2 + 8), container.width - BAR_WIDTH_PX / 2 - 8)),
        top: Math.round(Math.min(Math.max(top, 8), container.height - 120)),
        transform: flip ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
      }}
    >
      <div
        data-testid="selection-toolbar"
        className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-line bg-surface-strong/95 p-1 shadow-xl backdrop-blur transition-opacity duration-150"
        style={{ opacity: dragging ? 0.35 : 1 }}
      >
        {MODES.map(({ mode, label, icon: Icon, key }) => (
          <button
            key={mode}
            type="button"
            title={`${label} (${key.toUpperCase()})`}
            onClick={() => setTransformMode(mode)}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-medium transition ${
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

        {/*
          The two edits that used to be several panels away — a finish, and a
          client's artwork — put where the selection already is.
        */}
        <button
          type="button"
          title="Change the finish on the selection, or on one part of it"
          aria-expanded={quick === 'material'}
          onClick={() => setQuick(quick === 'material' ? null : 'material')}
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-medium transition ${
            quick === 'material' ? 'bg-primary text-primary-fg' : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
          }`}
        >
          <Brush className="h-3.5 w-3.5" />
          Material
        </button>

        <button
          type="button"
          title="Stand artwork in front of the selection"
          aria-expanded={quick === 'art'}
          onClick={() => setQuick(quick === 'art' ? null : 'art')}
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-medium transition ${
            quick === 'art' ? 'bg-primary text-primary-fg' : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
          }`}
        >
          <Sticker className="h-3.5 w-3.5" />
          Add art
        </button>

        <span className="mx-0.5 h-5 w-px bg-line" />

        <button
          type="button"
          title="Duplicate (Ctrl+D)"
          onClick={duplicateSelected}
          className="icon-btn h-8 w-8 rounded-full text-ink-muted"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          title={locked ? 'Unlock (L)' : 'Lock so it cannot be moved (L)'}
          onClick={toggleLockSelected}
          className={`icon-btn h-8 w-8 rounded-full ${locked ? 'text-primary' : 'text-ink-muted'}`}
        >
          {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
        </button>

        <button
          type="button"
          title="Delete (Del)"
          onClick={deleteSelected}
          className="icon-btn h-8 w-8 rounded-full text-danger hover:bg-danger/15"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>

        {selected.length > 1 ? (
          <span className="px-1.5 text-xs font-semibold text-ink-subtle">{selected.length}</span>
        ) : null}
      </div>

      {quick ? <ObjectQuickActions action={quick} flipped={flip} onClose={() => setQuick(null)} /> : null}
    </div>
  );
}
