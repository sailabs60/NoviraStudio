/**
 * End-to-end check of the spatial platform layer.
 *
 * Real HTTP against the running API, real MySQL behind it. Every assertion is
 * about behaviour a user would notice, not about a status code: that the
 * take-off actually measures the truss that was placed, that a rate card
 * changes the price, that an internal note never reaches a share link.
 *
 * Run with the dev servers up:  node scripts/test-spatial.mjs
 */
const BASE = process.env.API_BASE ?? 'http://localhost:4100/api';
const EMAIL = process.env.DEMO_EMAIL ?? 'planner@novira.test';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'novira123';

let token = '';
let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(method, path, body, opts = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.anonymous ? {} : token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 400) };
  }
  return { status: response.status, data };
}

/* ── Scene fixture ─────────────────────────────────────────────────────── */

/**
 * A scene with one of everything measurable, at sizes chosen so the expected
 * quantities are obvious by hand: a 4×2 stage, a 12 m truss run, a 20×11
 * cabinet screen, one 6×3 m stand.
 */
function fixtureScene() {
  return {
    schemaVersion: 2,
    units: 'metric',
    regionCode: 'uk-eu',
    rateCardId: null,
    objects: [
      {
        id: 'stage-1',
        type: 'stage',
        name: 'Main stage',
        positionMm: { x: 0, y: 0, z: -8000 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        deckRows: 2,
        deckColumns: 4,
        deckHeightMm: 600,
        stairSides: ['south'],
        stairBays: { south: 1 },
        skirtSides: ['north', 'east', 'south', 'west'],
        guardrailSides: ['north'],
      },
      {
        id: 'truss-1',
        type: 'truss',
        name: 'Goalpost',
        positionMm: { x: 0, y: 0, z: -8000 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        systemKey: 'f34-square',
        shape: 'straight',
        points: [
          { xMm: -6000, zMm: 0 },
          { xMm: 6000, zMm: 0 },
        ],
        closed: false,
        trimHeightMm: 5000,
        legType: 'base-plate',
        hangingLoadKg: 120,
        color: '#c2c7ce',
        showBracing: true,
      },
      {
        id: 'led-1',
        type: 'led',
        name: 'Main screen',
        positionMm: { x: 0, y: 0, z: -9500 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        panelKey: 'p3-9-indoor',
        columns: 20,
        rows: 11,
        bottomMm: 1000,
        frame: 'ground-support',
        curveDeg: 0,
        contentUrl: null,
        contentColor: '#0b1220',
        glowIntensity: 0.6,
        brightness: 0.8,
      },
      {
        id: 'booth-1',
        type: 'booth',
        name: 'A1',
        positionMm: { x: 8000, y: 0, z: 4000 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        boothType: 'inline',
        widthMm: 6000,
        depthMm: 3000,
        heightMm: 2500,
        walls: ['back', 'left', 'right'],
        wallFinish: 'fabric',
        wallColor: '#e6e3dc',
        floorFinish: 'carpet',
        floorColor: '#4b5563',
        platformHeightMm: 0,
        fascia: false,
        fasciaHeightMm: 300,
        fasciaText: '',
        fasciaColor: '#1f2937',
        storeRoom: false,
        counter: true,
        standNumber: 'A1',
      },
      {
        id: 'light-1',
        type: 'light',
        name: 'Key',
        positionMm: { x: -2500, y: 5000, z: -3000 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        fixture: 'profile-spot',
        role: 'key',
        color: '#fff4e2',
        intensity: 1,
        beamAngleDeg: 26,
        softness: 0.15,
        targetMm: { x: 0, y: 2000, z: -8000 },
        gobo: 'none',
        goboRotationDeg: 0,
        volumetric: true,
        castShadow: true,
        channel: 'KEY',
      },
      {
        id: 'exit-1',
        type: 'constraint',
        name: 'Fire exit',
        locked: true,
        positionMm: { x: -12000, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        constraintKind: 'exit',
        label: 'Fire exit west',
        clearWidthMm: 1800,
        color: '#ef4444',
        showVolume: true,
        points: [
          { xMm: -1500, zMm: -1500 },
          { xMm: 1500, zMm: -1500 },
          { xMm: 1500, zMm: 1500 },
          { xMm: -1500, zMm: 1500 },
        ],
      },
    ],
    tableGroups: [],
    walls: {
      segments: [],
      floors: [
        {
          id: 'floor-1',
          points: [
            { xMm: -15000, zMm: -12000 },
            { xMm: 15000, zMm: -12000 },
            { xMm: 15000, zMm: 12000 },
            { xMm: -15000, zMm: 12000 },
          ],
          color: '#3f3f46',
        },
      ],
    },
    lighting: {
      preset: 'venice_sunset',
      position: { x: 5, y: 10, z: 5 },
      heightZ: 10,
      shadowsEnabled: true,
      glowEnabled: false,
      intensity: 1,
    },
    camera: { mode: 'perspective', positionMm: { x: 8000, y: 6000, z: 8000 }, targetMm: { x: 0, y: 0, z: 0 }, fov: 50, path: [], pathSpeed: 1 },
    gridSizeMm: 500,
    showGrid: true,
    snapToGrid: false,
    rotationSnapDeg: 10,
    render: { look: 'corporate-summit', exposure: 1, bloom: 0.35, haze: 0.1, contactShadows: true, exportWidth: 3840, exportHeight: 2160, backdrop: 'environment', backdropColor: '#0b1220' },
    walkthrough: { shots: [], flySpeed: 2.5, eyeHeightMm: 1650, loop: true, music: 'none', aspect: 'landscape' },
    collisionCheck: false,
    showConstraints: true,
  };
}

/* ── The run ───────────────────────────────────────────────────────────── */

async function main() {
  console.log('\nNovira — spatial platform end-to-end\n');

  /* ── Auth ────────────────────────────────────────────────────────── */
  console.log('Authentication');
  const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD }, { anonymous: true });
  check('signs in as the demo planner', login.status === 200 && Boolean(login.data?.token), `status ${login.status}`);
  if (!login.data?.token) {
    console.log('\nCannot continue without a session. Run: npm run seed:demo --workspace=apps/api\n');
    process.exit(1);
  }
  token = login.data.token;

  /* ── Fixture ─────────────────────────────────────────────────────── */
  console.log('\nFixture');
  const project = await call('POST', '/projects', { title: `Spatial test ${Date.now()}` });
  check('creates a project', project.status === 201, `status ${project.status}`);
  const projectId = project.data?.id;

  const plan = await call('POST', '/plans', { projectId, title: 'Measured layout' });
  check('creates a plan', plan.status === 201, `status ${plan.status}`);
  const planId = plan.data?.id;

  const saved = await call('PATCH', `/plans/${planId}`, { scene: fixtureScene() });
  check('saves a scene with the new object types', saved.status === 200, `status ${saved.status}`);

  const reloaded = await call('GET', `/plans/${planId}`);
  const objectTypes = new Set((reloaded.data?.scene?.objects ?? []).map((o) => o.type));
  check('truss survives the round trip', objectTypes.has('truss'));
  check('LED survives the round trip', objectTypes.has('led'));
  check('booth survives the round trip', objectTypes.has('booth'));
  check('light survives the round trip', objectTypes.has('light'));
  check('constraint survives the round trip', objectTypes.has('constraint'));
  check('schema is migrated to version 3', reloaded.data?.scene?.schemaVersion === 3);
  check('region is preserved', reloaded.data?.scene?.regionCode === 'uk-eu');

  /* ── Take-off ────────────────────────────────────────────────────── */
  console.log('\nQuantity take-off');
  const takeoff = await call('GET', `/plans/${planId}/takeoff`);
  check('measures the plan', takeoff.status === 200, `status ${takeoff.status}`);
  const summary = takeoff.data?.summary ?? {};

  // 20 columns x 11 rows of 500 x 500 mm = 10 m x 5.5 m = 55 m².
  check('LED area is 55 m²', Math.abs(summary.ledSqM - 55) < 0.01, `got ${summary.ledSqM}`);
  // 12 m header + two 4.71 m legs (5 m trim less the 290 mm section) is measured
  // as the run only; the legs are a separate BOM line.
  check('truss run is 12 m', Math.abs(summary.trussLengthM - 12) < 0.01, `got ${summary.trussLengthM}`);
  // 30 x 24 m floor = 720 m², less the 4.876 x 2.438 m stage and the 18 m² stand.
  check('carpet excludes the stage and the stand', summary.carpetSqM > 680 && summary.carpetSqM < 700, `got ${summary.carpetSqM}`);
  check('print area counts the fabric stand walls', summary.printSqM > 25 && summary.printSqM < 35, `got ${summary.printSqM}`);
  check('labour hours are derived', summary.labourHours > 0, `got ${summary.labourHours}`);
  check('one stand counted', summary.boothCount === 1, `got ${summary.boothCount}`);
  check('one fixture counted', summary.fixtureCount === 1, `got ${summary.fixtureCount}`);
  check('power is derived from the fixture', summary.powerKw > 0, `got ${summary.powerKw}`);

  const trussLine = (takeoff.data?.lines ?? []).find((l) => l.code === 'TRUSS-f34-square');
  check('every line carries its basis', Boolean(trussLine?.basis), trussLine?.basis ?? 'no truss line');
  check('a line points back at the object it measured', trussLine?.objectIds?.includes('truss-1'));

  /* ── Pricing ─────────────────────────────────────────────────────── */
  console.log('\nPricing');
  const estimate = await call('GET', `/plans/${planId}/estimate`);
  check('prices the plan without a rate card', estimate.status === 200 && estimate.data?.priced?.subtotal > 0, `status ${estimate.status}`);
  const defaultTotal = estimate.data?.priced?.subtotal ?? 0;
  check('falls back to the built-in card', estimate.data?.card?.id === null);
  check('applies the regional cost index', estimate.data?.card?.adjustmentBp === 2000, `got ${estimate.data?.card?.adjustmentBp}`);

  const card = await call('POST', '/rate-cards/from-defaults', { regionCode: 'kenya', name: 'Test Kenya rates' });
  check('creates a rate card from the defaults', card.status === 201, `status ${card.status}`);
  const cardId = card.data?.id;

  const priced = await call('GET', `/plans/${planId}/estimate?rateCardId=${cardId}`);
  check('a different card gives a different total', priced.data?.priced?.subtotal !== defaultTotal, `${priced.data?.priced?.subtotal} vs ${defaultTotal}`);
  check('the Kenya card is cheaper than the UK default', priced.data?.priced?.subtotal < defaultTotal);
  check('margin is reported when costs are known', priced.data?.priced?.marginBp !== null);

  const boq = await fetch(`${BASE}/plans/${planId}/export/boq?format=json&prices=true&rateCardId=${cardId}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  check('exports a bill of quantities', Array.isArray(boq?.lines) && boq.lines.length > 0);

  /* ── Design checks ───────────────────────────────────────────────── */
  console.log('\nDesign checks');
  const review = await call('GET', `/plans/${planId}/review`);
  check('runs the layout checks', review.status === 200, `status ${review.status}`);
  check('produces a score', typeof review.data?.advisor?.score === 'number');
  check('reports rigging demand against capacity', typeof review.data?.constraints?.riggingUsedKg === 'number');
  check('warns that power has no supply marked', review.data?.constraints?.findings?.some((f) => f.constraintKind === 'power'));

  /* ── Drawings and CAD ────────────────────────────────────────────── */
  console.log('\nDrawings and CAD');
  const drawing = await call('GET', `/plans/${planId}/drawing`);
  check('builds a plan drawing', drawing.status === 200 && drawing.data?.shapes?.length > 0, `status ${drawing.status}`);
  check('the drawing has layers', (drawing.data?.legend ?? []).length > 0);
  check('the drawing states its scale', (drawing.data?.facts ?? []).some((f) => f.label === 'Scale'));

  const dxf = await fetch(`${BASE}/plans/${planId}/export/dxf`, { headers: { Authorization: `Bearer ${token}` } });
  const dxfText = await dxf.text();
  check('exports DXF', dxf.status === 200 && dxfText.includes('SECTION'), `status ${dxf.status}`);
  check('DXF declares millimetres', dxfText.includes('$INSUNITS'));
  check('DXF carries the Novira layers', dxfText.includes('NZ-TRUSS') && dxfText.includes('NZ-LED'));
  check('DXF ends properly', dxfText.trimEnd().endsWith('EOF'));

  const materials = await call('GET', `/plans/${planId}/export/materials`);
  check('produces a material breakdown', materials.status === 200 && (materials.data?.materials ?? []).length > 0);
  check('estimates truck loads', materials.data?.truckLoads >= 1);

  /* ── Deck ────────────────────────────────────────────────────────── */
  console.log('\nClient deck');
  const deck = await call('POST', `/plans/${planId}/export/deck`, { clientName: 'Test Client', venueName: 'Test Hall' });
  check('generates a deck', deck.status === 200 && (deck.data?.slides ?? []).length > 0, `status ${deck.status}`);
  const kinds = new Set((deck.data?.slides ?? []).map((s) => s.kind));
  check('the deck has a cover', kinds.has('cover'));
  check('the deck has a bill of quantities', kinds.has('quantities'));
  check('the deck has commercials', kinds.has('commercials'));
  check('the deck has a compliance page', kinds.has('compliance'));

  /* ── Versions and comparison ─────────────────────────────────────── */
  console.log('\nVersions and comparison');
  const version = await call('POST', `/plans/${planId}/versions`, { label: 'Option A', reason: 'milestone' });
  check('saves a version', version.status === 201, `status ${version.status}`);
  const versionId = version.data?.id;

  const modified = fixtureScene();
  modified.objects = modified.objects.filter((o) => o.id !== 'booth-1');
  modified.objects[0].positionMm.x = 3000;
  await call('PATCH', `/plans/${planId}`, { scene: modified });

  const compare = await call('GET', `/plans/${planId}/compare?from=${versionId}&to=current`);
  check('compares a version against the current plan', compare.status === 200, `status ${compare.status}`);
  check('sees the removed stand', compare.data?.comparison?.counts?.removed === 1, `got ${compare.data?.comparison?.counts?.removed}`);
  check('sees the moved stage', compare.data?.comparison?.counts?.moved === 1, `got ${compare.data?.comparison?.counts?.moved}`);
  check('summarises in plain English', typeof compare.data?.summary === 'string' && compare.data.summary.includes('removed'));

  const restore = await call('POST', `/plans/${planId}/versions/${versionId}/restore`);
  check('restores a version', restore.status === 200 && restore.data?.scene?.objects?.length === 6, `got ${restore.data?.scene?.objects?.length}`);

  const versionsAfter = await call('GET', `/plans/${planId}/versions`);
  check('restoring snapshots the current layout first', (versionsAfter.data?.items ?? []).some((v) => v.reason === 'before_restore'));

  /* ── Comments, and the internal/client boundary ──────────────────── */
  console.log('\nComments');
  const anchor = {
    positionMm: { x: 0, y: 0, z: -8000 },
    objectId: 'stage-1',
    cameraPositionMm: { x: 8000, y: 6000, z: 8000 },
    cameraTargetMm: { x: 0, y: 0, z: 0 },
  };
  const clientComment = await call('POST', `/plans/${planId}/comments`, { body: 'Client-visible note', visibility: 'everyone', anchor });
  check('posts a client-visible comment', clientComment.status === 201, `status ${clientComment.status}`);
  const internal = await call('POST', `/plans/${planId}/comments`, { body: 'Internal only — margin is thin', visibility: 'internal', anchor });
  check('posts an internal note', internal.status === 201, `status ${internal.status}`);

  const share = await call('POST', `/plans/${planId}/share`, { mode: 'view' });
  check('creates a share link', share.status === 200 && Boolean(share.data?.token), `status ${share.status}`);
  const shareToken = share.data?.token;

  const publicComments = await call('GET', `/share/${shareToken}/comments`, null, { anonymous: true });
  check('a client can read the shared comments', publicComments.status === 200, `status ${publicComments.status}`);
  const bodies = (publicComments.data?.items ?? []).map((c) => c.body);
  check('the client-visible comment reaches the share link', bodies.includes('Client-visible note'));
  check('the internal note NEVER reaches the share link', !bodies.some((b) => b.includes('Internal only')));

  const clientPost = await call(
    'POST',
    `/share/${shareToken}/comments`,
    { body: 'Can the bar move?', authorName: 'A Client', anchor },
    { anonymous: true }
  );
  check('a client can comment without an account', clientPost.status === 201, `status ${clientPost.status}`);
  check('the client comment is flagged as such', clientPost.data?.authorIsClient === true);

  const planner = await call('GET', `/plans/${planId}/comments`);
  check('the planner sees the client comment', (planner.data?.items ?? []).some((c) => c.body === 'Can the bar move?'));
  check('the planner still sees their internal note', (planner.data?.items ?? []).some((c) => c.visibility === 'internal'));

  const resolved = await call('POST', `/comments/${clientPost.data.id}/resolve`, { resolved: true });
  check('a comment can be resolved', resolved.data?.status === 'resolved');

  /* ── Venue intelligence ──────────────────────────────────────────── */
  console.log('\nVenue library');
  const venue = await call('POST', '/venue-specs', {
    name: 'Test Ballroom',
    buildingName: 'Test Centre',
    spaceType: 'ballroom',
    city: 'Nairobi',
    country: 'KE',
    widthMm: 24000,
    depthMm: 16000,
    structure: {
      clearHeightMm: 5200,
      maxHeightMm: 6500,
      riggingAllowed: true,
      totalRiggingCapacityKg: 1500,
      floorLoadKgSqM: 500,
      pointLoadKg: 1200,
      columns: [{ xMm: -4000, zMm: 0, widthMm: 500, depthMm: 500 }],
      levelFloor: true,
      floorSurface: 'carpet',
      fixingsAllowed: false,
    },
    access: {
      vehicle: 'rigid',
      doorWidthMm: 2400,
      doorHeightMm: 3000,
      dockLevel: false,
      pushDistanceMm: 80000,
      liftWidthMm: null,
      liftDepthMm: null,
      liftHeightMm: null,
      liftCapacityKg: null,
      stepFree: true,
      notes: '',
    },
    services: {
      powerAmps: 100,
      powerPhases: 3,
      powerVoltage: 415,
      powerPoints: [{ xMm: -10000, zMm: -6000, amps: 63, phases: 3, label: 'Stage left 63 A' }],
      generatorAccess: true,
      waterAvailable: false,
      wifiBandwidthMbps: null,
      dimmableHouseLights: true,
      hazeAllowed: true,
      soundLimitDb: null,
    },
    rules: {
      buildCurfew: '23:00',
      buildFrom: '07:00',
      exclusiveSuppliers: ['Catering'],
      externalSupplierFee: true,
      flameAllowed: false,
      confettiAllowed: false,
      notes: [],
    },
    sourceNote: 'Test fixture',
  });
  check('records a venue', venue.status === 201, `status ${venue.status}`);
  check('derives a capacity table', venue.data?.capacity?.banquet > 0, `got ${venue.data?.capacity?.banquet}`);
  check('the derived capacity is realistic, not the brochure figure', venue.data?.capacity?.banquet < 250, `got ${venue.data?.capacity?.banquet}`);
  const venueId = venue.data?.id;

  const withWarnings = await call('GET', `/venue-specs/${venueId}`);
  check('warns about no fixings', (withWarnings.data?.warnings ?? []).some((w) => w.includes('fixings')));
  check('warns about the long push distance', (withWarnings.data?.warnings ?? []).some((w) => w.includes('80 m from the truck')));
  check('warns that the figures are unverified', (withWarnings.data?.warnings ?? []).some((w) => w.includes('not been verified')));

  const applied = await call('POST', `/venue-specs/${venueId}/apply-to-plan`, { planId });
  check('applies the venue to a plan', applied.status === 200 && applied.data?.applied > 0, `status ${applied.status}`);
  check('the plan adopts the venue region', applied.data?.scene?.regionCode === 'kenya');
  const appliedConstraints = (applied.data?.scene?.objects ?? []).filter((o) => o.type === 'constraint');
  check('brings in the height limit', appliedConstraints.some((c) => c.constraintKind === 'height-limit'));
  check('brings in the column as a no-build area', appliedConstraints.some((c) => c.constraintKind === 'no-build'));
  check('brings in the power point', appliedConstraints.some((c) => c.constraintKind === 'power'));
  check('brings in the truck route', appliedConstraints.some((c) => c.constraintKind === 'truck-access'));
  check('keeps the hand-drawn fire exit', appliedConstraints.some((c) => c.id === 'exit-1'));
  check('venue constraints are locked', appliedConstraints.filter((c) => c.id.startsWith('venue-')).every((c) => c.locked));

  const afterVenue = await call('GET', `/plans/${planId}/review`);
  check('power demand is now checked against a real supply', afterVenue.data?.constraints?.supplyAmps > 0, `got ${afterVenue.data?.constraints?.supplyAmps}`);

  /* ── AI capabilities ─────────────────────────────────────────────── */
  console.log('\nAI');
  const capabilities = await call('GET', '/ai/spatial/capabilities');
  check('reports the spatial capabilities', capabilities.status === 200, `status ${capabilities.status}`);
  check('the concept generator is never blocked for want of a provider', capabilities.data?.ai_concept?.allowed !== false || capabilities.data?.ai_concept?.reason?.includes('credit'));
  check('video presets are offered', (capabilities.data?.videoPresets ?? []).length > 0);

  const conceptPreview = await call('POST', '/ai/concept/preview', {
    prompt: 'Modern banking summit stage with a curved LED wall for 400 delegates',
  });
  check('previews a concept for free', conceptPreview.status === 200, `status ${conceptPreview.status}`);
  check('reads the attendance', conceptPreview.data?.brief?.attendance === 400, `got ${conceptPreview.data?.brief?.attendance}`);
  check('reads the curved screen', conceptPreview.data?.brief?.screen === 'curved', `got ${conceptPreview.data?.brief?.screen}`);
  check('reads the corporate look', conceptPreview.data?.brief?.look === 'corporate-summit', `got ${conceptPreview.data?.brief?.look}`);
  check('places a stage', (conceptPreview.data?.elements ?? []).some((e) => e.kind === 'stage'));
  check('places a screen', (conceptPreview.data?.elements ?? []).some((e) => e.kind === 'screen'));
  check('every element explains itself', (conceptPreview.data?.elements ?? []).every((e) => e.rationale?.length > 10));
  check('offers camera angles', (conceptPreview.data?.cameras ?? []).length >= 3);
  check('derives a room big enough', conceptPreview.data?.roomWidthMm > 10000 && conceptPreview.data?.roomDepthMm > 10000);

  const exhibitionPreview = await call('POST', '/ai/concept/preview', {
    prompt: 'Exhibition floor with 48 stands and a registration desk',
  });
  check('reads a stand count', exhibitionPreview.data?.brief?.boothCount === 48, `got ${exhibitionPreview.data?.brief?.boothCount}`);
  check('lays out a booth grid', (exhibitionPreview.data?.elements ?? []).some((e) => e.kind === 'booth-grid'));
  check('adds registration where asked', (exhibitionPreview.data?.elements ?? []).some((e) => e.kind === 'registration'));

  /* ── Regions ─────────────────────────────────────────────────────── */
  console.log('\nRegional packs');
  const regions = await call('GET', '/regions');
  check('lists the regional packs', (regions.data?.items ?? []).length >= 6, `got ${(regions.data?.items ?? []).length}`);
  const na = (regions.data?.items ?? []).find((r) => r.code === 'north-america');
  check('North America is imperial', na?.units === 'imperial');
  check('North America uses a 10 ft booth module', na?.boothModuleMm?.width === 3048, `got ${na?.boothModuleMm?.width}`);
  check('North America is 120 V', na?.voltage === 120);
  const kenya = (regions.data?.items ?? []).find((r) => r.code === 'kenya');
  check('Kenya is 240 V', kenya?.voltage === 240);
  check('Kenya names its authority', Boolean(kenya?.regulations?.authority));

  /* ── Marketplace and specialists ─────────────────────────────────── */
  console.log('\nMarketplace and specialists');
  const listing = await call('POST', '/marketplace/listings', {
    kind: 'plan-template',
    title: 'Test summit layout',
    summary: 'A test listing',
    description: 'Created by the end-to-end check.',
    price: 5000,
    currency: 'usd',
    sourcePlanId: planId,
  });
  check('creates a listing as a draft', listing.status === 201 && listing.data?.status === 'draft', `status ${listing.status}`);
  check('shows the seller their net before publishing', listing.data?.breakdown?.net === 4000, `got ${listing.data?.breakdown?.net}`);

  const mine = await call('GET', '/marketplace/my-listings');
  check('lists the seller their own listings', (mine.data?.items ?? []).some((l) => l.id === listing.data.id));

  const browse = await call('GET', '/marketplace/listings');
  check('a draft is not public', !(browse.data?.items ?? []).some((l) => l.id === listing.data.id));

  const specialist = await call('PUT', '/specialists/me', {
    name: 'Test Specialist',
    headline: 'Stand design',
    bio: 'Created by the end-to-end check.',
    skills: ['stand-design', 'technical-drawing'],
    dayRate: 45000,
    currency: 'usd',
    regionCode: 'uk-eu',
    remote: true,
    availability: 'available',
  });
  check('publishes a specialist profile', specialist.status === 200, `status ${specialist.status}`);

  const directory = await call('GET', '/specialists?skill=stand-design');
  check('the profile appears in the directory', (directory.data?.items ?? []).some((s) => s.name === 'Test Specialist'));

  /* ── Insights ────────────────────────────────────────────────────── */
  console.log('\nInsights');
  const insights = await call('GET', '/insights?days=365');
  check('reports insights', insights.status === 200, `status ${insights.status}`);
  check('counts the plans', insights.data?.summary?.totalPlans > 0);
  check('estimates hours saved', insights.data?.summary?.hoursSaved > 0, `got ${insights.data?.summary?.hoursSaved}`);
  check('refuses a conversion rate below the sample floor', insights.data?.summary?.conversionBp === null || insights.data?.summary?.proposalsSent >= 3);
  check('states the sample floor', insights.data?.minimumSample === 3);

  /* ── Access control ──────────────────────────────────────────────── */
  console.log('\nAccess control');
  const anonymousTakeoff = await call('GET', `/plans/${planId}/takeoff`, null, { anonymous: true });
  check('the take-off requires a session', anonymousTakeoff.status === 401, `status ${anonymousTakeoff.status}`);
  const anonymousVenues = await call('GET', '/venue-specs', null, { anonymous: true });
  check('the venue library requires a session', anonymousVenues.status === 401, `status ${anonymousVenues.status}`);
  const badShare = await call('GET', '/share/not-a-real-token/comments', null, { anonymous: true });
  check('an invalid share token is refused', badShare.status === 404, `status ${badShare.status}`);

  /* ── Clean up ────────────────────────────────────────────────────── */
  await call('DELETE', `/marketplace/listings/${listing.data.id}`);
  await call('DELETE', `/venue-specs/${venueId}`);
  await call('DELETE', `/rate-cards/${cardId}`);
  await call('DELETE', `/plans/${planId}`);
  await call('DELETE', `/projects/${projectId}`);

  /* ── Result ──────────────────────────────────────────────────────── */
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failures.length) {
    console.log('Failures:');
    for (const failure of failures) console.log(`  · ${failure}`);
    console.log('');
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nThe run itself failed:', error);
  process.exit(1);
});
