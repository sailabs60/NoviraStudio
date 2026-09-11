/**
 * AI Artwork Generation.
 *
 * "Create logos, banners, posters, and more for your event."
 *
 * A prompt row, a row of filter pills, and a gallery — the reference's layout.
 * The pills are not decoration: a logo, a poster and an LED backdrop are three
 * different aspect ratios and three different briefs, and asking one generator
 * for "a logo" then stretching it across a 9 m wall is how the old flow
 * produced things nobody could use.
 *
 * Every result has one button, and it puts the artwork on the surfaces of the
 * plan that carry it. An image generator that leaves a PNG in a gallery has
 * done the easy half.
 */
import { useMemo, useState } from 'react';
import { Check, Image as ImageIcon, Loader2, Sparkles, Upload } from 'lucide-react';
import type { SceneObject } from '@novira/shared';
import { useEditor } from '../../editorStore';
import { pollJob } from '../../../lib/spatialApi';
import { studio } from '../../../lib/studioApi';
import { toast } from '../../../components/ui';

type Kind = 'all' | 'logo' | 'poster' | 'banner' | 'screen';

const KINDS: Array<{
  id: Exclude<Kind, 'all'>;
  label: string;
  aspect: string;
  frame: (subject: string) => string;
}> = [
  {
    id: 'logo',
    label: 'Logos',
    aspect: '1:1',
    frame: (s) =>
      `A clean, flat vector event logo for ${s}. Centred on a plain white background, generous margin, ` +
      `no mockup, no photograph, no 3D, no drop shadow. A simple geometric mark with the wordmark beneath. ` +
      `High contrast, legible printed 200 mm wide.`,
  },
  {
    id: 'poster',
    label: 'Posters',
    aspect: '3:4',
    frame: (s) =>
      `An event poster for ${s}. Bold heading in the top third, clear lower half, flat colour blocking ` +
      `rather than photography, print-ready. No mockup, no frame, no room around it — the artwork only.`,
  },
  {
    id: 'banner',
    label: 'Banners',
    aspect: '9:16',
    frame: (s) =>
      `A tall printed event banner for ${s}. Portrait, read from three metres: bold heading at the top, ` +
      `open lower half, flat colour blocking. No mockup, no stand — the artwork only, edge to edge.`,
  },
  {
    id: 'screen',
    label: 'Screen',
    aspect: '16:9',
    frame: (s) =>
      `Wide-format stage screen artwork for ${s}. Designed to be seen from twenty metres: a dark ground, ` +
      `one strong focal idea, deep saturated colour, empty space at the edges so a lectern does not cover ` +
      `anything important. No borders, no watermark.`,
  },
];

interface Made {
  url: string;
  kind: Exclude<Kind, 'all'>;
}

export function AiArtworkTab() {
  const scene = useEditor((s) => s.scene);
  const updateObject = useEditor((s) => s.updateObject);
  const readOnly = useEditor((s) => s.readOnly);
  const planId = useEditor((s) => s.planId);
  const designBrief = useEditor((s) => s.scene.designBrief);

  const [kind, setKind] = useState<Exclude<Kind, 'all'>>('logo');
  const [filter, setFilter] = useState<Kind>('all');
  const [subject, setSubject] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [made, setMade] = useState<Made[]>([]);

  /** The surfaces in the plan that artwork goes on. */
  const surfaces = useMemo(
    () => ({
      panels: scene.objects.filter((o) => o.type === 'artwork'),
      screens: scene.objects.filter((o) => o.type === 'led'),
    }),
    [scene.objects]
  );

  const generate = async () => {
    const words = subject.trim() || designBrief?.prompt?.slice(0, 80) || '';
    if (!words) {
      toast('error', 'Say what the event is, so the artwork is about something.');
      return;
    }
    const entry = KINDS.find((k) => k.id === kind)!;
    const palette = designBrief?.paletteHex?.length
      ? ` Use this palette and nothing outside it: ${designBrief.paletteHex.join(', ')}.`
      : '';

    setRunning(true);
    setProgress(4);
    try {
      const started = await studio.mockup({
        prompt: entry.frame(words) + palette,
        aspectRatio: entry.aspect,
        size: '2K',
        refine: false,
        planId: planId ?? undefined,
      });
      const finished = await pollJob(started.id, (job) => setProgress(job.progress), { intervalMs: 2000 });

      if (finished.status !== 'completed' || !finished.output) {
        toast('error', finished.errorMessage ?? 'That did not generate. Nothing was charged.');
        return;
      }
      const output = finished.output as { imageUrl?: string; url?: string };
      const url = output.imageUrl ?? output.url;
      if (!url) {
        toast('error', 'The generator returned nothing usable.');
        return;
      }
      setMade((prev) => [{ url, kind }, ...prev].slice(0, 16));
      toast('success', `${entry.label.replace(/s$/, '')} ready. Put it on the event when you are happy.`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'That did not generate.');
    } finally {
      setRunning(false);
      setProgress(0);
    }
  };

  const apply = (item: Made) => {
    if (readOnly) return;
    const toScreens = item.kind === 'screen';
    const targets = toScreens ? surfaces.screens : surfaces.panels;

    if (!targets.length) {
      toast(
        'info',
        toScreens
          ? 'There is no LED screen in this plan to put it on.'
          : 'There are no branding panels yet. Build an event with branding first.'
      );
      return;
    }
    for (const target of targets) {
      updateObject(
        target.id,
        (toScreens ? { contentUrl: item.url } : { imageUrl: item.url }) as Partial<SceneObject>
      );
    }
    toast('success', `Applied to ${targets.length} ${targets.length === 1 ? 'surface' : 'surfaces'}.`, {
      label: 'Undo',
      onClick: () => useEditor.getState().undo(),
    });
  };

  const upload = (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      toast('error', 'That image is over 8 MB. Use a smaller one.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setMade((prev) => [{ url: String(reader.result), kind }, ...prev].slice(0, 16));
    reader.readAsDataURL(file);
  };

  const shown = made.filter((m) => filter === 'all' || m.kind === filter);

  return (
    <div className="space-y-3">
      <div className="ai-card">
        <h3 className="ai-card-title">AI Artwork Generation</h3>
        <p className="ai-card-note">Create logos, banners, posters, and more for your event.</p>

        <div className="mt-3 flex gap-1.5">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !running) generate();
            }}
            placeholder="Create a luxury event logo with gold and black theme"
            className="ai-input min-w-0 flex-1"
          />
          <button type="button" className="ai-btn-primary shrink-0" onClick={generate} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {running ? `${progress}%` : 'Generate'}
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {KINDS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`ai-pill border ${kind === entry.id ? 'ai-pill-active border-primary' : 'border-line'}`}
              onClick={() => setKind(entry.id)}
              title={`${entry.label} · ${entry.aspect}`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {designBrief?.paletteHex?.length ? (
          <p className="ai-card-note flex items-center gap-1.5">
            Matching the plan's palette
            {designBrief.paletteHex.map((hex) => (
              <span
                key={hex}
                className="inline-block h-3 w-3 rounded-full border border-line"
                style={{ background: hex }}
                title={hex}
              />
            ))}
          </p>
        ) : null}

        <label className="mt-2 flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2 text-[11px] text-ink-muted hover:border-primary hover:text-primary">
          <Upload className="h-3.5 w-3.5" />
          Use your own image instead
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
            }}
          />
        </label>
      </div>

      {made.length ? (
        <>
          <div className="flex flex-wrap gap-1 px-1">
            {(['all', 'logo', 'poster', 'banner', 'screen'] as Kind[]).map((id) => (
              <button
                key={id}
                type="button"
                className={`ai-pill border ${filter === id ? 'ai-pill-active border-primary' : 'border-line'}`}
                onClick={() => setFilter(id)}
              >
                {id === 'all' ? 'All' : KINDS.find((k) => k.id === id)?.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {shown.map((item) => (
              <figure key={item.url} className="overflow-hidden rounded-xl border border-line bg-surface">
                <img
                  src={item.url}
                  alt=""
                  className="aspect-square w-full bg-surface-sunken object-contain"
                  loading="lazy"
                />
                <figcaption className="flex items-center gap-1 border-t border-line p-1.5">
                  <span className="min-w-0 flex-1 truncate text-[10px] capitalize text-ink-muted">
                    {item.kind}
                  </span>
                  <button
                    type="button"
                    className="ai-btn px-2 py-1 text-[10px]"
                    onClick={() => apply(item)}
                    disabled={readOnly}
                  >
                    <Check className="h-3 w-3" /> Put it on
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      ) : (
        <div className="ai-card flex flex-col items-center py-8 text-center">
          <ImageIcon className="h-6 w-6 text-ink-subtle" />
          <p className="mt-2 text-[12px] font-semibold text-ink">No artwork yet</p>
          <p className="mt-0.5 max-w-[220px] text-[11px] leading-relaxed text-ink-muted">
            {surfaces.panels.length || surfaces.screens.length
              ? `This plan has ${surfaces.panels.length} branding ${
                  surfaces.panels.length === 1 ? 'panel' : 'panels'
                } and ${surfaces.screens.length} ${
                  surfaces.screens.length === 1 ? 'screen' : 'screens'
                } waiting for it.`
              : 'Build an event with branding and the surfaces appear here.'}
          </p>
        </div>
      )}
    </div>
  );
}
