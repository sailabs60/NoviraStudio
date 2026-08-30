import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clapperboard,
  Film,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Video,
  Wand2,
  X,
} from 'lucide-react';
import {
  CAMERA_EASINGS,
  EASING_LABELS,
  generateWalkthrough,
  MUSIC_BEDS,
  SHOT_KIND_INFO,
  sampleWalkthrough,
  VIDEO_PRESETS,
  walkthroughDuration,
  WALKTHROUGH_STYLES,
  type CameraEasing,
  type CameraShot,
  type SceneWalkthrough,
} from '@novira/shared';
import { useEditor } from '../editorStore';
import { captureAtSize, rendererAvailable } from '../highResCapture';
import { pollJob, spatial, type AiJobLike } from '../../lib/spatialApi';
import {
  EmptyState,
  Field,
  NumberField,
  ProgressBar,
  Section,
  Segmented,
  Select,
  SliderField,
  Stat,
  Toggle,
  toast,
} from '../../components/ui';

/**
 * The walkthrough engine.
 *
 * A walkthrough is a list of shots, and this panel is deliberately built around
 * that list rather than around a "record" button. Screen-recording an orbit
 * drag produces the video everyone recognises as amateur: variable speed, a
 * wobble, a stop that overshoots. A shot list produces the one that does not.
 *
 * Video export runs in two halves for a reason explained in
 * `services/videoRender.ts`: frames are drawn here, by the same renderer that
 * draws the preview, and encoded on the server. That is what guarantees the
 * video matches what was approved on screen.
 */
export function WalkthroughPanel() {
  const planId = useEditor((s) => s.planId);
  const title = useEditor((s) => s.title);
  const objects = useEditor((s) => s.scene.objects);
  const walkthrough = useEditor((s) => s.scene.walkthrough);
  const setWalkthrough = useEditor((s) => s.setWalkthrough);
  const setShots = useEditor((s) => s.setShots);
  const playing = useEditor((s) => s.playing);
  const playhead = useEditor((s) => s.playhead);
  const setPlaying = useEditor((s) => s.setPlaying);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const readOnly = useEditor((s) => s.readOnly);

  const queryClient = useQueryClient();
  const [style, setStyle] = useState<(typeof WALKTHROUGH_STYLES)[number]['key']>('cinematic');
  const [presetKey, setPresetKey] = useState('hd');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ phase: '', value: 0 });
  const [job, setJob] = useState<AiJobLike | null>(null);
  const cancelExport = useRef(false);

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

  const totalMs = useMemo(() => walkthroughDuration(walkthrough.shots), [walkthrough.shots]);
  const videoPreset = VIDEO_PRESETS.find((p) => p.key === presetKey) ?? VIDEO_PRESETS[1]!;
  const capability = capabilities?.video_render;

  /* ── Generating a sequence ───────────────────────────────────────────── */

  const generate = () => {
    const placed = objects.filter((o) => o.type !== 'light' && o.type !== 'constraint' && !o.hidden);
    if (!placed.length) {
      toast('info', 'Add something to the plan first — a walkthrough needs a room to walk through.');
      return;
    }

    const xs = placed.map((o) => o.positionMm.x);
    const zs = placed.map((o) => o.positionMm.z);
    const bounds = {
      minX: Math.min(...xs) - 4000,
      maxX: Math.max(...xs) + 4000,
      minZ: Math.min(...zs) - 4000,
      maxZ: Math.max(...zs) + 4000,
    };

    /*
     * Subjects, in the order the camera should visit them. A stage first, then
     * screens, then everything else — which is the order a client cares about
     * and therefore the order the video should reveal them in.
     */
    const priority: Record<string, number> = { stage: 0, led: 1, booth: 2, truss: 3, curtain: 4, catalog: 5 };
    const subjects = placed
      .slice()
      .sort((a, b) => (priority[a.type] ?? 9) - (priority[b.type] ?? 9))
      .slice(0, 6)
      .map((object) => {
        const sized = object as typeof object & { widthMm?: number; heightMm?: number; deckColumns?: number; columns?: number };
        return {
          name: object.name ?? object.type,
          xMm: object.positionMm.x,
          zMm: object.positionMm.z,
          widthMm: sized.widthMm ?? (sized.deckColumns ? sized.deckColumns * 1219 : sized.columns ? sized.columns * 500 : 4000),
          heightMm: sized.heightMm ?? 3000,
        };
      });

    const chosen = WALKTHROUGH_STYLES.find((s) => s.key === style)!;
    const shots = generateWalkthrough({
      boundsMm: bounds,
      roomHeightMm: 7000,
      subjects,
      eyeHeightMm: walkthrough.eyeHeightMm,
      targetDurationMs: chosen.durationMs,
      style,
    });

    setShots(shots);
    setPlayhead(0);
    setWalkthrough({ aspect: style === 'reel' ? 'vertical' : 'landscape' });
    if (style === 'reel') setPresetKey('vertical');
    toast('success', `${shots.length} shots, ${(walkthroughDuration(shots) / 1000).toFixed(0)} seconds.`);
  };

  /* ── Exporting ───────────────────────────────────────────────────────── */

  /**
   * Render every frame and upload it.
   *
   * Frames are drawn one at a time by moving the playhead and reading the
   * canvas, with a yield between each so the tab stays responsive and the
   * progress bar actually moves. Uploading in batches of eight keeps the
   * request count sane without building a request too large to send.
   */
  const exportVideo = async () => {
    if (!planId || !walkthrough.shots.length) return;
    if (!rendererAvailable()) {
      toast('error', 'The 3D view is not ready yet.');
      return;
    }

    cancelExport.current = false;
    setExporting(true);
    setPlaying(false);
    let sessionId: string | null = null;

    try {
      setExportProgress({ phase: 'Preparing', value: 2 });
      const session = await spatial.ai.videoSession(planId);
      sessionId = session.sessionId;

      const frameCount = Math.max(2, Math.round((totalMs / 1000) * videoPreset.fps));
      const batch: Array<{ index: number; dataUrl: string }> = [];

      for (let i = 0; i < frameCount; i += 1) {
        if (cancelExport.current) throw new Error('cancelled');

        const time = (i / (frameCount - 1)) * totalMs;
        setPlayhead(time);

        // Two frames: one for the store to propagate, one for the scene to be
        // drawn with the camera in its new place. Reading after a single frame
        // captures the previous position, which produces a video one frame
        // behind throughout — subtle, and unmistakable once seen.
        await nextFrame();
        await nextFrame();

        const frame = captureAtSize(videoPreset.width, videoPreset.height, 'image/jpeg', 0.92);
        if (!frame) throw new Error('The frame could not be read.');
        batch.push({ index: i, dataUrl: frame.dataUrl });

        if (batch.length >= 8 || i === frameCount - 1) {
          await spatial.ai.videoFrames(sessionId, batch.splice(0, batch.length));
        }

        setExportProgress({ phase: `Rendering frame ${i + 1} of ${frameCount}`, value: 5 + (i / frameCount) * 70 });
      }

      setExportProgress({ phase: 'Encoding', value: 80 });
      const started = await spatial.ai.videoRender({
        sessionId,
        planId,
        fps: videoPreset.fps,
        width: videoPreset.width,
        height: videoPreset.height,
        bitrateMbps: videoPreset.bitrateMbps,
      });
      setJob(started);

      const finished = await pollJob(started.id, (j) => {
        setJob(j);
        setExportProgress({ phase: 'Encoding', value: 80 + (j.progress / 100) * 20 });
      });
      setJob(finished);

      if (finished.status === 'completed') {
        toast('success', 'Video ready.');
        void queryClient.invalidateQueries({ queryKey: ['plan-media', planId] });
      } else if (finished.status === 'failed') {
        toast('error', finished.errorMessage ?? 'The video could not be encoded. Your credits have been returned.');
      }
    } catch (error) {
      if (sessionId) void spatial.ai.videoDiscard(sessionId).catch(() => {});
      if (error instanceof Error && error.message === 'cancelled') {
        toast('info', 'Export cancelled.');
      } else {
        toast('error', error instanceof Error ? error.message : 'The export failed.');
      }
    } finally {
      setExporting(false);
      setExportProgress({ phase: '', value: 0 });
    }
  };

  const updateShot = (id: string, patch: Partial<CameraShot>) => {
    setShots(walkthrough.shots.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)));
  };

  const removeShot = (id: string) => setShots(walkthrough.shots.filter((shot) => shot.id !== id));

  const shotStart = (index: number) =>
    walkthrough.shots.slice(0, index).reduce((sum, s) => sum + s.durationMs + (s.holdMs ?? 0), 0);

  return (
    <>
      <Section
        title="Build a sequence"
        description="Four ready-made camera moves. Each one is generated from your plan's actual size, so it frames correctly whether the room is 6 m or 60 m across."
      >
        <div className="space-y-1.5">
          {WALKTHROUGH_STYLES.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setStyle(option.key)}
              aria-pressed={style === option.key}
              className={`w-full rounded-lg border p-2 text-left transition ${
                style === option.key ? 'border-primary bg-primary/10' : 'border-line bg-surface-muted/40 hover:border-line-strong'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-ink">{option.label}</span>
                <span className="chip shrink-0">{(option.durationMs / 1000).toFixed(0)}s</span>
              </div>
              <p className="mt-0.5 text-[10px] leading-snug text-ink-subtle">{option.note}</p>
            </button>
          ))}
        </div>

        <button type="button" className="ed-action-primary mt-2 w-full justify-center" onClick={generate} disabled={readOnly}>
          <Wand2 className="h-3.5 w-3.5" /> Generate the shots
        </button>
      </Section>

      {walkthrough.shots.length ? (
        <>
          <Section title="Playback">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="ed-action-primary"
                onClick={() => setPlaying(!playing)}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {playing ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                className="ed-action border border-line"
                onClick={() => {
                  setPlaying(false);
                  setPlayhead(0);
                }}
                aria-label="Back to the start"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <span className="ml-auto text-[11px] tabular-nums text-ink-subtle">
                {(playhead / 1000).toFixed(1)}s / {(totalMs / 1000).toFixed(1)}s
              </span>
            </div>

            <input
              type="range"
              className="mt-2 w-full accent-[rgb(var(--nv-primary))]"
              min={0}
              max={totalMs}
              step={50}
              value={Math.min(playhead, totalMs)}
              aria-label="Playhead"
              onChange={(e) => {
                setPlaying(false);
                setPlayhead(Number(e.target.value));
              }}
            />

            <Toggle
              label="Loop"
              checked={walkthrough.loop}
              onChange={(loop) => setWalkthrough({ loop })}
              hint="Keeps the preview running so you can watch it while you adjust the room."
            />
          </Section>

          <Section title={`Shots (${walkthrough.shots.length})`} description="Click a shot to jump to it. Each one has its own length and easing, so changing one does not retime the rest.">
            <div className="space-y-1.5">
              {walkthrough.shots.map((shot, index) => {
                const start = shotStart(index);
                const active = playhead >= start && playhead < start + shot.durationMs + (shot.holdMs ?? 0);
                return (
                  <div
                    key={shot.id}
                    className={`rounded-lg border p-2 transition ${active ? 'border-primary bg-primary/10' : 'border-line bg-surface-muted/40'}`}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          setPlaying(false);
                          setPlayhead(start + 1);
                        }}
                      >
                        <span className="block truncate text-[11px] font-semibold text-ink">
                          {index + 1}. {shot.name}
                        </span>
                        <span className="block text-[10px] text-ink-subtle">
                          {SHOT_KIND_INFO[shot.kind].label} · {(shot.durationMs / 1000).toFixed(1)}s ·{' '}
                          {EASING_LABELS[shot.easing]}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="shrink-0 text-ink-subtle transition hover:text-danger"
                        onClick={() => removeShot(shot.id)}
                        aria-label={`Remove ${shot.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {active ? (
                      <div className="mt-2 space-y-1.5 border-t border-line pt-2">
                        <SliderField
                          label="Length"
                          value={shot.durationMs}
                          onChange={(durationMs) => updateShot(shot.id, { durationMs })}
                          min={500}
                          max={20_000}
                          step={250}
                          format={(v) => `${(v / 1000).toFixed(1)}s`}
                        />
                        <Field label="Easing" help="How the move accelerates. A camera that starts and stops abruptly reads as a computer; one that eases reads as an operator.">
                          <Select
                            value={shot.easing}
                            onChange={(e) => updateShot(shot.id, { easing: e.target.value as CameraEasing })}
                          >
                            {CAMERA_EASINGS.map((easing) => (
                              <option key={easing} value={easing}>
                                {EASING_LABELS[easing]}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <SliderField
                          label="Field of view"
                          value={shot.fov}
                          onChange={(fov) => updateShot(shot.id, { fov })}
                          min={18}
                          max={90}
                          step={1}
                          format={(v) => `${v}°`}
                          hint="Lower is a longer lens: flatter, more flattering, and less of the room."
                        />
                        {shot.kind === 'orbit' ? (
                          <SliderField
                            label="Sweep"
                            value={shot.sweepDeg ?? 360}
                            onChange={(sweepDeg) => updateShot(shot.id, { sweepDeg })}
                            min={30}
                            max={360}
                            step={10}
                            format={(v) => `${v}°`}
                          />
                        ) : null}
                        <button
                          type="button"
                          className="ed-action w-full justify-center border border-line"
                          onClick={() => {
                            const sample = sampleWalkthrough(walkthrough.shots, playhead);
                            if (!sample) return;
                            updateShot(shot.id, {
                              fromMm: sample.positionMm,
                              toMm: sample.positionMm,
                              lookAtMm: sample.targetMm,
                            });
                            toast('success', 'Shot set to the current view.');
                          }}
                        >
                          <Clapperboard className="h-3.5 w-3.5" /> Use the current view
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="ed-action mt-2 w-full justify-center border border-line"
              onClick={() => {
                const sample = sampleWalkthrough(walkthrough.shots, playhead) ?? {
                  positionMm: { x: 8000, y: 3000, z: 8000 },
                  targetMm: { x: 0, y: 1500, z: 0 },
                  fov: 45,
                };
                setShots([
                  ...walkthrough.shots,
                  {
                    id: `shot-${Date.now().toString(36)}`,
                    name: `Shot ${walkthrough.shots.length + 1}`,
                    kind: 'static',
                    fromMm: sample.positionMm,
                    toMm: sample.positionMm,
                    lookAtMm: sample.targetMm,
                    durationMs: 3000,
                    easing: 'ease-in-out',
                    fov: sample.fov,
                  },
                ]);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add a shot from this view
            </button>
          </Section>

          <Section title="Movement" collapsible defaultOpen={false}>
            <SliderField
              label="Eye height"
              value={walkthrough.eyeHeightMm}
              onChange={(eyeHeightMm) => setWalkthrough({ eyeHeightMm })}
              min={1200}
              max={2200}
              step={50}
              format={(v) => `${(v / 1000).toFixed(2)} m`}
              help="How tall the camera is in a walk-through shot. 1.65 m is standing eye height and is the honest view — this is what most guests will actually see."
            />
            <NumberField
              label="Fly speed"
              value={walkthrough.flySpeed}
              onChange={(flySpeed) => setWalkthrough({ flySpeed })}
              min={0.5}
              max={12}
              step={0.5}
              suffix="m/s"
              help="Walking pace is about 1.4 m/s. Faster than about 4 m/s starts to feel like a drone rather than a person."
            />
          </Section>

          <Section
            title="Export a video"
            help="Frames are drawn here by the same renderer as the preview, then encoded on the server. That is why the video matches what you approved on screen."
          >
            {capability && !capability.allowed ? (
              <div className="notice-warning mb-2 text-[11px] leading-snug">{capability.reason ?? 'Not available on this account.'}</div>
            ) : null}

            <Field label="Format">
              <Select value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
                {VIDEO_PRESETS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label} — {option.note}
                  </option>
                ))}
              </Select>
            </Field>

            <Segmented
              label="Shape"
              value={walkthrough.aspect}
              columns={3}
              options={[
                { value: 'landscape', label: 'Wide' },
                { value: 'square', label: 'Square' },
                { value: 'vertical', label: 'Vertical' },
              ]}
              onChange={(aspect) => {
                setWalkthrough({ aspect: aspect as SceneWalkthrough['aspect'] });
                setPresetKey(aspect === 'vertical' ? 'vertical' : aspect === 'square' ? 'square' : 'hd');
              }}
            />

            <Field label="Music" help="No music is bundled — licensing a library is not something this product can do on your behalf. Choose a mood here to note it on the export, and add your own track in an editor.">
              <Select
                value={walkthrough.music}
                onChange={(e) => setWalkthrough({ music: e.target.value as SceneWalkthrough['music'] })}
              >
                {MUSIC_BEDS.map((bed) => (
                  <option key={bed.key} value={bed.key}>
                    {bed.label} — {bed.note}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="my-2 grid grid-cols-2 gap-1.5">
              <Stat label="Length" value={`${(totalMs / 1000).toFixed(1)}s`} />
              <Stat
                label="Frames"
                value={Math.round((totalMs / 1000) * videoPreset.fps)}
                help="Each one is rendered here and uploaded, so a long 4K export takes a few minutes."
              />
            </div>

            {exporting ? (
              <>
                <ProgressBar value={exportProgress.value} label={exportProgress.phase} />
                <button
                  type="button"
                  className="ed-action mt-1.5 w-full justify-center"
                  onClick={() => {
                    cancelExport.current = true;
                    if (job) void spatial.ai.cancel(job.id).catch(() => {});
                  }}
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ed-action-primary w-full justify-center"
                onClick={() => void exportVideo()}
                disabled={capability ? !capability.allowed : false}
              >
                <Video className="h-3.5 w-3.5" />
                Export video{capability?.cost ? ` · ${capability.cost} credits` : ''}
              </button>
            )}
          </Section>
        </>
      ) : (
        <Section title="">
          <EmptyState
            icon={<Film className="h-6 w-6" />}
            title="No walkthrough yet"
            description="Pick a style above and press Generate. You can adjust every shot afterwards, or add your own from the current view."
          />
        </Section>
      )}

      {media?.videos.length ? (
        <Section title={`Videos (${media.videos.length})`}>
          <div className="space-y-1.5">
            {media.videos.map((video) => (
              <a
                key={video.id}
                href={video.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-lg border border-line bg-surface-muted/40 p-2 transition hover:border-line-strong"
              >
                <Video className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium text-ink">{title || 'Walkthrough'}</span>
                  <span className="block truncate text-[10px] text-ink-subtle">
                    {video.prompt} · {new Date(video.createdAt).toLocaleDateString()}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

/** Wait for the next painted frame. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}
