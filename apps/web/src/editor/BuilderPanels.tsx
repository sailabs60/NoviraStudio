import { AlertTriangle, Eye, EyeOff, Info } from 'lucide-react';
import {
  CURTAIN_LIMITS,
  STAGE_SIDES,
  deriveStage,
  formatLength,
  parseLength,
  type CurtainSceneObject,
  type StageSceneObject,
  type StageSide,
  type TentSceneObject,
} from '@novira/shared';
import { useEditor } from './editorStore';
import { SIDEWALL_TYPES } from './Tent3D';

type Units = 'metric' | 'imperial';

/* ── Stage ─────────────────────────────────────────────────────────────── */

export function StagePanel({ stage, units }: { stage: StageSceneObject; units: Units }) {
  const updateObject = useEditor((s) => s.updateObject);
  const readOnly = useEditor((s) => s.readOnly);
  const derived = deriveStage(stage);

  const patch = (changes: Partial<StageSceneObject>) =>
    updateObject(stage.id, changes as never);

  const toggleSide = (key: 'stairSides' | 'skirtSides' | 'guardrailSides', side: StageSide) => {
    const current = stage[key];
    const next = current.includes(side) ? current.filter((s) => s !== side) : [...current, side];
    patch({ [key]: next } as Partial<StageSceneObject>);
  };

  return (
    <>
      <section className="ed-section">
        <h3 className="ed-section-title">Footprint</h3>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <NumField label="Rows" value={stage.deckRows} min={1} max={20}
            onChange={(v) => patch({ deckRows: v })} disabled={readOnly} />
          <NumField label="Columns" value={stage.deckColumns} min={1} max={20}
            onChange={(v) => patch({ deckColumns: v })} disabled={readOnly} />
        </div>
        <p className="text-[11px] text-ink-muted">
          {stage.deckRows} × {stage.deckColumns} decks —{' '}
          <strong className="text-ink">
            {formatLength(derived.footprintMm.width, units)} × {formatLength(derived.footprintMm.depth, units)}
          </strong>
        </p>
      </section>

      <section className="ed-section">
        <h3 className="ed-section-title">Deck height</h3>
        <LenField label="Height" valueMm={stage.deckHeightMm} units={units} disabled={readOnly}
          onChange={(mm) => patch({ deckHeightMm: Math.round(mm / 25) * 25 })} />
        <p className="mt-1 text-[10px] text-ink-subtle">Snaps to 1″ increments.</p>
      </section>

      <SideToggles title="Stair sides" sides={stage.stairSides} disabled={readOnly}
        onToggle={(side) => toggleSide('stairSides', side)}
        help="Each selected side gets one stair, on the bay chosen below." />

      {stage.stairSides.map((side) => {
        const bays = side === 'north' || side === 'south' ? stage.deckColumns : stage.deckRows;
        return (
          <section key={side} className="ed-section">
            <h3 className="ed-section-title">{side} stair bay</h3>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: bays }).map((_, i) => (
                <button key={i} type="button" disabled={readOnly}
                  onClick={() => patch({ stairBays: { ...stage.stairBays, [side]: i + 1 } })}
                  className={`h-7 w-7 rounded border text-[11px] font-semibold transition ${
                    (stage.stairBays[side] ?? 1) === i + 1
                      ? 'border-primary bg-primary text-primary-fg'
                      : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'
                  }`}>
                  {i + 1}
                </button>
              ))}
            </div>
          </section>
        );
      })}

      <SideToggles title="Skirt sides" sides={stage.skirtSides} disabled={readOnly}
        onToggle={(side) => toggleSide('skirtSides', side)}
        help="Skirt drapes each selected side and leaves a gap where a stair lands." />

      <SideToggles title="Guardrail sides" sides={stage.guardrailSides} disabled={readOnly}
        onToggle={(side) => toggleSide('guardrailSides', side)}
        help="Rail type is chosen automatically from the deck height." />

      <section className="ed-section">
        <h3 className="ed-section-title">Summary</h3>
        <dl className="space-y-1 text-[11px]">
          <Row label="Footprint" value={`${formatLength(derived.footprintMm.width, units)} × ${formatLength(derived.footprintMm.depth, units)}`} />
          <Row label="Rail type" value={derived.railType === 'vertical-rail' ? 'Vertical guardrail' : derived.railType === 'horizontal-panel' ? 'Horizontal guard panel' : '—'} />
          <Row label="Stair model" value={derived.stairModel ?? '—'} />
        </dl>
      </section>

      {derived.warnings.length ? (
        <section className="ed-section">
          <h3 className="ed-section-title">Safety</h3>
          <ul className="space-y-1.5">
            {derived.warnings.map((w, i) => (
              <li key={i} className={`flex gap-1.5 text-[11px] leading-relaxed ${
                w.level === 'required' ? 'text-danger' : 'text-warning'
              }`}>
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="ed-section">
        <h3 className="ed-section-title">Derived parts list</h3>
        <table className="w-full text-[11px]">
          <tbody>
            {derived.bom.map((line) => (
              <tr key={line.part} className="border-b border-line/60 last:border-0">
                <td className="py-1 pr-2 text-ink">{line.part}
                  {line.note ? <span className="block text-[9px] text-ink-subtle">{line.note}</span> : null}
                </td>
                <td className="py-1 text-right font-semibold tabular-nums text-ink">{line.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 flex gap-1.5 text-[10px] leading-relaxed text-ink-subtle">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            A design aid, not an engineering certification. Check against the manufacturer&rsquo;s load
            tables before install.
          </span>
        </p>
      </section>
    </>
  );
}

function SideToggles({
  title, sides, onToggle, help, disabled,
}: {
  title: string;
  sides: StageSide[];
  onToggle: (side: StageSide) => void;
  help: string;
  disabled?: boolean;
}) {
  return (
    <section className="ed-section">
      <h3 className="ed-section-title">{title}</h3>
      <div className="mb-1.5 grid grid-cols-2 gap-1.5">
        {STAGE_SIDES.map((side) => (
          <button key={side} type="button" disabled={disabled} onClick={() => onToggle(side)}
            className={`rounded-md border px-2 py-1.5 text-[11px] font-medium capitalize transition ${
              sides.includes(side)
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'
            }`}>
            {side}
          </button>
        ))}
      </div>
      <p className="text-[10px] leading-relaxed text-ink-subtle">{help}</p>
    </section>
  );
}

/* ── Tent ──────────────────────────────────────────────────────────────── */

export function TentPanel({ tent, units }: { tent: TentSceneObject; units: Units }) {
  const updateObject = useEditor((s) => s.updateObject);
  const readOnly = useEditor((s) => s.readOnly);
  const [pendingType, setPendingType] = useTentType();

  const filled = tent.slots.filter((s) => s.catalogItemId !== null).length;

  const patch = (changes: Partial<TentSceneObject>) => updateObject(tent.id, changes as never);

  const fillAll = (type: string | null) =>
    patch({
      slots: tent.slots.map((s) => ({
        ...s,
        catalogItemId: type ? 1 : null,
        sidewallType: type ?? undefined,
      })),
    });

  const setSide = (side: string, type: string | null) =>
    patch({
      slots: tent.slots.map((s) =>
        s.side === side ? { ...s, catalogItemId: type ? 1 : null, sidewallType: type ?? undefined } : s
      ),
    });

  return (
    <>
      <section className="ed-section">
        <h3 className="ed-section-title">Tent</h3>
        <dl className="space-y-1 text-[11px]">
          <Row label="Size" value={`${formatLength(tent.widthMm, units)} × ${formatLength(tent.lengthMm, units)}`} />
          <Row label="Eave" value={formatLength(tent.eaveHeightMm, units)} />
          <Row label="Peak" value={formatLength(tent.peakHeightMm, units)} />
        </dl>
        <button type="button" className="ed-action mt-2 w-full justify-center" disabled={readOnly}
          onClick={() => patch({ canopyHidden: !tent.canopyHidden })}>
          {tent.canopyHidden ? <><Eye className="h-3.5 w-3.5" /> Show canopy</> : <><EyeOff className="h-3.5 w-3.5" /> Hide canopy</>}
        </button>
        <p className="mt-1 text-[10px] leading-relaxed text-ink-subtle">
          Hiding the vinyl lets you lay out and see what goes underneath.
        </p>
      </section>

      <section className="ed-section">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="ed-section-title mb-0">Sidewalls</h3>
          <span className="text-[11px] text-ink-muted">
            <strong className="text-ink">{filled}</strong>/{tent.slots.length} slots
          </span>
        </div>

        <label className="ed-label">Wall type</label>
        <select className="ed-field mb-2" value={pendingType} disabled={readOnly}
          onChange={(e) => setPendingType(e.target.value)}>
          {SIDEWALL_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>

        <div className="mb-2 grid grid-cols-2 gap-1.5">
          {(['north', 'east', 'south', 'west'] as const).map((side) => {
            const sideSlots = tent.slots.filter((s) => s.side === side);
            const sideFilled = sideSlots.filter((s) => s.catalogItemId !== null).length;
            const allFilled = sideFilled === sideSlots.length && sideSlots.length > 0;
            return (
              <button key={side} type="button" disabled={readOnly}
                onClick={() => setSide(side, allFilled ? null : pendingType)}
                className={`rounded-md border px-2 py-1.5 text-[11px] font-medium capitalize transition ${
                  allFilled
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'
                }`}>
                {side} <span className="text-[9px] opacity-70">{sideFilled}/{sideSlots.length}</span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-1.5">
          <button type="button" className="ed-action flex-1 justify-center" disabled={readOnly}
            onClick={() => fillAll(pendingType)}>Fill all</button>
          <button type="button" className="ed-action flex-1 justify-center" disabled={readOnly}
            onClick={() => fillAll(null)}>Clear all</button>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-subtle">
          Mix types per side — open one face, glass on another, solid on the rest.
        </p>
      </section>
    </>
  );
}

/** Remembers the wall type chosen for the next fill, across renders. */
function useTentType(): [string, (v: string) => void] {
  const value = useEditor((s) => s.tentWallType);
  const set = useEditor((s) => s.setTentWallType);
  return [value, set];
}

/* ── Curtain ───────────────────────────────────────────────────────────── */

export function CurtainPanel({ curtain, units }: { curtain: CurtainSceneObject; units: Units }) {
  const updateObject = useEditor((s) => s.updateObject);
  const readOnly = useEditor((s) => s.readOnly);

  const patch = (changes: Partial<CurtainSceneObject>) => updateObject(curtain.id, changes as never);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  return (
    <>
      <section className="ed-section">
        <h3 className="ed-section-title">Curtain shape</h3>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <LenField label="Top width" valueMm={curtain.topWidthMm} units={units} disabled={readOnly}
            onChange={(mm) => patch({ topWidthMm: clamp(mm, CURTAIN_LIMITS.minWidthMm, CURTAIN_LIMITS.maxWidthMm) })} />
          <LenField label="Bottom width" valueMm={curtain.bottomWidthMm} units={units} disabled={readOnly}
            onChange={(mm) => patch({ bottomWidthMm: clamp(mm, CURTAIN_LIMITS.minWidthMm, CURTAIN_LIMITS.maxWidthMm) })} />
        </div>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <LenField label="Middle width" valueMm={curtain.middleWidthMm} units={units} disabled={readOnly}
            onChange={(mm) => patch({ middleWidthMm: clamp(mm, CURTAIN_LIMITS.minWidthMm, CURTAIN_LIMITS.maxWidthMm) })} />
          <LenField label="Height" valueMm={curtain.heightMm} units={units} disabled={readOnly}
            onChange={(mm) => patch({ heightMm: clamp(mm, CURTAIN_LIMITS.minHeightMm, CURTAIN_LIMITS.maxHeightMm) })} />
        </div>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <LenField label="Curve depth" valueMm={curtain.curveDepthMm} units={units} disabled={readOnly}
            onChange={(mm) => patch({ curveDepthMm: mm })} />
          <LenField label="Middle bend" valueMm={curtain.middleCurveMm} units={units} disabled={readOnly}
            onChange={(mm) => patch({ middleCurveMm: mm })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Folds" value={curtain.foldCount} min={CURTAIN_LIMITS.minFolds} max={CURTAIN_LIMITS.maxFolds}
            disabled={readOnly} onChange={(v) => patch({ foldCount: v })} />
          <LenField label="Fold depth" valueMm={curtain.foldAmplitudeMm} units={units} disabled={readOnly}
            onChange={(mm) => patch({ foldAmplitudeMm: clamp(mm, CURTAIN_LIMITS.minFoldAmplitudeMm, CURTAIN_LIMITS.maxFoldAmplitudeMm) })} />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-ink-subtle">
          Top {formatLength(curtain.topWidthMm, units)} / bottom {formatLength(curtain.bottomWidthMm, units)} /
          height {formatLength(curtain.heightMm, units)} · {curtain.foldCount} folds
        </p>
      </section>

      <section className="ed-section">
        <h3 className="ed-section-title">Appearance</h3>
        <label className="ed-label">Fabric colour</label>
        <input type="color" className="mb-2 h-8 w-full cursor-pointer rounded border border-line bg-surface-muted"
          value={curtain.color} disabled={readOnly}
          onChange={(e) => patch({ color: e.target.value })} />

        <label className="ed-label">Opacity · {Math.round(curtain.fillOpacity * 100)}%</label>
        <input type="range" min={0.1} max={1} step={0.05} value={curtain.fillOpacity} disabled={readOnly}
          className="mb-2 w-full accent-primary"
          onChange={(e) => patch({ fillOpacity: Number(e.target.value) })} />
        <p className="text-[10px] leading-relaxed text-ink-subtle">
          Lower the opacity for sheers and voiles.
        </p>
      </section>
    </>
  );
}

/* ── Shared field helpers ──────────────────────────────────────────────── */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}

function NumField({
  label, value, min, max, onChange, disabled,
}: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div>
      <label className="ed-label">{label}</label>
      <input type="number" className="ed-field" value={value} min={min} max={max} disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
        }} />
    </div>
  );
}

function LenField({
  label, valueMm, units, onChange, disabled,
}: { label: string; valueMm: number; units: Units; onChange: (mm: number) => void; disabled?: boolean }) {
  return (
    <div>
      <label className="ed-label">{label}</label>
      <input className="ed-field" defaultValue={formatLength(valueMm, units, { bare: true })} key={valueMm}
        disabled={disabled}
        onBlur={(e) => {
          const mm = parseLength(e.target.value, units);
          if (mm !== null) onChange(mm);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </div>
  );
}
