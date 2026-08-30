import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LogoMark } from '../components/Logo';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Command,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Save,
  Undo2,
} from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { useEditor, type WorkPanel } from '../editor/editorStore';
import { capturePreview } from '../editor/capture';
import { Viewport } from '../editor/Viewport';
import { PropertiesDock } from '../editor/PropertiesDock';
import { WallPanel } from '../editor/WallPanel';
import { DraftPanel } from '../editor/DraftPanel';
import { useCollaboration } from '../editor/useCollaboration';
import { PresenceBar } from '../editor/Presence';
import { Spinner } from '../components/Spinner';
import { ShareMenu } from '../editor/ShareMenu';
import { TemplatesMenu } from '../editor/TemplatesMenu';
import { AiPanel } from '../editor/AiPanel';
import { WorkRail, PanelHeader, RAIL_ITEMS } from '../editor/WorkRail';
import { CreatePanel } from '../editor/panels/CreatePanel';
import { BuildPanel } from '../editor/panels/BuildPanel';
import { MaterialLibrary } from '../editor/MaterialLibrary';
import { SitePanel } from '../editor/panels/SitePanel';
import { LightPanel } from '../editor/panels/LightPanel';
import { CostPanel, CostBadge } from '../editor/panels/CostPanel';
import { CheckPanel, CheckBadge } from '../editor/panels/CheckPanel';
import { PresentPanel } from '../editor/panels/PresentPanel';
import { ReviewPanel } from '../editor/panels/ReviewPanel';
import { AssetStrip } from '../editor/AssetStrip';
import { BottomToolbar } from '../editor/BottomToolbar';
import { EnvironmentDialog } from '../editor/EnvironmentDialog';
import { Assistant } from '../editor/Assistant';
import { DragLayer } from '../editor/DragLayer';
import { useDropTarget } from '../editor/useDropTarget';
import { useDrag } from '../editor/dragStore';
import { CommandPalette, useCommandPalette } from '../components/CommandPalette';
import { GuidedTour } from '../components/GuidedTour';
import { ToastHost } from '../components/ui';

const AUTOSAVE_DELAY = 4000;

/**
 * The studio.
 *
 * Five regions, and each one answers a different question, which is the whole
 * reason the layout is worth being deliberate about:
 *
 *  · **Top bar** — where am I, and is my work safe.
 *  · **Icon rail** — what phase of the work am I in.
 *  · **Left panel** — what am I putting into the room.
 *  · **Right dock** — what does the thing I selected do, and what is the room
 *    doing.
 *  · **Bottom strip** — what could I start from instead of a blank floor.
 *
 * The centre is the plan, and everything else is sized so the plan keeps the
 * space. Both side panels collapse, and the viewport takes the room back — a
 * designer presenting to a client should be able to get to a clean frame
 * without leaving the editor.
 */
export function EditorPage() {
  const { planId } = useParams();
  const id = Number(planId);

  const load = useEditor((s) => s.load);
  const cacheItems = useEditor((s) => s.cacheItems);
  const scene = useEditor((s) => s.scene);
  const dirty = useEditor((s) => s.dirty);
  const saving = useEditor((s) => s.saving);
  const saveError = useEditor((s) => s.saveError);
  const lastSavedAt = useEditor((s) => s.lastSavedAt);
  const markSaving = useEditor((s) => s.markSaving);
  const markSaved = useEditor((s) => s.markSaved);
  const setSaveError = useEditor((s) => s.setSaveError);
  const title = useEditor((s) => s.title);
  const readOnly = useEditor((s) => s.readOnly);

  const palette = useCommandPalette();

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  /*
   * The templates drawer starts closed. It used to be a permanent band across
   * the bottom, which cost 170 px of plan for something most people open twice
   * in a project — at the start, and when they are stuck.
   */
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [environmentOpen, setEnvironmentOpen] = useState(false);

  const { data: plan, isLoading, error } = useQuery({
    queryKey: ['plan', id],
    queryFn: () => api.plans.get(id),
    enabled: Number.isInteger(id) && id > 0,
  });

  useEffect(() => {
    if (!plan) return;
    load({
      id: plan.id,
      title: plan.title,
      units: plan.units,
      scene: plan.scene,
      readOnly: plan.isReadOnly,
    });
  }, [plan, load]);

  // Hydrate the catalogue rows the scene references, so models render on load.
  useEffect(() => {
    const ids = [
      ...new Set(
        scene.objects
          .filter((o): o is Extract<typeof o, { type: 'catalog' }> => o.type === 'catalog')
          .map((o) => o.catalogItemId)
      ),
    ];
    if (!ids.length) return;
    void api.catalog.byIds(ids).then(cacheItems);
  }, [scene.objects, cacheItems]);

  const save = useCallback(async () => {
    const state = useEditor.getState();
    if (!state.planId || state.readOnly || state.saving) return;
    markSaving(true);
    try {
      const previewDataUrl = capturePreview() ?? undefined;
      await api.plans.save(state.planId, { scene: state.scene, previewDataUrl });
      markSaved();
    } catch (err) {
      setSaveError(err instanceof ApiClientError ? err.message : 'Could not save your changes.');
    }
  }, [markSaving, markSaved, setSaveError]);

  // Autosave: debounce so a drag does not fire a request per frame.
  const timer = useRef<number>();
  useEffect(() => {
    if (!dirty || readOnly) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer.current);
  }, [dirty, readOnly, save, scene]);

  // Warn before leaving with unsaved work.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useKeyboardShortcuts(save, { setLeftOpen, setRightOpen });

  /*
   * The properties dock asks for the environment window by event rather than by
   * a threaded callback. It is three components deep and the alternative is
   * passing a setter through every one of them for a single dialog.
   */
  useEffect(() => {
    const open = () => setEnvironmentOpen(true);
    window.addEventListener('novira:open-environment', open);
    return () => window.removeEventListener('novira:open-environment', open);
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <Spinner label="Opening plan…" />
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg">
        <p className="text-base font-semibold text-ink">Plan unavailable</p>
        <p className="text-sm text-ink-muted">
          {error instanceof ApiClientError ? error.message : 'This plan could not be opened.'}
        </p>
        <Link to="/dashboard" className="btn-secondary mt-2">
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <StudioTopBar
        title={title}
        projectId={plan.projectId}
        dirty={dirty}
        saving={saving}
        saveError={saveError}
        lastSavedAt={lastSavedAt}
        readOnly={readOnly}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
        onSave={save}
        onOpenPalette={() => palette.setOpen(true)}
      />

      <div className="flex min-h-0 flex-1">
        <WorkRail collapsed={!leftOpen} onSelect={() => setLeftOpen(true)} />
        {leftOpen ? <WorkPanelHost onClose={() => setLeftOpen(false)} /> : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <StudioStage />
          <AssetStrip open={templatesOpen} onClose={() => setTemplatesOpen(false)} />
          <BottomToolbar
            templatesOpen={templatesOpen}
            onToggleTemplates={() => setTemplatesOpen((v) => !v)}
            onOpenEnvironment={() => setEnvironmentOpen(true)}
          />
        </div>

        {rightOpen ? <PropertiesDock onClose={() => setRightOpen(false)} /> : null}
      </div>

      <CommandPalette open={palette.open} onClose={() => palette.setOpen(false)} />
      <EnvironmentDialog open={environmentOpen} onClose={() => setEnvironmentOpen(false)} />
      <GuidedTour />
      <DragLayer />
      <ToastHost />
    </div>
  );
}

/* ── The centre ────────────────────────────────────────────────────────── */

/**
 * The plan, and everything that floats over it.
 *
 * The drop handlers live on this wrapper rather than on the canvas, because a
 * drag has to be tracked across the overlays too — a model released over the
 * transform toolbar should still land on the floor beneath it, not vanish.
 */
function StudioStage() {
  const drop = useDropTarget();
  const dragging = useDrag((s) => s.payload);
  const overViewport = useDrag((s) => s.overViewport);

  return (
    <div
      className="relative min-h-0 flex-1"
      onDragEnter={drop.onDragEnter}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={drop.onDrop}
    >
      <Viewport />
      <Assistant />

      {/*
        A ring around the drop target while a drag is over it. Small, but it is
        the difference between "this area accepts what I am holding" and a
        guess — and it costs one border.
      */}
      {dragging && overViewport ? (
        <span
          className="pointer-events-none absolute inset-0 rounded-none ring-2 ring-inset ring-primary/50"
          aria-hidden
        />
      ) : null}
    </div>
  );
}

/* ── The work panel ────────────────────────────────────────────────────── */

/**
 * One column that changes with the rail, plus two tools that take it over.
 *
 * The wall tool and the drafting tool both need the whole column while they are
 * active and neither has anywhere else to live — and while you are drawing a
 * wall, the catalogue is not what you want on screen anyway.
 */
function WorkPanelHost({ onClose }: { onClose: () => void }) {
  const workPanel = useEditor((s) => s.workPanel);
  const tool = useEditor((s) => s.tool);

  if (tool === 'wall' || tool === 'draw') {
    return (
      <aside className="ed-panel w-[368px] shrink-0 overflow-y-auto border-r" aria-label="Drawing tool">
        {tool === 'wall' ? <WallPanel /> : <DraftPanel />}
      </aside>
    );
  }

  return (
    <aside
      className="ed-panel flex w-[368px] shrink-0 flex-col overflow-hidden border-r"
      aria-label="Work panel"
    >
      <PanelHeader panel={workPanel} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <PanelBody panel={workPanel} />
      </div>
    </aside>
  );
}

function PanelBody({ panel }: { panel: WorkPanel }) {
  switch (panel) {
    case 'add':
      return <CreatePanel />;
    case 'build':
      return <Scrollable><BuildPanel /></Scrollable>;
    case 'finish':
      return <MaterialLibrary />;
    case 'site':
      return <Scrollable><SitePanel /></Scrollable>;
    case 'light':
      return <Scrollable><LightPanel /></Scrollable>;
    case 'cost':
      return <Scrollable><CostPanel /></Scrollable>;
    case 'check':
      return <Scrollable><CheckPanel /></Scrollable>;
    case 'present':
      return <Scrollable><PresentPanel /></Scrollable>;
    case 'review':
      return <Scrollable><ReviewPanel /></Scrollable>;
    default:
      return <CreatePanel />;
  }
}

/**
 * A scrolling wrapper for the panels that are plain vertical content.
 *
 * The library panels manage their own scrolling because they have a fixed
 * header and an infinite list underneath; everything else is a stack of
 * sections and just needs a scrollbar.
 */
function Scrollable({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-y-auto">{children}</div>;
}

/* ── Top bar ───────────────────────────────────────────────────────────── */

function StudioTopBar({
  title,
  projectId,
  dirty,
  saving,
  saveError,
  lastSavedAt,
  readOnly,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
  onSave,
  onOpenPalette,
}: {
  title: string;
  projectId: number;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  lastSavedAt: number | null;
  readOnly: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onSave: () => Promise<void>;
  onOpenPalette: () => void;
}) {
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  const status = saveError
    ? { text: 'Save failed', tone: 'text-danger' }
    : saving
      ? { text: 'Saving…', tone: 'text-ink-subtle' }
      : dirty
        ? { text: 'Unsaved changes', tone: 'text-warning' }
        : lastSavedAt
          ? { text: 'Saved', tone: 'text-success' }
          : { text: '', tone: '' };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-2.5">
      {/* Identity and place. */}
      <Link
        to={`/projects/${projectId}`}
        className="icon-btn-bare"
        aria-label="Back to the project"
        title="Back to the project"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>

      <LogoMark size={24} className="!rounded-md" />

      <span className="mx-1 h-5 w-px bg-line" aria-hidden />

      <h1 className="min-w-0 max-w-[240px] truncate text-[13px] font-bold text-ink">{title}</h1>
      {readOnly ? <span className="badge-neutral shrink-0">View only</span> : null}
      <span className={`shrink-0 text-[11px] ${status.tone}`}>{status.text}</span>

      <div className="ml-1 shrink-0">
        <TemplatesMenu />
      </div>

      {/*
        The centre group: the six controls used constantly, in the middle of
        the window where the cursor already is. Absolutely positioned so it
        stays centred on the *window* rather than drifting with the title.
      */}
      <div className="pointer-events-none absolute inset-x-0 hidden justify-center xl:flex">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-xs">
          <button
            type="button"
            className="icon-btn-bare"
            onClick={undo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="icon-btn-bare"
            onClick={redo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </button>
          <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
          <button
            type="button"
            className="ed-action"
            onClick={onSave}
            disabled={readOnly || saving}
            title="Save (Ctrl+S)"
          >
            <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}
          </button>
          <ShareMenu onRequestSave={onSave} />
          <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
          <button
            type="button"
            className="ed-action"
            onClick={onOpenPalette}
            title="Search every feature by name (Ctrl+K)"
          >
            <Command className="h-3.5 w-3.5" /> Search
          </button>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {/*
          The two numbers a planner glances at constantly: what it costs and
          whether it passes. Both open their panel when clicked.
        */}
        <CostBadge />
        <CheckBadge />
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />

        <EditorPresence />
        <AiPanel />

        {/* Below xl the centre group has nowhere to sit, so it folds in here. */}
        <span className="flex items-center gap-0.5 xl:hidden">
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <button type="button" className="icon-btn-bare" onClick={undo} disabled={!canUndo} aria-label="Undo">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" className="icon-btn-bare" onClick={redo} disabled={!canRedo} aria-label="Redo">
            <Redo2 className="h-4 w-4" />
          </button>
          <ShareMenu onRequestSave={onSave} />
          <button type="button" className="ed-action-primary" onClick={onSave} disabled={readOnly || saving}>
            <Save className="h-3.5 w-3.5" />
          </button>
        </span>

        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <button
          type="button"
          className="icon-btn-bare"
          onClick={onToggleLeft}
          aria-pressed={leftOpen}
          title={leftOpen ? 'Hide the library (Ctrl+\\)' : 'Show the library (Ctrl+\\)'}
          aria-label={leftOpen ? 'Hide the library panel' : 'Show the library panel'}
        >
          {leftOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>
        <button
          type="button"
          className="icon-btn-bare"
          onClick={onToggleRight}
          aria-pressed={rightOpen}
          title={rightOpen ? 'Hide properties (Ctrl+.)' : 'Show properties (Ctrl+.)'}
          aria-label={rightOpen ? 'Hide the properties panel' : 'Show the properties panel'}
        >
          {rightOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </button>
        <Link to="/help" className="icon-btn-bare" title="How everything works" aria-label="Help">
          <HelpCircle className="h-4 w-4" />
        </Link>
      </div>
    </header>
  );
}

/* ── Viewport chrome ───────────────────────────────────────────────────── */

/* ── Keyboard ──────────────────────────────────────────────────────────── */

/**
 * The editor keyboard map.
 *
 * Number keys move between the rail's sections, which is the one shortcut worth
 * teaching a new user: it makes the whole product reachable without the mouse
 * leaving the model.
 */
function useKeyboardShortcuts(
  save: () => void,
  panels: {
    setLeftOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setRightOpen: React.Dispatch<React.SetStateAction<boolean>>;
  }
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (target?.isContentEditable) return;

      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
        return;
      }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        s.duplicateSelected();
        return;
      }
      // Panel visibility: the two keys that turn the studio into a clean frame.
      if (mod && e.key === '\\') {
        e.preventDefault();
        panels.setLeftOpen((v) => !v);
        return;
      }
      if (mod && e.key === '.') {
        e.preventDefault();
        panels.setRightOpen((v) => !v);
        return;
      }
      if (mod) return;

      // Rail sections on the number row.
      const railIndex = RAIL_ITEMS.findIndex((item) => item.shortcut === e.key);
      if (railIndex >= 0) {
        e.preventDefault();
        s.setWorkPanel(RAIL_ITEMS[railIndex]!.key);
        panels.setLeftOpen(true);
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'g':
          s.setTransformMode('translate');
          break;
        case 'r':
          s.setTransformMode('rotate');
          break;
        case 'e':
          s.setTransformMode('scale');
          break;
        case 's':
          s.toggleSnap();
          break;
        case 't':
          s.setCameraMode('top');
          break;
        case 'p':
          s.setCameraMode('perspective');
          break;
        case 'f':
          s.requestFrameAll();
          break;
        case 'l':
          s.toggleLockSelected();
          break;
        case ' ':
          // Space plays and pauses the walkthrough, as it does everywhere else.
          if (s.scene.walkthrough.shots.length) {
            e.preventDefault();
            s.setPlaying(!s.playing);
          }
          break;
        case 'enter':
          if (s.tool === 'constraint') s.finishConstraint();
          else if (s.tool === 'draw') s.finishDrawing();
          break;
        case 'escape':
          if (s.tool === 'constraint') s.cancelConstraint();
          else if (s.pendingItem) s.setPendingItem(null);
          else s.clearSelection();
          break;
        case 'delete':
        case 'backspace':
          e.preventDefault();
          s.deleteSelected();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, panels]);
}

/** Who else is editing, in the header. */
function EditorPresence() {
  const planId = useEditor((s) => s.planId);
  const { peers, status } = useCollaboration(planId);
  return <PresenceBar peers={peers} status={status} />;
}
