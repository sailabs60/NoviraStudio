import { useEffect, useState } from 'react';
import { Check, Code2, Copy, Download, FileText, Image, Link2, Share2 } from 'lucide-react';
import { http, ApiClientError } from '../lib/api';
import { useEditor } from './editorStore';
import { Modal } from '../components/Modal';
import { captureViewport } from './capture';
import { exportPlanPdf } from './exportPdf';
import { useSession } from '../store/session';

/**
 * Share and export.
 *
 * Both actions need the plan saved first: a share link points at server state,
 * and a PDF is generated from it, so exporting an unsaved plan would hand the
 * client something that does not match what is on screen.
 */
export function ShareMenu({ onRequestSave }: { onRequestSave: () => Promise<void> }) {
  const planId = useEditor((s) => s.planId);
  const title = useEditor((s) => s.title);
  const readOnly = useEditor((s) => s.readOnly);
  const dirty = useEditor((s) => s.dirty);
  const scene = useEditor((s) => s.scene);
  const units = useEditor((s) => s.units);
  const itemCache = useEditor((s) => s.itemCache);
  const companyName = useSession((s) => s.user?.company?.name ?? null);
  const [exportOpen, setExportOpen] = useState(false);

  const [open, setOpen] = useState<null | 'share' | 'embed'>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [embedWidth, setEmbedWidth] = useState('100%');
  const [embedHeight, setEmbedHeight] = useState('600px');

  async function makeLink(mode: 'view' | 'embed') {
    if (!planId) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      if (dirty) await onRequestSave();
      const { data } = await http.post<{ url: string }>(`/plans/${planId}/share`, { mode });
      setLink(data.url);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not create a share link.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy automatically — select the text and copy it manually.');
    }
  }

  function exportPng() {
    const dataUrl = captureViewport();
    if (!dataUrl) {
      setError('No canvas image available. Make sure the plan has finished rendering.');
      return;
    }
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${title.replace(/[^\w -]+/g, '').trim() || 'plan'}.png`;
    a.click();
    setExportOpen(false);
  }

  function exportPdf() {
    const names: Record<number, string> = {};
    for (const [id, item] of Object.entries(itemCache)) names[Number(id)] = item.name;
    const ok = exportPlanPdf({ title, units, scene, itemNames: names, companyName });
    if (!ok) setError('No canvas image available. Make sure the plan has finished rendering.');
    else setExportOpen(false);
  }

  // A dropdown that only closes on an outside click leaves a full-screen
  // overlay swallowing the next thing the user tries to do. Escape closes it.
  useEffect(() => {
    if (!exportOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exportOpen]);

  const iframe = link
    ? `<iframe src="${link}?embed=1" width="${embedWidth}" height="${embedHeight}" style="border:0" allowfullscreen loading="lazy" title="${title}"></iframe>`
    : '';

  return (
    <>
      <div className="relative flex items-center gap-1">
        <button type="button" className="ed-action" onClick={() => setExportOpen((o) => !o)}
          title="Export the plan">
          <Download className="h-3.5 w-3.5" /> Export
        </button>
        {exportOpen ? (
          <>
            <button type="button" aria-hidden className="fixed inset-0 z-10 cursor-default"
              onClick={() => setExportOpen(false)} />
            <div className="panel absolute right-0 top-9 z-20 w-56 p-1">
              <button type="button" onClick={exportPdf}
                className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm text-ink-muted hover:bg-surface-muted hover:text-ink">
                <FileText className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="block font-medium text-ink">PDF</span>
                  <span className="block text-[11px] text-ink-subtle">View, schedule and parts list</span>
                </span>
              </button>
              <button type="button" onClick={exportPng}
                className="flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm text-ink-muted hover:bg-surface-muted hover:text-ink">
                <Image className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="block font-medium text-ink">PNG</span>
                  <span className="block text-[11px] text-ink-subtle">Image of the current view</span>
                </span>
              </button>
            </div>
          </>
        ) : null}
        <button
          type="button"
          className="ed-action"
          disabled={readOnly}
          onClick={() => {
            setLink(null);
            setOpen('share');
            void makeLink('view');
          }}
        >
          <Share2 className="h-3.5 w-3.5" /> Share
        </button>
      </div>

      <Modal
        open={open !== null}
        title={open === 'embed' ? 'Embed this plan' : 'Share this plan'}
        description={
          open === 'embed'
            ? 'Paste the code into your own site. Embedded plans are view-only.'
            : 'Anyone with the link can view this plan. They cannot edit it.'
        }
        onClose={() => setOpen(null)}
        width="max-w-lg"
        footer={
          <>
            {open === 'share' ? (
              <button
                type="button"
                className="btn-secondary mr-auto"
                onClick={() => {
                  setOpen('embed');
                  void makeLink('embed');
                }}
              >
                <Code2 className="h-4 w-4" /> Embed instead
              </button>
            ) : (
              <button type="button" className="btn-secondary mr-auto" onClick={() => setOpen('share')}>
                <Link2 className="h-4 w-4" /> Back to link
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={() => setOpen(null)}>
              Done
            </button>
          </>
        }
      >
        {error ? <div className="notice-error mb-3">{error}</div> : null}

        {busy ? (
          <p className="py-6 text-center text-sm text-ink-muted">Creating a viewer link…</p>
        ) : !link ? (
          <p className="py-6 text-center text-sm text-ink-subtle">No link yet.</p>
        ) : open === 'share' ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input readOnly className="input font-mono text-xs" value={link} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn-primary shrink-0" onClick={() => void copy(link)}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-ink-subtle">
              The link uses an unguessable token, so it cannot be found by trying plan numbers. Revoke it
              any time from the plan.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="ew">Width</label>
                <input id="ew" className="input" value={embedWidth} onChange={(e) => setEmbedWidth(e.target.value)} />
                <p className="mt-1 text-[11px] text-ink-subtle">Use 100% or a pixel width.</p>
              </div>
              <div>
                <label className="label" htmlFor="eh">Height</label>
                <input id="eh" className="input" value={embedHeight} onChange={(e) => setEmbedHeight(e.target.value)} />
                <p className="mt-1 text-[11px] text-ink-subtle">Use a pixel height.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <textarea readOnly className="input h-24 resize-none font-mono text-[11px]" value={iframe}
                onFocus={(e) => e.target.select()} />
              <button type="button" className="btn-primary shrink-0 self-start" onClick={() => void copy(iframe)}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
