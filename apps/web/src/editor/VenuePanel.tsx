import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Loader2, Trash2 } from 'lucide-react';
import {
  formatLength,
  type VenueParams,
  type WallBlueprint,
  type SceneObject,
} from '@novira/shared';
import { http, ApiClientError } from '../lib/api';
import { Modal } from '../components/Modal';
import { useEditor } from './editorStore';

/**
 * Venue generation.
 *
 * Generates the building itself — walls, openings, roof and structure — as
 * opposed to what goes inside it.
 *
 * Two things drive the shape of this panel. First, the preview is free and
 * instant, so the capacity figures and warnings update as the sliders move and
 * a planner can settle on a size before spending anything. Second, generating
 * the mesh costs credits, so that button states its price and nothing is
 * charged until it is pressed.
 */

function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface StyleRow {
  style: VenueParams['style'];
  label: string;
  description: string;
  roof: string;
  walled: boolean;
  defaults: VenueParams;
}

interface Capacity {
  banquet: number;
  theatre: number;
  cocktail: number;
  classroom: number;
}

interface Preview {
  areaSqM: number;
  perimeterMm: number;
  capacity: Capacity;
  warnings: string[];
  openingCount: number;
  featureCount: number;
  walls: WallBlueprint;
}

interface VenueRow {
  id: number;
  name: string;
  assetUrl: string;
  createdAt: string;
  isOwner: boolean;
}

interface JobDto {
  id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  errorMessage: string | null;
  output: {
    venueId: number;
    name: string;
    assetUrl: string;
    walls: WallBlueprint;
    areaSqM: number;
    warnings: string[];
  } | null;
}

/** Slider with the value shown in the user's own units. */
function DimensionSlider({
  label,
  value,
  min,
  max,
  step,
  units,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  units: 'metric' | 'imperial';
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="label mb-0">{label}</span>
        <span className="text-xs font-semibold tabular-nums text-ink">{formatLength(value, units)}</span>
      </div>
      <input
        type="range"
        className="w-full accent-primary"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function VenuePanel() {
  const qc = useQueryClient();
  const readOnly = useEditor((s) => s.readOnly);
  const units = useEditor((s) => s.scene.units);
  const commit = useEditor((s) => s.commit);
  const requestFrameAll = useEditor((s) => s.requestFrameAll);

  const [open, setOpen] = useState(false);
  const [params, setParams] = useState<VenueParams | null>(null);
  const [name, setName] = useState('');
  const [job, setJob] = useState<JobDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: styles } = useQuery({
    queryKey: ['venues', 'styles'],
    queryFn: async () => (await http.get<{ items: StyleRow[] }>('/venues/styles')).data.items,
    enabled: open,
  });
  const { data: capability } = useQuery({
    queryKey: ['venues', 'capability'],
    queryFn: async () =>
      (await http.get<{ allowed: boolean; cost: number; reason?: string }>('/venues/capability')).data,
    enabled: open,
  });
  const { data: saved } = useQuery({
    queryKey: ['venues', 'list'],
    queryFn: async () => (await http.get<{ items: VenueRow[] }>('/venues')).data.items,
    enabled: open,
  });

  // Start on the first style once the catalogue arrives.
  useEffect(() => {
    if (!params && styles?.length) setParams(styles[0]!.defaults);
  }, [styles, params]);

  const { data: preview } = useQuery({
    queryKey: ['venues', 'preview', params],
    queryFn: async () => (await http.post<Preview>('/venues/preview', params)).data,
    enabled: open && Boolean(params),
  });

  const generate = useMutation({
    mutationFn: async () =>
      (
        await http.post<JobDto>('/venues/generate', {
          params,
          name: name.trim() || undefined,
        })
      ).data,
    onSuccess: (data) => {
      setJob(data);
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : 'Could not start the generation.'),
  });

  const removeVenue = useMutation({
    mutationFn: async (id: number) => (await http.delete(`/venues/${id}`)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['venues', 'list'] }),
  });

  /* Poll while a job is running. */
  useEffect(() => {
    if (!job || (job.status !== 'queued' && job.status !== 'in_progress')) return;
    const timer = setInterval(async () => {
      try {
        const next = (await http.get<JobDto>(`/venues/jobs/${job.id}`)).data;
        setJob(next);
        if (next.status === 'completed') {
          void qc.invalidateQueries({ queryKey: ['venues', 'list'] });
          void qc.invalidateQueries({ queryKey: ['billing'] });
        }
      } catch {
        /* keep polling; a dropped request is not a failure */
      }
    }, 900);
    return () => clearInterval(timer);
  }, [job, qc]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /**
   * Put the generated venue into the plan.
   *
   * Both halves matter and only one was being used. The wall blueprint is what
   * furniture snaps to and what the seating chart measures against; the built
   * mesh is the roof, the openings, the columns and the structure — everything
   * that makes it look like a building rather than four bare slabs. Applying
   * only the walls threw away the entire point of generating the model, which
   * is why the result looked like nothing had happened.
   */
  function applyToPlan(output: {
    venueId: number;
    name: string;
    assetUrl: string;
    walls: WallBlueprint;
    areaSqM: number;
  }) {
    commit((draft) => {
      /*
       * Only the floor, not the walls.
       *
       * The generated mesh already contains the walls, with the door and
       * window openings cut through them. Adding wall segments in the same
       * places would put two sets of walls in the same millimetres — they
       * would z-fight, and the editor walls have no openings, so the doors
       * would be bricked up. The floor polygon is kept because area and
       * seating capacity are measured from it.
       */
      // Set directly rather than through `rebuildBlueprint`: that derives
      // floors from wall segments, so handing it floors with no segments
      // returns nothing and the floor is quietly lost.
      draft.walls = { segments: [], floors: output.walls.floors };

      // Replace any previous venue rather than stacking shells on each other.
      draft.objects = draft.objects.filter(
        (o) => !(o.type === 'catalog' && (o as { venueId?: number }).venueId)
      );

      draft.objects.push({
        id: newId(),
        type: 'catalog',
        name: output.name,
        // Venues are generated, not catalogued, so there is no catalogue row to
        // point at; the model URL is carried directly.
        catalogItemId: 0,
        modelUrl: output.assetUrl,
        venueId: output.venueId,
        positionMm: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        // Locked on arrival: a venue is the room, and nudging it while placing
        // furniture inside it is never what someone meant to do.
        locked: true,
      } as SceneObject);
    });

    setOpen(false);
    setJob(null);
    // A venue is bigger than the current view, so show it rather than
    // leaving the camera inside a wall.
    requestFrameAll();
  }

  const running = job?.status === 'queued' || job?.status === 'in_progress';
  const cost = capability?.cost ?? 0;

  const capacityRows = useMemo(
    () =>
      preview
        ? ([
            ['Banquet (rounds of 10)', preview.capacity.banquet],
            ['Theatre', preview.capacity.theatre],
            ['Cocktail / standing', preview.capacity.cocktail],
            ['Classroom', preview.capacity.classroom],
          ] as const)
        : [],
    [preview]
  );

  const set = (patch: Partial<VenueParams>) => setParams((p) => (p ? { ...p, ...patch } : p));

  return (
    <>
      <button
        type="button"
        className="ed-action flex-col gap-1 py-2"
        disabled={readOnly}
        title="Generate a venue"
        onClick={() => setOpen(true)}
      >
        <Building2 className="h-4 w-4" />
        <span className="text-[10px]">Venue</span>
      </button>

      <Modal
        open={open}
        title="Generate a venue"
        description="Builds the room itself — walls, doors, windows, roof and structure — at the exact size you set."
        onClose={() => setOpen(false)}
        width="max-w-3xl"
        footer={
          <>
            {saved?.length ? (
              <span className="mr-auto text-xs text-ink-subtle">{saved.length} saved</span>
            ) : null}
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Close
            </button>
            {job?.status === 'completed' && job.output ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => applyToPlan(job.output!)}
              >
                Add to plan
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary"
                disabled={!params || running || generate.isPending || capability?.allowed === false}
                onClick={() => generate.mutate()}
              >
                {running ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Building… {job?.progress ?? 0}%
                  </>
                ) : (
                  <>Generate{cost > 0 ? ` · ${cost} credits` : ''}</>
                )}
              </button>
            )}
          </>
        }
      >
        {capability && !capability.allowed ? (
          <div className="notice-warning mb-3">{capability.reason}</div>
        ) : null}
        {error ? <div className="notice-error mb-3">{error}</div> : null}
        {job?.status === 'failed' ? (
          <div className="notice-error mb-3">
            {job.errorMessage ?? 'Generation failed.'} Your credits have been refunded.
          </div>
        ) : null}
        {job?.status === 'completed' ? (
          <div className="notice-success mb-3">
            Venue built. “Add to plan” drops its walls into this plan.
          </div>
        ) : null}

        {params ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <div>
                <span className="label">Style</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {styles?.map((s) => (
                    <button
                      key={s.style}
                      type="button"
                      onClick={() => setParams(s.defaults)}
                      className={`rounded-md border px-2 py-1.5 text-left text-xs transition ${
                        params.style === s.style
                          ? 'border-primary bg-primary/10 text-ink'
                          : 'border-line text-ink-muted hover:text-ink'
                      }`}
                    >
                      <span className="block font-semibold">{s.label}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-ink-subtle">
                  {styles?.find((s) => s.style === params.style)?.description}
                </p>
              </div>

              <DimensionSlider label="Width" value={params.widthMm} min={3000} max={60000} step={500}
                units={units} onChange={(v) => set({ widthMm: v })} />
              <DimensionSlider label="Depth" value={params.depthMm} min={3000} max={60000} step={500}
                units={units} onChange={(v) => set({ depthMm: v })} />
              <DimensionSlider label="Wall height" value={params.heightMm} min={2000} max={12000} step={100}
                units={units} onChange={(v) => set({ heightMm: v })} />

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="label">Entrances</span>
                  <input type="number" className="input" min={0} max={6} value={params.entrances}
                    onChange={(e) => set({ entrances: Number(e.target.value) })} />
                </label>
                <label className="block">
                  <span className="label">Windows per side</span>
                  <input type="number" className="input" min={0} max={12} value={params.windowsPerSide}
                    onChange={(e) => set({ windowsPerSide: Number(e.target.value) })} />
                </label>
              </div>

              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-sm text-ink-muted">
                  <input type="checkbox" checked={params.stageAlcove}
                    onChange={(e) => set({ stageAlcove: e.target.checked })} />
                  Stage alcove
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-muted">
                  <input type="checkbox" checked={params.columns}
                    onChange={(e) => set({ columns: e.target.checked })} />
                  Structural columns
                </label>
              </div>

              <label className="block">
                <span className="label">Name (optional)</span>
                <input className="input" value={name} placeholder="Main marquee"
                  onChange={(e) => setName(e.target.value)} />
              </label>
            </div>

            {/* Live, free preview. */}
            <div className="space-y-3">
              <div className="rounded-lg border border-line bg-surface-muted/40 p-3">
                <p className="text-xs text-ink-subtle">Floor area</p>
                <p className="text-2xl font-semibold text-ink">
                  {preview ? `${preview.areaSqM} m²` : '—'}
                </p>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {preview ? `${preview.openingCount} openings · ${preview.featureCount} structural parts` : ''}
                </p>
              </div>

              <div className="rounded-lg border border-line p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  Estimated capacity
                </p>
                <dl className="space-y-1 text-sm">
                  {capacityRows.map(([label, value]) => (
                    <div key={label} className="flex justify-between">
                      <dt className="text-ink-muted">{label}</dt>
                      <dd className="font-semibold tabular-nums text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-[11px] leading-snug text-ink-subtle">
                  Includes circulation and service space. Check local occupancy rules before
                  committing to numbers.
                </p>
              </div>

              {preview?.warnings.length ? (
                <div className="space-y-1.5">
                  {preview.warnings.map((w) => (
                    <div key={w} className="notice-warning text-xs">{w}</div>
                  ))}
                </div>
              ) : null}

              {saved?.length ? (
                <div className="rounded-lg border border-line p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                    Previously generated
                  </p>
                  <ul className="space-y-1">
                    {saved.slice(0, 5).map((v) => (
                      <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate text-ink-muted">{v.name}</span>
                        {v.isOwner ? (
                          <button type="button" className="icon-btn h-6 w-6"
                            aria-label={`Delete ${v.name}`}
                            onClick={() => removeVenue.mutate(v.id)}>
                            <Trash2 className="h-3 w-3" />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
