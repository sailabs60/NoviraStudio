import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Check,
  ChevronRight,
  Download,
  Expand,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  ShieldCheck,
  Star,
  Upload,
  Zap,
} from 'lucide-react';
import { STILL_PRESETS } from '@novira/shared';
import { useEditor } from '../editorStore';
import { captureAtSize, maxRenderSize, rendererAvailable, saveDataUrl } from '../highResCapture';
import { pollJob, spatial, type AiJobLike } from '../../lib/spatialApi';
import { AiProgress } from '../../components/AiProgress';
import { EmptyState, Field, Section, Select, Stat, toast } from '../../components/ui';
import { ImportFlow } from '../ImportFlow';

type Subject = 'stage' | 'truss' | 'led' | 'stands' | 'tents' | 'branding';

const SUBJECTS: Array<{
  value: Subject;
  label: string;
  photo: string;
  title: string;
  description: string;
  /** Folded into the prompt sent to the image model. */
  cue: string;
}> = [
  {
    value: 'stage',
    label: 'Stage',
    photo: '/build/stage.jpg',
    title: 'Stage Model',
    description: 'A professional stage setup with truss, LED screens and lighting.',
    cue: 'a professional event stage with truss, LED screens and stage lighting',
  },
  {
    value: 'truss',
    label: 'Truss',
    photo: '/build/truss.jpg',
    title: 'Truss Model',
    description: 'A goalpost and grid truss structure, ready to be rigged.',
    cue: 'aluminium box-truss structure, goalposts and spans, ready to be rigged',
  },
  {
    value: 'led',
    label: 'LED',
    photo: '/build/led.jpg',
    title: 'LED Screen',
    description: 'A large outdoor LED wall built from real cabinets.',
    cue: 'a large outdoor LED video wall on truss supports, vivid content on screen',
  },
  {
    value: 'stands',
    label: 'Stands',
    photo: '/build/stands.jpg',
    title: 'Line Array Stands',
    description: 'Line array speaker stacks on ground-supported stands.',
    cue: 'professional line-array speaker stacks on ground-supported stands',
  },
  {
    value: 'tents',
    label: 'Tents & drapes',
    photo: '/build/tents.jpg',
    title: 'Tent & Drape',
    description: 'A framed tent with pleated drape and dressed tables.',
    cue: 'a white framed marquee tent with pleated drape, dressed tables inside',
  },
  {
    value: 'branding',
    label: 'Branding',
    photo: '/build/branding.jpg',
    title: 'Branding Display',
    description: 'A branded backdrop with feather flags either side.',
    cue: 'a branded step-and-repeat backdrop with feather flags either side',
  },
];

/**
 * Renders.
 *
 * Two modes, and the panel is honest about what each one is:
 *
 * **Fast** is the viewport, drawn at whatever resolution you ask for. It costs
 * nothing, takes a second, and is exactly what is on screen — which makes it
 * the right thing for a working image, a layout check, or a slide.
 *
 * **Pro** hands that frame to an image model with instructions to preserve the
 * geometry and improve only materials, light and realism. It costs credits and
 * takes a minute. The layout is exact because it comes from the viewport; the
 * realism is generated. That distinction is stated plainly here rather than
 * left for someone to discover when a client asks whether the lighting
 * simulation is accurate. The subject picker below sets what the render is
 * of and folds a matching cue into the prompt — the style options that used
 * to sit here are still exactly what is sent, just chosen by picture instead
 * of by name.
 */
export function RenderPanel() {
  const planId = useEditor((s) => s.planId);
  const title = useEditor((s) => s.title);
  const render = useEditor((s) => s.scene.render);
  const setRender = useEditor((s) => s.setRender);

  const queryClient = useQueryClient();
  const [preset, setPreset] = useState(STILL_PRESETS[0]!.key);
  const [subject, setSubject] = useState<Subject>('stage');
  const [busy, setBusy] = useState<null | 'fast' | 'pro'>(null);
  const [job, setJob] = useState<AiJobLike | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [lastFast, setLastFast] = useState<{ dataUrl: string; width: number; height: number; clamped: boolean } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const { data: capabilities } = useQuery({
    queryKey: ['spatial-capabilities'],
    queryFn: () => spatial.ai.capabilities(),
    staleTime: 120_000,
  });

  const { data: media } = useQuery({
    queryKey: ['plan-media', planId],
    queryFn: () => spatial.ai.media(planId!),
    enabled: Boolean(planId),
    staleTime: 30_000,
  });

  const chosen = STILL_PRESETS.find((p) => p.key === preset) ?? STILL_PRESETS[0]!;
  const proCapability = capabilities?.pro_render;
  const chosenSubject = SUBJECTS.find((s) => s.value === subject) ?? SUBJECTS[0]!;
  const latestPro = media?.images[0];

  const renderFast = () => {
    if (!rendererAvailable()) {
      toast('error', 'The 3D view is not ready yet. Wait for the scene to finish loading.');
      return;
    }
    setBusy('fast');
    setStartedAt(Date.now());
    window.requestAnimationFrame(() => {
      try {
        const result = captureAtSize(chosen.width, chosen.height);
        if (!result) {
          toast('error', 'Could not read the frame. Try a smaller size.');
          return;
        }
        setLastFast(result);
        setRender({ exportWidth: result.width, exportHeight: result.height });
        if (result.clamped) {
          toast(
            'info',
            `Rendered at ${result.width} × ${result.height} — this machine's graphics cannot allocate the full size.`
          );
        }
      } finally {
        setBusy(null);
      }
    });
  };

  const renderPro = async () => {
    if (!planId) return;
    if (!rendererAvailable()) {
      toast('error', 'The 3D view is not ready yet.');
      return;
    }
    setBusy('pro');
    setStartedAt(Date.now());
    try {
      const frame = captureAtSize(1920, 1080, 'image/jpeg', 0.94);
      if (!frame) {
        toast('error', 'Could not read the frame.');
        return;
      }

      const started = await spatial.ai.proRender({
        imageDataUrl: frame.dataUrl,
        planId,
        style: 'photoreal',
        prompt: chosenSubject.cue,
      });
      setJob(started);

      const finished = await pollJob(started.id, setJob, { intervalMs: 2500 });
      setJob(finished);

      if (finished.status === 'completed') {
        toast('success', 'Render finished.');
        void queryClient.invalidateQueries({ queryKey: ['plan-media', planId] });
      } else if (finished.status === 'failed') {
        toast('error', finished.errorMessage ?? 'The render failed. Your credits have been returned.');
      }
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'The render could not be started.');
    } finally {
      setBusy(null);
    }
  };

  const rendering = busy === 'pro' || (job !== null && (job.status === 'queued' || job.status === 'in_progress'));

  return (
    <>
      <Section title="What are you rendering?">
        <div className="grid grid-cols-3 gap-2.5">
          {SUBJECTS.map((option) => {
            const active = option.value === subject;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSubject(option.value)}
                className={`group overflow-hidden rounded-xl border bg-surface text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  active ? 'border-primary shadow-sm' : 'border-line hover:border-line-strong'
                }`}
              >
                <span className="relative block aspect-[4/3] w-full overflow-hidden bg-surface-muted">
                  <img src={option.photo} alt="" className="h-full w-full object-cover" loading="lazy" />
                  {active ? (
                    <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-fg shadow-sm">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  ) : null}
                </span>
                <span className="block px-2 py-1.5 text-[11px] font-semibold text-ink">{option.label}</span>
              </button>
            );
          })}
        </div>

        <Field
          label="Size"
          help={`This machine's graphics can render up to about ${maxRenderSize()} pixels on the long edge for a fast render.`}
        >
          <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {STILL_PRESETS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label} — {option.note}
              </option>
            ))}
          </Select>
        </Field>

        {proCapability && !proCapability.allowed ? (
          <div className="notice-warning mb-2 text-[11px] leading-snug">
            {proCapability.reason ?? 'Not available on this account.'}
          </div>
        ) : null}

        <button
          type="button"
          className="ed-action-primary w-full justify-center bg-gradient-to-r from-primary to-info shadow-btn"
          onClick={() => void renderPro()}
          disabled={rendering || (proCapability ? !proCapability.allowed : false)}
        >
          {rendering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          {rendering ? 'Rendering…' : `Render ${chosen.label.split(' ')[0]}`}
          {proCapability?.cost ? <span className="opacity-80">· {proCapability.cost} credits</span> : null}
          {!rendering ? <ChevronRight className="h-3.5 w-3.5" /> : null}
        </button>

        {job && (job.status === 'queued' || job.status === 'in_progress') ? (
          <div className="mt-2">
            <AiProgress
              progress={job.progress}
              status={job.status}
              startedAt={startedAt ?? Date.now()}
              expectedMs={120_000}
              onCancel={() => {
                void spatial.ai.cancel(job.id).then(() => {
                  setJob(null);
                  setBusy(null);
                  toast('info', 'Cancelled. Your credits have been returned.');
                });
              }}
            />
          </div>
        ) : null}

        <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
          <FeatureBadge icon={<Zap className="h-3.5 w-3.5" />} label="Fast" note="High-quality renders" />
          <FeatureBadge icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Crystal clear" note="Stunning details" />
          <FeatureBadge icon={<Star className="h-3.5 w-3.5" />} label="Instant" note="No waiting time" />
        </div>
      </Section>

      <Section title="Preview">
        <div className="overflow-hidden rounded-xl bg-ink text-white">
          <div className="relative">
            <img
              src={latestPro?.url ?? chosenSubject.photo}
              alt={chosenSubject.title}
              className="aspect-[5/3] w-full object-cover"
            />
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 text-[10px] font-semibold backdrop-blur-sm">
              <ImageIcon className="h-3 w-3" /> Preview
            </span>
            {latestPro ? (
              <a
                href={latestPro.url}
                target="_blank"
                rel="noreferrer"
                className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm transition hover:bg-black/70"
                aria-label="Open full size"
              >
                <Expand className="h-3 w-3" />
              </a>
            ) : null}
          </div>
          <div className="p-3">
            <h4 className="text-[13px] font-bold">{latestPro ? 'Latest render' : chosenSubject.title}</h4>
            <p className="mt-0.5 text-[11px] leading-snug text-white/70">
              {latestPro
                ? (latestPro.prompt ?? chosenSubject.description)
                : chosenSubject.description}
            </p>
            <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-white/10 px-2.5 py-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/10">
                <ImageIcon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1 text-[11px] leading-tight">
                <span className="block font-semibold">{chosen.label}</span>
              </span>
              {latestPro ? (
                <a href={latestPro.url} download className="text-[10px] font-semibold text-white/80 hover:text-white">
                  <Download className="inline h-3 w-3" /> Save
                </a>
              ) : null}
            </div>
            <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-white/10 px-2.5 py-2 text-white">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <p className="text-[10px] leading-snug text-white/80">
                <span className="font-semibold text-white">Quick Tips</span> — for the best results, choose a higher
                resolution and keep your model well framed.
              </p>
            </div>
          </div>
        </div>
        <p className="field-hint mt-2">
          The layout in a render is exact — it comes from your plan. The realism is generated by an image model, so it
          is not a physically accurate lighting simulation. Say so if a client asks.
        </p>
      </Section>

      <Section title="Fast render" description="The 3D view, drawn at any size. Free, instant, and exactly what is on screen.">
        <button type="button" className="ed-action-primary w-full justify-center" onClick={renderFast} disabled={busy !== null}>
          <Zap className="h-3.5 w-3.5" /> {busy === 'fast' ? 'Rendering…' : `Render ${chosen.label.split(' ')[0]} from the viewport`}
        </button>

        {lastFast ? (
          <div className="mt-2">
            <img src={lastFast.dataUrl} alt="The latest fast render" className="w-full rounded-lg border border-line" />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] tabular-nums text-ink-subtle">
                {lastFast.width} × {lastFast.height}
                {lastFast.clamped ? ' (reduced to fit this GPU)' : ''}
              </span>
              <button
                type="button"
                className="ed-action"
                onClick={() => saveDataUrl(lastFast.dataUrl, `${title || 'novira-plan'}.png`)}
              >
                <Download className="h-3.5 w-3.5" /> Save
              </button>
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Need a custom design?" description="Upload your own images, logos or artwork to get started.">
        <button type="button" className="ed-action w-full justify-center border border-line" onClick={() => setImportOpen(true)}>
          <Upload className="h-3.5 w-3.5" /> Import Files
        </button>
        <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">Supported formats</p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {['JPG', 'PNG', 'SVG', 'PDF', 'AI'].map((format) => (
            <span
              key={format}
              className="rounded-full border border-line bg-surface-muted px-2.5 py-1 text-[10px] font-semibold text-ink-muted"
            >
              {format}
            </span>
          ))}
        </div>
        <ImportFlow open={importOpen} onClose={() => setImportOpen(false)} />
      </Section>

      <Section title={`Renders (${media?.images.length ?? 0})`}>
        {media?.images.length ? (
          <div className="grid grid-cols-2 gap-1.5">
            {media.images.map((image) => (
              <a
                key={image.id}
                href={image.url}
                target="_blank"
                rel="noreferrer"
                className="group relative overflow-hidden rounded-lg border border-line"
                title={image.prompt ?? undefined}
              >
                <img src={image.url} alt="" className="aspect-video w-full object-cover" loading="lazy" />
                <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-0.5 text-[9px] text-white opacity-0 transition group-hover:opacity-100">
                  {image.model ?? 'Render'} · {new Date(image.createdAt).toLocaleDateString()}
                </span>
              </a>
            ))}
          </div>
        ) : (
          <EmptyState
            compact
            icon={<ImageIcon className="h-5 w-5" />}
            title="No renders yet"
            description="Fast renders are saved to your device. Pro renders are kept here and go straight into a presentation deck."
          />
        )}
      </Section>

      <Section title="Export settings" collapsible defaultOpen={false}>
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Last size" value={`${render.exportWidth} × ${render.exportHeight}`} />
          <Stat label="GPU limit" value={`${maxRenderSize()} px`} help="The largest frame this machine's graphics will allocate." />
        </div>
        <p className="field-hint mt-2">
          <Camera className="mr-1 inline h-3 w-3" />
          Position the camera in the viewport first — a render is the view you are looking at.
        </p>
      </Section>
    </>
  );
}

function FeatureBadge({ icon, label, note }: { icon: React.ReactNode; label: string; note: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-line bg-surface px-1.5 py-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-primary">{icon}</span>
      <span className="text-[10px] font-bold text-ink">{label}</span>
      <span className="text-[9px] leading-tight text-ink-subtle">{note}</span>
    </div>
  );
}
