/**
 * Furnishing a planned room.
 *
 * `generateConcept` decides the *structure* of an event — where the stage
 * goes, how deep the seating has to be, what the truss trims at. This module
 * decides everything else in the room: the individual tables and where each
 * one stands, the route through them, the chandeliers over them, the banners
 * on the walls, the planting in the corners.
 *
 * It is separate from `concept.ts` for two reasons. The first is size: the
 * structural pass is already long, and packing furniture into it would bury
 * the production figures that make it trustworthy. The second is that this
 * pass has a different job. The structural pass answers "does this fit?"; this
 * one answers "what does it look like when it is set?" — and that is the
 * question the difference between a seating diagram and an event mockup turns
 * on.
 *
 * **The rule from `concept.ts` still holds: this is arithmetic, not
 * generation.** A language model may decide that a room wants chandeliers. It
 * never decides that a chandelier hangs 4.2 m above the floor at
 * (−6000, 3200) — that is computed here, from the room, so it is right every
 * time and identical on every run.
 *
 * ## Keeping things out of each other's way
 *
 * Everything placed here is registered as a footprint, and every later
 * placement is tested against those footprints before it is committed. That is
 * what stops a chandelier from hanging over the stage, a plant from standing
 * in the walkway, and a table from being laid inside the dance floor. The test
 * is a rectangle overlap rather than a true polygon intersection, which is
 * exactly right for a room set on a grid and vastly cheaper to reason about.
 */

/** A claimed rectangle of floor, in plan millimetres, centred on x/z. */
export interface Footprint {
  xMm: number;
  zMm: number;
  widthMm: number;
  depthMm: number;
  /** What claimed it, for explaining a rejection. */
  label: string;
}

/**
 * Does a candidate rectangle touch anything already placed?
 *
 * `clearanceMm` widens the candidate on every side before testing, which is
 * how "leave a metre around it" is expressed — the gap a person needs to walk
 * past a table is part of the table's real footprint, not a separate concept.
 */
export function collides(
  candidate: { xMm: number; zMm: number; widthMm: number; depthMm: number },
  taken: Footprint[],
  clearanceMm = 0
): Footprint | null {
  const halfW = candidate.widthMm / 2 + clearanceMm;
  const halfD = candidate.depthMm / 2 + clearanceMm;
  for (const other of taken) {
    const gapX = Math.abs(candidate.xMm - other.xMm) - (halfW + other.widthMm / 2);
    const gapZ = Math.abs(candidate.zMm - other.zMm) - (halfD + other.depthMm / 2);
    // Overlap on BOTH axes is a collision; clearing either one is a miss.
    if (gapX < 0 && gapZ < 0) return other;
  }
  return null;
}

/* ── Round tables ──────────────────────────────────────────────────────── */

export interface TablePlacement {
  xMm: number;
  zMm: number;
  /** Guests this table seats. */
  seats: number;
  /** 1-based, in the order a floor plan would number them. */
  index: number;
}

export interface DiningLayout {
  tables: TablePlacement[];
  /** Diameter used, in mm. */
  tableDiameterMm: number;
  seatsPerTable: number;
  /** Centre-to-centre spacing actually used. */
  pitchMm: number;
  /** Set when the room could not take every table asked for. */
  shortfall: number;
}

/**
 * Lay out banquet rounds.
 *
 * The two figures that matter are the table diameter and the pitch. A 1.8 m
 * round seating ten is the standard in every hotel banqueting department, and
 * the pitch is that diameter plus enough for a chair at each side plus a
 * service gangway between the chair backs — which is why 3.4 m, not 2 m, is
 * the number a banqueting manager would set out.
 *
 * Tables are laid on a grid and then *tested*, so a walkway or a dance floor
 * running through the middle simply means fewer tables in those rows rather
 * than tables standing in the walkway.
 */
export function layoutDining(opts: {
  attendance: number;
  /** Region the tables may occupy. */
  xMm: number;
  zMm: number;
  widthMm: number;
  depthMm: number;
  taken: Footprint[];
  seatsPerTable?: number;
  tableDiameterMm?: number;
}): DiningLayout {
  const seatsPerTable = opts.seatsPerTable ?? 10;
  const tableDiameterMm = opts.tableDiameterMm ?? 1800;
  /*
   * Chair depth (about 550) on both sides, plus a 900 mm service gangway
   * between the chair backs of adjacent tables. That is the figure that keeps
   * a plated service moving, and it is what makes the room look right.
   */
  const pitchMm = tableDiameterMm + 550 * 2 + 900;

  const wanted = Math.ceil(opts.attendance / seatsPerTable);

  const columns = Math.max(1, Math.floor(opts.widthMm / pitchMm));
  /*
   * How many rows to *try*.
   *
   * `wanted / columns` is the answer only if every slot is free, and slots
   * rarely are — a walkway takes a column out of every row, a dance floor
   * takes a block out of the middle. Stopping at the ideal row count leaves
   * the back of the region empty while tables go unplaced. So the grid is
   * walked as deep as the region allows, and the `wanted` cap stops it early
   * once enough tables are down.
   */
  const rows = Math.max(1, Math.ceil(wanted / columns), Math.floor(opts.depthMm / pitchMm));

  /*
   * Centre the grid across the room, but start it at the front of the region.
   *
   * Across the width, centring is what makes the set look deliberate rather
   * than pushed into a corner. Front to back it is wrong: when more rows are
   * tried than the ideal — which is the whole point, so blocked slots can be
   * made up further back — centring pushes the first row off the front of the
   * region and the last row past its back edge, and both fall outside the
   * room. Starting at the front keeps every extra row inside the space.
   */
  const gridWidth = (columns - 1) * pitchMm;
  const startX = opts.xMm - gridWidth / 2;
  const startZ = opts.zMm - opts.depthMm / 2 + pitchMm / 2;

  const tables: TablePlacement[] = [];
  const claimed: Footprint[] = [...opts.taken];

  for (let row = 0; row < rows && tables.length < wanted; row += 1) {
    for (let column = 0; column < columns && tables.length < wanted; column += 1) {
      const xMm = Math.round(startX + column * pitchMm);
      const zMm = Math.round(startZ + row * pitchMm);

      // The table plus its ring of chairs is what has to fit, not the top.
      const occupied = tableDiameterMm + 550 * 2;
      const candidate = { xMm, zMm, widthMm: occupied, depthMm: occupied };
      if (collides(candidate, claimed, 0)) continue;

      tables.push({ xMm, zMm, seats: seatsPerTable, index: tables.length + 1 });
      claimed.push({ ...candidate, label: `Table ${tables.length}` });
    }
  }

  return {
    tables,
    tableDiameterMm,
    seatsPerTable,
    pitchMm,
    shortfall: Math.max(0, wanted - tables.length),
  };
}

/* ── Chairs around a table ─────────────────────────────────────────────── */

/**
 * Seat positions around one round table.
 *
 * The chair sits on the circle of the table radius plus half a chair depth, so
 * it is tucked to the table rather than floating off it, and is turned to face
 * the centre — which is what makes a rendered banquet read as laid rather than
 * as chairs scattered near a table.
 */
export function chairsAroundTable(
  table: { xMm: number; zMm: number },
  seats: number,
  tableDiameterMm: number,
  chairDepthMm = 550
): Array<{ xMm: number; zMm: number; rotationDeg: number }> {
  const radius = tableDiameterMm / 2 + chairDepthMm / 2;
  const out: Array<{ xMm: number; zMm: number; rotationDeg: number }> = [];
  for (let i = 0; i < seats; i += 1) {
    const angle = (i / seats) * Math.PI * 2;
    out.push({
      xMm: Math.round(table.xMm + Math.sin(angle) * radius),
      zMm: Math.round(table.zMm + Math.cos(angle) * radius),
      /*
       * Facing the centre.
       *
       * A chair at angle `a` stands at (sin a, cos a) from the table centre,
       * so it must look along (−sin a, −cos a) to face the table. The scene's
       * convention is that rotation r points along (sin r, cos r), which makes
       * the answer a + 180 — not −a + 180, which mirrors the ring and leaves
       * half the chairs with their backs to the table.
       */
      rotationDeg: Math.round((angle * 180) / Math.PI + 180) % 360,
    });
  }
  return out;
}

/* ── Overhead fixtures ─────────────────────────────────────────────────── */

export interface HangPoint {
  xMm: number;
  zMm: number;
  /** Height of the fixture above the floor, in mm. */
  yMm: number;
  index: number;
}

/**
 * Space chandeliers over a region.
 *
 * Hung on a grid whose spacing comes from the ceiling height: a fixture lights
 * a pool roughly as wide as it is high, so spacing them at about 1.6 times the
 * trim gives overlapping pools and an evenly lit room rather than bright spots
 * with gaps between them.
 *
 * They hang clear of the truss and the stage, because a chandelier over a
 * stage is in the lighting rig's way and would be the first thing a production
 * manager took out.
 */
export function layoutChandeliers(opts: {
  xMm: number;
  zMm: number;
  widthMm: number;
  depthMm: number;
  roomHeightMm: number;
  taken: Footprint[];
  /** Cap, so a big room does not fill with fixtures. */
  maxCount?: number;
}): HangPoint[] {
  // Hung so the bottom of a fixture stays well above head height, and below
  // the ceiling by enough for the chain and the fixing.
  const trimMm = Math.max(3200, Math.round(opts.roomHeightMm * 0.62));
  const spacing = Math.max(4000, Math.round(trimMm * 1.6));

  const columns = Math.max(1, Math.round(opts.widthMm / spacing));
  const rows = Math.max(1, Math.round(opts.depthMm / spacing));

  const stepX = opts.widthMm / (columns + 1);
  const stepZ = opts.depthMm / (rows + 1);

  const points: HangPoint[] = [];
  const max = opts.maxCount ?? 12;

  for (let row = 1; row <= rows && points.length < max; row += 1) {
    for (let column = 1; column <= columns && points.length < max; column += 1) {
      const xMm = Math.round(opts.xMm - opts.widthMm / 2 + stepX * column);
      const zMm = Math.round(opts.zMm - opts.depthMm / 2 + stepZ * row);
      // A fixture needs the floor beneath it clear of staging and truss.
      if (collides({ xMm, zMm, widthMm: 1200, depthMm: 1200 }, opts.taken, 0)) continue;
      points.push({ xMm, zMm, yMm: trimMm, index: points.length + 1 });
    }
  }
  return points;
}

/* ── Things against the walls ──────────────────────────────────────────── */

export interface WallPlacement {
  xMm: number;
  zMm: number;
  /** Facing into the room. */
  rotationDeg: number;
  wall: 'north' | 'east' | 'south' | 'west';
  index: number;
}

/**
 * Space items along the walls of the room, facing inwards.
 *
 * Used for banners, logo walls and perimeter stands. Placement walks the walls
 * in order and skips the far (north) wall by default, because that is where
 * the stage and screen are and hanging a banner behind the screen wastes it.
 *
 * The rotation convention matches the scene's: 0° faces the far wall, so an
 * item on the west wall is turned 90° to look across the room.
 */
export function layoutAgainstWalls(opts: {
  roomWidthMm: number;
  roomDepthMm: number;
  count: number;
  /** How far the item's centre stands off the wall. */
  insetMm: number;
  /** Width along the wall, so items do not overlap each other. */
  itemWidthMm: number;
  taken: Footprint[];
  includeNorth?: boolean;
}): WallPlacement[] {
  const halfW = opts.roomWidthMm / 2;
  const halfD = opts.roomDepthMm / 2;
  const walls: Array<WallPlacement['wall']> = opts.includeNorth
    ? ['west', 'east', 'south', 'north']
    : ['west', 'east', 'south'];

  const out: WallPlacement[] = [];
  const claimed = [...opts.taken];

  // Spread the requested count over the available walls, longest first so a
  // long wall carries proportionally more.
  const perWall = Math.max(1, Math.ceil(opts.count / walls.length));

  for (const wall of walls) {
    const along = wall === 'north' || wall === 'south' ? opts.roomWidthMm : opts.roomDepthMm;
    const usable = along - 4000; // Keep clear of the corners.

    /*
     * Try more positions along the wall than are needed, and keep the ones
     * that are free.
     *
     * Walls get shared: stands go up first and banners go up after, so the
     * evenly-spaced ideal positions are usually already taken. Testing only
     * the ideal slots meant a wall that was 90 % empty placed nothing at all.
     * Sampling finely and skipping the blocked samples finds the real gaps,
     * which is what someone dressing the room would do.
     */
    const samples = Math.max(perWall, Math.floor(usable / Math.max(1200, opts.itemWidthMm)));
    const step = usable / (samples + 1);

    for (let i = 1; i <= samples && out.length < opts.count; i += 1) {
      const offset = -usable / 2 + step * i;
      let xMm: number;
      let zMm: number;
      let rotationDeg: number;

      if (wall === 'west') {
        xMm = Math.round(-halfW + opts.insetMm);
        zMm = Math.round(offset);
        rotationDeg = 90;
      } else if (wall === 'east') {
        xMm = Math.round(halfW - opts.insetMm);
        zMm = Math.round(offset);
        rotationDeg = 270;
      } else if (wall === 'south') {
        xMm = Math.round(offset);
        zMm = Math.round(halfD - opts.insetMm);
        rotationDeg = 180;
      } else {
        xMm = Math.round(offset);
        zMm = Math.round(-halfD + opts.insetMm);
        rotationDeg = 0;
      }

      const candidate = { xMm, zMm, widthMm: opts.itemWidthMm, depthMm: opts.itemWidthMm };
      if (collides(candidate, claimed, 200)) continue;

      out.push({ xMm, zMm, rotationDeg, wall, index: out.length + 1 });
      claimed.push({ ...candidate, label: `wall item ${out.length}` });
    }
  }

  return out;
}

/* ── Corners ───────────────────────────────────────────────────────────── */

/**
 * The four inside corners of the room, for planting.
 *
 * Corners are where decor goes because they are the one part of a function
 * room that no layout ever uses and every photograph includes.
 */
export function cornerPositions(
  roomWidthMm: number,
  roomDepthMm: number,
  insetMm = 1400
): Array<{ xMm: number; zMm: number }> {
  const x = roomWidthMm / 2 - insetMm;
  const z = roomDepthMm / 2 - insetMm;
  return [
    { xMm: Math.round(-x), zMm: Math.round(-z) },
    { xMm: Math.round(x), zMm: Math.round(-z) },
    { xMm: Math.round(-x), zMm: Math.round(z) },
    { xMm: Math.round(x), zMm: Math.round(z) },
  ];
}
