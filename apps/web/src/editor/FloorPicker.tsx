import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layers, RotateCcw, Search, X } from 'lucide-react';
import {
  BUILT_IN_MATERIALS,
  DEFAULT_FLOOR_FINISH,
  searchMaterials,
  toFinish,
  type BuiltInMaterial,
} from '@novira/shared';
import { useEditor } from './editorStore';
import { toast } from '../components/ui';

/**
 * The floor of the room, from the toolbar.
 *
 * Surfacing a hall used to be a drag-only gesture — find the Finish rail,
 * find a material, drag it onto empty floor — which is fine once you know it
 * and invisible until then. A plan now opens on power-floated concrete rather
 * than a flat void, and this is how that gets changed to carpet, timber or
 * whatever the venue actually has.
 *
 * The button sits next to Environment on the bottom toolbar because that is
 * where the other room-wide look controls already are, and nothing that was
 * there has moved.
 */

/** Floors first: what someone opening a floor picker is looking for. */
const FLOOR_FAMILIES = new Set(['carpet', 'concrete', 'stone', 'timber']);

export function FloorPicker({ labelled }: { labelled: boolean }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const floorFinish = useEditor((s) => s.scene.floorFinish);
  const readOnly = useEditor((s) => s.readOnly);

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        className={`ed-action shrink-0 ${open ? 'border border-primary/40 bg-primary-soft text-primary' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="The floor of the room — carpet, timber, concrete or stone"
      >
        <span
          className="h-3.5 w-3.5 shrink-0 rounded-sm border border-line"
          style={{ background: floorFinish?.colorHex ?? '#a5a8ab' }}
          aria-hidden
        />
        {labelled ? <span>{floorFinish?.label ?? 'Floor'}</span> : null}
      </button>

      {open && !readOnly ? <FloorMenu anchor={buttonRef} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function FloorMenu({
  anchor,
  onClose,
}: {
  anchor: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const floorFinish = useEditor((s) => s.scene.floorFinish);
  const setFloorFinish = useEditor((s) => s.setFloorFinish);

  // Close on Escape without letting the editor's own handler also clear the
  // selection — see `ObjectQuickActions` for the same reasoning.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  const materials = useMemo(() => {
    const base = search.trim() ? searchMaterials(search) : BUILT_IN_MATERIALS;
    // Floor-appropriate families first, everything else after — a wall
    // plaster is a legitimate floor if somebody wants it, just not the answer
    // anyone is looking for first.
    const floors = base.filter((m) => FLOOR_FAMILIES.has(m.family));
    const rest = base.filter((m) => !FLOOR_FAMILIES.has(m.family));
    return [...floors, ...rest].slice(0, 40);
  }, [search]);

  const isDefault = floorFinish?.materialId === DEFAULT_FLOOR_FINISH.materialId;

  /*
   * Rendered into the body rather than next to the button.
   *
   * The bottom toolbar scrolls horizontally, and an `overflow-x-auto`
   * ancestor clips an absolutely-positioned child that reaches outside it —
   * so a menu anchored the ordinary way was drawn nowhere and the invisible
   * backdrop behind it swallowed every click meant for a swatch. A portal
   * with the button's own measured position gets both: anchored to the
   * button, clipped by nothing.
   */
  const rect = anchor.current?.getBoundingClientRect();
  const left = Math.max(8, Math.min((rect?.left ?? 8), window.innerWidth - 338));
  const bottom = Math.max(8, window.innerHeight - (rect?.top ?? 0) + 8);

  return createPortal(
    <>
      <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-[60] cursor-default" onClick={onClose} />
      <div className="fixed z-[61] w-[330px]" style={{ left, bottom }}>
        <div className="panel overflow-hidden p-0 shadow-xl">
          <div className="flex items-start gap-2 border-b border-line px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                <Layers className="h-3.5 w-3.5 text-ink-subtle" /> Floor
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-ink-subtle">
                Surfaces the whole room, and is priced by area with everything else.
              </p>
            </div>
            <button type="button" onClick={onClose} className="icon-btn h-6 w-6 shrink-0" aria-label="Close">
              <X className="h-3 w-3" />
            </button>
          </div>

          <div className="px-3 pt-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
              <input
                className="ed-field pl-8"
                placeholder="Carpet, oak, concrete, terrazzo…"
                value={search}
                autoFocus
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="max-h-[300px] overflow-y-auto p-3">
            {materials.length ? (
              <div className="grid grid-cols-4 gap-1.5">
                {materials.map((material) => (
                  <FloorSwatch
                    key={material.materialId}
                    material={material}
                    active={floorFinish?.materialId === material.materialId}
                    onPick={() => {
                      setFloorFinish(toFinish(material));
                      toast('success', `${material.label} on the floor.`);
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-[11px] text-ink-subtle">Nothing matches that.</p>
            )}
          </div>

          <div className="flex gap-1.5 border-t border-line px-3 py-2">
            <button
              type="button"
              className="ed-action flex-1 justify-center border border-line"
              disabled={isDefault}
              onClick={() => {
                setFloorFinish({ ...DEFAULT_FLOOR_FINISH });
                toast('success', 'Back to the hall floor.');
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Back to concrete
            </button>
            <button
              type="button"
              className="ed-action justify-center border border-line"
              disabled={!floorFinish}
              onClick={() => {
                setFloorFinish(null);
                toast('success', 'Floor surface removed.');
              }}
              title="No floor surface at all — the venue's own, or bare ground"
            >
              None
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

function FloorSwatch({
  material,
  active,
  onPick,
}: {
  material: BuiltInMaterial;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      title={material.label}
      className={`overflow-hidden rounded-lg border text-left transition ${
        active ? 'border-primary ring-2 ring-primary/30' : 'border-line hover:-translate-y-0.5 hover:border-primary/50'
      }`}
    >
      <span
        className="block aspect-square w-full"
        style={{
          background: material.maps?.color ? `url(${material.maps.color}) center/cover` : material.colorHex,
        }}
      />
      <span className="block truncate border-t border-line px-1.5 py-1 text-[9px] font-semibold leading-tight text-ink">
        {material.label}
      </span>
    </button>
  );
}
