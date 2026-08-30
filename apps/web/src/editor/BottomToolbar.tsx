import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Box,
  Frame,
  Grid3x3,
  HelpCircle,
  ImageDown,
  LayoutTemplate,
  Magnet,
  Maximize,
  Ruler,
  ScanEye,
  Square,
  Sun,
} from 'lucide-react';
import { useEditor } from './editorStore';
import { ImportFlow } from './ImportFlow';
import { HelpTip } from '../components/ui';
import { SaveViewButton } from './SavedViews';

/**
 * The bar along the very bottom.
 *
 * This is where the view controls have always lived and where people reach for
 * them without looking: which way the camera is pointing, whether the grid and
 * snapping are on, the two drawing tools, and the import. Floating them over
 * the plan looked tidier and was worse — a control you have to find is a
 * control you stop using, and an overlay swallows clicks meant for the floor
 * underneath it.
 *
 * Two things were added rather than moved. **Environment** opens the sky and
 * lighting chooser, because that is the other thing people change constantly
 * and it had no home outside a panel. **Templates** opens the starting-point
 * drawer, which used to sit open permanently across the bottom and now costs
 * nothing until it is asked for.
 *
 * The bar measures *itself* rather than using breakpoints. Tailwind's `md:`
 * and friends ask how wide the window is, and this bar does not span the
 * window — the left rail, an open panel and the properties sidebar all take
 * from it. On a 1600 px screen with both sidebars out the bar is under 900 px,
 * so window-based classes kept full labels for a row that had already pushed
 * Save view and Start from off the end. Text is dropped when this element runs
 * short, which is the only measurement that means anything here.
 */
export function BottomToolbar({
  templatesOpen,
  onToggleTemplates,
  onOpenEnvironment,
}: {
  templatesOpen: boolean;
  onToggleTemplates: () => void;
  onOpenEnvironment: () => void;
}) {
  const cameraMode = useEditor((s) => s.cameraMode);
  const setCameraMode = useEditor((s) => s.setCameraMode);
  const showGrid = useEditor((s) => s.showGrid);
  const toggleGrid = useEditor((s) => s.toggleGrid);
  const snapToGrid = useEditor((s) => s.snapToGrid);
  const toggleSnap = useEditor((s) => s.toggleSnap);
  const isolateMode = useEditor((s) => s.isolateMode);
  const toggleIsolate = useEditor((s) => s.toggleIsolate);
  const units = useEditor((s) => s.units);
  const objectCount = useEditor((s) => s.scene.objects.length);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const requestFrameAll = useEditor((s) => s.requestFrameAll);
  const hdriLabel = useEditor((s) => s.scene.lighting.customHdriLabel);

  const [importOpen, setImportOpen] = useState(false);

  const barRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    const node = barRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  /*
   * A ladder, each rung dropping the least useful thing still on screen. The
   * object count survives longest of the passive readouts because it is the
   * one people glance at; the help link goes first because it is a link to a
   * page, not a control for the plan.
   */
  const showHelp = width >= 1040;
  const labels = width >= 900;
  const showEnvironmentLabel = width >= 780;
  const showReadout = width >= 660;

  return (
    <div
      ref={barRef}
      className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-t border-line bg-surface px-2"
    >
      {/* ── Where the camera is ─────────────────────────────────────── */}
      <div className="ed-segment shrink-0">
        <button
          type="button"
          onClick={() => setCameraMode('top')}
          title="Look straight down — the right view for laying out a floor (T)"
          className={`ed-segment-btn ${cameraMode === 'top' ? 'ed-segment-btn-active' : ''}`}
        >
          <Square className="mr-1 inline h-3 w-3" /> Plan
        </button>
        <button
          type="button"
          onClick={() => setCameraMode('perspective')}
          title="Perspective view (P)"
          className={`ed-segment-btn ${cameraMode === 'perspective' ? 'ed-segment-btn-active' : ''}`}
        >
          <Box className="mr-1 inline h-3 w-3" /> 3D
        </button>
      </div>

      <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />

      {/* ── What the floor shows ────────────────────────────────────── */}
      <ToolbarToggle
        label="Grid"
        labelled={labels}
        icon={<Grid3x3 className="h-3.5 w-3.5" />}
        active={showGrid}
        onClick={toggleGrid}
        title="Show the floor grid (G)"
      />
      <ToolbarToggle
        label="Snap"
        labelled={labels}
        icon={<Magnet className="h-3.5 w-3.5" />}
        active={snapToGrid}
        onClick={toggleSnap}
        title="Snap what you place to the grid (S)"
      />
      <ToolbarToggle
        label="Isolate"
        labelled={labels}
        icon={<ScanEye className="h-3.5 w-3.5" />}
        active={isolateMode}
        onClick={toggleIsolate}
        title="Hide everything except what is selected"
      />

      <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />

      {/* ── Drawing ─────────────────────────────────────────────────── */}
      <ToolbarToggle
        label="Walls"
        labelled={labels}
        icon={<Frame className="h-3.5 w-3.5" />}
        active={tool === 'wall'}
        onClick={() => setTool(tool === 'wall' ? 'select' : 'wall')}
        title="Draw walls by clicking corners"
      />
      <ToolbarToggle
        label="Annotate"
        labelled={labels}
        icon={<Ruler className="h-3.5 w-3.5" />}
        active={tool === 'draw'}
        onClick={() => setTool(tool === 'draw' ? 'select' : 'draw')}
        title="Dimensions, zones, cable runs and notes"
      />

      <button
        type="button"
        className="ed-action shrink-0"
        onClick={() => requestFrameAll()}
        title="Fit everything in view (F)"
      >
        <Maximize className="h-3.5 w-3.5" />
        {labels ? 'Fit' : null}
      </button>

      <button
        type="button"
        className="ed-action shrink-0"
        onClick={() => setImportOpen(true)}
        title="Import a floor plan, a map or a background image"
      >
        <ImageDown className="h-3.5 w-3.5" />
        {labels ? 'Import' : null}
      </button>

      <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />

      {/* ── Environment ─────────────────────────────────────────────── */}
      <button
        type="button"
        className="ed-action shrink-0"
        onClick={onOpenEnvironment}
        title="Sky, sun and the environment map that lights the whole scene"
      >
        <Sun className="h-3.5 w-3.5" />
        {showEnvironmentLabel ? <span>{hdriLabel ? hdriLabel : 'Environment'}</span> : null}
      </button>

      {/*
        Keeping the current camera position.
        
        Here rather than only in the Present panel because the moment somebody
        wants to save a view is the moment they have just orbited to it, and
        crossing the screen to say so is how the feature goes unused.
      */}
      <SaveViewButton labelled={labels} />

      {/* ── The starting-point drawer ───────────────────────────────── */}
      <button
        type="button"
        onClick={onToggleTemplates}
        aria-expanded={templatesOpen}
        aria-controls="novira-templates-drawer"
        title="Pre-designed halls, booth templates, your own assets and certified designers"
        className={`ed-action shrink-0 border ${
          templatesOpen
            ? 'border-primary/40 bg-primary-soft text-primary'
            : 'border-line hover:border-line-strong'
        }`}
      >
        <LayoutTemplate className="h-3.5 w-3.5" />
        {labels ? <span>Start from…</span> : null}
      </button>

      {/* ── The read-out ────────────────────────────────────────────── */}
      <div
        className={`ml-auto flex shrink-0 items-center gap-2.5 pl-2 text-[11px] text-ink-subtle ${
          showReadout ? '' : 'hidden'
        }`}
      >
        {/*
          One string, not three nodes. Interpolating the pieces separately
          renders `8`, ` objects`, ` · `, `metric` as siblings, which reads
          oddly to a screen reader and cannot be matched as a phrase.
          
          The unit is capitalised in the string rather than with a `capitalize`
          class, which would also capitalise the count — "5 Objects · Imperial"
          reads as a heading rather than a read-out.
        */}
        <span className="tabular-nums">
          {`${objectCount} object${objectCount === 1 ? '' : 's'} · ${
            units.charAt(0).toUpperCase() + units.slice(1)
          }`}
        </span>
        {showHelp ? (
          <>
            <HelpTip text="Everything in a plan is stored in whole millimetres. The unit shown here only changes how measurements are written, never what they are." />
            <Link to="/help" className="ed-action" title="How everything works">
              <HelpCircle className="h-3.5 w-3.5" />
              <span>Help</span>
            </Link>
          </>
        ) : null}
      </div>

      <ImportFlow open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function ToolbarToggle({
  label,
  icon,
  active,
  onClick,
  title,
  labelled = true,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
  /** False when the bar is too narrow to spell it out; the title still does. */
  labelled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`ed-action shrink-0 ${active ? 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary' : ''}`}
    >
      {icon}
      {labelled ? <span>{label}</span> : null}
    </button>
  );
}
