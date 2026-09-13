import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Brush,
  Copy,
  CornerUpLeft,
  Crosshair,
  Lightbulb,
  Lock,
  MoreHorizontal,
  Palette,
  RotateCw,
  Scaling,
  Sticker,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useEditor } from './editorStore';
import { useSelectedObjects } from './selectors';
import { ObjectQuickActions } from './ObjectQuickActions';

/**
 * The quick menu: the actions for whatever is selected, beside it.
 *
 * ## What was wrong with the one this replaces
 *
 * Three faults, and they compounded.
 *
 * **It left the viewport.** It was positioned absolutely inside the viewport
 * element but clamped against `window.innerWidth` and `window.innerHeight`.
 * Those are only the same number when the canvas fills the screen, and it
 * never does — the icon rail, an open work panel and the properties dock
 * between them take six hundred pixels off the left and right. So an object
 * near the left edge of the canvas put the menu behind the work panel, and one
 * low in the frame put it under the bottom toolbar. The clamp was doing its
 * job against the wrong rectangle.
 *
 * **It covered the object.** A 176 px column of seven full-width rows is
 * roughly two hundred pixels tall, hung directly over the selection with an
 * 18 px gap. On anything but a small object in the middle of an empty plan
 * that is a wall of buttons across the thing being edited — and it flipped
 * *underneath* near the top of the frame, which covers the object just as
 * thoroughly from the other side.
 *
 * **It was the wrong shape.** A vertical list of labelled rows is the shape of
 * a context menu you summoned and will dismiss. This one is always up for as
 * long as something is selected, so it is furniture, and furniture in a
 * viewport has to be small.
 *
 * ## What this does instead
 *
 * The pattern every mature 2D and 3D editor converged on — Figma's selection
 * bar, Spline's object bar, Blender's tool header, Shapr3D's contextual
 * strip — which is a **short horizontal strip of icons placed to the side of
 * the selection**, not over it, with everything beyond the few most-used
 * actions folded behind one overflow button.
 *
 *  · **It is measured against the canvas.** The viewport element's own
 *    rectangle is observed, and the strip is clamped to it. It cannot leave
 *    the frame, and it cannot slide under a panel, because the rectangle it is
 *    held inside is the one the user can actually see.
 *
 *  · **It is placed beside, never across.** Four candidate positions are tried
 *    in order — right of the selection, left of it, above, below — and the
 *    first that fits without overlapping the selection's own screen box wins.
 *    Only if the selection fills the frame does it fall back to a corner, and
 *    even then it sits in the emptiest one.
 *
 *  · **It is small.** One row, 32 px tall, icons only, six actions and an
 *    overflow. It reads as a control attached to the object rather than as a
 *    panel parked on top of it.
 *
 *  · **It holds still.** The position is frozen for the whole of a drag and
 *    for a beat afterwards, and — the part that was missing — it is *also*
 *    frozen while the pointer is over the strip itself. A menu that re-places
 *    itself while you are travelling towards a button is a menu you misclick.
 *
 *  · **It does not fight the object for attention.** During a transform drag
 *    it fades most of the way out rather than staying at full strength across
 *    the thing being moved.
 */

/** Clear of the selection's own box, and of the fingertip dragging it. */
const GAP_PX = 14;
/** Keep this far from the edges of the canvas. */
const EDGE_PX = 10;
const STRIP_HEIGHT_PX = 34;

type ActionId =
  | 'edit'
  | 'material'
  | 'rotate'
  | 'scale'
  | 'duplicate'
  | 'art'
  | 'lighting'
  | 'focus'
  | 'lock'
  | 'reset'
  | 'delete';

interface Action {
  id: ActionId;
  label: string;
  icon: typeof Copy;
  hint: string;
  danger?: boolean;
}

/**
 * The six that live on the strip, in the order a designer reaches for them.
 *
 * Deliberately the *verbs*, not the modes. Move, rotate and scale are modes —
 * one is always on and which one changes what a drag does — and they keep
 * their fixed home in the corner rail where muscle memory can settle (see
 * `TransformRail`). Rotate appears here as well because turning a thing to
 * face the stage is the single most common edit in this product and it is
 * worth the one duplicated affordance.
 */
const PRIMARY: Action[] = [
  { id: 'edit', label: 'Edit', icon: Brush, hint: 'This object’s own settings' },
  { id: 'material', label: 'Material', icon: Palette, hint: 'Change the finish' },
  { id: 'rotate', label: 'Rotate', icon: RotateCw, hint: 'Turn it (R)' },
  { id: 'duplicate', label: 'Duplicate', icon: Copy, hint: 'Make another (Ctrl+D)' },
  { id: 'focus', label: 'Focus', icon: Crosshair, hint: 'Bring the view to it (F)' },
  { id: 'delete', label: 'Delete', icon: Trash2, hint: 'Remove it (Del)', danger: true },
];

/**
 * The rest, behind the overflow.
 *
 * Everything here is either rarer or more consequential than the six above.
 * Lock in particular is deliberately one step further away: it is the entry
 * that decides whether any of the others do anything at all, and one slip from
 * Duplicate is how an object silently stops responding to every gesture.
 */
const OVERFLOW: Action[] = [
  { id: 'scale', label: 'Scale', icon: Scaling, hint: 'Resize with the gizmo (E)' },
  { id: 'art', label: 'Add artwork', icon: Sticker, hint: 'Stand a graphic in front of it' },
  { id: 'lighting', label: 'Light it', icon: Lightbulb, hint: 'Open the lighting rail' },
  { id: 'reset', label: 'Straighten', icon: CornerUpLeft, hint: 'Back to square, at full size' },
  { id: 'lock', label: 'Lock', icon: Lock, hint: 'Stop it being moved (L)' },
];

/** One position the strip could take, and whether it is allowed. */
interface Placement {
  left: number;
  top: number;
  /** How much of the selection's box it would cover. Zero is what we want. */
  overlap: number;
}

export function SelectionToolbar() {
  const selected = useSelectedObjects();
  const readOnly = useEditor((s) => s.readOnly);
  const transformMode = useEditor((s) => s.transformMode);
  const setTransformMode = useEditor((s) => s.setTransformMode);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const toggleLockSelected = useEditor((s) => s.toggleLockSelected);
  const updateObjects = useEditor((s) => s.updateObjects);
  const requestFrameSelection = useEditor((s) => s.requestFrameSelection);
  const tool = useEditor((s) => s.tool);
  const anchor = useEditor((s) => s.selectionAnchor);

  const [quick, setQuick] = useState<'material' | 'art' | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);

  /*
   * The canvas rectangle, measured rather than assumed.
   *
   * This is the fix for the menu leaving the viewport. The strip is positioned
   * inside the viewport element, so the only rectangle it may be clamped to is
   * that element's — which changes whenever a panel opens, the window resizes,
   * or the bottom toolbar is dragged taller, hence the observer rather than a
   * one-off read.
   */
  const hostRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ width: number; height: number }>({ width: 1200, height: 800 });

  useLayoutEffect(() => {
    // This element is `inset-0` inside the viewport, so its own box *is* the
    // canvas rectangle — no need to reach for a parent whose identity could
    // change if the tree around it is ever rearranged.
    const node = hostRef.current;
    if (!node) return;
    const read = () => setFrame({ width: node.clientWidth, height: node.clientHeight });
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /*
   * Hold the position still while it is being used.
   *
   * Two separate reasons to freeze, and the old version only had the first.
   * **A drag** moves the object, so the strip would chase it across the screen
   * and the button you were reaching for would not be there when you arrived.
   * **A hover** means the pointer is already travelling to a button on the
   * strip, and a re-place then is the same misclick from the other direction —
   * an object settling a few pixels as a model finishes loading is enough to
   * do it.
   */
  const frozen = useRef<typeof anchor>(null);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button === 0 || e.button === 2) setDragging(true);
    };
    const onUp = () => window.setTimeout(() => setDragging(false), 240);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const held = dragging || hovering || overflowOpen || quick !== null;
  if (!held) frozen.current = anchor;
  const placed = held ? (frozen.current ?? anchor) : anchor;

  // A window about the selection has no subject once the selection is gone.
  useEffect(() => {
    if (!selected.length) {
      setQuick(null);
      setOverflowOpen(false);
    }
  }, [selected.length]);

  const locked = selected.length > 0 && selected.every((object) => object.locked);

  /**
   * What each entry does.
   *
   * Kept in one place so the lists above stay a description of the menu rather
   * than a pile of handlers.
   */
  const run = useCallback(
    (id: ActionId) => {
      const store = useEditor.getState();
      setOverflowOpen(false);

      switch (id) {
        case 'edit':
          /*
           * "Edit" means the object's own settings, and which panel that is
           * depends on what it is: an LED screen has its own editor over the
           * screen, everything else belongs in the properties dock, which is
           * where this opens it.
           */
          if (selected.length === 1 && selected[0]!.type === 'led') {
            store.setLedQuickEditId(selected[0]!.id);
          } else {
            // The dock follows the selection on its own, but it can be shut —
            // in which case the most obvious button in the menu did nothing.
            store.requestProperties();
          }
          break;
        case 'material':
          setQuick((current) => (current === 'material' ? null : 'material'));
          break;
        case 'art':
          setQuick((current) => (current === 'art' ? null : 'art'));
          break;
        case 'rotate':
          setTransformMode('rotate');
          break;
        case 'scale':
          setTransformMode('scale');
          break;
        case 'duplicate':
          duplicateSelected();
          break;
        case 'focus':
          requestFrameSelection();
          break;
        case 'lighting':
          store.requestPanel('light');
          break;
        case 'lock':
          toggleLockSelected();
          break;
        case 'reset':
          /*
           * Square and full size again.
           *
           * The one repair everybody needs and nobody can find: an object
           * nudged to 3° off and scaled to 1.02 by a stray gizmo drag looks
           * *almost* right, which is worse than looking wrong. Position is
           * deliberately untouched — "straighten this" has never meant "and
           * put it back where it came from".
           */
          updateObjects(
            selected.map((object) => object.id),
            { rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
          );
          break;
        case 'delete':
          deleteSelected();
          break;
      }
    },
    [
      selected,
      setTransformMode,
      duplicateSelected,
      deleteSelected,
      toggleLockSelected,
      updateObjects,
      requestFrameSelection,
    ]
  );

  // Drafting has its own interaction; a selection strip there is noise.
  if (!selected.length || readOnly || tool === 'draw' || tool === 'wall') return null;

  const width = stripWidth(selected.length);
  const spot = choosePlacement(placed, frame, width, STRIP_HEIGHT_PX);

  /*
   * Which way the popovers open.
   *
   * A window hung off the bottom of a strip that is already low in the frame
   * is a window half off the screen, so it is decided from where the strip
   * actually landed rather than from a fixed rule.
   */
  const openDownward = spot.top < frame.height / 2;

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-20" aria-hidden={false}>
      <div
        className="pointer-events-none absolute"
        style={{ left: spot.left, top: spot.top }}
      >
        <div
          data-testid="selection-toolbar"
          onPointerEnter={() => setHovering(true)}
          onPointerLeave={() => setHovering(false)}
          className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-line bg-surface-strong/95 p-1 shadow-xl backdrop-blur transition-opacity duration-150"
          style={{
            width,
            height: STRIP_HEIGHT_PX,
            // Nearly out of the way while something is being dragged: the
            // object is what matters during a gesture, not its menu.
            opacity: dragging && !hovering ? 0.25 : 1,
          }}
        >
          {/*
            How many are selected, when it is more than one.

            Leading the strip rather than trailing it, because it changes what
            every button after it means — "Delete" with a 24 beside it is a
            different decision from "Delete" alone.
          */}
          {selected.length > 1 ? (
            <span className="ml-0.5 mr-1 shrink-0 rounded-md bg-primary/12 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-primary">
              {selected.length}
            </span>
          ) : null}

          {PRIMARY.map((action) => (
            <StripButton
              key={action.id}
              action={action}
              active={
                action.id === 'rotate'
                  ? transformMode === 'rotate'
                  : action.id === 'material'
                    ? quick === 'material'
                    : false
              }
              onClick={() => run(action.id)}
            />
          ))}

          <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-line" />

          <div className="relative shrink-0">
            <button
              type="button"
              title="Everything else"
              aria-label="More actions"
              aria-expanded={overflowOpen}
              onClick={() => setOverflowOpen((v) => !v)}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
                overflowOpen ? 'bg-primary/12 text-primary' : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
              }`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {overflowOpen ? (
              <>
                {/* Click anywhere else to dismiss. */}
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  className="fixed inset-0 z-0 cursor-default"
                  onClick={() => setOverflowOpen(false)}
                />
                <div
                  className={`absolute right-0 z-10 w-[186px] overflow-hidden rounded-xl border border-line bg-surface-strong/98 py-1 shadow-xl backdrop-blur ${
                    openDownward ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
                  }`}
                >
                  {OVERFLOW.map((action) => {
                    const isLock = action.id === 'lock';
                    const Icon = isLock && locked ? Unlock : action.icon;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        title={action.hint}
                        onClick={() => run(action.id)}
                        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] font-medium text-ink transition hover:bg-surface-muted"
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                        <span className="truncate">
                          {isLock ? (locked ? 'Unlock' : 'Lock') : action.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
        </div>

        {quick ? (
          <ObjectQuickActions
            action={quick}
            flipped={openDownward}
            onClose={() => setQuick(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

/** One icon on the strip. */
function StripButton({
  action,
  active,
  onClick,
}: {
  action: Action;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      title={`${action.label} — ${action.hint}`}
      aria-label={action.label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition ${
        active
          ? 'bg-primary text-primary-fg shadow-sm'
          : action.danger
            ? 'text-ink-muted hover:bg-danger/10 hover:text-danger'
            : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/** The strip's width: six icons, a divider, an overflow, and maybe a count. */
function stripWidth(selectedCount: number): number {
  const icons = PRIMARY.length + 1; // + overflow
  return 8 + icons * 28 + icons * 2 + 9 + (selectedCount > 1 ? 26 : 0);
}

/**
 * Where to put the strip, given where the selection is on screen.
 *
 * Four candidates are scored, and the rule is simple: **never overlap the
 * selection's own screen box**, and never leave the canvas. Right of the
 * object is tried first because it is where the eye goes in a left-to-right
 * interface and because the gizmo's own arrows occupy the space directly
 * above; left is the mirror for an object near the right edge; above and below
 * catch a selection that is wide but short, like a stage or an LED wall.
 *
 * Every candidate is clamped to the canvas *before* it is scored, so a
 * position that only fits by hanging off the edge is correctly judged as
 * overlapping once it has been pulled back in. That ordering is the whole
 * reason this cannot end up off-screen.
 *
 * With no anchor at all — a selection the camera cannot see, which happens
 * while a model is still loading — it sits top-centre, out of the way of both
 * the transform rail and the compass.
 */
function choosePlacement(
  anchor: { x: number; top: number; bottom: number } | null,
  frame: { width: number; height: number },
  width: number,
  height: number
): { left: number; top: number } {
  const minLeft = EDGE_PX;
  const maxLeft = Math.max(EDGE_PX, frame.width - width - EDGE_PX);
  const minTop = EDGE_PX;
  const maxTop = Math.max(EDGE_PX, frame.height - height - EDGE_PX);

  if (!anchor) {
    return { left: Math.round(Math.min(Math.max(frame.width / 2 - width / 2, minLeft), maxLeft)), top: 56 };
  }

  /*
   * The selection's screen box.
   *
   * `SelectionAnchor` publishes the horizontal centre and the top and bottom
   * edges of the projected bounding box. The horizontal extent has to be
   * estimated from the vertical one, because that is all there is — and a
   * square guess is the safe one: it errs towards treating the object as wider
   * than it is, which pushes the strip further clear rather than closer.
   */
  const objectHeight = Math.max(24, anchor.bottom - anchor.top);
  const halfWidth = objectHeight / 2;
  const box = {
    left: anchor.x - halfWidth,
    right: anchor.x + halfWidth,
    top: anchor.top,
    bottom: anchor.bottom,
  };
  const middle = (anchor.top + anchor.bottom) / 2 - height / 2;

  const candidates: Placement[] = [
    // Right of it.
    { left: box.right + GAP_PX, top: middle, overlap: 0 },
    // Left of it.
    { left: box.left - GAP_PX - width, top: middle, overlap: 0 },
    // Above it.
    { left: anchor.x - width / 2, top: box.top - GAP_PX - height, overlap: 0 },
    // Below it.
    { left: anchor.x - width / 2, top: box.bottom + GAP_PX, overlap: 0 },
  ];

  let best: Placement | null = null;
  for (const candidate of candidates) {
    const left = Math.min(Math.max(candidate.left, minLeft), maxLeft);
    const top = Math.min(Math.max(candidate.top, minTop), maxTop);
    const overlap =
      Math.max(0, Math.min(left + width, box.right) - Math.max(left, box.left)) *
      Math.max(0, Math.min(top + height, box.bottom) - Math.max(top, box.top));

    // The first that covers nothing wins outright; ordering is the preference.
    if (overlap === 0) return { left: Math.round(left), top: Math.round(top) };
    if (!best || overlap < best.overlap) best = { left, top, overlap };
  }

  /*
   * Nothing fits clear — the selection fills the frame, which happens when
   * somebody has framed a single large object. The least-bad candidate is
   * used, which by construction is the one covering the smallest corner of it.
   */
  return { left: Math.round(best!.left), top: Math.round(best!.top) };
}
