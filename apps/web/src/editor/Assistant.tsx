import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Camera,
  ImagePlus,
  Lightbulb,
  Loader2,
  MessageSquare,
  Minus,
  RefreshCw,
  Sparkles,
  Wand,
  Wand2,
  X,
} from 'lucide-react';
import { EVENT_KIND_INFO, createRoom, generateConcept, parseBrief, type ConceptResult } from '@novira/shared';
import { useEditor } from './editorStore';
import { ConceptPanel, objectsFromConcept } from './panels/ConceptPanel';
import { useAssistant, type AssistantTab } from './assistantStore';
import { useSceneAgent, useSmartSuggestion, type AgentMessage } from './useSceneAgent';
import { captureViewport } from './capture';
import { toast } from '../components/ui';

/**
 * The assistant.
 *
 * It floats over the plan rather than occupying a rail slot, because help is
 * not a phase of the work. Someone gets stuck in the middle of laying out a
 * room, and a helper you have to navigate to is a helper you use once.
 *
 * Three tabs, and the difference between them is stated rather than hidden — a
 * designer needs to know which answers are computed and which are generated:
 *
 *  · **Ask** — a language model that can *see the plan*. It answers questions
 *    about what is in the room, and it can select, move, duplicate, finish and
 *    generate. Every change it makes goes through undo.
 *  · **Layout** — the built-in concept engine. Instant, free, deterministic,
 *    and the only one of the three that produces real dimensions, because
 *    arithmetic does that and language models do not.
 *  · **Brief** — the full concept generator, with photo analysis and the paid
 *    model for looser wording.
 *
 * The rule that runs through all of it: **the model reads, the engine builds.**
 * Nothing here invents a dimension.
 */

const ASK_OPENERS = [
  'What is in my plan, and is anything obviously missing?',
  'Space the chairs evenly around the table',
  'Which of these would a fire officer object to?',
  'Generate a reception counter in pale oak',
];

/**
 * What each tab is, in the panel's own words.
 *
 * The distinction between these three is the most important thing the panel has
 * to communicate and the thing its labels communicate least: **Ask** is a
 * language model that can see and change the plan, **Layout** is arithmetic
 * that is instant, free and exact, and **Brief** is the paid generator for
 * wording the parser cannot follow. Whether a number can be trusted to the
 * millimetre depends entirely on which of the three produced it.
 */
const TAB_INFO: Record<AssistantTab, { title: string; blurb: string }> = {
  ask: {
    title: 'Ask about this plan',
    blurb: 'A model that can see every object in your plan and change it. Anything it does goes through undo.',
  },
  layout: {
    title: 'Lay out a room',
    blurb: 'Novira’s own engine. Instant, free, the same answer every time, and the only one that computes real dimensions.',
  },
  brief: {
    title: 'Generate from a brief',
    blurb: 'The full concept generator, with photo analysis — for wording the layout engine cannot read.',
  },
};

const LAYOUT_OPENERS = [
  'A gala dinner for 220 with a stage and a dance floor',
  'A 6 × 3 m exhibition stand with a counter and a screen wall',
  'A conference for 400, theatre style, with a 5 m LED backdrop',
];

export function Assistant() {
  const open = useAssistant((s) => s.open);
  const minimised = useAssistant((s) => s.minimised);
  const tab = useAssistant((s) => s.tab);
  const setMinimised = useAssistant((s) => s.setMinimised);
  const setTab = useAssistant((s) => s.setTab);
  const show = useAssistant((s) => s.show);
  const hide = useAssistant((s) => s.hide);
  const takeSeed = useAssistant((s) => s.takeSeed);

  const agent = useSceneAgent();
  const suggestion = useSmartSuggestion();
  const readOnly = useEditor((s) => s.readOnly);

  const [input, setInput] = useState('');
  const [attached, setAttached] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /*
   * Where the panel has been dragged to, as an offset from its home corner.
   *
   * A floating window over a plan is always covering *something*, and which
   * something depends on the plan — so the answer is not a cleverer default
   * position, it is letting it be moved. The offset is kept rather than an
   * absolute position so the panel stays anchored to the bottom-right as the
   * window resizes, which is the behaviour every floating inspector has.
   *
   * Not persisted: a panel that reopens somewhere unexpected next session is a
   * worse surprise than one that reopens where it has always been.
   */
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragFrom = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const startDrag = useCallback((event: React.PointerEvent) => {
    // Only the header itself, and only with the primary button: the close and
    // minimise buttons are in it and must not start a drag.
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    dragFrom.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
  }, [offset]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const from = dragFrom.current;
      if (!from) return;
      /*
       * Clamped so the panel can never be dragged off the screen. The header
       * is what is held onto, so keeping *it* reachable is what matters — the
       * body may hang past the bottom edge on a short window.
       */
      const nextX = from.ox - (event.clientX - from.x);
      const nextY = from.oy - (event.clientY - from.y);
      setOffset({
        x: Math.min(Math.max(nextX, -16), Math.max(0, window.innerWidth - 420)),
        y: Math.min(Math.max(nextY, -16), Math.max(0, window.innerHeight - 140)),
      });
    };
    const onUp = () => {
      dragFrom.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [agent.messages, agent.thinking]);

  /*
   * A question handed over from elsewhere — the command palette, a panel — is
   * asked as though the user had typed it, so the answer is already there when
   * the assistant appears rather than waiting for a second action.
   */
  useEffect(() => {
    if (!open) return;
    const seed = takeSeed();
    if (seed) void agent.send(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => show()}
        /*
         * Clear of the corner, which belongs to the orbit compass.
         *
         * Both sat at `bottom-4 right-4`, so the one control that says which way
         * the room is facing was permanently underneath a blue button. Moving
         * the bubble left by the compass's own width costs it nothing — it is
         * still the most prominent thing on the plan that is not the plan.
         */
        className="absolute bottom-4 right-[110px] z-20 flex items-center gap-2 rounded-full bg-primary py-2.5 pl-3 pr-4 text-primary-fg shadow-glow transition hover:bg-primary-strong"
        aria-label="Open the design assistant"
      >
        <Sparkles className="h-4 w-4" />
        <span className="text-xs font-semibold">Ask Novira</span>
      </button>
    );
  }

  const submit = () => {
    const text = input.trim();
    if (!text && !attached) return;
    setInput('');
    const image = attached;
    setAttached(null);
    void agent.send(text || 'What do you make of this?', image);
  };

  return (
    <div
      className={`nv-rise absolute z-20 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-modal ${
        minimised ? '' : 'max-h-[min(600px,calc(100vh-9rem))]'
      }`}
      style={{ right: 16 + offset.x, bottom: 16 + offset.y }}
      role="dialog"
      aria-label={TAB_INFO[tab].title}
    >
      {/*
        The header, with the tab's own name in it.

        "Design assistant" alone told you nothing about which of the three
        things you were looking at, and the three are genuinely different tools
        rather than modes of one — so the heading says which. Dragging it is
        also how the panel gets out of the way of the corner of the plan it
        happens to be covering, which is the one complaint a fixed floating
        window always earns.
      */}
      <header
        onPointerDown={startDrag}
        className="flex h-11 shrink-0 cursor-grab items-center gap-2 border-b border-line px-3 active:cursor-grabbing"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">
          {TAB_INFO[tab].title}
        </h2>
        <button
          type="button"
          className="icon-btn-bare h-7 w-7"
          onClick={() => setMinimised(!minimised)}
          aria-label={minimised ? 'Expand the assistant' : 'Minimise the assistant'}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="icon-btn-bare h-7 w-7" onClick={hide} aria-label="Close the assistant">
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {!minimised ? (
        <>
          <div className="shrink-0 border-b border-line px-2 pb-2 pt-1.5">
            <div className="ed-segment w-full">
              <TabButton active={tab === 'ask'} onClick={() => setTab('ask')} icon={<MessageSquare className="h-3 w-3" />}>
                Ask
              </TabButton>
              <TabButton active={tab === 'layout'} onClick={() => setTab('layout')} icon={<Wand2 className="h-3 w-3" />}>
                Layout
              </TabButton>
              <TabButton active={tab === 'brief'} onClick={() => setTab('brief')} icon={<Wand className="h-3 w-3" />}>
                Brief
              </TabButton>
            </div>

            {/*
              What the open tab actually is, in one line.

              Three tabs labelled Ask, Layout and Brief look like three flavours
              of the same box, and they are not: one is a model that can see and
              change the plan, one is arithmetic that produces real dimensions
              for free, one is the paid generator for looser wording. Which is
              which decides whether an answer can be trusted to the millimetre,
              and a designer cannot be expected to infer that from a six-letter
              label. It changes with the tab, so it is never stale.
            */}
            <p className="mt-1.5 px-0.5 text-[10px] leading-snug text-ink-subtle">
              {TAB_INFO[tab].blurb}
            </p>
          </div>

          {tab === 'brief' ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ConceptPanel />
            </div>
          ) : tab === 'layout' ? (
            <LayoutTab />
          ) : (
            <>
              <div ref={scroller} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
                {!agent.messages.length ? (
                  <>
                    <p className="text-xs leading-relaxed text-ink-muted">
                      I can see your plan — every object, its type and where it is. Ask me about it, or tell me to
                      change something. Anything I do goes through undo.
                    </p>
                    <div className="space-y-1">
                      {ASK_OPENERS.map((opener) => (
                        <button
                          key={opener}
                          type="button"
                          onClick={() => void agent.send(opener)}
                          className="w-full rounded-lg border border-line bg-surface-muted px-2.5 py-1.5 text-left text-[11px] leading-snug text-ink-muted transition hover:border-primary/40 hover:bg-primary-soft hover:text-primary"
                        >
                          {opener}
                        </button>
                      ))}
                    </div>

                    <SuggestionDock suggestion={suggestion} onAsk={(text) => void agent.send(text)} />
                  </>
                ) : (
                  agent.messages.map((message) => <Bubble key={message.id} message={message} />)
                )}

                {agent.thinking ? (
                  <p className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
                    <Loader2 className="h-3 w-3 animate-spin" /> Reading the plan…
                  </p>
                ) : null}
              </div>

              <form
                className="shrink-0 border-t border-line p-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                {attached ? (
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-surface-muted p-1.5">
                    <img src={attached} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-ink-muted">
                      Attached to the next message
                    </span>
                    <button
                      type="button"
                      className="icon-btn-bare h-6 w-6"
                      onClick={() => setAttached(null)}
                      aria-label="Remove the attachment"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : null}

                <div className="relative">
                  <input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder={readOnly ? 'Ask about this plan…' : 'Ask, or tell me what to change…'}
                    aria-label="Message the assistant"
                    className="ed-field py-2 pl-2 pr-[72px]"
                  />
                  <span className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                    <button
                      type="button"
                      className="icon-btn-bare h-6 w-6"
                      onClick={() => {
                        const frame = captureViewport();
                        if (frame) {
                          setAttached(frame);
                          toast('info', 'The current view is attached. Ask what I make of it.');
                        } else {
                          toast('error', 'The 3D view is not ready to capture yet.');
                        }
                      }}
                      title="Attach what is on screen"
                      aria-label="Attach the current view"
                    >
                      <Camera className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn-bare h-6 w-6"
                      onClick={() => fileRef.current?.click()}
                      title="Attach an image"
                      aria-label="Attach an image"
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="submit"
                      disabled={(!input.trim() && !attached) || agent.thinking}
                      className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-fg transition hover:bg-primary-strong disabled:opacity-35"
                      aria-label="Send"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onloadend = () => setAttached(String(reader.result));
                    reader.readAsDataURL(file);
                  }}
                />

                <div className="mt-1.5 flex items-center gap-2">
                  <p className="min-w-0 flex-1 text-[9px] leading-snug text-ink-subtle">
                    The assistant reads your plan and proposes changes; Novira computes every dimension itself.
                  </p>
                  {agent.messages.length ? (
                    <button
                      type="button"
                      className="shrink-0 text-[9px] font-semibold text-ink-subtle hover:text-ink"
                      onClick={agent.clear}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </form>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ed-segment-btn flex flex-1 items-center justify-center gap-1 ${active ? 'ed-segment-btn-active' : ''}`}
    >
      {icon}
      {children}
    </button>
  );
}

/* ── One message ───────────────────────────────────────────────────────── */

function Bubble({ message }: { message: AgentMessage }) {
  if (message.role === 'you') {
    return (
      <p className="ml-6 rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-[11px] leading-relaxed text-primary-fg">
        {message.text}
      </p>
    );
  }

  /*
   * An action reads differently from a reply on purpose. "Moved the Dining
   * Chair" is a record of something that happened to the user's plan, and it
   * has to be scannable after the fact — not buried in prose.
   */
  if (message.role === 'action') {
    return (
      <p className="mr-6 flex items-start gap-1.5 rounded-lg border border-primary/25 bg-primary-soft px-2.5 py-1.5 text-[11px] leading-relaxed text-primary">
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
        {message.text}
      </p>
    );
  }

  return (
    <p className="mr-6 rounded-2xl rounded-bl-sm border border-line bg-surface-muted px-3 py-2 text-[11px] leading-relaxed text-ink">
      {message.text}
    </p>
  );
}

/* ── The suggestion dock ───────────────────────────────────────────────── */

/**
 * One unprompted idea, on request.
 *
 * Not on a timer. Advice that interrupts every two minutes is advice people
 * learn to dismiss without reading, and a suggestion is only worth anything if
 * it arrives when somebody has actually paused — which is exactly the moment
 * they open the assistant.
 */
function SuggestionDock({
  suggestion,
  onAsk,
}: {
  suggestion: ReturnType<typeof useSmartSuggestion>;
  onAsk: (text: string) => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-muted p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Lightbulb className="h-3 w-3 text-primary" />
        <span className="flex-1 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Suggestion</span>
        <button
          type="button"
          className="icon-btn-bare h-5 w-5"
          onClick={() => void suggestion.fetch()}
          disabled={suggestion.loading}
          title="Another idea"
          aria-label="Another suggestion"
        >
          <RefreshCw className={`h-3 w-3 ${suggestion.loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {suggestion.loading && !suggestion.suggestion ? (
        <p className="text-[11px] text-ink-subtle">Looking at what you have…</p>
      ) : suggestion.suggestion ? (
        <>
          <p className="text-[11px] leading-relaxed text-ink">{suggestion.suggestion}</p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              className="ed-action flex-1 justify-center border border-line"
              onClick={() => onAsk(`Tell me more about this: ${suggestion.suggestion}`)}
            >
              Discuss
            </button>
            <button
              type="button"
              className="ed-action-primary flex-1 justify-center"
              onClick={() => onAsk(`Do this: ${suggestion.suggestion}`)}
            >
              Do it
            </button>
          </div>
        </>
      ) : suggestion.unavailable ? (
        <p className="text-[11px] leading-relaxed text-ink-subtle">{suggestion.unavailable}</p>
      ) : (
        <button
          type="button"
          className="ed-action w-full justify-center border border-line"
          onClick={() => void suggestion.fetch()}
        >
          What should I do next?
        </button>
      )}
    </div>
  );
}

/* ── The local layout engine ───────────────────────────────────────────── */

/**
 * A brief in, a laid-out room out — with no model involved.
 *
 * Instant, free, and identical every time, because it is arithmetic. This is
 * the tab that produces real dimensions: a stage that is exactly 9.7 m wide
 * because a sightline calculation said so, not because a model guessed.
 */
function LayoutTab() {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ concept: ConceptResult; text: string } | null>(null);
  const [built, setBuilt] = useState(false);

  const units = useEditor((s) => s.units);
  const readOnly = useEditor((s) => s.readOnly);
  const addObjects = useEditor((s) => s.addObjects);
  const commit = useEditor((s) => s.commit);
  const requestFrameAll = useEditor((s) => s.requestFrameAll);

  const run = (text: string) => {
    const brief = text.trim();
    if (!brief) return;
    setBusy(true);
    setBuilt(false);
    // A beat, so the answer reads as worked out rather than canned. The parse
    // itself is synchronous and instant.
    window.setTimeout(() => {
      try {
        const concept = generateConcept(parseBrief(brief));
        setResult({ concept, text: describe(concept, units) });
      } catch {
        setResult(null);
        toast('error', 'I could not read that as a brief. Name the event, the headcount and the room.');
      } finally {
        setBusy(false);
      }
    }, 180);
  };

  /** What the concept holds, counted by kind and named in plain words. */
  const plannedCounts = useMemo(() => {
    if (!result) return [];
    const counts = new Map<string, number>();
    for (const element of result.concept.elements) {
      const label = element.kind.replace(/-/g, ' ');
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => [count === 1 ? kind : `${kind}s`, count] as const);
  }, [result]);

  const build = () => {
    if (!result || readOnly) return;
    const { concept } = result;

    // The room first, so everything else has something to sit inside. Added to
    // the existing walls rather than replacing them: this is a suggestion
    // inside a plan someone is already working on.
    const room = createRoom(concept.roomWidthMm, concept.roomDepthMm, 200, concept.roomHeightMm);
    commit((draft) => {
      draft.walls.segments = [...draft.walls.segments, ...room.segments];
      if (room.floor) draft.walls.floors = [...draft.walls.floors, room.floor];
      draft.render = { ...draft.render, look: concept.look };
    });

    const objects = objectsFromConcept(concept);
    if (objects.length) addObjects(objects);

    setBuilt(true);
    requestFrameAll();
    toast('success', `${objects.length} elements placed. Everything is editable — nothing is locked.`, {
      label: 'Undo',
      onClick: () => useEditor.getState().undo(),
    });
  };

  return (
    <>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        <p className="text-xs leading-relaxed text-ink-muted">
          Describe the event and I will lay the room out — stage, screens, seating and circulation, every dimension
          computed. Free, instant, and the same answer every time.
        </p>

        {!result ? (
          <div className="space-y-1">
            {LAYOUT_OPENERS.map((opener) => (
              <button
                key={opener}
                type="button"
                onClick={() => {
                  setInput(opener);
                  run(opener);
                }}
                className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-left text-[11px] leading-snug text-ink-muted transition hover:border-primary/50 hover:bg-primary/[0.04] hover:text-ink"
              >
                {opener}
              </button>
            ))}
          </div>
        ) : (
          <>
            <p className="rounded-2xl rounded-bl-sm border border-line bg-surface-muted px-3 py-2 text-[11px] leading-relaxed text-ink">
              {result.text}
            </p>

            {/*
              What it is going to put in the room, counted by kind.

              "Build this layout" is a button that rewrites somebody's plan, and
              the sentence above it is prose — easy to read and hard to *check*.
              A count per kind is the line that catches "it has not understood
              this is a dinner" before the plan is rewritten rather than after,
              which is the only moment the catch is cheap.
            */}
            {plannedCounts.length ? (
              <div className="rounded-xl border border-line bg-surface p-2.5">
                <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-ink-subtle">
                  It will place
                </p>
                <div className="flex flex-wrap gap-1">
                  {plannedCounts.map(([kind, count]) => (
                    <span
                      key={kind}
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-ink"
                    >
                      <span className="tabular-nums text-primary">{count}</span>
                      <span className="font-medium text-ink-muted">{kind}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {result.concept.warnings.length ? (
              <ul className="space-y-1">
                {result.concept.warnings.slice(0, 3).map((warning) => (
                  <li key={warning} className="notice-warning text-[10px] leading-snug">
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}

            {/*
              The build button last, under everything there is to check.

              It was directly under the summary and above the warnings, so the
              reasons not to press it appeared after the press. Warnings before
              the action is the ordering every destructive confirmation uses.
            */}
            <button
              type="button"
              onClick={build}
              disabled={readOnly || built}
              className="ed-action-primary w-full justify-center py-2 disabled:opacity-50"
            >
              <Wand2 className="h-3.5 w-3.5" /> {built ? 'Placed in the plan' : 'Build this layout'}
            </button>
            {built ? (
              <p className="text-center text-[10px] text-ink-subtle">
                Everything is editable and nothing is locked. Ctrl+Z removes the lot.
              </p>
            ) : null}
          </>
        )}

        {busy ? (
          <p className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
            <Loader2 className="h-3 w-3 animate-spin" /> Working it out…
          </p>
        ) : null}
      </div>

      <form
        className="shrink-0 border-t border-line p-2"
        onSubmit={(event) => {
          event.preventDefault();
          run(input);
        }}
      >
        <div className="relative">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Describe the event…"
            aria-label="Describe the event"
            className="ed-field py-2 pr-9"
          />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md bg-primary text-primary-fg transition hover:bg-primary-strong disabled:opacity-35"
            aria-label="Lay it out"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-1.5 text-[9px] leading-snug text-ink-subtle">
          Computed by Novira's own layout engine — no model, no credits, and the same result every time.
        </p>
      </form>
    </>
  );
}

/**
 * Say what was worked out, in a sentence a person would say.
 *
 * Not a dump of the parsed object. The point is to let someone check the engine
 * understood them *before* it rearranges their plan, and a list of key–value
 * pairs is much harder to check than a sentence.
 */
function describe(concept: ConceptResult, units: 'metric' | 'imperial'): string {
  const size = (mm: number) => (units === 'metric' ? `${(mm / 1000).toFixed(1)} m` : `${Math.round(mm / 304.8)} ft`);

  const kind = EVENT_KIND_INFO[concept.brief.eventKind]?.label ?? 'Event';
  const parts = [
    `${kind} for ${concept.brief.attendance} in a room ${size(concept.roomWidthMm)} × ${size(concept.roomDepthMm)}.`,
  ];

  const counts = concept.elements.reduce<Record<string, number>>((acc, element) => {
    acc[element.kind] = (acc[element.kind] ?? 0) + 1;
    return acc;
  }, {});
  const listed = Object.entries(counts)
    .map(([kindName, count]) => `${count} ${kindName.replace(/-/g, ' ')}${count === 1 ? '' : 's'}`)
    .join(', ');
  if (listed) parts.push(`I would place ${listed}.`);

  // One line of the engine's own reasoning: all of it would be a wall of text
  // in a chat bubble, none of it would make the answer checkable.
  if (concept.summary.length) parts.push(concept.summary[0]!);

  return parts.join(' ');
}

export type { AssistantTab };
