/**
 * The Event Studio.
 *
 * One surface that carries an event from a sentence to a built room, in the
 * order the work actually happens:
 *
 *   Concept  →  Plan  →  Assets  →  Build
 *
 * The stages are not decoration. Each one is a place to *stop and disagree*,
 * which is the difference between a tool and a slot machine. You read what the
 * AI understood before it lays anything out; you read the layout, with the
 * reasoning for every decision, before anything is placed; you see which
 * catalogue models will be used, and what will be substituted, before they go
 * in. Only then does it build. A generator that goes straight from a prompt to
 * 571 objects gives you nothing to correct and no reason to trust the result.
 *
 * ## Why it is a panel over the viewport
 *
 * The plan stays visible behind it the whole way through. That is deliberate:
 * every judgement being asked for — is that stage too big, does that walkway
 * work, is this the right room — is a judgement about the space, and hiding the
 * space to ask about it is how the old full-page studio ended up producing
 * things nobody could use. The panel is wide enough to read a plan in and
 * dismissible at any point without losing the work.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Loader2,
  Package,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import {
  createRoom,
  generateConcept,
  parseBrief,
  type ConceptResult,
  type SceneObject,
} from '@novira/shared';
import { useEditor } from './editorStore';
import { assembleScene, pickItem, type Catalogue } from './assembleScene';
import { api } from '../lib/api';
import { spatial } from '../lib/spatialApi';
import { toast } from '../components/ui';

type Stage = 'concept' | 'plan' | 'assets' | 'build';

const STAGES: Array<{ id: Stage; label: string; note: string }> = [
  { id: 'concept', label: 'Concept', note: 'What you want' },
  { id: 'plan', label: 'Plan', note: 'Where it goes' },
  { id: 'assets', label: 'Assets', note: 'What it is made of' },
  { id: 'build', label: 'Build', note: 'In the room' },
];

const EXAMPLES = [
  'A modern corporate technology conference for 500 guests with a large stage and LED screen, branded booths around the perimeter, round dining tables, a central walkway, blue and white branding, chandeliers and professional event lighting',
  'A wedding reception for 150 with round tables, a dance floor, chandeliers and floral decor',
  'An awards evening for 400 with a long LED screen, cabaret seating, gold and black branding',
  'A product launch for 200 press with dramatic lighting, a reveal position and a lounge area',
];

export function EventStudio({ onClose }: { onClose: () => void }) {
  const scene = useEditor((s) => s.scene);
  const replaceScene = useEditor((s) => s.replaceScene);
  const requestFrameAll = useEditor((s) => s.requestFrameAll);
  const readOnly = useEditor((s) => s.readOnly);

  const [stage, setStage] = useState<Stage>('concept');
  const [prompt, setPrompt] = useState('');
  const [concept, setConcept] = useState<ConceptResult | null>(null);
  const [reading, setReading] = useState(false);
  const [interpreter, setInterpreter] = useState<'model' | 'parser'>('parser');
  const [buildWalls, setBuildWalls] = useState(true);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [building, setBuilding] = useState(false);

  /*
   * The catalogue the room is furnished from, loaded once.
   *
   * A 500-guest banquet asks for a round table and a chair 528 times between
   * them; a query per placement would take longer than everything else in the
   * build put together.
   */
  const { data: catalogueItems } = useQuery({
    queryKey: ['studio-catalogue'],
    queryFn: async () => {
      const categories = ['tables', 'chairs', 'decor', 'signage', 'plants', 'lounge', 'bars-catering'];
      const pages = await Promise.all(
        categories.map((category) =>
          api.catalog.items({ category, limit: 100 } as never).catch(() => ({ items: [] }))
        )
      );
      return pages.flatMap((page) => page.items ?? []);
    },
    staleTime: 300_000,
  });

  const catalogue: Catalogue = useMemo(() => ({ items: catalogueItems ?? [] }), [catalogueItems]);

  /** The free path: parse locally. Instant, no credits, and usually right. */
  const readLocally = (text: string) => {
    if (!text.trim()) {
      setConcept(null);
      return;
    }
    setConcept(generateConcept(parseBrief(text)));
    setInterpreter('parser');
  };

  /** The model path, for looser wording than the parser handles. */
  const readWithModel = async () => {
    if (!prompt.trim()) return;
    setReading(true);
    try {
      /*
       * The preview endpoint, not the job one.
       *
       * `concept` queues a credited job and returns a job handle; this stage
       * only needs the reading, which comes back synchronously and free. The
       * credits are spent when something is generated, not when a sentence is
       * parsed.
       */
      const result = await spatial.ai.conceptPreview(prompt);
      setConcept(result as unknown as ConceptResult);
      setInterpreter('model');
      setStage('plan');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Could not read that with the model.');
      // The parser still works, so the stage is not a dead end.
      readLocally(prompt);
      setStage('plan');
    } finally {
      setReading(false);
    }
  };

  /* ── What assembly will use, worked out before it runs ──────────────── */

  const assetPlan = useMemo(() => {
    if (!concept) return null;
    const wants: Array<{ label: string; count: number; want: Parameters<typeof pickItem>[1] }> = [];

    const count = (kind: string) => concept.elements.filter((e) => e.kind === kind).length;

    const dining = count('dining');
    if (dining) {
      const seats = (concept.elements.find((e) => e.kind === 'dining')?.params as { seats?: number })?.seats ?? 10;
      wants.push({
        label: 'Round tables',
        count: dining,
        want: { category: 'tables', keywords: ['round'], shape: 'round', seats, widthMm: 1800 },
      });
      wants.push({
        label: 'Chairs',
        count: dining * seats,
        want: { category: 'chairs', keywords: ['dining', 'banquet', 'chair'], heightMm: 950 },
      });
    }
    if (count('chandelier')) {
      wants.push({
        label: 'Chandeliers',
        count: count('chandelier'),
        want: { category: 'decor', keywords: ['chandelier', 'pendant', 'hanging'], widthMm: 1200 },
      });
    }
    if (count('banner')) {
      wants.push({
        label: 'Banners',
        count: count('banner'),
        want: { category: 'signage', keywords: ['banner', 'sign', 'panel'], widthMm: 2400, heightMm: 3000 },
      });
    }
    if (count('plant')) {
      wants.push({
        label: 'Planting',
        count: count('plant'),
        want: { category: 'plants', keywords: ['planter', 'plant', 'tree', 'palm'], heightMm: 1800 },
      });
    }
    if (count('lounge')) {
      wants.push({
        label: 'Lounge seating',
        count: count('lounge'),
        want: { category: 'lounge', keywords: ['sofa', 'settee', 'armchair'], widthMm: 3000 },
      });
    }

    return wants.map((entry) => ({
      ...entry,
      match: pickItem(catalogue, entry.want),
    }));
  }, [concept, catalogue]);

  /** Structures the engine builds itself, so they never need a catalogue item. */
  const procedural = useMemo(() => {
    if (!concept) return [];
    const out: Array<{ label: string; count: number }> = [];
    const add = (kind: string, label: string) => {
      const n = concept.elements.filter((e) => e.kind === kind).length;
      if (n) out.push({ label, count: n });
    };
    add('stage', 'Stage decking');
    add('screen', 'LED screen');
    add('truss', 'Truss');
    add('booth-grid', 'Exhibition stands');
    add('spotlight', 'Moving heads');
    add('dance-floor', 'Dance floor');
    add('walkway', 'Walkway');
    add('carpet', 'Carpet');
    return out;
  }, [concept]);

  /* ── Build ─────────────────────────────────────────────────────────── */

  const build = () => {
    if (!concept || readOnly) return;
    setBuilding(true);
    try {
      const next = structuredClone(scene);

      if (replaceExisting) {
        // Constraints describe the building, not the design, so they survive.
        next.objects = next.objects.filter((o) => o.type === 'constraint');
        next.tableGroups = [];
      }

      if (buildWalls) {
        const room = createRoom(concept.roomWidthMm, concept.roomDepthMm, 200, concept.roomHeightMm);
        next.walls = { segments: room.segments, floors: [{ ...room.floor, color: '#3f3f46' }] };
      }

      const assembly = assembleScene(concept, catalogue);
      next.objects.push(...(assembly.objects as SceneObject[]));
      next.render = { ...next.render, look: concept.look };

      const hero = concept.cameras.find((c) => c.name === 'Hero three-quarter') ?? concept.cameras[0];
      if (hero) {
        next.camera = { ...next.camera, positionMm: hero.positionMm, targetMm: hero.targetMm, fov: hero.fov };
      }

      replaceScene(next);
      requestFrameAll();

      toast(
        'success',
        `${assembly.objects.length} objects placed. Every one is selectable and editable — nothing is merged or locked.`,
        { label: 'Undo', onClick: () => useEditor.getState().undo() }
      );
      for (const substitution of assembly.substitutions) toast('info', substitution);
      onClose();
    } finally {
      setBuilding(false);
    }
  };

  /* ── Chrome ────────────────────────────────────────────────────────── */

  const stageIndex = STAGES.findIndex((s) => s.id === stage);
  const canLeaveConcept = !!concept;

  return (
    <div className="pointer-events-none fixed inset-y-0 right-0 z-[70] flex w-full max-w-[520px] flex-col p-3">
      <div className="panel pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden shadow-2xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">Event Studio</h2>
          <button type="button" className="icon-btn-bare h-7 w-7" onClick={onClose} aria-label="Close the studio">
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        {/* The trail. Shows where you are and what is still ahead. */}
        <nav className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-2">
          {STAGES.map((entry, index) => {
            const done = index < stageIndex;
            const current = entry.id === stage;
            const reachable = index === 0 || canLeaveConcept;
            return (
              <button
                key={entry.id}
                type="button"
                disabled={!reachable}
                onClick={() => reachable && setStage(entry.id)}
                className={`flex min-w-0 flex-1 flex-col items-start rounded px-2 py-1 text-left transition ${
                  current ? 'bg-primary/10' : reachable ? 'hover:bg-surface-hover' : 'opacity-40'
                }`}
              >
                <span className="flex items-center gap-1">
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                      done
                        ? 'bg-primary text-white'
                        : current
                          ? 'bg-primary text-white'
                          : 'bg-surface-sunken text-ink-muted'
                    }`}
                  >
                    {done ? <Check className="h-2.5 w-2.5" /> : index + 1}
                  </span>
                  <span className={`truncate text-[11px] font-semibold ${current ? 'text-primary' : 'text-ink'}`}>
                    {entry.label}
                  </span>
                </span>
                <span className="truncate text-[9px] text-ink-muted">{entry.note}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {stage === 'concept' ? (
            <ConceptStage
              prompt={prompt}
              setPrompt={(text) => {
                setPrompt(text);
                readLocally(text);
              }}
              concept={concept}
              reading={reading}
              onReadWithModel={readWithModel}
              onNext={() => setStage('plan')}
            />
          ) : null}

          {stage === 'plan' && concept ? (
            <PlanStage concept={concept} interpreter={interpreter} onNext={() => setStage('assets')} />
          ) : null}

          {stage === 'assets' && concept ? (
            <AssetStage
              assets={assetPlan ?? []}
              procedural={procedural}
              loading={!catalogueItems}
              onNext={() => setStage('build')}
            />
          ) : null}

          {stage === 'build' && concept ? (
            <BuildStage
              concept={concept}
              buildWalls={buildWalls}
              setBuildWalls={setBuildWalls}
              replaceExisting={replaceExisting}
              setReplaceExisting={setReplaceExisting}
              building={building}
              readOnly={readOnly}
              onBuild={build}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Stage 1: the concept ──────────────────────────────────────────────── */

function ConceptStage({
  prompt,
  setPrompt,
  concept,
  reading,
  onReadWithModel,
  onNext,
}: {
  prompt: string;
  setPrompt: (text: string) => void;
  concept: ConceptResult | null;
  reading: boolean;
  onReadWithModel: () => void;
  onNext: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[12px] font-bold text-ink">Describe the event</h3>
        <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
          Say it the way you would to a colleague. Everything you mention is used; everything you leave out is
          worked out from what you did say.
        </p>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={5}
        placeholder="A modern corporate conference for 500 guests with a large stage, an LED screen, round dining tables, a central walkway, blue and white branding and chandeliers…"
        className="ed-input w-full resize-y text-[12px] leading-relaxed"
      />

      <div className="flex flex-wrap gap-1">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="ed-chip max-w-full truncate text-[10px]"
            onClick={() => setPrompt(example)}
            title={example}
          >
            {example.slice(0, 46)}…
          </button>
        ))}
      </div>

      {concept ? (
        <>
          <div className="rounded border border-line bg-surface-sunken p-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">Understood</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {concept.brief.understood.map((word) => (
                <span key={word} className="ed-chip text-[10px] capitalize">
                  <Check className="h-2.5 w-2.5 text-primary" />
                  {word}
                </span>
              ))}
            </div>
            {concept.brief.ignored.length ? (
              <p className="mt-2 text-[10px] leading-snug text-ink-muted">
                Not used: {concept.brief.ignored.slice(0, 8).join(', ')}. Run it through the model if any of those
                mattered.
              </p>
            ) : null}
          </div>

          <div className="flex gap-2">
            <button type="button" className="ed-action flex-1 justify-center" onClick={onReadWithModel} disabled={reading}>
              {reading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              Read it with AI
            </button>
            <button type="button" className="ed-action-primary flex-1 justify-center" onClick={onNext}>
              See the plan
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-[10px] leading-snug text-ink-muted">
            The plan below is free and updates as you type. The model only helps with looser wording — every
            dimension is calculated either way.
          </p>
        </>
      ) : null}
    </div>
  );
}

/* ── Stage 2: the plan ─────────────────────────────────────────────────── */

function PlanStage({
  concept,
  interpreter,
  onNext,
}: {
  concept: ConceptResult;
  interpreter: 'model' | 'parser';
  onNext: () => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, { count: number; rationale: string }>();
    for (const element of concept.elements) {
      const existing = map.get(element.kind);
      if (existing) existing.count += 1;
      else map.set(element.kind, { count: 1, rationale: element.rationale });
    }
    return [...map.entries()];
  }, [concept]);

  return (
    <div className="space-y-3">
      <div className="rounded border border-line bg-surface-sunken p-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">The room</p>
        <p className="mt-1 text-[13px] font-bold text-ink">
          {(concept.roomWidthMm / 1000).toFixed(1)} × {(concept.roomDepthMm / 1000).toFixed(1)} m,{' '}
          {(concept.roomHeightMm / 1000).toFixed(1)} m to the ceiling
        </p>
        <p className="mt-0.5 text-[10px] text-ink-muted">
          {interpreter === 'model' ? 'A model read your description; ' : 'Read by the built-in parser; '}
          every dimension was then calculated, not generated.
        </p>
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">What goes in it</p>
        <ul className="mt-1.5 space-y-1.5">
          {grouped.map(([kind, entry]) => (
            <li key={kind} className="rounded border border-line px-2.5 py-1.5">
              <p className="text-[11px] font-semibold capitalize text-ink">
                {entry.count > 1 ? `${entry.count} × ` : ''}
                {kind.replace(/-/g, ' ')}
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-ink-muted">{entry.rationale}</p>
            </li>
          ))}
        </ul>
      </div>

      {concept.summary.length ? (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">In words</p>
          <ul className="mt-1 space-y-0.5">
            {concept.summary.map((line) => (
              <li key={line} className="text-[11px] leading-snug text-ink-muted">
                • {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {concept.warnings.length ? (
        <div className="notice-warning space-y-1 text-[11px] leading-snug">
          {concept.warnings.map((warning) => (
            <p key={warning} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{warning}</span>
            </p>
          ))}
        </div>
      ) : null}

      <button type="button" className="ed-action-primary w-full justify-center" onClick={onNext}>
        Choose the assets
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ── Stage 3: the assets ───────────────────────────────────────────────── */

function AssetStage({
  assets,
  procedural,
  loading,
  onNext,
}: {
  assets: Array<{ label: string; count: number; match: ReturnType<typeof pickItem> }>;
  procedural: Array<{ label: string; count: number }>;
  loading: boolean;
  onNext: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[12px] font-bold text-ink">What it will be made of</h3>
        <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
          Furniture comes from your catalogue, at its measured size. Structures are built to the plan's dimensions.
        </p>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-[11px] text-ink-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading your catalogue…
        </p>
      ) : null}

      {assets.length ? (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">From the catalogue</p>
          <ul className="mt-1.5 space-y-1.5">
            {assets.map((entry) => (
              <li key={entry.label} className="flex items-center gap-2 rounded border border-line px-2.5 py-1.5">
                {entry.match?.previewImage ? (
                  <img
                    src={entry.match.previewImage}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-surface-sunken">
                    <Package className="h-4 w-4 text-ink-muted" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-semibold text-ink">
                    {entry.count} × {entry.label}
                  </span>
                  <span className="block truncate text-[10px] text-ink-muted">
                    {entry.match
                      ? `${entry.match.name} — ${entry.match.widthMm ?? '?'} × ${entry.match.depthMm ?? '?'} × ${entry.match.heightMm ?? '?'} mm`
                      : 'Nothing suitable in your catalogue — placed at the planned size instead.'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {procedural.length ? (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">Built to the plan</p>
          <ul className="mt-1.5 grid grid-cols-2 gap-1.5">
            {procedural.map((entry) => (
              <li key={entry.label} className="rounded border border-line px-2.5 py-1.5">
                <span className="block text-[11px] font-semibold text-ink">
                  {entry.count > 1 ? `${entry.count} × ` : ''}
                  {entry.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <button type="button" className="ed-action-primary w-full justify-center" onClick={onNext}>
        Ready to build
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ── Stage 4: build it ─────────────────────────────────────────────────── */

function BuildStage({
  concept,
  buildWalls,
  setBuildWalls,
  replaceExisting,
  setReplaceExisting,
  building,
  readOnly,
  onBuild,
}: {
  concept: ConceptResult;
  buildWalls: boolean;
  setBuildWalls: (value: boolean) => void;
  replaceExisting: boolean;
  setReplaceExisting: (value: boolean) => void;
  building: boolean;
  readOnly: boolean;
  onBuild: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-[12px] font-bold text-ink">Build it</h3>
        <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
          Everything placed is an ordinary object. Move it, resize it, delete it, replace its material — nothing is
          locked, nothing is merged, and undo puts the plan back exactly as it was.
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-2 rounded border border-line px-2.5 py-2">
        <input
          type="checkbox"
          checked={replaceExisting}
          onChange={(e) => setReplaceExisting(e.target.checked)}
          className="mt-0.5"
        />
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold text-ink">Replace what is here</span>
          <span className="block text-[10px] leading-snug text-ink-muted">
            Site constraints are always kept — they describe the building, not the design.
          </span>
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-2 rounded border border-line px-2.5 py-2">
        <input type="checkbox" checked={buildWalls} onChange={(e) => setBuildWalls(e.target.checked)} className="mt-0.5" />
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold text-ink">Build the room</span>
          <span className="block text-[10px] leading-snug text-ink-muted">
            Draws walls and a floor at {(concept.roomWidthMm / 1000).toFixed(1)} ×{' '}
            {(concept.roomDepthMm / 1000).toFixed(1)} m.
          </span>
        </span>
      </label>

      <button
        type="button"
        className="ed-action-primary w-full justify-center"
        onClick={onBuild}
        disabled={readOnly || building}
      >
        {building ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        Build the event
      </button>
    </div>
  );
}
