import { useEffect } from 'react';
import {
  Check,
  Circle,
  Minus,
  MoveHorizontal,
  PenLine,
  Ruler,
  Spline,
  Square,
  Tag,
  Trash2,
} from 'lucide-react';
import {
  DRAWING_PRESETS,
  DRAW_KIND_INFO,
  areaSqM,
  formatLength,
  measureDrawing,
  type DrawKind,
} from '@novira/shared';
import { useEditor } from './editorStore';
import { useEditorShallow, useSelectedObjects } from './selectors';

/**
 * Drafting tools.
 *
 * The panel replaces the properties panel while the draw tool is active, the
 * same way the wall panel does, so the controls are where the work is.
 *
 * Presets come before raw colour and weight because "fire egress" is a decision
 * a planner makes and "red dashed 40 mm" is only how it looks. Someone marking
 * escape routes should pick the thing they mean, once.
 */

const KIND_ICONS: Record<DrawKind, typeof Minus> = {
  line: Minus,
  polyline: PenLine,
  rectangle: Square,
  circle: Circle,
  arc: Spline,
  dimension: Ruler,
  area: Square,
  label: Tag,
};

export function DraftPanel() {
  const drawKind = useEditor((s) => s.drawKind);
  const setTool = useEditor((s) => s.setTool);
  const setDrawKind = useEditor((s) => s.setDrawKind);
  const style = useEditorShallow((s) => s.drawStyle);
  const setDrawStyle = useEditor((s) => s.setDrawStyle);
  const elevationMm = useEditor((s) => s.drawElevationMm);
  const setDrawElevation = useEditor((s) => s.setDrawElevation);
  const showMeasurements = useEditor((s) => s.showMeasurements);
  const toggleMeasurements = useEditor((s) => s.toggleMeasurements);
  const draft = useEditorShallow((s) => s.drawDraft);
  const finishDrawing = useEditor((s) => s.finishDrawing);
  const cancelDrawing = useEditor((s) => s.cancelDrawing);
  const units = useEditor((s) => s.scene.units);
  const readOnly = useEditor((s) => s.readOnly);
  const updateObject = useEditor((s) => s.updateObject);
  const deleteSelected = useEditor((s) => s.deleteSelected);

  const selected = useSelectedObjects();
  const selectedDrawing = selected.length === 1 && selected[0]!.type === 'drawing'
    ? (selected[0] as import('@novira/shared').DrawingSceneObject)
    : null;

  /*
   * Enter finishes an open run, Escape abandons it. Both are what a drafting
   * tool has always done, and neither should require finding a button.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!draft.length) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        finishDrawing();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelDrawing();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft.length, finishDrawing, cancelDrawing]);

  const info = DRAW_KIND_INFO[drawKind];
  const liveMeasure = draft.length >= 2 ? measureDrawing(drawKind, draft) : null;

  return (
    <div className="flex flex-col">
      {/*
        The way out.

        While a drawing tool is active it takes over the whole work column, so
        the control that turned it on is no longer on screen. Without an
        explicit exit the only escape is a keyboard shortcut nobody has been
        told about — which is how a tool becomes a trap.
      */}
      <header className="flex items-start gap-2 border-b border-line px-3 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">Drafting</h2>
          <p className="mt-0.5 text-[11px] text-ink-muted">{info.hint}</p>
        </div>
        <button
          type="button"
          className="ed-action shrink-0 border border-line"
          onClick={() => setTool('select')}
          title="Stop drafting and go back to selecting"
        >
          <Check className="h-3.5 w-3.5" /> Done
        </button>
      </header>

      <section className="ed-section">
        <h3 className="ed-section-title">Tool</h3>
        <div className="grid grid-cols-4 gap-1">
          {(Object.keys(DRAW_KIND_INFO) as DrawKind[]).map((kind) => {
            const Icon = KIND_ICONS[kind];
            return (
              <button
                key={kind}
                type="button"
                title={DRAW_KIND_INFO[kind].label}
                disabled={readOnly}
                onClick={() => setDrawKind(kind)}
                className={`flex flex-col items-center gap-0.5 rounded border px-1 py-1.5 text-[9px] transition ${
                  drawKind === kind
                    ? 'border-primary bg-primary/10 text-ink'
                    : 'border-line text-ink-muted hover:text-ink'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {DRAW_KIND_INFO[kind].label}
              </button>
            );
          })}
        </div>

        {draft.length ? (
          <div className="mt-2 rounded border border-primary/40 bg-primary/5 p-2">
            <p className="text-[11px] text-ink">
              {draft.length} point{draft.length === 1 ? '' : 's'} placed
              {liveMeasure
                ? ` · ${
                    liveMeasure.hasArea && draft.length > 2
                      ? `${areaSqM(liveMeasure.areaMm2)} m²`
                      : formatLength(Math.round(liveMeasure.lengthMm), units)
                  }`
                : ''}
            </p>
            <div className="mt-1.5 flex gap-1">
              <button type="button" className="ed-action flex-1 justify-center" onClick={finishDrawing}>
                Finish
              </button>
              <button type="button" className="ed-action flex-1 justify-center" onClick={cancelDrawing}>
                Cancel
              </button>
            </div>
            <p className="mt-1 text-[10px] text-ink-subtle">Enter to finish · Esc to cancel</p>
          </div>
        ) : null}
      </section>

      <section className="ed-section">
        <h3 className="ed-section-title">Purpose</h3>
        <div className="space-y-1">
          {DRAWING_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              disabled={readOnly}
              onClick={() => setDrawStyle(preset.style)}
              className="flex w-full items-center gap-2 rounded border border-line px-2 py-1.5 text-left transition hover:border-primary"
            >
              <span
                className="h-3 w-3 shrink-0 rounded-sm border"
                style={{
                  backgroundColor: preset.style.fillColor ?? 'transparent',
                  borderColor: preset.style.strokeColor ?? '#888',
                }}
              />
              <span className="min-w-0">
                <span className="block text-[11px] font-medium text-ink">{preset.label}</span>
                <span className="block truncate text-[10px] text-ink-subtle">{preset.note}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="ed-section">
        <h3 className="ed-section-title">Appearance</h3>

        <label className="mb-2 flex items-center justify-between gap-2">
          <span className="ed-label mb-0">Colour</span>
          <input
            type="color"
            className="h-7 w-12 cursor-pointer rounded border border-line bg-transparent"
            value={style.strokeColor}
            disabled={readOnly}
            onChange={(e) => setDrawStyle({ strokeColor: e.target.value })}
          />
        </label>

        <label className="mb-2 block">
          <div className="flex items-baseline justify-between">
            <span className="ed-label mb-0">Weight</span>
            <span className="text-[11px] tabular-nums text-ink">{style.strokeWidthMm} mm</span>
          </div>
          <input
            type="range"
            min={5}
            max={120}
            step={5}
            value={style.strokeWidthMm}
            disabled={readOnly}
            className="w-full accent-primary"
            onChange={(e) => setDrawStyle({ strokeWidthMm: Number(e.target.value) })}
          />
        </label>

        <label className="mb-2 flex items-center gap-2 text-[11px] text-ink-muted">
          <input type="checkbox" checked={style.dashed} disabled={readOnly}
            onChange={(e) => setDrawStyle({ dashed: e.target.checked })} />
          Dashed
        </label>

        {DRAW_KIND_INFO[drawKind].closes ? (
          <>
            <label className="mb-2 flex items-center justify-between gap-2">
              <span className="ed-label mb-0">Fill</span>
              <input
                type="color"
                className="h-7 w-12 cursor-pointer rounded border border-line bg-transparent"
                value={style.fillColor ?? '#4DA0FF'}
                disabled={readOnly}
                onChange={(e) => setDrawStyle({ fillColor: e.target.value })}
              />
            </label>
            <label className="mb-2 block">
              <div className="flex items-baseline justify-between">
                <span className="ed-label mb-0">Fill opacity</span>
                <span className="text-[11px] tabular-nums text-ink">
                  {Math.round(style.fillOpacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={0.8}
                step={0.02}
                value={style.fillOpacity}
                disabled={readOnly}
                className="w-full accent-primary"
                onChange={(e) => setDrawStyle({ fillOpacity: Number(e.target.value) })}
              />
            </label>
          </>
        ) : null}

        <label className="mb-2 block">
          <div className="flex items-baseline justify-between">
            <span className="ed-label mb-0">Text size</span>
            <span className="text-[11px] tabular-nums text-ink">{style.textSizeMm} mm</span>
          </div>
          <input
            type="range"
            min={60}
            max={800}
            step={20}
            value={style.textSizeMm}
            disabled={readOnly}
            className="w-full accent-primary"
            onChange={(e) => setDrawStyle({ textSizeMm: Number(e.target.value) })}
          />
        </label>

        {/* A ceiling rig plan is drawn above the floor, not on it. */}
        <label className="mb-1 block">
          <div className="flex items-baseline justify-between">
            <span className="ed-label mb-0">Height</span>
            <span className="text-[11px] tabular-nums text-ink">
              {formatLength(elevationMm, units)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={8000}
            step={100}
            value={elevationMm}
            disabled={readOnly}
            className="w-full accent-primary"
            onChange={(e) => setDrawElevation(Number(e.target.value))}
          />
          <p className="mt-0.5 text-[10px] text-ink-subtle">
            Draw at floor level, or higher for a rig or ceiling plan.
          </p>
        </label>

        <label className="flex items-center gap-2 text-[11px] text-ink-muted">
          <input type="checkbox" checked={showMeasurements} onChange={toggleMeasurements} />
          Show lengths and areas
        </label>
      </section>

      {/* ── Editing what is selected ────────────────────────────────────── */}
      {selectedDrawing ? (
        <section className="ed-section">
          <h3 className="ed-section-title">
            {DRAW_KIND_INFO[selectedDrawing.drawKind].label}
          </h3>

          <label className="mb-2 block">
            <span className="ed-label">Note</span>
            <input
              className="input"
              value={selectedDrawing.text ?? ''}
              placeholder={
                selectedDrawing.drawKind === 'dimension'
                  ? 'Overrides the measurement'
                  : 'Optional caption'
              }
              disabled={readOnly}
              onChange={(e) =>
                updateObject(selectedDrawing.id, { text: e.target.value } as never)
              }
            />
          </label>

          {selectedDrawing.drawKind === 'dimension' ? (
            <label className="mb-2 block">
              <div className="flex items-baseline justify-between">
                <span className="ed-label mb-0">Offset</span>
                <span className="text-[11px] tabular-nums text-ink">
                  {selectedDrawing.offsetMm ?? 400} mm
                </span>
              </div>
              <input
                type="range"
                min={-2000}
                max={2000}
                step={50}
                value={selectedDrawing.offsetMm ?? 400}
                disabled={readOnly}
                className="w-full accent-primary"
                onChange={(e) =>
                  updateObject(selectedDrawing.id, { offsetMm: Number(e.target.value) } as never)
                }
              />
              <p className="mt-0.5 text-[10px] text-ink-subtle">
                How far the dimension line sits off what it measures.
              </p>
            </label>
          ) : null}

          {(() => {
            const m = measureDrawing(selectedDrawing.drawKind, selectedDrawing.points);
            return (
              <dl className="space-y-0.5 text-[11px]">
                <div className="flex justify-between">
                  <dt className="text-ink-subtle">Length</dt>
                  <dd className="tabular-nums text-ink">
                    {formatLength(Math.round(m.lengthMm), units)}
                  </dd>
                </div>
                {m.hasArea ? (
                  <div className="flex justify-between">
                    <dt className="text-ink-subtle">Area</dt>
                    <dd className="tabular-nums text-ink">{areaSqM(m.areaMm2)} m²</dd>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <dt className="text-ink-subtle">Points</dt>
                  <dd className="tabular-nums text-ink">{selectedDrawing.points.length}</dd>
                </div>
              </dl>
            );
          })()}

          <button
            type="button"
            className="ed-action mt-2 w-full justify-center text-danger hover:bg-danger/10 hover:text-danger"
            disabled={readOnly}
            onClick={deleteSelected}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </section>
      ) : (
        <section className="ed-section">
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-ink-subtle">
            <MoveHorizontal className="mt-0.5 h-3 w-3 shrink-0" />
            Points snap to wall ends and midpoints before the grid, so a dimension lands exactly on
            what it measures.
          </p>
        </section>
      )}
    </div>
  );
}
