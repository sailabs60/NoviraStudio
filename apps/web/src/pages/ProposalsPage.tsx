import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  Copy,
  FileText,
  Link2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  formatMoney,
  formatQuantity,
  formatRate,
  lineAmount,
  parseQuantity,
} from '@novira/shared';
import { http, ApiClientError } from '../lib/api';
import { AppShell } from '../components/AppShell';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';

/**
 * Proposals.
 *
 * The reason this lives inside the design tool rather than in a spreadsheet is
 * "Build from layout": the quote is generated from what is actually in the
 * plan, priced against the planner's own stock. A quote and a design that
 * disagree is the normal failure mode of doing these in separate places.
 *
 * Regenerating replaces only the lines that came from the layout. Labour, fees
 * and hand-written items survive, because those are the parts a planner has
 * thought about and would be furious to lose.
 */

interface Line {
  id: number;
  kind: 'item' | 'labour' | 'fee' | 'discount';
  description: string;
  quantityMilli: number;
  unitLabel: string | null;
  unitPrice: number;
  taxable: boolean;
  sortOrder: number;
  catalogItemId: number | null;
}

interface Totals {
  subtotal: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
  deposit: number;
  balance: number;
  taxableNet: number;
}

interface Proposal {
  id: number;
  planId: number | null;
  number: string;
  title: string;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
  clientName: string | null;
  clientEmail: string | null;
  eventDate: string | null;
  currency: string;
  taxRateBp: number;
  discountBp: number;
  depositBp: number;
  notes: string | null;
  terms: string | null;
  validUntil: string | null;
  shareToken: string | null;
  lines: Line[];
  totals: Totals;
}

interface Plan {
  id: number;
  title: string;
}

const STATUS_TONES: Record<Proposal['status'], string> = {
  draft: 'bg-surface-muted text-ink-muted',
  sent: 'bg-sky-500/15 text-sky-300',
  accepted: 'bg-emerald-500/15 text-emerald-300',
  declined: 'bg-rose-500/15 text-rose-300',
  expired: 'bg-amber-500/15 text-amber-300',
};

export function ProposalsPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('Event proposal');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const list = useQuery({
    queryKey: ['proposals', projectId],
    queryFn: async () =>
      (await http.get<{ items: Proposal[] }>(`/projects/${projectId}/proposals`)).data.items,
  });

  const plans = useQuery({
    queryKey: ['plans', projectId],
    queryFn: async () =>
      (await http.get<{ items: Plan[] }>(`/plans?project_id=${projectId}`)).data.items,
  });

  const selected = useMemo(
    () => list.data?.find((p) => p.id === selectedId) ?? list.data?.[0] ?? null,
    [list.data, selectedId]
  );

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['proposals', projectId] });

  const create = useMutation({
    mutationFn: async () =>
      (await http.post<Proposal>(`/projects/${projectId}/proposals`, {
        title,
        planId: plans.data?.[0]?.id ?? null,
        currency: 'usd',
        taxRateBp: 2000,
      })).data,
    onSuccess: (p) => {
      invalidate();
      setSelectedId(p.id);
      setCreateOpen(false);
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : 'Could not create the proposal.'),
  });

  const update = useMutation({
    mutationFn: async (patch: Partial<Proposal>) =>
      (await http.patch(`/proposals/${selected!.id}`, patch)).data,
    onSuccess: invalidate,
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : 'Could not save.'),
  });

  const generate = useMutation({
    mutationFn: async () =>
      (await http.post<{ generated: number; unpriced: number }>(
        `/proposals/${selected!.id}/generate-from-plan`,
        {}
      )).data,
    onSuccess: (r) => {
      invalidate();
      setError(
        r.unpriced
          ? `${r.generated} lines built. ${r.unpriced} have no price — link them to stock on the Suppliers page.`
          : null
      );
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : 'Could not build from the layout.'),
  });

  const addLine = useMutation({
    mutationFn: async (kind: Line['kind']) =>
      (await http.post(`/proposals/${selected!.id}/lines`, {
        kind,
        description: kind === 'labour' ? 'Crew' : kind === 'fee' ? 'Delivery' : 'New line',
        quantityMilli: 1000,
        unitLabel: kind === 'labour' ? 'days' : 'ea',
        unitPrice: 0,
      })).data,
    onSuccess: invalidate,
  });

  const updateLine = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<Line> }) =>
      (await http.patch(`/proposal-lines/${id}`, patch)).data,
    onSuccess: invalidate,
  });

  const removeLine = useMutation({
    mutationFn: async (id: number) => (await http.delete(`/proposal-lines/${id}`)).data,
    onSuccess: invalidate,
  });

  const share = useMutation({
    mutationFn: async () =>
      (await http.post<{ token: string }>(`/proposals/${selected!.id}/share`)).data,
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: number) => (await http.delete(`/proposals/${id}`)).data,
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
    },
  });

  if (list.isLoading) {
    return <AppShell><div className="py-24"><Spinner label="Loading proposals…" /></div></AppShell>;
  }

  const shareUrl = selected?.shareToken
    ? `${window.location.origin}/proposal/${selected.shareToken}`
    : null;

  return (
    <AppShell>
      <div className="mb-4 flex items-center gap-3">
        <Link to={`/projects/${projectId}`} className="icon-btn h-8 w-8" aria-label="Back to project">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-ink">Proposals</h1>
          <p className="text-xs text-ink-muted">Quotes built from the layout and priced from your stock.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> New proposal
        </button>
      </div>

      {error ? <div className="notice-warning mb-4">{error}</div> : null}

      {!list.data?.length ? (
        <div className="card py-16 text-center">
          <FileText className="mx-auto mb-2 h-6 w-6 text-ink-subtle" />
          <p className="text-sm text-ink-muted">
            No proposals yet. Create one and build it from a layout in a click.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          {/* ── The list ────────────────────────────────────────────────── */}
          <aside className="space-y-1">
            {list.data.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={`w-full rounded-md border px-2.5 py-2 text-left transition ${
                  selected?.id === p.id
                    ? 'border-primary bg-primary/10'
                    : 'border-line hover:border-ink-subtle'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">{p.title}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_TONES[p.status]}`}>
                    {p.status}
                  </span>
                </div>
                <p className="text-xs text-ink-subtle">{p.number}</p>
                <p className="text-xs font-semibold text-ink-muted">
                  {formatMoney(p.totals.total, p.currency)}
                </p>
              </button>
            ))}
          </aside>

          {/* ── The proposal ────────────────────────────────────────────── */}
          {selected ? (
            <div className="space-y-4">
              <section className="card">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <input
                    className="input flex-1 text-base font-semibold"
                    value={selected.title}
                    onChange={(e) => update.mutate({ title: e.target.value })}
                  />
                  <select
                    className="input w-auto"
                    value={selected.status}
                    onChange={(e) => update.mutate({ status: e.target.value as Proposal['status'] })}
                  >
                    {(['draft', 'sent', 'accepted', 'declined', 'expired'] as const).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button type="button" className="icon-btn h-8 w-8"
                    aria-label="Delete proposal"
                    onClick={() => remove.mutate(selected.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="label">Client</span>
                    <input className="input" value={selected.clientName ?? ''}
                      onChange={(e) => update.mutate({ clientName: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="label">Event date</span>
                    <input className="input" type="date" value={selected.eventDate ?? ''}
                      onChange={(e) => update.mutate({ eventDate: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="label">Layout</span>
                    <select className="input" value={selected.planId ?? ''}
                      onChange={(e) =>
                        update.mutate({ planId: e.target.value ? Number(e.target.value) : null })
                      }>
                      <option value="">None</option>
                      {(plans.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>

              {/* ── Lines ────────────────────────────────────────────────── */}
              <section className="card p-0">
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                  <h2 className="flex-1 text-sm font-semibold text-ink">Lines</h2>
                  <button type="button" className="btn-secondary btn-sm"
                    disabled={!selected.planId || generate.isPending}
                    onClick={() => generate.mutate()}
                    title={selected.planId ? 'Count what is in the layout and price it' : 'Link a layout first'}>
                    <Sparkles className="h-3.5 w-3.5" /> Build from layout
                  </button>
                  {(['item', 'labour', 'fee', 'discount'] as const).map((kind) => (
                    <button key={kind} type="button" className="btn-ghost btn-sm"
                      onClick={() => addLine.mutate(kind)}>
                      <Plus className="h-3 w-3" /> {kind}
                    </button>
                  ))}
                </div>

                {selected.lines.length === 0 ? (
                  <p className="px-3 py-10 text-center text-sm text-ink-muted">
                    Nothing on this quote yet. Build it from the layout, or add lines by hand.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Description</th>
                          <th className="w-20 px-2 py-2 text-right font-semibold">Qty</th>
                          <th className="w-16 px-2 py-2 font-semibold">Unit</th>
                          <th className="w-28 px-2 py-2 text-right font-semibold">Price</th>
                          <th className="w-14 px-2 py-2 text-center font-semibold">Tax</th>
                          <th className="w-28 px-3 py-2 text-right font-semibold">Amount</th>
                          <th className="w-8 px-2 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {selected.lines.map((l) => (
                          <tr key={l.id} className="border-b border-line/60 last:border-0">
                            <td className="px-3 py-1.5">
                              <input
                                className="w-full bg-transparent text-sm text-ink outline-none"
                                value={l.description}
                                onChange={(e) =>
                                  updateLine.mutate({ id: l.id, patch: { description: e.target.value } })
                                }
                              />
                              <span className="text-[10px] uppercase text-ink-subtle">
                                {l.kind}
                                {l.catalogItemId ? ' · from layout' : ''}
                              </span>
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                className="w-full bg-transparent text-right text-sm tabular-nums text-ink outline-none"
                                value={formatQuantity(l.quantityMilli)}
                                onChange={(e) =>
                                  updateLine.mutate({
                                    id: l.id,
                                    patch: { quantityMilli: parseQuantity(e.target.value) },
                                  })
                                }
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                className="w-full bg-transparent text-sm text-ink-muted outline-none"
                                value={l.unitLabel ?? ''}
                                onChange={(e) =>
                                  updateLine.mutate({ id: l.id, patch: { unitLabel: e.target.value } })
                                }
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                className="w-full bg-transparent text-right text-sm tabular-nums text-ink outline-none"
                                value={l.unitPrice}
                                onChange={(e) =>
                                  updateLine.mutate({
                                    id: l.id,
                                    patch: { unitPrice: Number(e.target.value) },
                                  })
                                }
                              />
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              <input
                                type="checkbox"
                                checked={l.taxable}
                                onChange={(e) =>
                                  updateLine.mutate({ id: l.id, patch: { taxable: e.target.checked } })
                                }
                              />
                            </td>
                            <td className="px-3 py-1.5 text-right font-medium tabular-nums text-ink">
                              {formatMoney(lineAmount(l), selected.currency)}
                            </td>
                            <td className="px-2 py-1.5">
                              <button type="button" className="icon-btn h-6 w-6"
                                aria-label="Remove line"
                                onClick={() => removeLine.mutate(l.id)}>
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* ── Totals ───────────────────────────────────────────────── */}
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="card">
                  <h2 className="mb-2 text-sm font-semibold text-ink">Rates</h2>
                  {([
                    ['Tax', 'taxRateBp'],
                    ['Discount', 'discountBp'],
                    ['Deposit', 'depositBp'],
                  ] as const).map(([label, key]) => (
                    <label key={key} className="mb-2 block">
                      <div className="flex items-baseline justify-between">
                        <span className="label mb-0">{label}</span>
                        <span className="text-xs font-semibold tabular-nums text-ink">
                          {formatRate(selected[key])}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={key === 'depositBp' ? 10000 : 5000}
                        step={50}
                        value={selected[key]}
                        className="w-full accent-primary"
                        onChange={(e) => update.mutate({ [key]: Number(e.target.value) } as Partial<Proposal>)}
                      />
                    </label>
                  ))}
                  <p className="text-[11px] leading-snug text-ink-subtle">
                    Discount comes off before tax, so tax is charged on what is actually paid.
                  </p>
                </section>

                <section className="card">
                  <h2 className="mb-2 text-sm font-semibold text-ink">Total</h2>
                  <dl className="space-y-1 text-sm">
                    {([
                      ['Subtotal', selected.totals.subtotal, false],
                      ['Discount', -selected.totals.discount, false],
                      ['Net', selected.totals.net, false],
                      [`Tax on ${formatMoney(selected.totals.taxableNet, selected.currency)}`, selected.totals.tax, false],
                      ['Total', selected.totals.total, true],
                      ['Deposit due', selected.totals.deposit, false],
                      ['Balance', selected.totals.balance, false],
                    ] as const).map(([label, value, strong]) => (
                      <div key={label} className={`flex justify-between ${strong ? 'border-t border-line pt-1' : ''}`}>
                        <dt className={strong ? 'font-semibold text-ink' : 'text-ink-muted'}>{label}</dt>
                        <dd className={`tabular-nums ${strong ? 'text-base font-semibold text-ink' : 'text-ink'}`}>
                          {formatMoney(value, selected.currency)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>

              {/* ── Share ────────────────────────────────────────────────── */}
              <section className="card">
                <h2 className="mb-2 text-sm font-semibold text-ink">Send to the client</h2>
                {shareUrl ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input readOnly className="input flex-1 font-mono text-xs" value={shareUrl} />
                    <button type="button" className="btn-secondary"
                      onClick={() => {
                        void navigator.clipboard.writeText(shareUrl);
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1800);
                      }}>
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn-secondary"
                    disabled={share.isPending}
                    onClick={() => share.mutate()}>
                    <Link2 className="h-3.5 w-3.5" /> Create a client link
                  </button>
                )}
                <p className="mt-2 text-[11px] leading-snug text-ink-subtle">
                  The client sees the lines, totals and terms, and can accept or decline. Your costs,
                  stock levels and internal notes are not sent.
                </p>
              </section>
            </div>
          ) : null}
        </div>
      )}

      <Modal
        open={createOpen}
        title="New proposal"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary"
              disabled={!title.trim() || create.isPending}
              onClick={() => create.mutate()}>
              Create
            </button>
          </>
        }
      >
        <label className="block">
          <span className="label">Title</span>
          <input className="input" value={title} autoFocus
            onChange={(e) => setTitle(e.target.value)} />
        </label>
      </Modal>
    </AppShell>
  );
}
