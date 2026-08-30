import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, MessageSquare, Send, X } from 'lucide-react';
import type { SceneDocument, UnitSystem } from '@novira/shared';
import { http, ApiClientError, api } from '../lib/api';
import { spatial } from '../lib/spatialApi';
import { useEditor } from '../editor/editorStore';
import { Viewport } from '../editor/Viewport';
import { ViewStrip } from '../editor/SavedViews';
import { Spinner } from '../components/Spinner';
import { NoviraMark } from '../components/AuthShell';
import { LogoMark } from '../components/Logo';
import { EmptyState, Field, TextInput, ToastHost, toast } from '../components/ui';

interface SharedPlan {
  title: string;
  units: UnitSystem;
  scene: SceneDocument;
  mode: 'view' | 'embed';
  companyName: string | null;
  companyLogoUrl: string | null;
}

const NAME_KEY = 'novira.commenterName';

/**
 * Public, read-only plan viewer — and the client's half of the review loop.
 *
 * Reuses the editor's viewport, loaded with `readOnly` so every mutating path in
 * the store is inert; the guard lives in the store rather than in this
 * component, so a viewer cannot edit even if they reach a control.
 *
 * Commenting is the reason this page matters. A client with the link can pin a
 * comment to whatever they are looking at, without an account, and it arrives
 * in the planner's Review panel anchored to that spot. That is what replaces a
 * thread of screenshots with arrows drawn on them.
 *
 * Internal notes never reach here — they are excluded in the query on the
 * server rather than filtered out of the response.
 */
export function SharePage() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const embedded = params.get('embed') === '1';

  const load = useEditor((s) => s.load);
  const cacheItems = useEditor((s) => s.cacheItems);
  const objects = useEditor((s) => s.scene.objects);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['share', token],
    queryFn: async () => (await http.get<SharedPlan>(`/share/${token}`)).data,
    enabled: Boolean(token),
    retry: false,
  });

  useEffect(() => {
    if (!data) return;
    load({ id: -1, title: data.title, units: data.units, scene: data.scene, readOnly: true });
  }, [data, load]);

  useEffect(() => {
    const ids = [
      ...new Set(
        objects
          .filter((o): o is Extract<typeof o, { type: 'catalog' }> => o.type === 'catalog')
          .map((o) => o.catalogItemId)
      ),
    ];
    if (!ids.length) return;
    void api.catalog.byIds(ids).then(cacheItems);
  }, [objects, cacheItems]);

  if (isLoading) {
    /*
     * A cover rather than a spinner on a white field.
     *
     * A client opening a share link on a phone waits several seconds while a
     * plan's models come down, and what they look at during that wait is the
     * first impression of the design they were sent. A photograph of a finished
     * room says "something considered is coming"; a lone spinner says the link
     * might be broken.
     */
    return (
      <div className="relative flex h-full items-center justify-center overflow-hidden bg-bg">
        <img
          src="/app/share-cover.jpg"
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
        <span aria-hidden className="absolute inset-0 bg-bg/78 backdrop-blur-[2px]" />
        <div className="relative flex flex-col items-center gap-3 text-center">
          <LogoMark size={40} />
          <Spinner label="Loading plan…" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    const message = error instanceof ApiClientError ? error.message : 'This plan could not be loaded.';
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-bg px-6 text-center">
        <NoviraMark className="mb-2 h-8 w-8 text-ink-subtle" />
        <h1 className="text-lg font-semibold text-ink">Plan unavailable</h1>
        <p className="max-w-sm text-sm text-ink-muted">{message}</p>
        <p className="text-xs text-ink-subtle">Ask whoever sent it for a fresh link.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      {!embedded ? (
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface-strong px-4">
          {data.companyLogoUrl ? (
            <img src={data.companyLogoUrl} alt={data.companyName ?? ''} className="h-6 w-auto" />
          ) : (
            <LogoMark size={22} />
          )}
          <h1 className="truncate text-sm font-semibold text-ink">{data.title}</h1>
          <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink-muted">
            View only
          </span>

          <button
            type="button"
            onClick={() => setCommentsOpen((o) => !o)}
            className={`ml-auto btn-secondary btn-sm ${commentsOpen ? 'border-primary text-primary' : ''}`}
          >
            <MessageSquare className="h-3.5 w-3.5" /> Comments
          </button>

          {data.companyName ? <span className="text-xs text-ink-subtle">{data.companyName}</span> : null}
        </header>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1">
          <Viewport />
        </div>
        {commentsOpen && token ? <CommentSidebar token={token} onClose={() => setCommentsOpen(false)} /> : null}
      </div>

      {/*
        The designer's saved viewpoints, as a closable strip.
        
        A client opening this link has never orbited a 3D scene. Asked to, they
        drag once, end up under the floor, and close the tab. Named viewpoints
        remove the problem: the designer stands where the design reads best and
        the client presses a button.
      */}
      <ViewStrip />

      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-line bg-surface-strong px-4 text-[11px] text-ink-subtle">
        <span>{objects.length} objects</span>
        <span className="capitalize">{data.units}</span>
      </footer>

      <ToastHost />
    </div>
  );
}

/**
 * The client's comment panel.
 *
 * The name is asked for once and remembered on the device, because asking for
 * it on every comment is the friction that stops the second one being written.
 * A comment is anchored to whatever is selected, or to the middle of the
 * current view if nothing is — so it always means something when reopened from
 * a different angle.
 */
function CommentSidebar({ token, onClose }: { token: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const selectedIds = useEditor((s) => s.selectedIds);
  const objects = useEditor((s) => s.scene.objects);
  const camera = useEditor((s) => s.scene.camera);
  const select = useEditor((s) => s.select);

  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);

  const { data: comments } = useQuery({
    queryKey: ['share-comments', token],
    queryFn: () => spatial.comments.listPublic(token),
    refetchInterval: 30_000,
  });

  const anchorObject = objects.find((o) => o.id === selectedIds[0]);

  const rememberName = (value: string) => {
    setName(value);
    try {
      localStorage.setItem(NAME_KEY, value);
    } catch {
      /* private browsing — the name simply will not persist */
    }
  };

  const post = async () => {
    if (!body.trim() || !name.trim()) return;
    setSending(true);
    try {
      await spatial.comments.createPublic(token, {
        body: body.trim(),
        authorName: name.trim(),
        anchor: {
          positionMm: anchorObject?.positionMm ?? camera.targetMm,
          objectId: anchorObject?.id ?? null,
          cameraPositionMm: camera.positionMm,
          cameraTargetMm: camera.targetMm,
        },
      });
      setBody('');
      void queryClient.invalidateQueries({ queryKey: ['share-comments', token] });
      toast('success', 'Comment sent. The planner sees it pinned to this spot.');
    } catch {
      toast('error', 'Could not send that comment.');
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-line bg-surface-strong" aria-label="Comments">
      <header className="flex items-start justify-between gap-2 border-b border-line px-3 py-2.5">
        <div>
          <h2 className="text-sm font-bold text-ink">Comments</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-ink-subtle">
            Click something in the plan first, and your comment is pinned to it.
          </p>
        </div>
        <button type="button" onClick={onClose} className="icon-btn h-7 w-7 shrink-0" aria-label="Close comments">
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="border-b border-line px-3 py-3">
        <Field label="Your name" hint="Remembered on this device so you only type it once.">
          <TextInput value={name} placeholder="Who you are" onChange={(e) => rememberName(e.target.value)} />
        </Field>

        <Field
          label="Comment"
          hint={
            anchorObject
              ? `Pinned to “${anchorObject.name ?? anchorObject.type}”.`
              : 'Nothing selected — this will be pinned to the middle of your current view.'
          }
        >
          <textarea
            className="ed-field min-h-16 resize-y"
            value={body}
            placeholder="Can the bar move away from the door?"
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>

        <button
          type="button"
          className="ed-action-primary w-full justify-center"
          onClick={() => void post()}
          disabled={sending || !body.trim() || !name.trim()}
        >
          <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {comments?.length ? (
          <div className="space-y-2">
            {comments.map((comment) => (
              <div
                key={comment.id}
                className={`rounded-lg border p-2 ${
                  comment.status === 'resolved' ? 'border-line bg-surface-muted/20 opacity-70' : 'border-line bg-surface-muted/40'
                }`}
              >
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                  {comment.authorName}
                  {!comment.authorIsClient ? <span className="badge-info">Planner</span> : null}
                  {comment.status === 'resolved' ? <span className="badge-success">Resolved</span> : null}
                </p>
                <p className="text-[10px] text-ink-subtle">{new Date(comment.createdAt).toLocaleString()}</p>
                <p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-ink-muted">{comment.body}</p>

                {comment.anchor.objectId ? (
                  <button
                    type="button"
                    className="ed-action mt-1 px-1.5 py-0.5 text-[10px]"
                    onClick={() => select([comment.anchor.objectId!])}
                  >
                    <MapPin className="h-3 w-3" /> Show me
                  </button>
                ) : null}

                {comment.replies.length ? (
                  <div className="mt-1.5 space-y-1 border-l-2 border-line pl-2">
                    {comment.replies.map((reply) => (
                      <div key={reply.id}>
                        <p className="text-[10px] font-semibold text-ink">
                          {reply.authorName}
                          {!reply.authorIsClient ? ' (planner)' : ''}
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
                        if (!replyBody.trim() || !name.trim()) return;
                        void spatial.comments
                          .replyPublic(token, comment.id, { body: replyBody.trim(), authorName: name.trim() })
                          .then(() => {
                            setReplyBody('');
                            setReplyTo(null);
                            void queryClient.invalidateQueries({ queryKey: ['share-comments', token] });
                          });
                      }}
                      aria-label="Send reply"
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
        ) : (
          <EmptyState
            compact
            icon={<MessageSquare className="h-5 w-5" />}
            title="No comments yet"
            description="Anything you write here goes straight to the planner, pinned to the part of the room you were looking at."
          />
        )}
      </div>
    </aside>
  );
}
