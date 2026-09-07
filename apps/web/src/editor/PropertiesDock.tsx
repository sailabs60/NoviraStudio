import { useEffect, useMemo, useState } from 'react';
import { Activity, Brush, ChevronDown, Layers, MousePointerClick, Sliders, Sun, X } from 'lucide-react';
import {
  LIGHTING_PRESETS,
  builtInMaterial,
  formatLength,
  type SurfaceFinish,
} from '@novira/shared';
import { ResizeHandle, useStoredSize } from '../components/ResizeHandle';
import { useEditor } from './editorStore';
import { useSelectedObjects } from './selectors';
import { partsOfObject } from './picking';
import { PropertiesPanel } from './PropertiesPanel';
import { SceneTree } from './SceneTree';
import { useDrag } from './dragStore';

/**
 * The right sidebar: Properties & Simulation.
 *
 * It sits on the right because that is where a designer's hand already is when
 * something is selected in the middle of the screen, and because the left side
 * belongs to *finding* things while the right belongs to *changing* them.
 * Mixing the two — which an earlier arrangement did — meant the catalogue and
 * the thing you had just placed fought over the same column.
 *
 * The dock answers exactly two questions, and it is split accordingly:
 *
 *  · **Properties** — what is this object, and how do I change it. Empty until
 *    something is selected, and honest about being empty rather than filling
 *    the space with controls that would do nothing.
 *  · **Simulation** — what is the room doing. Light, shadow, environment, and
 *    the live counts that tell you whether the plan is still sane.
 *
 * The tab is chosen for the user on selection, because someone who has just
 * clicked a chair wants its properties, not the sun angle.
 */
export function PropertiesDock({ onClose }: { onClose?: () => void }) {
  const selected = useSelectedObjects();
  const [tab, setTab] = useState<'properties' | 'scene' | 'simulation'>('simulation');

  // Follow the selection. Selecting something is an unambiguous request to see
  // its properties; deselecting everything leaves the tab alone, because
  // yanking the panel away mid-edit is worse than a stale tab.
  // A specification with long material names wants a wider dock than a
  // transform with three numbers in it.
  const [width, setWidth, resetWidth] = useStoredSize('rightDock', 312);

  useEffect(() => {
    if (selected.length) setTab('properties');
  }, [selected.length]);

  return (
    <>
      {/*
        The handle sits on the dock's *outer* edge, between it and the
        viewport, so the dock itself does not move — only its width changes.
      */}
      <ResizeHandle
        side="left"
        size={width}
        onResize={setWidth}
        onReset={resetWidth}
        min={260}
        max={640}
        label="Properties width"
      />
    <aside
      aria-label="Properties and simulation"
      className="flex shrink-0 flex-col border-l border-line bg-surface"
      style={{ width }}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <Sliders className="h-4 w-4 shrink-0 text-ink-subtle" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">Properties &amp; Simulation</h2>
        {onClose ? (
          <button type="button" className="icon-btn-bare" onClick={onClose} aria-label="Hide the properties panel">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </header>

      <div className="shrink-0 border-b border-line px-3 py-2">
        <div className="ed-segment w-full">
          <button
            type="button"
            onClick={() => setTab('properties')}
            className={`ed-segment-btn flex-1 ${tab === 'properties' ? 'ed-segment-btn-active' : ''}`}
          >
            Properties
            {selected.length ? (
              <span className="ml-1 rounded bg-primary px-1 text-[9px] font-bold text-primary-fg">
                {selected.length}
              </span>
            ) : null}
          </button>
          {/*
            The scene tree, beside the other two rather than instead of either.
            A generated event is several hundred objects and the viewport is the
            only way to reach one of them; "chair 17 of table 12" is findable
            here and nowhere else.
          */}
          <button
            type="button"
            onClick={() => setTab('scene')}
            className={`ed-segment-btn flex-1 ${tab === 'scene' ? 'ed-segment-btn-active' : ''}`}
          >
            Scene
          </button>
          <button
            type="button"
            onClick={() => setTab('simulation')}
            className={`ed-segment-btn flex-1 ${tab === 'simulation' ? 'ed-segment-btn-active' : ''}`}
          >
            Simulation
          </button>
        </div>
      </div>

      {/*
        The scene tree scrolls itself, because it has its own search box that
        has to stay put while the list moves under it.
      */}
      {tab === 'scene' ? (
        <div className="flex min-h-0 flex-1 flex-col pt-2">
          <SceneTree />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'properties' ? (
            selected.length === 0 ? (
              <NothingSelected />
            ) : (
              <>
                <PropertiesPanel />
                {selected.length === 1 ? <FinishesSection objectId={selected[0]!.id} /> : null}
              </>
            )
          ) : (
            <SimulationTab />
          )}
        </div>
      )}
    </aside>
    </>
  );
}

/* ── Empty state ───────────────────────────────────────────────────────── */

/**
 * What to do when nothing is selected.
 *
 * An empty properties panel is the moment a new user decides whether a tool is
 * for them. A blank column reads as broken; a column of greyed-out controls
 * reads as a wall. Naming the next action reads as a tool that knows what you
 * are trying to do.
 */
function NothingSelected() {
  const objectCount = useEditor((s) => s.scene.objects.length);
  const setWorkPanel = useEditor((s) => s.setWorkPanel);

  return (
    <div className="px-4 py-8 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-muted text-ink-subtle">
        <MousePointerClick className="h-5 w-5" />
      </span>
      <p className="mt-3 text-sm font-semibold text-ink">Nothing selected</p>
      <p className="mx-auto mt-1 max-w-[220px] text-xs leading-relaxed text-ink-subtle">
        {objectCount
          ? 'Click anything in the plan and its position, size, finish and options appear here.'
          : 'Add something to the plan and it will be editable here.'}
      </p>
      {!objectCount ? (
        <button type="button" className="btn-secondary btn-sm mx-auto mt-3" onClick={() => setWorkPanel('add')}>
          Open the library
        </button>
      ) : null}
    </div>
  );
}

/* ── Finishes ──────────────────────────────────────────────────────────── */

/**
 * The parts of the selected object, and what each is finished in.
 *
 * This is the half of "materials work on every object" that dragging cannot
 * do. Dropping a material onto a surface is fast and obvious, but it needs the
 * surface to be visible and hittable — a counter's kick plate, the underside of
 * a table, a truss chord seen edge-on. The parts list makes every surface
 * reachable regardless of the camera, and it is also the only place you can
 * see what has already been applied and take it off again.
 *
 * The list is read from the rendered scene, not the document: the parts of a
 * glTF are a property of the file, and the plan has never seen them.
 */
function FinishesSection({ objectId }: { objectId: string }) {
  const object = useEditor((s) => s.scene.objects.find((o) => o.id === objectId));
  const applyFinish = useEditor((s) => s.applyFinish);
  const clearFinish = useEditor((s) => s.clearFinish);
  const clearAllFinishes = useEditor((s) => s.clearAllFinishes);
  const readOnly = useEditor((s) => s.readOnly);
  const dragPayload = useDrag((s) => s.payload);

  const [open, setOpen] = useState(true);
  const [parts, setParts] = useState<Array<{ part: string; label: string }>>([]);

  /*
   * Re-read after a frame. The model may still be loading when the selection
   * changes, and asking the scene graph for parts before the glTF has been
   * added returns nothing — which reads as "this object has no parts" rather
   * than "not yet".
   */
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      if (cancelled) return;
      const found = partsOfObject(objectId);
      setParts(found);
      if (!found.length) window.setTimeout(read, 450);
    };
    read();
    return () => {
      cancelled = true;
    };
  }, [objectId]);

  const finishes = object?.finishes ?? {};
  const applied = Object.keys(finishes).length;

  const target = useEditor((st) => st.finishTarget);
  const setTarget = useEditor((st) => st.setFinishTarget);

  /*
   * A part stops being the target when the selection moves on. Leaving it
   * aimed at an object nobody has selected any more is how a click in the
   * material library ends up painting something off-screen.
   */
  useEffect(() => {
    if (target && target.objectId !== objectId) setTarget(null);
  }, [objectId, target, setTarget]);

  const rows = useMemo(() => {
    // Always offer "the whole object", first — it is what most drops mean and
    // what someone wants when a model has one anonymous material.
    const base = [{ part: '*', label: 'Whole object' }];
    return [...base, ...parts.filter((p) => p.part !== '*')];
  }, [parts]);

  const dragging = dragPayload?.kind === 'material' ? dragPayload.finish : null;

  return (
    <section className="border-b border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
        aria-expanded={open}
      >
        <Brush className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
        <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-subtle">
          Finishes
        </span>
        {applied ? <span className="badge-info">{applied}</span> : null}
        <ChevronDown className={`h-3.5 w-3.5 text-ink-subtle transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div className="px-3.5 pb-3">
          <p className="mb-2 text-[10px] leading-relaxed text-ink-subtle">
            Drag a material from the library onto any surface in the 3D view, or drop it on a row here.
            <strong className="font-semibold text-ink-muted"> Click a row</strong> to aim the library at that part —
            useful for anything you cannot easily hit with a cursor, like a truss chord seen edge-on or the
            underside of a deck. Each part keeps its own finish.
          </p>

          <ul className="space-y-1">
            {rows.map((row) => {
              const finish = finishes[row.part];
              const aimed = target?.objectId === objectId ? target.part : null;
              return (
                <li key={row.part}>
                  <div
                    onDragOver={(e) => {
                      if (!dragging || readOnly) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                    }}
                    onDrop={(e) => {
                      if (!dragging || readOnly) return;
                      e.preventDefault();
                      e.stopPropagation();
                      applyFinish(objectId, row.part, dragging);
                      useDrag.getState().end();
                    }}
                    role="button"
                    tabIndex={0}
                    aria-pressed={aimed === row.part}
                    onClick={() => setTarget(aimed === row.part ? null : { objectId, part: row.part })}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      setTarget(aimed === row.part ? null : { objectId, part: row.part });
                    }}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 transition ${
                      dragging
                        ? 'border-dashed border-primary/50 bg-primary-soft/60'
                        : aimed === row.part
                          ? 'border-primary bg-primary-soft ring-1 ring-primary/30'
                          : finish
                            ? 'border-line bg-surface-muted hover:border-primary/40'
                            : 'border-line bg-surface hover:border-primary/40'
                    }`}
                  >
                    <span
                      className="h-6 w-6 shrink-0 overflow-hidden rounded border border-line"
                      style={{ background: finish?.colorHex ?? 'transparent' }}
                    >
                      {finish?.previewUrl || finish?.maps?.color ? (
                        <img
                          src={finish.previewUrl ?? finish.maps?.color}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-semibold capitalize text-ink">
                        {row.label}
                      </span>
                      <span className="block truncate text-[10px] text-ink-subtle">
                        {finish ? finish.label : 'As supplied'}
                      </span>
                    </span>
                    {finish ? (
                      <button
                        type="button"
                        className="icon-btn-bare h-6 w-6"
                        disabled={readOnly}
                        onClick={(event) => {
                          event.stopPropagation();
                          clearFinish(objectId, row.part);
                        }}
                        aria-label={`Remove the finish from ${row.label}`}
                        title="Remove this finish"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>

                  {finish ? <FinishControls objectId={objectId} part={row.part} finish={finish} /> : null}
                </li>
              );
            })}
          </ul>

          {applied ? (
            <button
              type="button"
              className="ed-action mt-2 w-full justify-center"
              disabled={readOnly}
              onClick={() => clearAllFinishes(objectId)}
            >
              Reset every finish
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Tiling and tint for one applied finish.
 *
 * Tile size is in millimetres because that is what a material *is* — a 300 mm
 * tile is 300 mm on a coffee table and on a 40 m backwall. Expressing it as a
 * repeat count, as most 3D tools do, produces a floor that changes scale when
 * the room is resized, which is the fastest way to make a render look fake.
 */
function FinishControls({
  objectId,
  part,
  finish,
}: {
  objectId: string;
  part: string;
  finish: SurfaceFinish;
}) {
  const applyFinish = useEditor((s) => s.applyFinish);
  const readOnly = useEditor((s) => s.readOnly);
  const units = useEditor((s) => s.units);

  const patch = (next: Partial<SurfaceFinish>) => applyFinish(objectId, part, { ...finish, ...next });
  const library = builtInMaterial(finish.materialId);

  return (
    <div className="ml-8 mt-1 space-y-1.5 border-l border-line pl-2.5">
      <label className="block">
        <span className="ed-label mb-0.5">
          Tile size · {formatLength(finish.tileMm, units)}
        </span>
        <input
          type="range"
          min={20}
          max={3000}
          step={10}
          value={finish.tileMm}
          disabled={readOnly}
          className="w-full accent-primary"
          onChange={(e) => patch({ tileMm: Number(e.target.value) })}
        />
      </label>

      <div className="flex items-center gap-2">
        <label className="flex flex-1 items-center gap-1.5">
          <span className="ed-label mb-0">Tint</span>
          <input
            type="color"
            value={finish.colorHex}
            disabled={readOnly}
            onChange={(e) => patch({ colorHex: e.target.value })}
            className="h-6 w-8 cursor-pointer rounded border border-line bg-transparent"
          />
        </label>
        <label className="flex flex-1 items-center gap-1.5">
          <span className="ed-label mb-0">Angle</span>
          <input
            type="number"
            min={0}
            max={359}
            value={Math.round(finish.rotationDeg ?? 0)}
            disabled={readOnly}
            onChange={(e) => patch({ rotationDeg: Number(e.target.value) })}
            className="ed-field h-6 py-0"
          />
        </label>
      </div>

      {library?.costPerSqM ? (
        <p className="text-[10px] text-ink-subtle">
          Costed at the rate card's rate for {library.label.toLowerCase()}.
        </p>
      ) : null}
    </div>
  );
}

/* ── Simulation ────────────────────────────────────────────────────────── */

/**
 * The room, rather than the object.
 *
 * Everything here changes how the whole plan looks or behaves, which is why it
 * is a separate tab instead of a section that sits under the properties of
 * whatever happens to be selected. Someone adjusting the sun is not thinking
 * about a chair.
 */
function SimulationTab() {
  const lighting = useEditor((s) => s.scene.lighting);
  const commit = useEditor((s) => s.commit);
  const setEnvironmentHdri = useEditor((s) => s.setEnvironmentHdri);
  const readOnly = useEditor((s) => s.readOnly);
  const objects = useEditor((s) => s.scene.objects);
  const floorFinish = useEditor((s) => s.scene.floorFinish);
  const setFloorFinish = useEditor((s) => s.setFloorFinish);
  const collisionCheck = useEditor((s) => s.scene.collisionCheck);
  const showConstraints = useEditor((s) => s.scene.showConstraints);

  const counts = useMemo(() => {
    const by = new Map<string, number>();
    for (const object of objects) by.set(object.type, (by.get(object.type) ?? 0) + 1);
    return [...by.entries()].sort((a, b) => b[1] - a[1]);
  }, [objects]);

  const seats = useMemo(
    () =>
      objects.reduce(
        (sum, o) => sum + (o.type === 'catalog' ? ((o as { seatsDefault?: number | null }).seatsDefault ?? 0) : 0),
        0
      ),
    [objects]
  );

  return (
    <>
      <section className="ed-section">
        <h3 className="ed-section-title flex items-center gap-1.5">
          <Sun className="h-3 w-3" /> Environment
        </h3>

        {lighting.customHdriUrl ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary-soft px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-primary">
              {lighting.customHdriLabel ?? 'Custom environment'}
            </span>
            <button
              type="button"
              className="icon-btn-bare h-6 w-6 text-primary"
              disabled={readOnly}
              onClick={() => setEnvironmentHdri(null)}
              aria-label="Remove the custom environment"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : null}

        <label className="ed-label" htmlFor="sim-preset">
          Sky
        </label>
        <select
          id="sim-preset"
          className="ed-field mb-3"
          value={lighting.preset}
          disabled={readOnly || Boolean(lighting.customHdriUrl)}
          onChange={(e) =>
            commit((draft) => {
              draft.lighting.preset = e.target.value as typeof lighting.preset;
            })
          }
        >
          {LIGHTING_PRESETS.map((preset) => (
            <option key={preset.key} value={preset.key}>
              {preset.label}
            </option>
          ))}
        </select>
        {/*
          The full chooser, one click away. This tab carries the two controls
          people reach for constantly; everything else about the environment —
          the curated skies, thousands more online, rotation, background — is a
          window of its own rather than a fifth slider crammed in here.
        */}
        <button
          type="button"
          className="ed-action mb-3 w-full justify-center border border-line"
          onClick={() => window.dispatchEvent(new CustomEvent('novira:open-environment'))}
        >
          <Sun className="h-3.5 w-3.5" /> Choose an environment…
        </button>
        <p className="mb-3 text-[10px] leading-relaxed text-ink-subtle">
          Or drag one from the library straight onto the 3D view.
        </p>

        <label className="ed-label" htmlFor="sim-height">
          Sun height · {lighting.heightZ.toFixed(1)} m
        </label>
        <input
          id="sim-height"
          type="range"
          min={1}
          max={30}
          step={0.5}
          value={lighting.heightZ}
          disabled={readOnly}
          className="mb-3 w-full accent-primary"
          onChange={(e) =>
            commit((draft) => {
              draft.lighting.heightZ = Number(e.target.value);
            })
          }
        />

        <label className="ed-label" htmlFor="sim-intensity">
          Brightness · {Math.round(lighting.intensity * 100)}%
        </label>
        <input
          id="sim-intensity"
          type="range"
          min={0.2}
          max={2}
          step={0.05}
          value={lighting.intensity}
          disabled={readOnly}
          className="mb-3 w-full accent-primary"
          onChange={(e) =>
            commit((draft) => {
              draft.lighting.intensity = Number(e.target.value);
            })
          }
        />

        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {(
            [
              ['shadowsEnabled', 'Shadows'],
              ['glowEnabled', 'Glow'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-line accent-primary"
                checked={lighting[key]}
                disabled={readOnly}
                onChange={(e) =>
                  commit((draft) => {
                    draft.lighting[key] = e.target.checked;
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className="ed-section">
        <h3 className="ed-section-title flex items-center gap-1.5">
          <Layers className="h-3 w-3" /> Floor
        </h3>
        {floorFinish ? (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-muted px-2 py-1.5">
            <span
              className="h-6 w-6 shrink-0 overflow-hidden rounded border border-line"
              style={{ background: floorFinish.colorHex }}
            />
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink">
              {floorFinish.label}
            </span>
            <button
              type="button"
              className="icon-btn-bare h-6 w-6"
              disabled={readOnly}
              onClick={() => setFloorFinish(null)}
              aria-label="Remove the floor finish"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <p className="text-[11px] leading-relaxed text-ink-subtle">
            Drop a material on empty floor to carpet or surface the whole room. It is measured by area and
            priced with everything else.
          </p>
        )}
      </section>

      <section className="ed-section">
        <h3 className="ed-section-title flex items-center gap-1.5">
          <Activity className="h-3 w-3" /> Checks
        </h3>
        <label className="mb-2 flex items-start gap-2 text-[11px] text-ink-muted">
          <input
            type="checkbox"
            className="mt-0.5 h-3.5 w-3.5 rounded border-line accent-primary"
            checked={collisionCheck}
            disabled={readOnly}
            onChange={(e) =>
              commit((draft) => {
                draft.collisionCheck = e.target.checked;
              })
            }
          />
          <span>
            Flag overlaps
            <span className="block text-[10px] text-ink-subtle">
              Off by default — a chair tucked under a table is not a mistake.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-[11px] text-ink-muted">
          <input
            type="checkbox"
            className="mt-0.5 h-3.5 w-3.5 rounded border-line accent-primary"
            checked={showConstraints}
            disabled={readOnly}
            onChange={(e) =>
              commit((draft) => {
                draft.showConstraints = e.target.checked;
              })
            }
          />
          <span>
            Show site constraints
            <span className="block text-[10px] text-ink-subtle">
              Exits, rigging zones, truck routes and no-build areas.
            </span>
          </span>
        </label>
      </section>

      <section className="ed-section border-b-0">
        <h3 className="ed-section-title">In this plan</h3>
        {objects.length === 0 ? (
          <p className="text-[11px] text-ink-subtle">Nothing placed yet.</p>
        ) : (
          <>
            <div className="mb-2 grid grid-cols-2 gap-1.5">
              <div className="stat-tile">
                <p className="stat-value">{objects.length}</p>
                <p className="stat-label">Objects</p>
              </div>
              <div className="stat-tile">
                <p className="stat-value">{seats || '—'}</p>
                <p className="stat-label">Seats</p>
              </div>
            </div>
            <ul className="space-y-0.5">
              {counts.map(([type, count]) => (
                <li key={type} className="flex items-center justify-between text-[11px]">
                  <span className="capitalize text-ink-subtle">{type}</span>
                  <span className="tabular-nums font-semibold text-ink">{count}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
