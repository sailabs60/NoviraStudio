/**
 * AI 3D Generator.
 *
 * "Turn your ideas into 3D models, ready to use in your scene."
 *
 * A prompt row, then a grid of what has been made. The grid is the part that
 * matters: a generator that produces one model and forgets it makes you
 * re-generate every time you change your mind, and generating is the slow,
 * paid step. What was made stays here for the session, and every tile places
 * into the room.
 *
 * ## Size is the thing that makes a generated model usable
 *
 * A mesh generator has no idea how big anything is — a chair comes back four
 * metres tall as often as not. The measured height is offered, editable, before
 * anything is placed, because a plan drawn in millimetres cannot take an object
 * at an arbitrary scale.
 */
import { useState } from 'react';
import { Boxes, Download, Loader2, Plus, Sparkles } from 'lucide-react';
import type { CatalogItemDto } from '@novira/shared';
import { useEditor } from '../../editorStore';
import { pollJob } from '../../../lib/spatialApi';
import { studio } from '../../../lib/studioApi';
import { toast } from '../../../components/ui';

interface Made {
  id: string;
  name: string;
  modelUrl: string;
  thumbnailUrl: string | null;
  heightMm: number;
}

/**
 * A sensible real height for a thing, by what it is called.
 *
 * Used when the measured mesh comes back at an implausible size, which is most
 * of the time. These are the figures a production manager would give.
 */
const HEIGHT_HINTS: Array<{ test: RegExp; mm: number }> = [
  { test: /chair|stool|seat/i, mm: 900 },
  { test: /table|desk/i, mm: 750 },
  { test: /lectern|podium|pulpit/i, mm: 1200 },
  { test: /plant|palm|tree|planter/i, mm: 1800 },
  { test: /sofa|settee|couch/i, mm: 800 },
  { test: /bar|counter/i, mm: 1100 },
  { test: /screen|wall|banner/i, mm: 2400 },
  { test: /booth|stand|kiosk/i, mm: 2500 },
];

const suggestHeightMm = (name: string): number =>
  HEIGHT_HINTS.find((hint) => hint.test.test(name))?.mm ?? 900;

export function AiModelTab() {
  const setPendingItem = useEditor((s) => s.setPendingItem);
  const cacheItems = useEditor((s) => s.cacheItems);
  const readOnly = useEditor((s) => s.readOnly);
  const planId = useEditor((s) => s.planId);

  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [made, setMade] = useState<Made[]>([]);

  const generate = async () => {
    if (!prompt.trim()) {
      toast('error', 'Say what to make.');
      return;
    }
    setRunning(true);
    setProgress(3);
    try {
      const started = await studio.textTo3d({
        prompt: prompt.trim(),
        planId: planId ?? undefined,
        refine: true,
      });
      const finished = await pollJob(started.id, (job) => setProgress(job.progress), { intervalMs: 2500 });

      if (finished.status !== 'completed' || !finished.output) {
        toast('error', finished.errorMessage ?? 'That did not generate. Nothing was charged.');
        return;
      }
      const output = finished.output as {
        modelUrl?: string;
        url?: string;
        thumbnailUrl?: string;
        measuredHeightMm?: number;
      };
      const modelUrl = output.modelUrl ?? output.url;
      if (!modelUrl) {
        toast('error', 'The generator returned nothing usable.');
        return;
      }

      // Trust a measurement inside a believable range; otherwise use the
      // typical height for the kind of thing that was asked for.
      const measured = output.measuredHeightMm ?? 0;
      const heightMm =
        measured > 200 && measured < 4000 ? Math.round(measured) : suggestHeightMm(prompt);

      setMade((prev) => [
        {
          id: crypto.randomUUID(),
          name: prompt.trim(),
          modelUrl,
          thumbnailUrl: output.thumbnailUrl ?? null,
          heightMm,
        },
        ...prev,
      ]);
      toast('success', 'Made. Set its height, then place it in the room.');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'That did not generate.');
    } finally {
      setRunning(false);
      setProgress(0);
    }
  };

  /** Arm the cursor with it, so it lands where the user clicks. */
  const place = (item: Made) => {
    if (readOnly) return;
    const dto = {
      id: -Math.abs(Number(item.id.replace(/\D/g, '').slice(0, 8) || 1)),
      name: item.name,
      modelUrl: item.modelUrl,
      previewImage: item.thumbnailUrl,
      widthMm: null,
      depthMm: null,
      heightMm: item.heightMm,
      description: `Generated from: ${item.name}`,
    } as unknown as CatalogItemDto;

    cacheItems([dto]);
    setPendingItem(dto);
    toast('success', `${item.name} is ready — click the floor to place it.`);
  };

  return (
    <div className="space-y-3">
      <div className="ai-card">
        <h3 className="ai-card-title">AI 3D Generator</h3>
        <p className="ai-card-note">Turn your ideas into 3D models, ready to use in your scene.</p>

        <p className="mt-3 text-[11px] font-semibold text-ink-muted">
          Describe the 3D asset you want to create…
        </p>
        <div className="mt-1.5 flex gap-1.5">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !running) generate();
            }}
            placeholder="e.g. modern stage with LED screen and podium"
            className="ai-input min-w-0 flex-1"
          />
          <button type="button" className="ai-btn-primary shrink-0" onClick={generate} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {running ? `${progress}%` : 'Generate'}
          </button>
        </div>
      </div>

      <div>
        <h3 className="mb-2 px-1 text-[13px] font-bold text-ink">Generated Models</h3>

        {made.length === 0 ? (
          <div className="ai-card flex flex-col items-center py-8 text-center">
            <Boxes className="h-6 w-6 text-ink-subtle" />
            <p className="mt-2 text-[12px] font-semibold text-ink">Nothing made yet</p>
            <p className="mt-0.5 max-w-[220px] text-[11px] leading-relaxed text-ink-muted">
              Describe something that is not in your catalogue, and it will appear here ready to place.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {made.map((item) => (
              <figure key={item.id} className="overflow-hidden rounded-xl border border-line bg-surface">
                {item.thumbnailUrl ? (
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    className="aspect-square w-full bg-surface-sunken object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex aspect-square w-full items-center justify-center bg-surface-sunken">
                    <Boxes className="h-5 w-5 text-ink-subtle" />
                  </span>
                )}
                <figcaption className="border-t border-line p-2">
                  <p className="truncate text-[11px] font-semibold text-ink" title={item.name}>
                    {item.name}
                  </p>

                  <label className="mt-1.5 block">
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-subtle">
                      Height
                    </span>
                    <span className="mt-0.5 flex items-center gap-1">
                      <input
                        type="number"
                        className="ed-field w-full"
                        value={item.heightMm}
                        onChange={(e) =>
                          setMade((prev) =>
                            prev.map((m) =>
                              m.id === item.id ? { ...m, heightMm: Number(e.target.value) || m.heightMm } : m
                            )
                          )
                        }
                      />
                      <span className="text-[10px] text-ink-subtle">mm</span>
                    </span>
                  </label>

                  <div className="mt-1.5 flex gap-1">
                    <button
                      type="button"
                      className="ai-btn flex-1 px-2 py-1 text-[10px]"
                      onClick={() => place(item)}
                      disabled={readOnly}
                    >
                      <Plus className="h-3 w-3" /> Place
                    </button>
                    <a
                      className="ai-btn px-2 py-1 text-[10px]"
                      href={item.modelUrl}
                      download
                      title="Download the model"
                    >
                      <Download className="h-3 w-3" />
                    </a>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
