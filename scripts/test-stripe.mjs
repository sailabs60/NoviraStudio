/**
 * Stripe integration checks.
 *
 * Runs a second API instance with Stripe credentials set, then drives the
 * webhook with correctly signed payloads built here. Signature verification is
 * pure HMAC over the raw body, so this exercises the real handler — the
 * idempotency guard, the credit grant, the tier application and the rejection
 * paths — without contacting Stripe.
 *
 * The dummy secret key is never used to make a request: the webhook path only
 * needs it to construct the client.
 */
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';

const PORT = 4101;
const BASE = `http://localhost:${PORT}/api`;
const WEBHOOK_SECRET = 'whsec_novira_test_secret';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ── Boot an API with Stripe configured ──────────────────────────────────── */
const api = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: 'apps/api',
  env: {
    ...process.env,
    PORT: String(PORT),
    STRIPE_SECRET_KEY: 'sk_test_dummy_key_for_local_verification',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  },
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const apiLog = [];
api.stdout.on('data', (d) => apiLog.push(String(d)));
api.stderr.on('data', (d) => apiLog.push(String(d)));

async function waitForApi() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

if (!(await waitForApi())) {
  console.error('API did not start:\n' + apiLog.join(''));
  api.kill();
  process.exit(1);
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
async function login(email) {
  const r = await (
    await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'novira123' }),
    })
  ).json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${r.token}` };
}

/** Build the Stripe-Signature header exactly as Stripe does. */
function sign(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

async function sendEvent(event, { secret = WEBHOOK_SECRET, header } = {}) {
  const payload = JSON.stringify(event);
  const res = await fetch(`${BASE}/billing/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(header === null ? {} : { 'Stripe-Signature': header ?? sign(payload, secret) }),
    },
    body: payload,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  return { status: res.status, body };
}

const H = await login('designer@novira.test');
const balance = async () =>
  (await (await fetch(`${BASE}/billing/subscription`, { headers: H })).json()).creditsRemaining;
const tierOf = async () =>
  (await (await fetch(`${BASE}/auth/me`, { headers: H })).json()).planTier;

/* ── Mode ────────────────────────────────────────────────────────────────── */
const mode = await (await fetch(`${BASE}/billing/mode`, { headers: H })).json();
record('mode reports stripe when configured', mode.mode === 'stripe', mode.mode);

/* ── Rejection paths ─────────────────────────────────────────────────────── */
const noSig = await sendEvent({ id: 'evt_nosig', type: 'checkout.session.completed' }, { header: null });
record('unsigned webhook rejected', noSig.status === 400, `status ${noSig.status}`);

const badSig = await sendEvent(
  { id: 'evt_badsig', type: 'checkout.session.completed' },
  { header: 't=1,v1=deadbeef' }
);
record('bad signature rejected', badSig.status === 400, `status ${badSig.status}`);

const wrongSecret = await sendEvent(
  { id: 'evt_wrongsecret', type: 'checkout.session.completed' },
  { secret: 'whsec_the_wrong_secret' }
);
record('signature from the wrong secret rejected', wrongSecret.status === 400, `status ${wrongSecret.status}`);

/* An old timestamp must fail Stripe's replay-window check. */
const stalePayload = JSON.stringify({ id: 'evt_stale', type: 'checkout.session.completed' });
const stale = await sendEvent(
  { id: 'evt_stale', type: 'checkout.session.completed' },
  { header: sign(stalePayload, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 86_400) }
);
record('stale timestamp rejected', stale.status === 400, `status ${stale.status}`);

/* ── Credit pack purchase ────────────────────────────────────────────────── */
const packs = (await (await fetch(`${BASE}/billing/pricing`)).json()).packs;
const pack = packs[0];
const me = await (await fetch(`${BASE}/auth/me`, { headers: H })).json();

const creditsBefore = await balance();
const packEventId = `evt_pack_${randomUUID()}`;
const packEvent = {
  id: packEventId,
  type: 'checkout.session.completed',
  data: {
    object: {
      id: `cs_test_${randomUUID()}`,
      object: 'checkout.session',
      mode: 'payment',
      payment_status: 'paid',
      customer: null,
      metadata: {
        kind: 'credit_pack',
        noviraUserId: String(me.id),
        noviraPackId: String(pack.id),
      },
    },
  },
};
const packRes = await sendEvent(packEvent);
await new Promise((r) => setTimeout(r, 600));
const creditsAfter = await balance();
record(
  'credit pack grants credits',
  packRes.status === 200 && creditsAfter === creditsBefore + pack.creditAmount,
  `${creditsBefore} → ${creditsAfter} (+${pack.creditAmount} expected)`
);

/* Replay: the same event id must be ignored. */
const replay = await sendEvent(packEvent);
await new Promise((r) => setTimeout(r, 600));
const creditsReplay = await balance();
record(
  'replayed event is ignored',
  replay.body?.duplicate === true && creditsReplay === creditsAfter,
  `duplicate=${replay.body?.duplicate}, balance still ${creditsReplay}`
);

/* ── Subscription upgrade ────────────────────────────────────────────────── */
const tierBefore = await tierOf();
const subEvent = {
  id: `evt_sub_${randomUUID()}`,
  type: 'checkout.session.completed',
  data: {
    object: {
      id: `cs_test_${randomUUID()}`,
      object: 'checkout.session',
      mode: 'subscription',
      payment_status: 'paid',
      customer: null,
      subscription: `sub_test_${randomUUID()}`,
      metadata: { kind: 'subscription', noviraUserId: String(me.id), noviraTier: 'pro' },
    },
  },
};
const subRes = await sendEvent(subEvent);
await new Promise((r) => setTimeout(r, 900));
const tierAfter = await tierOf();
record(
  'subscription checkout applies the tier',
  subRes.status === 200 && tierAfter === 'pro',
  `${tierBefore} → ${tierAfter}`
);

/* ── Cancellation drops back to free ─────────────────────────────────────── */
const cancelEvent = {
  id: `evt_cancel_${randomUUID()}`,
  type: 'customer.subscription.deleted',
  data: {
    object: {
      id: `sub_test_${randomUUID()}`,
      object: 'subscription',
      status: 'canceled',
      cancel_at_period_end: false,
      customer: null,
      metadata: { noviraUserId: String(me.id), noviraTier: 'pro' },
    },
  },
};
await sendEvent(cancelEvent);
await new Promise((r) => setTimeout(r, 900));
const tierCancelled = await tierOf();
record('cancelled subscription drops to free', tierCancelled === 'free', `now ${tierCancelled}`);

/* Credits bought are not clawed back when a subscription lapses. */
const creditsAfterCancel = await balance();
record(
  'purchased credits survive cancellation',
  creditsAfterCancel >= creditsAfter,
  `${creditsAfterCancel} credits remain`
);

/* An unpaid session must grant nothing. */
const unpaidBefore = await balance();
await sendEvent({
  id: `evt_unpaid_${randomUUID()}`,
  type: 'checkout.session.completed',
  data: {
    object: {
      id: `cs_test_${randomUUID()}`,
      object: 'checkout.session',
      mode: 'payment',
      payment_status: 'unpaid',
      customer: null,
      metadata: { kind: 'credit_pack', noviraUserId: String(me.id), noviraPackId: String(pack.id) },
    },
  },
});
await new Promise((r) => setTimeout(r, 600));
record('unpaid session grants nothing', (await balance()) === unpaidBefore, `${unpaidBefore} unchanged`);

/* ── Tidy up: put the account back where it started ──────────────────────── */

/*
 * The cancellation test genuinely drops this account to the free tier, which is
 * the behaviour being verified — but the account is shared with every other
 * suite, and leaving it there makes an unrelated venue-generation test fail
 * with a plan-upgrade notice several runs later. A suite that mutates a shared
 * fixture has to put it back.
 */
try {
  const admin = await login('planner@novira.test');
  await fetch(`${BASE}/admin/users/${me.id}`, {
    method: 'PATCH',
    headers: admin,
    body: JSON.stringify({ planTier: 'plus' }),
  });
  console.log('Restored designer@novira.test to the Plus tier.');
} catch (error) {
  console.warn('Could not restore the demo account:', error.message);
}

api.kill();
await new Promise((r) => setTimeout(r, 500));

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} Stripe checks passed.`);
if (passed !== results.length) console.log('\nAPI log tail:\n' + apiLog.join('').slice(-1500));
process.exit(passed === results.length ? 0 : 1);
