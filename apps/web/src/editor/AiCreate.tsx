import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Check, Loader2, RotateCcw, Sparkles, Wand2, X } from 'lucide-react';
import type { CatalogItemDto } from '@novira/shared';
import { useEditor } from './editorStore';
import { useQuery } from '@tanstack/react-query';
import { studio, type AiJobLike } from '../lib/studioApi';
import { api, ApiClientError } from '../lib/api';
import { toast } from '../components/ui';
import { AiProgress } from '../components/AiProgress';
import { HoverModel } from './ModelPreview';

/**
 * Make a thing, and put it in the room.
 *
 * The AI used to live on its own page: you left the plan, typed a prompt,
 * waited, got a model in a gallery, and then had to find your way back and
 * work out how to get it into the scene. Every one of those steps is a place
 * to lose the thread, and the net effect was a feature that generated objects
 * nobody used — a toy rather than a tool.
 *
 * This is the same generators, moved to where the work is. Four things make
 * the difference:
 *
 *  · **It never leaves the editor.** The plan stays on screen behind it, so
 *    what you are making is next to what you are making it for.
 *  · **The result is previewed before it lands.** A generated mesh is a
 *    gamble; seeing it turn on a plinth before committing is what makes a
 *    second attempt cheap instead of annoying.
 *  · **Scale is asked for, not assumed.** Generators have no idea how big
 *    anything is — a chair comes back four metres tall as often as not. The
 *    mesh is measured, a sensible height is offered, and the number is
 *    editable. This is the step that makes a generated object usable in a
 *    plan drawn in millimetres.
 *  · **Placing it is one button.** It goes into the scene at the middle of
 *    the view, selected, ready to move — not into a library to be hunted for.
 */

type Stage = 'prompt' | 'working' | 'review';

/** Sensible real-world heights, so the scale step starts from something true. */
const HEIGHT_HINTS: Array<{ match: RegExp; mm: number; label: string }> = [
  { match: /\b(chair|seat|stool|bench)\b/i, mm: 900, label: 'chair' },
  { match: /\b(table|desk)\b/i, mm: 750, label: 'table' },
  { match: /\b(sofa|couch|lounge)\b/i, mm: 850, label: 'sofa' },
  { match: /\b(lectern|podium|pulpit)\b/i, mm: 1200, label: 'lectern' },
  { match: /\b(bar|counter|reception)\b/i, mm: 1100, label: 'counter' },
  { match: /\b(plant|tree|palm)\b/i, mm: 1800, label: 'plant' },
  { match: /\b(screen|monitor|tv)\b/i, mm: 1200, label: 'screen' },
  { match: /\b(door|doorway)\b/i, mm: 2100, label: 'door' },
  { match: /\b(vase|centrepiece|centerpiece|lamp)\b/i, mm: 400, label: 'small object' },
  { match: /\b(banner|totem|column|pillar)\b/i, mm: 2400, label: 'tall object' },
];

function suggestHeightMm(prompt: string): { mm: number; because: string } {
  for (const hint of HEIGHT_HINTS) {
    if (hint.match.test(prompt)) {
      return { mm: hint.mm, because: `typical for a ${hint.label}` };
    }
  }
  return { mm: 900, because: 'a common size for a single object' };
}

const STYLES = [
  { value: '', label: 'No style' },
  { value: 'photorealistic product render', label: 'Realistic' },
  { value: 'clean modern minimalist', label: 'Modern' },
  { value: 'classic ornate traditional', label: 'Classic' },
  { value: 'low-poly stylised', label: 'Low poly' },
];

export function AiCreate({ onClose }: { onClose: () => void }) {
  const planId = useEditor((s) => s.planId);
  const cacheItems = useEditor((s) => s.cacheItems);
  const setPendingItem = useEditor((s) => s.setPendingItem);

  const [stage, setStage] = useState<Stage>('prompt');
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('');
  const [job, setJob] = useState<AiJobLike | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [heightMm, setHeightMm] = useState(900);
  const [category, setCategory] = useState('decor');
  const [saving, setSaving] = useState(false);
  const cancelled = useRef(false);

  // The catalogue's own categories, so the saved item lands somewhere real.
  const { data: categories } = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: () => api.catalog.categories(),
    staleTime: 10 * 60_000,
  });

  // Default to whichever category exists, preferring a general one.
  useEffect(() => {
    if (!categories?.length) return;
    const preferred =
      categories.find((c) => /decor|prop|other|misc/i.test(c.slug)) ?? categories[0]!;
    setCategory((current) => (categories.some((c) => c.slug === current) ? current : preferred.slug));
  }, [categories]);

  // Escape closes, as every other window in this editor does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stage !== 'working') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, stage]);

  const output = (job?.output ?? {}) as Record<string, unknown>;
  const modelUrl = typeof output.modelUrl === 'string' ? output.modelUrl : null;

  /*
   * What the generator actually produced, before scaling.
   *
   * Shown because it is the one number that explains a wrong-looking result:
   * a mesh that came back 40 mm tall and one that came back 12 m tall look
   * identical in a preview, and only this tells you which you have.
   */
  const detected = useMemo(() => {
    const h = Number(output.detectedHeightMm ?? 0);
    const w = Number(output.detectedWidthMm ?? 0);
    const d = Number(output.detectedDepthMm ?? 0);
    return h > 0 ? { h, w, d } : null;
  }, [output]);

  const run = async () => {
    const text = prompt.trim();
    if (!text) return;

    cancelled.current = false;
    setStage('working');
    setStartedAt(Date.now());
    setJob(null);

    try {
      const started = await studio.textTo3d({
        prompt: text,
        style: style || undefined,
        planId: planId ?? undefined,
      });
      setJob(started);

      const finished = await studio.wait(started.id, (progress) => {
        if (!cancelled.current) setJob(progress);
      });
      if (cancelled.current) return;

      setJob(finished);
      if (finished.status !== 'completed') {
        setStage('prompt');
        return;
      }

      /*
       * Offer a height rather than demanding one. The measured mesh is the
       * honest starting point when it looks plausible, and a size typical of
       * whatever was asked for otherwise — a generated "chair" measuring four
       * metres is far more likely to be the generator's arbitrary scale than
       * a real request for a giant chair.
       */
      const measured = Number((finished.output as Record<string, unknown> | null)?.detectedHeightMm ?? 0);
      const guess = suggestHeightMm(text);
      setHeightMm(measured > 200 && measured < 4000 ? Math.round(measured) : guess.mm);
      setStage('review');
    } catch (error: unknown) {
      if (cancelled.current) return;
      toast('error', error instanceof ApiClientError ? error.message : 'That could not be generated.');
      setStage('prompt');
    }
  };

  const cancel = () => {
    cancelled.current = true;
    if (job?.id) void studio.cancel?.(job.id).catch(() => undefined);
    setStage('prompt');
    setJob(null);
  };

  /**
   * Put it in the room.
   *
   * It is saved to the catalogue on the way, for two reasons that are both
   * about it being a real object rather than a one-off: the catalogue is
   * where the stated height is applied to the measured mesh, so the thing
   * arrives at the size it is meant to be; and a catalogue row means the same
   * object can be placed again tomorrow instead of regenerated. A scene
   * object also needs a catalogue id to render, so this is not optional.
   */
  const place = async () => {
    if (!modelUrl || !job?.id) return;
    setSaving(true);
    try {
      const name = prompt.trim().slice(0, 60) || 'Generated object';
      const saved = await studio.saveToCatalog({
        jobId: job.id,
        name,
        description: `Generated from: ${prompt.trim()}`,
        categorySlug: category,
        targetHeightMm: Math.round(heightMm),
        scope: 'personal',
      });

      /*
       * Fall back to what we already know if the response is thin. The saved
       * item is the authority on the scaled size, but a placement should not
       * fail because a field was missing — the measured mesh and the stated
       * height are enough to place it correctly.
       */
      const factor = detected ? heightMm / detected.h : 1;
      const item = saved.item ?? {
        id: saved.id,
        name,
        modelUrl,
        widthMm: detected ? Math.max(1, Math.round(detected.w * factor)) : 600,
        depthMm: detected ? Math.max(1, Math.round(detected.d * factor)) : 600,
        heightMm: Math.round(heightMm),
      };

      /*
       * Arm it rather than drop it.
       *
       * Dropping at the origin puts the object wherever the origin happens to
       * be — usually off-camera, in the middle of whatever is already there,
       * and needing to be found before it can be moved. Arming it hands the
       * object to the cursor: the editor already draws a translucent ghost of
       * a pending item where it would land, so you see it standing in the
       * room, at its real size, against what is already built, and click the
       * spot you want. That preview is the whole point of generating into a
       * plan rather than into a gallery.
       */
      const dto = {
        id: item.id,
        name: item.name,
        modelUrl: item.modelUrl ?? modelUrl,
        previewImage: (typeof output.thumbnailUrl === 'string' ? output.thumbnailUrl : null),
        widthMm: item.widthMm ?? null,
        depthMm: item.depthMm ?? null,
        heightMm: item.heightMm ?? Math.round(heightMm),
        description: `Generated from: ${prompt.trim()}`,
      } as unknown as CatalogItemDto;

      cacheItems([dto]);
      setPendingItem(dto);
      toast('success', `${item.name} is ready — click the floor to place it.`);
      onClose();
    } catch (error: unknown) {
      toast(
        'error',
        error instanceof ApiClientError ? error.message : 'That could not be added to the plan.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className="fixed inset-0 z-40 cursor-default bg-black/20"
        onClick={() => stage !== 'working' && onClose()}
      />

      <div className="pointer-events-auto fixed right-4 top-16 z-50 w-[360px]">
        <div className="panel overflow-hidden p-0 shadow-2xl">
          <header className="flex items-center justify-between border-b border-line px-3 py-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <p className="text-[13px] font-semibold text-ink">Make something</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={stage === 'working'}
              className="icon-btn h-7 w-7 disabled:opacity-40"
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </header>

          <div className="max-h-[70vh] overflow-y-auto p-3">
            {stage === 'prompt' ? (
              <>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-ink-subtle">
                  What do you need?
                </label>
                <textarea
                  autoFocus
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void run();
                  }}
                  rows={3}
                  placeholder="A gold Chiavari banquet chair with a cream seat pad"
                  className="ed-field w-full resize-y text-[13px]"
                />
                <p className="mt-1 text-[10px] leading-snug text-ink-subtle">
                  Describe one object, not a scene. Say the material and the colour — those are what
                  the generator uses most.
                </p>

                <label className="mb-1 mt-3 block text-[10px] font-bold uppercase tracking-[0.08em] text-ink-subtle">
                  Style
                </label>
                <div className="flex flex-wrap gap-1">
                  {STYLES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setStyle(s.value)}
                      className={`chip transition ${style === s.value ? 'chip-active' : 'hover:border-line-strong'}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => void run()}
                  disabled={!prompt.trim()}
                  className="btn-primary mt-3 flex w-full items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Generate
                </button>
                <p className="mt-1.5 text-center text-[10px] text-ink-subtle">
                  About a minute. You can keep working while it runs.
                </p>
              </>
            ) : null}

            {stage === 'working' && job ? (
              <>
                <AiProgress
                  progress={job.progress}
                  status={job.status}
                  startedAt={startedAt}
                  expectedMs={70_000}
                  error={job.errorMessage}
                  onCancel={cancel}
                  note="Building the mesh. This usually takes about a minute."
                />
                <p className="mt-2 truncate text-[10px] text-ink-subtle">“{prompt.trim()}”</p>
              </>
            ) : null}

            {stage === 'working' && !job ? (
              <div className="flex items-center gap-2 py-6 text-[12px] text-ink-muted">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Starting…
              </div>
            ) : null}

            {stage === 'review' && modelUrl ? (
              <>
                {/*
                  The model, turning, before anything is committed. A still
                  thumbnail hides exactly the faults that matter in a mesh —
                  a missing back, a collapsed leg — and a second attempt is
                  cheap only if you can see you need one.
                */}
                <div className="h-44 overflow-hidden rounded-lg border border-line bg-surface-muted">
                  <HoverModel url={modelUrl} poster={typeof output.thumbnailUrl === 'string' ? output.thumbnailUrl : null} alt="" className="h-full w-full" />
                </div>

                <div className="mt-3">
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-ink-subtle">
                    How tall is it, really?
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={10}
                      max={30000}
                      value={heightMm}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        if (Number.isFinite(next)) setHeightMm(Math.max(10, Math.min(30000, next)));
                      }}
                      className="input w-28 text-[13px] tabular-nums"
                    />
                    <span className="text-[11px] text-ink-subtle">mm</span>
                    <span className="ml-auto text-[11px] tabular-nums text-ink-muted">
                      {(heightMm / 1000).toFixed(2)} m
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-snug text-ink-subtle">
                    {detected
                      ? `The generator produced it ${(detected.h / 1000).toFixed(2)} m tall — that figure is arbitrary, so set the real height here and everything scales with it.`
                      : 'The mesh could not be measured, so set the height you need.'}
                  </p>
                </div>

                <div className="mt-3">
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-ink-subtle">
                    Keep it under
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="input w-full text-xs"
                  >
                    {(categories ?? []).map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] leading-snug text-ink-subtle">
                    It joins your own library, so you can place it again without generating it again.
                  </p>
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStage('prompt')}
                    disabled={saving}
                    className="btn-secondary flex flex-1 items-center justify-center gap-1.5 disabled:opacity-40"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={() => void place()}
                    disabled={saving}
                    className="btn-primary flex flex-1 items-center justify-center gap-1.5 disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    {saving ? 'Placing…' : 'Place it'}
                  </button>
                </div>
              </>
            ) : null}

            {stage === 'review' && !modelUrl ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <Box className="h-5 w-5 text-ink-subtle" />
                <p className="text-[12px] text-ink-muted">That finished without producing a model.</p>
                <button type="button" onClick={() => setStage('prompt')} className="btn-secondary">
                  Try again
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
