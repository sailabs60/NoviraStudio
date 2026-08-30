import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ShieldAlert, X } from 'lucide-react';
import { formatLength } from '@novira/shared';
import { http, ApiClientError } from '../lib/api';
import { AppShell } from '../components/AppShell';
import { Spinner } from '../components/Spinner';
import { useSession } from '../store/session';

type Tab = 'overview' | 'users' | 'review' | 'pricing' | 'jobs' | 'companies';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'review', label: 'Catalogue review' },
  { key: 'pricing', label: 'Pricing & credits' },
  { key: 'jobs', label: 'AI jobs' },
  { key: 'companies', label: 'Companies' },
];

export function AdminPage() {
  const user = useSession((s) => s.user);
  const [tab, setTab] = useState<Tab>('overview');

  if (user?.role !== 'super_admin') {
    return (
      <AppShell>
        <div className="card flex flex-col items-center gap-2 py-20 text-center">
          <ShieldAlert className="h-6 w-6 text-ink-subtle" />
          <p className="text-base font-semibold text-ink">Administrators only</p>
          <p className="text-sm text-ink-muted">This console is not available for your account.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-ink">Admin console</h1>
      <p className="mb-5 text-sm text-ink-muted">
        Pricing, credit costs and the catalogue queue are all live configuration — changes here take
        effect immediately.
      </p>

      <nav className="mb-5 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' ? <Overview /> : null}
      {tab === 'users' ? <Users /> : null}
      {tab === 'review' ? <Review /> : null}
      {tab === 'pricing' ? <Pricing /> : null}
      {tab === 'jobs' ? <Jobs /> : null}
      {tab === 'companies' ? <Companies /> : null}
    </AppShell>
  );
}

/* ── Overview ──────────────────────────────────────────────────────────── */

function Overview() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: async () => (await http.get('/admin/dashboard')).data as Record<string, never>,
  });

  if (isLoading) return <Spinner label="Loading…" />;
  if (!data) return null;

  const d = data as unknown as {
    totalUsers: number;
    companies: number;
    activeSubscribers: number;
    planSplit: Record<string, number>;
    totalProjects: number;
    totalPlans: number;
    catalog: { approved: number; pending: number };
    credits: { issued: number; spent: number };
    jobsByStatus: Record<string, number>;
    providers: Record<string, { available: boolean; name: string; reason?: string }>;
    recentSignups: Array<{ id: number; email: string; planTier: string; createdAt: string }>;
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users" value={d.totalUsers} sub={`${d.activeSubscribers} on a paid plan`} />
        <Stat label="Companies" value={d.companies} sub="Team workspaces" />
        <Stat label="Plans" value={d.totalPlans} sub={`across ${d.totalProjects} projects`} />
        <Stat
          label="Catalogue"
          value={d.catalog.approved}
          sub={`${d.catalog.pending} awaiting review`}
          tone={d.catalog.pending > 0 ? 'warning' : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 text-sm font-semibold text-ink">Credits</h2>
          <dl className="space-y-1.5 text-sm">
            <Row label="Issued" value={String(d.credits.issued)} />
            <Row label="Spent" value={String(d.credits.spent)} />
            <Row label="Outstanding" value={String(d.credits.issued - d.credits.spent)} />
          </dl>
        </section>

        <section className="card">
          <h2 className="mb-3 text-sm font-semibold text-ink">AI providers</h2>
          <ul className="space-y-1.5 text-sm">
            {Object.entries(d.providers).map(([feature, status]) => (
              <li key={feature} className="flex items-start justify-between gap-3">
                <span className="text-ink-muted">{feature.replace(/_/g, ' ')}</span>
                <span className="text-right">
                  <span className={status.available ? 'text-success' : 'text-warning'}>
                    {status.available ? status.name : 'not configured'}
                  </span>
                  {status.reason ? (
                    <span className="block text-[11px] text-ink-subtle">{status.reason}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="mb-3 text-sm font-semibold text-ink">Plan split</h2>
          <dl className="space-y-1.5 text-sm">
            {Object.entries(d.planSplit).map(([tier, count]) => (
              <Row key={tier} label={tier} value={String(count)} />
            ))}
          </dl>
        </section>

        <section className="card">
          <h2 className="mb-3 text-sm font-semibold text-ink">Recent sign-ups</h2>
          <ul className="space-y-1.5 text-sm">
            {d.recentSignups.map((u) => (
              <li key={u.id} className="flex justify-between gap-3">
                <span className="truncate text-ink-muted">{u.email}</span>
                <span className="shrink-0 text-ink-subtle">{u.planTier}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({
  label, value, sub, tone,
}: { label: string; value: number | string; sub?: string; tone?: 'warning' }) {
  return (
    <div className="card">
      <p className="text-xs text-ink-subtle">{label}</p>
      <p className={`text-2xl font-bold ${tone === 'warning' ? 'text-warning' : 'text-ink'}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-ink-subtle">{sub}</p> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="capitalize text-ink-muted">{label}</dt>
      <dd className="font-semibold text-ink">{value}</dd>
    </div>
  );
}

/* ── Users ─────────────────────────────────────────────────────────────── */

function Users() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', q],
    queryFn: async () =>
      (await http.get('/admin/users', { params: { q: q || undefined, limit: 50 } })).data as {
        items: Array<{
          id: number; email: string; name: string; role: string; planTier: string;
          companyName: string | null; creditsRemaining: number; isBlocked: boolean;
        }>;
        total: number;
      },
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Record<string, unknown> }) =>
      (await http.patch(`/admin/users/${id}`, patch)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiClientError ? err.message : 'Update failed.'),
  });

  return (
    <div>
      {error ? <div className="notice-error mb-3">{error}</div> : null}
      <input className="input mb-3 max-w-sm" placeholder="Search by name or email…" value={q}
        onChange={(e) => setQ(e.target.value)} />

      {isLoading ? <Spinner /> : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-muted/40 text-left text-xs uppercase tracking-wide text-ink-subtle">
                <th className="px-3 py-2 font-semibold">User</th>
                <th className="px-3 py-2 font-semibold">Company</th>
                <th className="px-3 py-2 font-semibold">Plan</th>
                <th className="px-3 py-2 text-right font-semibold">Credits</th>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((u) => (
                <tr key={u.id} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2">
                    <span className="block font-medium text-ink">{u.name || '—'}</span>
                    <span className="block text-xs text-ink-subtle">{u.email}</span>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{u.companyName ?? '—'}</td>
                  <td className="px-3 py-2">
                    <select className="select py-1 text-xs" value={u.planTier}
                      onChange={(e) => update.mutate({ id: u.id, patch: { planTier: e.target.value } })}>
                      <option value="free">free</option>
                      <option value="plus">plus</option>
                      <option value="pro">pro</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-ink">{u.creditsRemaining}</td>
                  <td className="px-3 py-2 text-ink-muted">{u.role.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2">
                    <button type="button"
                      onClick={() => update.mutate({ id: u.id, patch: { isBlocked: !u.isBlocked } })}
                      className={`btn-sm rounded-md px-2 py-1 text-xs font-semibold ${
                        u.isBlocked ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success'
                      }`}>
                      {u.isBlocked ? 'Blocked' : 'Active'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Catalogue review ──────────────────────────────────────────────────── */

function Review() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'review'],
    queryFn: async () =>
      (await http.get('/admin/catalog/review', { params: { status: 'pending' } })).data as {
        items: Array<{
          id: number; name: string; categoryName: string; widthMm: number | null;
          depthMm: number | null; heightMm: number | null; previewImage: string | null;
          verificationScore: number | null; sourceLabel: string | null;
          verificationNotes: { summary?: string } | null;
        }>;
      },
  });

  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: number; decision: 'approve' | 'reject' }) =>
      (await http.post(`/admin/catalog/${id}/review`, { decision })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'review'] }),
  });

  if (isLoading) return <Spinner />;
  if (!data?.items.length) {
    return (
      <div className="card py-16 text-center">
        <p className="text-sm text-ink-muted">Nothing waiting for review.</p>
      </div>
    );
  }

  return (
    <>
      <p className="mb-3 text-sm text-ink-muted">
        These items were measured and held back because something did not add up — usually a size
        outside the plausible range for what they claim to be. Approve to publish, reject to discard.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.items.map((item) => (
          <article key={item.id} className="card">
            <div className="mb-2 flex h-24 items-center justify-center overflow-hidden rounded bg-surface-muted/60">
              {item.previewImage ? (
                <img src={item.previewImage} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <span className="text-xs text-ink-subtle">3D model</span>
              )}
            </div>
            <h3 className="truncate text-sm font-semibold text-ink">{item.name}</h3>
            <p className="text-xs text-ink-muted">{item.categoryName}</p>
            <p className="mt-1 text-xs text-success">
              {[item.widthMm, item.depthMm, item.heightMm]
                .filter((v): v is number => typeof v === 'number')
                .map((v) => formatLength(v, 'imperial'))
                .join(' × ')}
            </p>
            {item.verificationNotes?.summary ? (
              <p className="mt-1.5 text-[11px] leading-relaxed text-warning">
                {item.verificationNotes.summary}
              </p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn-secondary btn-sm flex-1"
                onClick={() => decide.mutate({ id: item.id, decision: 'approve' })}>
                <Check className="h-3.5 w-3.5" /> Approve
              </button>
              <button type="button" className="btn-danger btn-sm flex-1"
                onClick={() => decide.mutate({ id: item.id, decision: 'reject' })}>
                <X className="h-3.5 w-3.5" /> Reject
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/* ── Pricing ───────────────────────────────────────────────────────────── */

function Pricing() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['billing', 'pricing'],
    queryFn: async () => (await http.get('/billing/pricing')).data as {
      tiers: Array<{ tier: string; marketingName: string; unitAmount: number; monthlyCredits: number }>;
      ratios: Array<{ featureCode: string; label: string; credits: number; description: string | null }>;
    },
  });

  const setRatio = useMutation({
    mutationFn: async ({ code, credits }: { code: string; credits: number }) =>
      (await http.patch(`/admin/credit-ratios/${code}`, { credits })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['billing', 'pricing'] }),
  });

  const setTier = useMutation({
    mutationFn: async ({ tier, patch }: { tier: string; patch: Record<string, unknown> }) =>
      (await http.patch(`/admin/pricing/${tier}`, patch)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['billing', 'pricing'] }),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card">
        <h2 className="mb-1 text-sm font-semibold text-ink">Plan pricing</h2>
        <p className="mb-3 text-xs text-ink-subtle">
          Allowance changes apply from the next billing cycle; existing balances are untouched.
        </p>
        <table className="w-full text-sm">
          <tbody>
            {data?.tiers.map((t) => (
              <tr key={t.tier} className="border-b border-line/60 last:border-0">
                <td className="py-2 capitalize text-ink">{t.tier}
                  <span className="block text-xs text-ink-subtle">{t.marketingName}</span>
                </td>
                <td className="py-2">
                  <input type="number" className="input w-24 py-1 text-xs" defaultValue={t.unitAmount / 100}
                    onBlur={(e) => {
                      const v = Math.round(Number(e.target.value) * 100);
                      if (Number.isFinite(v) && v !== t.unitAmount) setTier.mutate({ tier: t.tier, patch: { unitAmount: v } });
                    }} />
                </td>
                <td className="py-2">
                  <input type="number" className="input w-20 py-1 text-xs" defaultValue={t.monthlyCredits}
                    onBlur={(e) => {
                      const v = Math.round(Number(e.target.value));
                      if (Number.isFinite(v) && v !== t.monthlyCredits) setTier.mutate({ tier: t.tier, patch: { monthlyCredits: v } });
                    }} />
                  <span className="ml-1 text-xs text-ink-subtle">cr</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 className="mb-1 text-sm font-semibold text-ink">Credit cost per action</h2>
        <p className="mb-3 text-xs text-ink-subtle">
          What each metered feature deducts from a user&rsquo;s balance.
        </p>
        <table className="w-full text-sm">
          <tbody>
            {data?.ratios.map((r) => (
              <tr key={r.featureCode} className="border-b border-line/60 last:border-0">
                <td className="py-2 text-ink">{r.label}
                  {r.description ? <span className="block text-[11px] text-ink-subtle">{r.description}</span> : null}
                </td>
                <td className="w-20 py-2 text-right">
                  <input type="number" className="input w-16 py-1 text-right text-xs" defaultValue={r.credits}
                    onBlur={(e) => {
                      const v = Math.round(Number(e.target.value));
                      if (Number.isFinite(v) && v !== r.credits) setRatio.mutate({ code: r.featureCode, credits: v });
                    }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ── Jobs ──────────────────────────────────────────────────────────────── */

function Jobs() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'jobs'],
    queryFn: async () => (await http.get('/admin/jobs')).data as {
      items: Array<{
        id: string; email: string; processType: string; provider: string | null; status: string;
        creditsCharged: number; errorMessage: string | null; createdAt: string; durationMs: number | null;
      }>;
    },
    refetchInterval: 8000,
  });

  if (isLoading) return <Spinner />;
  if (!data?.items.length) {
    return <div className="card py-16 text-center"><p className="text-sm text-ink-muted">No AI jobs yet.</p></div>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-muted/40 text-left text-xs uppercase tracking-wide text-ink-subtle">
            <th className="px-3 py-2 font-semibold">User</th>
            <th className="px-3 py-2 font-semibold">Feature</th>
            <th className="px-3 py-2 font-semibold">Provider</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 text-right font-semibold">Credits</th>
            <th className="px-3 py-2 text-right font-semibold">Took</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((j) => (
            <tr key={j.id} className="border-b border-line/60 last:border-0">
              <td className="px-3 py-2 text-ink-muted">{j.email}</td>
              <td className="px-3 py-2 text-ink">{j.processType.replace(/_/g, ' ')}</td>
              <td className="px-3 py-2 text-ink-muted">{j.provider ?? '—'}</td>
              <td className="px-3 py-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                  j.status === 'completed' ? 'bg-success/15 text-success'
                    : j.status === 'failed' ? 'bg-danger/15 text-danger'
                    : 'bg-surface-muted text-ink-muted'
                }`}>{j.status}</span>
                {j.errorMessage ? (
                  <span className="block max-w-xs truncate text-[11px] text-danger">{j.errorMessage}</span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-ink">{j.creditsCharged}</td>
              <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                {j.durationMs ? `${(j.durationMs / 1000).toFixed(1)}s` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Companies ─────────────────────────────────────────────────────────── */

function Companies() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'companies'],
    queryFn: async () => (await http.get('/admin/companies')).data as {
      items: Array<{
        id: number; name: string; memberCount: number; projectCount: number; creditMode: string;
        poolBalance: number; globalModelsEnabled: boolean; aiImageTo3dEnabled: boolean; isActive: boolean;
      }>;
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Record<string, unknown> }) =>
      (await http.patch(`/admin/companies/${id}`, patch)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'companies'] }),
  });

  if (isLoading) return <Spinner />;
  if (!data?.items.length) {
    return <div className="card py-16 text-center"><p className="text-sm text-ink-muted">No companies yet.</p></div>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {data.items.map((c) => (
        <section key={c.id} className="card">
          <h3 className="text-sm font-semibold text-ink">{c.name}</h3>
          <p className="mb-3 text-xs text-ink-subtle">
            {c.memberCount} member{c.memberCount === 1 ? '' : 's'} · {c.projectCount} projects ·{' '}
            {c.creditMode === 'shared_pool' ? `shared pool (${c.poolBalance})` : 'credits per user'}
          </p>
          <div className="space-y-2">
            <Toggle label="Global model library" checked={c.globalModelsEnabled}
              onChange={(v) => update.mutate({ id: c.id, patch: { globalModelsEnabled: v } })} />
            <Toggle label="AI Image to 3D" checked={c.aiImageTo3dEnabled}
              onChange={(v) => update.mutate({ id: c.id, patch: { aiImageTo3dEnabled: v } })} />
            <Toggle label="Workspace active" checked={c.isActive}
              onChange={(v) => update.mutate({ id: c.id, patch: { isActive: v } })} />
          </div>
        </section>
      ))}
    </div>
  );
}

function Toggle({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-ink-muted">{label}</span>
      <input type="checkbox" className="h-4 w-4 rounded border-line bg-surface-muted accent-primary"
        checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
