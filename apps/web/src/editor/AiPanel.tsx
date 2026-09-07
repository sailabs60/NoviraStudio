import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, EyeOff, Library, Loader2, Lock, Sparkles, Upload, Wand2, X } from 'lucide-react';
import { AiProgress } from '../components/AiProgress';
import { AiCreate } from './AiCreate';
import { http, ApiClientError } from '../lib/api';
import { useEditor } from './editorStore';
import { captureViewport } from './capture';
import { Modal } from '../components/Modal';
import { ImagePicker } from '../components/ImagePicker';

interface Capability {
  allowed: boolean;
  reason: string | null;
  cost: number;
  balance: number;
  requiredTier: string;
  provider: string;
}
type Capabilities = Record<string, Capability>;

interface Job {
  id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  creditsCharged: number;
  errorMessage: string | null;
  output: Record<string, unknown> | null;
}

/**
 * AI Enhance and Image to 3D.
 *
 * Both are long-running jobs, so the UI is built around waiting well: the cost
 * is stated before the click, progress is live, cancelling refunds, and a
 * failure explains itself and leaves the plan untouched. The render is shown as
 * a toggle over the viewport rather than replacing it, because the point is to
 * compare the render against the layout it came from.
 */
export function AiPanel() {
  const planId = useEditor((s) => s.planId);
  const readOnly = useEditor((s) => s.readOnly);

  const [open, setOpen] = useState<null | 'enhance' | 'to3d'>(null);
  const [prompt, setPrompt] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [render, setRender] = useState<string | null>(null);
  const [showRender, setShowRender] = useState(true);
  const [picking, setPicking] = useState(false);
  const [sourceImage, setSourceImage] = useState<string | null>(null);

  const { data: capabilities } = useQuery({
    queryKey: ['ai', 'capabilities'],
    queryFn: async () => (await http.get<Capabilities>('/ai/capabilities')).data,
  });

  const { data: renders } = useQuery({
    queryKey: ['ai', 'renders', planId],
    queryFn: async () =>
      (await http.get<{ items: Array<{ id: number; mediaUrl: string; prompt: string | null; createdAt: string }> }>(
        `/ai/plans/${planId}/renders`
      )).data.items,
    enabled: Boolean(planId),
  });

  // Poll while a job is running. Cheap, and reliable across a reload.
  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return;
    const timer = setInterval(async () => {
      try {
        const { data } = await http.get<Job>(`/ai/jobs/${job.id}`);
        setJob(data);
        if (data.status === 'completed') {
          const url = (data.output?.imageUrl ?? data.output?.modelUrl) as string | undefined;
          if (url && data.output?.imageUrl) {
            setRender(url);
            setShowRender(true);
          }
        }
        if (data.status === 'failed') setError(data.errorMessage ?? 'The job failed.');
      } catch {
        /* transient; the next tick retries */
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [job]);

  async function runEnhance() {
    setError(null);
    const image = captureViewport();
    if (!image) {
      setError('No canvas image available. Wait for the plan to finish rendering.');
      return;
    }
    try {
      const { data } = await http.post<Job>('/ai/enhance', {
        planId: planId ?? undefined,
        imageDataUrl: image,
        prompt: prompt.trim() || undefined,
      });
      setJob(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not start the render.');
    }
  }

  async function runImageTo3d() {
    setError(null);
    if (!sourceImage) {
      setError('Upload a photo first.');
      return;
    }
    try {
      const { data } = await http.post<Job>('/ai/image-to-3d', { imageDataUrl: sourceImage });
      setJob(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not start the generation.');
    }
  }

  async function cancel() {
    if (!job) return;
    try {
      const { data } = await http.post<Job>(`/ai/jobs/${job.id}/cancel`);
      setJob(data);
    } catch {
      /* the poll will reflect the real state */
    }
  }

  const qc = useQueryClient();

  /*
   * Saving a generated model was described in the copy above and had a working
   * endpoint, and there was no control anywhere that called it — so the panel
   * told people to set a height before saving, and then offered no way to save.
   */
  const [saveName, setSaveName] = useState('');
  const [saveCategory, setSaveCategory] = useState('decor');
  const [saveHeight, setSaveHeight] = useState(760);
  const [savedItemId, setSavedItemId] = useState<number | null>(null);

  const { data: categories } = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: async () =>
      (await http.get<{ items: Array<{ slug: string; name: string }> }>('/catalog/categories')).data.items,
    enabled: open === 'to3d',
  });

  const saveToCatalog = useMutation({
    mutationFn: async () =>
      (await http.post<{ id: number }>('/ai/save-to-catalog', {
        jobId: job?.id,
        name: saveName.trim(),
        description: 'Generated from a photograph.',
        categorySlug: saveCategory,
        targetHeightMm: saveHeight,
        scope: 'personal',
      })).data,
    onSuccess: (data) => {
      setSavedItemId(data.id);
      void qc.invalidateQueries({ queryKey: ['catalog'] });
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : 'Could not save that model.'),
  });

  const enhanceCap = capabilities?.ai_enhance;
  const to3dCap = capabilities?.ai_image_to_3d;
  const running = job && (job.status === 'queued' || job.status === 'in_progress');
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      {/*
        Two AI doors, side by side, because they are different jobs.

        "Create" makes an object that does not exist yet and puts it in the
        room. "Enhance" photographs the room as it stands. Putting them
        together makes the choice obvious; the generator used to be on a
        separate page, which is most of why nobody found it.
      */}
      <button
        type="button"
        className="ed-action"
        disabled={readOnly}
        title="Describe an object and place it in the plan"
        onClick={() => setCreateOpen(true)}
      >
        <Wand2 className="h-3.5 w-3.5" /> Create
      </button>

      <button type="button" className="ed-action-primary" disabled={readOnly}
        onClick={() => { setOpen('enhance'); setJob(null); setError(null); }}>
        <Sparkles className="h-3.5 w-3.5" /> AI Enhance
      </button>

      {createOpen ? <AiCreate onClose={() => setCreateOpen(false)} /> : null}

      {/* Render overlay, toggled against the live viewport. */}
      {render ? (
        <div className="pointer-events-none absolute inset-0 z-10">
          {showRender ? (
            <img src={render} alt="AI render" className="h-full w-full object-contain" />
          ) : null}
          <div className="pointer-events-auto absolute left-4 top-4 flex gap-1">
            <button type="button" className="ed-action bg-surface-strong/90 backdrop-blur"
              onClick={() => setShowRender((v) => !v)}>
              {showRender ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showRender ? 'Show plan' : 'Show render'}
            </button>
            <button type="button" className="ed-action bg-surface-strong/90 backdrop-blur"
              onClick={() => setRender(null)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      <Modal
        open={open === 'enhance'}
        title="AI Enhance"
        description="Turns the current view into a photoreal render, keeping the camera, geometry and layout as they are."
        onClose={() => setOpen(null)}
        width="max-w-lg"
        footer={
          running ? (
            <button type="button" className="btn-secondary" onClick={cancel}>
              Cancel and refund
            </button>
          ) : (
            <>
              <button type="button" className="btn-secondary mr-auto"
                onClick={() => {
          setOpen('to3d');
          setJob(null);
          setError(null);
          setSavedItemId(null);
        }}>
                Photo to 3D model
              </button>
              <button type="button" className="btn-secondary" onClick={() => setOpen(null)}>Close</button>
              <button type="button" className="btn-primary" disabled={!enhanceCap?.allowed}
                onClick={runEnhance}>
                Render · {enhanceCap?.cost ?? 0} credits
              </button>
            </>
          )
        }
      >
        {error ? <div className="notice-error mb-3">{error}</div> : null}

        {enhanceCap && !enhanceCap.allowed ? (
          <div className="notice-warning mb-3 flex gap-2">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{enhanceCap.reason}</span>
          </div>
        ) : null}

        {running ? (
          <JobProgress job={job!} label="Rendering" />
        ) : (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="ai-prompt">Extra direction (optional)</label>
              <textarea id="ai-prompt" className="input min-h-[70px] resize-y" value={prompt}
                placeholder="Warm evening light, candlelit tables, dark timber floor"
                onChange={(e) => setPrompt(e.target.value)} />
              <p className="mt-1 text-xs text-ink-subtle">
                The render is instructed to preserve your layout exactly — this only steers mood and materials.
              </p>
            </div>
            {enhanceCap ? (
              <p className="text-xs text-ink-subtle">
                {enhanceCap.cost} credits · you have {balanceLabel(enhanceCap.balance)} · provider {enhanceCap.provider}
              </p>
            ) : null}
          </div>
        )}

        {renders?.length ? (
          <div className="mt-4">
            <h4 className="ed-section-title">Previous renders</h4>
            <div className="grid grid-cols-3 gap-2">
              {renders.slice(0, 6).map((r) => (
                <button key={r.id} type="button" onClick={() => { setRender(r.mediaUrl); setShowRender(true); setOpen(null); }}
                  className="overflow-hidden rounded border border-line transition hover:border-primary/60">
                  <img src={r.mediaUrl} alt="" className="h-16 w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={open === 'to3d'}
        title="Photo to 3D model"
        description="Turns a photo of a real item into a model you can place and save to your catalogue."
        onClose={() => setOpen(null)}
        width="max-w-lg"
        footer={
          running ? (
            <button type="button" className="btn-secondary" onClick={cancel}>Cancel and refund</button>
          ) : (
            <>
              <button type="button" className="btn-secondary mr-auto" onClick={() => setOpen('enhance')}>Back</button>
              <button type="button" className="btn-primary" disabled={!to3dCap?.allowed || !sourceImage}
                onClick={runImageTo3d}>
                Generate · {to3dCap?.cost ?? 0} credits
              </button>
            </>
          )
        }
      >
        {error ? <div className="notice-error mb-3">{error}</div> : null}
        {to3dCap && !to3dCap.allowed ? (
          <div className="notice-warning mb-3 flex gap-2">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{to3dCap.reason}</span>
          </div>
        ) : null}

        {running ? (
          <JobProgress job={job!} label="Generating" />
        ) : job?.status === 'completed' && job.output?.modelUrl ? (
          <div className="space-y-3">
            <div className="notice-success">Model generated.</div>
            <p className="text-sm text-ink-muted">
              Measured at {String(job.output.detectedWidthMm)} × {String(job.output.detectedHeightMm)} mm as
              generated. Set its real height before saving it to the catalogue — a generated mesh has no
              inherent size.
            </p>

            {savedItemId ? (
              <div className="notice-success text-sm">
                Saved to your catalogue. It is searchable there now.
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-line p-3">
                <label className="block">
                  <span className="label">Name</span>
                  <input className="input" value={saveName} placeholder="Patio dining table"
                    onChange={(e) => setSaveName(e.target.value)} />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="label">Category</span>
                    <select className="input" value={saveCategory}
                      onChange={(e) => setSaveCategory(e.target.value)}>
                      {(categories ?? []).map((c) => (
                        <option key={c.slug} value={c.slug}>{c.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="label">Real height (mm)</span>
                    <input className="input" type="number" min={1} value={saveHeight}
                      onChange={(e) => setSaveHeight(Number(e.target.value))} />
                  </label>
                </div>

                <p className="text-[11px] leading-snug text-ink-subtle">
                  The mesh is scaled to this height, and its width and depth follow. Getting it
                  right matters more than it sounds — everything placed beside it is to scale.
                </p>

                <div className="flex gap-2">
                  <a href={String(job.output.modelUrl)} download className="btn-secondary flex-1 justify-center">
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                  <button type="button" className="btn-primary flex-1 justify-center"
                    disabled={!saveName.trim() || saveHeight <= 0 || saveToCatalog.isPending}
                    onClick={() => saveToCatalog.mutate()}>
                    {saveToCatalog.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Library className="h-3.5 w-3.5" />
                    )}
                    Save to catalogue
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <button type="button" className="btn-secondary w-full" onClick={() => setPicking(true)}>
              <Upload className="h-4 w-4" /> {sourceImage ? 'Choose a different photo' : 'Choose a photo'}
            </button>
            {sourceImage ? (
              <img src={sourceImage} alt="Source" className="max-h-48 w-full rounded-lg object-contain" />
            ) : null}
            <ul className="space-y-1 text-xs text-ink-subtle">
              <li>Use a plain or solid-colour background.</li>
              <li>One object, filling most of the frame.</li>
              <li>Avoid text overlays and reflections.</li>
            </ul>
            {to3dCap ? (
              <p className="text-xs text-ink-subtle">
                {to3dCap.cost} credits · you have {balanceLabel(to3dCap.balance)} · provider {to3dCap.provider}
              </p>
            ) : null}
          </div>
        )}

        <ImagePicker
          open={picking}
          onClose={() => setPicking(false)}
          onPick={(image) => setSourceImage(image.url)}
          title="Choose a photo to model"
          description="Upload one, paste a link, or search the image libraries."
          initialQuery="product photography"
        />
      </Modal>
    </>
  );
}

/**
 * The running job.
 *
 * A bare percentage was the whole problem: it told the user something was
 * happening and nothing about what, so a slow phase was indistinguishable
 * from a hang. `AiProgress` names the stage, shows the clock, and says so
 * out loud once a job passes the time these normally take.
 *
 * The start time is taken from the first render rather than threaded through
 * every caller — the panel mounts this the moment a job begins, so they are
 * the same instant to within a frame.
 */
/**
 * How many credits the user has, in words a person would use.
 *
 * The server reports an unlimited allowance as `Number.MAX_SAFE_INTEGER`,
 * which is a fine sentinel and a terrible thing to print — the dialog was
 * telling super admins they had 9,007,199,254,740,991 credits. Anything near
 * that ceiling is unlimited; everything else is a real number worth showing.
 */
function balanceLabel(balance: number): string {
  if (!Number.isFinite(balance) || balance >= Number.MAX_SAFE_INTEGER / 2) return 'unlimited credits';
  return `${balance.toLocaleString()} credits`;
}

function JobProgress({ job, label }: { job: Job; label: string }) {
  const [startedAt] = useState(() => Date.now());
  return (
    <div className="py-3">
      <AiProgress
        progress={job.progress}
        status={job.status}
        startedAt={startedAt}
        // Both of this panel's jobs are provider round trips of roughly this
        // length; past 1.6x it says it is slow rather than leaving a silence.
        expectedMs={120_000}
        note={
          job.creditsCharged > 0
            ? `Cancelling refunds the ${job.creditsCharged} credits already charged.`
            : 'You can keep working — this finishes in the background.'
        }
      />
      <p className="mt-1.5 text-[10px] text-ink-subtle">{label}</p>
    </div>
  );
}
