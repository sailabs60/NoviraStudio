import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus, Sparkles, Trash2, Pencil } from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { AppShell } from '../components/AppShell';
import { Figure } from '../landing/pieces';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';

/** A plan started with no name typed at all gets one that says so, plainly. */
function untitledEventName(): string {
  const stamp = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date());
  return `New event, ${stamp}`;
}

export function DashboardPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: api.projects.list,
  });

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; title: string } | null>(null);

  const create = useMutation({
    mutationFn: () => api.projects.create(title.trim(), description.trim() || undefined),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      setCreating(false);
      setTitle('');
      setDescription('');
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Could not create the project.'),
  });
  /*
   * A second click inside the same event-loop tick reads `create.isPending`
   * before React has re-rendered with it — the window is small, but two
   * clicks close together land in it often enough that the same title has
   * shown up twice in the project list. `disabled` is still there for the
   * visual state; this ref is what actually makes a second submission
   * impossible, since it is checked and set synchronously rather than
   * waiting on a render.
   */
  const submittingRef = useRef(false);
  const submitCreate = () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    create.mutate(undefined, { onSettled: () => { submittingRef.current = false; } });
  };

  /*
   * One click from the dashboard straight into a canvas.
   *
   * The named flow — New project, then New plan inside it — is right for
   * someone who already knows what event this is. It is two forms and a
   * navigation for someone who does not, and does not want to decide that
   * before they have even seen the tool. This creates both records with a
   * placeholder name and lands directly in the editor; the name is a label
   * on the project card afterwards, renamed in two clicks whenever it
   * matters, not a gate in front of starting.
   */
  const quickStart = useMutation({
    mutationFn: async () => {
      const name = untitledEventName();
      const project = await api.projects.create(name);
      return api.plans.create(project.id, 'Untitled plan');
    },
    onSuccess: (plan) => navigate(`/editor/${plan.id}`),
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Could not start a new plan.'),
  });
  const quickStartRef = useRef(false);
  const startQuick = () => {
    if (quickStartRef.current) return;
    quickStartRef.current = true;
    quickStart.mutate(undefined, { onSettled: () => { quickStartRef.current = false; } });
  };

  const remove = useMutation({
    mutationFn: (id: number) => api.projects.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      setConfirmDelete(null);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Could not delete the project.'),
  });

  return (
    <AppShell>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Your projects</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Each project holds the plans for one event.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" className="btn-secondary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New project
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={quickStart.isPending}
            onClick={startQuick}
            title="Skip naming anything — start designing straight away"
          >
            <Sparkles className="h-4 w-4" /> {quickStart.isPending ? 'Starting…' : 'New plan'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-24">
          <Spinner label="Loading projects…" />
        </div>
      ) : !projects?.length ? (
        /*
         * The first screen anyone sees. A card with three lines in the middle of
         * it reads as a page that failed to load; giving the empty state a
         * picture and a single obvious action makes it read as the beginning of
         * something. The image is optional — see IMAGE_PROMPTS.md — and the
         * layout is designed to look finished without it.
         */
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
          <div className="grid items-center gap-0 md:grid-cols-2">
            <div className="px-6 py-10 sm:px-10">
              <p className="text-xl font-black tracking-tight text-ink">Start with an empty floor</p>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
                A project holds one event. Inside it, each plan is one space you are laying out — a hall, a stand, a
                stage. Everything else in Novira works off those plans.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={quickStart.isPending}
                  onClick={startQuick}
                >
                  <Sparkles className="h-4 w-4" /> {quickStart.isPending ? 'Starting…' : 'Jump straight in'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> Name it first
                </button>
              </div>
            </div>
            <Figure
              dir="app"
              slot="empty-projects"
              alt="A blank sheet, a scale rule and a pencil on a white studio table"
              ratio="16 / 10"
              rounded="rounded-none"
              className="hidden border-0 border-l md:block"
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <div key={project.id} className="card-hover group relative flex flex-col">
              <Link to={`/projects/${project.id}`} className="flex flex-1 flex-col">
                <div className="mb-3 grid h-32 grid-cols-2 gap-1 overflow-hidden rounded-lg bg-surface-muted/60">
                  {project.previewUrls.length ? (
                    project.previewUrls.slice(0, 4).map((url, i) => (
                      <img key={i} src={url} alt="" className="h-full w-full object-cover" />
                    ))
                  ) : (
                    <div className="col-span-2 flex items-center justify-center text-xs text-ink-subtle">
                      No previews yet
                    </div>
                  )}
                </div>
                <h2 className="font-semibold text-ink">{project.title}</h2>
                <p className="mt-0.5 line-clamp-2 text-sm text-ink-muted">
                  {project.description || 'No description'}
                </p>
                <p className="mt-auto pt-3 text-xs text-ink-subtle">
                  {project.planCount} {project.planCount === 1 ? 'plan' : 'plans'} ·{' '}
                  {new Date(project.updatedAt).toLocaleDateString()}
                </p>
              </Link>

              <div className="absolute right-2 top-2">
                <button
                  type="button"
                  aria-label="Project actions"
                  className="icon-btn h-8 w-8 opacity-0 transition group-hover:opacity-100"
                  onClick={() => setMenuFor(menuFor === project.id ? null : project.id)}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuFor === project.id ? (
                  <>
                    <button type="button" aria-hidden className="fixed inset-0 z-10 cursor-default"
                      onClick={() => setMenuFor(null)} />
                    <div className="panel absolute right-0 z-20 mt-1 w-40 p-1">
                      <Link to={`/projects/${project.id}`}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-muted hover:bg-surface-muted hover:text-ink">
                        <Pencil className="h-3.5 w-3.5" /> Open
                      </Link>
                      <button type="button"
                        onClick={() => { setMenuFor(null); setConfirmDelete({ id: project.id, title: project.title }); }}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-danger hover:bg-danger/10">
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        title="New project"
        description="Give the event a name. You can add plans once it exists."
        onClose={() => setCreating(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={!title.trim() || create.isPending}
              onClick={submitCreate}>
              {create.isPending ? 'Creating…' : 'Create project'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? <div className="notice-error">{error}</div> : null}
          <div>
            <label className="label" htmlFor="project-title">Project title</label>
            <input id="project-title" className="input" value={title} autoFocus
              placeholder="Ashcroft Wedding" onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="project-desc">Description (optional)</label>
            <textarea id="project-desc" className="input min-h-[80px] resize-y" value={description}
              placeholder="12 September, 180 guests, marquee on the south lawn"
              onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        title="Delete this project?"
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button type="button" className="btn-danger" disabled={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}>
              {remove.isPending ? 'Deleting…' : 'Delete project'}
            </button>
          </>
        }
      >
        {error ? <div className="notice-error mb-3">{error}</div> : null}
        <p className="text-sm text-ink-muted">
          <strong className="text-ink">{confirmDelete?.title}</strong> will be permanently removed.
          A project that still contains plans cannot be deleted — delete its plans first.
        </p>
      </Modal>
    </AppShell>
  );
}
