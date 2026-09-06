import { useEffect, useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import { usePreferences } from '../store/preferences';
import { useEditor, type WorkPanel } from '../editor/editorStore';

/**
 * The first-run tour.
 *
 * Nine steps, each one a single sentence about a single place, and each one
 * *opens* that place as it explains it. A tour that describes an interface
 * without moving through it teaches nothing — people remember where they have
 * been, not what they have read.
 *
 * It can be dismissed at any point and never returns unless asked for, because
 * the second most annoying thing after a product you cannot learn is one that
 * keeps teaching you after you have.
 */

interface Step {
  panel: WorkPanel | null;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    panel: null,
    title: 'This is your room, in 3D',
    body: 'On a trackpad: slide two fingers to move around, pinch to zoom, drag to orbit. On a mouse: left-drag orbits, right-drag moves around, scroll zooms. Press F at any time to fit everything back on screen — you cannot get lost.',
  },
  {
    panel: 'add',
    title: 'Create is where things come from',
    body: 'Drag anything from the library straight into the room. A ghost of it stands on the floor as you move, so you can see it fits before you let go.',
  },
  {
    panel: 'build',
    title: 'Build is where you make things to size',
    body: 'Staging, truss, LED screens and exhibition stands are specified rather than picked. Change a number and the parts list, weight and power change with it.',
  },
  {
    panel: 'finish',
    title: 'Finish paints what you drop it on',
    body: 'Drag a material onto any surface and it lands on that part — the seat, not the whole chair. Drop it on empty floor to carpet the room.',
  },
  {
    panel: 'site',
    title: 'Site is the building',
    body: 'Pick a venue and its height limit, pillars, rigging capacity, supplies and truck route all arrive at once. Everything after that is checked against them.',
  },
  {
    panel: 'light',
    title: 'Light it in one press',
    body: 'Choose a look, press Light this scene, and a key, fill, back light, room wash and accents are rigged around whatever you have built.',
  },
  {
    panel: 'cost',
    title: 'It has already been measured',
    body: 'LED in square metres, truss in metres, carpet, print, labour — measured from the drawing, not estimated. Click any line to see exactly how.',
  },
  {
    panel: 'check',
    title: 'And already checked',
    body: 'Fire exits, sightlines, screen distances, aisle widths and step-free access, against the rules for your market. Every finding says which rule it applied.',
  },
  {
    panel: 'present',
    title: 'Then send it',
    body: 'Renders, a walkthrough video, a dimensioned drawing, CAD for the workshop, a bill of quantities and a client deck — all generated from this one plan.',
  },
];

export function GuidedTour({ force, onFinish }: { force?: boolean; onFinish?: () => void }) {
  const tourCompleted = usePreferences((s) => s.tourCompleted);
  const setPreference = usePreferences((s) => s.set);
  const setWorkPanel = useEditor((s) => s.setWorkPanel);

  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);

  /*
   * Stand aside for a real dialog.
   *
   * A new user opens the editor, the tour appears, and the first thing they
   * click opens a modal — leaving two dialogs on screen at once, one of them
   * explaining a panel the modal is covering. The tour is the less important
   * of the two every time, so it hides while a modal is open and comes back
   * when it closes. Polled rather than wired through a context because the
   * modals are spread across two dozen components and none of them should have
   * to know the tour exists.
   */
  const [modalOpen, setModalOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const check = () => setModalOpen(Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')));
    check();
    const timer = window.setInterval(check, 400);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (force) {
      setStep(0);
      setOpen(true);
      return;
    }
    // A beat before it appears, so the editor has painted and the tour is
    // pointing at something that exists.
    if (!tourCompleted) {
      const timer = window.setTimeout(() => setOpen(true), 900);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [force, tourCompleted]);

  useEffect(() => {
    if (!open) return;
    const panel = STEPS[step]?.panel;
    if (panel) setWorkPanel(panel);
  }, [open, step, setWorkPanel]);

  const finish = () => {
    setOpen(false);
    setPreference('tourCompleted', true);
    onFinish?.();
  };

  if (!open || modalOpen) return null;

  const current = STEPS[step]!;
  const last = step === STEPS.length - 1;

  return (
    /*
     * Hugging the bottom edge, centred.
     *
     * Three positions were wrong before this one, and each was wrong for the
     * same reason: the tour is an opaque, click-absorbing rectangle, so
     * wherever it sits is a part of the plan the user cannot draw on while it
     * is open. Mid-screen it covered the thing each step described.
     * Bottom-left it swallowed the view controls. Floated above the templates
     * strip it sat squarely in the middle of the floor, and two clicks meant
     * for the ground landed on it instead.
     *
     * Pinned to the bottom it takes only the strip of plan nearest the camera,
     * which is the part least likely to be drawn on and the easiest to orbit
     * away from — and it is one dismiss from gone.
     */
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-14">
      <div
        role="dialog"
        aria-label="Getting started"
        className="panel pointer-events-auto w-full max-w-sm overflow-hidden"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-primary">
              Step {step + 1} of {STEPS.length}
            </p>
            <h2 className="mt-0.5 text-sm font-bold text-ink">{current.title}</h2>
          </div>
          <button type="button" onClick={finish} className="icon-btn h-7 w-7 shrink-0" aria-label="Skip the tour">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="px-4 py-3 text-sm leading-relaxed text-ink-muted">{current.body}</p>

        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <div className="flex flex-1 gap-1" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full transition ${i <= step ? 'bg-primary' : 'bg-surface-muted'}`}
              />
            ))}
          </div>
          {step > 0 ? (
            <button type="button" className="btn-ghost btn-sm" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          ) : null}
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => (last ? finish() : setStep((s) => s + 1))}
          >
            {last ? (
              <>
                <Check className="h-3.5 w-3.5" /> Start building
              </>
            ) : (
              <>
                Next <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Re-run the tour from a menu. */
export function useTour() {
  const [running, setRunning] = useState(false);
  return {
    running,
    start: () => setRunning(true),
    node: running ? <GuidedTour force onFinish={() => setRunning(false)} /> : null,
  };
}
