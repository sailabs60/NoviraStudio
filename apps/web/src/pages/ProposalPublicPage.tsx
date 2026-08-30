import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { formatMoney, formatQuantity, formatRate, lineAmount } from '@novira/shared';
import { http, ApiClientError } from '../lib/api';
import { Spinner } from '../components/Spinner';

/**
 * What the client sees.
 *
 * No account, no navigation, no reference to the planner's own systems. The
 * response endpoint returns only what belongs on a quote, so internal cost and
 * stock levels are absent from the payload rather than merely hidden here —
 * which is the only version of that guarantee worth having.
 */

interface PublicLine {
  kind: string;
  description: string;
  quantityMilli: number;
  unitLabel: string | null;
  unitPrice: number;
  taxable: boolean;
}

interface PublicProposal {
  number: string;
  title: string;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
  clientName: string | null;
  eventDate: string | null;
  currency: string;
  validUntil: string | null;
  notes: string | null;
  terms: string | null;
  lines: PublicLine[];
  totals: {
    subtotal: number;
    discount: number;
    net: number;
    tax: number;
    total: number;
    deposit: number;
    balance: number;
    taxableNet: number;
  };
  taxRateBp: number;
  discountBp: number;
  depositBp: number;
}

export function ProposalPublicPage() {
  const { token } = useParams();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-proposal', token],
    queryFn: async () => (await http.get<PublicProposal>(`/proposal/${token}`)).data,
    retry: false,
  });

  const respond = useMutation({
    mutationFn: async (decision: 'accepted' | 'declined') =>
      (await http.post(`/proposal/${token}/respond`, { decision })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['public-proposal', token] }),
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : 'Could not record your answer.'),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Spinner label="Loading your proposal…" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="card max-w-md text-center">
          <h1 className="mb-1 text-lg font-semibold text-ink">This link is no longer valid</h1>
          <p className="text-sm text-ink-muted">
            The proposal may have been withdrawn or replaced. Ask your planner for a new link.
          </p>
        </div>
      </div>
    );
  }

  const answered = data.status === 'accepted' || data.status === 'declined';

  return (
    <div className="min-h-screen bg-surface px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <p className="text-xs uppercase tracking-wide text-ink-subtle">{data.number}</p>
          <h1 className="text-2xl font-semibold text-ink">{data.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {data.clientName ? `Prepared for ${data.clientName}` : 'Proposal'}
            {data.eventDate ? ` · ${new Date(data.eventDate).toLocaleDateString()}` : ''}
          </p>
          {data.validUntil ? (
            <p className="mt-0.5 text-xs text-ink-subtle">
              Valid until {new Date(data.validUntil).toLocaleDateString()}
            </p>
          ) : null}
        </header>

        {answered ? (
          <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            data.status === 'accepted'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          }`}>
            {data.status === 'accepted'
              ? 'Thank you — this proposal has been accepted. Your planner will be in touch.'
              : 'This proposal has been declined.'}
          </div>
        ) : null}

        {error ? <div className="notice-error mb-4">{error}</div> : null}

        <section className="card mb-4 p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Description</th>
                <th className="w-24 px-2 py-2.5 text-right font-semibold">Qty</th>
                <th className="w-28 px-2 py-2.5 text-right font-semibold">Unit</th>
                <th className="w-32 px-4 py-2.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l, i) => (
                <tr key={i} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2 text-ink">{l.description}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink-muted">
                    {formatQuantity(l.quantityMilli)} {l.unitLabel ?? ''}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink-muted">
                    {formatMoney(l.unitPrice, data.currency)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums text-ink">
                    {formatMoney(lineAmount(l), data.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card mb-4 ml-auto max-w-sm">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Subtotal</dt>
              <dd className="tabular-nums text-ink">{formatMoney(data.totals.subtotal, data.currency)}</dd>
            </div>
            {data.totals.discount > 0 ? (
              <div className="flex justify-between">
                <dt className="text-ink-muted">Discount {formatRate(data.discountBp)}</dt>
                <dd className="tabular-nums text-ink">
                  −{formatMoney(data.totals.discount, data.currency)}
                </dd>
              </div>
            ) : null}
            {data.totals.tax > 0 ? (
              <div className="flex justify-between">
                <dt className="text-ink-muted">Tax {formatRate(data.taxRateBp)}</dt>
                <dd className="tabular-nums text-ink">{formatMoney(data.totals.tax, data.currency)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-line pt-1.5">
              <dt className="font-semibold text-ink">Total</dt>
              <dd className="text-lg font-semibold tabular-nums text-ink">
                {formatMoney(data.totals.total, data.currency)}
              </dd>
            </div>
            {data.totals.deposit > 0 ? (
              <>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Deposit due now</dt>
                  <dd className="tabular-nums text-ink">
                    {formatMoney(data.totals.deposit, data.currency)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Balance</dt>
                  <dd className="tabular-nums text-ink">
                    {formatMoney(data.totals.balance, data.currency)}
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
        </section>

        {data.notes ? (
          <section className="card mb-4">
            <h2 className="mb-1 text-sm font-semibold text-ink">Notes</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{data.notes}</p>
          </section>
        ) : null}

        {data.terms ? (
          <section className="card mb-4">
            <h2 className="mb-1 text-sm font-semibold text-ink">Terms</h2>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-subtle">{data.terms}</p>
          </section>
        ) : null}

        {!answered ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={respond.isPending}
              onClick={() => respond.mutate('accepted')}
            >
              <Check className="h-3.5 w-3.5" /> Accept this proposal
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={respond.isPending}
              onClick={() => respond.mutate('declined')}
            >
              <X className="h-3.5 w-3.5" /> Decline
            </button>
          </div>
        ) : null}

        <p className="mt-8 text-center text-[11px] text-ink-subtle">Prepared with Novira</p>
      </div>
    </div>
  );
}
