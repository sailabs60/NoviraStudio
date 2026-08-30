import { useMemo, useState } from 'react';
import { Grid3x3, Plus } from 'lucide-react';
import {
  BOOTH_FLOOR_FINISHES,
  BOOTH_FLOOR_FINISH_INFO,
  BOOTH_SIDES,
  BOOTH_SIDE_LABELS,
  BOOTH_SIZES,
  BOOTH_TYPES,
  BOOTH_TYPE_SPECS,
  BOOTH_WALL_FINISHES,
  BOOTH_WALL_FINISH_INFO,
  DEFAULT_BOOTH_REGULATIONS,
  deriveBooth,
  formatLength,
  generateBoothGrid,
  regionPack,
  type BoothFloorFinish,
  type BoothSceneObject,
  type BoothSide,
  type BoothType,
  type BoothWallFinish,
} from '@novira/shared';
import { useEditor } from '../editorStore';
import { createBooth } from '../factories';
import {
  ColorField,
  Field,
  FindingCard,
  LengthField,
  NumberField,
  Section,
  Segmented,
  Select,
  Stat,
  TextInput,
  Toggle,
  toast,
} from '../../components/ui';

/**
 * The stand builder.
 *
 * Exhibition work has two distinct jobs and they need different tools, so this
 * panel does both: designing *one* stand in detail, and laying out a *floor* of
 * them. Laying out a hall by dragging stands one at a time is the job this
 * product exists to remove.
 *
 * The organiser rules are shown as a live check rather than as a document to
 * read, because the failure they prevent — a build that gets rejected — costs
 * real money and always happens late.
 */
export function BoothBuilder() {
  const selected = useEditor((s) =>
    s.scene.objects.find((o) => o.id === s.selectedIds[0] && o.type === 'booth')
  ) as BoothSceneObject | undefined;

  return selected ? <BoothEditor booth={selected} /> : <BoothStart />;
}

/* ── Adding ────────────────────────────────────────────────────────────── */

function BoothStart() {
  const objects = useEditor((s) => s.scene.objects);
  const addObjects = useEditor((s) => s.addObjects);
  const regionCode = useEditor((s) => s.scene.regionCode);
  const readOnly = useEditor((s) => s.readOnly);
  const region = regionPack(regionCode);

  const [mode, setMode] = useState<'single' | 'floor'>('single');
  const [columns, setColumns] = useState(6);
  const [rows, setRows] = useState(4);
  const [sizeKey, setSizeKey] = useState(region.code === 'north-america' ? '10x10ft' : '3x3');
  const [aisleMm, setAisleMm] = useState(region.regulations.minAisleMm);
  const [backToBack, setBackToBack] = useState(true);

  const size = BOOTH_SIZES.find((s) => s.key === sizeKey) ?? BOOTH_SIZES[0]!;
  const preview = useMemo(
    () =>
      generateBoothGrid({
        columns,
        rows,
        boothWidthMm: size.widthMm,
        boothDepthMm: size.depthMm,
        aisleWidthMm: aisleMm,
        backToBack,
        gapMm: 0,
      }),
    [columns, rows, size.widthMm, size.depthMm, aisleMm, backToBack]
  );

  const footprintM = useMemo(() => {
    const xs = preview.map((p) => p.centre.xMm);
    const zs = preview.map((p) => p.centre.zMm);
    if (!xs.length) return { w: 0, d: 0 };
    return {
      w: (Math.max(...xs) - Math.min(...xs) + size.widthMm) / 1000,
      d: (Math.max(...zs) - Math.min(...zs) + size.depthMm) / 1000,
    };
  }, [preview, size.widthMm, size.depthMm]);

  return (
    <>
      <Section
        title="Add stands"
        description="One stand to design in detail, or a whole floor of them laid out on the grid a hall is actually sold in."
      >
        <Segmented
          value={mode}
          columns={2}
          options={[
            { value: 'single', label: 'One stand', hint: 'Design a single stand in detail.' },
            { value: 'floor', label: 'A whole floor', hint: 'Lay out rows of stands with aisles between them.' },
          ]}
          onChange={setMode}
        />

        <Field label="Stand size" help={`${region.label} sells space on a ${region.boothModuleMm.width} mm module. A 10 ft booth is 3048 mm and is not interchangeable with a 3 m one.`}>
          <Select value={sizeKey} onChange={(e) => setSizeKey(e.target.value)}>
            {BOOTH_SIZES.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label} — {option.note}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      {mode === 'single' ? (
        <Section title="Stand type" description="How many sides are open to an aisle. It changes the height you are allowed to build to, and how the stand should be designed.">
          <div className="space-y-1.5">
            {BOOTH_TYPES.map((type) => {
              const spec = BOOTH_TYPE_SPECS[type];
              return (
                <button
                  key={type}
                  type="button"
                  disabled={readOnly}
                  onClick={() =>
                    addObjects([
                      createBooth({
                        boothType: type,
                        widthMm: size.widthMm,
                        depthMm: size.depthMm,
                        standNumber: `A${objects.filter((o) => o.type === 'booth').length + 1}`,
                      }),
                    ])
                  }
                  className="w-full rounded-lg border border-line bg-surface-muted/40 p-2.5 text-left transition hover:border-primary/60 hover:bg-primary/10 disabled:opacity-40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-ink">{spec.label}</span>
                    <span className="chip shrink-0">
                      {spec.openSides} open side{spec.openSides === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] leading-snug text-ink-subtle">{spec.note}</p>
                  <p className="mt-1 text-[10px] text-ink-muted">
                    Usually allowed to {(spec.typicalHeightLimitMm / 1000).toFixed(1)} m
                  </p>
                </button>
              );
            })}
          </div>
        </Section>
      ) : (
        <>
          <Section title="Floor layout" description="Back-to-back rows share a spine so one aisle serves two rows — half the aisles for the same number of exhibitors.">
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Across" value={columns} min={1} max={40} onChange={setColumns} showRange={false} />
              <NumberField label="Deep" value={rows} min={1} max={30} onChange={setRows} showRange={false} />
            </div>
            <LengthField
              label="Aisle width"
              valueMm={aisleMm}
              units="metric"
              minMm={1500}
              maxMm={10_000}
              onChange={setAisleMm}
              help={`${region.label} requires at least ${(region.regulations.minAisleMm / 1000).toFixed(1)} m between stands. Main routes are usually wider.`}
            />
            <Toggle
              label="Back to back"
              checked={backToBack}
              onChange={setBackToBack}
              hint="Pairs of rows share a back wall. Turn it off for stands that need an aisle on every side."
            />

            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <Stat label="Stands" value={preview.length} />
              <Stat label="Floor needed" value={`${footprintM.w.toFixed(0)} × ${footprintM.d.toFixed(0)} m`} />
            </div>

            <BoothGridDiagram placements={preview} widthMm={size.widthMm} depthMm={size.depthMm} />
          </Section>

          <Section title="">
            <button
              type="button"
              className="ed-action-primary w-full justify-center"
              disabled={readOnly || preview.length === 0}
              onClick={() => {
                const stands = preview.map((placement) =>
                  createBooth({
                    boothType: size.type,
                    widthMm: size.widthMm,
                    depthMm: size.depthMm,
                    standNumber: placement.standNumber,
                    position: { x: placement.centre.xMm, y: 0, z: placement.centre.zMm },
                    rotationDeg: placement.rotationDeg,
                  })
                );
                addObjects(stands);
                toast('success', `${stands.length} stands laid out. Select any one to design it.`);
              }}
            >
              <Grid3x3 className="h-3.5 w-3.5" /> Lay out {preview.length} stands
            </button>
          </Section>
        </>
      )}
    </>
  );
}

/** A plan-view diagram of the grid, drawn from the real placements. */
function BoothGridDiagram({
  placements,
  widthMm,
  depthMm,
}: {
  placements: ReturnType<typeof generateBoothGrid>;
  widthMm: number;
  depthMm: number;
}) {
  if (!placements.length) return null;
  const xs = placements.map((p) => p.centre.xMm);
  const zs = placements.map((p) => p.centre.zMm);
  const minX = Math.min(...xs) - widthMm / 2;
  const maxX = Math.max(...xs) + widthMm / 2;
  const minZ = Math.min(...zs) - depthMm / 2;
  const maxZ = Math.max(...zs) + depthMm / 2;
  const spanX = maxX - minX || 1;
  const spanZ = maxZ - minZ || 1;

  return (
    <svg viewBox={`0 0 ${spanX} ${spanZ}`} className="mt-2 h-24 w-full rounded border border-line bg-surface-muted/30" preserveAspectRatio="xMidYMid meet">
      {placements.map((placement) => (
        <rect
          key={placement.index}
          x={placement.centre.xMm - minX - widthMm / 2}
          y={placement.centre.zMm - minZ - depthMm / 2}
          width={widthMm}
          height={depthMm}
          className="fill-primary/25 stroke-primary"
          strokeWidth={spanX / 300}
        />
      ))}
    </svg>
  );
}

/* ── Editing one stand ─────────────────────────────────────────────────── */

function BoothEditor({ booth }: { booth: BoothSceneObject }) {
  const units = useEditor((s) => s.scene.units);
  const regionCode = useEditor((s) => s.scene.regionCode);
  const updateObject = useEditor((s) => s.updateObject);
  const region = regionPack(regionCode);

  const rules = {
    ...DEFAULT_BOOTH_REGULATIONS,
    maxHeightMm: region.regulations.standHeightLimitMm,
    setbackFromAisleMm: DEFAULT_BOOTH_REGULATIONS.setbackFromAisleMm,
    aisleWidthMm: region.regulations.minAisleMm,
  };

  const derived = useMemo(() => deriveBooth(booth, rules), [booth, rules]);
  const patch = (changes: Partial<BoothSceneObject>) => updateObject(booth.id, changes);

  const toggleWall = (side: BoothSide) => {
    const walls = booth.walls.includes(side) ? booth.walls.filter((s) => s !== side) : [...booth.walls, side];
    patch({ walls });
  };

  return (
    <>
      <Section title="Identity" description="Printed on the hall plan and on the fascia, so exhibitors can find themselves.">
        <Field label="Stand number">
          <TextInput
            value={booth.standNumber ?? ''}
            placeholder="A12"
            onChange={(e) => patch({ standNumber: e.target.value })}
          />
        </Field>
        <Field label="Exhibitor">
          <TextInput
            value={booth.exhibitorName ?? ''}
            placeholder="Company name"
            onChange={(e) => patch({ exhibitorName: e.target.value, fasciaText: e.target.value })}
          />
        </Field>
      </Section>

      <Section title="Size and type">
        <Segmented
          label="Stand type"
          value={booth.boothType}
          columns={2}
          options={BOOTH_TYPES.map((type) => ({
            value: type,
            label: BOOTH_TYPE_SPECS[type].label,
            hint: BOOTH_TYPE_SPECS[type].note,
          }))}
          onChange={(boothType) => {
            const spec = BOOTH_TYPE_SPECS[boothType as BoothType];
            patch({ boothType: boothType as BoothType, walls: [...spec.defaultWalls], fascia: spec.fascia });
          }}
        />
        <LengthField label="Width" valueMm={booth.widthMm} units={units} minMm={1000} maxMm={40_000} onChange={(widthMm) => patch({ widthMm })} />
        <LengthField label="Depth" valueMm={booth.depthMm} units={units} minMm={1000} maxMm={40_000} onChange={(depthMm) => patch({ depthMm })} />
        <LengthField
          label="Build height"
          valueMm={booth.heightMm}
          units={units}
          minMm={1000}
          maxMm={12_000}
          onChange={(heightMm) => patch({ heightMm })}
          help={`${region.label} halls normally cap a stand at ${(region.regulations.standHeightLimitMm / 1000).toFixed(1)} m. Above ${(region.regulations.structuralSignOffAboveMm / 1000).toFixed(1)} m usually needs structural sign-off.`}
        />
      </Section>

      <Section title="Walls" description="Which sides are closed. An open side is where visitors come in — walling one off closes the traffic you paid for.">
        <div className="grid grid-cols-2 gap-1">
          {BOOTH_SIDES.map((side) => (
            <button
              key={side}
              type="button"
              onClick={() => toggleWall(side)}
              aria-pressed={booth.walls.includes(side)}
              className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold transition ${
                booth.walls.includes(side)
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-line bg-surface-muted/40 text-ink-subtle hover:text-ink'
              }`}
            >
              {BOOTH_SIDE_LABELS[side]}
            </button>
          ))}
        </div>
        <p className="field-hint">Selected sides carry a wall. Everything else is open to the aisle.</p>
      </Section>

      <Section title="Finish">
        <Field label="Wall finish" help="What the walls are actually made of. It decides the price per square metre and whether graphics can be printed on them.">
          <Select value={booth.wallFinish} onChange={(e) => patch({ wallFinish: e.target.value as BoothWallFinish })}>
            {BOOTH_WALL_FINISHES.map((finish) => (
              <option key={finish} value={finish}>
                {BOOTH_WALL_FINISH_INFO[finish].label}
              </option>
            ))}
          </Select>
        </Field>
        <p className="field-hint">{BOOTH_WALL_FINISH_INFO[booth.wallFinish].note}</p>
        <p className="field-hint">
          Locally available in {region.label}: {region.materials.slice(0, 3).join(', ')}.
        </p>

        <ColorField label="Wall colour" value={booth.wallColor} onChange={(wallColor) => patch({ wallColor })} />

        <Field label="Floor">
          <Select value={booth.floorFinish} onChange={(e) => patch({ floorFinish: e.target.value as BoothFloorFinish })}>
            {BOOTH_FLOOR_FINISHES.map((finish) => (
              <option key={finish} value={finish}>
                {BOOTH_FLOOR_FINISH_INFO[finish].label}
              </option>
            ))}
          </Select>
        </Field>
        <p className="field-hint">{BOOTH_FLOOR_FINISH_INFO[booth.floorFinish].note}</p>
        <ColorField label="Floor colour" value={booth.floorColor} onChange={(floorColor) => patch({ floorColor })} />

        <LengthField
          label="Raised platform"
          valueMm={booth.platformHeightMm}
          units={units}
          minMm={0}
          maxMm={600}
          onChange={(platformHeightMm) => patch({ platformHeightMm })}
          help="A raised floor hides cable, and adds a step. Anything above zero needs a ramp on an open side."
        />
      </Section>

      <Section title="Fittings">
        <Toggle label="Fascia board" checked={booth.fascia} onChange={(fascia) => patch({ fascia })} hint="The name board across the top of the open side." />
        {booth.fascia ? (
          <>
            <Field label="Fascia text">
              <TextInput value={booth.fasciaText} onChange={(e) => patch({ fasciaText: e.target.value })} />
            </Field>
            <ColorField label="Fascia colour" value={booth.fasciaColor} onChange={(fasciaColor) => patch({ fasciaColor })} />
          </>
        ) : null}
        <Toggle label="Counter" checked={booth.counter} onChange={(counter) => patch({ counter })} hint="A reception or demo counter near the aisle." />
        <Toggle
          label="Store room"
          checked={booth.storeRoom}
          onChange={(storeRoom) => patch({ storeRoom })}
          hint="A 1 m² lockable store in the back corner. It takes usable floor."
        />
      </Section>

      <Section title="What this costs to build" description="Measured from the stand as drawn. These are the quantities a contractor prices.">
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Floor sold" value={`${derived.areaSqM} m²`} />
          <Stat label="Usable" value={`${derived.usableAreaSqM} m²`} sub={booth.storeRoom ? 'less the store room' : undefined} />
          <Stat label="Wall area" value={`${derived.wallAreaSqM} m²`} sub={`${derived.wallRunM} m run`} />
          <Stat label="Print area" value={`${derived.printAreaSqM} m²`} help="Only counted where the finish is actually printable." />
          <Stat label="Volume" value={`${derived.volumeCuM} m³`} help="Used to estimate freight and build time." />
          <Stat label="Holds" value={`${derived.standCapacity} people`} help="At about 1.5 m² of open floor per person, once furniture is in." />
        </div>
      </Section>

      <Section title="Organiser rules" help={`Checked against ${region.regulations.authority}. These are the rules an organiser applies — confirm against the exhibitor manual for your specific show.`}>
        {derived.warnings.length ? (
          <div className="space-y-1.5">
            {derived.warnings.map((warning, i) => (
              <FindingCard
                key={i}
                severity={warning.severity === 'error' ? 'error' : warning.severity === 'warning' ? 'warning' : 'info'}
                title={warning.severity === 'error' ? 'This will be refused' : warning.severity === 'warning' ? 'Check the exhibitor manual' : 'Worth knowing'}
                detail={warning.message}
              />
            ))}
          </div>
        ) : (
          <FindingCard
            severity="success"
            title="Within the usual rules"
            detail={`${formatLength(booth.heightMm, units)} tall on a ${derived.spec.label.toLowerCase()}, inside the ${(rules.maxHeightMm / 1000).toFixed(1)} m limit for ${region.label}.`}
          />
        )}
        {region.regulations.notes.slice(0, 2).map((note, i) => (
          <p key={i} className="mt-1.5 text-[10px] leading-snug text-ink-subtle">
            {note}
          </p>
        ))}
      </Section>
    </>
  );
}

export function AddBoothButton() {
  const objects = useEditor((s) => s.scene.objects);
  const addObjects = useEditor((s) => s.addObjects);
  const readOnly = useEditor((s) => s.readOnly);
  return (
    <button
      type="button"
      className="ed-action"
      disabled={readOnly}
      onClick={() =>
        addObjects([
          createBooth({ standNumber: `A${objects.filter((o) => o.type === 'booth').length + 1}` }),
        ])
      }
    >
      <Plus className="h-3.5 w-3.5" /> Stand
    </button>
  );
}
