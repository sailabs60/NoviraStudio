import { useState } from 'react';
import { ChevronDown, ChevronRight, Lightbulb } from 'lucide-react';
import {
  BRAND_FONTS,
  FINISH_PRESETS,
  applyFinish,
  estimateTextTriangles,
  type ArtworkSceneObject,
  type BrandFinish,
  type BrandMaterial,
  type SceneObject,
  type Text3DSceneObject,
} from '@novira/shared';
import { useEditor } from './editorStore';

/**
 * Live editing for branded objects.
 *
 * Everything here changes the object in the viewport as it moves, which is the
 * whole point — a finish or a depth is a judgement you make by looking, not by
 * reading a number. The raw material sliders are folded away by default so the
 * common path is: pick a finish, nudge the depth, done.
 */

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="mb-2 block">
      <div className="flex items-baseline justify-between">
        <span className="ed-label mb-0">{label}</span>
        <span className="text-[11px] font-semibold tabular-nums text-ink">
          {Number.isInteger(value) ? value : value.toFixed(2)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        className="w-full accent-primary"
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Swatch({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="mb-2 flex items-center justify-between gap-2">
      <span className="ed-label mb-0">{label}</span>
      <input
        type="color"
        value={value}
        disabled={disabled}
        className="h-7 w-12 cursor-pointer rounded border border-line bg-transparent"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** The raw physical controls, behind a disclosure. */
function MaterialControls({
  material,
  disabled,
  onChange,
}: {
  material: BrandMaterial;
  disabled?: boolean;
  onChange: (patch: Partial<BrandMaterial>) => void;
}) {
  const [open, setOpen] = useState(false);
  const glowing = material.emissiveIntensity > 0;

  return (
    <div className="mt-1">
      <button
        type="button"
        className="flex w-full items-center gap-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle hover:text-ink"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Material
      </button>

      {open ? (
        <div className="pt-1">
          <Swatch label="Colour" value={material.color} disabled={disabled}
            onChange={(color) => onChange({ color })} />
          <Slider label="Metalness" value={material.metalness} min={0} max={1} step={0.05}
            disabled={disabled} onChange={(metalness) => onChange({ metalness })} />
          <Slider label="Roughness" value={material.roughness} min={0} max={1} step={0.02}
            disabled={disabled} onChange={(roughness) => onChange({ roughness })} />

          {/*
            Emission is the "make it glow" control, so it gets its own labelled
            block rather than sitting anonymously among the sliders.
          */}
          <div className="my-2 rounded-md border border-line bg-surface-muted/30 p-2">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Lightbulb className={`h-3.5 w-3.5 ${glowing ? 'text-amber-400' : 'text-ink-subtle'}`} />
              <span className="text-[11px] font-semibold text-ink">Emits light</span>
            </div>
            <Swatch label="Glow colour" value={material.emissiveColor} disabled={disabled}
              onChange={(emissiveColor) => onChange({ emissiveColor })} />
            <Slider label="Brightness" value={material.emissiveIntensity} min={0} max={6} step={0.1}
              disabled={disabled}
              onChange={(emissiveIntensity) => onChange({ emissiveIntensity })} />
            <p className="text-[10px] leading-snug text-ink-subtle">
              Above 1 the surface blooms. It lights itself, not the room — add a light for that.
            </p>
          </div>

          <Slider label="Transmission" value={material.transmission} min={0} max={1} step={0.02}
            disabled={disabled} onChange={(transmission) => onChange({ transmission })} />
          {material.transmission > 0 ? (
            <>
              <Slider label="Thickness" value={material.thicknessMm} min={1} max={120} suffix=" mm"
                disabled={disabled} onChange={(thicknessMm) => onChange({ thicknessMm })} />
              <Slider label="Refraction" value={material.ior} min={1} max={2.4} step={0.01}
                disabled={disabled} onChange={(ior) => onChange({ ior })} />
              <p className="mb-2 text-[10px] leading-snug text-ink-subtle">
                1.49 is acrylic, 1.52 glass. Raise roughness for a frosted look.
              </p>
            </>
          ) : null}
          <Slider label="Lacquer" value={material.clearcoat} min={0} max={1} step={0.05}
            disabled={disabled} onChange={(clearcoat) => onChange({ clearcoat })} />
        </div>
      ) : null}
    </div>
  );
}

function FinishPicker({
  value,
  disabled,
  onPick,
}: {
  value: BrandFinish;
  disabled?: boolean;
  onPick: (f: BrandFinish) => void;
}) {
  return (
    <div className="mb-2">
      <span className="ed-label">Finish</span>
      <div className="grid grid-cols-2 gap-1">
        {(Object.keys(FINISH_PRESETS) as BrandFinish[]).map((key) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onPick(key)}
            className={`rounded border px-1.5 py-1 text-left text-[11px] transition ${
              value === key
                ? 'border-primary bg-primary/10 text-ink'
                : 'border-line text-ink-muted hover:text-ink'
            }`}
          >
            {FINISH_PRESETS[key].label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[10px] leading-snug text-ink-subtle">{FINISH_PRESETS[value].note}</p>
    </div>
  );
}

export function Text3DProperties({ object }: { object: Text3DSceneObject }) {
  const updateObject = useEditor((s) => s.updateObject);
  const readOnly = useEditor((s) => s.readOnly);
  const disabled = readOnly || object.locked;

  const patch = (p: Partial<Text3DSceneObject>) =>
    updateObject(object.id, p as Partial<SceneObject>);

  const engraved = object.depthMm < 0;
  const triangles = estimateTextTriangles(object);

  return (
    <section className="ed-section">
      <h3 className="ed-section-title">Lettering</h3>

      <label className="mb-2 block">
        <span className="ed-label">Words</span>
        <textarea
          className="input min-h-[54px] resize-y text-sm"
          value={object.content}
          disabled={disabled}
          onChange={(e) => patch({ content: e.target.value })}
        />
      </label>

      <label className="mb-2 block">
        <span className="ed-label">Typeface</span>
        <select
          className="input"
          value={object.font}
          disabled={disabled}
          onChange={(e) => patch({ font: e.target.value as Text3DSceneObject['font'] })}
        >
          {BRAND_FONTS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label} · {f.weight}
            </option>
          ))}
        </select>
      </label>

      <Slider label="Cap height" value={object.sizeMm} min={50} max={2000} step={10} suffix=" mm"
        disabled={disabled} onChange={(sizeMm) => patch({ sizeMm })} />

      {/* One slider across zero — push past it to engrave. */}
      <label className="mb-1 block">
        <div className="flex items-baseline justify-between">
          <span className="ed-label mb-0">Depth</span>
          <span className={`text-[11px] font-semibold tabular-nums ${engraved ? 'text-amber-400' : 'text-ink'}`}>
            {engraved ? `${Math.abs(object.depthMm)} mm in` : `${object.depthMm} mm out`}
          </span>
        </div>
        <input
          type="range"
          min={-40}
          max={300}
          step={2}
          value={object.depthMm}
          disabled={disabled}
          className="w-full accent-primary"
          onChange={(e) => {
            const depthMm = Number(e.target.value);
            patch({
              depthMm,
              // There has to be something to cut into.
              backing: depthMm < 0 ? { ...object.backing, enabled: true } : object.backing,
            });
          }}
        />
      </label>
      <div className="mb-3 flex justify-between text-[10px] text-ink-subtle">
        <span>engrave</span>
        <span>flat</span>
        <span>extrude</span>
      </div>

      <FinishPicker
        value={object.finish}
        disabled={disabled}
        onPick={(finish) => patch({ finish, material: applyFinish(object.material, finish) })}
      />

      <MaterialControls
        material={object.material}
        disabled={disabled}
        onChange={(p) => patch({ material: { ...object.material, ...p } })}
      />

      {!engraved ? (
        <label className="mt-2 flex items-center gap-2 text-[11px] text-ink-muted">
          <input
            type="checkbox"
            checked={object.bevelEnabled}
            disabled={disabled}
            onChange={(e) => patch({ bevelEnabled: e.target.checked })}
          />
          Bevelled edges
        </label>
      ) : null}

      <label className="mt-1 flex items-center gap-2 text-[11px] text-ink-muted">
        <input
          type="checkbox"
          checked={object.backing.enabled}
          disabled={disabled || engraved}
          onChange={(e) => patch({ backing: { ...object.backing, enabled: e.target.checked } })}
        />
        Backing panel {engraved ? '(required to engrave)' : ''}
      </label>

      <p className="mt-2 text-[10px] text-ink-subtle">
        about {triangles.toLocaleString()} triangles
      </p>
    </section>
  );
}

export function ArtworkProperties({ object }: { object: ArtworkSceneObject }) {
  const updateObject = useEditor((s) => s.updateObject);
  const readOnly = useEditor((s) => s.readOnly);
  const disabled = readOnly || object.locked;

  const patch = (p: Partial<ArtworkSceneObject>) =>
    updateObject(object.id, p as Partial<SceneObject>);

  /** Resizing keeps the true pixel aspect unless it is explicitly unlocked. */
  const setWidth = (widthMm: number) =>
    patch({
      widthMm,
      ...(object.lockAspect
        ? { heightMm: Math.max(10, Math.round(widthMm / (object.aspectRatio || 1))) }
        : {}),
    });

  const setHeight = (heightMm: number) =>
    patch({
      heightMm,
      ...(object.lockAspect
        ? { widthMm: Math.max(10, Math.round(heightMm * (object.aspectRatio || 1))) }
        : {}),
    });

  return (
    <section className="ed-section">
      <h3 className="ed-section-title">Artwork</h3>

      {object.imageUrl ? (
        <img
          src={object.imageUrl}
          alt={object.name ?? 'Artwork'}
          className="mb-2 h-20 w-full rounded border border-line object-contain"
        />
      ) : null}

      <Slider label="Width" value={object.widthMm} min={100} max={12000} step={10} suffix=" mm"
        disabled={disabled} onChange={setWidth} />
      <Slider label="Height" value={object.heightMm} min={100} max={12000} step={10} suffix=" mm"
        disabled={disabled} onChange={setHeight} />

      <label className="mb-2 flex items-center gap-2 text-[11px] text-ink-muted">
        <input
          type="checkbox"
          checked={object.lockAspect}
          disabled={disabled}
          onChange={(e) => patch({ lockAspect: e.target.checked })}
        />
        Keep proportions
      </label>

      <Slider label="Thickness" value={object.thicknessMm} min={1} max={120} suffix=" mm"
        disabled={disabled} onChange={(thicknessMm) => patch({ thicknessMm })} />
      <Slider label="Rounded corners" value={object.cornerRadiusMm} min={0} max={300} step={2} suffix=" mm"
        disabled={disabled} onChange={(cornerRadiusMm) => patch({ cornerRadiusMm })} />

      <div className="mb-2 space-y-1">
        <label className="flex items-center gap-2 text-[11px] text-ink-muted">
          <input type="checkbox" checked={object.doubleSided} disabled={disabled}
            onChange={(e) => patch({ doubleSided: e.target.checked })} />
          Print both sides
        </label>
        <label className="flex items-center gap-2 text-[11px] text-ink-muted">
          <input type="checkbox" checked={object.useAlpha} disabled={disabled}
            onChange={(e) => patch({ useAlpha: e.target.checked })} />
          Cut out background
        </label>
        {/*
          The difference between a lightbox and a panel with a lamp on it: the
          image drives the emission, so it glows in its own colours.
        */}
        <label className="flex items-center gap-2 text-[11px] text-ink-muted">
          <input type="checkbox" checked={object.emitFromImage} disabled={disabled}
            onChange={(e) =>
              patch({
                emitFromImage: e.target.checked,
                material: {
                  ...object.material,
                  emissiveIntensity:
                    e.target.checked && object.material.emissiveIntensity === 0
                      ? 1.2
                      : object.material.emissiveIntensity,
                },
              })
            } />
          Backlit (glows in its own colours)
        </label>
      </div>

      <FinishPicker
        value={object.finish}
        disabled={disabled}
        onPick={(finish) => patch({ finish, material: applyFinish(object.material, finish) })}
      />

      <MaterialControls
        material={object.material}
        disabled={disabled}
        onChange={(p) => patch({ material: { ...object.material, ...p } })}
      />

      {object.attribution ? (
        <p className="mt-2 text-[10px] leading-snug text-ink-subtle">
          Credit required: {object.attribution}
        </p>
      ) : null}
    </section>
  );
}
