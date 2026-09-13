/**
 * What the plan knows about the room it is set in.
 *
 * A venue arrives as a single locked glTF placed at the origin, and until now
 * that was all the editor knew about it: one more object in a list, indexed by
 * nothing, bounded by nothing. Everything downstream had to guess. Framing
 * measured the whole scene including the car park modelled around the hotel;
 * placement dropped furniture wherever the ray landed, roof included; the
 * camera could fly out through a wall and keep going.
 *
 * The fix is to record, once, the two facts that make a building navigable:
 *
 *  · **Where its floor is.** Not the ground plane — the storey somebody is
 *    designing on, which in a real model is rarely y = 0 and is sometimes one
 *    of several.
 *  · **Where its walls stop.** The interior footprint, so "inside" is a
 *    question with an answer and everything outside it can be treated as
 *    scenery rather than as part of the plan.
 *
 * Both are stored on the document rather than recomputed, because measuring
 * them means walking a hundred-megabyte mesh and the answer does not change
 * between sessions. They are written when a venue is applied and read by the
 * viewport, the placement code and the framing code alike, so there is exactly
 * one idea of "the room" rather than four that drift apart.
 *
 * Nothing here is required. A plan with no venue has `venueSite` absent and
 * every consumer falls back to precisely the behaviour it had before — the
 * ground plane, the whole-scene bounds, no clamping.
 */

/** A rectangle on the plan, in millimetres, axis-aligned. */
export interface SiteBoundsMm {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** One storey of the building somebody can design on. */
export interface SiteFloor {
  id: string;
  name: string;
  /** Height of the walking surface above the plan origin. */
  elevationMm: number;
  /** Clear height to whatever is above it, when that could be measured. */
  clearHeightMm: number | null;
  /** The usable extent of this storey. */
  boundsMm: SiteBoundsMm;
}

/**
 * The room, as the editor understands it.
 *
 * Written when a venue is applied to a plan and carried with the document
 * afterwards, so a plan reopened a month later still knows which storey its
 * furniture stands on.
 */
export interface VenueSite {
  /** The `venueSpec` row this came from, when it came from the library. */
  venueSpecId: number | null;
  /** The id of the scene object holding the building shell. */
  shellObjectId: string | null;
  name: string;
  /** Every storey, lowest first. At least one whenever a site exists. */
  floors: SiteFloor[];
  /** Which of them new objects land on, and which the camera is held to. */
  activeFloorId: string;
  /**
   * The interior footprint of the whole building, used for framing.
   *
   * Deliberately the *interior* rather than the model's bounding box. A hotel
   * glTF carries its forecourt, its car park and often a chunk of the street;
   * framing that box puts the ballroom in the middle distance and the plan
   * reads as empty. This is the rectangle somebody is actually working in.
   */
  interiorMm: SiteBoundsMm;
  /**
   * How much of the model sits outside `interiorMm`, as a fraction of its
   * footprint. Only used to decide whether to offer the "focus the venue"
   * behaviour at all — a shell that is all interior has nothing to focus.
   */
  exteriorRatio: number;
}

/** Width of a bounds rectangle, in millimetres. */
export const boundsWidthMm = (b: SiteBoundsMm): number => Math.max(0, b.maxX - b.minX);
/** Depth of a bounds rectangle, in millimetres. */
export const boundsDepthMm = (b: SiteBoundsMm): number => Math.max(0, b.maxZ - b.minZ);

/** The middle of a bounds rectangle. */
export function boundsCentreMm(b: SiteBoundsMm): { xMm: number; zMm: number } {
  return { xMm: Math.round((b.minX + b.maxX) / 2), zMm: Math.round((b.minZ + b.maxZ) / 2) };
}

/** Grow (or, with a negative margin, shrink) a rectangle on every side. */
export function expandBounds(b: SiteBoundsMm, marginMm: number): SiteBoundsMm {
  return {
    minX: b.minX - marginMm,
    maxX: b.maxX + marginMm,
    minZ: b.minZ - marginMm,
    maxZ: b.maxZ + marginMm,
  };
}

/**
 * The overlap of two rectangles, or the second one when they do not meet.
 *
 * The fallback matters: a measured floor level and a recorded footprint that
 * share no area at all means one of the two is wrong about where the origin is,
 * and in that case the *recorded* figure is the one a human checked. Returning
 * an empty rectangle instead would leave the room with no extent, and every
 * consumer would fall back to open-ground behaviour on a plan that plainly has
 * a building in it.
 */
export function intersectBounds(a: SiteBoundsMm, b: SiteBoundsMm): SiteBoundsMm {
  const result = {
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minZ: Math.max(a.minZ, b.minZ),
    maxZ: Math.min(a.maxZ, b.maxZ),
  };
  if (result.maxX - result.minX < 1000 || result.maxZ - result.minZ < 1000) return b;
  return result;
}

/** Is this plan position inside the rectangle? */
export function withinBounds(b: SiteBoundsMm, xMm: number, zMm: number): boolean {
  return xMm >= b.minX && xMm <= b.maxX && zMm >= b.minZ && zMm <= b.maxZ;
}

/**
 * Pull a point back inside the rectangle.
 *
 * Used to keep the camera's orbit target in the room: a target outside the
 * walls is what makes a view start swinging around a point in the car park.
 */
export function clampToBounds(
  b: SiteBoundsMm,
  xMm: number,
  zMm: number
): { xMm: number; zMm: number } {
  return {
    xMm: Math.min(Math.max(xMm, b.minX), b.maxX),
    zMm: Math.min(Math.max(zMm, b.minZ), b.maxZ),
  };
}

/** The storey an object at this height is standing on, or the active one. */
export function floorAtHeight(site: VenueSite, yMm: number): SiteFloor {
  const active = site.floors.find((f) => f.id === site.activeFloorId);
  let best: SiteFloor | null = null;
  for (const floor of site.floors) {
    // The highest storey at or below this height: standing on the first floor
    // means being above its slab, not below the one over your head.
    if (floor.elevationMm <= yMm + 50 && (!best || floor.elevationMm > best.elevationMm)) {
      best = floor;
    }
  }
  return best ?? active ?? site.floors[0]!;
}

/** The storey new objects land on. */
export function activeFloor(site: VenueSite): SiteFloor {
  return site.floors.find((f) => f.id === site.activeFloorId) ?? site.floors[0]!;
}

/**
 * Build a site record from a venue library spec.
 *
 * The spec already carries the footprint and, for an imported model, the
 * storeys that were measured out of the geometry at import time. This turns
 * that into the shape the editor reads, and fills in a single ground storey
 * for a venue that has dimensions but no model — so a spec-only venue still
 * gives the plan a room to work in rather than falling back to open ground.
 */
export function siteFromVenueSpec(spec: {
  id: number | null;
  name: string;
  buildingName?: string;
  widthMm: number;
  depthMm: number;
  outline?: Array<{ xMm: number; zMm: number }> | null;
  structure?: { clearHeightMm?: number };
  floorLevels?: Array<{
    id: string;
    name: string;
    elevationMm: number;
    widthMm: number;
    depthMm: number;
    clearHeightMm?: number | null;
    isDefault?: boolean;
  }>;
}, shellObjectId: string | null): VenueSite {
  /*
   * The footprint, centred on the origin.
   *
   * A venue's model is placed at the origin with its own centre there, so the
   * plan's coordinate system already has the room in the middle. An explicit
   * outline wins when there is one — an L-shaped hall is not its bounding
   * rectangle, and a designer laying out the short leg needs the real shape.
   */
  const outline = spec.outline?.length ? spec.outline : null;
  const interiorMm: SiteBoundsMm = outline
    ? {
        minX: Math.min(...outline.map((p) => p.xMm)),
        maxX: Math.max(...outline.map((p) => p.xMm)),
        minZ: Math.min(...outline.map((p) => p.zMm)),
        maxZ: Math.max(...outline.map((p) => p.zMm)),
      }
    : {
        minX: -Math.round(spec.widthMm / 2),
        maxX: Math.round(spec.widthMm / 2),
        minZ: -Math.round(spec.depthMm / 2),
        maxZ: Math.round(spec.depthMm / 2),
      };

  const clearHeightMm = spec.structure?.clearHeightMm ?? null;

  const floors: SiteFloor[] = spec.floorLevels?.length
    ? spec.floorLevels.map((level) => ({
        id: level.id,
        name: level.name,
        elevationMm: Math.round(level.elevationMm),
        clearHeightMm: level.clearHeightMm ?? clearHeightMm,
        /*
         * A storey's own extent, but never larger than the room.
         *
         * Two different measurements meet here and they answer different
         * questions. A **floor level** is found by walking the imported mesh
         * for a horizontal surface big enough to stand on, so it measures the
         * whole slab — for the Johari Rotana that is 54 × 41 m, which is the
         * hotel's floor plate, not the ballroom. The **spec** says the room is
         * 51 × 16 m, because that is what somebody measured the room to be.
         *
         * The room is the answer wanted here. Framing the slab would put the
         * ballroom in a corner of the view with four-fifths of the frame given
         * to corridors and back-of-house, which is precisely the "it should
         * focus on the venue, everything outside it is irrelevant" this whole
         * record exists to deliver.
         *
         * So the level is *intersected* with the footprint rather than used
         * raw. A mezzanine genuinely smaller than the hall keeps its own
         * smaller extent, because the intersection of the two is then the
         * mezzanine — the rule handles both cases without a special one.
         */
        boundsMm: intersectBounds(
          {
            minX: -Math.round(level.widthMm / 2),
            maxX: Math.round(level.widthMm / 2),
            minZ: -Math.round(level.depthMm / 2),
            maxZ: Math.round(level.depthMm / 2),
          },
          interiorMm
        ),
      }))
    : [
        {
          id: 'ground',
          name: 'Ground floor',
          elevationMm: 0,
          clearHeightMm,
          boundsMm: interiorMm,
        },
      ];

  const preferred = spec.floorLevels?.find((level) => level.isDefault)?.id;

  return {
    venueSpecId: spec.id ?? null,
    shellObjectId,
    name: spec.buildingName || spec.name,
    floors,
    activeFloorId: preferred ?? floors[0]!.id,
    interiorMm,
    // Nothing has been measured off the mesh yet; the viewport refines this
    // once the geometry is in memory (see `refineSiteFromModel`).
    exteriorRatio: 0,
  };
}

/**
 * Update a site with what the loaded mesh actually turned out to be.
 *
 * The spec's figures are what somebody typed into the venue record, and they
 * are right about the *room*. The model is frequently a whole building around
 * that room, and the difference is exactly what decides whether focusing on
 * the venue is worth doing. Measured in the viewport once the glTF is in
 * memory, because that is the only place the answer exists.
 */
export function refineSiteFromModel(
  site: VenueSite,
  modelBoundsMm: SiteBoundsMm
): VenueSite {
  const modelArea = boundsWidthMm(modelBoundsMm) * boundsDepthMm(modelBoundsMm);
  const interiorArea = boundsWidthMm(site.interiorMm) * boundsDepthMm(site.interiorMm);
  if (modelArea <= 0 || interiorArea <= 0) return site;

  const ratio = Math.max(0, 1 - interiorArea / modelArea);
  if (Math.abs(ratio - site.exteriorRatio) < 0.01) return site;
  return { ...site, exteriorRatio: Number(ratio.toFixed(3)) };
}

/**
 * A venue whose model carries substantially more than the room.
 *
 * The threshold is generous on purpose. A shell that is a tenth larger than
 * its floor is a building with walls; one that is three times larger is a
 * hotel with a ballroom somewhere inside it, and those are the plans where
 * framing the whole model shows the user a rooftop.
 */
export const SITE_FOCUS_THRESHOLD = 0.45;

export function siteNeedsFocus(site: VenueSite | null | undefined): boolean {
  return Boolean(site && site.exteriorRatio >= SITE_FOCUS_THRESHOLD);
}
