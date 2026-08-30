import { useState } from 'react';
import { LayoutGrid, Table2 } from 'lucide-react';
import { Section } from '../../components/ui';
import { CatalogPanel } from '../CatalogPanel';
import { QuickLayout } from '../QuickLayout';
import { TableDesigner } from '../TableDesigner';
import { SeatingPanel } from '../SeatingPanel';
import { useEditor } from '../editorStore';

/**
 * The Add panel.
 *
 * The catalogue, plus the generators that produce catalogue items *in
 * arrangement* rather than one at a time. The distinction from the Build panel
 * next door is that everything here is something you hire; everything there is
 * something you specify.
 *
 * The catalogue keeps its own search and scrolling, so it is embedded whole
 * rather than reimplemented — and it takes the height, because finding a chair
 * is what this panel is mostly for.
 */
export function AddPanel() {
  const selectedCount = useEditor((s) => s.selectedIds.length);
  const readOnly = useEditor((s) => s.readOnly);

  const [designerOpen, setDesignerOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);

  return (
    /*
     * The catalogue is given a definite height rather than `flex-1`.
     *
     * It was `flex-1` with an `h-full` child inside the panel host's scrolling
     * column, and a percentage height inside an auto-height scroller has no
     * stable answer: the content sized the container, the container sized the
     * content, and the layout oscillated every frame. That pegs the main thread
     * — clicks anywhere in the editor stopped completing at all, which is a far
     * worse symptom than the one it looked like.
     */
    <div>
      <div className="h-[46vh] min-h-[260px] overflow-hidden border-b border-line">
        <CatalogPanel />
      </div>

      <div>
        <Section
          title="Arrange"
          collapsible
          description="Generate a whole set rather than placing items one at a time."
        >
          <div className="space-y-1">
            <button
              type="button"
              className="ed-action w-full justify-start border border-line"
              disabled={readOnly}
              onClick={() => setDesignerOpen(true)}
            >
              <Table2 className="h-3.5 w-3.5" /> Table Designer
              <span className="ml-auto text-[10px] text-ink-subtle">tables, chairs, covers</span>
            </button>
            <button
              type="button"
              className="ed-action w-full justify-start border border-line"
              disabled={readOnly || selectedCount === 0}
              onClick={() => setLayoutOpen(true)}
              title={selectedCount === 0 ? 'Select something first, then arrange copies of it' : undefined}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Quick Layout
              <span className="ml-auto text-[10px] text-ink-subtle">
                {selectedCount === 0 ? 'select first' : `${selectedCount} selected`}
              </span>
            </button>
          </div>
          <p className="field-hint">
            A designed table set stays in step: change the table, the seat count or the layout and every chair, cover and
            place setting is regenerated with it.
          </p>
        </Section>

        <Section
          title="Seating"
          collapsible
          description="Read back from the layout: the tables in the plan become the chart, and a chair on the chart is the chair a guest will sit in."
        >
          <SeatingPanel />
        </Section>
      </div>

      <TableDesigner open={designerOpen} onClose={() => setDesignerOpen(false)} />
      <QuickLayout open={layoutOpen} onClose={() => setLayoutOpen(false)} />
    </div>
  );
}
