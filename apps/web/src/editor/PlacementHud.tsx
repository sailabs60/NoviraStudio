import { useEffect } from 'react';
import { CornerDownLeft, Grid3x3, Magnet, RotateCw, X } from 'lucide-react';
import { activeFloor, formatLength, withinBounds } from '@novira/shared';
import { useEditor } from './editorStore';

/**
 * What is about to be placed, and where it is going to land.
 *
 * ## What this replaces
 *
 * A pill reading "Click the floor to place Banquet Chair — Esc to cancel". It
 * was true, and it answered none of the questions somebody actually has with an
 * armed cursor in a room they are laying out:
 *
 *  · *How big is this thing?* A generated model or an unfamiliar catalogue row
 *    is a name until it is on the floor, and by then it is a mistake to undo.
 *  · *Where exactly will it go?* The ghost shows roughly; a gangway width is
 *    not a roughly.
 *  · *Is snapping on?* The single most common reason a placement lands 40 mm
 *    off, and it was readable only by looking at a toolbar at the other end of
 *    the screen.
 *  · *Am I even inside the room?* On a plan set in a real venue it is entirely
 *    possible to be pointing at the car park.
 *
 * ## The shape of it
 *
 * A compact bar at the top of the viewport — the one place that is reliably
 * empty, above the plan and clear of both the transform rail and the compass —
 * carrying the name, the real measured size, the live position, and the two
 * modifiers that change what the click does. It updates as the cursor moves,
 * because that is the whole point: the decision is made before the click, not
 * after it.
 *
 * The modifiers are stated rather than hidden in a tooltip. **Shift** keeps the
 * cursor armed so a run of twelve cocktail tables is twelve clicks rather than
 * twelve trips back to the catalogue, and **S** toggles snapping without
 * leaving the gesture. Neither is discoverable by trying, so neither is worth
 * having unless it is written down where the hand already is.
 */
export function PlacementHud() {
  const pendingItem = useEditor((s) => s.pendingItem);
  const placeHover = useEditor((s) => s.placeHover);
  const snapToGrid = useEditor((s) => s.snapToGrid);
  const toggleSnap = useEditor((s) => s.toggleSnap);
  const gridSizeMm = useEditor((s) => s.scene.gridSizeMm);
  const setPendingItem = useEditor((s) => s.setPendingItem);
  const units = useEditor((s) => s.units);
  const site = useEditor((s) => s.venueSite);

  /*
   * Escape disarms, wherever the focus is.
   *
   * The editor's own global handler does clear the pending item, but it also
   * clears the selection and closes panels — and an armed cursor is a mode the
   * user is *in*, so Escape should leave that mode and stop, not unwind three
   * other things with it. Capture phase, and it stops there.
   */
  useEffect(() => {
    if (!pendingItem) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setPendingItem(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [pendingItem, setPendingItem]);

  if (!pendingItem) return null;

  const length = (mm: number | null | undefined) =>
    typeof mm === 'number' && mm > 0 ? formatLength(mm, units, { bare: units === 'metric' }) : null;

  const dims = [pendingItem.widthMm, pendingItem.depthMm, pendingItem.heightMm]
    .map(length)
    .filter(Boolean)
    .join(' × ');

  /*
   * Whether the cursor is over the room.
   *
   * Only asked when the plan knows where the room is. Outside a venue this is
   * meaningless — a plan on open ground has no outside — and saying nothing is
   * the honest answer rather than a warning nobody can act on.
   */
  const outside =
    site && placeHover
      ? !withinBounds(activeFloor(site).boundsMm, placeHover.xMm, placeHover.zMm)
      : false;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-16">
      <div
        className={`pointer-events-auto flex max-w-full items-center gap-2.5 overflow-hidden rounded-xl border bg-surface-strong/95 py-1.5 pl-3 pr-1.5 shadow-xl backdrop-blur ${
          outside ? 'border-warning/50' : 'border-primary/40'
        }`}
      >
        {/* What is being placed, and how big it really is. */}
        <span className="flex min-w-0 items-baseline gap-2">
          <strong className="truncate text-[12px] font-bold text-ink">{pendingItem.name}</strong>
          {dims ? (
            <span className="shrink-0 text-[11px] tabular-nums text-success">{dims}</span>
          ) : null}
        </span>

        <span aria-hidden className="h-4 w-px shrink-0 bg-line" />

        {/* Where it will land, live. */}
        <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">
          {placeHover ? (
            <>
              {formatLength(placeHover.xMm, units, { bare: units === 'metric' })},{' '}
              {formatLength(placeHover.zMm, units, { bare: units === 'metric' })}
            </>
          ) : (
            'Point at the floor'
          )}
        </span>

        {outside ? (
          <span className="shrink-0 rounded-md bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold text-warning">
            Outside the room
          </span>
        ) : null}

        <span aria-hidden className="h-4 w-px shrink-0 bg-line" />

        {/*
          Snapping, where the decision is being made.

          Readable and changeable without leaving the gesture — it is the one
          setting that silently decides whether a placement lands on the grid,
          and crossing the screen to the toolbar to check means losing the
          cursor position you were lining up.
        */}
        <button
          type="button"
          onClick={toggleSnap}
          aria-pressed={snapToGrid}
          title={
            snapToGrid
              ? `Snapping to the ${formatLength(gridSizeMm, units)} grid — click to place freely (S)`
              : 'Placing freely — click to snap to the grid (S)'
          }
          className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
            snapToGrid
              ? 'bg-primary/12 text-primary'
              : 'text-ink-subtle hover:bg-surface-muted hover:text-ink'
          }`}
        >
          {snapToGrid ? <Magnet className="h-3 w-3" /> : <Grid3x3 className="h-3 w-3" />}
          {snapToGrid ? formatLength(gridSizeMm, units) : 'Free'}
        </button>

        {/*
          The modifier that makes laying out a room bearable, written down
          because nobody discovers it by trying.
        */}
        <span className="hidden shrink-0 items-center gap-1 text-[10px] text-ink-subtle sm:flex">
          <kbd className="rounded border border-line bg-surface px-1 font-sans font-semibold">Shift</kbd>
          keep placing
        </span>
        <span className="hidden shrink-0 items-center gap-1 text-[10px] text-ink-subtle lg:flex">
          <RotateCw className="h-3 w-3" />
          <kbd className="rounded border border-line bg-surface px-1 font-sans font-semibold">R</kbd>
          after
        </span>

        <button
          type="button"
          onClick={() => setPendingItem(null)}
          title="Cancel (Esc)"
          aria-label="Cancel placing"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition hover:bg-danger/10 hover:text-danger"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * The confirmation after something lands.
 *
 * A placement that succeeds and says nothing is indistinguishable from one that
 * failed, especially the first time — which is why the most common thing a new
 * user does after clicking the floor is click it again. This is one line, it
 * fades, and it names what arrived and offers the way back.
 */
export function PlacementEcho() {
  const last = useEditor((s) => s.lastPlaced);
  const armed = useEditor((s) => s.pendingItem !== null);
  const undo = useEditor((s) => s.undo);

  if (!last) return null;

  /*
   * Silent while the cursor is still armed.
   *
   * Holding Shift keeps the cursor loaded so a run of twelve tables is twelve
   * clicks — and during that run both this and the placement bar want the same
   * strip at the top of the viewport. The bar wins, because it is the one
   * carrying live information about the *next* placement; a confirmation of the
   * last one stacked behind it would be unreadable and would say nothing the
   * new object appearing on the floor has not already said.
   *
   * It still fires for the final placement of the run, which is the one where
   * the cursor disarms and the offer of an undo is worth having.
   */
  if (armed) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-16">
      <div className="nv-rise pointer-events-auto flex items-center gap-2 rounded-xl border border-success/40 bg-surface-strong/95 py-1.5 pl-3 pr-1.5 shadow-lg backdrop-blur">
        <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-success" />
        <span className="truncate text-[12px] font-semibold text-ink">{last.name} placed</span>
        <button
          type="button"
          onClick={undo}
          className="shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-semibold text-primary transition hover:bg-primary/10"
        >
          Undo
        </button>
      </div>
    </div>
  );
}
