import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, FolderOpen, Globe, Layers, Trash2, User } from 'lucide-react';
import { migrateScene } from '@novira/shared';
import { http, ApiClientError } from '../lib/api';
import { useEditor } from './editorStore';
import { useSelectedObjects } from './selectors';
import { Modal } from '../components/Modal';
import { capturePreview } from './capture';

interface TemplateRow {
  id: number;
  scope: 'local' | 'global';
  title: string;
  description: string | null;
  previewUrl: string | null;
  createdAt: string;
}

/**
 * Templates and collections.
 *
 * Loading a template is destructive — it replaces the scene — so it always goes
 * through a confirmation. Saving a collection is additive and does not, but it
 * does require a selection, since a collection of nothing is not useful.
 */
export function TemplatesMenu() {
  const [open, setOpen] = useState<null | 'menu' | 'save-template' | 'load-template' | 'save-collection'>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingLoad, setPendingLoad] = useState<TemplateRow | null>(null);

  const planId = useEditor((s) => s.planId);
  const readOnly = useEditor((s) => s.readOnly);
  const replaceScene = useEditor((s) => s.replaceScene);
  const selected = useSelectedObjects();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'local' | 'global'>('local');
  const [collectionName, setCollectionName] = useState('');

  const { data: templates } = useQuery({
    queryKey: ['templates'],
    queryFn: async () => (await http.get<{ items: TemplateRow[] }>('/templates')).data.items,
    enabled: open === 'load-template',
  });

  const saveTemplate = useMutation({
    mutationFn: async (overwrite: boolean) =>
      (
        await http.post('/templates', {
          planId,
          title: title.trim(),
          description: description.trim() || undefined,
          scope,
          overwrite,
          previewDataUrl: capturePreview() ?? undefined,
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['templates'] });
      setOpen(null);
      setTitle('');
      setDescription('');
      setError(null);
    },
    onError: (err) => {
      if (err instanceof ApiClientError && err.code === 'TEMPLATE_TITLE_EXISTS') {
        setError('A template with that name already exists. Save again to overwrite it.');
        return;
      }
      setError(err instanceof ApiClientError ? err.message : 'Could not save the template.');
    },
  });

  const applyTemplate = useMutation({
    mutationFn: async (template: TemplateRow) =>
      (await http.post<{ scene: unknown }>(`/templates/${template.id}/apply`, { planId })).data,
    onSuccess: (data) => {
      replaceScene(migrateScene(data.scene));
      setPendingLoad(null);
      setOpen(null);
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : 'Could not load that template.'),
  });

  const removeTemplate = useMutation({
    mutationFn: async (id: number) => (await http.delete(`/templates/${id}`)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['templates'] }),
  });

  const saveCollection = useMutation({
    mutationFn: async () =>
      (
        await http.post('/collections', {
          name: collectionName.trim(),
          objects: selected,
          summary: selected
            .map((o) => o.name ?? o.type)
            .slice(0, 3)
            .join(', '),
          sourcePlanId: planId ?? undefined,
          previewDataUrl: capturePreview() ?? undefined,
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['collections'] });
      setOpen(null);
      setCollectionName('');
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : 'Could not save the collection.'),
  });

  // Same reasoning as the export menu: an overlay-backed dropdown must be
  // dismissible with the keyboard, or it blocks the next click.
  useEffect(() => {
    if (open !== 'menu') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <div className="relative">
        <button type="button" className="ed-action" onClick={() => setOpen(open === 'menu' ? null : 'menu')}>
          <Layers className="h-3.5 w-3.5" /> Templates
        </button>
        {open === 'menu' ? (
          <>
            <button type="button" aria-hidden className="fixed inset-0 z-10 cursor-default"
              onClick={() => setOpen(null)} />
            <div className="panel absolute left-0 top-9 z-20 w-60 p-1">
              <MenuItem icon={<BookmarkPlus className="h-4 w-4" />} label="Save as template"
                hint="Reuse this whole plan later" disabled={readOnly}
                onClick={() => { setError(null); setOpen('save-template'); }} />
              <MenuItem icon={<FolderOpen className="h-4 w-4" />} label="Load template"
                hint="Replaces the current scene" disabled={readOnly}
                onClick={() => { setError(null); setOpen('load-template'); }} />
              <div className="my-1 h-px bg-line" />
              <MenuItem icon={<Layers className="h-4 w-4" />} label="Save as collection"
                hint={selected.length ? `${selected.length} selected` : 'Select objects first'}
                disabled={readOnly || !selected.length}
                onClick={() => { setError(null); setOpen('save-collection'); }} />
            </div>
          </>
        ) : null}
      </div>

      {/* Save template */}
      <Modal open={open === 'save-template'} title="Save as template"
        description="Stores the whole plan — objects, walls, lighting and camera."
        onClose={() => setOpen(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(null)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={title.trim().length < 3 || saveTemplate.isPending}
              onClick={() => saveTemplate.mutate(Boolean(error))}>
              {saveTemplate.isPending ? 'Saving…' : error ? 'Overwrite' : 'Save template'}
            </button>
          </>
        }>
        <div className="space-y-3">
          {error ? <div className="notice-warning">{error}</div> : null}
          <div>
            <label className="label" htmlFor="tpl-title">Template name</label>
            <input id="tpl-title" className="input" value={title} autoFocus
              onChange={(e) => { setTitle(e.target.value); setError(null); }} />
            {title.trim().length > 0 && title.trim().length < 3 ? (
              <p className="field-error">Title must be at least 3 characters.</p>
            ) : null}
          </div>
          <div>
            <label className="label" htmlFor="tpl-desc">What is it for? (optional)</label>
            <textarea id="tpl-desc" className="input min-h-[70px] resize-y" value={description}
              onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <span className="label">Visibility</span>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface-muted/40 p-1">
              {([['local', 'Private', User], ['global', 'Everyone', Globe]] as const).map(([value, label, Icon]) => (
                <button key={value} type="button" onClick={() => setScope(value)}
                  className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition ${
                    scope === value ? 'bg-primary text-primary-fg' : 'text-ink-muted hover:text-ink'
                  }`}>
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-subtle">
              {scope === 'local'
                ? 'Only you can see and use this template.'
                : 'Available to every user. Administrators only.'}
            </p>
          </div>
        </div>
      </Modal>

      {/* Load template */}
      <Modal open={open === 'load-template'} title="Load a template"
        description="Loading replaces everything currently in this plan."
        onClose={() => setOpen(null)} width="max-w-2xl"
        footer={<button type="button" className="btn-secondary" onClick={() => setOpen(null)}>Cancel</button>}>
        {error ? <div className="notice-error mb-3">{error}</div> : null}
        {!templates?.length ? (
          <p className="py-10 text-center text-sm text-ink-subtle">
            No templates yet. Save a plan as a template to reuse it.
          </p>
        ) : (
          <ul className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {templates.map((template) => (
              <li key={template.id} className="relative">
                <button type="button" onClick={() => setPendingLoad(template)}
                  className="w-full rounded-lg border border-line p-2 text-left transition hover:border-primary/60 hover:bg-primary/5">
                  <span className="mb-1.5 flex h-20 items-center justify-center overflow-hidden rounded bg-surface-muted/60">
                    {template.previewUrl ? (
                      <img src={template.previewUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[10px] text-ink-subtle">No preview</span>
                    )}
                  </span>
                  <span className="block truncate text-xs font-medium text-ink">{template.title}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-subtle">
                    {template.scope === 'global' ? <Globe className="h-2.5 w-2.5" /> : <User className="h-2.5 w-2.5" />}
                    {template.scope === 'global' ? 'Everyone' : 'Private'}
                  </span>
                </button>
                {template.scope === 'local' ? (
                  <button type="button" aria-label="Delete template"
                    onClick={() => removeTemplate.mutate(template.id)}
                    className="icon-btn absolute right-1 top-1 h-6 w-6">
                    <Trash2 className="h-3 w-3" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* Confirm destructive load */}
      <Modal open={Boolean(pendingLoad)} title="Replace this plan?" onClose={() => setPendingLoad(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setPendingLoad(null)}>Cancel</button>
            <button type="button" className="btn-danger" disabled={applyTemplate.isPending}
              onClick={() => pendingLoad && applyTemplate.mutate(pendingLoad)}>
              {applyTemplate.isPending ? 'Loading…' : 'Replace scene'}
            </button>
          </>
        }>
        <p className="text-sm text-ink-muted">
          Loading <strong className="text-ink">{pendingLoad?.title}</strong> removes everything currently
          in this plan and replaces it with the template. You can undo it afterwards.
        </p>
      </Modal>

      {/* Save collection */}
      <Modal open={open === 'save-collection'} title="Save as collection"
        description="Keeps the relative placement of the selected objects so the group can be reused."
        onClose={() => setOpen(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(null)}>Cancel</button>
            <button type="button" className="btn-primary"
              disabled={!collectionName.trim() || saveCollection.isPending}
              onClick={() => saveCollection.mutate()}>
              {saveCollection.isPending ? 'Saving…' : 'Save collection'}
            </button>
          </>
        }>
        <div className="space-y-3">
          {error ? <div className="notice-error">{error}</div> : null}
          <p className="text-sm text-ink-muted">
            {selected.length} object{selected.length === 1 ? '' : 's'} selected.
          </p>
          <div>
            <label className="label" htmlFor="col-name">Collection name</label>
            <input id="col-name" className="input" value={collectionName} autoFocus
              placeholder="Lounge set" onChange={(e) => setCollectionName(e.target.value)} />
          </div>
        </div>
      </Modal>
    </>
  );
}

function MenuItem({
  icon, label, hint, onClick, disabled,
}: { icon: React.ReactNode; label: string; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm text-ink-muted transition hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>
        <span className="block font-medium text-ink">{label}</span>
        <span className="block text-[11px] text-ink-subtle">{hint}</span>
      </span>
    </button>
  );
}
