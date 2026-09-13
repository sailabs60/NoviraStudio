/**
 * AI Conceptualization — the wizard.
 *
 * "Describe your event vision and let AI turn it into a complete concept."
 *
 * The layout follows the reference: your words in a tinted box beside a small
 * avatar, the AI's reading underneath as a ticked list of what it understood,
 * and a closing note about what can be done with the concept now it exists.
 *
 * The one thing this does that a chat product does not is **finish the job in
 * the room**. A concept that reads well and leaves the plan empty is the
 * failure the old studio had; the button at the bottom builds it.
 */
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  Loader2,
  Mic,
  MicOff,
  Sparkles,
  User,
  Wand2,
} from 'lucide-react';
import { createRoom, generateConcept, parseBrief, type ConceptResult, type SceneObject } from '@novira/shared';
import { useEditor } from '../../editorStore';
import { useDictation } from '../../useDictation';
import { assembleScene, type Catalogue } from '../../assembleScene';
import { autoResolve, validateAssembly } from '../../validateAssembly';
import { useAiCatalogue, useVenue } from './useAiShared';
import { spatial } from '../../../lib/spatialApi';
import { toast } from '../../../components/ui';

const EXAMPLES = [
  'Create a modern corporate event setup for 500 guests with a stage, dining area, brand displays and elegant lighting. Use a blue and white theme.',
  'A wedding reception for 150 with round tables, a dance floor, chandeliers and floral decor',
  'An awards evening for 400 with a long LED screen, cabaret seating, gold and black branding',
];

export function AiConceptTab() {
  const scene = useEditor((s) => s.scene);
  const replaceScene = useEditor((s) => s.replaceScene);
  const requestFrameAll = useEditor((s) => s.requestFrameAll);
  const readOnly = useEditor((s) => s.readOnly);
  const planId = useEditor((s) => s.planId);

  const [prompt, setPrompt] = useState('');
  const [concept, setConcept] = useState<ConceptResult | null>(null);
  const [interpreter, setInterpreter] = useState<'model' | 'parser'>('parser');
  const [reading, setReading] = useState(false);
  const [building, setBuilding] = useState(false);

  const venue = useVenue();
  const catalogueItems = useAiCatalogue();
  const catalogue: Catalogue = useMemo(() => ({ items: catalogueItems ?? [] }), [catalogueItems]);

  const dictation = useDictation((phrase) => {
    setPrompt((prev) => {
      const next = `${prev}${prev && !/\s$/.test(prev) ? ' ' : ''}${phrase}`;
      read(next);
      return next;
    });
  });

  /** Parse locally as the user types. Instant, free, and usually right. */
  const read = (text: string) => {
    if (!text.trim()) {
      setConcept(null);
      return;
    }
    const base = venue
      ? {
          roomWidthMm: venue.widthMm,
          roomDepthMm: venue.depthMm,
          ...(venue.heightMm ? { roomHeightMm: venue.heightMm } : {}),
        }
      : {};
    setConcept(generateConcept(parseBrief(text, base)));
    setInterpreter('parser');
  };

  const readWithModel = async () => {
    if (!prompt.trim()) return;
    setReading(true);
    try {
      const result = await spatial.ai.conceptPreview(
        prompt,
        venue
          ? {
              roomWidthMm: venue.widthMm,
              roomDepthMm: venue.depthMm,
              ...(venue.heightMm ? { roomHeightMm: venue.heightMm } : {}),
            }
          : {}
      );
      setConcept(result as unknown as ConceptResult);
      setInterpreter('model');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Could not read that with the model.');
    } finally {
      setReading(false);
    }
  };

  /**
   * The elements the concept holds, counted by kind and named in plain words.
   *
   * `round-table` is what the engine calls it and `round tables` is what a
   * person calls it, and the panel is read by a person.
   */
  const plannedCounts = useMemo(() => {
    if (!concept) return [];
    const counts = new Map<string, number>();
    for (const element of concept.elements) {
      const label = element.kind.replace(/-/g, ' ');
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => [count === 1 ? kind : `${kind}s`, count] as const);
  }, [concept]);

  const build = () => {
    if (!concept || readOnly) return;
    setBuilding(true);
    try {
      const next = structuredClone(scene);
      next.objects = next.objects.filter((o) => o.type === 'constraint');
      next.tableGroups = [];

      if (!venue) {
        const room = createRoom(concept.roomWidthMm, concept.roomDepthMm, 200, concept.roomHeightMm);
        next.walls = { segments: room.segments, floors: [{ ...room.floor, color: '#3f3f46' }] };
      }

      const assembly = assembleScene(concept, catalogue);
      const walkway = concept.elements.find((e) => e.kind === 'walkway');
      const validation = validateAssembly(assembly.objects as SceneObject[], {
        wallSegments: next.walls.segments,
        roomHeightMm: concept.roomHeightMm,
        keepClear: walkway
          ? [
              {
                label: 'Central walkway',
                xMm: walkway.xMm,
                zMm: walkway.zMm,
                widthMm: walkway.widthMm,
                depthMm: walkway.depthMm,
              },
            ]
          : [],
      });
      const resolved = autoResolve(assembly.objects as SceneObject[], validation);

      next.objects.push(...resolved.kept);
      next.render = { ...next.render, look: concept.look };

      const rationale: Record<string, string> = {};
      for (const element of concept.elements) {
        if (!rationale[element.kind]) rationale[element.kind] = element.rationale;
      }
      next.designBrief = {
        prompt: prompt.trim(),
        interpreter,
        summary: concept.summary,
        warnings: concept.warnings,
        rationale,
        roomWidthMm: concept.roomWidthMm,
        roomDepthMm: concept.roomDepthMm,
        roomHeightMm: concept.roomHeightMm,
        eventKind: concept.brief.eventKind,
        attendance: concept.brief.attendance,
        seating: concept.brief.seating,
        paletteHex: concept.brief.paletteHex,
        at: Date.now(),
      };

      const hero = concept.cameras.find((c) => c.name === 'Hero three-quarter') ?? concept.cameras[0];
      if (hero) {
        next.camera = { ...next.camera, positionMm: hero.positionMm, targetMm: hero.targetMm, fov: hero.fov };
      }

      replaceScene(next);
      requestFrameAll();

      if (planId) {
        void spatial.versions
          .create(planId, {
            label: prompt.trim().split(/[.,;]/)[0]?.slice(0, 52) || 'AI build',
            note: `${resolved.kept.length} objects`,
            reason: 'milestone',
            scene: next,
          })
          .catch(() => {});
      }

      toast('success', `${resolved.kept.length} objects placed. Every one is editable.`, {
        label: 'Undo',
        onClick: () => useEditor.getState().undo(),
      });
      for (const substitution of assembly.substitutions) toast('info', substitution);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="ai-card">
        <div className="ai-card-head">
          <span className="ai-card-icon">
            <Wand2 className="h-4 w-4" />
          </span>
          <h3 className="ai-card-title">AI Conceptualization</h3>
        </div>
        <p className="ai-card-note">
          Describe your event vision and let AI turn it into a complete concept.
        </p>

        {/* Your words, beside a small avatar — as in the reference. */}
        <div className="mt-3 flex gap-2">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted">
            <User className="h-3.5 w-3.5 text-ink-subtle" />
          </span>
          <div className="relative min-w-0 flex-1">
            <textarea
              value={prompt + (dictation.interim ? ` ${dictation.interim}` : '')}
              onChange={(e) => {
                setPrompt(e.target.value);
                read(e.target.value);
              }}
              rows={5}
              placeholder="Create a modern corporate event setup for 500 guests with a stage, dining area, brand displays and elegant lighting. Use a blue and white theme."
              className="ai-prompt min-h-[112px] pr-9"
            />
            {dictation.supported ? (
              <button
                type="button"
                onClick={dictation.toggle}
                aria-label={dictation.listening ? 'Stop dictating' : 'Dictate the brief'}
                className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg transition ${
                  dictation.listening ? 'bg-primary text-primary-fg' : 'text-ink-subtle hover:bg-surface-muted'
                }`}
              >
                {dictation.listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              </button>
            ) : null}
          </div>
        </div>

        {dictation.listening ? (
          <p className="mt-1.5 flex items-center gap-1.5 pl-9 text-[10px] text-primary">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            Listening…
          </p>
        ) : null}

        {/*
          The examples, readable.

          They were pills truncated to 26 characters, which turned three
          genuinely useful starting briefs into "Create a modern corporate …",
          "A wedding reception for 15…" and "An awards evening for 400 …" — three
          near-identical grey stubs that say nothing about what each one would
          produce. The point of an example brief is that reading it teaches you
          how to write one, and a truncated one teaches nothing.

          Only shown while the box is empty. Once there is a brief in it they
          are noise, and the space belongs to what the engine made of it.
        */}
        {!prompt.trim() ? (
          <div className="mt-2.5 space-y-1 pl-9">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-subtle">
              Or start from one of these
            </p>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="block w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left text-[11px] leading-snug text-ink-muted transition hover:border-primary/50 hover:bg-primary/[0.04] hover:text-ink"
                onClick={() => {
                  setPrompt(example);
                  read(example);
                }}
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}

        {/*
          Reading happens as you type, free and instantly. This is only for
          wording the parser cannot follow, so it sits quietly beside a line
          saying as much rather than looking like the button that does the work.
        */}
        <div className="mt-2.5 flex items-center gap-2 pl-9">
          <p className="min-w-0 flex-1 text-[10px] leading-snug text-ink-subtle">
            Read as you type, free. Use the model only for looser wording.
          </p>
          <button
            type="button"
            className="ai-btn shrink-0 px-2.5 py-1.5 text-[11px]"
            onClick={readWithModel}
            disabled={reading || !prompt.trim()}
          >
            {reading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Read with AI
          </button>
        </div>
      </div>

      {/*
        What room this is being planned for.

        It was a loose sentence floating between two cards. It is the single
        most consequential input to everything below — a brief for 500 guests
        produces a completely different plan in a 40 m hall and in a 12 m one —
        so it reads as a stated fact with the figures pulled out, not as a
        footnote.
      */}
      {venue ? (
        <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.05] px-3 py-2">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-ink">
            <span className="font-semibold">Planning for the room already here</span>
            <span className="block tabular-nums text-ink-muted">
              {(venue.widthMm / 1000).toFixed(1)} × {(venue.depthMm / 1000).toFixed(1)} m
              {venue.heightMm ? ` · ${(venue.heightMm / 1000).toFixed(1)} m to the ceiling` : ''}
            </span>
          </p>
        </div>
      ) : null}

      {concept ? (
        <>
          <div className="ai-card">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
              </span>
              <h3 className="text-[13px] font-bold text-ink">AI Generated Concept</h3>
            </div>

            <p className="ai-card-note">
              A {(concept.roomWidthMm / 1000).toFixed(1)} × {(concept.roomDepthMm / 1000).toFixed(1)} m room for{' '}
              {concept.brief.attendance} guests,{' '}
              {interpreter === 'model' ? 'read by a language model' : 'read by the built-in parser'} and then
              calculated, not generated.
            </p>

            <ul className="mt-3 space-y-1.5">
              {concept.summary.slice(0, 8).map((line) => (
                <li key={line} className="flex gap-2 text-[12px] leading-snug text-ink">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            {concept.warnings.length ? (
              <div className="notice-warning mt-3 space-y-1 text-[11px] leading-snug">
                {concept.warnings.map((warning) => (
                  <p key={warning} className="flex gap-1.5">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{warning}</span>
                  </p>
                ))}
              </div>
            ) : null}

            {/*
              What is actually going to arrive, counted by kind.

              "27 elements planned" is a number nobody can check. A designer
              reading a proposal needs to know it is 24 round tables and a
              stage and two screens — that is the line that catches "it has not
              understood that this is a dinner" *before* the plan is rewritten,
              which is the only moment the catch is cheap.
            */}
            <div className="mt-3 rounded-xl border border-line bg-surface-muted/50 p-2.5">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-subtle">
                What it will place
              </p>
              <div className="flex flex-wrap gap-1">
                {plannedCounts.map(([kind, count]) => (
                  <span
                    key={kind}
                    className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink"
                  >
                    <span className="tabular-nums text-primary">{count}</span>
                    <span className="font-medium text-ink-muted">{kind}</span>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-ink-subtle">
                Every one arrives as its own object — move it, resize it, delete it. Nothing is locked, and
                one undo removes the lot.
              </p>
            </div>

            <button
              type="button"
              className="ai-btn-primary mt-3 w-full"
              onClick={build}
              disabled={readOnly || building}
            >
              {building ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Build it in the room
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="ai-card">
            <h3 className="text-[13px] font-bold text-ink">Understood</h3>
            <div className="mt-2 flex flex-wrap gap-1">
              {concept.brief.understood.map((word) => (
                <span key={word} className="ai-pill border border-line capitalize">
                  {word}
                </span>
              ))}
            </div>
            {concept.brief.ignored.length ? (
              <p className="ai-card-note">
                Not used: {concept.brief.ignored.slice(0, 8).join(', ')}. Run it through the model if any of
                those mattered.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
