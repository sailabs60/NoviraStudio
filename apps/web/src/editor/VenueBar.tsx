import { useState } from 'react';
import { Building2, Check, ChevronUp, Crosshair, Layers, Lock, Unlock } from 'lucide-react';
import { activeFloor, boundsDepthMm, boundsWidthMm } from '@novira/shared';
import { useEditor } from './editorStore';

/**
 * The room, on the bottom toolbar.
 *
 * Added *beside* the view controls that have always lived there rather than
 * replacing or rearranging any of them: Plan, 3D, Grid, Snap, Walls and the
 * rest keep their positions exactly, and this appears to their right only once
 * a plan actually has a venue. On a plan drawn on open ground it is not there
 * at all, so nobody pays for a control that has nothing to say.
 *
 * ## What it is for
 *
 * Three things a designer working inside a building needs constantly and had no
 * way to reach:
 *
 *  · **Which storey am I on.** An imported building is frequently several
 *    floors, and until now the editor had one floor — y = 0 — which is not
 *    where any of them are. Choosing one here moves the camera to it, and
 *    everything placed afterwards lands on it rather than in the basement.
 *  · **Take me back to the room.** The single most common thing to want after
 *    orbiting out to look at something: one button, and the view returns to the
 *    hall framed as a hall. Fit already does this now, but a designer who has
 *    flown outside the building is exactly the person who will not think to
 *    press a button labelled Fit.
 *  · **Keep me inside it.** The camera is held within the walls while this is
 *    on, which is what makes navigating a venue feel like being in a room.
 *    Switchable, because inspecting the outside of a building you have just
 *    imported is a legitimate thing to want — it is simply never what somebody
 *    laying out chairs meant to do.
 */
export function VenueBar({ labelled }: { labelled: boolean }) {
  const site = useEditor((s) => s.venueSite);
  const setActiveFloor = useEditor((s) => s.setActiveFloor);
  const requestFrameVenue = useEditor((s) => s.requestFrameVenue);
  const confine = useEditor((s) => s.confineToVenue);
  const toggleConfine = useEditor((s) => s.toggleConfineToVenue);
  const units = useEditor((s) => s.units);

  const [floorsOpen, setFloorsOpen] = useState(false);

  // No venue, no bar. The editor behaves exactly as it always has.
  if (!site) return null;

  const current = activeFloor(site);
  const many = site.floors.length > 1;

  const size = (mm: number) =>
    units === 'metric' ? `${(mm / 1000).toFixed(1)} m` : `${Math.round(mm / 304.8)} ft`;

  return (
    <>
      <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />

      {/*
        Which room this is.

        A label rather than a button: it is the answer to "where am I", which is
        worth a permanent line of the toolbar on a plan set in a real building
        and is not worth a click.
      */}
      <span
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary/8 px-2 py-1 text-[11px] font-semibold text-primary"
        title={`${site.name} — ${size(boundsWidthMm(current.boundsMm))} × ${size(
          boundsDepthMm(current.boundsMm)
        )}${current.clearHeightMm ? `, ${size(current.clearHeightMm)} clear` : ''}`}
      >
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        {labelled ? <span className="max-w-[130px] truncate">{site.name}</span> : null}
      </span>

      {/* The storey, when the building has more than one. */}
      {many ? (
        <div className="relative shrink-0">
          <button
            type="button"
            className="ed-action"
            aria-expanded={floorsOpen}
            onClick={() => setFloorsOpen((v) => !v)}
            title="Which storey you are designing on"
          >
            <Layers className="h-3.5 w-3.5" />
            <span className="max-w-[110px] truncate">{current.name}</span>
            <ChevronUp className="h-3 w-3 opacity-60" />
          </button>

          {floorsOpen ? (
            <>
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setFloorsOpen(false)}
              />
              {/*
                Opens upward: this bar is pinned to the bottom edge of the
                window, so a menu hanging below it would be off the screen.
                Highest storey first, because that is the order a lift panel
                and a stair core use and the order people picture a building in.
              */}
              <div className="absolute bottom-full left-0 z-40 mb-1.5 w-[240px] overflow-hidden rounded-xl border border-line bg-surface-strong/98 py-1 shadow-xl backdrop-blur">
                {[...site.floors]
                  .sort((a, b) => b.elevationMm - a.elevationMm)
                  .map((floor) => {
                    const active = floor.id === current.id;
                    return (
                      <button
                        key={floor.id}
                        type="button"
                        onClick={() => {
                          setActiveFloor(floor.id);
                          setFloorsOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition ${
                          active ? 'bg-primary/10 text-primary' : 'text-ink hover:bg-surface-muted'
                        }`}
                      >
                        <Check className={`h-3.5 w-3.5 shrink-0 ${active ? '' : 'opacity-0'}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold">{floor.name}</span>
                          <span className="block truncate text-[10px] tabular-nums text-ink-subtle">
                            {size(floor.elevationMm)} up · {size(boundsWidthMm(floor.boundsMm))} ×{' '}
                            {size(boundsDepthMm(floor.boundsMm))}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                <p className="border-t border-line px-3 py-1.5 text-[10px] leading-snug text-ink-subtle">
                  New objects land on the storey you choose, and the view goes with it.
                </p>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className="ed-action shrink-0"
        onClick={() => requestFrameVenue()}
        title={`Bring the view back inside ${site.name}`}
      >
        <Crosshair className="h-3.5 w-3.5" />
        {labelled ? <span>Room</span> : null}
      </button>

      <button
        type="button"
        className={`ed-action shrink-0 ${
          confine ? 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary' : ''
        }`}
        aria-pressed={confine}
        onClick={toggleConfine}
        title={
          confine
            ? 'The camera is kept inside the building. Turn off to look at it from outside.'
            : 'The camera may leave the building. Turn on to stay inside the room.'
        }
      >
        {confine ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
        {labelled ? <span>{confine ? 'Inside' : 'Free'}</span> : null}
      </button>
    </>
  );
}
