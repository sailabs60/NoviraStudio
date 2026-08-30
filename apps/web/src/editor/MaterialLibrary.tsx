import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  BUILT_IN_MATERIALS,
  MATERIAL_FAMILIES,
  MATERIAL_FAMILY_INFO,
  searchMaterials,
  toFinish,
  type BuiltInMaterial,
  type MaterialFamily,
} from '@novira/shared';
import { AssetBrowser, ProviderSummary } from './AssetBrowser';
import { draggableProps } from './useDropTarget';
import { useDrag } from './dragStore';
import { useEditor } from './editorStore';
import { useSelectedObjects } from './selectors';
import { toast } from '../components/ui';

/**
 * Materials.
 *
 * Two libraries under one panel, and the split is honest about what each is
 * for. **Included** is seventy-odd finishes that a stand actually gets built
 * from — 18 mm birch ply, grey loop pile, brushed stainless — every one of
 * which renders instantly on any machine and carries a rate the estimator can
 * price. **Online** is thousands of photographic scanned surfaces from Poly
 * Haven, ambientCG and BlenderKit, for when a render has to look like a
 * photograph.
 *
 * Both produce the same `SurfaceFinish`, so nothing downstream — the renderer,
 * the drop handler, the properties panel, the take-off — needs to know which
 * shelf a material came from.
 */
export function MaterialLibrary() {
  const [tab, setTab] = useState<'included' | 'online'>('included');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pt-2.5">
        <div className="ed-segment w-full">
          <button
            type="button"
            onClick={() => setTab('included')}
            className={`ed-segment-btn flex-1 ${tab === 'included' ? 'ed-segment-btn-active' : ''}`}
          >
            Included
          </button>
          <button
            type="button"
            onClick={() => setTab('online')}
            className={`ed-segment-btn flex-1 ${tab === 'online' ? 'ed-segment-btn-active' : ''}`}
          >
            Scanned
          </button>
        </div>
      </div>

      <HowToApply />

      <div className="min-h-0 flex-1">
        {tab === 'included' ? (
          <BuiltInMaterials />
        ) : (
          <AssetBrowser
            category="materials"
            usableOnly
            emptyHint="No scanned surfaces came back. The Included tab works offline and covers most builds."
          />
        )}
      </div>

      {tab === 'online' ? <ProviderSummary category="materials" /> : null}
    </div>
  );
}

/**
 * The one-line instruction.
 *
 * Shown once, at the top, and it changes with the selection — because "drag it
 * onto any surface" is the whole interaction, and a user who has already
 * selected something is told the faster path instead.
 */
function HowToApply() {
  const selected = useSelectedObjects();
  const target = useEditor((s) => s.finishTarget);
  const setTarget = useEditor((s) => s.setFinishTarget);

  const aimed = target && selected.some((o) => o.id === target.objectId) ? target : null;

  if (aimed) {
    return (
      <p className="mx-3 mb-1 mt-2 flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary-soft px-2 py-1.5 text-[10px] leading-relaxed text-primary">
        <span className="min-w-0 flex-1">
          Choosing a finish for <strong className="font-bold capitalize">{humanisePart(aimed.part)}</strong>.
        </span>
        <button
          type="button"
          onClick={() => setTarget(null)}
          className="shrink-0 font-bold underline underline-offset-2"
        >
          Whole object
        </button>
      </p>
    );
  }

  return (
    <p className="shrink-0 px-3 pb-1 pt-2 text-[10px] leading-relaxed text-ink-subtle">
      {selected.length === 1 ? (
        <>
          Drag a finish onto any surface in the 3D view — it paints the part it lands on. Or pick a part in
          the <strong className="font-semibold text-ink-muted">Finishes</strong> list on the right and click one here.
        </>
      ) : (
        <>Drag a finish onto any object, or onto empty floor to surface the whole room.</>
      )}
    </p>
  );
}

/** `deck-frame` reads as "Deck frame" wherever a part is named to a person. */
function humanisePart(part: string): string {
  if (part === '*') return 'the whole object';
  return part.replace(/[-_]+/g, ' ');
}

/* ── The included library ──────────────────────────────────────────────── */

function BuiltInMaterials() {
  const [family, setFamily] = useState<MaterialFamily | 'all'>('all');
  const [search, setSearch] = useState('');

  const results = useMemo(() => {
    const base = search.trim() ? searchMaterials(search) : BUILT_IN_MATERIALS;
    return family === 'all' ? base : base.filter((m) => m.family === family);
  }, [search, family]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
          <input
            className="ed-field pl-8 pr-8"
            placeholder="Search finishes — ply, velvet, terrazzo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search finishes"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-subtle hover:text-ink"
              aria-label="Clear the search"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="nv-no-scrollbar shrink-0 overflow-x-auto px-3 pb-2">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setFamily('all')}
            className={`chip shrink-0 ${family === 'all' ? 'chip-active' : ''}`}
          >
            All
          </button>
          {MATERIAL_FAMILIES.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFamily(key)}
              title={MATERIAL_FAMILY_INFO[key].note}
              className={`chip shrink-0 whitespace-nowrap ${family === key ? 'chip-active' : ''}`}
            >
              {MATERIAL_FAMILY_INFO[key].label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {!results.length ? (
          <p className="py-10 text-center text-xs text-ink-subtle">
            No included finish matches that. Try the Scanned tab for photographic surfaces.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {results.map((material) => (
              <MaterialSwatch key={material.materialId} material={material} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MaterialSwatch({ material }: { material: BuiltInMaterial }) {
  const dragging = useDrag((s) => s.payload);
  const selected = useSelectedObjects();
  const applyFinish = useEditor((s) => s.applyFinish);
  const readOnly = useEditor((s) => s.readOnly);

  const target = useEditor((s) => s.finishTarget);
  const finish = useMemo(() => toFinish(material), [material]);
  const isDragged = dragging?.kind === 'material' && dragging.finish.materialId === material.materialId;

  /*
   * Click applies to the selection, drag applies to whatever you drop on.
   *
   * Both, because they answer different questions. Dragging is how you paint a
   * specific surface you can see; clicking is how you finish the thing you have
   * already selected without hunting for it in a crowded 3D view.
   */
  const onClick = () => {
    if (readOnly) return;
    if (!selected.length) {
      toast('info', 'Select an object first, or drag this finish straight onto a surface.');
      return;
    }
    /*
     * A part chosen in the Finishes list wins, and only for the object it
     * belongs to. Painting the named part of one object onto every other
     * selected object would be a surprising reading of one click.
     */
    const aimed = target && selected.some((o) => o.id === target.objectId) ? target : null;
    if (aimed) {
      applyFinish(aimed.objectId, aimed.part, finish);
      toast('success', `${material.label} on ${humanisePart(aimed.part)}.`);
      return;
    }
    for (const object of selected) applyFinish(object.id, '*', finish);
    toast(
      'success',
      selected.length === 1
        ? `${material.label} applied to ${selected[0]!.name ?? 'the selection'}.`
        : `${material.label} applied to ${selected.length} objects.`
    );
  };

  return (
    <button
      type="button"
      {...draggableProps({ kind: 'material', finish })}
      onClick={onClick}
      title={`${material.label} — ${MATERIAL_FAMILY_INFO[material.family].label}. Drag onto a surface, or click to apply to the selection.`}
      className={`group overflow-hidden rounded-lg border text-left transition ${
        isDragged
          ? 'border-primary ring-2 ring-primary/30'
          : 'cursor-grab border-line hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-card active:cursor-grabbing'
      }`}
    >
      <span
        className="block aspect-square w-full"
        style={{
          background: material.maps?.color
            ? `url(${material.maps.color}) center/cover`
            : swatchGradient(material),
        }}
      />
      <span className="block truncate border-t border-line px-1.5 py-1 text-[9px] font-semibold leading-tight text-ink">
        {material.label}
      </span>
    </button>
  );
}

/**
 * A swatch for a material with no texture map.
 *
 * A flat rectangle of colour tells you the hue and nothing else — you cannot
 * tell brushed steel from matt paint. A gradient with a highlight reads the
 * material's roughness and metalness, which is most of what separates them by
 * eye, and it costs nothing to draw.
 */
function swatchGradient(material: BuiltInMaterial): string {
  const sheen = Math.round((1 - material.roughness) * 100);
  const metal = material.metalness;
  const highlight = metal > 0.5 ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.45)';
  const shade = metal > 0.5 ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.2)';
  return `linear-gradient(145deg, ${highlight} 0%, transparent ${Math.max(12, sheen)}%, transparent 62%, ${shade} 100%), ${material.colorHex}`;
}
