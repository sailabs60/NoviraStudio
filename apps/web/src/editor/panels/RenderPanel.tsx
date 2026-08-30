import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Download, Image as ImageIcon, Sparkles, X, Zap } from 'lucide-react';
import { STILL_PRESETS } from '@novira/shared';
import { useEditor } from '../editorStore';
import { captureAtSize, maxRenderSize, rendererAvailable, saveDataUrl } from '../highResCapture';
import { pollJob, spatial, type AiJobLike } from '../../lib/spatialApi';
import {
  EmptyState,
  Field,
  ProgressBar,
  Section,
  Segmented,
  Select,
  Stat,
  TextInput,
  toast,
} from '../../components/ui';

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
 * simulation is accurate.
 */
export function RenderPanel() {
  const planId = useEditor((s) => s.planId);
  const title = useEditor((s) => s.title);
  const render = useEditor((s) => s.scene.render);
  const setRender = useEditor((s) => s.setRender);

  const queryClient = useQueryClient();
  const [preset, setPreset] = useState(STILL_PRESETS[0]!.key);
  const [style, setStyle] = useState<'photoreal' | 'editorial' | 'night-event' | 'daylight'>('photoreal');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<null | 'fast' | 'pro'>(null);
  const [job, setJob] = useState<AiJobLike | null>(null);
  const [lastFast, setLastFast] = useState<{ dataUrl: string; width: number; height: number; clamped: boolean } | null>(null);

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

  const renderFast = () => {
    if (!rendererAvailable()) {
      toast('error', 'The 3D view is not ready yet. Wait for the scene to finish loading.');
      return;
    }
    setBusy('fast');
    // A frame, so the button's pressed state paints before the renderer blocks
    // the main thread for a second at 4K.
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
    try {
      /*
       * The frame sent to the model is deliberately not 4K. Image models take a
       * fixed input size and downscale anyway, so sending a 4K frame costs
       * upload time and buys nothing — the model's own output resolution is
       * what determines the result.
       */
      const frame = captureAtSize(1920, 1080, 'image/jpeg', 0.94);
      if (!frame) {
        toast('error', 'Could not read the frame.');
        return;
      }

      const started = await spatial.ai.proRender({
        imageDataUrl: frame.dataUrl,
        planId,
        style,
        prompt: prompt.trim() || undefined,
      });
      setJob(started);

      const finished = await pollJob(started.id, setJob, { intervalMs: 2500 });
      setJob(finished);

      if (finished.status === 'completed') {
        toast('success', 'Pro render finished.');
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

  return (
    <>
      <Section
        title="Fast render"
        description="The 3D view, drawn at any size. Free, instant, and exactly what is on screen."
      >
        <Field label="Size" help={`This machine's graphics can render up to about ${maxRenderSize()} pixels on the long edge.`}>
          <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
            {STILL_PRESETS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label} — {option.note}
              </option>
            ))}
          </Select>
        </Field>

        <button type="button" className="ed-action-primary w-full justify-center" onClick={renderFast} disabled={busy !== null}>
          <Zap className="h-3.5 w-3.5" /> {busy === 'fast' ? 'Rendering…' : `Render ${chosen.label.split(' ')[0]}`}
        </button>

        {lastFast ? (
          <div className="mt-2">
            <img
              src={lastFast.dataUrl}
              alt="The latest fast render"
              className="w-full rounded-lg border border-line"
            />
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

      <Section
        title="Pro render"
        help="Takes the frame from the viewport and hands it to an image model, with instructions to keep the geometry exactly and improve only materials, lighting and realism."
      >
        {proCapability && !proCapability.allowed ? (
          <div className="notice-warning mb-2 text-[11px] leading-snug">
            {proCapability.reason ?? 'Not available on this account.'}
          </div>
        ) : null}

        <Segmented
          label="Look"
          value={style}
          columns={2}
          options={[
            { value: 'photoreal', label: 'Photoreal', hint: 'Natural contrast, as though shot on a full-frame camera.' },
            { value: 'editorial', label: 'Editorial', hint: 'Deep shadows and one strong light direction.' },
            { value: 'night-event', label: 'Night event', hint: 'Practicals do the lighting, haze in the beams.' },
            { value: 'daylight', label: 'Daylight', hint: 'Flat, even, as a hall reads at midday.' },
          ]}
          onChange={setStyle}
        />

        <Field label="Anything to add" hint="Optional. Materials, atmosphere, time of day — not layout changes, which it is told to leave alone.">
          <TextInput
            value={prompt}
            placeholder="Polished concrete floor, evening light"
            onChange={(e) => setPrompt(e.target.value)}
          />
        </Field>

        <button
          type="button"
          className="ed-action-primary w-full justify-center"
          onClick={() => void renderPro()}
          disabled={busy !== null || (proCapability ? !proCapability.allowed : false)}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {busy === 'pro' ? 'Rendering…' : `Pro render${proCapability?.cost ? ` · ${proCapability.cost} credits` : ''}`}
        </button>

        {job && (job.status === 'queued' || job.status === 'in_progress') ? (
          <div className="mt-2">
            <ProgressBar value={job.progress} label="Working" />
            <button
              type="button"
              className="ed-action mt-1 w-full justify-center"
              onClick={() => {
                void spatial.ai.cancel(job.id).then(() => {
                  setJob(null);
                  setBusy(null);
                  toast('info', 'Cancelled. Your credits have been returned.');
                });
              }}
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        ) : null}

        <p className="field-hint mt-2">
          The layout in a pro render is exact — it comes from your plan. The realism is generated by an image model, so
          it is not a physically accurate lighting simulation. Say so if a client asks.
        </p>
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
