import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, Check, ImagePlus, Lightbulb, Sparkles, Upload, Wand2, X } from 'lucide-react';
import {
  createRoom,
  EVENT_KINDS,
  EVENT_KIND_INFO,
  generateConcept,
  parseBrief,
  SEATING_STYLES,
  SEATING_STYLE_INFO,
  type ConceptResult,
  type SceneObject,
  type CatalogSceneObject,
} from '@novira/shared';
import { useEditor } from '../editorStore';
import { createBooth, createLedScreen, createTruss, newId } from '../factories';
import { pollJob, spatial, type PhotoAnalysisResult } from '../../lib/spatialApi';
import {
  EmptyState,
  Field,
  NumberField,
  ProgressBar,
  Section,
  Segmented,
  Select,
  Stat,
  Toggle,
  toast,
} from '../../components/ui';

/**
 * The AI layer.
 *
 * Two features, one principle: **the model reads, the engine builds.** A
 * language model is good at turning a sentence into structured intent and bad
 * at producing a stage that is actually 9.7 m wide, so it never produces
 * geometry. The layout comes from arithmetic, which is why the same brief
 * always gives the same room and why the dimensions can be trusted.
 *
 * The consequence is visible in the panel: there is a free, instant preview
 * that uses the built-in parser, and a paid run that uses a model to understand
 * looser wording. Both produce the same *kind* of result, so nobody has to
 * spend a credit to find out whether the feature is useful.
 */
export function ConceptPanel() {
  const [tab, setTab] = useState<'text' | 'photo'>('text');
  return (
    <>
      <Section title="">
        <Segmented
          value={tab}
          columns={2}
          options={[
            { value: 'text', label: 'From a description', hint: 'Describe the event; get a laid-out room.' },
            { value: 'photo', label: 'From a photo', hint: 'Analyse a photograph of a space.' },
          ]}
          onChange={setTab}
        />
      </Section>
      {tab === 'text' ? <ConceptFromText /> : <ConceptFromPhoto />}
    </>
  );
}

/* ── From a description ────────────────────────────────────────────────── */

const EXAMPLES = [
  'Modern banking summit stage with a curved LED wall for 400 delegates',
  'Gala dinner for 300 with round tables, a dance floor and a small stage',
  'Product launch, 150 press, dramatic lighting and a reveal position',
  'Exhibition floor with 48 stands and a registration desk',
  'Awards evening for 500 with a long LED screen and cabaret seating',
];

function ConceptFromText() {
  const planId = useEditor((s) => s.planId);
  const replaceScene = useEditor((s) => s.replaceScene);
  const scene = useEditor((s) => s.scene);
  const requestFrameAll = useEditor((s) => s.requestFrameAll);
  const readOnly = useEditor((s) => s.readOnly);

  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<(ConceptResult & { interpreter: string; interpreterNote: string }) | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [buildWalls, setBuildWalls] = useState(true);

  const { data: capabilities } = useQuery({
    queryKey: ['spatial-capabilities'],
    queryFn: () => spatial.ai.capabilities(),
    staleTime: 120_000,
  });

  const capability = capabilities?.ai_concept;

  /** The free path: parse locally and derive the layout. Instant, no credits. */
  const preview = useMemo(() => {
    if (!prompt.trim()) return null;
    try {
      return generateConcept(parseBrief(prompt));
    } catch {
      return null;
    }
  }, [prompt]);

  const runWithModel = async () => {
    if (!prompt.trim()) return;
    setRunning(true);
    setProgress(5);
    try {
      const started = await spatial.ai.concept(prompt, planId ?? undefined);
      const finished = await pollJob(started.id, (job) => setProgress(job.progress), { intervalMs: 1200 });

      if (finished.status !== 'completed' || !finished.output) {
        toast('error', finished.errorMessage ?? 'Could not read that description.');
        return;
      }
      setResult(finished.output as unknown as ConceptResult & { interpreter: string; interpreterNote: string });
      toast('success', 'Layout generated.');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Could not generate a layout.');
    } finally {
      setRunning(false);
      setProgress(0);
    }
  };

  const active = result ?? (preview ? { ...preview, interpreter: 'parser', interpreterNote: 'Read by the built-in parser — free and instant.' } : null);

  const apply = () => {
    if (!active) return;
    const next = structuredClone(scene);

    if (replaceExisting) {
      // Keep constraints: they describe the building, and a new layout inside
      // the same room should still be checked against it.
      next.objects = next.objects.filter((o) => o.type === 'constraint');
      next.tableGroups = [];
    }

    if (buildWalls) {
      const room = createRoom(active.roomWidthMm, active.roomDepthMm, 200, active.roomHeightMm);
      next.walls = { segments: room.segments, floors: [{ ...room.floor, color: '#3f3f46' }] };
    }

    next.objects.push(...objectsFromConcept(active));
    next.render = { ...next.render, look: active.look };

    // Camera: the hero angle, so the plan opens looking like the thing that was
    // asked for rather than at the origin from ten metres up.
    const hero = active.cameras.find((c) => c.name === 'Hero three-quarter') ?? active.cameras[0];
    if (hero) {
      next.camera = { ...next.camera, positionMm: hero.positionMm, targetMm: hero.targetMm, fov: hero.fov };
    }

    replaceScene(next);
    requestFrameAll();
    toast('success', `${active.elements.length} elements placed. Everything is editable — nothing is locked.`, {
      label: 'Undo',
      onClick: () => useEditor.getState().undo(),
    });
  };

  return (
    <>
      <Section
        title="Describe the event"
        description="Say it the way you would to a colleague. Size, seating, screens, truss, extras — anything you mention is used, and anything you do not is derived."
      >
        <Field label="Brief">
          <textarea
            className="ed-field min-h-20 resize-y"
            value={prompt}
            placeholder="Modern banking summit stage with a curved LED wall for 400 delegates"
            onChange={(e) => setPrompt(e.target.value)}
          />
        </Field>

        <div className="mb-2 flex flex-wrap gap-1">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="chip transition hover:border-primary/50 hover:text-primary"
              onClick={() => setPrompt(example)}
            >
              {example.slice(0, 34)}…
            </button>
          ))}
        </div>

        {capability?.degraded ? (
          <p className="notice-info mb-2 text-[11px] leading-snug">
            No language model is configured on this server, so descriptions are read by the built-in parser. It handles
            event type, size, seating, screens, truss and extras — see what it understood below.
          </p>
        ) : null}

        {running ? (
          <ProgressBar value={progress} label="Reading your description" />
        ) : (
          <button
            type="button"
            className="ed-action-primary w-full justify-center"
            onClick={() => void runWithModel()}
            disabled={!prompt.trim() || (capability ? !capability.allowed : false)}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Read it with AI{capability?.cost ? ` · ${capability.cost} credits` : ''}
          </button>
        )}

        <p className="field-hint">
          The preview below is free and updates as you type. Running it through the model only helps with looser
          wording — the layout itself is calculated either way.
        </p>
      </Section>

      {active ? (
        <>
          <Section title="What it understood" description={active.interpreterNote}>
            <div className="mb-2 grid grid-cols-2 gap-1.5">
              <Stat label="Event" value={EVENT_KIND_INFO[active.brief.eventKind].label} />
              <Stat label="For" value={`${active.brief.attendance} people`} />
              <Stat label="Seating" value={SEATING_STYLE_INFO[active.brief.seating].label} />
              <Stat
                label="Room"
                value={`${(active.roomWidthMm / 1000).toFixed(0)} × ${(active.roomDepthMm / 1000).toFixed(0)} m`}
              />
            </div>

            {active.brief.understood.length ? (
              <div className="mb-2 flex flex-wrap gap-1">
                {active.brief.understood.map((word) => (
                  <span key={word} className="chip chip-active">
                    <Check className="h-2.5 w-2.5" /> {word}
                  </span>
                ))}
              </div>
            ) : null}

            {active.brief.ignored.length ? (
              <p className="field-hint">
                Not recognised: {active.brief.ignored.join(', ')}. Rephrase if any of those mattered.
              </p>
            ) : null}
          </Section>

          <Section title="Adjust before placing" description="Change anything here and the layout is recalculated.">
            <Field label="Event type">
              <Select
                value={active.brief.eventKind}
                onChange={(e) =>
                  setResult({
                    ...generateConcept({ ...active.brief, eventKind: e.target.value as never }),
                    interpreter: active.interpreter,
                    interpreterNote: active.interpreterNote,
                  })
                }
              >
                {EVENT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {EVENT_KIND_INFO[kind].label} — {EVENT_KIND_INFO[kind].note}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Seating">
              <Select
                value={active.brief.seating}
                onChange={(e) =>
                  setResult({
                    ...generateConcept({ ...active.brief, seating: e.target.value as never }),
                    interpreter: active.interpreter,
                    interpreterNote: active.interpreterNote,
                  })
                }
              >
                {SEATING_STYLES.map((style) => (
                  <option key={style} value={style}>
                    {SEATING_STYLE_INFO[style].label} — {SEATING_STYLE_INFO[style].areaPerPersonSqM} m² per person
                  </option>
                ))}
              </Select>
            </Field>

            <NumberField
              label="Attendance"
              value={active.brief.attendance}
              min={1}
              max={20_000}
              step={10}
              onChange={(attendance) =>
                setResult({
                  ...generateConcept({ ...active.brief, attendance }),
                  interpreter: active.interpreter,
                  interpreterNote: active.interpreterNote,
                })
              }
            />
          </Section>

          <Section title={`What will be placed (${active.elements.length})`} description="Each one says why it is where it is.">
            <div className="space-y-1.5">
              {active.elements.map((element, i) => (
                <div key={i} className="rounded-lg border border-line bg-surface-muted/40 p-2">
                  <p className="text-[11px] font-semibold text-ink">{element.label}</p>
                  <p className="mt-0.5 text-[10px] leading-snug text-ink-subtle">{element.rationale}</p>
                </div>
              ))}
            </div>
          </Section>

          {active.warnings.length ? (
            <Section title="Worth knowing">
              {active.warnings.map((warning, i) => (
                <p key={i} className="notice-warning mb-1 text-[11px] leading-snug">
                  {warning}
                </p>
              ))}
            </Section>
          ) : null}

          <Section title="Place it">
            <Toggle
              label="Replace what is here"
              checked={replaceExisting}
              onChange={setReplaceExisting}
              hint="Site constraints are always kept — they describe the building, not the design."
            />
            <Toggle label="Build the room" checked={buildWalls} onChange={setBuildWalls} hint="Draws walls and a floor at the derived size." />

            <button type="button" className="ed-action-primary w-full justify-center" onClick={apply} disabled={readOnly}>
              <Wand2 className="h-3.5 w-3.5" /> Place this layout
            </button>
            <p className="field-hint">
              Everything placed is a normal object — move it, resize it, delete it. Undo puts the plan back exactly as it
              was.
            </p>
          </Section>
        </>
      ) : (
        <Section title="">
          <EmptyState
            icon={<Lightbulb className="h-6 w-6" />}
            title="Start with a sentence"
            description="Type a description above, or press one of the examples. A layout appears here before you spend anything."
          />
        </Section>
      )}
    </>
  );
}

/**
 * Turn concept elements into scene objects.
 *
 * The concept engine works in element terms — "a stage this big, here" — and
 * this is the only place that maps those onto the editor's object types. Every
 * object it makes is an ordinary one: nothing is locked, nothing is marked as
 * generated, and the plan afterwards is indistinguishable from one built by
 * hand.
 */
export function objectsFromConcept(concept: ConceptResult): SceneObject[] {
  const objects: SceneObject[] = [];

  for (const element of concept.elements) {
    const position = { x: element.xMm, y: 0, z: element.zMm };

    switch (element.kind) {
      case 'stage': {
        const params = element.params as { deckColumns: number; deckRows: number; deckHeightMm: number };
        objects.push({
          id: newId(),
          type: 'stage',
          name: element.label,
          positionMm: position,
          rotationDeg: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          deckRows: params.deckRows,
          deckColumns: params.deckColumns,
          deckHeightMm: params.deckHeightMm,
          stairSides: ['south'],
          stairBays: { south: 1 },
          skirtSides: ['north', 'east', 'south', 'west'],
          guardrailSides: params.deckHeightMm > 762 ? ['north', 'east', 'west'] : [],
        } as SceneObject);
        break;
      }

      case 'screen': {
        const params = element.params as {
          panelKey: string;
          columns: number;
          rows: number;
          bottomMm: number;
          frame: string;
          curveDeg: number;
        };
        objects.push({
          ...createLedScreen({
            panelKey: params.panelKey,
            columns: params.columns,
            rows: params.rows,
            bottomMm: params.bottomMm,
            frame: params.frame as never,
            curveDeg: params.curveDeg,
            position,
            name: element.label,
          }),
        });
        break;
      }

      case 'truss': {
        const params = element.params as { shape: string; systemKey: string; trimHeightMm: number; legType: string };
        objects.push(
          createTruss({
            shape: params.shape as never,
            systemKey: params.systemKey,
            widthMm: element.widthMm,
            depthMm: element.depthMm,
            trimHeightMm: params.trimHeightMm,
            legType: params.legType as never,
            position,
            name: element.label,
          })
        );
        break;
      }

      case 'booth-grid': {
        const params = element.params as {
          placements: Array<{ centre: { xMm: number; zMm: number }; rotationDeg: number; standNumber: string }>;
          boothType: string;
          widthMm: number;
          depthMm: number;
        };
        for (const placement of params.placements) {
          objects.push(
            createBooth({
              boothType: params.boothType as never,
              widthMm: params.widthMm,
              depthMm: params.depthMm,
              standNumber: placement.standNumber,
              position: { x: placement.centre.xMm, y: 0, z: placement.centre.zMm },
              rotationDeg: placement.rotationDeg,
            })
          );
        }
        break;
      }

      /*
       * Seating, dance floors, bars and catering are placed as marked zones
       * rather than as furniture. Furniture needs a catalogue item, and
       * inventing which chair someone wants is exactly the kind of guess this
       * engine avoids — the zone says how much space it needs and the planner
       * fills it from the catalogue.
       */
      case 'seating':
      case 'dance-floor':
      case 'bar':
      case 'registration':
      case 'catering': {
        objects.push({
          id: newId(),
          type: 'shape',
          name: element.label,
          positionMm: position,
          rotationDeg: { x: 0, y: element.rotationDeg, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          kind: 'rectangle',
          widthMm: element.widthMm,
          depthMm: element.depthMm,
          extrudeMm: element.kind === 'dance-floor' ? 25 : element.kind === 'seating' ? 0 : element.heightMm,
          fillColor:
            element.kind === 'dance-floor'
              ? '#c084fc'
              : element.kind === 'seating'
                ? '#334155'
                : '#0f766e',
          fillOpacity: element.kind === 'seating' ? 0.35 : 0.9,
          borderColor: '#94a3b8',
          borderOpacity: 1,
        } as SceneObject);
        break;
      }

      default:
        break;
    }
  }

  return objects;
}

/* ── From a photograph ─────────────────────────────────────────────────── */

function ConceptFromPhoto() {
  const planId = useEditor((s) => s.planId);
  const addObjects = useEditor((s) => s.addObjects);
  const readOnly = useEditor((s) => s.readOnly);

  const fileRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [filename, setFilename] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [analysis, setAnalysis] = useState<PhotoAnalysisResult | null>(null);

  const { data: capabilities } = useQuery({
    queryKey: ['spatial-capabilities'],
    queryFn: () => spatial.ai.capabilities(),
    staleTime: 120_000,
  });
  const capability = capabilities?.photo_analysis;

  const pick = (file: File) => {
    if (file.size > 12 * 1024 * 1024) {
      toast('error', 'That image is over 12 MB. Use a smaller one.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage(String(reader.result));
      setFilename(file.name);
      setAnalysis(null);
    };
    reader.readAsDataURL(file);
  };

  const analyse = async () => {
    if (!image) return;
    setRunning(true);
    setProgress(5);
    try {
      const started = await spatial.ai.photoAnalysis(image, planId ?? undefined, filename);
      const finished = await pollJob(started.id, (job) => setProgress(job.progress), { intervalMs: 2000 });

      if (finished.status !== 'completed' || !finished.output) {
        toast('error', finished.errorMessage ?? 'Could not analyse that photograph.');
        return;
      }
      setAnalysis(finished.output as unknown as PhotoAnalysisResult);
      toast('success', 'Photograph analysed.');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Could not analyse that photograph.');
    } finally {
      setRunning(false);
      setProgress(0);
    }
  };

  const placeSuggestion = (suggestion: PhotoAnalysisResult['objects'][number]['suggestions'][number], count: number) => {
    const objects: SceneObject[] = [];
    const columns = Math.ceil(Math.sqrt(count));
    const spacing = Math.max(1200, (suggestion.widthMm ?? 800) + 400);

    for (let i = 0; i < Math.min(count, 40); i += 1) {
      const column = i % columns;
      const row = Math.floor(i / columns);
      objects.push({
        id: newId(),
        type: 'catalog',
        name: suggestion.name,
        catalogItemId: suggestion.id,
        dimensionsMm: {
          width: suggestion.widthMm ?? 600,
          depth: suggestion.widthMm ?? 600,
          height: suggestion.heightMm ?? 750,
        },
        positionMm: {
          x: Math.round((column - columns / 2) * spacing),
          y: 0,
          z: Math.round(row * spacing),
        },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      } as CatalogSceneObject);
    }

    addObjects(objects);
    toast('success', `${objects.length} × ${suggestion.name} placed. Move them into position.`);
  };

  return (
    <>
      <Section
        title="Analyse a photograph"
        description="Identifies what is in a picture of a space, estimates its size, and suggests catalogue models for what it sees."
      >
        {capability && !capability.allowed ? (
          <div className="notice-warning mb-2 text-[11px] leading-snug">
            {capability.reason ?? 'Not available on this account.'}
          </div>
        ) : null}

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pick(file);
          }}
        />

        {image ? (
          <div className="relative">
            <img src={image} alt="The photograph to analyse" className="w-full rounded-lg border border-line" />
            <button
              type="button"
              className="icon-btn absolute right-2 top-2 h-7 w-7 bg-surface-strong/90"
              aria-label="Remove"
              onClick={() => {
                setImage(null);
                setAnalysis(null);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line px-4 py-8 text-center transition hover:border-primary/60 hover:bg-primary/5"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="h-6 w-6 text-ink-subtle" />
            <span className="text-xs font-semibold text-ink">Choose a photograph</span>
            <span className="text-[10px] text-ink-subtle">JPG, PNG or WebP, up to 12 MB</span>
          </button>
        )}

        {image && !analysis ? (
          running ? (
            <div className="mt-2">
              <ProgressBar value={progress} label="Analysing" />
            </div>
          ) : (
            <button
              type="button"
              className="ed-action-primary mt-2 w-full justify-center"
              onClick={() => void analyse()}
              disabled={capability ? !capability.allowed : false}
            >
              <Camera className="h-3.5 w-3.5" />
              Analyse{capability?.cost ? ` · ${capability.cost} credits` : ''}
            </button>
          )
        ) : null}

        {!image ? (
          <button type="button" className="ed-action mt-2 w-full justify-center border border-line" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Upload
          </button>
        ) : null}
      </Section>

      {analysis ? (
        <>
          <Section title="What it saw" description={`Confidence: ${analysis.confidence}. Dimensions are estimated from apparent scale, not measured.`}>
            <div className="grid grid-cols-2 gap-1.5">
              <Stat label="Space" value={analysis.spaceType.replace(/-/g, ' ')} />
              <Stat
                label="Estimated size"
                value={`${analysis.estimatedWidthM.toFixed(0)} × ${analysis.estimatedDepthM.toFixed(0)} m`}
                tone={analysis.confidence === 'high' ? 'good' : 'warn'}
              />
              <Stat label="Ceiling" value={`${analysis.estimatedCeilingHeightM.toFixed(1)} m`} />
              <Stat label="Lighting" value={analysis.lightingMood} />
            </div>

            {analysis.notes.length ? (
              <div className="mt-2 space-y-1">
                {analysis.notes.map((note, i) => (
                  <p key={i} className="notice-warning text-[11px] leading-snug">
                    {note}
                  </p>
                ))}
              </div>
            ) : null}
          </Section>

          <Section
            title={`Objects found (${analysis.objects.length})`}
            description="Each one is matched against your catalogue, so what gets placed is a measured model rather than a reconstruction."
          >
            <div className="space-y-2">
              {analysis.objects.map((object, i) => (
                <div key={i} className="rounded-lg border border-line bg-surface-muted/40 p-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-semibold text-ink">
                      {object.count} × {object.label}
                    </span>
                    <span className="chip shrink-0">{object.confidence}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-ink-subtle">
                    about {object.estimatedWidthM.toFixed(2)} m wide, {object.position} of frame
                  </p>

                  {object.suggestions.length ? (
                    <div className="mt-1.5 space-y-1">
                      {object.suggestions.map((suggestion) => (
                        <div key={suggestion.id} className="flex items-center gap-2 rounded-md border border-line bg-surface px-1.5 py-1">
                          {suggestion.previewImage ? (
                            <img src={suggestion.previewImage} alt="" className="ed-thumb h-8 w-8" loading="lazy" />
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] font-medium text-ink">{suggestion.name}</p>
                            <p className="truncate text-[10px] text-ink-subtle">
                              {suggestion.score}% match · {suggestion.reason}
                            </p>
                          </div>
                          <button
                            type="button"
                            className="ed-action shrink-0 px-1.5 py-0.5 text-[10px]"
                            disabled={readOnly}
                            onClick={() => placeSuggestion(suggestion, object.count)}
                          >
                            Place {object.count}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-[10px] text-ink-subtle">
                      Nothing in the catalogue matches this closely enough to suggest. Search the catalogue by hand, or
                      generate a model from a photo of it.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Build a layout from it" description="Turns what was seen into a description, then into a laid-out room.">
            {analysis.suggestedBrief ? (
              <>
                <p className="mb-2 rounded-lg border border-line bg-surface-muted/40 px-2 py-1.5 text-[11px] leading-snug text-ink-muted">
                  “{analysis.suggestedBrief.prompt}”
                </p>
                <p className="field-hint">
                  Switch to <strong className="text-ink-muted">From a description</strong> and paste that in to place a
                  full layout, or place the individual items above.
                </p>
              </>
            ) : null}
          </Section>
        </>
      ) : null}
    </>
  );
}
