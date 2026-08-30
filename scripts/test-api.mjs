/**
 * API surface sweep.
 *
 * Fast, headless, and covers every route group. The browser tests prove the UI;
 * this proves the API underneath it, without waiting on software WebGL.
 */
const BASE = process.env.NOVIRA_API ?? 'http://localhost:4100/api';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function call(method, path, { token, body, expect } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (expect !== undefined && res.status !== expect) {
    return { ok: false, status: res.status, payload };
  }
  return { ok: res.ok || expect !== undefined, status: res.status, payload };
}

/* ── Public ──────────────────────────────────────────────────────────── */
const health = await call('GET', '/health');
record('health', health.payload?.ok === true, `db ${health.payload?.database}`);

const pricing = await call('GET', '/billing/pricing');
record('public pricing', pricing.payload?.tiers?.length === 3, `${pricing.payload?.ratios?.length} credit ratios`);

/* ── Auth ────────────────────────────────────────────────────────────── */
const login = await call('POST', '/auth/login', {
  body: { email: 'planner@novira.test', password: 'novira123' },
});
const token = login.payload?.token;
record('login', Boolean(token));

const badLogin = await call('POST', '/auth/login', {
  body: { email: 'planner@novira.test', password: 'wrong' },
  expect: 401,
});
record('wrong password rejected', badLogin.status === 401);

const noAuth = await call('GET', '/auth/me', { expect: 401 });
record('unauthenticated rejected', noAuth.status === 401);

const me = await call('GET', '/auth/me', { token });
record('session', Boolean(me.payload?.email), `${me.payload?.planTier}, ${me.payload?.creditsRemaining} credits`);

/* ── Core data ───────────────────────────────────────────────────────── */
const projects = await call('GET', '/projects', { token });
record('projects', Array.isArray(projects.payload?.items), `${projects.payload?.items?.length} projects`);

const plans = await call('GET', '/plans', { token });
record('plans', Array.isArray(plans.payload?.items), `${plans.payload?.items?.length} plans`);

const categories = await call('GET', '/catalog/categories', { token });
const populated = (categories.payload?.items ?? []).filter((c) => c.itemCount > 0);
record('catalogue categories', populated.length > 0, `${populated.length} populated`);

const sofas = await call('GET', '/catalog/items?q=sofa', { token });
const sofaSizes = (sofas.payload?.items ?? []).map((i) => i.widthMm).join('/');
record('catalogue search "sofa"', (sofas.payload?.items?.length ?? 0) >= 3, `widths ${sofaSizes} mm`);

const tables = await call('GET', '/catalog/items?categorySlug=tables', { token });
record('banquet tables', (tables.payload?.items?.length ?? 0) >= 8, `${tables.payload?.items?.length} tables`);

/* ── Library ─────────────────────────────────────────────────────────── */
record('templates', (await call('GET', '/templates', { token })).ok);
record('collections', (await call('GET', '/collections', { token })).ok);

/* ── Billing ─────────────────────────────────────────────────────────── */
const sub = await call('GET', '/billing/subscription', { token });
record('subscription', Boolean(sub.payload?.planTier), `${sub.payload?.planTier}, ${sub.payload?.creditsRemaining} credits`);
record('credit history', (await call('GET', '/billing/credits/history', { token })).ok);
record('cancellation reasons', ((await call('GET', '/billing/cancellation-reasons', { token })).payload?.items?.length ?? 0) > 0);

/* ── AI ──────────────────────────────────────────────────────────────── */
const caps = await call('GET', '/ai/capabilities', { token });
const providers = Object.entries(caps.payload ?? {}).map(([k, v]) => `${k}:${v.provider}`).join(' ');
record('AI capabilities', Object.keys(caps.payload ?? {}).length === 3, providers);
record('AI job list', (await call('GET', '/ai/jobs', { token })).ok);

/* ── Uploads ─────────────────────────────────────────────────────────── */
const mapCaps = await call('GET', '/uploads/map/capabilities', { token });
record('map capabilities', mapCaps.ok, mapCaps.payload?.configured ? 'configured' : 'not configured (expected)');

/* ── Admin ───────────────────────────────────────────────────────────── */
const dash = await call('GET', '/admin/dashboard', { token });
record('admin dashboard', Boolean(dash.payload?.totalUsers), `${dash.payload?.totalUsers} users, ${dash.payload?.catalog?.approved} items`);
record('admin users', ((await call('GET', '/admin/users', { token })).payload?.items?.length ?? 0) > 0);
const review = await call('GET', '/admin/catalog/review?status=pending', { token });
record('admin review queue', (review.payload?.items?.length ?? 0) > 0, `${review.payload?.items?.length} held for review`);
record('admin companies', (await call('GET', '/admin/companies', { token })).ok);
record('admin AI jobs', (await call('GET', '/admin/jobs', { token })).ok);

/* ── Company ─────────────────────────────────────────────────────────── */
const studio = await call('POST', '/auth/login', {
  body: { email: 'studio@novira.test', password: 'novira123' },
});
const studioToken = studio.payload?.token;
if (studioToken) {
  const profile = await call('GET', '/company/profile', { token: studioToken });
  record('company profile', Boolean(profile.payload?.name), profile.payload?.name);
  const members = await call('GET', '/company/members', { token: studioToken });
  record('company members', (members.payload?.items?.length ?? 0) > 0, `${members.payload?.items?.length} members`);
  record('company credit usage', (await call('GET', '/company/credits/usage', { token: studioToken })).ok);

  // A non-admin must not reach the admin console.
  const forbidden = await call('GET', '/admin/dashboard', { token: studioToken, expect: 403 });
  record('admin blocked for non-admin', forbidden.status === 403);
}

/* ── Share ───────────────────────────────────────────────────────────── */
const share = await call('POST', '/plans/1/share', { token, body: { mode: 'view' } });
const shareToken = share.payload?.token;
if (shareToken) {
  const publicView = await call('GET', `/share/${shareToken}`);
  record('share link works without auth', Boolean(publicView.payload?.title), publicView.payload?.title);
  await call('DELETE', `/shares/${shareToken}`, { token });
  const revoked = await call('GET', `/share/${shareToken}`, { expect: 404 });
  record('revoked share is gone', revoked.status === 404);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} API checks passed.`);
process.exit(passed === results.length ? 0 : 1);
