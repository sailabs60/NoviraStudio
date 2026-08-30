import { useState } from 'react';
import { AppShell } from '../components/AppShell';
import { useSession } from '../store/session';
import { api, ApiClientError } from '../lib/api';

export function AccountPage() {
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function update(patch: Parameters<typeof api.auth.updateMe>[0]) {
    setBusy(true);
    setNotice(null);
    try {
      setUser(await api.auth.updateMe(patch));
      setNotice({ tone: 'success', text: 'Account settings saved.' });
    } catch (err) {
      setNotice({
        tone: 'error',
        text: err instanceof ApiClientError ? err.message : 'Could not save your settings.',
      });
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-ink">Account</h1>
      <p className="mb-6 text-sm text-ink-muted">Your profile and workspace defaults.</p>

      {notice ? (
        <div className={`mb-4 ${notice.tone === 'success' ? 'notice-success' : 'notice-error'}`}>
          {notice.text}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 text-sm font-semibold text-ink">Profile</h2>
          <label className="label" htmlFor="displayName">
            Display name
          </label>
          <input
            id="displayName"
            className="input mb-3"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <p className="mb-3 text-xs text-ink-subtle">{user.email}</p>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || displayName.trim().length < 2}
            onClick={() => void update({ displayName: displayName.trim() })}
          >
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </section>

        <section className="card">
          <h2 className="mb-3 text-sm font-semibold text-ink">Workspace defaults</h2>

          <span className="label">Default units for new plans</span>
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface-muted/40 p-1">
            {(['imperial', 'metric'] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => void update({ preferredUnits: u })}
                className={`rounded-md px-3 py-2 text-sm font-semibold capitalize transition ${
                  user.preferredUnits === u ? 'bg-primary text-primary-fg' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
          <p className="mb-4 text-xs text-ink-subtle">
            The active editor updates right away. Plans you have already saved keep the units they were
            created with.
          </p>

          <span className="label">Appearance</span>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface-muted/40 p-1">
            {(['dark', 'light'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => void update({ appearance: mode })}
                className={`rounded-md px-3 py-2 text-sm font-semibold capitalize transition ${
                  user.appearance === mode ? 'bg-primary text-primary-fg' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </section>

        <section className="card lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-ink">Plan and credits</h2>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-ink-subtle">Current plan</dt>
              <dd className="text-lg font-semibold capitalize text-ink">{user.planTier}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-subtle">Credits remaining</dt>
              <dd className="text-lg font-semibold text-ink">{user.creditsRemaining}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-subtle">Monthly allowance</dt>
              <dd className="text-lg font-semibold text-ink">{user.monthlyCreditQuota}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink-subtle">
            Credits are spent only when you run an AI feature. Everything else is unlimited.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
