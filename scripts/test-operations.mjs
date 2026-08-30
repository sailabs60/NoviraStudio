/**
 * Guest list, seating, vendors, inventory and quoting.
 *
 * These five are one workflow, not five features: a guest list fills a layout,
 * the layout tells you what stock you need, and the stock prices the quote. So
 * the test follows that path end to end rather than exercising each endpoint in
 * isolation — the interesting failures are at the joins.
 */
const API = process.env.NOVIRA_API ?? 'http://localhost:4100/api';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

let token = '';
async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, body: payload };
}

const login = await call('POST', '/auth/login', {
  email: 'planner@novira.test',
  password: 'novira123',
});
token = login.body.token;
record('sign in', Boolean(token));

/* ── A project, a plan, and a layout with real tables ────────────────────── */

const project = (await call('POST', '/projects', { title: `Ops check ${Date.now().toString(36)}` })).body;
const plan = (await call('POST', '/plans', { projectId: project.id, title: 'Banquet' })).body;

const catalog = (await call('GET', '/catalog/items?categorySlug=tables&limit=20')).body;
const roundTable = catalog.items.find((i) => i.tableShape === 'round' && (i.seatsDefault ?? 0) > 0);
record('a seated round table exists in the catalogue', Boolean(roundTable),
  roundTable ? `${roundTable.name}, seats ${roundTable.seatsDefault}` : 'none found');

const chair = (await call('GET', '/catalog/items?categorySlug=chairs&limit=1')).body.items[0];

const scene = (await call('GET', `/plans/${plan.id}`)).body.scene;
const TABLES = 4;
scene.objects = [];
for (let i = 0; i < TABLES; i += 1) {
  scene.objects.push({
    id: `table-${i}`,
    type: 'catalog',
    name: `Table ${i + 1}`,
    catalogItemId: roundTable.id,
    modelUrl: roundTable.modelUrl,
    dimensionsMm: {
      width: roundTable.widthMm,
      depth: roundTable.depthMm,
      height: roundTable.heightMm,
    },
    // The cache the seating chart reads.
    seatsDefault: roundTable.seatsDefault,
    tableShape: roundTable.tableShape,
    positionMm: { x: (i % 2) * 4000 - 2000, y: 0, z: Math.floor(i / 2) * 4000 - 2000 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
}
// Some chairs, so the requirements report has more than one line.
for (let i = 0; i < 12; i += 1) {
  scene.objects.push({
    id: `chair-${i}`,
    type: 'catalog',
    name: chair.name,
    catalogItemId: chair.id,
    modelUrl: chair.modelUrl,
    dimensionsMm: { width: chair.widthMm, depth: chair.depthMm, height: chair.heightMm },
    positionMm: { x: i * 700 - 4000, y: 0, z: 5000 },
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
}
const savedScene = await call('PATCH', `/plans/${plan.id}`, { scene });
record('layout saved', savedScene.body?.objectCount === scene.objects.length,
  `${savedScene.body?.objectCount} objects`);

const seatsPerTable = roundTable.seatsDefault;
const totalSeats = TABLES * seatsPerTable;

/* ── Guests ──────────────────────────────────────────────────────────────── */

const families = [
  ['Okafor', 4],
  ['Lindqvist', 2],
  ['Moreau', 3],
  ['Tanaka', 5],
  ['Silva', 2],
];
const rows = [];
for (const [family, size] of families) {
  for (let i = 0; i < size; i += 1) {
    rows.push({
      firstName: `Guest${i + 1}`,
      lastName: family,
      partyName: `${family} family`,
      rsvp: 'yes',
      mealChoice: i % 2 === 0 ? 'Beef' : 'Vegetarian',
      ...(family === 'Moreau' && i === 0 ? { dietary: 'Severe nut allergy' } : {}),
      ...(family === 'Tanaka' && i === 0 ? { accessibility: 'Wheelchair user' } : {}),
    });
  }
}
// One decline, to prove the summary notices a declined guest holding a seat.
rows.push({ firstName: 'Absent', lastName: 'Friend', rsvp: 'no' });

const imported = await call('POST', `/projects/${project.id}/guests/import`, { rows });
record('bulk guest import', imported.body?.created === rows.length,
  `${imported.body?.created} created, ${imported.body?.rejected?.length ?? 0} rejected`);

const badImport = await call('POST', `/projects/${project.id}/guests/import`, {
  rows: [{ lastName: 'NoFirstName' }],
});
record('import reports bad rows rather than dropping them',
  badImport.body?.created === 0 && badImport.body?.rejected?.length === 1,
  badImport.body?.rejected?.[0]?.reason ?? '');

const guestList = await call('GET', `/projects/${project.id}/guests`);
record('guest list reads back', guestList.body?.items?.length === rows.length,
  `${guestList.body?.counts?.yes} attending, ${guestList.body?.counts?.no} declined`);

/* ── Seating ─────────────────────────────────────────────────────────────── */

const seatingBefore = await call('GET', `/plans/${plan.id}/seating`);
record('tables derived from the layout', seatingBefore.body?.tables?.length === TABLES,
  `${seatingBefore.body?.tables?.length} tables, ${seatingBefore.body?.summary?.totalSeats} seats`);

record('seat positions computed per table',
  (seatingBefore.body?.tables?.[0]?.seats?.length ?? 0) === seatsPerTable,
  `${seatingBefore.body?.tables?.[0]?.seats?.length} seats on table 1`);

const auto = await call('POST', `/plans/${plan.id}/seating/auto`, { keepExisting: false });
record('auto-seating fills the chart', (auto.body?.assigned ?? 0) > 0,
  `${auto.body?.assigned} seated of ${guestList.body.counts.yes} attending`);

const seatingAfter = await call('GET', `/plans/${plan.id}/seating`);

/*
 * Households must not be split. This is the rule the whole algorithm exists to
 * honour, so it is checked directly rather than trusted from the summary.
 */
const byGuest = new Map(seatingAfter.body.guests.map((g) => [g.id, g]));
const partyTables = new Map();
for (const a of seatingAfter.body.assignments) {
  const party = byGuest.get(a.guestId)?.partyName;
  if (!party) continue;
  if (!partyTables.has(party)) partyTables.set(party, new Set());
  partyTables.get(party).add(a.tableObjectId);
}
const split = [...partyTables.entries()].filter(([, t]) => t.size > 1);
record('households kept together', split.length === 0,
  split.length ? split.map(([p]) => p).join(', ') : `${partyTables.size} parties, none split`);

// No table may hold more than its chairs.
const perTable = new Map();
for (const a of seatingAfter.body.assignments) {
  perTable.set(a.tableObjectId, (perTable.get(a.tableObjectId) ?? 0) + 1);
}
const over = [...perTable.values()].filter((n) => n > seatsPerTable);
record('no table over capacity', over.length === 0,
  `max ${Math.max(...perTable.values())} of ${seatsPerTable} seats`);

// A declined guest must not be seated.
const declined = seatingAfter.body.guests.find((g) => g.rsvp === 'no');
const declinedSeated = seatingAfter.body.assignments.some((a) => a.guestId === declined.id);
record('declined guests are not seated', !declinedSeated);

/* Manual assignment, and displacing an occupant. */
const firstTable = seatingAfter.body.tables[0];
const someGuest = seatingAfter.body.guests.find((g) => g.rsvp === 'yes');
const assign = await call('PUT', `/plans/${plan.id}/seating/assign`, {
  guestId: someGuest.id,
  tableObjectId: firstTable.objectId,
  seatIndex: 0,
});
record('manual seat assignment', assign.body?.seatIndex === 0);

const otherGuest = seatingAfter.body.guests.find(
  (g) => g.rsvp === 'yes' && g.id !== someGuest.id
);
await call('PUT', `/plans/${plan.id}/seating/assign`, {
  guestId: otherGuest.id,
  tableObjectId: firstTable.objectId,
  seatIndex: 0,
});
const afterDisplace = await call('GET', `/plans/${plan.id}/seating`);
const displaced = afterDisplace.body.assignments.find((a) => a.guestId === someGuest.id);
record('seating onto a taken chair displaces rather than fails',
  displaced?.seatIndex === null && displaced?.tableObjectId === firstTable.objectId,
  `previous occupant now at seat ${displaced?.seatIndex}`);

const badSeat = await call('PUT', `/plans/${plan.id}/seating/assign`, {
  guestId: someGuest.id,
  tableObjectId: firstTable.objectId,
  seatIndex: 59,
});
record('a seat that does not exist is rejected', badSeat.status === 400);

/* Catering sheet. */
const catering = await call('GET', `/plans/${plan.id}/seating/catering`);
const mealTotal = Object.values(catering.body?.totals ?? {}).reduce((a, b) => a + b, 0);
record('catering sheet counts meals', mealTotal > 0,
  Object.entries(catering.body?.totals ?? {}).map(([k, v]) => `${k} ${v}`).join(', '));
record('dietary requirements listed by name',
  (catering.body?.dietary ?? []).some((d) => /nut allergy/i.test(d.dietary ?? '')),
  `${catering.body?.dietary?.length ?? 0} entries`);

/* ── Vendors and inventory ───────────────────────────────────────────────── */

const vendor = await call('POST', '/vendors', {
  name: 'Ashgrove Furniture Hire',
  category: 'Furniture hire',
  email: 'hire@example.com',
  rating: 4,
  leadTimeDays: 7,
});
record('vendor created', vendor.status === 201);

// Own fewer tables than the layout needs, so a shortfall is real.
const stock = await call('POST', '/inventory', {
  name: roundTable.name,
  catalogItemId: roundTable.id,
  vendorId: vendor.body.id,
  quantityOwned: TABLES - 2,
  unitCost: 12000,
  rentalRate: 3500,
  currency: 'usd',
});
record('inventory item linked to a catalogue model', stock.status === 201);

const vendorList = await call('GET', '/vendors');
record('vendor list', (vendorList.body?.items?.length ?? 0) > 0,
  `${vendorList.body?.items?.length} vendors, categories: ${vendorList.body?.categories?.join('/')}`);

const requirements = await call('GET', `/plans/${plan.id}/requirements`);
const tableLine = requirements.body?.lines?.find((l) => l.catalogItemId === roundTable.id);
record('layout requirements computed from the scene',
  tableLine?.required === TABLES && tableLine?.owned === TABLES - 2 && tableLine?.shortfall === 2,
  `need ${tableLine?.required}, own ${tableLine?.owned}, short ${tableLine?.shortfall}`);
record('hire cost priced from the shortfall',
  requirements.body?.totalHireCost === 2 * 3500,
  `$${((requirements.body?.totalHireCost ?? 0) / 100).toFixed(2)}`);

const untracked = requirements.body?.lines?.find((l) => l.catalogItemId === chair.id);
record('untracked items still appear in requirements',
  untracked && untracked.tracked === false,
  `${untracked?.name}: ${untracked?.required} needed, no stock record`);

/* ── Proposal ────────────────────────────────────────────────────────────── */

const proposal = await call('POST', `/projects/${project.id}/proposals`, {
  title: 'Banquet proposal',
  planId: plan.id,
  clientName: 'A. Client',
  currency: 'usd',
  taxRateBp: 2000,
  discountBp: 1000,
  depositBp: 5000,
});
record('proposal created with a reference', /^Q\d{4}-\d{4}$/.test(proposal.body?.number ?? ''),
  proposal.body?.number);

const generated = await call('POST', `/proposals/${proposal.body.id}/generate-from-plan`, {});
record('quote generated from the layout', (generated.body?.generated ?? 0) >= 2,
  `${generated.body?.generated} lines, ${generated.body?.unpriced} unpriced`);

const tableQuoteLine = generated.body?.proposal?.lines?.find(
  (l) => l.catalogItemId === roundTable.id
);
record('generated line quantity matches the layout',
  tableQuoteLine?.quantityMilli === TABLES * 1000,
  `${(tableQuoteLine?.quantityMilli ?? 0) / 1000} × ${roundTable.name}`);

// Hand-written lines must survive a regenerate.
await call('POST', `/proposals/${proposal.body.id}/lines`, {
  kind: 'labour',
  description: 'Install and strike',
  quantityMilli: 1500,
  unitLabel: 'days',
  unitPrice: 45000,
});
const regenerated = await call('POST', `/proposals/${proposal.body.id}/generate-from-plan`, {});
const labourKept = regenerated.body?.proposal?.lines?.some((l) => l.kind === 'labour');
record('hand-written lines survive a regenerate', Boolean(labourKept));

/* The arithmetic. Discount before tax, rounded per line. */
const full = (await call('GET', `/proposals/${proposal.body.id}`)).body;
const expectedSubtotal = full.lines.reduce(
  (sum, l) => sum + Math.round((l.quantityMilli * l.unitPrice) / 1000),
  0
);
record('subtotal is the sum of rounded lines', full.totals.subtotal === expectedSubtotal,
  `${full.totals.subtotal} vs ${expectedSubtotal}`);

const expectedDiscount = Math.round((expectedSubtotal * 1000) / 10000);
record('discount applied before tax', full.totals.discount === expectedDiscount,
  `discount ${full.totals.discount}, net ${full.totals.net}`);

const expectedTax = Math.round((full.totals.taxableNet * 2000) / 10000);
record('tax charged on the discounted net', full.totals.tax === expectedTax,
  `tax ${full.totals.tax} on ${full.totals.taxableNet}`);

record('total and balance are consistent',
  full.totals.total === full.totals.net + full.totals.tax &&
    full.totals.balance === full.totals.total - full.totals.deposit,
  `total ${full.totals.total}, deposit ${full.totals.deposit}, balance ${full.totals.balance}`);

/* ── Client-facing link ──────────────────────────────────────────────────── */

const share = await call('POST', `/proposals/${proposal.body.id}/share`);
const shareToken = share.body?.token;
record('proposal share link issued', Boolean(shareToken));

const publicView = await fetch(`${API}/proposal/${shareToken}`).then((r) => r.json());
record('client can read the proposal without an account',
  publicView?.number === full.number && Array.isArray(publicView.lines),
  `${publicView?.lines?.length} lines`);

// Internal cost must not leak to the client.
const leaked = JSON.stringify(publicView).match(/inventoryId|unitCost|catalogItemId/);
record('internal costing is absent from the client view', leaked === null,
  leaked ? `leaked ${leaked[0]}` : 'clean');

const accept = await fetch(`${API}/proposal/${shareToken}/respond`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ decision: 'accepted' }),
}).then((r) => r.json());
record('client can accept', accept?.status === 'accepted');

const twice = await fetch(`${API}/proposal/${shareToken}/respond`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ decision: 'declined' }),
});
record('a decision cannot be reversed by the client', twice.status === 409, `status ${twice.status}`);

await call('DELETE', `/proposals/${proposal.body.id}/share`);
const revoked = await fetch(`${API}/proposal/${shareToken}`);
record('revoked link stops working', revoked.status === 404, `status ${revoked.status}`);

/* ── Isolation ───────────────────────────────────────────────────────────── */

const other = await call('POST', '/auth/login', {
  email: 'designer@novira.test',
  password: 'novira123',
});
const mine = token;
token = other.body.token;
const forbidden = await call('GET', `/projects/${project.id}/guests`);
record("another planner cannot read this event's guest list",
  forbidden.status === 403 || forbidden.status === 404, `status ${forbidden.status}`);
token = mine;

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} operations checks passed.`);
process.exit(passed === results.length ? 0 : 1);
