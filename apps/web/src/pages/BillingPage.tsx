import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, Download } from 'lucide-react';
import { http, ApiClientError } from '../lib/api';
import { AppShell } from '../components/AppShell';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';
import { useSession } from '../store/session';

interface Pricing {
  tiers: Array<{
    tier: 'free' | 'plus' | 'pro';
    marketingName: string;
    tagline: string;
    unitAmount: number;
    monthlyCredits: number;
    features: string[];
    highlight: boolean;
  }>;
  packs: Array<{ id: number; creditAmount: number; unitAmount: number; expiryDays: number | null }>;
  ratios: Array<{ featureCode: string; label: string; credits: number }>;
  checkoutAvailable: boolean;
}

interface Subscription {
  planTier: 'free' | 'plus' | 'pro';
  billingSource: string;
  cycleEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  monthlyCreditQuota: number;
  creditsRemaining: number;
  creditSource: 'user' | 'pool';
  pendingRequest: { requestedPlan: string; requestedAt: string } | null;
  checkoutAvailable: boolean;
}

/**
 * Plan and credits.
 *
 * Credits are framed the way they actually work — you spend them only when you
 * run an AI feature, and everything else is unlimited — because the alternative
 * framing ("you have a quota") makes a metered product feel restrictive when it
 * is not.
 */
export function BillingPage() {
  const qc = useQueryClient();
  const refresh = useSession((s) => s.refresh);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reasonId, setReasonId] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const { data: pricing } = useQuery({
    queryKey: ['billing', 'pricing'],
    queryFn: async () => (await http.get<Pricing>('/billing/pricing')).data,
  });
  const { data: subscription, isLoading } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: async () => (await http.get<Subscription>('/billing/subscription')).data,
  });
  const { data: reasons } = useQuery({
    queryKey: ['billing', 'reasons'],
    queryFn: async () =>
      (await http.get<{ items: Array<{ id: number; label: string; requiresNote: boolean }> }>(
        '/billing/cancellation-reasons'
      )).data.items,
    enabled: cancelOpen,
  });
  const { data: billingMode } = useQuery({
    queryKey: ['billing', 'mode'],
    queryFn: async () => (await http.get<{ mode: 'stripe' | 'manual' }>('/billing/mode')).data.mode,
  });
  const { data: ledger } = useQuery({
    queryKey: ['billing', 'history'],
    queryFn: async () =>
      (await http.get<{ items: Array<{ id: number; delta: number; reason: string; featureCode: string | null; balanceAfter: number; createdAt: string }> }>(
        '/billing/credits/history?limit=20'
      )).data.items,
  });

  const change = useMutation({
    mutationFn: async (tier: string) => (await http.post('/billing/subscription/change', { tier })).data,
    onSuccess: (data: { status: string; message?: string; url?: string }) => {
      // Stripe mode hands back a hosted Checkout URL; the plan only changes
      // once its webhook confirms payment, so nothing is updated locally here.
      if (data.status === 'checkout' && data.url) {
        window.location.assign(data.url);
        return;
      }
      void qc.invalidateQueries({ queryKey: ['billing'] });
      void refresh();
      setNotice({
        tone: data.status === 'applied' ? 'success' : 'warning',
        text: data.message ?? 'Your plan has been updated.',
      });
    },
    onError: (err) =>
      setNotice({ tone: 'error', text: err instanceof ApiClientError ? err.message : 'Could not change plan.' }),
  });

  const cancel = useMutation({
    mutationFn: async () =>
      (await http.post('/billing/subscription/cancel', { reasonId, note: note || undefined })).data,
    onSuccess: (data: { message: string }) => {
      void qc.invalidateQueries({ queryKey: ['billing'] });
      setCancelOpen(false);
      setNotice({ tone: 'warning', text: data.message });
    },
    onError: (err) =>
      setNotice({ tone: 'error', text: err instanceof ApiClientError ? err.message : 'Could not cancel.' }),
  });

  const resume = useMutation({
    mutationFn: async () => (await http.post('/billing/subscription/resume')).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['billing'] });
      setNotice({ tone: 'success', text: 'Your plan will continue as normal.' });
    },
  });

  const buyPack = useMutation({
    mutationFn: async (packId: number) =>
      (await http.post('/billing/credits/purchase', { packId })).data,
    onSuccess: (data: { status: string; message?: string; url?: string }) => {
      if (data.status === 'checkout' && data.url) {
        window.location.assign(data.url);
        return;
      }
      void qc.invalidateQueries({ queryKey: ['billing'] });
      setNotice({ tone: 'warning', text: data.message ?? 'Your purchase has been sent for approval.' });
    },
    onError: (err) =>
      setNotice({ tone: 'error', text: err instanceof ApiClientError ? err.message : 'Could not start the purchase.' }),
  });

  const openPortal = useMutation({
    mutationFn: async () => (await http.post<{ url: string }>('/billing/portal')).data,
    onSuccess: (data) => window.location.assign(data.url),
    onError: (err) =>
      setNotice({ tone: 'error', text: err instanceof ApiClientError ? err.message : 'Could not open the billing portal.' }),
  });

  // Stripe sends the browser back here with the outcome in the query string.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('checkout');
    if (!outcome) return;
    if (outcome === 'success') {
      setNotice({
        tone: 'success',
        text: 'Payment received. Your plan updates as soon as Stripe confirms it — usually within a few seconds.',
      });
      // The webhook may land just after the redirect, so re-read shortly after.
      const timer = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ['billing'] });
        void refresh();
      }, 2500);
      window.history.replaceState({}, '', window.location.pathname);
      return () => clearTimeout(timer);
    }
    setNotice({ tone: 'warning', text: 'Checkout was cancelled. Nothing has been charged.' });
    window.history.replaceState({}, '', window.location.pathname);
  }, [qc, refresh]);

  const selectedReason = reasons?.find((r) => r.id === reasonId);

  if (isLoading) {
    return <AppShell><div className="py-24"><Spinner label="Loading your plan…" /></div></AppShell>;
  }

  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-ink">Plan &amp; credits</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Credits power the AI features. You only spend them when you run one — everything else is unlimited.
      </p>

      {notice ? (
        <div className={`mb-4 notice-${notice.tone === 'success' ? 'success' : notice.tone === 'error' ? 'error' : 'warning'}`}>
          {notice.text}
        </div>
      ) : null}

      {subscription?.pendingRequest ? (
        <div className="notice-warning mb-4">
          Your change to <strong>{subscription.pendingRequest.requestedPlan}</strong> is pending approval.
        </div>
      ) : null}

      {subscription?.cancelAtPeriodEnd ? (
        <div className="notice-warning mb-4 flex items-center justify-between gap-3">
          <span>
            Cancellation is scheduled. Your plan stays active until{' '}
            {subscription.cycleEndsAt ? new Date(subscription.cycleEndsAt).toLocaleDateString() : 'the cycle end'}.
          </span>
          <button type="button" className="btn-secondary btn-sm" onClick={() => resume.mutate()}>
            Keep my plan
          </button>
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="card">
          <p className="text-xs text-ink-subtle">Current plan</p>
          <p className="text-2xl font-bold capitalize text-ink">{subscription?.planTier}</p>
        </div>
        <div className="card">
          <p className="text-xs text-ink-subtle">
            Credits {subscription?.creditSource === 'pool' ? '(company pool)' : 'remaining'}
          </p>
          <p className="text-2xl font-bold text-ink">{subscription?.creditsRemaining}</p>
        </div>
        <div className="card">
          <p className="text-xs text-ink-subtle">Monthly allowance</p>
          <p className="text-2xl font-bold text-ink">{subscription?.monthlyCreditQuota}</p>
        </div>
      </div>

      <h2 className="mb-3 text-lg font-semibold text-ink">Plans</h2>
      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        {pricing?.tiers.map((tier) => {
          const current = subscription?.planTier === tier.tier;
          return (
            <section key={tier.tier}
              className={`card relative flex flex-col ${tier.highlight ? 'border-primary/60' : ''}`}>
              {tier.highlight ? (
                <span className="absolute -top-2 left-4 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary-fg">
                  Most popular
                </span>
              ) : null}
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-subtle">
                {tier.marketingName}
              </h3>
              <p className="mt-1 text-3xl font-bold text-ink">
                ${(tier.unitAmount / 100).toFixed(0)}
                <span className="text-sm font-normal text-ink-subtle"> / month</span>
              </p>
              <p className="mt-1 text-sm text-ink-muted">{tier.tagline}</p>
              <p className="mt-3 text-sm font-semibold text-primary">
                {tier.monthlyCredits} credits / month
              </p>
              <ul className="mt-3 flex-1 space-y-1.5">
                {tier.features.map((f) => (
                  <li key={f} className="flex gap-2 text-xs text-ink-muted">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                    {f}
                  </li>
                ))}
              </ul>
              <button type="button"
                className={`mt-4 w-full ${current ? 'btn-secondary' : 'btn-primary'}`}
                disabled={current || change.isPending}
                onClick={() => change.mutate(tier.tier)}>
                {current ? 'Your plan' : change.isPending ? 'Working…' : `Switch to ${tier.marketingName}`}
              </button>
            </section>
          );
        })}
      </div>

      {/* Top-up packs. Hidden on Free, which cannot buy them. */}
      {pricing?.packs?.length && subscription?.planTier !== 'free' ? (
        <section className="card mb-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Top up credits</h2>
              <p className="text-xs text-ink-subtle">
                One-off packs on top of your monthly allowance. They never replace it.
              </p>
            </div>
            {billingMode === 'stripe' ? (
              <button type="button" className="btn-ghost btn-sm" disabled={openPortal.isPending}
                onClick={() => openPortal.mutate()}>
                <CreditCard className="h-3.5 w-3.5" /> Manage billing
              </button>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {pricing.packs.map((pack) => (
              <div key={pack.id} className="rounded-lg border border-line bg-surface-muted/40 p-3">
                <p className="text-lg font-semibold text-ink">{pack.creditAmount} credits</p>
                <p className="text-xs text-ink-subtle">
                  {(pack.unitAmount / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                  {pack.expiryDays ? ` · expires in ${pack.expiryDays} days` : ' · never expires'}
                </p>
                <button type="button" className="btn-secondary btn-sm mt-3 w-full"
                  disabled={buyPack.isPending}
                  onClick={() => buyPack.mutate(pack.id)}>
                  {billingMode === 'stripe' ? 'Buy' : 'Request'}
                </button>
              </div>
            ))}
          </div>
          {billingMode === 'manual' ? (
            <p className="mt-3 text-xs text-ink-subtle">
              Card payment is not enabled here, so a request goes to an administrator for approval.
              Nothing is charged and no credits are granted until they approve it.
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-1 text-sm font-semibold text-ink">What credits cost</h2>
          <p className="mb-3 text-xs text-ink-subtle">Only these actions spend credits.</p>
          <dl className="space-y-1.5 text-sm">
            {pricing?.ratios.map((r) => (
              <div key={r.featureCode} className="flex justify-between">
                <dt className="text-ink-muted">{r.label}</dt>
                <dd className="font-semibold text-ink">{r.credits}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-ink">Recent credit activity</h2>
            <a href="/api/billing/credits/history/export" className="btn-ghost btn-sm">
              <Download className="h-3.5 w-3.5" /> CSV
            </a>
          </div>
          {!ledger?.length ? (
            <p className="text-sm text-ink-subtle">No credit activity yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {ledger.map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-3">
                  <span className="text-ink-muted">
                    {entry.featureCode?.replace(/_/g, ' ') ?? entry.reason.replace(/_/g, ' ')}
                    <span className="ml-2 text-[11px] text-ink-subtle">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span className={`font-semibold tabular-nums ${entry.delta > 0 ? 'text-success' : 'text-ink'}`}>
                    {entry.delta > 0 ? '+' : ''}{entry.delta}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {subscription && subscription.planTier !== 'free' && !subscription.cancelAtPeriodEnd ? (
        <button type="button" className="btn-ghost mt-6 text-sm text-ink-subtle"
          onClick={() => setCancelOpen(true)}>
          Cancel subscription
        </button>
      ) : null}

      <Modal open={cancelOpen} title="Cancel your subscription"
        description="Your plan stays active until the end of the current billing period."
        onClose={() => setCancelOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCancelOpen(false)}>
              Keep my plan
            </button>
            <button type="button" className="btn-danger"
              disabled={!reasonId || (selectedReason?.requiresNote && !note.trim()) || cancel.isPending}
              onClick={() => cancel.mutate()}>
              {cancel.isPending ? 'Cancelling…' : 'Schedule cancellation'}
            </button>
          </>
        }>
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">Why are you cancelling? This genuinely shapes what we build next.</p>
          <div className="space-y-1.5">
            {reasons?.map((r) => (
              <label key={r.id} className="flex items-start gap-2 text-sm text-ink-muted">
                <input type="radio" name="reason" className="mt-1 accent-primary"
                  checked={reasonId === r.id} onChange={() => setReasonId(r.id)} />
                {r.label}
              </label>
            ))}
          </div>
          {selectedReason?.requiresNote ? (
            <div>
              <label className="label" htmlFor="cancel-note">Tell us more</label>
              <textarea id="cancel-note" className="input min-h-[70px] resize-y" value={note}
                onChange={(e) => setNote(e.target.value)} />
            </div>
          ) : null}
        </div>
      </Modal>
    </AppShell>
  );
}
