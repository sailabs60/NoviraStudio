/**
 * Venue generation checks.
 *
 * The point of a local generator is that the output measures exactly what was
 * asked for, so these tests check dimensions and derived figures rather than
 * just "did it produce a file".
 */
import { deriveVenue, defaultVenueParams, VENUE_STYLES } from '../packages/shared/dist/index.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/* Every style must derive without throwing and produce sane numbers. */
for (const style of Object.keys(VENUE_STYLES)) {
  const d = deriveVenue(defaultVenueParams(style));
  const ok =
    d.areaSqM > 0 &&
    d.capacity.banquet > 0 &&
    d.capacity.cocktail > d.capacity.banquet &&
    d.roof.ridgeHeightMm >= d.params.heightMm;
  check(
    `derive ${style}`,
    ok,
    `${d.areaSqM} m², banquet ${d.capacity.banquet}, theatre ${d.capacity.theatre}, cocktail ${d.capacity.cocktail}`
  );
}

/* Footprint must be exactly what was asked for — this is the whole reason the
   generator is local rather than generative. */
const exact = deriveVenue({
  style: 'ballroom',
  widthMm: 24000,
  depthMm: 16000,
  heightMm: 5500,
  entrances: 2,
  windowsPerSide: 4,
  stageAlcove: false,
  columns: false,
});
const xs = exact.walls.segments.flatMap((s) => [s.start.xMm, s.end.xMm]);
const zs = exact.walls.segments.flatMap((s) => [s.start.zMm, s.end.zMm]);
const widthOut = Math.max(...xs) - Math.min(...xs);
const depthOut = Math.max(...zs) - Math.min(...zs);
check('footprint is exact', widthOut === 24000 && depthOut === 16000, `${widthOut} × ${depthOut} mm`);

/* Internal area excludes the wall thickness. */
const expectedArea = ((24000 - 200) * (16000 - 200)) / 1e6;
check(
  'area measured inside the walls',
  Math.abs(exact.areaSqM - Math.round(expectedArea * 10) / 10) < 0.2,
  `${exact.areaSqM} m² vs ${expectedArea.toFixed(1)} m² expected`
);

/* Openings: 2 doors on the front, 4 windows per long side = 8. */
const doors = exact.openings.filter((o) => o.kind === 'door');
const windows = exact.openings.filter((o) => o.kind === 'window');
check('opening counts', doors.length === 2 && windows.length === 8, `${doors.length} doors, ${windows.length} windows`);

/* Every opening must sit on a wall line, not float in the room. */
const onWall = exact.openings.every(
  (o) => Math.abs(Math.abs(o.xMm) - 12000) < 1 || Math.abs(Math.abs(o.zMm) - 8000) < 1
);
check('openings sit on wall lines', onWall);

/* Openings must fit within the wall height. */
const fits = exact.openings.every((o) => o.sillMm + o.heightMm <= 5500);
check('openings fit inside wall height', fits);

/* Doors are evenly spread with equal end margins. */
const doorXs = doors.map((d) => d.xMm).sort((a, b) => a - b);
const leftMargin = doorXs[0] + 12000;
const rightMargin = 12000 - doorXs[doorXs.length - 1];
check('doors evenly spaced', Math.abs(leftMargin - rightMargin) < 2, `margins ${leftMargin}/${rightMargin} mm`);

/* A pitched roof must rise by width/2 × tan(pitch). */
const marquee = deriveVenue(defaultVenueParams('marquee'));
const expectedRise = Math.round((marquee.params.widthMm / 2) * Math.tan((26 * Math.PI) / 180));
check(
  'gable ridge height',
  marquee.roof.ridgeHeightMm === marquee.params.heightMm + expectedRise,
  `${marquee.roof.ridgeHeightMm} mm ridge, ${expectedRise} mm rise`
);

/* A pavilion has posts and no walls. */
const pavilion = deriveVenue(defaultVenueParams('pavilion'));
check(
  'pavilion is open-sided',
  pavilion.walls.segments.length === 0 && pavilion.features.some((f) => f.kind === 'post'),
  `${pavilion.features.filter((f) => f.kind === 'post').length} posts, ${pavilion.walls.segments.length} walls`
);

/* A stage alcove adds floor area rather than taking it. */
const plain = deriveVenue({ ...defaultVenueParams('ballroom'), stageAlcove: false });
const withStage = deriveVenue({ ...defaultVenueParams('ballroom'), stageAlcove: true });
check(
  'stage alcove adds area',
  withStage.areaSqM > plain.areaSqM,
  `${plain.areaSqM} → ${withStage.areaSqM} m²`
);

/* Columns reduce usable capacity. */
const noCols = deriveVenue({ ...defaultVenueParams('warehouse'), columns: false });
const cols = deriveVenue({ ...defaultVenueParams('warehouse'), columns: true });
check(
  'columns reduce capacity',
  cols.capacity.banquet < noCols.capacity.banquet && cols.warnings.some((w) => /sightlines/.test(w)),
  `${noCols.capacity.banquet} → ${cols.capacity.banquet} banquet`
);

/* Capacity ordering must follow the area each mode needs. */
const c = plain.capacity;
check(
  'capacity ordering',
  c.cocktail > c.theatre && c.theatre > c.banquet && c.banquet > c.classroom,
  `cocktail ${c.cocktail} > theatre ${c.theatre} > banquet ${c.banquet} > classroom ${c.classroom}`
);

/* Egress warning fires when a big room has too little door width. */
const underDoored = deriveVenue({
  ...defaultVenueParams('ballroom'),
  widthMm: 40000,
  depthMm: 30000,
  entrances: 1,
});
check(
  'egress warning',
  underDoored.warnings.some((w) => /exit width|two separate exits/i.test(w)),
  underDoored.warnings.find((w) => /exit|exits/i.test(w))?.slice(0, 70) ?? 'none'
);

/* A low room is flagged. */
const low = deriveVenue({ ...defaultVenueParams('conference'), heightMm: 2200 });
check('low ceiling warning', low.warnings.some((w) => /below 2.4/.test(w)));

/* Determinism: the same parameters must give the same figures every time. */
const a = deriveVenue(defaultVenueParams('barn'));
const b = deriveVenue(defaultVenueParams('barn'));
check(
  'deterministic',
  a.areaSqM === b.areaSqM &&
    a.capacity.banquet === b.capacity.banquet &&
    a.openings.length === b.openings.length
);

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} venue checks passed.`);
process.exit(passed === results.length ? 0 : 1);
