/**
 * The building end of the venue library.
 *
 * Checks the three things that have to be true for a designer to lay out
 * inside a real room rather than inside a rectangle:
 *
 *  1. A venue record can carry a model, and the detected floors travel with it.
 *  2. Applying that venue puts the building into the plan as a locked shell,
 *     and gives the plan a floor the size of the room.
 *  3. Uploading a new building works from a file, ends up optimised, and its
 *     floors are found.
 *
 * Plus a pass over the image libraries the picker sits on, because "browse
 * Pinterest from anywhere creative" is only true if the search returns pins.
 */
const API = 'http://localhost:4100/api';

let passed = 0;
let failed = 0;

function record(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? passed++ : failed++;
}

async function login(email = 'planner@novira.test', password = 'novira123') {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const { token } = await res.json();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function main() {
  const H = await login();

  /* ── 1. The record ─────────────────────────────────────────────────── */
  const list = await (await fetch(`${API}/venue-specs?q=Rotana&limit=20`, { headers: H })).json();
  const almasi = list.items?.find((v) => /Almasi/i.test(v.name));
  record('Johari Rotana is in the library', Boolean(almasi), almasi ? almasi.name : 'not found');
  if (!almasi) return;

  record(
    'the ballroom carries a 3D building',
    Boolean(almasi.modelUrl),
    almasi.modelUrl ?? 'no modelUrl'
  );
  record(
    'floors were detected off the model',
    Array.isArray(almasi.floorLevels) && almasi.floorLevels.length > 0,
    (almasi.floorLevels ?? [])
      .map((f) => `${f.name} @ ${(f.elevationMm / 1000).toFixed(2)}m / ${Math.round(f.areaSqM)}m²`)
      .join(', ')
  );
  record(
    'exactly one floor is the default',
    (almasi.floorLevels ?? []).filter((f) => f.isDefault).length === 1
  );
  record(
    'the published figures survived the seed',
    almasi.widthMm === 51_000 && almasi.depthMm === 16_000 && almasi.capacity.theatre === 960,
    `${almasi.widthMm / 1000}×${almasi.depthMm / 1000} m, ${almasi.capacity.theatre} theatre`
  );

  // The model must actually be servable, not just recorded.
  const head = await fetch(
    almasi.modelUrl.startsWith('http') ? almasi.modelUrl : `http://localhost:4100${almasi.modelUrl}`
  );
  const bytes = Number(head.headers.get('content-length') ?? 0);
  record(
    'the building downloads and is browser-sized',
    head.ok && bytes > 0 && bytes < 40e6,
    `${head.status}, ${(bytes / 1e6).toFixed(1)} MB`
  );

  /* ── 2. Applying it ────────────────────────────────────────────────── */
  const project = await (
    await fetch(`${API}/projects`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ title: `Rotana check ${Date.now().toString(36)}` }),
    })
  ).json();
  const plan = await (
    await fetch(`${API}/plans`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ projectId: project.id, title: 'Ballroom' }),
    })
  ).json();

  const applied = await (
    await fetch(`${API}/venue-specs/${almasi.id}/apply-to-plan`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ planId: plan.id }),
    })
  ).json();

  const shell = applied.scene?.objects?.find((o) => o.venueId);
  record('applying puts the building in the plan', Boolean(shell), shell ? shell.name : 'no shell object');
  record('the building arrives locked', shell?.locked === true);
  record('the shell carries the model URL', shell?.modelUrl === almasi.modelUrl);
  record(
    'the plan gets a floor the size of the room',
    applied.scene?.walls?.floors?.length === 1,
    `${applied.scene?.walls?.floors?.length ?? 0} floors`
  );
  const poly = applied.scene?.walls?.floors?.[0]?.points ?? [];
  const spanX = Math.max(...poly.map((p) => p.xMm)) - Math.min(...poly.map((p) => p.xMm));
  record('the floor matches the ballroom', spanX === almasi.widthMm, `${spanX} mm across`);
  record('constraints came too', applied.applied > 0, `${applied.applied} constraints`);

  // Applying a second time must not stack two buildings.
  const again = await (
    await fetch(`${API}/venue-specs/${almasi.id}/apply-to-plan`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ planId: plan.id }),
    })
  ).json();
  record(
    're-applying replaces rather than stacks',
    again.scene.objects.filter((o) => o.venueId).length === 1,
    `${again.scene.objects.filter((o) => o.venueId).length} shells`
  );

  /* ── 3. Uploading a building ───────────────────────────────────────── */
  const fs = await import('node:fs/promises');
  const source = 'rotana for apoli.glb';
  let raw = null;
  try {
    raw = await fs.readFile(source);
  } catch {
    console.log('SKIP  upload — no source model in the working directory');
  }

  if (raw) {
    const form = new FormData();
    form.append('model', new Blob([raw]), 'test upload.glb');
    form.append('name', 'Upload check');
    form.append('city', 'Dar es Salaam');
    form.append('country', 'TZ');

    const started = Date.now();
    const res = await fetch(`${API}/venue-specs/import`, {
      method: 'POST',
      headers: { Authorization: H.Authorization },
      body: form,
    });
    const body = await res.json();

    record('a building can be uploaded as a venue', res.ok, res.ok ? '' : JSON.stringify(body).slice(0, 200));
    if (res.ok) {
      const r = body.report;
      record(
        'it is optimised on the way in',
        r.bytesAfter < r.bytesBefore,
        `${(r.bytesBefore / 1e6).toFixed(1)} → ${(r.bytesAfter / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)}s`
      );
      record('its floors are found', r.floors > 0, `${r.floors} floors`);
      record('the size is measured, not asked for', body.venue.widthMm > 1000, `${body.venue.widthMm} mm wide`);
      record('it lands in the uploader’s own library', body.venue.scope !== 'global', body.venue.scope);

      await fetch(`${API}/venue-specs/${body.venue.id}`, { method: 'DELETE', headers: H });
    }
  }

  /* ── 4. The image libraries behind the picker ──────────────────────── */
  const providers = await (await fetch(`${API}/assets/providers`, { headers: H })).json();
  const imageSources = (providers.items ?? []).filter((p) => p.supplies.includes('images') && p.configured);
  record(
    'image libraries are configured',
    imageSources.length > 0,
    imageSources.map((p) => p.label).join(', ')
  );
  record(
    'Pinterest is among them',
    imageSources.some((p) => /pinterest/i.test(p.label)),
    imageSources.some((p) => /pinterest/i.test(p.label)) ? '' : 'not configured'
  );

  const search = await (
    await fetch(`${API}/assets/search?category=images&q=${encodeURIComponent('exhibition stand design')}&limit=24`, {
      headers: H,
    })
  ).json();
  record('the picker’s search returns images', (search.items ?? []).length > 0, `${search.items?.length ?? 0} results`);
  const withPins = (search.items ?? []).filter((i) => /pinterest/i.test(i.sourceLabel ?? ''));
  record('pins come back in a creative search', withPins.length > 0, `${withPins.length} pins`);
  record(
    'every result can be shown',
    (search.items ?? []).every((i) => i.thumbnailUrl || i.imageUrl),
    'thumbnail or full image on each'
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
