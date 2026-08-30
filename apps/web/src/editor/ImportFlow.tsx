import { useRef, useState, type MouseEvent } from 'react';
import { Image as ImageIcon, Loader2, Map as MapIcon, PenLine, Ruler, Sparkles, Upload } from 'lucide-react';
import { formatLength, rebuildBlueprint, type FloorPlanRef, type UnitSystem, type WallSegment } from '@novira/shared';
import { http, ApiClientError } from '../lib/api';
import { useEditor } from './editorStore';
import { Modal } from '../components/Modal';

type Flow = 'choose' | 'background' | 'floor-plan' | 'map';

interface UploadResult {
  fileKey: string;
  url: string;
  widthPx: number;
  heightPx: number;
}

/**
 * Import flow.
 *
 * Three ways to get the real world into a plan, deliberately separated because
 * they mean different things:
 *
 *   · **Background** — a photo behind the scene. Not measured, not on the floor.
 *   · **Floor plan** — a drawing laid on the floor at true scale. Needs
 *     calibration, and everything traced on it inherits that scale.
 *   · **Map** — an aerial capture whose scale is known from the projection, so
 *     it needs no calibration at all.
 *
 * Conflating them is how a plan ends up looking right and measuring wrong.
 */
export function ImportFlow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [flow, setFlow] = useState<Flow>('choose');
  const [error, setError] = useState<string | null>(null);
  const [tracing, setTracing] = useState(false);
  /** How many segments the last automatic trace produced, once it has run. */
  const [traced, setTraced] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState<UploadResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const commit = useEditor((s) => s.commit);
  const units = useEditor((s) => s.units);

  const reset = () => {
    setFlow('choose');
    setUploaded(null);
    setError(null);
    setBusy(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  async function uploadFile(file: File, purpose: 'background' | 'floor-plan') {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('image', file);
      form.append('purpose', purpose);
      const { data } = await http.post<UploadResult>('/uploads/background', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (purpose === 'background') {
        // A background needs no placement step — it is applied immediately.
        commit((draft) => {
          draft.background = { imageUrl: data.url, fileKey: data.fileKey };
        });
        close();
        return;
      }
      setUploaded(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'That image could not be uploaded.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Place the calibrated drawing, and optionally trace its walls.
   *
   * Two ways out of calibration, because they are genuinely different jobs:
   * tracing by hand gives exactly the walls you want on a messy or annotated
   * drawing, while the automatic pass is far quicker on a clean one. Offering
   * only "place it" left the tracer with no way to be reached at all.
   */
  async function applyFloorPlan(mmPerPixel: number, mode: 'manual' | 'ai' = 'manual') {
    if (!uploaded) return;
    const plan: FloorPlanRef = {
      imageUrl: uploaded.url,
      fileKey: uploaded.fileKey,
      mmPerPixel,
      widthPx: uploaded.widthPx,
      heightPx: uploaded.heightPx,
      originMm: { x: 0, y: 0, z: 0 },
      rotationDeg: 0,
      opacity: 0.6,
      // Locked so tracing over it cannot nudge it out of alignment.
      locked: true,
    };
    commit((draft) => {
      draft.floorPlan = plan;
    });
    // Tracing is a top-view job, by hand or otherwise.
    useEditor.getState().setCameraMode('top');

    if (mode === 'manual') {
      // Hand straight to the wall tool; that is what "trace it yourself" means.
      useEditor.getState().setTool('wall');
      close();
      return;
    }

    await runAiTrace(plan);
  }

  /**
   * Trace the walls automatically.
   *
   * The job is charged, queued and polled like the other AI work, and a run
   * that finds nothing refunds itself and says so rather than leaving an empty
   * plan and no explanation.
   */
  async function runAiTrace(plan: FloorPlanRef) {
    const planId = useEditor.getState().planId;
    if (!planId) {
      setError('Save the plan before tracing it.');
      return;
    }

    setTracing(true);
    setError(null);
    try {
      const started = (
        await http.post<{ id: string }>('/ai/trace-walls', {
          planId,
          imageUrl: plan.imageUrl,
          mmPerPixel: plan.mmPerPixel,
        })
      ).data;

      for (let i = 0; i < 90; i += 1) {
        await new Promise((r) => setTimeout(r, 1000));
        const job = (
          await http.get<{
            status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
            errorMessage: string | null;
            output: { segments: WallSegment[]; count: number } | null;
          }>(`/ai/jobs/${started.id}`)
        ).data;

        if (job.status === 'completed' && job.output) {
          const found = job.output.segments;
          commit((draft) => {
            // Add to whatever is already drawn rather than replacing it; a
            // planner may have traced part of the room already.
            draft.walls = rebuildBlueprint(
              [...draft.walls.segments, ...found],
              draft.walls.floors
            );
          });
          setTraced(found.length);
          close();
          return;
        }

        if (job.status === 'failed' || job.status === 'cancelled') {
          setError(
            job.errorMessage ??
              'Nothing could be traced from that drawing. Trace it by hand instead.'
          );
          return;
        }
      }
      setError('The trace is taking longer than expected. It will finish in the background.');
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Could not trace that drawing. Trace it by hand instead.'
      );
    } finally {
      setTracing(false);
    }
  }

  return (
    <Modal
      open={open}
      title={
        flow === 'choose'
          ? 'Choose import flow'
          : flow === 'floor-plan'
            ? uploaded
              ? 'Set the scale'
              : 'Import floor plan'
            : flow === 'map'
              ? 'Import from map'
              : 'Upload background'
      }
      description={
        flow === 'choose' ? 'What are you bringing in?' : undefined
      }
      onClose={close}
      width={flow === 'floor-plan' && uploaded ? 'max-w-3xl' : 'max-w-lg'}
      footer={
        flow === 'choose' ? (
          <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
        ) : (
          <button type="button" className="btn-secondary mr-auto" onClick={reset}>Back</button>
        )
      }
    >
      {error ? <div className="notice-error mb-3">{error}</div> : null}

      {flow === 'choose' ? (
        <ul className="space-y-2">
          <FlowOption
            icon={<ImageIcon className="h-4 w-4" />}
            title="Upload background"
            description="Use the image as a scene backdrop. Not measured or placed on the floor."
            onClick={() => {
              setFlow('background');
              fileInput.current?.click();
            }}
          />
          <FlowOption
            icon={<Ruler className="h-4 w-4" />}
            title="Import floor plan"
            description="Calibrate the scale and trace walls over it."
            onClick={() => setFlow('floor-plan')}
          />
          <FlowOption
            icon={<MapIcon className="h-4 w-4" />}
            title="Import from map"
            description="Capture an aerial image at true scale. No calibration needed."
            onClick={() => setFlow('map')}
          />
        </ul>
      ) : null}

      {flow === 'floor-plan' && !uploaded ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            Upload the drawing, then set its scale by measuring one distance you already know.
          </p>
          <button
            type="button"
            className="btn-primary w-full"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="h-4 w-4" /> {busy ? 'Uploading…' : 'Choose a drawing'}
          </button>
          <ul className="space-y-1 text-xs text-ink-subtle">
            <li>PNG, JPG, WebP, GIF or SVG · 10 MB maximum.</li>
            <li>Have one known measurement ready — a dimension line, a labelled wall, or a scale bar.</li>
          </ul>
        </div>
      ) : null}

      {flow === 'floor-plan' && uploaded ? (
        <Calibrator upload={uploaded} units={units} onApply={applyFloorPlan} tracing={tracing} />
      ) : null}

      {traced !== null ? (
        <div className="notice-success mb-3 text-xs">
          {traced} wall segment{traced === 1 ? '' : 's'} traced. Check them against the drawing
          and adjust anything the pass got wrong.
        </div>
      ) : null}

      {flow === 'map' ? <MapImport units={units} onDone={close} onError={setError} /> : null}

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > 10 * 1024 * 1024) {
            setError('File size must be less than 10 MB.');
            return;
          }
          void uploadFile(file, flow === 'background' ? 'background' : 'floor-plan');
        }}
      />
    </Modal>
  );
}

function FlowOption({
  icon, title, description, onClick,
}: { icon: React.ReactNode; title: string; description: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-start gap-3 rounded-lg border border-line p-3 text-left transition hover:border-primary/60 hover:bg-primary/5"
      >
        <span className="mt-0.5 text-primary">{icon}</span>
        <span>
          <span className="block text-sm font-medium text-ink">{title}</span>
          <span className="block text-xs text-ink-subtle">{description}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * Two-point calibration.
 *
 * Click the two ends of a distance you know, type what it really is, and the
 * ratio gives millimetres-per-pixel for the whole drawing. Calibrating off a
 * short segment multiplies any click error across the entire plan, so the UI
 * says so and reports the measured pixel span as you go.
 */
function Calibrator({
  upload, units, onApply, tracing,
}: {
  upload: UploadResult;
  units: UnitSystem;
  onApply: (mmPerPixel: number, mode: 'manual' | 'ai') => void;
  tracing: boolean;
}) {
  const [points, setPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [realDistance, setRealDistance] = useState('');
  const [unit, setUnit] = useState<'m' | 'cm' | 'ft' | 'in'>(units === 'metric' ? 'm' : 'ft');
  const imageRef = useRef<HTMLImageElement>(null);

  const pixelDistance =
    points.length === 2
      ? Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y)
      : 0;

  const toMm = (value: number) =>
    unit === 'm' ? value * 1000 : unit === 'cm' ? value * 10 : unit === 'ft' ? value * 304.8 : value * 25.4;

  const realMm = toMm(Number(realDistance));
  const ready = points.length === 2 && Number.isFinite(realMm) && realMm > 0 && pixelDistance > 1;
  const mmPerPixel = ready ? realMm / pixelDistance : 0;

  function handleClick(event: MouseEvent<HTMLImageElement>) {
    const image = imageRef.current;
    if (!image) return;
    const rect = image.getBoundingClientRect();
    // Work in the drawing's own pixel space, not the displayed size.
    const scaleX = upload.widthPx / rect.width;
    const scaleY = upload.heightPx / rect.height;
    const point = {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
    // A third click starts over from a new first point.
    setPoints((p) => (p.length >= 2 ? [point] : [...p, point]));
  }

  const display = (p: { x: number; y: number }) => ({
    left: `${(p.x / upload.widthPx) * 100}%`,
    top: `${(p.y / upload.heightPx) * 100}%`,
  });

  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
      <div className="relative overflow-hidden rounded-lg border border-line bg-white">
        <img
          ref={imageRef}
          src={upload.url}
          alt="Floor plan"
          className="w-full cursor-crosshair select-none"
          onClick={handleClick}
          draggable={false}
        />
        {points.map((p, i) => (
          <span
            key={i}
            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary"
            style={display(p)}
          />
        ))}
        {points.length === 2 ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <line
              x1={`${(points[0]!.x / upload.widthPx) * 100}%`}
              y1={`${(points[0]!.y / upload.heightPx) * 100}%`}
              x2={`${(points[1]!.x / upload.widthPx) * 100}%`}
              y2={`${(points[1]!.y / upload.heightPx) * 100}%`}
              stroke="#0072FD"
              strokeWidth={2}
            />
          </svg>
        ) : null}
      </div>

      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-ink-muted">
          Click the two ends of a distance you know on the drawing, then enter what it really measures.
        </p>

        <div className="rounded-lg border border-line bg-surface-muted/40 p-2">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
            Selected length
          </span>
          <span className="text-sm font-medium text-ink">
            {points.length === 2 ? `${Math.round(pixelDistance)} px` : '– –'}
          </span>
        </div>

        <div>
          <label className="label" htmlFor="real-distance">Real distance</label>
          <div className="flex gap-1.5">
            <input
              id="real-distance"
              className="input"
              inputMode="decimal"
              value={realDistance}
              onChange={(e) => setRealDistance(e.target.value)}
              placeholder="0"
            />
            <select className="select w-20" value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
              <option value="m">m</option>
              <option value="cm">cm</option>
              <option value="ft">ft</option>
              <option value="in">in</option>
            </select>
          </div>
          {points.length < 2 ? (
            <p className="field-error">Select two points to continue.</p>
          ) : !ready ? (
            <p className="field-error">Enter a valid distance.</p>
          ) : null}
        </div>

        {ready ? (
          <div className="notice-success text-xs">
            Scale: 1 px = {mmPerPixel.toFixed(2)} mm. The drawing is{' '}
            {formatLength(upload.widthPx * mmPerPixel, units)} wide.
          </div>
        ) : null}

        <p className="text-[10px] leading-relaxed text-ink-subtle">
          Use the longest distance you are confident about — calibrating off a short segment multiplies
          any click error across the whole plan.
        </p>

        <div className="flex gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setPoints([])}>
            Reset points
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm flex-1"
            disabled={!ready || tracing}
            onClick={() => onApply(mmPerPixel, 'manual')}
          >
            <PenLine className="h-3.5 w-3.5" /> Trace by hand
          </button>
          <button
            type="button"
            className="btn-primary btn-sm flex-1"
            disabled={!ready || tracing}
            onClick={() => onApply(mmPerPixel, 'ai')}
          >
            {tracing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {tracing ? 'Tracing…' : 'Trace for me'}
          </button>
        </div>

        <p className="text-[10px] leading-relaxed text-ink-subtle">
          Tracing for you reads the walls off a clean drawing in one pass and costs
          credits. On a busy or annotated plan, tracing by hand is usually faster
          than correcting a guess.
        </p>
      </div>
    </div>
  );
}

/* ── Map import ────────────────────────────────────────────────────────── */

function MapImport({
  units, onDone, onError,
}: { units: UnitSystem; onDone: () => void; onError: (m: string) => void }) {
  const commit = useEditor((s) => s.commit);
  const [lat, setLat] = useState('40.79330');
  const [lng, setLng] = useState('-73.95184');
  const [zoom, setZoom] = useState(19);
  const [busy, setBusy] = useState(false);
  const [capabilities, setCapabilities] = useState<{ configured: boolean; reason?: string } | null>(null);

  // Ask once whether this is even possible, so the UI can say why not.
  useState(() => {
    void http
      .get<{ configured: boolean; allowed: boolean; reason?: string; cost: number }>('/uploads/map/capabilities')
      .then((r) => setCapabilities(r.data))
      .catch(() => setCapabilities({ configured: false, reason: 'Could not reach the server.' }));
  });

  async function capture() {
    setBusy(true);
    try {
      const { data } = await http.post<{
        url: string;
        fileKey: string;
        widthPx: number;
        heightPx: number;
        mmPerPixel: number;
      }>('/uploads/map', { lat: Number(lat), lng: Number(lng), zoom, size: 640, scale: 2 });

      commit((draft) => {
        draft.floorPlan = {
          imageUrl: data.url,
          fileKey: data.fileKey,
          mmPerPixel: data.mmPerPixel,
          widthPx: data.widthPx,
          heightPx: data.heightPx,
          originMm: { x: 0, y: 0, z: 0 },
          rotationDeg: 0,
          opacity: 0.85,
          locked: true,
        };
      });
      useEditor.getState().setCameraMode('top');
      onDone();
    } catch (err) {
      onError(err instanceof ApiClientError ? err.message : 'The map capture failed.');
    } finally {
      setBusy(false);
    }
  }

  const metresPerPixel =
    (156543.03392 * Math.cos((Number(lat) * Math.PI) / 180)) / 2 ** zoom / 2;

  return (
    <div className="space-y-3">
      {capabilities && !capabilities.configured ? (
        <div className="notice-warning text-xs">
          {capabilities.reason ?? 'Map import is not configured on this server.'}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="lat">Latitude</label>
          <input id="lat" className="input" value={lat} onChange={(e) => setLat(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="lng">Longitude</label>
          <input id="lng" className="input" value={lng} onChange={(e) => setLng(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="zoom">Zoom · {zoom}</label>
        <input id="zoom" type="range" min={15} max={21} value={zoom} className="w-full accent-primary"
          onChange={(e) => setZoom(Number(e.target.value))} />
      </div>

      <div className="notice-neutral text-xs">
        Ground scale at this zoom: <strong className="text-ink">{metresPerPixel.toFixed(4)} m/px</strong> —
        the capture covers about {formatLength(1280 * metresPerPixel * 1000, units)} across.
      </div>

      <button type="button" className="btn-primary w-full" disabled={busy || capabilities?.configured === false}
        onClick={capture}>
        {busy ? 'Capturing…' : 'Capture at true scale'}
      </button>
      <p className="text-[10px] leading-relaxed text-ink-subtle">
        Captured server-side so the API key stays private and the scale is computed from the projection
        rather than trusted from the browser.
      </p>
    </div>
  );
}
