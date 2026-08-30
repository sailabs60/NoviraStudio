/**
 * Real-time collaboration.
 *
 * Drives the WebSocket protocol directly with two clients, because that is
 * where the interesting behaviour is: presence, cursor and selection relay, the
 * staleness check, and — most importantly — that an unauthenticated or
 * unauthorised socket gets nothing.
 */
import WebSocket from 'ws';

const API = 'http://localhost:4100/api';
const WS = 'ws://localhost:4100/api/collaborate';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function login(email) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'novira123' }),
  });
  return (await r.json()).token;
}

/** A socket wrapper that queues messages so tests can await the next one. */
function client(token, planId) {
  const socket = new WebSocket(`${WS}?planId=${planId}&token=${encodeURIComponent(token)}`);
  const queue = [];
  const waiters = [];
  let closeInfo = null;

  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  socket.on('close', (code) => {
    closeInfo = { code };
    const waiter = waiters.shift();
    if (waiter) waiter({ type: 'closed', code });
  });

  return {
    socket,
    send: (message) => socket.send(JSON.stringify(message)),
    next: (timeoutMs = 4000) =>
      new Promise((resolve) => {
        if (queue.length) return resolve(queue.shift());
        const timer = setTimeout(() => resolve({ type: 'timeout' }), timeoutMs);
        waiters.push((m) => {
          clearTimeout(timer);
          resolve(m);
        });
      }),
    /** Wait for a specific message type, discarding others. */
    until: async (type, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const m = await new Promise((resolve) => {
          if (queue.length) return resolve(queue.shift());
          const remaining = Math.max(0, deadline - Date.now());
          const timer = setTimeout(() => resolve({ type: 'timeout' }), remaining);
          waiters.push((x) => {
            clearTimeout(timer);
            resolve(x);
          });
        });
        if (m.type === type || m.type === 'timeout' || m.type === 'closed') return m;
        if (Date.now() > deadline) return { type: 'timeout' };
      }
    },
    close: () => socket.close(),
    closeInfo: () => closeInfo,
  };
}

const token = await login('planner@novira.test');
const otherToken = await login('designer@novira.test');

/* A plan to collaborate on. */
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const project = await (
  await fetch(`${API}/projects`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ title: `Collab check ${Date.now().toString(36)}` }),
  })
).json();
const plan = await (
  await fetch(`${API}/plans`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ projectId: project.id, title: 'Shared layout' }),
  })
).json();

/* ── Authentication ──────────────────────────────────────────────────────── */

const anon = client('not-a-real-token', plan.id);
const anonFirst = await anon.next();
record('an invalid token is rejected',
  anonFirst.type === 'error' && anonFirst.code === 'UNAUTHENTICATED',
  `${anonFirst.type}${anonFirst.code ? ` ${anonFirst.code}` : ''}`);
anon.close();

/* Another planner has no access to this project's plan. */
const stranger = client(otherToken, plan.id);
const strangerFirst = await stranger.next();
record("a stranger cannot join someone else's plan",
  strangerFirst.type === 'error' && strangerFirst.code === 'FORBIDDEN',
  `${strangerFirst.type}${strangerFirst.code ? ` ${strangerFirst.code}` : ''}`);
stranger.close();

/* ── Two clients, same plan ──────────────────────────────────────────────── */

const a = client(token, plan.id);
const welcomeA = await a.until('welcome');
record('first client joins', welcomeA.type === 'welcome' && Boolean(welcomeA.connectionId),
  `version ${welcomeA.version}, ${welcomeA.participants?.length} present`);

const b = client(token, plan.id);
const welcomeB = await b.until('welcome');
record('second client joins and sees the first',
  welcomeB.participants?.length === 2,
  `${welcomeB.participants?.length} participants`);

const presenceA = await a.until('presence');
record('the first client is told someone arrived',
  presenceA.type === 'presence' && presenceA.participants?.length === 2,
  `${presenceA.participants?.length} present`);

record('participants are given distinct colours',
  new Set((welcomeB.participants ?? []).map((p) => p.colour)).size === 2,
  (welcomeB.participants ?? []).map((p) => p.colour).join(' '));

/* ── Cursors ─────────────────────────────────────────────────────────────── */

b.send({ type: 'cursor', cursor: { xMm: 1234, zMm: -5678 } });
const cursorA = await a.until('cursor');
record('cursors relay to the other client',
  cursorA.type === 'cursor' && cursorA.cursor?.xMm === 1234 && cursorA.cursor?.zMm === -5678,
  `${cursorA.cursor?.xMm},${cursorA.cursor?.zMm}`);

record('a cursor message names its sender',
  cursorA.connectionId === welcomeB.connectionId);

/* ── Selection ───────────────────────────────────────────────────────────── */

b.send({ type: 'selection', selection: ['table-7', 'chair-2'] });
const selectionA = await a.until('selection');
record('selection relays, so collisions are visible',
  selectionA.type === 'selection' && selectionA.selection?.length === 2,
  selectionA.selection?.join(', '));

/* ── Scene sync ──────────────────────────────────────────────────────────── */

const scene = { schemaVersion: 3, objects: [], units: 'metric' };
b.send({ type: 'scene', scene, version: welcomeB.version });

const sceneA = await a.until('scene');
record('a scene edit reaches the other client',
  sceneA.type === 'scene' && sceneA.version > welcomeB.version,
  `version ${welcomeB.version} → ${sceneA.version}`);
record('the edit is attributed', Boolean(sceneA.byName), sceneA.byName);

const accepted = await b.until('accepted');
record('the sender is told its edit was accepted',
  accepted.type === 'accepted' && accepted.version === sceneA.version,
  `version ${accepted.version}`);

/*
 * An edit built on a stale version must be refused rather than silently
 * overwriting newer work. This is the whole safety property of last-writer-wins.
 */
a.send({ type: 'scene', scene, version: 0 });
const stale = await a.until('stale');
record('an edit built on a stale version is refused',
  stale.type === 'stale' && stale.version === sceneA.version,
  `told to re-sync at version ${stale.version}`);

/* And the refused edit must not have been broadcast. */
const noEcho = await b.next(1200);
record('a refused edit is not broadcast to others',
  noEcho.type === 'timeout' || noEcho.type === 'pong',
  noEcho.type);

/* ── Keepalive ───────────────────────────────────────────────────────────── */

a.send({ type: 'ping' });
const pong = await a.until('pong', 3000);
record('keepalive works', pong.type === 'pong');

/* ── Leaving ─────────────────────────────────────────────────────────────── */

b.close();
const presenceAfter = await a.until('presence');
record('leaving updates presence for everyone else',
  presenceAfter.type === 'presence' && presenceAfter.participants?.length === 1,
  `${presenceAfter.participants?.length} left`);

a.close();
await new Promise((r) => setTimeout(r, 300));

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} collaboration checks passed.`);
process.exit(passed === results.length ? 0 : 1);
