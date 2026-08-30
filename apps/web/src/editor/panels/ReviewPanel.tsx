import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  GitCompare,
  History,
  Lock,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react';
import {
  CHANGE_KIND_INFO,
  COMMENT_VISIBILITY_INFO,
  VERSION_REASON_LABELS,
  type CommentVisibility,
} from '@novira/shared';
import { useEditor } from '../editorStore';
import { capturePreview } from '../capture';
import { spatial } from '../../lib/spatialApi';
import { EmptyState, Field, Section, Segmented, Select, Tabs, TextInput, toast, Toggle } from '../../components/ui';

/**
 * Review: versions, comments and comparison.
 *
 * These three are one workflow — save a version, send it, get comments, compare
 * what changed — so they share a panel rather than being scattered across three
 * places nobody visits.
 *
 * The distinction the panel works hardest to make obvious is internal versus
 * client-visible, because getting it wrong is the failure that matters. An
 * internal note is styled differently, labelled explicitly, and never appears
 * on a share link at all — the server filters it in the query, not in the
 * response.
 */
export function ReviewPanel() {
  const [tab, setTab] = useState<'comments' | 'versions' | 'compare'>('comments');
  const planId = useEditor((s) => s.planId);

  const { data: comments } = useQuery({
    queryKey: ['plan-comments', planId],
    queryFn: () => spatial.comments.list(planId!),
    enabled: Boolean(planId),
    staleTime: 15_000,
  });

  const { data: versions } = useQuery({
    queryKey: ['plan-versions', planId],
    queryFn: () => spatial.versions.list(planId!),
    enabled: Boolean(planId),
    staleTime: 30_000,
  });

  const openComments = comments?.filter((c) => c.status === 'open').length ?? 0;

  return (
    <>
      <Section title="">
        <Tabs
          tabs={[
            { value: 'comments', label: 'Comments', count: openComments, icon: <MessageSquare className="h-3 w-3" /> },
            { value: 'versions', label: 'Versions', count: versions?.length ?? 0, icon: <History className="h-3 w-3" /> },
            { value: 'compare', label: 'Compare', icon: <GitCompare className="h-3 w-3" /> },
          ]}
          value={tab}
          onChange={setTab}
        />
      </Section>

      {tab === 'comments' ? <CommentsTab /> : null}
      {tab === 'versions' ? <VersionsTab /> : null}
      {tab === 'compare' ? <CompareTab /> : null}
    </>
  );
}

/* ── Comments ──────────────────────────────────────────────────────────── */

function CommentsTab() {
  const planId = useEditor((s) => s.planId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const objects = useEditor((s) => s.scene.objects);
  const focusObject = useEditor((s) => s.focusObject);
  const camera = useEditor((s) => s.scene.camera);

  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<CommentVisibility>('everyone');
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyBody, setReplyBody] = useState('');

  const { data: comments } = useQuery({
    queryKey: ['plan-comments', planId],
    queryFn: () => spatial.comments.list(planId!),
    enabled: Boolean(planId),
    staleTime: 15_000,
  });

  const visible = useMemo(
    () => (comments ?? []).filter((c) => (filter === 'open' ? c.status === 'open' : true)),
    [comments, filter]
  );

  const anchorObject = objects.find((o) => o.id === selectedIds[0]);

  const post = async () => {
    if (!planId || !body.trim()) return;
    try {
      await spatial.comments.create(planId, {
        body: body.trim(),
        visibility,
        anchor: {
          /*
           * Anchored to the selected object where there is one, and to the
           * camera's target otherwise — a comment with no position is a comment
           * nobody can find again from a different angle.
           */
          positionMm: anchorObject?.positionMm ?? camera.targetMm,
          objectId: anchorObject?.id ?? null,
          cameraPositionMm: camera.positionMm,
          cameraTargetMm: camera.targetMm,
        },
      });
      setBody('');
      void queryClient.invalidateQueries({ queryKey: ['plan-comments', planId] });
      toast('success', visibility === 'internal' ? 'Internal note added.' : 'Comment added.');
    } catch {
      toast('error', 'Could not post that comment.');
    }
  };

  return (
    <>
      <Section
        title="Add a comment"
        description={
          anchorObject
            ? `Pinned to “${anchorObject.name ?? anchorObject.type}” — anyone who opens it will be taken straight there.`
            : 'Select an object first to pin the comment to it. Without one it is pinned to the middle of the current view.'
        }
      >
        <Field label="Comment">
          <textarea
            className="ed-field min-h-16 resize-y"
            value={body}
            placeholder="Move the bar away from the fire exit…"
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>

        <Segmented
          label="Who sees this"
          value={visibility}
          columns={2}
          options={[
            { value: 'everyone', label: 'Client', hint: COMMENT_VISIBILITY_INFO.everyone.note },
            { value: 'internal', label: 'Internal', hint: COMMENT_VISIBILITY_INFO.internal.note },
          ]}
          onChange={setVisibility}
        />

        <button type="button" className="ed-action-primary w-full justify-center" onClick={() => void post()} disabled={!body.trim()}>
          <Send className="h-3.5 w-3.5" /> Post
        </button>
      </Section>

      <Section
        title={`Comments (${visible.length})`}
        action={
          <Segmented
            value={filter}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'all', label: 'All' },
            ]}
            onChange={setFilter}
          />
        }
      >
        {visible.length === 0 ? (
          <EmptyState
            compact
            icon={<MessageSquare className="h-5 w-5" />}
            title={filter === 'open' ? 'Nothing open' : 'No comments yet'}
            description="Share the plan with a client and they can comment directly on the 3D scene. Their comments arrive here, pinned to whatever they were looking at."
          />
        ) : (
          <div className="space-y-2">
            {visible.map((comment) => (
              <div
                key={comment.id}
                className={`rounded-lg border p-2 ${
                  comment.visibility === 'internal'
                    ? 'border-warning/40 bg-warning/5'
                    : comment.status === 'resolved'
                      ? 'border-line bg-surface-muted/20 opacity-70'
                      : 'border-line bg-surface-muted/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                      {comment.authorName}
                      {comment.authorIsClient ? <span className="badge-info">Client</span> : null}
                      {comment.visibility === 'internal' ? (
                        <span className="badge-warning">
                          <Lock className="h-2.5 w-2.5" /> Internal
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[10px] text-ink-subtle">
                      {new Date(comment.createdAt).toLocaleString()}
                      {comment.versionLabel ? ` · on “${comment.versionLabel}”` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="ed-action px-1 py-0.5"
                      aria-label={comment.status === 'open' ? 'Mark resolved' : 'Reopen'}
                      onClick={() => {
                        void spatial.comments.resolve(comment.id, comment.status === 'open').then(() => {
                          void queryClient.invalidateQueries({ queryKey: ['plan-comments', planId] });
                        });
                      }}
                    >
                      <Check className={`h-3.5 w-3.5 ${comment.status === 'resolved' ? 'text-success' : ''}`} />
                    </button>
                    <button
                      type="button"
                      className="ed-action px-1 py-0.5 text-danger"
                      aria-label="Delete"
                      onClick={() => {
                        void spatial.comments.remove(comment.id).then(() => {
                          void queryClient.invalidateQueries({ queryKey: ['plan-comments', planId] });
                        });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-ink-muted">{comment.body}</p>

                {comment.anchor.objectId ? (
                  <button
                    type="button"
                    className="ed-action mt-1 px-1.5 py-0.5 text-[10px]"
                    onClick={() => focusObject(comment.anchor.objectId!, 'properties')}
                  >
                    Show me
                  </button>
                ) : null}

                {comment.replies.length ? (
                  <div className="mt-1.5 space-y-1 border-l-2 border-line pl-2">
                    {comment.replies.map((reply) => (
                      <div key={reply.id}>
                        <p className="text-[10px] font-semibold text-ink">
                          {reply.authorName}
                          {reply.authorIsClient ? ' (client)' : ''}
                        </p>
                        <p className="text-[11px] leading-snug text-ink-muted">{reply.body}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {replyTo === comment.id ? (
                  <div className="mt-1.5 flex gap-1">
                    <TextInput
                      className="flex-1"
                      value={replyBody}
                      autoFocus
                      placeholder="Reply…"
                      onChange={(e) => setReplyBody(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setReplyTo(null);
                      }}
                    />
                    <button
                      type="button"
                      className="ed-action-primary"
                      onClick={() => {
                        if (!replyBody.trim()) return;
                        void spatial.comments.reply(comment.id, replyBody.trim()).then(() => {
                          setReplyBody('');
                          setReplyTo(null);
                          void queryClient.invalidateQueries({ queryKey: ['plan-comments', planId] });
                        });
                      }}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="ed-action mt-1 px-1.5 py-0.5 text-[10px]"
                    onClick={() => setReplyTo(comment.id)}
                  >
                    Reply
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

/* ── Versions ──────────────────────────────────────────────────────────── */

function VersionsTab() {
  const planId = useEditor((s) => s.planId);
  const scene = useEditor((s) => s.scene);
  const replaceScene = useEditor((s) => s.replaceScene);
  const readOnly = useEditor((s) => s.readOnly);

  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: versions } = useQuery({
    queryKey: ['plan-versions', planId],
    queryFn: () => spatial.versions.list(planId!),
    enabled: Boolean(planId),
    staleTime: 30_000,
  });

  const save = async (reason: 'manual' | 'milestone' = 'manual') => {
    if (!planId) return;
    setSaving(true);
    try {
      await spatial.versions.create(planId, {
        label: label.trim() || `Version ${new Date().toLocaleString()}`,
        note: note.trim() || undefined,
        reason,
        // The client's scene, not the last autosave — "save a version before I
        // try something" must capture the work as it is right now.
        scene,
        previewDataUrl: capturePreview(480) ?? undefined,
      });
      setLabel('');
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['plan-versions', planId] });
      toast('success', 'Version saved. You can come back to this exact layout at any point.');
    } catch {
      toast('error', 'Could not save the version.');
    } finally {
      setSaving(false);
    }
  };

  const restore = async (versionId: number, versionLabel: string) => {
    if (!planId) return;
    try {
      const result = await spatial.versions.restore(planId, versionId);
      replaceScene(result.scene);
      void queryClient.invalidateQueries({ queryKey: ['plan-versions', planId] });
      toast('success', `Restored “${versionLabel}”. The layout you had before this was saved first.`);
    } catch {
      toast('error', 'Could not restore that version.');
    }
  };

  return (
    <>
      <Section
        title="Save this version"
        description="A named point you can come back to. Save one before every client send and before anything experimental."
      >
        <Field label="Name it" hint="Something you would recognise in a month: “Option A — long tables”, not “v3”.">
          <TextInput value={label} placeholder="Option A — long tables" onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Note" hint="Optional. What changed, or why.">
          <TextInput value={note} placeholder="Moved the bar to the back wall" onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex gap-1">
          <button type="button" className="ed-action-primary flex-1 justify-center" onClick={() => void save('manual')} disabled={saving || readOnly}>
            <Plus className="h-3.5 w-3.5" /> Save version
          </button>
          <button
            type="button"
            className="ed-action border border-line"
            onClick={() => void save('milestone')}
            disabled={saving || readOnly}
            title="Mark this as a milestone — a version worth finding quickly later"
          >
            Milestone
          </button>
        </div>
      </Section>

      <Section title={`History (${versions?.length ?? 0})`}>
        {versions?.length ? (
          <div className="space-y-1.5">
            {versions.map((version) => (
              <div key={version.id} className="rounded-lg border border-line bg-surface-muted/40 p-2">
                <div className="flex gap-2">
                  {version.previewUrl ? (
                    <img
                      src={version.previewUrl}
                      alt=""
                      className="h-12 w-16 shrink-0 rounded border border-line object-cover"
                      loading="lazy"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold text-ink">{version.label}</p>
                    <p className="text-[10px] text-ink-subtle">
                      {version.authorName} · {new Date(version.createdAt).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-ink-subtle">
                      {version.objectCount} objects · {VERSION_REASON_LABELS[version.reason]}
                    </p>
                  </div>
                </div>
                {version.note ? <p className="mt-1 text-[11px] leading-snug text-ink-muted">{version.note}</p> : null}
                <div className="mt-1.5 flex gap-1">
                  <button
                    type="button"
                    className="ed-action border border-line px-1.5 py-0.5 text-[10px]"
                    onClick={() => void restore(version.id, version.label)}
                    disabled={readOnly}
                  >
                    <RotateCcw className="h-3 w-3" /> Restore
                  </button>
                  <button
                    type="button"
                    className="ed-action px-1.5 py-0.5 text-[10px] text-danger"
                    onClick={() => {
                      void spatial.versions.remove(planId!, version.id).then(() => {
                        void queryClient.invalidateQueries({ queryKey: ['plan-versions', planId] });
                      });
                    }}
                    disabled={readOnly}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            compact
            icon={<History className="h-5 w-5" />}
            title="No versions yet"
            description="Restoring one always saves the current layout first, so nothing is ever lost by going back."
          />
        )}
      </Section>
    </>
  );
}

/* ── Compare ───────────────────────────────────────────────────────────── */

function CompareTab() {
  const planId = useEditor((s) => s.planId);
  const focusObject = useEditor((s) => s.focusObject);
  const setHighlight = useEditor((s) => s.setHighlight);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('current');
  const [showUnchanged, setShowUnchanged] = useState(false);

  const { data: versions } = useQuery({
    queryKey: ['plan-versions', planId],
    queryFn: () => spatial.versions.list(planId!),
    enabled: Boolean(planId),
    staleTime: 30_000,
  });

  const { data: comparison, isFetching } = useQuery({
    queryKey: ['plan-compare', planId, from, to],
    queryFn: () => spatial.compare(planId!, from, to),
    enabled: Boolean(planId) && Boolean(from) && Boolean(to),
    staleTime: 10_000,
  });

  const options = useMemo(
    () => [
      { value: 'current', label: 'Current layout' },
      ...(versions ?? []).map((version) => ({ value: String(version.id), label: version.label })),
    ],
    [versions]
  );

  if (!versions?.length) {
    return (
      <Section title="Compare layouts">
        <EmptyState
          compact
          icon={<GitCompare className="h-5 w-5" />}
          title="Nothing to compare yet"
          description="Save two versions — an option A and an option B — and this shows exactly what is different between them."
        />
      </Section>
    );
  }

  return (
    <>
      <Section
        title="Compare two layouts"
        description="Matched by object, so a table that moved reads as one change rather than as one deletion and one addition."
      >
        <Field label="From">
          <Select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Choose a version…</option>
            {options
              .filter((option) => option.value !== 'current')
              .map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="To">
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      {isFetching ? (
        <Section title="">
          <p className="text-[11px] text-ink-subtle">Comparing…</p>
        </Section>
      ) : null}

      {comparison ? (
        <>
          <Section title="What changed">
            <p className="text-xs font-semibold text-ink">{comparison.summary}</p>
            <p className="mt-0.5 text-[10px] text-ink-subtle">
              {comparison.from.label} ({comparison.from.objectCount} objects) → {comparison.to.label} (
              {comparison.to.objectCount} objects) · {comparison.comparison.unchanged} unchanged
            </p>

            {comparison.comparison.settingChanges.length ? (
              <div className="mt-2 space-y-0.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Settings</p>
                {comparison.comparison.settingChanges.map((change) => (
                  <p key={change.label} className="text-[11px] text-ink-muted">
                    {change.label}: <span className="text-ink-subtle line-through">{change.from}</span> →{' '}
                    <span className="font-semibold text-ink">{change.to}</span>
                  </p>
                ))}
              </div>
            ) : null}

            <div className="mt-2">
              <Toggle label="Show unchanged count" checked={showUnchanged} onChange={setShowUnchanged} />
            </div>
          </Section>

          <Section title={`Differences (${comparison.comparison.changes.length})`}>
            {comparison.comparison.changes.length === 0 ? (
              <p className="text-[11px] text-ink-subtle">
                These two are identical{showUnchanged ? ` — all ${comparison.comparison.unchanged} objects match.` : '.'}
              </p>
            ) : (
              <div className="space-y-1">
                {comparison.comparison.changes.map((change) => {
                  const info = CHANGE_KIND_INFO[change.kind];
                  return (
                    <button
                      key={`${change.objectId}-${change.kind}`}
                      type="button"
                      className="flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition hover:border-line hover:bg-surface-muted/50"
                      onClick={() => {
                        setHighlight([change.objectId]);
                        if (change.kind !== 'removed') focusObject(change.objectId, 'properties');
                      }}
                    >
                      <span
                        className={`mt-0.5 shrink-0 rounded px-1 text-[9px] font-bold uppercase ${
                          info.tone === 'success'
                            ? 'bg-success/15 text-success'
                            : info.tone === 'danger'
                              ? 'bg-danger/15 text-danger'
                              : info.tone === 'warning'
                                ? 'bg-warning/15 text-warning'
                                : 'bg-surface-muted text-ink-muted'
                        }`}
                      >
                        {info.label}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium text-ink">{change.name}</span>
                        <span className="block text-[10px] leading-snug text-ink-subtle">{change.detail}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </Section>
        </>
      ) : null}
    </>
  );
}
