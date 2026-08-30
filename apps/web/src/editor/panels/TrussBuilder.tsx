import { useMemo } from 'react';
import { AlertTriangle, Anchor, Plus } from 'lucide-react';
import {
  deriveTruss,
  formatLength,
  regionPack,
  TRUSS_LEG_LABELS,
  TRUSS_LEG_TYPES,
  TRUSS_SHAPE_INFO,
  TRUSS_SHAPES,
  defaultTrussSystemForRegion,
  trussShapePoints,
  trussSystemsForRegion,
  type TrussLegType,
  type TrussSceneObject,
  type TrussShape,
} from '@novira/shared';
import { useEditor } from '../editorStore';
import { TrussThumb } from '../BuilderThumb';
import { createTruss, uniqueName } from '../factories';
import { Field, FindingCard, LengthField, NumberField, Section, Segmented, Stat, Toggle } from '../../components/ui';

/**
 * The truss builder.
 *
 * Truss is specified in the order a production manager thinks about it: what
 * shape, how big, how high, how it stands up — and only then which section,
 * because the section is a consequence of the span and the load rather than a
 * starting point.
 *
 * The derived panel underneath is the whole reason this is a builder and not a
 * catalogue item. Length, weight, load per support and the span warning update
 * as the sliders move, so someone finds out that an 18 m span will not work
 * while they are drawing it, not when a rigger reads the drawing.
 */
export function TrussBuilder() {
  const selected = useEditor((s) =>
    s.scene.objects.find((o) => o.id === s.selectedIds[0] && o.type === 'truss')
  ) as TrussSceneObject | undefined;
  const objects = useEditor((s) => s.scene.objects);
  const units = useEditor((s) => s.scene.units);
  const regionCode = useEditor((s) => s.scene.regionCode);
  const addObjects = useEditor((s) => s.addObjects);
  const updateObject = useEditor((s) => s.updateObject);
  const readOnly = useEditor((s) => s.readOnly);

  const region = regionPack(regionCode);
  const systems = useMemo(() => trussSystemsForRegion(region.trussRegion), [region.trussRegion]);
  /*
   * The list is ordered lightest first, which is how it should be read but not
   * what a new run should start on — the lightest entry is a decorative ladder
   * section, and an 8 m goalpost built on it is over span before anyone has
   * touched a control.
   */
  const defaultSystem = useMemo(() => defaultTrussSystemForRegion(region.trussRegion), [region.trussRegion]);

  if (!selected) {
    return (
      <Section
        title="Add truss"
        description="A run of truss: a goalpost over a stage, a grid over a dance floor, an arch at an entrance. Pick a shape and it lands in the middle of the plan, ready to move."
      >
        <div className="grid grid-cols-2 gap-1.5">
          {TRUSS_SHAPES.filter((shape) => shape !== 'custom').map((shape) => {
            const info = TRUSS_SHAPE_INFO[shape];
            return (
              <button
                key={shape}
                type="button"
                disabled={readOnly}
                onClick={() => {
                  const truss = createTruss({
                    shape,
                    systemKey: defaultSystem.key,
                    name: uniqueName(objects, info.label),
                  });
                  addObjects([truss]);
                }}
                className="rounded-lg border border-line bg-surface-muted/40 p-2 text-left transition hover:border-primary/60 hover:bg-primary/10 disabled:opacity-40"
              >
                <TrussShapeDiagram shape={shape} />
                <p className="mt-1.5 text-[11px] font-semibold text-ink">{info.label}</p>
                <p className="mt-0.5 text-[10px] leading-snug text-ink-subtle">{info.note}</p>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] leading-snug text-ink-subtle">
          A new run starts on <strong className="text-ink-muted">{defaultSystem.label}</strong>, the general-purpose
          section stocked in {region.label}. Change it below once the run is drawn — the span check will tell you if it
          is not up to the job.
        </p>
      </Section>
    );
  }

  const derived = deriveTruss({
    systemKey: selected.systemKey,
    points: selected.points ?? [],
    closed: selected.closed,
    trimHeightMm: selected.trimHeightMm,
    legType: selected.legType,
    hangingLoadKg: selected.hangingLoadKg,
  });

  const bounds = (selected.points ?? []).reduce(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.xMm),
      maxX: Math.max(acc.maxX, p.xMm),
      minZ: Math.min(acc.minZ, p.zMm),
      maxZ: Math.max(acc.maxZ, p.zMm),
    }),
    { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }
  );
  const widthMm = Math.max(500, bounds.maxX - bounds.minX);
  const depthMm = Math.max(500, bounds.maxZ - bounds.minZ);

  const patch = (changes: Partial<TrussSceneObject>) => updateObject(selected.id, changes);

  const reshape = (shape: TrussShape, w = widthMm, d = depthMm) => {
    const info = TRUSS_SHAPE_INFO[shape];
    patch({
      shape,
      points: trussShapePoints(shape, w, d),
      closed: info.closes,
      legType: info.legs ? selected.legType : 'flown',
    });
  };

  return (
    <>
      <Section title="Shape and size" help="The run is a path in plan. Change the shape and the path is rebuilt at the same overall size.">
        <Segmented
          value={selected.shape}
          columns={2}
          options={TRUSS_SHAPES.filter((s) => s !== 'custom').map((shape) => ({
            value: shape,
            label: TRUSS_SHAPE_INFO[shape].label,
            hint: TRUSS_SHAPE_INFO[shape].note,
          }))}
          onChange={(shape) => reshape(shape)}
        />

        <LengthField
          label="Width"
          valueMm={widthMm}
          units={units}
          minMm={1000}
          maxMm={60_000}
          onChange={(mm) => reshape(selected.shape, mm, depthMm)}
          help="The span across the run. This is the number that decides whether the section is legal."
        />

        {selected.shape === 'square' || selected.shape === 'u-shape' || selected.shape === 'circle' || selected.shape === 'arch' ? (
          <LengthField
            label="Depth"
            valueMm={depthMm}
            units={units}
            minMm={1000}
            maxMm={60_000}
            onChange={(mm) => reshape(selected.shape, widthMm, mm)}
          />
        ) : null}

        <LengthField
          label="Trim height"
          valueMm={selected.trimHeightMm}
          units={units}
          minMm={1500}
          maxMm={25_000}
          onChange={(mm) => patch({ trimHeightMm: mm })}
          help="Height to the underside of the horizontal run — what a rigger means by trim. Everything hung from it starts here."
        />
      </Section>

      <Section title="How it stands up" help="Ground support needs floor space and ballast. Flying needs points in the roof, and the venue has to allow it.">
        <Segmented
          value={selected.legType}
          columns={2}
          options={TRUSS_LEG_TYPES.map((legType) => ({
            value: legType,
            label: TRUSS_LEG_LABELS[legType].replace('Legs on ', '').replace('Flown from ', 'Flown'),
            hint: TRUSS_LEG_LABELS[legType],
          }))}
          onChange={(legType) => patch({ legType: legType as TrussLegType })}
        />

        <NumberField
          label="Hung load"
          value={selected.hangingLoadKg}
          onChange={(hangingLoadKg) => patch({ hangingLoadKg })}
          min={0}
          max={5000}
          step={10}
          suffix="kg"
          help="Everything you will hang from this run — fixtures, screens, banners, drapes. Leave it at zero and the check cannot tell you whether the section is up to it."
        />
      </Section>

      <Section title="Section" description="Chosen last, because it is a consequence of the span and the load rather than a starting point.">
        <Field label="Truss system" help={`Only sections stocked in ${region.label} are listed. A section nobody local holds is a section on a boat.`}>
          {/*
            Drawn, not listed. The difference between a triangle and a box is
            the whole decision, it is invisible in a dropdown, and it is
            immediate in a section — so each row carries the actual section,
            generated from the same numbers the geometry is built from.
          */}
          <ul className="space-y-1">
            {systems.map((system) => {
              const chosen = system.key === selected.systemKey;
              return (
                <li key={system.key}>
                  <button
                    type="button"
                    onClick={() => patch({ systemKey: system.key })}
                    aria-pressed={chosen}
                    className={`flex w-full items-center gap-2 rounded-lg border p-1.5 text-left transition ${
                      chosen
                        ? 'border-primary bg-primary-soft'
                        : 'border-line bg-surface hover:border-primary/50 hover:bg-surface-muted'
                    }`}
                  >
                    <TrussThumb system={system} className="h-8 w-[72px] shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-semibold text-ink">{system.label}</span>
                      <span className="block truncate text-[10px] tabular-nums text-ink-subtle">
                        {system.chords === 2 ? 'Ladder' : system.chords === 3 ? 'Triangle' : 'Box'} ·{' '}
                        {system.widthMm} mm · {(system.maxSpanMm / 1000).toFixed(0)} m span
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Field>
        <p className="field-hint">{derived.system.note}</p>

        <Toggle
          label="Show bracing"
          checked={selected.showBracing}
          onChange={(showBracing) => patch({ showBracing })}
          hint="Draws the diagonals. Turn it off on a very large grid if the viewport slows down."
        />
      </Section>

      <Section title="What this needs" description="Derived from the run as drawn. These are the figures a rigger will ask for.">
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Total length" value={formatLength(derived.totalLengthMm, units)} />
          <Stat
            label="Longest span"
            value={formatLength(derived.longestSpanMm, units)}
            tone={derived.longestSpanMm > derived.system.maxSpanMm ? 'bad' : derived.longestSpanMm > derived.system.maxSpanMm * 0.85 ? 'warn' : 'good'}
            help={`This section is rated to ${(derived.system.maxSpanMm / 1000).toFixed(1)} m between supports.`}
          />
          <Stat label="Total weight" value={`${derived.totalWeightKg} kg`} />
          <Stat
            label="Per support"
            value={`${derived.loadPerSupportKg} kg`}
            help="What each leg or rigging point carries, assuming the load is spread evenly."
          />
        </div>

        <div className="mt-2.5 space-y-1">
          {derived.bom.map((line) => (
            <div key={line.code} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate text-ink-muted">{line.description}</span>
              <span className="shrink-0 font-semibold tabular-nums text-ink">×{line.quantity}</span>
            </div>
          ))}
        </div>
      </Section>

      {derived.warnings.length ? (
        <Section title="Check this" help="Raised from the run as drawn. Each one names the limit it applied so you can check it against your own supplier.">
          <div className="space-y-1.5">
            {derived.warnings.map((warning, i) => (
              <FindingCard
                key={i}
                severity={warning.severity === 'error' ? 'error' : 'warning'}
                title={warning.severity === 'error' ? 'This will not work as drawn' : 'Worth checking'}
                detail={warning.message}
              />
            ))}
          </div>
        </Section>
      ) : (
        <Section title="Check this">
          <FindingCard
            severity="success"
            title="Within the section's limits"
            detail={`A ${formatLength(derived.longestSpanMm, units)} span on ${derived.system.label}, carrying ${derived.totalWeightKg} kg across ${Math.max(2, derived.legCount)} supports.`}
          />
        </Section>
      )}

      <Section title="Add another">
        <button
          type="button"
          className="ed-action w-full justify-center border border-line"
          disabled={readOnly}
          onClick={() => {
            const copy = createTruss({
              shape: selected.shape,
              systemKey: selected.systemKey,
              widthMm,
              depthMm,
              trimHeightMm: selected.trimHeightMm,
              legType: selected.legType,
              position: { x: selected.positionMm.x, y: 0, z: selected.positionMm.z + depthMm + 3000 },
              name: uniqueName(objects, TRUSS_SHAPE_INFO[selected.shape].label),
            });
            addObjects([copy]);
          }}
        >
          <Plus className="h-3.5 w-3.5" /> Duplicate this run
        </button>
      </Section>
    </>
  );
}

/**
 * A diagram of the shape, drawn from the same generator the object uses.
 *
 * The picture cannot promise something the result does not deliver, which is
 * the same reason the layout presets carry generated diagrams rather than
 * hand-drawn ones.
 */
function TrussShapeDiagram({ shape }: { shape: TrussShape }) {
  const points = useMemo(() => trussShapePoints(shape, 8000, 6000), [shape]);
  const info = TRUSS_SHAPE_INFO[shape];

  const path = useMemo(() => {
    if (!points.length) return '';
    const xs = points.map((p) => p.xMm);
    const zs = points.map((p) => p.zMm);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs, 0);
    const maxZ = Math.max(...zs, 0);
    const spanX = maxX - minX || 1;
    const spanZ = maxZ - minZ || 1;
    const scale = Math.min(56 / spanX, 26 / spanZ);

    const project = (p: { xMm: number; zMm: number }) => [
      32 + (p.xMm - (minX + maxX) / 2) * scale,
      18 + (p.zMm - (minZ + maxZ) / 2) * scale,
    ];

    const start = project(points[0]!);
    let d = `M ${start[0]!.toFixed(1)} ${start[1]!.toFixed(1)}`;
    for (const point of points.slice(1)) {
      const [x, y] = project(point);
      d += ` L ${x!.toFixed(1)} ${y!.toFixed(1)}`;
    }
    if (info.closes) d += ' Z';
    return d;
  }, [points, info.closes]);

  return (
    <svg viewBox="0 0 64 36" className="h-9 w-full" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} className="text-primary" strokeLinejoin="round" />
      {info.legs && shape !== 'circle' ? (
        <>
          <circle cx={6} cy={30} r={2} className="fill-ink-subtle" />
          <circle cx={58} cy={30} r={2} className="fill-ink-subtle" />
        </>
      ) : (
        <Anchor className="hidden" />
      )}
    </svg>
  );
}

export function TrussWarningBadge({ truss }: { truss: TrussSceneObject }) {
  const derived = deriveTruss({
    systemKey: truss.systemKey,
    points: truss.points ?? [],
    closed: truss.closed,
    trimHeightMm: truss.trimHeightMm,
    legType: truss.legType,
    hangingLoadKg: truss.hangingLoadKg,
  });
  if (!derived.warnings.some((w) => w.severity === 'error')) return null;
  return (
    <span className="badge-danger">
      <AlertTriangle className="h-2.5 w-2.5" /> Over span
    </span>
  );
}
