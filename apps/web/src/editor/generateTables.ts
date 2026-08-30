/**
 * Table Designer generation.
 *
 * Turns a `TableGroup` specification into concrete scene objects: the tables
 * arranged by the chosen preset, chairs around each one, and a full place
 * setting cloned onto every seat.
 *
 * The objects are *derived*, never hand-edited state — changing the table,
 * chair, seat count or layout regenerates them all. That is why the group's
 * parameters are stored alongside the output, and why every generated object
 * carries the group id and its role so the previous generation can be removed
 * cleanly before the next one is placed.
 */
import {
  PLACE_SETTING_OFFSETS,
  applyOrigin,
  generateLayout,
  seatPositions,
  type CatalogItemDto,
  type CatalogSceneObject,
  type SceneObject,
  type TableGroup,
} from '@novira/shared';

export interface GenerationCatalogue {
  byId: (id: number) => CatalogItemDto | undefined;
}

function makeObject(
  item: CatalogItemDto,
  groupId: string,
  role: CatalogSceneObject['generatedRole'],
  position: { x: number; y: number; z: number },
  rotationDeg: number,
  slot?: string
): CatalogSceneObject {
  return {
    id: crypto.randomUUID(),
    type: 'catalog',
    name: item.name,
    groupId,
    catalogItemId: item.id,
    modelUrl: item.modelUrl,
    dimensionsMm: {
      width: item.widthMm ?? 600,
      depth: item.depthMm ?? 600,
      height: item.heightMm ?? 600,
    },
    // Cached for the seating chart, as in Viewport.
    seatsDefault: item.seatsDefault ?? null,
    tableShape: item.tableShape ?? null,
    positionMm: position,
    rotationDeg: { x: 0, y: rotationDeg, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    generatedRole: role,
    ...(slot ? { generatedSlot: slot } : {}),
  };
}

/**
 * Build every object for a table group.
 *
 * Returns an empty list when the table itself is missing or not in the
 * catalogue cache — generating chairs around nothing would be worse than
 * generating nothing.
 */
export function generateTableGroup(group: TableGroup, catalogue: GenerationCatalogue): SceneObject[] {
  const table = catalogue.byId(group.tableItemId);
  if (!table) return [];

  const chair = group.chairItemId ? catalogue.byId(group.chairItemId) : undefined;
  const linen = group.linenItemId ? catalogue.byId(group.linenItemId) : undefined;
  const centerpiece = group.centerpieceItemId ? catalogue.byId(group.centerpieceItemId) : undefined;

  const tableWidth = table.widthMm ?? 1524;
  const tableDepth = table.depthMm ?? tableWidth;
  const tableHeight = table.heightMm ?? 762;
  const shape = (table.tableShape ?? 'round') as 'round' | 'rectangular' | 'other';

  // Where each table sits.
  const tablePlacements = applyOrigin(
    generateLayout(Math.max(1, group.tableCount), group.layout),
    group.originMm,
    group.rotationDeg
  );

  const objects: SceneObject[] = [];

  for (const placement of tablePlacements) {
    const base = placement.positionMm;
    const spin = placement.rotationDeg;

    objects.push(makeObject(table, group.id, 'table', base, spin));

    if (linen) {
      // The linen sits on the table, so it inherits the table's own footprint.
      objects.push(makeObject(linen, group.id, 'linen', { ...base }, spin));
    }

    if (centerpiece) {
      objects.push(
        makeObject(centerpiece, group.id, 'centerpiece', { ...base, y: tableHeight }, spin)
      );
    }

    if (!chair && !hasAnyPlaceSetting(group)) continue;

    const seats = seatPositions(group.seatsPerTable, {
      shape,
      widthMm: tableWidth,
      depthMm: tableDepth,
    });

    for (const seat of seats) {
      // Seat offsets are in the table's local frame; rotate them with it.
      const local = rotate(seat.positionMm.x, seat.positionMm.z, spin);
      const seatWorld = { x: base.x + local.x, y: base.y, z: base.z + local.z };
      const seatSpin = seat.rotationDeg + spin;

      if (chair) {
        objects.push(makeObject(chair, group.id, 'chair', seatWorld, seatSpin));
      }

      for (const [slot, itemId] of Object.entries(group.placeSettings)) {
        if (!itemId) continue;
        const piece = catalogue.byId(itemId as number);
        if (!piece) continue;
        const offset = PLACE_SETTING_OFFSETS[slot];
        if (!offset) continue;

        /*
         * A cover is laid relative to the seat, facing the table. The offset is
         * expressed in the seat's frame, so it rotates with the seat rather
         * than with the table.
         */
        const settingLocal = rotate(offset.x, offset.z, seatSpin);
        // Pull the cover in from the seat toward the table edge.
        const inward = rotate(0, -320, seatSpin);
        objects.push(
          makeObject(
            piece,
            group.id,
            'place-setting',
            {
              x: seatWorld.x + settingLocal.x + inward.x,
              y: tableHeight,
              z: seatWorld.z + settingLocal.z + inward.z,
            },
            seatSpin,
            slot
          )
        );
      }
    }
  }

  return objects;
}

function hasAnyPlaceSetting(group: TableGroup): boolean {
  return Object.values(group.placeSettings).some(Boolean);
}

function rotate(x: number, z: number, deg: number): { x: number; z: number } {
  if (!deg) return { x, z };
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: x * cos - z * sin, z: x * sin + z * cos };
}

/** Total covers a group produces — shown live while configuring. */
export function totalSeats(group: TableGroup): number {
  return Math.max(0, group.tableCount) * Math.max(0, group.seatsPerTable);
}

/** How many objects a group will add, so the user is not surprised. */
export function estimateObjectCount(group: TableGroup): number {
  const perTable =
    1 +
    (group.linenItemId ? 1 : 0) +
    (group.centerpieceItemId ? 1 : 0) +
    group.seatsPerTable *
      ((group.chairItemId ? 1 : 0) + Object.values(group.placeSettings).filter(Boolean).length);
  return Math.max(0, group.tableCount) * perTable;
}
