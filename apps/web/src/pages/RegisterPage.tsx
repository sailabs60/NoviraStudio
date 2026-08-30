import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useSession } from '../store/session';
import { ApiClientError } from '../lib/api';
import { AuthShell } from '../components/AuthShell';

type AccountType = 'individual' | 'company';

export function RegisterPage() {
  const status = useSession((s) => s.status);
  const register = useSession((s) => s.register);
  const navigate = useNavigate();

  const [accountType, setAccountType] = useState<AccountType>('individual');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    companyName: '',
    marketingOptIn: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Mirrors the server rule exactly, so the requirements are visible while typing.
  const rules = [
    { label: 'At least 8 characters', ok: form.password.length >= 8 },
    { label: 'Includes a letter', ok: /[A-Za-z]/.test(form.password) },
    { label: 'Includes a number', ok: /[0-9]/.test(form.password) },
  ];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register({ ...form, accountType });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not create your account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Start designing" subtitle="Create your Novira account" wide>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error ? <div className="notice-error" role="alert">{error}</div> : null}

        <div>
          <span className="label">Account type</span>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface-muted/40 p-1">
            {(['individual', 'company'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setAccountType(type)}
                className={`rounded-md px-3 py-2 text-sm font-semibold capitalize transition ${
                  accountType === type
                    ? 'bg-primary text-primary-fg shadow-sm'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {accountType === 'company' ? (
          <div>
            <label className="label" htmlFor="companyName">Company name</label>
            <input
              id="companyName"
              className="input"
              value={form.companyName}
              onChange={(e) => set('companyName', e.target.value)}
              required
            />
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="firstName">First name</label>
            <input id="firstName" className="input" value={form.firstName}
              onChange={(e) => set('firstName', e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="lastName">Last name</label>
            <input id="lastName" className="input" value={form.lastName}
              onChange={(e) => set('lastName', e.target.value)} required />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" className="input" value={form.email}
            onChange={(e) => set('email', e.target.value)} required />
        </div>

        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="new-password" className="input"
            value={form.password} onChange={(e) => set('password', e.target.value)} required />
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {rules.map((r) => (
              <li key={r.label} className={`text-xs ${r.ok ? 'text-success' : 'text-ink-subtle'}`}>
                {r.ok ? '✓' : '○'} {r.label}
              </li>
            ))}
          </ul>
        </div>

        <label className="flex items-start gap-2.5 text-xs text-ink-muted">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line bg-surface-muted"
            checked={form.marketingOptIn} onChange={(e) => set('marketingOptIn', e.target.checked)} />
          <span>I agree to receive news and special offers. Optional, and it does not affect registration.</span>
        </label>

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Creating your account…' : 'Start designing'}
        </button>

        <p className="text-center text-sm text-ink-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
