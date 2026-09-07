import { useState } from 'react';
import { ArrowRight, Copy, LayoutGrid, Lock, Trash2, Unlock } from 'lucide-react';
import {
  formatLength,
  parseLength,
  type ArtworkSceneObject,
  type CatalogSceneObject,
  type SceneObject,
  type Text3DSceneObject,
} from '@novira/shared';
import { useEditor, type WorkPanel } from './editorStore';
import { useSelectedObjects } from './selectors';
import { QuickLayout } from './QuickLayout';
import { ArtworkProperties, Text3DProperties } from './BrandingProperties';
import { ReplaceSection } from './ReplaceObject';

/**
 * The properties of whatever is selected.
 *
 * Deliberately narrow: position, rotation, opacity, real dimensions, and the
 * ordinary actions. It does **not** repeat the type-specific engineering — a
 * stage's deck grid, a tent's sidewall slots, a truss's span — because those
 * live in the Build panel, which is where you go to change what a thing *is*
 * rather than where it sits.
 *
 * Keeping that line sharp matters more than it sounds. When both surfaces
 * rendered the same controls, a plan had two live copies of every tent select
 * on screen at once, and neither was obviously the real one. Now each surface
 * answers one question, and anything that belongs to the other is a labelled
 * hand-off rather than a duplicate.
 */

export function PropertiesPanel() {
  const units = useEditor((s) => s.units);
  const updateObject = useEditor((s) => s.updateObject);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const toggleLockSelected = useEditor((s) => s.toggleLockSelected);
  const readOnly = useEditor((s) => s.readOnly);

  const [layoutOpen, setLayoutOpen] = useState(false);

  const selected = useSelectedObjects();
  const single = selected.length === 1 ? selected[0]! : null;

  return (
    /*
     * A plain column that takes the width its container gives it. It lives in
     * the right-hand dock, under the Properties tab, and the dock owns
     * everything scene-wide — so nothing global belongs here any more.
     */
    <div className="flex flex-col">
      <div className="border-b border-line px-3.5 py-2">
        <p className="truncate text-[11px] font-semibold text-ink">
          {selected.length === 1
            ? (single?.name ?? single?.type)
            : `${selected.length} objects selected`}
        </p>
        {selected.length === 1 && single?.type ? (
          <p className="text-[10px] capitalize text-ink-subtle">{single.type}</p>
        ) : null}
      </div>

      {selected.length === 0 ? null : (
        <>
          <section className="ed-section">
            <div className="flex gap-1.5">
              <button type="button" className="ed-action flex-1 justify-center" disabled={readOnly}
                onClick={duplicateSelected}>
                <Copy className="h-3.5 w-3.5" /> Duplicate
              </button>
              <button type="button" className="ed-action flex-1 justify-center" disabled={readOnly}
                onClick={toggleLockSelected}>
                {selected.some((o) => !o.locked) ? (
                  <><Lock className="h-3.5 w-3.5" /> Lock</>
                ) : (
                  <><Unlock className="h-3.5 w-3.5" /> Unlock</>
                )}
              </button>
              <button type="button" className="ed-action text-danger hover:bg-danger/10 hover:text-danger"
                disabled={readOnly} onClick={deleteSelected} aria-label="Delete selection">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </section>

          <section className="ed-section">
            <button type="button" className="ed-action-primary w-full justify-center"
              disabled={readOnly} onClick={() => setLayoutOpen(true)}>
              <LayoutGrid className="h-3.5 w-3.5" /> Quick Layout
            </button>
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-subtle">
              Repeats the selection into a grid, circle, aisle or one of the other arrangements.
            </p>
          </section>

          {single ? <TransformSection object={single} units={units} onChange={updateObject} readOnly={readOnly} /> : null}
          {single?.type === 'catalog' ? (
            <DimensionsSection object={single} units={units} onChange={updateObject} readOnly={readOnly} />
          ) : null}
          {single?.type === 'catalog' ? (
            <ReplaceSection object={single as CatalogSceneObject} readOnly={readOnly} />
          ) : null}
          {/*
            Lettering and printed artwork are edited here rather than handed off:
            their properties — typeface, depth, finish, print size — are
            properties of the object, and there is no separate builder tab for
            them to live in.
          */}
          {single?.type === 'text3d' ? <Text3DProperties object={single as Text3DSceneObject} /> : null}
          {single?.type === 'artwork' ? <ArtworkProperties object={single as ArtworkSceneObject} /> : null}
          {single ? <BuilderHandoff object={single} /> : null}
        </>
      )}

      <QuickLayout open={layoutOpen} onClose={() => setLayoutOpen(false)} />

    </div>
  );
}

/**
 * The way to the controls that are not here.
 *
 * A stage, a tent, a truss, an LED wall and a piece of dimensional lettering
 * each have a builder of their own, and it is a page of controls — far too much
 * to sit under a transform. This names the panel that owns them and takes you
 * there in one press, which is both less crowded and less ambiguous than
 * showing the same controls twice.
 */
const BUILDER_FOR: Partial<Record<SceneObject['type'], { panel: WorkPanel; label: string; note: string }>> = {
  stage: { panel: 'build', label: 'Build', note: 'Deck grid, height, stairs, skirts and guardrails' },
  tent: { panel: 'build', label: 'Build', note: 'Size, bays, sidewall slots and window types' },
  curtain: { panel: 'build', label: 'Build', note: 'Widths, folds, curve and drape' },
  truss: { panel: 'build', label: 'Build', note: 'Shape, system, span and trim height' },
  led: { panel: 'build', label: 'Build', note: 'Cabinet, grid, curve and resolution' },
  booth: { panel: 'build', label: 'Build', note: 'Stand type, size, walls and floor finish' },
  light: { panel: 'light', label: 'Light', note: 'Fixture, beam, colour, gobo and aim' },
  constraint: { panel: 'site', label: 'Site', note: 'Constraint kind, extent and clearances' },
};

function BuilderHandoff({ object }: { object: SceneObject }) {
  const setWorkPanel = useEditor((s) => s.setWorkPanel);
  const entry = BUILDER_FOR[object.type];
  if (!entry) return null;

  return (
    <section className="ed-section">
      <h3 className="ed-section-title">Specification</h3>
      <button
        type="button"
        className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface px-2.5 py-2 text-left transition hover:border-primary/50 hover:bg-primary-soft"
        onClick={() => setWorkPanel(entry.panel)}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-ink">Open in {entry.label}</span>
          <span className="block truncate text-[10px] text-ink-subtle">{entry.note}</span>
        </span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary" />
      </button>
    </section>
  );
}

function TransformSection({
  object,
  units,
  onChange,
  readOnly,
}: {
  object: SceneObject;
  units: 'metric' | 'imperial';
  onChange: (id: string, patch: Partial<SceneObject>) => void;
  readOnly: boolean;
}) {
  const setAxis = (axis: 'x' | 'y' | 'z', raw: string) => {
    const mm = parseLength(raw, units);
    if (mm === null) return;
    onChange(object.id, { positionMm: { ...object.positionMm, [axis]: mm } } as Partial<SceneObject>);
  };

  return (
    <section className="ed-section">
      <h3 className="ed-section-title">Transform</h3>

      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <div key={axis}>
            <label className="ed-label" htmlFor={`pos-${axis}`}>{axis.toUpperCase()}</label>
            <input
              id={`pos-${axis}`}
              className="ed-field"
              disabled={readOnly || object.locked}
              defaultValue={formatLength(object.positionMm[axis], units, { bare: true })}
              key={`${object.id}-${axis}-${object.positionMm[axis]}`}
              onBlur={(e) => setAxis(axis, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
        ))}
      </div>

      {/*
        Rotation, draggable and typeable.

        The slider is the right control for finding an angle by eye, and the
        wrong one for "face it exactly north" or "square it to that wall" — a
        one-degree step over 360 pixels means a degree is barely a pixel. Both
        are here because both are how people actually set an angle.
      */}
      <label className="ed-label" htmlFor="rot-y">Rotation</label>
      <div className="mb-3 flex items-center gap-2">
        <input
          id="rot-y"
          type="range"
          min={0}
          max={359}
          step={1}
          value={((object.rotationDeg.y % 360) + 360) % 360}
          disabled={readOnly || object.locked}
          className="min-w-0 flex-1 accent-primary"
          onChange={(e) =>
            onChange(object.id, {
              rotationDeg: { ...object.rotationDeg, y: Number(e.target.value) },
            } as Partial<SceneObject>)
          }
        />
        <span className="flex shrink-0 items-center gap-0.5">
          <input
            className="ed-field w-14 text-right"
            disabled={readOnly || object.locked}
            key={`${object.id}-roty-${Math.round(object.rotationDeg.y)}`}
            defaultValue={Math.round(((object.rotationDeg.y % 360) + 360) % 360)}
            onBlur={(e) => {
              const deg = Number(e.target.value);
              if (!Number.isFinite(deg)) return;
              onChange(object.id, {
                rotationDeg: { ...object.rotationDeg, y: ((deg % 360) + 360) % 360 },
              } as Partial<SceneObject>);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
          <span className="text-[11px] text-ink-subtle">°</span>
        </span>
      </div>

      {/*
        Scale.

        Separate from dimensions on purpose. Dimensions are what the object
        *is* — a 1.8 m round table — and scale is a multiplier applied on top,
        which is what a gizmo drag writes. Showing only one of them means either
        a gizmo drag has no numeric readout, or a real size cannot be typed.
      */}
      <label className="ed-label">Scale</label>
      <div className="mb-3 grid grid-cols-4 gap-1.5">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <div key={axis}>
            <input
              className="ed-field"
              aria-label={`Scale ${axis.toUpperCase()}`}
              disabled={readOnly || object.locked}
              key={`${object.id}-scale-${axis}-${object.scale[axis]}`}
              defaultValue={Number((object.scale[axis] ?? 1).toFixed(3))}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (!Number.isFinite(value) || value <= 0) return;
                onChange(object.id, {
                  scale: { ...object.scale, [axis]: clampScaleValue(value) },
                } as Partial<SceneObject>);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
        ))}
        <button
          type="button"
          className="ed-action justify-center px-1 text-[10px]"
          disabled={readOnly || object.locked}
          title="Back to its real size"
          onClick={() => onChange(object.id, { scale: { x: 1, y: 1, z: 1 } } as Partial<SceneObject>)}
        >
          Reset
        </button>
      </div>

      <label className="ed-label" htmlFor="opacity">
        Opacity · {Math.round((object.opacity ?? 1) * 100)}%
      </label>
      <input
        id="opacity"
        type="range"
        min={0.1}
        max={1}
        step={0.05}
        value={object.opacity ?? 1}
        disabled={readOnly}
        className="w-full accent-primary"
        onChange={(e) => onChange(object.id, { opacity: Number(e.target.value) } as Partial<SceneObject>)}
      />
    </section>
  );
}

/**
 * The object's real size, in millimetres, and editable.
 *
 * This used to be a read-only list. It came from a measurement, which is why it
 * is trustworthy, but a plan is full of things that are *nearly* a catalogue
 * item — a bar built 400 mm longer, a plinth cut down to fit under a stair —
 * and the only way to say so was to drag a scale gizmo and read nothing back.
 * Typing a real dimension is how a person who has measured the thing wants to
 * enter it.
 *
 * Changing one keeps the others, so widening a table does not stretch its
 * height. Aspect is not locked, deliberately: the objects this is used on are
 * built to fit a space, and a bar that is longer is not also taller.
 */
function DimensionsSection({
  object,
  units,
  onChange,
  readOnly,
}: {
  object: CatalogSceneObject;
  units: 'metric' | 'imperial';
  onChange: (id: string, patch: Partial<SceneObject>) => void;
  readOnly: boolean;
}) {
  const dims = object.dimensionsMm;
  if (!dims) return null;

  const setDimension = (key: 'width' | 'depth' | 'height', raw: string) => {
    const mm = parseLength(raw, units);
    if (mm === null || mm <= 0) return;
    onChange(object.id, {
      dimensionsMm: { ...dims, [key]: Math.round(mm) },
    } as Partial<SceneObject>);
  };

  return (
    <section className="ed-section">
      <h3 className="ed-section-title">Real dimensions</h3>
      <div className="grid grid-cols-3 gap-1.5">
        {([
          ['Width', 'width'],
          ['Depth', 'depth'],
          ['Height', 'height'],
        ] as const).map(([label, key]) => (
          <div key={key}>
            <label className="ed-label" htmlFor={`dim-${key}`}>{label}</label>
            <input
              id={`dim-${key}`}
              className="ed-field"
              disabled={readOnly || object.locked}
              key={`${object.id}-${key}-${dims[key]}`}
              defaultValue={formatLength(dims[key], units, { bare: true })}
              onBlur={(e) => setDimension(key, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-ink-subtle">
        Measured from the model itself when it entered the catalogue, not taken from its title. Type a
        different figure to build this one to a size of your own.
      </p>
    </section>
  );
}

/** Scale stays where an object is still recognisably itself. */
const clampScaleValue = (value: number): number =>
  Math.max(0.05, Math.min(20, Number(value.toFixed(4))));
