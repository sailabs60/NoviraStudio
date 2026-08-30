import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, Plus, Trash2, Users } from 'lucide-react';
import { api, ApiClientError } from '../lib/api';
import { AppShell } from '../components/AppShell';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';
import { Figure } from '../landing/pieces';

export function ProjectPage() {
  const { projectId } = useParams();
  const id = Number(projectId);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: project } = useQuery({ queryKey: ['project', id], queryFn: () => api.projects.get(id) });
  const { data: plans, isLoading } = useQuery({
    queryKey: ['plans', id],
    queryFn: () => api.plans.listByProject(id),
  });

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [editorType, setEditorType] = useState<'3d' | '2d'>('3d');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; title: string } | null>(null);

  const create = useMutation({
    mutationFn: () => api.plans.create(id, title.trim(), editorType),
    onSuccess: (plan) => navigate(`/editor/${plan.id}`),
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Could not create the plan.'),
  });

  const remove = useMutation({
    mutationFn: (planId: number) => api.plans.remove(planId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['plans', id] });
      void qc.invalidateQueries({ queryKey: ['project', id] });
      setConfirmDelete(null);
    },
  });

  return (
    <AppShell>
      <Link to="/dashboard" className="btn-ghost btn-sm mb-4 -ml-2">
        <ArrowLeft className="h-3.5 w-3.5" /> All projects
      </Link>

      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{project?.title ?? 'Project'}</h1>
          {project?.description ? <p className="mt-1 text-sm text-ink-muted">{project.description}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/projects/${projectId}/guests`} className="btn-secondary">
            <Users className="h-4 w-4" /> Guests
          </Link>
          <Link to={`/projects/${projectId}/proposals`} className="btn-secondary">
            <FileText className="h-4 w-4" /> Proposals
          </Link>
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New plan
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-24"><Spinner label="Loading plans…" /></div>
      ) : !plans?.length ? (
        /*
         * The same shape as the empty dashboard, for the same reason: three
         * centred lines in a bordered box reads as a page that failed to load,
         * where a picture and one obvious action reads as the beginning of
         * something. The layout is designed to look finished without the
         * photograph — see IMAGE_PROMPTS.md.
         */
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
          <div className="grid items-center gap-0 md:grid-cols-2">
            <div className="px-6 py-10 sm:px-10">
              <p className="text-xl font-black tracking-tight text-ink">One plan, one space</p>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
                A plan is one editable layout — a marquee interior, a ceremony lawn, a ballroom. Draw the room, lay it
                out to scale, and everything else in Novira reads from it: the seating chart, the take-off, the checks
                and the client's pack.
              </p>
              <button type="button" className="btn-primary mt-5" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> Create your first plan
              </button>
            </div>
            <Figure
              dir="app"
              slot="empty-plans"
              alt="An empty hall with a marked-out floor, ready to be laid out"
              ratio="16 / 10"
              rounded="rounded-none"
              className="hidden border-0 border-l md:block"
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <div key={plan.id} className="card-hover group relative">
              <Link to={`/editor/${plan.id}`} className="block">
                <div className="mb-3 flex h-36 items-center justify-center overflow-hidden rounded-lg bg-canvas">
                  {plan.previewUrl ? (
                    <img src={plan.previewUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs text-ink-subtle">Not yet rendered</span>
                  )}
                </div>
                <h2 className="font-semibold text-ink">{plan.title}</h2>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {plan.editorType.toUpperCase()} · {plan.objectCount} objects ·{' '}
                  {new Date(plan.updatedAt).toLocaleDateString()}
                </p>
              </Link>
              <button type="button" aria-label="Delete plan"
                onClick={() => setConfirmDelete({ id: plan.id, title: plan.title })}
                className="icon-btn absolute right-2 top-2 h-8 w-8 opacity-0 transition group-hover:opacity-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal open={creating} title="New plan" onClose={() => setCreating(false)}
        description="Plans open straight into the editor."
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={!title.trim() || create.isPending}
              onClick={() => create.mutate()}>
              {create.isPending ? 'Creating…' : 'Create and open'}
            </button>
          </>
        }>
        <div className="space-y-4">
          {error ? <div className="notice-error">{error}</div> : null}
          <div>
            <label className="label" htmlFor="plan-title">Plan title</label>
            <input id="plan-title" className="input" value={title} autoFocus
              placeholder="Main marquee layout" onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <span className="label">Sketch type</span>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface-muted/40 p-1">
              {([['3d', '3D layout'], ['2d', 'Top-down plan']] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setEditorType(value)}
                  className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                    editorType === value ? 'bg-primary text-primary-fg shadow-sm' : 'text-ink-muted hover:text-ink'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-subtle">
              {editorType === '3d'
                ? 'Full 3D editing with perspective review and photoreal rendering.'
                : 'Opens looking straight down — best for accurate placement and spacing.'}
            </p>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(confirmDelete)} title="Delete this plan?" onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button type="button" className="btn-danger" disabled={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}>
              {remove.isPending ? 'Deleting…' : 'Delete plan'}
            </button>
          </>
        }>
        <p className="text-sm text-ink-muted">
          <strong className="text-ink">{confirmDelete?.title}</strong> and everything in it will be
          permanently removed. This cannot be undone.
        </p>
      </Modal>
    </AppShell>
  );
}
