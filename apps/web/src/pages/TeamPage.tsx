import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Trash2, UserPlus } from 'lucide-react';
import { http, ApiClientError } from '../lib/api';
import { AppShell } from '../components/AppShell';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';
import { useSession } from '../store/session';

interface Member {
  id: number;
  userId: number | null;
  email: string;
  name: string | null;
  role: 'member' | 'admin';
  visibility: 'own_only' | 'company_wide';
  seatPlanTier: 'free' | 'plus' | 'pro';
  status: string;
  creditsRemaining: number | null;
}

/**
 * Company team.
 *
 * A seat carries its own plan tier, so a studio can put two designers on the
 * top tier without buying it for everybody. Credits are either per-member or
 * drawn from one shared pool — the switch is deferred to the next cycle so
 * nobody loses an allowance they have already been granted.
 */
export function TeamPage() {
  const qc = useQueryClient();
  const user = useSession((s) => s.user);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [seatPlanTier, setSeatPlanTier] = useState<'free' | 'plus' | 'pro'>('plus');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [visibility, setVisibility] = useState<'own_only' | 'company_wide'>('own_only');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['company', 'members'],
    queryFn: async () =>
      (await http.get<{ items: Member[]; creditMode: string; poolBalance: number }>('/company/members')).data,
  });
  const { data: usage } = useQuery({
    queryKey: ['company', 'usage'],
    queryFn: async () =>
      (await http.get<{
        byFeature: Array<{ featureCode: string | null; used: number }>;
        byMember: Array<{ userId: number; email: string | null; used: number }>;
      }>('/company/credits/usage')).data,
  });

  const invite = useMutation({
    mutationFn: async () =>
      (await http.post<{ inviteToken?: string }>('/company/members', {
        email: email.trim(),
        role,
        visibility,
        seatPlanTier,
      })).data,
    onSuccess: (payload) => {
      void qc.invalidateQueries({ queryKey: ['company'] });
      setEmail('');
      if (payload.inviteToken) {
        setInviteLink(`${window.location.origin}/accept-invite?token=${payload.inviteToken}`);
      } else {
        setInviteOpen(false);
        setNotice({ tone: 'success', text: 'Invitation sent.' });
      }
    },
    onError: (err) =>
      setNotice({ tone: 'error', text: err instanceof ApiClientError ? err.message : 'Could not invite.' }),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Record<string, unknown> }) =>
      (await http.patch(`/company/members/${id}`, patch)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['company'] }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => (await http.delete(`/company/members/${id}`)).data,
    onSuccess: (payload: { projectsTransferred: boolean }) => {
      void qc.invalidateQueries({ queryKey: ['company'] });
      setConfirmRemove(null);
      setNotice({
        tone: 'success',
        text: payload.projectsTransferred
          ? 'Member removed. Their company projects were transferred to an admin.'
          : 'Member removed.',
      });
    },
  });

  const setCreditMode = useMutation({
    mutationFn: async (mode: string) =>
      (await http.patch<{ applied: string; message?: string }>('/company/settings/credit-mode', { mode })).data,
    onSuccess: (payload) => {
      void qc.invalidateQueries({ queryKey: ['company'] });
      setNotice({
        tone: 'success',
        text: payload.message ?? 'Credit sharing updated.',
      });
    },
  });

  if (!user?.company) {
    return (
      <AppShell>
        <div className="card py-16 text-center">
          <p className="text-sm text-ink-muted">This account is not part of a company workspace.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-ink">{user.company.name}</h1>
      <p className="mb-5 text-sm text-ink-muted">
        Manage who is on the team, what they can access, and how credits are shared.
      </p>

      {notice ? (
        <div className={`mb-4 ${notice.tone === 'success' ? 'notice-success' : 'notice-error'}`}>{notice.text}</div>
      ) : null}

      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-muted">Credits:</span>
          <div className="flex rounded-lg border border-line bg-surface-muted/40 p-0.5">
            {([['per_user', 'Per member'], ['shared_pool', 'Shared pool']] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setCreditMode.mutate(value)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  data?.creditMode === value ? 'bg-primary text-primary-fg' : 'text-ink-muted hover:text-ink'
                }`}>
                {label}
              </button>
            ))}
          </div>
          {data?.creditMode === 'shared_pool' ? (
            <span className="text-sm text-ink-muted">
              Pool: <strong className="text-ink">{data.poolBalance}</strong>
            </span>
          ) : null}
        </div>
        <button type="button" className="btn-primary" onClick={() => { setInviteOpen(true); setInviteLink(null); }}>
          <UserPlus className="h-4 w-4" /> Invite
        </button>
      </div>

      {isLoading ? <Spinner /> : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-muted/40 text-left text-xs uppercase tracking-wide text-ink-subtle">
                <th className="px-3 py-2 font-semibold">Member</th>
                <th className="px-3 py-2 font-semibold">Seat</th>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="px-3 py-2 font-semibold">Visibility</th>
                <th className="px-3 py-2 text-right font-semibold">Credits</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((m) => (
                <tr key={m.id} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2">
                    <span className="block font-medium text-ink">{m.name ?? '—'}</span>
                    <span className="block text-xs text-ink-subtle">{m.email}</span>
                  </td>
                  <td className="px-3 py-2">
                    <select className="select py-1 text-xs" value={m.seatPlanTier}
                      onChange={(e) => update.mutate({ id: m.id, patch: { seatPlanTier: e.target.value } })}>
                      <option value="free">free</option>
                      <option value="plus">plus</option>
                      <option value="pro">pro</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select className="select py-1 text-xs" value={m.role}
                      onChange={(e) => update.mutate({ id: m.id, patch: { role: e.target.value } })}>
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select className="select py-1 text-xs" value={m.visibility}
                      onChange={(e) => update.mutate({ id: m.id, patch: { visibility: e.target.value } })}>
                      <option value="own_only">own only</option>
                      <option value="company_wide">company-wide</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">{m.creditsRemaining ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                      m.status === 'active' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                    }`}>{m.status}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" aria-label="Remove member" className="icon-btn h-7 w-7"
                      onClick={() => setConfirmRemove(m)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {usage?.byFeature.length ? (
        <section className="card mt-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Credit usage by feature</h2>
          <dl className="grid gap-2 sm:grid-cols-3">
            {usage.byFeature.map((f) => (
              <div key={f.featureCode ?? 'other'} className="flex justify-between text-sm">
                <dt className="text-ink-muted">{(f.featureCode ?? 'other').replace(/_/g, ' ')}</dt>
                <dd className="font-semibold text-ink">{f.used}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <Modal open={inviteOpen} title="Invite a team member"
        description="They receive a link to join this workspace with the seat you choose."
        onClose={() => setInviteOpen(false)}
        footer={
          inviteLink ? (
            <button type="button" className="btn-primary" onClick={() => setInviteOpen(false)}>Done</button>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={() => setInviteOpen(false)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={!email.trim() || invite.isPending}
                onClick={() => invite.mutate()}>
                {invite.isPending ? 'Inviting…' : 'Send invitation'}
              </button>
            </>
          )
        }>
        {inviteLink ? (
          <div className="space-y-3">
            <div className="notice-success">Invitation created.</div>
            <p className="text-sm text-ink-muted">
              Email delivery is not configured on this deployment, so send them this link directly:
            </p>
            <div className="flex gap-2">
              <input readOnly className="input font-mono text-xs" value={inviteLink}
                onFocus={(e) => e.target.select()} />
              <button type="button" className="btn-secondary shrink-0"
                onClick={() => void navigator.clipboard.writeText(inviteLink)}>
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="invite-email">Email</label>
              <input id="invite-email" type="email" className="input" value={email} autoFocus
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="label" htmlFor="seat">Seat</label>
                <select id="seat" className="select" value={seatPlanTier}
                  onChange={(e) => setSeatPlanTier(e.target.value as typeof seatPlanTier)}>
                  <option value="free">Free</option>
                  <option value="plus">Plus</option>
                  <option value="pro">Pro</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="role">Role</label>
                <select id="role" className="select" value={role}
                  onChange={(e) => setRole(e.target.value as typeof role)}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="vis">Visibility</label>
                <select id="vis" className="select" value={visibility}
                  onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
                  <option value="own_only">Own only</option>
                  <option value="company_wide">Company</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-ink-subtle">
              The seat tier sets what this person can do and how many credits they get each month.
            </p>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(confirmRemove)} title="Remove from team?" onClose={() => setConfirmRemove(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirmRemove(null)}>Cancel</button>
            <button type="button" className="btn-danger" disabled={remove.isPending}
              onClick={() => confirmRemove && remove.mutate(confirmRemove.id)}>
              {remove.isPending ? 'Removing…' : 'Remove'}
            </button>
          </>
        }>
        <p className="text-sm text-ink-muted">
          <strong className="text-ink">{confirmRemove?.email}</strong> loses access to this workspace.
          Their account is not deleted, and any company-owned projects transfer to an admin.
        </p>
      </Modal>
    </AppShell>
  );
}
