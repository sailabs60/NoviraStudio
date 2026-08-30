import { useMemo, useState } from 'react';
import {
  DEFAULT_LAYOUT_PARAMS,
  LAYOUT_PRESETS,
  applyOrigin,
  formatLength,
  generateLayout,
  parseLength,
  type LayoutPreset,
  type SceneObject,
} from '@novira/shared';
import { useEditor } from './editorStore';
import { Modal } from '../components/Modal';
import { LayoutDiagram } from './LayoutDiagram';

const PRESET_LABELS: Record<LayoutPreset, string> = {
  grid: 'Grid',
  'angled-grid': 'Angled grid',
  rows: 'Rows',
  pyramid: 'Pyramid',
  diagonal: 'Diagonal',
  curved: 'Curved',
  circle: 'Arc',
  'closed-circle': 'Circle',
  'u-shape': 'U-shape',
  aisle: 'Aisle',
};

/** Presets whose shape is driven by a radius and sweep rather than a grid. */
const RADIAL: LayoutPreset[] = ['circle', 'closed-circle', 'curved'];

/**
 * Quick Layout.
 *
 * Takes whatever is selected and produces a repeated arrangement from it. The
 * selection becomes the *pattern*: one selected chair makes a row of chairs, a
 * selected table-and-chairs cluster repeats as a cluster.
 */
export function QuickLayout({ open, onClose }: { open: boolean; onClose: () => void }) {
  const units = useEditor((s) => s.units);
  const objects = useEditor((s) => s.scene.objects);
  const selectedIds = useEditor((s) => s.selectedIds);
  const addObjects = useEditor((s) => s.addObjects);

  const [preset, setPreset] = useState<LayoutPreset>('grid');
  const [count, setCount] = useState(6);
  const [columns, setColumns] = useState(3);
  const [columnSpacingMm, setColumnSpacing] = useState(2438);
  const [rowSpacingMm, setRowSpacing] = useState(2438);
  const [radiusMm, setRadius] = useState(5000);
  const [sweepDeg, setSweep] = useState(180);
  const [angleDeg, setAngle] = useState(45);
  const [replaceOriginal, setReplaceOriginal] = useState(false);

  const selected = useMemo(
    () => objects.filter((o) => selectedIds.includes(o.id)),
    [objects, selectedIds]
  );

  /** The pattern's own centre, so the arrangement grows from where it already is. */
  const origin = useMemo(() => {
    if (!selected.length) return { x: 0, y: 0, z: 0 };
    const sum = selected.reduce(
      (acc, o) => ({ x: acc.x + o.positionMm.x, y: acc.y + o.positionMm.y, z: acc.z + o.positionMm.z }),
      { x: 0, y: 0, z: 0 }
    );
    return { x: sum.x / selected.length, y: sum.y / selected.length, z: sum.z / selected.length };
  }, [selected]);

  const isRadial = RADIAL.includes(preset);
  const totalObjects = count * selected.length;

  function apply() {
    if (!selected.length) return;

    const params = {
      ...DEFAULT_LAYOUT_PARAMS,
      preset,
      columns,
      rows: Math.ceil(count / Math.max(1, columns)),
      columnSpacingMm,
      rowSpacingMm,
      radiusMm,
      sweepDeg,
      angleDeg,
      itemsPerRow: columns,
    };

    const placements = applyOrigin(generateLayout(count, params), origin);

    // Copy the whole selection to each placement, preserving its internal shape.
    const created: SceneObject[] = [];
    placements.forEach((placement, index) => {
      // The first placement stands in for the originals unless they are kept.
      if (index === 0 && !replaceOriginal) return;
      for (const source of selected) {
        const offsetX = source.positionMm.x - origin.x;
        const offsetZ = source.positionMm.z - origin.z;
        created.push({
          ...structuredClone(source),
          id: crypto.randomUUID(),
          positionMm: {
            x: placement.positionMm.x + offsetX,
            y: source.positionMm.y,
            z: placement.positionMm.z + offsetZ,
          },
          rotationDeg: { ...source.rotationDeg, y: source.rotationDeg.y + placement.rotationDeg },
          locked: false,
        } as SceneObject);
      }
    });

    if (created.length) addObjects(created);
    onClose();
  }

  return (
    <Modal
      open={open}
      title="Quick Layout"
      description="Repeat the current selection into an arrangement."
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <span className="mr-auto text-xs text-ink-muted">
            {selected.length} selected · {count} positions ·{' '}
            <strong className="text-ink">{totalObjects}</strong> objects
          </span>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={!selected.length} onClick={apply}>
            Apply layout
          </button>
        </>
      }
    >
      {!selected.length ? (
        <p className="py-8 text-center text-sm text-ink-subtle">
          Select one or more objects first — they become the pattern that gets repeated.
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <span className="ed-section-title">Arrangement</span>
            <div className="grid grid-cols-5 gap-1.5">
              {LAYOUT_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  title={PRESET_LABELS[p]}
                  className={`flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[10px] font-medium transition ${
                    preset === p
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {/*
                    Drawn from the same function that does the arranging, so the
                    picture cannot promise something the result does not deliver.
                  */}
                  <LayoutDiagram preset={p} active={preset === p} className="h-9 w-9" />
                  <span className="leading-none">{PRESET_LABELS[p]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Num label="Positions" value={count} min={1} max={200} onChange={setCount} />
            {!isRadial ? (
              <Num label="Columns" value={columns} min={1} max={30} onChange={setColumns} />
            ) : (
              <Len label="Radius" valueMm={radiusMm} units={units} onChange={setRadius} />
            )}
            {!isRadial ? (
              <Len label="Column spacing" valueMm={columnSpacingMm} units={units} onChange={setColumnSpacing} />
            ) : (
              <Num label="Sweep (deg)" value={sweepDeg} min={10} max={360} onChange={setSweep} />
            )}
            {preset === 'angled-grid' || preset === 'diagonal' ? (
              <Num label="Angle (deg)" value={angleDeg} min={0} max={359} onChange={setAngle} />
            ) : (
              <Len label="Row spacing" valueMm={rowSpacingMm} units={units} onChange={setRowSpacing} />
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-line bg-surface-muted accent-primary"
              checked={replaceOriginal}
              onChange={(e) => setReplaceOriginal(e.target.checked)}
            />
            Also place a copy at the first position (leaves the originals where they are)
          </label>
        </div>
      )}
    </Modal>
  );
}

function Num({
  label, value, min, max, onChange,
}: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="ed-label">{label}</label>
      <input
        type="number"
        className="ed-field"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
        }}
      />
    </div>
  );
}

function Len({
  label, valueMm, units, onChange,
}: { label: string; valueMm: number; units: 'metric' | 'imperial'; onChange: (mm: number) => void }) {
  return (
    <div>
      <label className="ed-label">{label}</label>
      <input
        className="ed-field"
        defaultValue={formatLength(valueMm, units, { bare: true })}
        key={valueMm}
        onBlur={(e) => {
          const mm = parseLength(e.target.value, units);
          if (mm !== null && mm > 0) onChange(mm);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}
