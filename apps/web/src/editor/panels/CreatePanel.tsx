import { useState } from 'react';
import {
  Boxes,
  Cloud,
  FolderOpen,
  Frame,
  Image as ImageIcon,
  LayoutGrid,
  Layers,
  Ruler,
  Shapes,
  Sun,
  Table2,
  Type,
  Upload,
} from 'lucide-react';
import { CatalogPanel } from '../CatalogPanel';
import { AssetBrowser, ProviderSummary } from '../AssetBrowser';
import { MyLibrary } from '../MyLibrary';
import { CollectionsTab } from '../CollectionsTab';
import { QuickLayout } from '../QuickLayout';
import { TableDesigner } from '../TableDesigner';
import { SeatingPanel } from '../SeatingPanel';
import { ImportFlow } from '../ImportFlow';
import { BrandingPanel } from '../BrandingPanel';
import { useEditor } from '../editorStore';
import { Section } from '../../components/ui';

/**
 * Create & Import.
 *
 * The left panel, and the answer to "the sidebar shows me every option instead
 * of the one I want". It is organised by **what you are trying to put in the
 * room**, not by which subsystem implements it:
 *
 *  · **3D Models** — anything with volume. Measured catalogue first, then
 *    millions of online models, then what you have imported yourself.
 *  · **2D Art & Logos** — anything flat. Reference imagery, uploads, dimensional
 *    lettering and printed graphics.
 *  · **Layout Tools** — the things you draw rather than place: walls, zones,
 *    dimensions, and the generators that lay out a whole room at once.
 *
 * Only one is open at a time, and each opens on its most-used tab. A designer
 * looking for a chair sees chairs — not chairs, walls, dimension tools, seating
 * charts and a text generator competing for the same column.
 */

type Group = 'models' | 'art' | 'layout';

const GROUPS: Array<{
  key: Group;
  label: string;
  icon: typeof Boxes;
  note: string;
}> = [
  { key: 'models', label: '3D Models', icon: Boxes, note: 'Furniture, staging, structures and props.' },
  { key: 'art', label: '2D Art & Logos', icon: ImageIcon, note: 'Graphics, printed panels and lettering.' },
  { key: 'layout', label: 'Layout Tools', icon: Ruler, note: 'Walls, zones, dimensions and arrangements.' },
];

export function CreatePanel() {
  const [group, setGroup] = useState<Group>('models');

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/*
        The group switch. Three targets, always visible, so the panel's whole
        scope is legible at a glance — and only one body is mounted, so it is
        never a wall of controls.
      */}
      {/*
        One row, not a stack of three icon tiles. The taller version cost
        about 30 px of height to say exactly the same thing a single row
        says — and that is 30 px taken from the asset grid on every panel
        open, on the two panels people spend the most time in.
      */}
      <div className="shrink-0 border-b border-line p-1.5">
        <div className="ed-segment w-full">
          {GROUPS.map((entry) => {
            const Icon = entry.icon;
            const active = group === entry.key;
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => setGroup(entry.key)}
                title={entry.note}
                aria-pressed={active}
                className={`ed-segment-btn flex flex-1 items-center justify-center gap-1 whitespace-nowrap ${
                  active ? 'ed-segment-btn-active' : ''
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {entry.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {group === 'models' ? <ModelsGroup /> : group === 'art' ? <ArtGroup /> : <LayoutGroup />}
      </div>
    </div>
  );
}

/* ── 3D models ─────────────────────────────────────────────────────────── */

function ModelsGroup() {
  // Online first: eighteen libraries dwarf the measured catalogue, and the
  // ask most people bring here — "find me a chair" — is served better by
  // a wall of real photography than by the smaller curated set.
  const [tab, setTab] = useState<'catalogue' | 'online' | 'mine' | 'collections'>('online');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pt-2.5">
        <div className="ed-segment w-full">
          <Tab active={tab === 'catalogue'} onClick={() => setTab('catalogue')} icon={<Boxes className="h-3 w-3" />}>
            Measured
          </Tab>
          <Tab active={tab === 'online'} onClick={() => setTab('online')} icon={<Cloud className="h-3 w-3" />}>
            Online
          </Tab>
          <Tab active={tab === 'mine'} onClick={() => setTab('mine')} icon={<FolderOpen className="h-3 w-3" />}>
            Mine
          </Tab>
          <Tab active={tab === 'collections'} onClick={() => setTab('collections')} icon={<Layers className="h-3 w-3" />}>
            Collections
          </Tab>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'catalogue' ? (
          <CatalogPanel />
        ) : tab === 'online' ? (
          <AssetBrowser
            category="models"
            emptyHint="No models came back from the online libraries just now. The measured catalogue is unaffected."
          />
        ) : tab === 'mine' ? (
          <MyLibrary />
        ) : (
          <CollectionsTab />
        )}
      </div>

      {tab === 'online' ? <ProviderSummary category="models" /> : null}
    </div>
  );
}

/* ── 2D art ────────────────────────────────────────────────────────────── */

function ArtGroup() {
  const [tab, setTab] = useState<'images' | 'brand'>('images');
  const [importOpen, setImportOpen] = useState(false);
  const readOnly = useEditor((s) => s.readOnly);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pt-2.5">
        <div className="ed-segment w-full">
          <Tab active={tab === 'images'} onClick={() => setTab('images')} icon={<ImageIcon className="h-3 w-3" />}>
            Imagery
          </Tab>
          <Tab active={tab === 'brand'} onClick={() => setTab('brand')} icon={<Type className="h-3 w-3" />}>
            Lettering
          </Tab>
        </div>
      </div>

      {tab === 'images' ? (
        <>
          <p className="shrink-0 px-3 pb-1 pt-2 text-[10px] leading-relaxed text-ink-subtle">
            Drag any image into the plan and it becomes a printed panel at 2 m tall, sized to its own proportions.
            Attribution travels with it.
          </p>
          <div className="min-h-0 flex-1">
            <AssetBrowser category="images" />
          </div>
          <div className="shrink-0 border-t border-line px-3 py-2">
            <button
              type="button"
              className="ed-action w-full justify-center border border-line"
              disabled={readOnly}
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-3.5 w-3.5" /> Upload your own artwork
            </button>
          </div>
          <ProviderSummary category="images" />
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section
            title="Dimensional lettering"
            description="Extruded type and logos, with real depth, finish and mounting — the thing above a stand, not a label on it."
          >
            <BrandingPanel />
          </Section>
        </div>
      )}

      <ImportFlow open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

/* ── Layout tools ──────────────────────────────────────────────────────── */

function LayoutGroup() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const readOnly = useEditor((s) => s.readOnly);
  const selectedCount = useEditor((s) => s.selectedIds.length);

  const [designerOpen, setDesignerOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <Section title="Draw" description="Click corner to corner in the 3D view. Escape stops, Enter finishes.">
        <div className="space-y-1">
          <ToolButton
            active={tool === 'wall'}
            disabled={readOnly}
            icon={<Frame className="h-3.5 w-3.5" />}
            label="Walls"
            hint="Rooms, partitions and stand backwalls"
            onClick={() => setTool(tool === 'wall' ? 'select' : 'wall')}
          />
          <ToolButton
            active={tool === 'draw'}
            disabled={readOnly}
            icon={<Ruler className="h-3.5 w-3.5" />}
            label="Dimensions & zones"
            hint="Measurements, cable runs, gangways, notes"
            onClick={() => setTool(tool === 'draw' ? 'select' : 'draw')}
          />
          <ToolButton
            active={tool === 'shape'}
            disabled={readOnly}
            icon={<Shapes className="h-3.5 w-3.5" />}
            label="Blocks & platforms"
            hint="Simple extruded volumes to mass out a design"
            onClick={() => setTool(tool === 'shape' ? 'select' : 'shape')}
          />
        </div>
      </Section>

      <Section
        title="Arrange"
        description="Generate a whole set at once rather than placing items one at a time."
      >
        <div className="space-y-1">
          <ToolButton
            disabled={readOnly}
            icon={<Table2 className="h-3.5 w-3.5" />}
            label="Table Designer"
            hint="Tables, chairs, linen and covers, kept in step"
            onClick={() => setDesignerOpen(true)}
          />
          <ToolButton
            disabled={readOnly || selectedCount === 0}
            icon={<LayoutGrid className="h-3.5 w-3.5" />}
            label="Quick Layout"
            hint={selectedCount === 0 ? 'Select something first' : `Repeat the ${selectedCount} selected`}
            onClick={() => setLayoutOpen(true)}
          />
        </div>
      </Section>

      <Section
        title="Bring in a plan"
        description="Trace over a floor plan, a site map or a venue drawing so what you build sits on the real building."
      >
        <ToolButton
          disabled={readOnly}
          icon={<Upload className="h-3.5 w-3.5" />}
          label="Import a drawing or image"
          hint="PDF, PNG or JPEG, scaled to a known dimension"
          onClick={() => setImportOpen(true)}
        />
      </Section>

      <Section
        title="Seating"
        collapsible
        description="Read back from the layout: the tables in the plan become the chart, and a chair on the chart is a chair a guest will sit in."
      >
        <SeatingPanel />
      </Section>

      <TableDesigner open={designerOpen} onClose={() => setDesignerOpen(false)} />
      <QuickLayout open={layoutOpen} onClose={() => setLayoutOpen(false)} />
      <ImportFlow open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

/* ── Small pieces ──────────────────────────────────────────────────────── */

function Tab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`ed-segment-btn flex flex-1 items-center justify-center gap-1 ${active ? 'ed-segment-btn-active' : ''}`}
    >
      {icon}
      {children}
    </button>
  );
}

function ToolButton({
  active,
  disabled,
  icon,
  label,
  hint,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
        active
          ? 'border-primary/40 bg-primary-soft text-primary'
          : 'border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-muted'
      }`}
    >
      <span className={active ? 'text-primary' : 'text-ink-subtle'}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">{label}</span>
        <span className="block truncate text-[10px] font-normal text-ink-subtle">{hint}</span>
      </span>
      {active ? <span className="badge-info shrink-0">on</span> : null}
    </button>
  );
}

/** The environments library, given its own rail entry rather than a tab here. */
export function EnvironmentPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 px-3 pb-1 pt-2.5 text-[10px] leading-relaxed text-ink-subtle">
        <Sun className="mr-1 inline h-3 w-3" />
        Drag an environment onto the 3D view to light the whole scene with it. It drives reflections and shadow
        direction, so it changes far more than the sky.
      </p>
      <div className="min-h-0 flex-1">
        <AssetBrowser
          category="hdris"
          usableOnly
          emptyHint="No environments came back. The built-in skies in Simulation always work."
        />
      </div>
      <ProviderSummary category="hdris" />
    </div>
  );
}
