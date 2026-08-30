/**
 * Seating.
 *
 * The seating chart is not a separate drawing — it is the layout, read back.
 * Tables and their seat counts come from the scene document, so moving a table
 * in the editor moves it on the chart, and adding a table makes its seats
 * available immediately. Anything else drifts out of sync within a day of real
 * use.
 *
 * Seat positions come from `layout.ts`, which the Table Designer already uses
 * to place chairs, so a seat on the chart is the same seat a guest will sit in.
 */
import { seatPositions } from './layout.js';
import type { SceneDocument, SceneObject, CatalogSceneObject } from './scene.js';

export const RSVP_STATES = ['pending', 'yes', 'no', 'maybe'] as const;
export type RsvpState = (typeof RSVP_STATES)[number];

export interface SeatableTable {
  /** Scene object id — what a seat assignment points at. */
  objectId: string;
  /** What the planner calls it: "Table 4", "Top Table". */
  label: string;
  seatCount: number;
  shape: 'round' | 'rectangular' | 'other';
  /** Plan position, for drawing the chart. */
  xMm: number;
  zMm: number;
  widthMm: number;
  depthMm: number;
  diameterMm: number | null;
}

/**
 * Which objects in a scene are tables people can be seated at.
 *
 * A table qualifies by having a seat count, which is set on the catalogue item
 * when it enters the library. That keeps a coffee table or a cocktail poseur —
 * real tables nobody is seated at — out of the chart.
 */
export function seatableTables(scene: SceneDocument): SeatableTable[] {
  const tables: SeatableTable[] = [];

  /*
   * Table Designer output carries its seat count on the group rather than on
   * each generated table, so that is consulted first; a hand-placed table
   * falls back to the value cached from the catalogue when it was dropped.
   */
  const groupSeats = new Map<string, number>();
  for (const group of scene.tableGroups ?? []) {
    groupSeats.set(group.id, group.seatsPerTable);
  }

  for (const object of scene.objects) {
    if (object.type !== 'catalog') continue;
    const catalog = object as CatalogSceneObject;

    // Only the table itself is seatable, not the chairs generated around it.
    if (catalog.generatedRole && catalog.generatedRole !== 'table') continue;

    const seats =
      (object.groupId ? groupSeats.get(object.groupId) : undefined) ??
      catalog.seatsDefault ??
      0;
    if (!seats || seats < 1) continue;
    if (object.hidden) continue;

    const dims = catalog.dimensionsMm ?? { width: 1524, depth: 1524, height: 762 };
    const shape = catalog.tableShape ?? 'other';

    tables.push({
      objectId: object.id,
      label: object.name?.trim() || 'Table',
      seatCount: seats,
      shape: shape === 'round' || shape === 'rectangular' ? shape : 'other',
      xMm: Math.round(object.positionMm.x),
      zMm: Math.round(object.positionMm.z),
      widthMm: dims.width,
      depthMm: dims.depth,
      diameterMm: shape === 'round' ? dims.width : null,
    });
  }

  /*
   * Order the way a planner reads a room: front to back, then left to right.
   * Numbering tables in scene order would follow whatever sequence they
   * happened to be dropped in, which is meaningless on a printed chart.
   */
  tables.sort((a, b) => (a.zMm === b.zMm ? a.xMm - b.xMm : a.zMm - b.zMm));
  return tables;
}

export interface SeatPosition {
  index: number;
  xMm: number;
  zMm: number;
  /** Facing, degrees clockwise from +Z — a chair faces its table. */
  rotationDeg: number;
}

/** Seat positions around one table, in the same order the chairs are placed. */
export function seatsForTable(table: SeatableTable): SeatPosition[] {
  const positions = seatPositions(table.seatCount, {
    shape: table.shape,
    widthMm: table.diameterMm ?? table.widthMm,
    depthMm: table.depthMm,
  });

  return positions.map((p, index) => ({
    index,
    xMm: Math.round(table.xMm + p.positionMm.x),
    zMm: Math.round(table.zMm + p.positionMm.z),
    rotationDeg: Math.round(p.rotationDeg),
  }));
}

export interface GuestLike {
  id: number;
  firstName: string;
  lastName: string;
  rsvp: string;
  partyName?: string | null;
  guestGroup?: string | null;
  dietary?: string | null;
  accessibility?: string | null;
  isChild?: boolean;
}

export interface AssignmentLike {
  guestId: number;
  tableObjectId: string;
  seatIndex: number | null;
}

export interface SeatingSummary {
  totalGuests: number;
  attending: number;
  declined: number;
  pending: number;
  seated: number;
  unseated: number;
  totalSeats: number;
  spareSeats: number;
  /** Warnings a planner needs before printing the chart. */
  issues: string[];
}

/**
 * Check the chart against the layout.
 *
 * These are the mistakes that actually happen: more guests than chairs, a party
 * split across tables, someone seated at a table that has since been deleted,
 * and guests who have declined still holding a seat.
 */
export function summariseSeating(
  tables: SeatableTable[],
  guests: GuestLike[],
  assignments: AssignmentLike[]
): SeatingSummary {
  const attending = guests.filter((g) => g.rsvp === 'yes');
  const declined = guests.filter((g) => g.rsvp === 'no');
  const pending = guests.filter((g) => g.rsvp === 'pending' || g.rsvp === 'maybe');

  const totalSeats = tables.reduce((sum, t) => sum + t.seatCount, 0);
  const byId = new Map(tables.map((t) => [t.objectId, t]));
  const guestById = new Map(guests.map((g) => [g.id, g]));

  const seatedGuestIds = new Set(assignments.map((a) => a.guestId));
  const issues: string[] = [];

  // A seat pointing at a table that no longer exists.
  const orphaned = assignments.filter((a) => !byId.has(a.tableObjectId));
  if (orphaned.length) {
    issues.push(
      `${orphaned.length} guest${orphaned.length === 1 ? ' is' : 's are'} assigned to a table that is no longer in the layout.`
    );
  }

  // More people at a table than it has chairs.
  const perTable = new Map<string, number>();
  for (const a of assignments) {
    perTable.set(a.tableObjectId, (perTable.get(a.tableObjectId) ?? 0) + 1);
  }
  for (const [objectId, count] of perTable) {
    const table = byId.get(objectId);
    if (table && count > table.seatCount) {
      issues.push(`${table.label} has ${count} guests but only ${table.seatCount} seats.`);
    }
  }

  // Capacity overall.
  if (attending.length > totalSeats) {
    issues.push(
      `${attending.length} guests are attending but the layout seats ${totalSeats}. Add ${attending.length - totalSeats} more.`
    );
  }

  // A household split between tables.
  const partyTables = new Map<string, Set<string>>();
  for (const a of assignments) {
    const guest = guestById.get(a.guestId);
    const party = guest?.partyName?.trim();
    if (!party) continue;
    if (!partyTables.has(party)) partyTables.set(party, new Set());
    partyTables.get(party)!.add(a.tableObjectId);
  }
  for (const [party, tableIds] of partyTables) {
    if (tableIds.size > 1) {
      issues.push(`The ${party} party is split across ${tableIds.size} tables.`);
    }
  }

  // Someone who has declined still holding a seat.
  const declinedSeated = declined.filter((g) => seatedGuestIds.has(g.id));
  if (declinedSeated.length) {
    issues.push(
      `${declinedSeated.length} guest${declinedSeated.length === 1 ? ' has' : 's have'} declined but still hold a seat.`
    );
  }

  // Accessibility needs are worth surfacing even when everything else is fine.
  const accessUnseated = guests.filter(
    (g) => g.accessibility?.trim() && !seatedGuestIds.has(g.id) && g.rsvp === 'yes'
  );
  if (accessUnseated.length) {
    issues.push(
      `${accessUnseated.length} guest${accessUnseated.length === 1 ? '' : 's'} with access requirements ${accessUnseated.length === 1 ? 'is' : 'are'} not seated yet.`
    );
  }

  const seatedAttending = attending.filter((g) => seatedGuestIds.has(g.id)).length;

  return {
    totalGuests: guests.length,
    attending: attending.length,
    declined: declined.length,
    pending: pending.length,
    seated: seatedAttending,
    unseated: attending.length - seatedAttending,
    totalSeats,
    spareSeats: totalSeats - assignments.length,
    issues,
  };
}

/**
 * Fill the chart automatically.
 *
 * The rule that matters is keeping households together, so parties are placed
 * whole, largest first — the same reason you pack big boxes before small ones.
 * A party that cannot fit at any one table is split rather than left out, and
 * the caller is told through `summariseSeating`.
 *
 * Deliberately deterministic: the same guest list and layout always produce the
 * same chart, so re-running it does not reshuffle a plan someone has already
 * reviewed.
 */
export function autoSeat(
  tables: SeatableTable[],
  guests: GuestLike[],
  existing: AssignmentLike[] = []
): AssignmentLike[] {
  const attending = guests.filter((g) => g.rsvp === 'yes' || g.rsvp === 'maybe');

  // Respect seats a planner has already set by hand.
  const kept = existing.filter((a) => tables.some((t) => t.objectId === a.tableObjectId));
  const assigned = new Map<number, AssignmentLike>(kept.map((a) => [a.guestId, a]));
  const remaining = new Map(tables.map((t) => [t.objectId, t.seatCount]));
  for (const a of kept) {
    remaining.set(a.tableObjectId, (remaining.get(a.tableObjectId) ?? 0) - 1);
  }

  // Group by household, then by named group, then singles.
  const parties = new Map<string, GuestLike[]>();
  for (const guest of attending) {
    if (assigned.has(guest.id)) continue;
    const key = guest.partyName?.trim() || guest.guestGroup?.trim() || `__single_${guest.id}`;
    if (!parties.has(key)) parties.set(key, []);
    parties.get(key)!.push(guest);
  }

  const ordered = [...parties.entries()].sort((a, b) => {
    // Largest party first, then alphabetically so the result is stable.
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  });

  const tableOrder = [...tables];

  for (const [, members] of ordered) {
    // The emptiest table that can take the whole party, else the emptiest of all.
    const fits = tableOrder
      .filter((t) => (remaining.get(t.objectId) ?? 0) >= members.length)
      .sort((a, b) => (remaining.get(a.objectId) ?? 0) - (remaining.get(b.objectId) ?? 0));

    if (fits.length) {
      const table = fits[0]!;
      for (const guest of members) {
        assigned.set(guest.id, { guestId: guest.id, tableObjectId: table.objectId, seatIndex: null });
        remaining.set(table.objectId, (remaining.get(table.objectId) ?? 0) - 1);
      }
      continue;
    }

    // Nothing takes them whole: split across the emptiest tables.
    for (const guest of members) {
      const open = tableOrder
        .filter((t) => (remaining.get(t.objectId) ?? 0) > 0)
        .sort((a, b) => (remaining.get(b.objectId) ?? 0) - (remaining.get(a.objectId) ?? 0));
      if (!open.length) break; // Out of seats; summariseSeating will report it.
      const table = open[0]!;
      assigned.set(guest.id, { guestId: guest.id, tableObjectId: table.objectId, seatIndex: null });
      remaining.set(table.objectId, (remaining.get(table.objectId) ?? 0) - 1);
    }
  }

  return [...assigned.values()];
}

/** Per-table meal counts, which is what the caterer actually asks for. */
export function mealCounts(
  guests: GuestLike[],
  assignments: AssignmentLike[]
): Map<string, Map<string, number>> {
  const byGuest = new Map(guests.map((g) => [g.id, g]));
  const out = new Map<string, Map<string, number>>();

  for (const a of assignments) {
    const guest = byGuest.get(a.guestId);
    if (!guest || guest.rsvp !== 'yes') continue;
    const meal = (guest as GuestLike & { mealChoice?: string | null }).mealChoice?.trim() || 'Not chosen';
    if (!out.has(a.tableObjectId)) out.set(a.tableObjectId, new Map());
    const table = out.get(a.tableObjectId)!;
    table.set(meal, (table.get(meal) ?? 0) + 1);
  }

  return out;
}
