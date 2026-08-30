import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown, FileSpreadsheet, FileText, Layers, Package, Presentation, Ruler } from 'lucide-react';
import {
  DRAWING_LAYERS,
  DRAWING_LAYER_INFO,
  type DrawingLayer,
} from '@novira/shared';
import { useEditor } from '../editorStore';
import { spatial } from '../../lib/spatialApi';
import { saveDataUrl } from '../highResCapture';
import { EmptyState, Field, Section, Segmented, Select, Stat, Toggle, toast } from '../../components/ui';
import { PlanDrawingCanvas, drawingToPngDataUrl } from '../PlanDrawingCanvas';
import { DeckBuilder } from './DeckBuilder';

/**
 * Execution-ready output.
 *
 * The four documents a production team asks for, plus the deck that goes on top
 * of them. All five are generated from the same drawing and the same
 * measurement, which is the only way they can be guaranteed to agree — and a
 * technical drawing that disagrees with the bill of quantities is worse than
 * having neither.
 *
 * The drawing is shown before it is exported. A CAD file that turns out wrong
 * is discovered in a workshop; a preview turns that into a glance.
 */
export function OutputPanel() {
  const planId = useEditor((s) => s.planId);
  const title = useEditor((s) => s.title);
  const objectCount = useEditor((s) => s.scene.objects.length);
  const dirty = useEditor((s) => s.dirty);

  const [tab, setTab] = useState<'drawing' | 'deck'>('drawing');
  const [layers, setLayers] = useState<Set<DrawingLayer>>(new Set(DRAWING_LAYERS));
  const [dimensions, setDimensions] = useState<'none' | 'overall' | 'detailed'>('detailed');
  const [labels, setLabels] = useState(true);

  const layerParam = useMemo(() => [...layers].join(','), [layers]);

  const { data: drawing, isLoading } = useQuery({
    queryKey: ['plan-drawing', planId, layerParam, dimensions, labels, objectCount, dirty],
    queryFn: () => spatial.drawing(planId!, { layers: layerParam, dimensions, labels: String(labels) }),
    enabled: Boolean(planId) && tab === 'drawing',
    staleTime: 20_000,
  });

  const { data: materials } = useQuery({
    queryKey: ['plan-materials', planId, objectCount],
    queryFn: () => spatial.materials(planId!),
    enabled: Boolean(planId) && tab === 'drawing',
    staleTime: 30_000,
  });

  if (!planId) return null;

  return (
    <>
      <Section title="">
        <Segmented
          value={tab}
          columns={2}
          options={[
            { value: 'drawing', label: 'Drawings & data', hint: 'What a production team and a workshop need.' },
            { value: 'deck', label: 'Client deck', hint: 'What goes to the client.' },
          ]}
          onChange={setTab}
        />
      </Section>

      {tab === 'deck' ? <DeckBuilder /> : null}

      {tab === 'drawing' ? (
        <>
          <Section
            title="Layout plan"
            description="To scale, looking straight down. Toggle a layer off and it leaves the preview and every export."
          >
            {isLoading ? (
              <p className="text-[11px] text-ink-subtle">Building the drawing…</p>
            ) : drawing && drawing.shapes.length ? (
              <>
                <div className="overflow-hidden rounded-lg border border-line bg-white">
                  <PlanDrawingCanvas drawing={drawing} layers={layers} height={260} />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {drawing.facts.slice(0, 4).map((fact) => (
                    <span key={fact.label} className="chip">
                      {fact.label}: {fact.value}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState
                compact
                icon={<Ruler className="h-5 w-5" />}
                title="Nothing to draw yet"
                description="Add walls, staging, stands or furniture and the plan appears here, dimensioned and to scale."
              />
            )}
          </Section>

          <Section title="Layers" help="A fabricator wants structure and dimensions. A client wants the furniture. Turning a layer off here removes it from the preview and from every export.">
            <div className="grid grid-cols-2 gap-1">
              {DRAWING_LAYERS.map((layer) => {
                const info = DRAWING_LAYER_INFO[layer];
                const count = drawing?.legend.find((l) => l.layer === layer)?.count ?? 0;
                const on = layers.has(layer);
                return (
                  <button
                    key={layer}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setLayers((current) => {
                        const next = new Set(current);
                        if (next.has(layer)) next.delete(layer);
                        else next.add(layer);
                        return next;
                      })
                    }
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-[10px] font-semibold transition ${
                      on ? 'border-primary/60 bg-primary/10 text-ink' : 'border-line bg-surface-muted/40 text-ink-subtle'
                    }`}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: info.color }} />
                    <span className="min-w-0 flex-1 truncate">{info.label}</span>
                    {count ? <span className="shrink-0 tabular-nums opacity-70">{count}</span> : null}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Annotation">
            <Field label="Dimensions">
              <Select value={dimensions} onChange={(e) => setDimensions(e.target.value as typeof dimensions)}>
                <option value="detailed">Every element dimensioned</option>
                <option value="overall">Overall size only</option>
                <option value="none">No dimensions</option>
              </Select>
            </Field>
            <Toggle label="Labels" checked={labels} onChange={setLabels} hint="Names, stand numbers and fixture channels." />
          </Section>

          <Section title="Export" description="Each of these is generated from the drawing above, so all four agree with each other and with the plan.">
            <div className="space-y-1">
              <button
                type="button"
                className="ed-action w-full justify-start border border-line"
                onClick={() => {
                  void spatial
                    .downloadDxf(planId, { layers: layerParam, dimensions, labels: String(labels) })
                    .then(() => toast('success', 'DXF downloaded. It opens in AutoCAD, Vectorworks and most CAM software.'))
                    .catch(() => toast('error', 'Could not export the CAD file.'));
                }}
              >
                <Layers className="h-3.5 w-3.5" /> CAD drawing (DXF)
                <span className="ml-auto text-[10px] text-ink-subtle">for the workshop</span>
              </button>

              <button
                type="button"
                className="ed-action w-full justify-start border border-line"
                onClick={() => {
                  if (!drawing) return;
                  const dataUrl = drawingToPngDataUrl(drawing, layers, 3000);
                  if (!dataUrl) {
                    toast('error', 'Could not draw the image.');
                    return;
                  }
                  saveDataUrl(dataUrl, `${title || 'plan'}-technical.png`);
                  toast('success', 'Technical drawing saved.');
                }}
                disabled={!drawing}
              >
                <FileText className="h-3.5 w-3.5" /> Technical drawing (PNG)
                <span className="ml-auto text-[10px] text-ink-subtle">3000 px</span>
              </button>

              <button
                type="button"
                className="ed-action w-full justify-start border border-line"
                onClick={() => {
                  void spatial
                    .downloadBoq(planId, { prices: 'false' })
                    .then(() => toast('success', 'Bill of quantities downloaded.'))
                    .catch(() => toast('error', 'Could not export.'));
                }}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Bill of quantities (CSV)
                <span className="ml-auto text-[10px] text-ink-subtle">no prices</span>
              </button>

              <button
                type="button"
                className="ed-action w-full justify-start border border-line"
                onClick={() => {
                  void spatial
                    .downloadBoq(planId, { prices: 'true' })
                    .then(() => toast('success', 'Priced bill of quantities downloaded.'))
                    .catch(() => toast('error', 'Could not export.'));
                }}
              >
                <FileDown className="h-3.5 w-3.5" /> Priced BOQ (CSV)
                <span className="ml-auto text-[10px] text-ink-subtle">internal</span>
              </button>
            </div>
          </Section>

          {materials ? (
            <Section
              title="Material breakdown"
              description="The same measurement seen from the workshop's side: grouped by material, not by trade."
            >
              <div className="mb-2 grid grid-cols-3 gap-1.5">
                <Stat label="Weight" value={`${materials.weightKg} kg`} />
                <Stat label="Volume" value={`${materials.volumeCuM} m³`} />
                <Stat label="Loads" value={materials.truckLoads} />
              </div>
              <div className="space-y-1">
                {materials.materials.slice(0, 14).map((material) => (
                  <div key={material.family} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="min-w-0 flex-1 truncate text-ink-muted">{material.description}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-ink">
                      {material.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} {material.unit}
                    </span>
                  </div>
                ))}
              </div>
              {materials.materials.length === 0 ? (
                <p className="text-[11px] text-ink-subtle">Nothing measurable in this plan yet.</p>
              ) : null}
            </Section>
          ) : null}

          <Section title="What each of these is for" collapsible defaultOpen={false}>
            <dl className="space-y-2 text-[11px] leading-snug">
              <div>
                <dt className="font-semibold text-ink">
                  <Layers className="mr-1 inline h-3 w-3" /> CAD drawing
                </dt>
                <dd className="text-ink-muted">
                  Real geometry on named layers, in millimetres, written as DXF R12 — the revision every CAD and CAM
                  system reads. This is what goes to a fabricator.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">
                  <FileText className="mr-1 inline h-3 w-3" /> Technical drawing
                </dt>
                <dd className="text-ink-muted">
                  The same drawing as an image, dimensioned, with a title block. For a tender pack or a site pack where
                  nobody has CAD.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">
                  <FileSpreadsheet className="mr-1 inline h-3 w-3" /> Bill of quantities
                </dt>
                <dd className="text-ink-muted">
                  Every measured quantity with the basis for it, so a supplier or a client's quantity surveyor can check
                  the figure rather than take it on trust.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">
                  <Package className="mr-1 inline h-3 w-3" /> Material breakdown
                </dt>
                <dd className="text-ink-muted">
                  What has to be bought or pulled from stock, and how many truck loads it is.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">
                  <Presentation className="mr-1 inline h-3 w-3" /> Client deck
                </dt>
                <dd className="text-ink-muted">
                  Cover, concept, renders, plan, specification, quantities, commercials and a schedule — generated from
                  this plan, and editable before it goes out.
                </dd>
              </div>
            </dl>
          </Section>
        </>
      ) : null}
    </>
  );
}
