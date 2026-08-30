import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Boxes,
  CircleSlash,
  Image as ImageIcon,
  Loader2,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { PageBanner } from '../components/PageBanner';
import { Modal } from '../components/Modal';
import { EmptyState, ProgressBar, Section, Segmented, Select, Toggle, toast } from '../components/ui';
import { HoverModel, ModelPreview, type PreviewSubject } from '../editor/ModelPreview';
import { studio, type AiJobLike, type Creation } from '../lib/studioApi';
import { assets } from '../lib/assetsApi';
import { ImagePicker } from '../components/ImagePicker';

/**
 * The AI studio.
 *
 * Three generators and one library, and the thing that makes them a studio
 * rather than three buttons is that **the output of one is the input of the
 * next**. A written idea becomes a refined prompt. A prompt becomes an image.
 * An image becomes a mesh. A mesh goes into a plan. Each step is a click from
 * the one before it, and the session's history travels along so "now in walnut"
 * still means the same chair four steps later.
 *
 * Two honesty rules run through the interface:
 *
 *  · **The cost is stated before the click**, every time, and a failure refunds
 *    without anyone asking.
 *  · **The refined prompt is shown, not hidden.** A designer who cannot see
 *    what was actually sent cannot learn to ask better, and a tool that quietly
 *    rewrites your words is a tool you stop trusting.
 */

const STYLES = ['Modern', 'Corporate', 'Luxury', 'Minimal', 'Industrial', 'Futuristic'] as const;

type Mode = 'model' | 'image';

export function AiStudioPage() {
  const [mode, setMode] = useState<Mode>('model');
  const queryClient = useQueryClient();

  const { data: capabilities } = useQuery({
    queryKey: ['studio', 'capabilities'],
    queryFn: () => studio.capabilities(),
    staleTime: 60_000,
  });

  const { data: creations = [], isLoading: loadingCreations } = useQuery({
    queryKey: ['studio', 'creations'],
    queryFn: () => studio.creations(),
    staleTime: 15_000,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['studio', 'creations'] });
    void queryClient.invalidateQueries({ queryKey: ['studio', 'capabilities'] });
  }, [queryClient]);

  const providers = capabilities?.providers;

  return (
    <AppShell>
      <PageBanner
        slot="ai-studio-hero"
        title="AI studio"
        lead="Describe something and get a model you can place, or an image you can put in front of a client. Everything generated here lands in your library and keeps working when the provider's links expire."
      />

      {providers ? <ProviderNotice providers={providers} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <div>
          <div className="ed-segment mb-4 w-full">
            <button
              type="button"
              onClick={() => setMode('model')}
              className={`ed-segment-btn flex flex-1 items-center justify-center gap-1.5 py-2 ${
                mode === 'model' ? 'ed-segment-btn-active' : ''
              }`}
            >
              <Boxes className="h-3.5 w-3.5" /> 3D model
            </button>
            <button
              type="button"
              onClick={() => setMode('image')}
              className={`ed-segment-btn flex flex-1 items-center justify-center gap-1.5 py-2 ${
                mode === 'image' ? 'ed-segment-btn-active' : ''
              }`}
            >
              <ImageIcon className="h-3.5 w-3.5" /> 2D mockup
            </button>
          </div>

          {mode === 'model' ? (
            <ModelGenerator capabilities={capabilities} onFinished={refresh} />
          ) : (
            <MockupGenerator capabilities={capabilities} onFinished={refresh} />
          )}
        </div>

        <Vault creations={creations} loading={loadingCreations} onChanged={refresh} />
      </div>
    </AppShell>
  );
}

/* ── What is available ─────────────────────────────────────────────────── */

function ProviderNotice({
  providers,
}: {
  providers: NonNullable<Awaited<ReturnType<typeof studio.capabilities>>>['providers'];
}) {
  const missing = Object.entries(providers).filter(([, state]) => !state.available);
  if (!missing.length) return null;

  return (
    <div className="notice-warning mb-5 flex items-start gap-2.5">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 text-[13px] leading-relaxed">
        <p className="font-semibold">Some generators are not configured on this server.</p>
        <ul className="mt-1 space-y-0.5">
          {missing.map(([key, state]) => (
            <li key={key}>
              <strong className="font-semibold">{state.name}</strong> — {state.reason}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ── The 3D generator ──────────────────────────────────────────────────── */

function ModelGenerator({
  capabilities,
  onFinished,
}: {
  capabilities: Awaited<ReturnType<typeof studio.capabilities>> | undefined;
  onFinished: () => void;
}) {
  const [source, setSource] = useState<'text' | 'image'>('text');
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<(typeof STYLES)[number]>('Modern');
  const [refine, setRefine] = useState(true);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [job, setJob] = useState<AiJobLike | null>(null);
  const [refining, setRefining] = useState(false);
  const [picking, setPicking] = useState(false);

  const access = capabilities?.access.ai_text_to_3d;
  const imageAccess = capabilities?.access.ai_image_to_3d;
  const available = capabilities?.providers.mesh.available ?? true;
  const running = job?.status === 'queued' || job?.status === 'in_progress';

  const refinePrompt = async () => {
    if (prompt.trim().length < 4) {
      toast('info', 'Write a few words first — even three or four is enough to work from.');
      return;
    }
    setRefining(true);
    try {
      const result = await studio.refine({ prompt: prompt.trim(), kind: '3d' });
      setPrompt(result.prompt);
      toast(
        result.changed ? 'success' : 'info',
        result.changed ? 'Expanded into a full prompt. Edit it freely before generating.' : 'That was already a good prompt.'
      );
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'The prompt could not be refined.');
    } finally {
      setRefining(false);
    }
  };

  const generate = async () => {
    try {
      const started =
        source === 'image'
          ? await studio.imageTo3d({ imageUrl: imageDataUrl!, prompt: prompt.trim() || undefined })
          : await studio.textTo3d({ prompt: prompt.trim(), style, refine });
      setJob(started);

      const finished = await studio.wait(started.id, setJob);
      setJob(finished);
      onFinished();

      if (finished.status === 'completed') {
        toast('success', 'Model generated. It is in your library and ready to place.');
      } else if (finished.status === 'failed') {
        toast('error', finished.errorMessage ?? 'The generation failed. Your credits have been returned.');
      }
    } catch (error) {
      setJob(null);
      toast('error', error instanceof Error ? error.message : 'That could not be started.');
    }
  };

  const canGenerate =
    available &&
    !running &&
    (source === 'text' ? prompt.trim().length > 3 : Boolean(imageDataUrl));

  return (
    <div className="panel p-5">
      <Segmented
        label="Build it from"
        value={source}
        columns={2}
        options={[
          { value: 'text', label: 'A description', hint: 'Say what it is; the model builds it.' },
          { value: 'image', label: 'A photograph', hint: 'One clear picture of the object, plain background.' },
        ]}
        onChange={(value) => setSource(value as 'text' | 'image')}
      />

      {source === 'text' ? (
        <>
          <div className="mt-4">
            <label className="label" htmlFor="studio-prompt">
              What should it be?
            </label>
            <textarea
              id="studio-prompt"
              className="input min-h-[110px] resize-y"
              placeholder="A reception counter in pale oak with a brushed steel base and a recessed light under the lip"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <p className="field-hint">
              Name the object, then its materials and finish. Size is not needed — Novira measures what comes back and
              you set the real dimensions when you place it.
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {STYLES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setStyle(option)}
                className={`chip ${style === option ? 'chip-active' : ''}`}
              >
                {option}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn-secondary mt-3 w-full justify-center"
            onClick={refinePrompt}
            disabled={refining || running}
          >
            {refining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {refining ? 'Writing it out…' : 'Expand this into a full prompt'}
          </button>

          <div className="mt-3">
          <Toggle
            label="Refine automatically before generating"
            checked={refine}
            onChange={setRefine}
            hint="Turn this off to send exactly what you typed, word for word."
          />
          </div>
        </>
      ) : (
        <div className="mt-4">
          {/*
            One door for every source. A designer looking for something to
            turn into a mesh is as likely to be looking at a pin as at a file
            on their desktop, so both live behind the same button rather than
            behind a file dialog that only knows about the desktop.
          */}
          <ImagePicker
            open={picking}
            onClose={() => setPicking(false)}
            onPick={(image) => setImageDataUrl(image.url)}
            title="Choose a photograph to model"
            description="One object, shot square on, against a plain background. A cluttered photo produces a cluttered mesh."
            initialQuery="product photography"
          />

          {imageDataUrl ? (
            <div className="relative overflow-hidden rounded-xl border border-line">
              <img src={imageDataUrl} alt="" className="max-h-64 w-full object-contain bg-surface-muted" />
              <button
                type="button"
                onClick={() => setImageDataUrl(null)}
                className="absolute right-2 top-2 rounded-lg bg-surface/90 p-1.5 text-ink-muted shadow-btn hover:text-ink"
                aria-label="Remove the image"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface-muted px-4 py-10 text-center transition hover:border-primary/50 hover:bg-primary-soft"
            >
              <Upload className="h-5 w-5 text-ink-subtle" />
              <span className="text-sm font-semibold text-ink">Choose a photograph</span>
              <span className="max-w-xs text-[11px] leading-relaxed text-ink-subtle">
                Upload one, paste a link, or search Pinterest and the other libraries. One object, shot square on,
                against a plain background — a cluttered photo produces a cluttered mesh.
              </span>
            </button>
          )}
        </div>
      )}

      <CostLine
        access={source === 'image' ? imageAccess : access}
        note="Refunded automatically if the generation fails."
      />

      <button type="button" className="btn-primary btn-lg mt-3 w-full justify-center" disabled={!canGenerate} onClick={generate}>
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {running ? 'Generating…' : 'Generate the model'}
      </button>

      <JobProgress job={job} kind="model" onDismiss={() => setJob(null)} />
    </div>
  );
}

/* ── The 2D generator ──────────────────────────────────────────────────── */

function MockupGenerator({
  capabilities,
  onFinished,
}: {
  capabilities: Awaited<ReturnType<typeof studio.capabilities>> | undefined;
  onFinished: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<'1K' | '2K' | '4K'>('2K');
  const [aspect, setAspect] = useState('16:9');
  const [styleImage, setStyleImage] = useState<string | null>(null);
  const [job, setJob] = useState<AiJobLike | null>(null);
  const [refining, setRefining] = useState(false);
  /** The image being iterated on, so a follow-up edits rather than restarts. */
  const [editing, setEditing] = useState<string | null>(null);
  const [turns, setTurns] = useState<Array<{ prompt: string; imageUrl: string | null }>>([]);
  const [picking, setPicking] = useState(false);

  const access = capabilities?.access.ai_mockup;
  const available = capabilities?.providers.mockup.available ?? true;
  const running = job?.status === 'queued' || job?.status === 'in_progress';

  const refinePrompt = async () => {
    if (prompt.trim().length < 4) {
      toast('info', 'Write a few words first.');
      return;
    }
    setRefining(true);
    try {
      const result = await studio.refine({ prompt: prompt.trim(), kind: '2d', editing: Boolean(editing) });
      setPrompt(result.prompt);
      toast(result.changed ? 'success' : 'info', result.changed ? 'Expanded. Edit it before generating.' : 'Already a good prompt.');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'The prompt could not be refined.');
    } finally {
      setRefining(false);
    }
  };

  const generate = async () => {
    const asked = prompt.trim();
    try {
      const started = await studio.mockup({
        prompt: asked,
        sourceImageUrl: editing,
        styleImageUrl: styleImage,
        aspectRatio: aspect,
        size,
      });
      setJob(started);

      const finished = await studio.wait(started.id, setJob);
      setJob(finished);
      onFinished();

      const url = (finished.output as { imageUrl?: string } | null)?.imageUrl ?? null;
      setTurns((current) => [...current, { prompt: asked, imageUrl: url }]);

      if (finished.status === 'completed' && url) {
        // The result becomes the source for the next turn, which is what makes
        // "now make the counter darker" an edit rather than a fresh image.
        setEditing(url);
        setPrompt('');
        setStyleImage(null);
        toast('success', 'Image ready. Ask for a change and it edits this one.');
      } else if (finished.status === 'failed') {
        toast('error', finished.errorMessage ?? 'The image failed. Your credits have been returned.');
      }
    } catch (error) {
      setJob(null);
      toast('error', error instanceof Error ? error.message : 'That could not be started.');
    }
  };

  return (
    <div className="panel p-5">
      {editing ? (
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-primary">Editing this image</p>
            <button
              type="button"
              className="ed-action"
              onClick={() => {
                setEditing(null);
                setTurns([]);
              }}
            >
              <CircleSlash className="h-3.5 w-3.5" /> Start fresh
            </button>
          </div>
          <img src={editing} alt="" className="mt-2 w-full rounded-xl border border-line object-cover" />
          <p className="field-hint">
            Anything you ask for now is applied to this image. The original subject is kept — say “add greenery
            along the back” and you get this stand with greenery, not a picture of greenery.
          </p>
        </div>
      ) : null}

      <label className="label" htmlFor="mockup-prompt">
        {editing ? 'What should change?' : 'What should the image show?'}
      </label>
      <textarea
        id="mockup-prompt"
        className="input min-h-[110px] resize-y"
        placeholder={
          editing
            ? 'Warmer lighting, and a run of planting along the back wall'
            : 'A modern exhibition stand with a curved LED wall and a white reception counter, shot from a low angle'
        }
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <button
        type="button"
        className="btn-secondary mt-3 w-full justify-center"
        onClick={refinePrompt}
        disabled={refining || running}
      >
        {refining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
        {refining ? 'Writing it out…' : 'Expand this into a full prompt'}
      </button>

      {/* ── A reference to match ─────────────────────────────────────── */}
      <ImagePicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(image) => setStyleImage(image.url)}
        title="Match the look of a reference"
        description="Its palette, lighting and materials are read and written into the prompt — the subject is not copied."
        initialQuery="exhibition stand"
      />

      <div className="mt-3">
        {styleImage ? (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-muted p-2">
            <img src={styleImage} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-ink">Matching this look</p>
              <p className="text-[11px] leading-snug text-ink-subtle">
                Its palette, lighting and materials are read and written into the prompt.
              </p>
            </div>
            <button type="button" className="icon-btn-bare" onClick={() => setStyleImage(null)} aria-label="Remove the reference">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button type="button" className="ed-action w-full justify-center border border-line" onClick={() => setPicking(true)}>
            <ImageIcon className="h-3.5 w-3.5" /> Match the look of a reference image
          </button>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="mockup-aspect">
            Shape
          </label>
          <Select id="mockup-aspect" value={aspect} onChange={(e) => setAspect(e.target.value)}>
            <option value="16:9">Wide (16:9)</option>
            <option value="4:3">Landscape (4:3)</option>
            <option value="1:1">Square</option>
            <option value="3:4">Portrait (3:4)</option>
            <option value="21:9">Panorama (21:9)</option>
          </Select>
        </div>
        <div>
          <label className="label" htmlFor="mockup-size">
            Resolution
          </label>
          <Select id="mockup-size" value={size} onChange={(e) => setSize(e.target.value as typeof size)}>
            <option value="1K">1K — quick</option>
            <option value="2K">2K — for a deck</option>
            <option value="4K">4K — for print</option>
          </Select>
        </div>
      </div>

      <CostLine access={access} note="Refunded automatically if the image fails." />

      <button
        type="button"
        className="btn-primary btn-lg mt-3 w-full justify-center"
        disabled={!available || running || prompt.trim().length < 4}
        onClick={generate}
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {running ? 'Generating…' : editing ? 'Apply the change' : 'Generate the image'}
      </button>

      <JobProgress job={job} kind="image" onDismiss={() => setJob(null)} />

      {turns.length ? (
        <div className="mt-4">
        <Section title="This session">
          <ol className="space-y-2">
            {turns.map((turn, index) => (
              <li key={index} className="flex gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[10px] font-bold text-primary">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] leading-snug text-ink-muted">{turn.prompt}</p>
                  {turn.imageUrl ? (
                    <img src={turn.imageUrl} alt="" className="mt-1.5 w-28 rounded-lg border border-line" />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </Section>
        </div>
      ) : null}
    </div>
  );
}

/* ── Shared pieces ─────────────────────────────────────────────────────── */

function CostLine({
  access,
  note,
}: {
  access: { allowed: boolean; cost?: number; balance?: number; reason?: string } | undefined;
  note: string;
}) {
  if (!access) return null;

  if (!access.allowed) {
    return (
      <p className="notice-warning mt-3 text-[12px] leading-snug">{access.reason ?? 'Not available on this account.'}</p>
    );
  }

  return (
    <p className="mt-3 text-[11px] leading-snug text-ink-subtle">
      {access.cost ? (
        <>
          <strong className="font-semibold text-ink">{access.cost} credits</strong>
          {typeof access.balance === 'number' && access.balance < 1_000_000 ? (
            <> · {access.balance.toLocaleString()} left</>
          ) : null}{' '}
          · {note}
        </>
      ) : (
        <>Included on this account · {note}</>
      )}
    </p>
  );
}

/**
 * Progress that says something.
 *
 * Generation takes a minute or two and the provider's own percentage is the
 * only real information available, so it is shown rather than replaced with an
 * indeterminate bar. A failure states what went wrong and confirms the refund,
 * because the first question after a failed paid action is always "was I
 * charged".
 */
function JobProgress({
  job,
  kind,
  onDismiss,
}: {
  job: AiJobLike | null;
  kind: 'model' | 'image';
  onDismiss: () => void;
}) {
  if (!job) return null;

  const running = job.status === 'queued' || job.status === 'in_progress';

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-muted p-3">
      <div className="mb-2 flex items-center gap-2">
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : null}
        <p className="flex-1 text-xs font-semibold text-ink">
          {job.status === 'queued'
            ? 'Queued with the provider…'
            : job.status === 'in_progress'
              ? kind === 'model'
                ? 'Building the mesh…'
                : 'Painting the image…'
              : job.status === 'completed'
                ? 'Done'
                : job.status === 'cancelled'
                  ? 'Cancelled'
                  : 'Failed'}
        </p>
        {!running ? (
          <button type="button" className="icon-btn-bare h-6 w-6" onClick={onDismiss} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {running ? <ProgressBar value={job.progress} /> : null}

      {job.status === 'failed' ? (
        <p className="text-[12px] leading-snug text-danger">
          {job.errorMessage ?? 'The generation failed.'} Your credits have been returned.
        </p>
      ) : null}

      {job.status === 'completed' ? (
        <p className="text-[12px] leading-snug text-ink-muted">Saved to your library, below.</p>
      ) : null}
    </div>
  );
}

/* ── The library ───────────────────────────────────────────────────────── */

function Vault({
  creations,
  loading,
  onChanged,
}: {
  creations: Creation[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'model' | 'image'>('all');
  const [preview, setPreview] = useState<Creation | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Creation | null>(null);

  const shown = useMemo(
    () => creations.filter((row) => (filter === 'all' ? true : row.kind === filter)),
    [creations, filter]
  );

  const remove = useMutation({
    mutationFn: (id: string) => studio.removeCreation(id),
    onSuccess: () => {
      onChanged();
      setConfirmDelete(null);
      toast('success', 'Removed from your library.');
    },
    onError: () => toast('error', 'That could not be removed.'),
  });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 text-lg font-black tracking-tight text-ink">Your library</h2>
        <div className="ed-segment">
          {(
            [
              ['all', 'Everything'],
              ['model', 'Models'],
              ['image', 'Images'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`ed-segment-btn ${filter === value ? 'ed-segment-btn-active' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-hidden>
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="overflow-hidden rounded-xl border border-line">
              <div className="nv-shimmer aspect-square w-full bg-surface-muted" />
              <div className="space-y-1 border-t border-line p-2.5">
                <div className="h-2 w-3/4 rounded bg-surface-muted" />
                <div className="h-1.5 w-1/2 rounded bg-surface-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : !shown.length ? (
        <EmptyState
          icon={<Sparkles className="h-6 w-6" />}
          title="Nothing generated yet"
          description="Anything you generate lands here — copied onto Novira's own storage, so it still opens when the provider's link has expired."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shown.map((creation) => (
            <CreationCard
              key={creation.id}
              creation={creation}
              onOpen={() => setPreview(creation)}
              onDelete={() => setConfirmDelete(creation)}
            />
          ))}
        </div>
      )}

      <PreviewDialog creation={preview} onClose={() => setPreview(null)} />

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Remove this from your library?"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
            >
              <Trash2 className="h-4 w-4" /> Remove
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          The record goes from this list. Anything you have already placed in a plan keeps working — the file itself
          stays on Novira's storage so a saved layout never loses a piece.
        </p>
      </Modal>
    </div>
  );
}

function CreationCard({
  creation,
  onOpen,
  onDelete,
}: {
  creation: Creation;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const running = creation.status === 'queued' || creation.status === 'in_progress';

  return (
    <figure className="group relative overflow-hidden rounded-xl border border-line bg-surface transition hover:-translate-y-0.5 hover:shadow-card">
      <button type="button" onClick={onOpen} className="block w-full text-left" disabled={running}>
        {creation.kind === 'model' ? (
          <HoverModel
            url={creation.resultUrl}
            poster={creation.thumbnailUrl}
            alt={creation.prompt}
            className="aspect-square w-full"
          />
        ) : (
          <span className="block aspect-square w-full overflow-hidden bg-surface-muted">
            {creation.resultUrl ? (
              <img src={creation.resultUrl} alt={creation.prompt} loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                <ImageIcon className="h-5 w-5 text-ink-subtle/60" />
              </span>
            )}
          </span>
        )}
      </button>

      {running ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/85 backdrop-blur">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-[10px] font-bold tabular-nums text-ink-muted">{creation.progress}%</span>
        </span>
      ) : null}

      {creation.status === 'failed' ? (
        <span className="absolute left-1.5 top-1.5 badge-danger">Failed</span>
      ) : (
        <span className="absolute left-1.5 top-1.5 rounded bg-ink/70 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white backdrop-blur">
          {creation.kind === 'model' ? '3D' : '2D'}
        </span>
      )}

      <button
        type="button"
        onClick={onDelete}
        className="absolute right-1.5 top-1.5 rounded-md bg-surface/90 p-1 text-ink-subtle opacity-0 shadow-btn transition hover:text-danger group-hover:opacity-100"
        aria-label="Remove from your library"
      >
        <Trash2 className="h-3 w-3" />
      </button>

      <figcaption className="border-t border-line px-2.5 py-2">
        <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-ink">{creation.prompt || 'Untitled'}</p>
        <p className="mt-0.5 text-[10px] text-ink-subtle">
          {new Date(creation.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        </p>
      </figcaption>
    </figure>
  );
}

/* ── Opening one ───────────────────────────────────────────────────────── */

/**
 * The preview, plus what to do with it.
 *
 * A finished model is only useful once it is somewhere. Rather than making the
 * designer navigate to a plan and hunt for it, the dialog imports it straight
 * into the catalogue — measured on the way in — so it appears in Create → Mine
 * and can be dragged into any plan afterwards.
 */
function PreviewDialog({ creation, onClose }: { creation: Creation | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const subject: PreviewSubject | null = useMemo(() => {
    if (!creation) return null;
    return {
      modelUrl: creation.kind === 'model' ? creation.resultUrl : null,
      imageUrl: creation.kind === 'image' ? creation.resultUrl : creation.thumbnailUrl,
      name: creation.prompt || 'Generated asset',
      description: creation.refinedPrompt ?? undefined,
      sourceLabel: creation.kind === 'model' ? 'Generated in Novira' : 'Generated in Novira',
      license: 'Yours to use',
      meta: [
        { label: 'Type', value: creation.kind === 'model' ? '3D model (GLB)' : '2D image (PNG)' },
        { label: 'Style', value: creation.style ?? '—' },
        { label: 'Created', value: new Date(creation.createdAt).toLocaleString() },
      ],
    };
  }, [creation]);

  const addToLibrary = async () => {
    if (!creation?.resultUrl) return;
    setBusy(true);
    try {
      if (creation.kind === 'model') {
        await assets.import(
          {
            assetType: 'model',
            source: 'novira-ai',
            sourceLabel: 'Generated in Novira',
            sourceAssetId: creation.id,
            name: (creation.prompt || 'Generated model').slice(0, 120),
            description: creation.refinedPrompt ?? undefined,
            modelUrl: creation.resultUrl,
            thumbnailUrl: creation.thumbnailUrl,
            license: 'Generated · yours to use',
            loadableInScene: true,
          },
          undefined
        );
        void queryClient.invalidateQueries({ queryKey: ['assets', 'imported'] });
        toast('success', 'Measured and added to your library. Find it under Create → 3D Models → Mine.');
        onClose();
      } else {
        // A 2D mockup's next step is almost always a mesh, so that is the offer.
        const started = await studio.imageTo3d({ imageUrl: creation.resultUrl, prompt: creation.prompt });
        toast('info', 'Building a 3D model from this image. It will appear in your library when it is done.');
        void studio.wait(started.id).then(() => {
          void queryClient.invalidateQueries({ queryKey: ['studio', 'creations'] });
        });
        onClose();
      }
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'That could not be done.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModelPreview
      open={Boolean(creation)}
      subject={subject}
      onClose={onClose}
      busy={busy}
      addLabel={creation?.kind === 'model' ? 'Add to my library' : 'Turn this into a 3D model'}
      onAdd={creation?.resultUrl ? addToLibrary : undefined}
    />
  );
}
