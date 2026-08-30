import { useState } from 'react';
import { Camera, ChevronDown, ChevronUp, Eye, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEditor } from './editorStore';
import { currentCamera } from './Viewport';
import { captureThumbnail } from './capture';
import { EmptyState, toast } from '../components/ui';

/**
 * Views.
 *
 * A client opening a share link has never used a 3D tool. Asked to orbit, they
 * will drag once, end up under the floor looking at the underside of a stage,
 * and close the tab — and the plan the designer spent two days on is judged on
 * that. Named viewpoints remove the problem entirely: the designer stands where
 * the design reads best, saves it, and the client presses a button.
 *
 * A view is a still vantage point, not a walkthrough shot. It has no duration,
 * no easing and no path — it is somewhere to stand. That distinction is why it
 * is a separate concept from the video shots in Present, which are a *move*
 * made to be rendered.
 *
 * The thumbnail is captured from the live frame at the moment it is saved, so
 * the strip a client sees is made of the actual views rather than a list of
 * names they have to imagine.
 */
export function SavedViewsPanel() {
  const views = useEditor((s) => s.scene.views ?? []);
  const addView = useEditor((s) => s.addView);
  const removeView = useEditor((s) => s.removeView);
  const renameView = useEditor((s) => s.renameView);
  const moveView = useEditor((s) => s.moveView);
  const goToView = useEditor((s) => s.goToView);
  const readOnly = useEditor((s) => s.readOnly);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const capture = () => {
    const camera = currentCamera();
    if (!camera) {
      toast('error', 'The 3D view is not ready yet.');
      return;
    }

    /*
     * A small thumbnail, deliberately. It is stored in the scene document,
     * which is saved on every change — a full-size frame would add half a
     * megabyte of base64 to every autosave.
     */
    addView({
      name: `View ${views.length + 1}`,
      positionMm: camera.positionMm,
      targetMm: camera.targetMm,
      fov: camera.fov,
      thumbnailUrl: captureThumbnail(320, 0.72),
    });
    toast('success', 'View saved. Rename it so a client knows what they are looking at.');
  };

  return (
    <>
      <section className="ed-section">
        <h3 className="ed-section-title">Saved views</h3>
        <p className="mb-2 text-[11px] leading-relaxed text-ink-subtle">
          Move the camera to where the design reads best, then save it. Anyone opening the share link gets these as
          buttons along the bottom — which is the difference between a client who explores the plan and one who gives
          up orbiting.
        </p>

        <button
          type="button"
          className="ed-action-primary w-full justify-center"
          onClick={capture}
          disabled={readOnly}
        >
          <Camera className="h-3.5 w-3.5" /> Save this view
        </button>
      </section>

      <section className="ed-section">
        {!views.length ? (
          <EmptyState
            compact
            icon={<Eye className="h-5 w-5" />}
            title="No views yet"
            description="Two or three is usually enough: the way in, the main view of the stage, and one detail worth pointing at."
          />
        ) : (
          <ol className="space-y-1.5">
            {views.map((view, index) => (
              <li key={view.id}>
                <div className="flex items-start gap-2 rounded-lg border border-line bg-surface p-1.5">
                  <button
                    type="button"
                    onClick={() => goToView(view)}
                    className="h-11 w-16 shrink-0 overflow-hidden rounded border border-line bg-surface-muted"
                    title="Fly the camera here"
                  >
                    {view.thumbnailUrl ? (
                      <img src={view.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center">
                        <Eye className="h-3.5 w-3.5 text-ink-subtle" />
                      </span>
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    {editing === view.id ? (
                      <input
                        className="ed-field"
                        autoFocus
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => {
                          if (draft.trim()) renameView(view.id, draft.trim().slice(0, 60));
                          setEditing(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                          if (event.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => goToView(view)}
                        className="block w-full truncate text-left text-xs font-semibold text-ink hover:text-primary"
                      >
                        {view.name}
                      </button>
                    )}
                    <p className="mt-0.5 text-[10px] tabular-nums text-ink-subtle">
                      {(view.positionMm.x / 1000).toFixed(1)}, {(view.positionMm.z / 1000).toFixed(1)} m · {view.fov}°
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col gap-0.5">
                    <div className="flex gap-0.5">
                      <button
                        type="button"
                        className="icon-btn-bare h-5 w-5"
                        disabled={readOnly || index === 0}
                        onClick={() => moveView(view.id, -1)}
                        aria-label="Move up"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn-bare h-5 w-5"
                        disabled={readOnly || index === views.length - 1}
                        onClick={() => moveView(view.id, 1)}
                        aria-label="Move down"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex gap-0.5">
                      <button
                        type="button"
                        className="icon-btn-bare h-5 w-5"
                        disabled={readOnly}
                        onClick={() => {
                          setEditing(view.id);
                          setDraft(view.name);
                        }}
                        aria-label={`Rename ${view.name}`}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn-bare h-5 w-5 hover:text-danger"
                        disabled={readOnly}
                        onClick={() => removeView(view.id)}
                        aria-label={`Delete ${view.name}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

/* ── The client's strip ────────────────────────────────────────────────── */

/**
 * The views, along the bottom of a shared plan.
 *
 * Closable, because a client who wants to look around freely should be able to
 * get the picture out of the way — and re-openable from a tab that stays put,
 * because a control that hides itself permanently is a control found once.
 *
 * Renders nothing at all when the designer saved no views: an empty strip
 * offering nothing is worse than no strip.
 */
export function ViewStrip() {
  const views = useEditor((s) => s.scene.views ?? []);
  const goToView = useEditor((s) => s.goToView);
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState<string | null>(null);

  if (!views.length) return null;

  if (!open) {
    return (
      <div className="shrink-0 border-t border-line bg-surface px-4 py-1.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted transition hover:text-primary"
        >
          <Eye className="h-3.5 w-3.5" />
          {views.length} saved view{views.length === 1 ? '' : 's'}
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <section aria-label="Saved views" className="nv-rise shrink-0 border-t border-line bg-surface">
      <div className="flex items-center gap-2 px-4 pt-2">
        <Eye className="h-3.5 w-3.5 shrink-0 text-primary" />
        <p className="flex-1 text-[11px] font-bold uppercase tracking-wide text-ink-subtle">Views</p>
        <p className="hidden text-[11px] text-ink-subtle sm:block">
          Press one to move there. Drag the plan to look around from wherever you land.
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="icon-btn-bare"
          aria-label="Hide the saved views"
          title="Hide"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="nv-no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3 pt-2">
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => {
              setActive(view.id);
              goToView(view);
            }}
            className={`w-[132px] shrink-0 overflow-hidden rounded-lg border text-left transition ${
              active === view.id
                ? 'border-primary ring-2 ring-primary/25'
                : 'border-line hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-card'
            }`}
          >
            <span className="block aspect-[16/10] w-full overflow-hidden bg-surface-muted">
              {view.thumbnailUrl ? (
                <img src={view.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  <Eye className="h-4 w-4 text-ink-subtle" />
                </span>
              )}
            </span>
            <span className="block truncate border-t border-line px-2 py-1.5 text-[11px] font-semibold text-ink">
              {view.name}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * A one-press way to keep the current view, floating on the plan.
 *
 * The panel is the right home for managing views; this is for the moment when
 * a designer has just orbited to something worth keeping and does not want to
 * cross the screen to say so.
 */
export function SaveViewButton({ labelled = true }: { labelled?: boolean } = {}) {
  const addView = useEditor((s) => s.addView);
  const views = useEditor((s) => s.scene.views ?? []);
  const readOnly = useEditor((s) => s.readOnly);

  if (readOnly) return null;

  return (
    <button
      type="button"
      title="Keep this camera position as a named view for the client"
      aria-label="Save view"
      onClick={() => {
        const camera = currentCamera();
        if (!camera) {
          toast('error', 'The 3D view is not ready yet.');
          return;
        }
        addView({
          name: `View ${views.length + 1}`,
          positionMm: camera.positionMm,
          targetMm: camera.targetMm,
          fov: camera.fov,
          thumbnailUrl: captureThumbnail(320, 0.72),
        });
        toast('success', 'View saved. Rename it in Present → Views.');
      }}
      className="ed-action shrink-0"
    >
      <Plus className="h-3.5 w-3.5" />
      {labelled ? <span>Save view</span> : null}
    </button>
  );
}
