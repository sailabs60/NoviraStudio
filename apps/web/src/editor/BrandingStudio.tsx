/**
 * Branding: making the artwork, and putting it on the event.
 *
 * A generated event arrives with its branding surfaces already in place — six
 * banners on the walls, an LED wall over the stage — and every one of them
 * blank. This is where they get filled.
 *
 * The important design decision is that **generating and applying are one
 * step**. An image generator that produces a logo and leaves it in a gallery
 * has done the easy half: the work the user actually wanted was "put our brand
 * on this event", and carrying a PNG back to six banners by hand is the part
 * that made the old studio useless. So every result here has one button, and
 * that button puts it on the surfaces it belongs on.
 *
 * ## What gets generated
 *
 * Three kinds, because they are three different jobs:
 *
 *   · **A logo** is a mark on a transparent ground, square, meant to be small
 *     and legible on a banner or a lectern.
 *   · **Screen content** fills an LED wall, so it is wide, dark-friendly, and
 *     composed for something 9 m across seen from 20 m away.
 *   · **A banner** is portrait, printed, and read from a few metres.
 *
 * The prompts differ accordingly. Asking one generator for "a logo" and then
 * stretching it across a 16:9 wall is how the old flow produced things nobody
 * could use.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Image as ImageIcon, Loader2, Palette, Sparkles, Upload, X } from 'lucide-react';
import type { SceneObject } from '@novira/shared';
import { useEditor } from './editorStore';
import { pollJob } from '../lib/spatialApi';
import { studio } from '../lib/studioApi';
import { toast } from '../components/ui';

type Kind = 'logo' | 'screen' | 'banner';

const KINDS: Array<{
  id: Kind;
  label: string;
  note: string;
  aspect: string;
  /** Turned into the generator's instruction; the user's words go inside it. */
  frame: (subject: string, palette: string) => string;
}> = [
  {
    id: 'logo',
    label: 'Logo',
    note: 'A mark for banners, lecterns and print',
    aspect: '1:1',
    frame: (subject, palette) =>
      `A clean, flat vector event logo for ${subject}. Centred on a plain white background, generous margin, ` +
      `no mockup, no photograph, no 3D, no drop shadow. Simple geometric mark with the wordmark beneath it. ` +
      `${palette} High contrast, legible when printed 200 mm wide.`,
  },
  {
    id: 'screen',
    label: 'Screen content',
    note: 'Artwork for the LED wall behind the stage',
    aspect: '16:9',
    frame: (subject, palette) =>
      `Wide-format stage screen artwork for ${subject}. Designed to be seen from twenty metres: a dark ground, ` +
      `one strong focal idea, large type if any, deep saturated colour, plenty of empty space at the edges so a ` +
      `lectern and speakers do not cover anything important. ${palette} No borders, no watermark, no frame.`,
  },
  {
    id: 'banner',
    label: 'Banner',
    note: 'A printed panel for the walls',
    aspect: '9:16',
    frame: (subject, palette) =>
      `A tall printed event banner for ${subject}. Portrait format, read from three metres: bold heading at the ` +
      `top third, clear open lower half, flat colour blocking rather than photography. ${palette} ` +
      `No mockup, no stand, no room around it — the artwork only, edge to edge.`,
  },
];

export function BrandingStudio({ onClose }: { onClose: () => void }) {
  const scene = useEditor((s) => s.scene);
  const updateObject = useEditor((s) => s.updateObject);
  const readOnly = useEditor((s) => s.readOnly);
  const planId = useEditor((s) => s.planId);

  const [kind, setKind] = useState<Kind>('logo');
  const [subject, setSubject] = useState('');
  const [palette, setPalette] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Array<{ url: string; kind: Kind; prompt: string }>>([]);

  const { data: capabilities } = useQuery({
    queryKey: ['studio-capabilities'],
    queryFn: () => studio.capabilities(),
    staleTime: 120_000,
  });
  const capability = capabilities?.access?.ai_mockup;

  /*
   * The surfaces in the plan that branding goes on.
   *
   * Counted live, because the whole point is to say "this will land on six
   * banners and one screen" *before* the click, rather than reporting it
   * afterwards.
   */
  const surfaces = useMemo(() => {
    const artwork = scene.objects.filter((o) => o.type === 'artwork');
    const screens = scene.objects.filter((o) => o.type === 'led');
    const branded = scene.objects.filter(
      (o) => (o as SceneObject & { assemblyRole?: string }).assemblyRole === 'branding'
    );
    return { artwork, screens, branded };
  }, [scene.objects]);

  const targetCount = kind === 'screen' ? surfaces.screens.length : surfaces.artwork.length;

  const generate = async () => {
    if (!subject.trim()) {
      toast('error', 'Say what the event is, so the artwork is about something.');
      return;
    }
    const entry = KINDS.find((k) => k.id === kind)!;
    const paletteLine = palette.trim()
      ? `Use this colour palette and nothing outside it: ${palette.trim()}.`
      : '';
    const prompt = entry.frame(subject.trim(), paletteLine);

    setRunning(true);
    setProgress(4);
    try {
      const started = await studio.mockup({
        prompt,
        aspectRatio: entry.aspect,
        size: '2K',
        // The framing above is already specific; a refinement pass tends to
        // add the photographic language these three kinds exist to avoid.
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
      setResults((prev) => [{ url, kind, prompt }, ...prev].slice(0, 12));
      toast('success', `${entry.label} ready. Put it on the event when you are happy with it.`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'That did not generate.');
    } finally {
      setRunning(false);
      setProgress(0);
    }
  };

  /**
   * Put an image onto every surface it belongs on.
   *
   * This is the step the old studio was missing. Screen content goes on LED
   * walls; logos and banner artwork go on the printed panels. Each object is
   * updated individually and goes through undo, so one press is reversible and
   * nothing else in the plan is touched.
   */
  const applyToScene = (url: string, forKind: Kind) => {
    if (readOnly) return;
    let applied = 0;

    if (forKind === 'screen') {
      for (const screen of surfaces.screens) {
        updateObject(screen.id, { contentUrl: url } as Partial<SceneObject>);
        applied += 1;
      }
    } else {
      for (const panel of surfaces.artwork) {
        updateObject(panel.id, { imageUrl: url } as Partial<SceneObject>);
        applied += 1;
      }
    }

    if (!applied) {
      toast(
        'info',
        forKind === 'screen'
          ? 'There is no LED screen in this plan to put it on.'
          : 'There are no branding panels in this plan yet. Build an event with branding first.'
      );
      return;
    }
    toast('success', `Applied to ${applied} ${applied === 1 ? 'surface' : 'surfaces'}.`, {
      label: 'Undo',
      onClick: () => useEditor.getState().undo(),
    });
  };

  return (
    <div className="pointer-events-none fixed inset-y-0 right-0 z-[70] flex w-full max-w-[520px] flex-col p-3">
      <div className="panel pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden shadow-2xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
          <Palette className="h-4 w-4 text-primary" />
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">Branding</h2>
          <button type="button" className="icon-btn-bare h-7 w-7" onClick={onClose} aria-label="Close branding">
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="space-y-3">
            {capability && !capability.allowed ? (
              <div className="notice-warning text-[11px] leading-snug">
                {capability.reason ?? 'Image generation is not available on this account.'}
              </div>
            ) : null}

            <div className="ed-segment w-full">
              {KINDS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`ed-segment-btn flex-1 ${kind === entry.id ? 'is-active' : ''}`}
                  onClick={() => setKind(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] leading-snug text-ink-muted">{KINDS.find((k) => k.id === kind)!.note}</p>

            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-ink-muted">
                What is the event
              </span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Meridian Technology Summit 2026"
                className="ed-input w-full text-[12px]"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-ink-muted">
                Colours (optional)
              </span>
              <input
                value={palette}
                onChange={(e) => setPalette(e.target.value)}
                placeholder="deep blue and white"
                className="ed-input w-full text-[12px]"
              />
            </label>

            <button
              type="button"
              className="ed-action-primary w-full justify-center"
              onClick={generate}
              disabled={running || readOnly}
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {running ? `Generating… ${progress}%` : `Generate ${KINDS.find((k) => k.id === kind)!.label.toLowerCase()}`}
            </button>

            <p className="text-[10px] leading-snug text-ink-muted">
              {targetCount > 0
                ? `This plan has ${targetCount} ${kind === 'screen' ? (targetCount === 1 ? 'screen' : 'screens') : targetCount === 1 ? 'branding panel' : 'branding panels'} ready for it.`
                : kind === 'screen'
                  ? 'No LED screen in this plan yet.'
                  : 'No branding panels in this plan yet — build an event with branding and they appear here.'}
            </p>

            {results.length ? (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">Generated</p>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {results.map((result) => (
                    <figure key={result.url} className="overflow-hidden rounded border border-line">
                      <img
                        src={result.url}
                        alt=""
                        className="aspect-video w-full bg-surface-sunken object-contain"
                        loading="lazy"
                      />
                      <figcaption className="flex items-center gap-1 border-t border-line p-1.5">
                        <span className="min-w-0 flex-1 truncate text-[10px] capitalize text-ink-muted">
                          {result.kind}
                        </span>
                        <button
                          type="button"
                          className="ed-action h-6 px-1.5 text-[10px]"
                          onClick={() => applyToScene(result.url, result.kind)}
                          disabled={readOnly}
                        >
                          <Check className="h-3 w-3" />
                          Put it on
                        </button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ) : null}

            <UploadOwn onApply={applyToScene} kind={kind} readOnly={readOnly} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Using a brand's own artwork.
 *
 * Most events have a logo already, and generating a new one for them would be
 * both wrong and insulting. This is the path that matters most in practice, so
 * it is not hidden behind the generator.
 */
function UploadOwn({
  onApply,
  kind,
  readOnly,
}: {
  onApply: (url: string, kind: Kind) => void;
  kind: Kind;
  readOnly: boolean;
}) {
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => () => setImage(null), []);

  const pick = (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      toast('error', 'That image is over 8 MB. Use a smaller one.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <div className="rounded border border-line p-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">Use your own</p>
      <p className="mt-0.5 text-[10px] leading-snug text-ink-muted">
        Most events already have a logo. Put it straight on.
      </p>

      <label className="mt-2 flex cursor-pointer items-center justify-center gap-1.5 rounded border border-dashed border-line py-3 text-[11px] text-ink-muted hover:border-primary hover:text-primary">
        <Upload className="h-3.5 w-3.5" />
        Choose an image
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pick(file);
          }}
        />
      </label>

      {image ? (
        <div className="mt-2 flex items-center gap-2">
          <img src={image} alt="" className="h-10 w-10 rounded border border-line object-contain" />
          <button
            type="button"
            className="ed-action-primary flex-1 justify-center"
            onClick={() => onApply(image, kind)}
            disabled={readOnly}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Put it on the event
          </button>
        </div>
      ) : null}
    </div>
  );
}
