import { useEffect, useRef, useState } from 'react';
import { Brush, Copy, Lightbulb, Scaling, Sticker, Trash2 } from 'lucide-react';
import { useEditor } from './editorStore';
import { useSelectedObjects } from './selectors';
import { ObjectQuickActions } from './ObjectQuickActions';

/**
 * The quick menu, beside the thing it acts on.
 *
 * An earlier version floated over the selection and was pinned to the top of
 * the viewport instead, for two reasons that were both real: it moved every
 * time the object moved, so the button you wanted was never twice in the same
 * place; and it sat on top of whatever was behind the selection, which in a
 * room full of tables is always something you need to see.
 *
 * Both are solvable rather than fatal, and being beside the selection is worth
 * solving them for — the alternative is a round trip across the screen for
 * every finish and every nudge:
 *
 *  · **It never covers the object.** The position comes from the projected
 *    bounding box of the selected meshes (see `SelectionAnchor`), and the menu
 *    hangs off the box's *top edge* with a fixed gap. It flips underneath when
 *    the selection is near the top of the viewport, and is clamped so it
 *    cannot leave the frame.
 *  · **It holds still while it is being used.** The anchor is frozen for as
 *    long as a transform drag is in progress and for a moment afterwards, so
 *    the menu does not slide out from under the cursor mid-gesture. Between
 *    edits it tracks the object, which is the whole point.
 *
 * Move, rotate and scale are *not* here. They are modes rather than actions —
 * one is always on, and which one changes what dragging does — so they live in
 * the fixed rail at the top-left corner where muscle memory can settle. What
 * is left is the list of things done *to* the selection, read top to bottom.
 */

/** Clear of the selection, and of the fingertip that is dragging it. */
const GAP_PX = 18;
const MENU_WIDTH_PX = 176;

type ActionId = 'edit' | 'scale' | 'duplicate' | 'material' | 'art' | 'lighting' | 'delete';

type MenuEntry =
  | { kind: 'divider'; id: string }
  | {
      kind: 'action';
      id: ActionId;
      label: string;
      icon: typeof Copy;
      hint: string;
      danger?: boolean;
    };

/**
 * The menu, in order.
 *
 * Deliberately short. Everything here is either the most common edit for the
 * object under the cursor or a door to the panel that owns the rest, and a
 * menu that grows past a glance stops being quicker than the sidebar it is
 * meant to save a trip to.
 *
 * Lock is absent on purpose. It is the one entry that changes whether the
 * others do anything at all, and one slip from Duplicate — in a menu that
 * appears under the cursor — is how an object silently stops responding. It
 * stays on L and in the properties panel.
 */
const ACTIONS: MenuEntry[] = [
  { kind: 'action', id: 'edit', label: 'Edit', icon: Brush, hint: 'Open this object’s own settings' },
  { kind: 'action', id: 'scale', label: 'Scale', icon: Scaling, hint: 'Resize with the gizmo (E)' },
  { kind: 'action', id: 'duplicate', label: 'Duplicate', icon: Copy, hint: 'Make another (Ctrl+D)' },
  { kind: 'action', id: 'art', label: 'Add Art', icon: Sticker, hint: 'Stand artwork in front of it' },
  { kind: 'action', id: 'lighting', label: 'Set Lighting', icon: Lightbulb, hint: 'Light this object' },
  { kind: 'divider', id: 'd1' },
  { kind: 'action', id: 'delete', label: 'Delete', icon: Trash2, hint: 'Remove it (Del)', danger: true },
];

export function SelectionToolbar() {
  const selected = useSelectedObjects();
  const readOnly = useEditor((s) => s.readOnly);
  const transformMode = useEditor((s) => s.transformMode);
  const setTransformMode = useEditor((s) => s.setTransformMode);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const deleteSelected = useEditor((s) => s.deleteSelected);
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

  // A window about the selection has no subject once the selection is gone.
  useEffect(() => {
    if (!selected.length) setQuick(null);
  }, [selected.length]);

  /**
   * What each entry does.
   *
   * Kept in one place so the list above stays a description of the menu rather
   * than a pile of handlers. Entries that open a panel set the store and let
   * the panel appear; entries that act on the selection act immediately.
   */
  const run = (id: ActionId) => {
    const store = useEditor.getState();
    switch (id) {
      case 'edit':
        /*
         * "Edit" means the object's own settings, and which panel that is
         * depends on what it is: an LED screen has its own editor over the
         * screen, everything else belongs in the properties dock.
         */
        if (selected.length === 1 && selected[0]!.type === 'led') {
          store.setLedQuickEditId(selected[0]!.id);
        } else {
          setQuick(quick === 'material' ? null : 'material');
        }
        break;
      case 'scale':
        setTransformMode('scale');
        break;
      case 'duplicate':
        duplicateSelected();
        break;
      case 'material':
        setQuick(quick === 'material' ? null : 'material');
        break;
      case 'art':
        setQuick(quick === 'art' ? null : 'art');
        break;
      case 'lighting':
        // The lighting rail owns fixtures and looks; this is the door to it.
        store.setWorkPanel('light');
        break;
      case 'delete':
        deleteSelected();
        break;
    }
  };

  // Drafting has its own interaction; a transform bar there is noise.
  if (!selected.length || readOnly || tool === 'draw' || tool === 'wall') return null;


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
        left: Math.round(Math.min(Math.max(left, MENU_WIDTH_PX + 16), container.width - MENU_WIDTH_PX - 16)),
        top: Math.round(Math.min(Math.max(top, 8), container.height - 120)),
        transform: flip ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
      }}
    >
      {/*
        A vertical menu, beside the selection.

        The horizontal pill this replaces put mode switches and one-off actions
        in one row, which made a mode look like a button and a button look like
        a mode. Move, rotate and scale have moved to the fixed rail in the
        corner where a mode belongs; what is left here is the short list of
        things you do *to* the selected object, read top to bottom.

        Lock is gone from it deliberately. It is the one entry that changes
        whether the other entries do anything at all, and having it one slip
        away from Duplicate — in a menu that appears under the cursor — is how
        an object silently stops responding. It is still on L and still in the
        properties panel.
      */}
      <div
        data-testid="selection-toolbar"
        className="pointer-events-auto overflow-hidden rounded-xl border border-line bg-surface-strong/95 py-1 shadow-xl backdrop-blur transition-opacity duration-150"
        style={{ width: MENU_WIDTH_PX, opacity: dragging ? 0.35 : 1 }}
      >
        {ACTIONS.map((action) => {
          if (action.kind === 'divider') {
            return <span key={action.id} className="my-1 block h-px bg-line" />;
          }

          const Icon = action.icon;
          const active = action.id === 'scale'
            ? transformMode === 'scale'
            : action.id === 'material'
              ? quick === 'material'
              : action.id === 'art'
                ? quick === 'art'
                : false;

          return (
            <button
              key={action.id}
              type="button"
              title={action.hint}
              aria-pressed={active}
              onClick={() => run(action.id)}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] font-medium transition ${
                active
                  ? 'bg-primary/12 text-primary'
                  : action.danger
                    ? 'text-danger hover:bg-danger/10'
                    : 'text-ink hover:bg-surface-muted'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{action.label}</span>
              {action.id === 'duplicate' && selected.length > 1 ? (
                <span className="ml-auto text-[11px] font-semibold text-ink-subtle">{selected.length}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {quick ? <ObjectQuickActions action={quick} flipped={flip} onClose={() => setQuick(null)} /> : null}
    </div>
  );
}
