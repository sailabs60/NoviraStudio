/**
 * The venue intelligence library.
 *
 * Records of real buildings: what they measure, what they will carry, how a
 * truck reaches them, and what the rules are. The interesting endpoint is not
 * the CRUD — it is `apply-to-plan`, which turns a record into constraint
 * geometry inside a scene. That is the moment the library stops being a
 * reference sheet and starts stopping people building things that will not fit.
 */
import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import {
  constraintsFromVenue,
  deriveVenueCapacity,
  emptyVenueSpec,
  migrateScene,
  regionForCountry,
  VENUE_SPACE_TYPES,
  venueWarnings,
  type ConstraintSceneObject,
  type SceneObject,
  type VenueSpec,
} from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { saveAssetBuffer } from '../services/storage.js';
import { prepareVenueModel } from '../services/venueModel.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthedUser } from '../middleware/auth.js';
import { loadPlanForUser } from './plans.js';

export const venueLibraryRouter = Router();
venueLibraryRouter.use(requireAuth);

/* ── Scope ─────────────────────────────────────────────────────────────── */

/**
 * Records a user may see: the global library, their own, and their company's.
 *
 * Global records are the shared asset here — a verified spec for a convention
 * centre is useful to everyone who ever works in it — so they are readable by
 * all and writable only by an administrator.
 */
function readScope(user: AuthedUser) {
  return {
    OR: [
      { scope: 'global' },
      { ownerId: user.id },
      ...(user.companyId ? [{ companyId: user.companyId }] : []),
    ],
  };
}

function writeScope(user: AuthedUser) {
  return { OR: [{ ownerId: user.id }, ...(user.companyId ? [{ companyId: user.companyId }] : [])] };
}

interface VenueSpecRow {
  id: bigint;
  ownerId: bigint | null;
  companyId: bigint | null;
  scope: string;
  name: string;
  buildingName: string;
  spaceType: string;
  city: string;
  country: string;
  regionCode: string;
  widthMm: number;
  depthMm: number;
  areaSqM: unknown;
  outline: unknown;
  structure: unknown;
  access: unknown;
  services: unknown;
  rules: unknown;
  capacity: unknown;
  modelUrl: string | null;
  floorLevels: unknown;
  modelFacts: unknown;
  previewUrl: string | null;
  floorPlanUrl: string | null;
  verified: boolean;
  verifiedAt: Date | null;
  sourceNote: string;
}

function specFromRow(row: VenueSpecRow): VenueSpec {
  const blank = emptyVenueSpec(row.regionCode);
  return {
    ...blank,
    id: Number(row.id),
    name: row.name,
    buildingName: row.buildingName,
    spaceType: row.spaceType as VenueSpec['spaceType'],
    city: row.city,
    country: row.country,
    regionCode: row.regionCode,
    widthMm: row.widthMm,
    depthMm: row.depthMm,
    areaSqM: Number(row.areaSqM ?? 0),
    outline: (row.outline as VenueSpec['outline']) ?? null,
    structure: { ...blank.structure, ...((row.structure as object) ?? {}) },
    access: { ...blank.access, ...((row.access as object) ?? {}) },
    services: { ...blank.services, ...((row.services as object) ?? {}) },
    rules: { ...blank.rules, ...((row.rules as object) ?? {}) },
    capacity: { ...blank.capacity, ...((row.capacity as object) ?? {}) },
    modelUrl: row.modelUrl,
    floorLevels: Array.isArray(row.floorLevels) ? (row.floorLevels as VenueSpec['floorLevels']) : [],
    modelFacts: (row.modelFacts as VenueSpec['modelFacts']) ?? null,
    previewUrl: row.previewUrl,
    floorPlanUrl: row.floorPlanUrl,
    scope: row.scope as VenueSpec['scope'],
    verified: row.verified,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    sourceNote: row.sourceNote,
  };
}

/* ── Importing a building ──────────────────────────────────────────────── */

/**
 * A model in, a usable venue out.
 *
 * "Minimum setup" is the whole design goal here. A designer has a building —
 * from the architect, the venue's own marketing pack, a scan — and what they
 * want is to lay an event out inside it. Everything the platform needs to make
 * that work can be read from the file itself:
 *
 *  · **Its size**, and therefore whether the exporter used metres, centimetres
 *    or feet. A venue imported at the wrong scale is a doll's house.
 *  · **Its floors** — every height with enough horizontal surface to stand on
 *    and enough headroom to stand in. This is what stops furniture landing
 *    inside the slab.
 *  · **Its materials**, converted from extensions three.js no longer supports,
 *    because a building that renders untextured grey reads as a broken import.
 *
 * The only things a person has to type are the name and the city. Everything
 * else is filled in and editable afterwards.
 */
const venueUpload = multer({
  storage: multer.memoryStorage(),
  // Architectural exports are genuinely enormous; the importer's job is to make
  // them small, so it has to be allowed to receive them large.
  limits: { fileSize: 400 * 1024 * 1024 },
});

venueLibraryRouter.post(
  '/venue-specs/import',
  venueUpload.single('model'),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw ApiError.badRequest('Choose a .glb or .gltf model of the building.');
    if (!/\.(glb|gltf)$/i.test(file.originalname)) {
      throw ApiError.badRequest('Novira reads glTF buildings — a .glb or .gltf file.');
    }

    const name = String(req.body.name ?? '').trim() || file.originalname.replace(/\.(glb|gltf)$/i, '');
    const city = String(req.body.city ?? '').trim();
    const country = String(req.body.country ?? '').trim().slice(0, 2).toUpperCase();
    const regionCode = String(req.body.regionCode ?? 'global').trim() || 'global';

    /*
     * Written to disk before it is read. glTF references external buffers and
     * textures by relative path, and the reader needs a real file location to
     * resolve them from — a buffer in memory has no directory.
     */
    const key = randomUUID();
    const extension = path.extname(file.originalname).toLowerCase() || '.glb';
    const staged = await saveAssetBuffer(file.buffer, `venues/source/${key}${extension}`);

    const prepared = await prepareVenueModel(staged.path, `venues/${key}.glb`, { textureSize: 2048 });
    if (!prepared.ok) {
      throw new ApiError(422, 'MODEL_UNREADABLE', prepared.error ?? 'That model could not be read.');
    }

    const blank = emptyVenueSpec(regionCode);
    const areaSqM = prepared.floors[0]?.areaSqM ?? Math.round((prepared.sizeMm.width / 1000) * (prepared.sizeMm.depth / 1000));

    const row = await prisma.venueSpec.create({
      data: {
        ownerId: req.user!.id,
        companyId: req.user!.companyId,
        scope: req.user!.companyId ? 'company' : 'personal',
        name: name.slice(0, 180),
        buildingName: name.slice(0, 180),
        spaceType: 'ballroom',
        city: city.slice(0, 120),
        country,
        regionCode,
        widthMm: prepared.sizeMm.width,
        depthMm: prepared.sizeMm.depth,
        areaSqM,
        structure: {
          ...blank.structure,
          // The tallest floor-to-model-top gap is the best clear height the
          // geometry can offer without a survey.
          clearHeightMm: prepared.sizeMm.height,
        },
        // Cast through `object`: Prisma's JSON input type does not accept a
        // declared interface, only a structurally-checked plain object.
        access: blank.access as object,
        services: blank.services as object,
        rules: blank.rules as object,
        capacity: blank.capacity as object,
        modelUrl: prepared.url,
        floorLevels: namedFloors(prepared.floors),
        modelFacts: {
          triangleCount: prepared.triangleCount,
          bytesBefore: prepared.bytesBefore,
          bytesAfter: prepared.bytesAfter,
          unitScale: prepared.unitScale,
          ...(prepared.convertedFrom ? { convertedFrom: prepared.convertedFrom } : {}),
        },
        sourceNote: `Imported from ${file.originalname}`,
      },
    });

    res.status(201).json({
      venue: specFromRow(row as never),
      report: {
        bytesBefore: prepared.bytesBefore,
        bytesAfter: prepared.bytesAfter,
        triangleCount: prepared.triangleCount,
        textureCount: prepared.textureCount,
        unitScale: prepared.unitScale,
        convertedFrom: prepared.convertedFrom ?? null,
        floors: prepared.floors.length,
      },
    });
  })
);

/**
 * Give the detected floors names a person would recognise.
 *
 * Geometry knows where the floors are and nothing about what they are called,
 * so the naming is a convention — lowest is the ground floor, the rest count
 * up — and every one of them is editable. Guessing "Ballroom" from a height
 * would be worse than a number, because it would sometimes be wrong and always
 * look authoritative.
 */
function namedFloors(floors: Array<{ elevationMm: number; areaSqM: number; widthMm: number; depthMm: number }>) {
  return floors.map((floor, index) => ({
    id: `level-${index}`,
    name: index === 0 ? 'Ground floor' : `Level ${index}`,
    elevationMm: floor.elevationMm,
    areaSqM: floor.areaSqM,
    widthMm: floor.widthMm,
    depthMm: floor.depthMm,
    clearHeightMm: null,
    // Objects land on the biggest floor unless told otherwise: it is almost
    // always the one the event is in.
    isDefault: index === floors.reduce((best, f, i, all) => (f.areaSqM > all[best]!.areaSqM ? i : best), 0),
  }));
}

/* ── Validation ────────────────────────────────────────────────────────── */

const structureSchema = z.object({
  clearHeightMm: z.number().int().min(1000).max(80_000),
  maxHeightMm: z.number().int().min(1000).max(120_000),
  riggingAllowed: z.boolean(),
  totalRiggingCapacityKg: z.number().int().min(0).max(500_000).nullable(),
  floorLoadKgSqM: z.number().int().min(0).max(20_000).nullable(),
  pointLoadKg: z.number().int().min(0).max(100_000).nullable(),
  columns: z
    .array(
      z.object({
        xMm: z.number().int(),
        zMm: z.number().int(),
        widthMm: z.number().int().min(50).max(5000),
        depthMm: z.number().int().min(50).max(5000),
      })
    )
    .max(200),
  levelFloor: z.boolean(),
  floorSurface: z.enum(['carpet', 'concrete', 'timber', 'tile', 'grass', 'tarmac', 'raised-access']),
  fixingsAllowed: z.boolean(),
});

const accessSchema = z.object({
  vehicle: z.enum(['van', 'box-truck', 'rigid', 'articulated']),
  doorWidthMm: z.number().int().min(500).max(20_000),
  doorHeightMm: z.number().int().min(1000).max(20_000),
  dockLevel: z.boolean(),
  pushDistanceMm: z.number().int().min(0).max(1_000_000),
  liftWidthMm: z.number().int().min(0).max(10_000).nullable(),
  liftDepthMm: z.number().int().min(0).max(10_000).nullable(),
  liftHeightMm: z.number().int().min(0).max(10_000).nullable(),
  liftCapacityKg: z.number().int().min(0).max(50_000).nullable(),
  stepFree: z.boolean(),
  notes: z.string().max(2000),
});

const servicesSchema = z.object({
  powerAmps: z.number().int().min(0).max(10_000),
  powerPhases: z.union([z.literal(1), z.literal(3)]),
  powerVoltage: z.number().int().min(100).max(1000),
  powerPoints: z
    .array(
      z.object({
        xMm: z.number().int(),
        zMm: z.number().int(),
        amps: z.number().int().min(0).max(2000),
        phases: z.union([z.literal(1), z.literal(3)]),
        label: z.string().max(80),
      })
    )
    .max(100),
  generatorAccess: z.boolean(),
  waterAvailable: z.boolean(),
  wifiBandwidthMbps: z.number().int().min(0).max(100_000).nullable(),
  dimmableHouseLights: z.boolean(),
  hazeAllowed: z.boolean(),
  soundLimitDb: z.number().int().min(0).max(200).nullable(),
});

const rulesSchema = z.object({
  buildCurfew: z.string().max(10).nullable(),
  buildFrom: z.string().max(10).nullable(),
  exclusiveSuppliers: z.array(z.string().max(80)).max(30),
  externalSupplierFee: z.boolean(),
  flameAllowed: z.boolean(),
  confettiAllowed: z.boolean(),
  notes: z.array(z.string().max(500)).max(30),
});

const venueSpecBody = z.object({
  name: z.string().trim().min(1).max(180),
  buildingName: z.string().trim().max(180).default(''),
  spaceType: z.enum(VENUE_SPACE_TYPES),
  city: z.string().trim().max(120).default(''),
  country: z.string().trim().max(2).default(''),
  regionCode: z.string().trim().max(24).optional(),
  widthMm: z.number().int().min(1000).max(500_000),
  depthMm: z.number().int().min(1000).max(500_000),
  outline: z.array(z.object({ xMm: z.number().int(), zMm: z.number().int() })).max(400).nullable().optional(),
  structure: structureSchema,
  access: accessSchema,
  services: servicesSchema,
  rules: rulesSchema,
  modelUrl: z.string().max(512).nullable().optional(),
  floorLevels: z
    .array(
      z.object({
        id: z.string().max(60),
        name: z.string().max(80),
        elevationMm: z.number().int().min(-50_000).max(500_000),
        areaSqM: z.number().min(0).max(1_000_000),
        widthMm: z.number().int().min(0).max(1_000_000),
        depthMm: z.number().int().min(0).max(1_000_000),
        clearHeightMm: z.number().int().min(0).max(100_000).nullable().optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .max(24)
    .optional(),
  previewUrl: z.string().max(512).nullable().optional(),
  floorPlanUrl: z.string().max(512).nullable().optional(),
  sourceNote: z.string().trim().max(400).default(''),
  shareWithCompany: z.boolean().optional(),
  verified: z.boolean().optional(),
});

/* ── Routes ────────────────────────────────────────────────────────────── */

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  country: z.string().trim().max(2).optional(),
  spaceType: z.enum(VENUE_SPACE_TYPES).optional(),
  /** Filter to spaces that can hold this many people in any layout. */
  minCapacity: z.coerce.number().int().min(0).optional(),
  scope: z.enum(['all', 'mine', 'company', 'global']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

venueLibraryRouter.get(
  '/venue-specs',
  asyncHandler(async (req, res) => {
    const query = listQuery.parse(req.query);
    const user = req.user!;

    const scopeFilter =
      query.scope === 'mine'
        ? { ownerId: user.id }
        : query.scope === 'company'
          ? user.companyId
            ? { companyId: user.companyId }
            : { id: BigInt(-1) }
          : query.scope === 'global'
            ? { scope: 'global' }
            : readScope(user);

    const rows = await prisma.venueSpec.findMany({
      where: {
        ...scopeFilter,
        ...(query.q ? { OR: [{ name: { contains: query.q } }, { buildingName: { contains: query.q } }] } : {}),
        ...(query.city ? { city: { contains: query.city } } : {}),
        ...(query.country ? { country: query.country.toUpperCase() } : {}),
        ...(query.spaceType ? { spaceType: query.spaceType } : {}),
      },
      orderBy: [{ verified: 'desc' }, { name: 'asc' }],
      take: query.limit,
    });

    const specs = rows.map(specFromRow);
    const filtered = query.minCapacity
      ? specs.filter((s) => Math.max(s.capacity.theatre, s.capacity.banquet, s.capacity.cocktail) >= query.minCapacity!)
      : specs;

    res.json({
      items: filtered.map((spec) => ({ ...spec, warnings: venueWarnings(spec) })),
      cities: [...new Set(rows.map((r) => r.city).filter(Boolean))].sort(),
      countries: [...new Set(rows.map((r) => r.country).filter(Boolean))].sort(),
    });
  })
);

venueLibraryRouter.get(
  '/venue-specs/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Venue not found.');
    const row = await prisma.venueSpec.findFirst({ where: { id, ...readScope(req.user!) } });
    if (!row) throw ApiError.notFound('Venue not found.');
    const spec = specFromRow(row);
    res.json({ ...spec, warnings: venueWarnings(spec) });
  })
);

venueLibraryRouter.post(
  '/venue-specs',
  asyncHandler(async (req, res) => {
    const body = venueSpecBody.parse(req.body);
    const user = req.user!;
    if (body.shareWithCompany && !user.companyId) {
      throw ApiError.badRequest('You are not part of a company workspace.');
    }
    // Only an administrator publishes to the shared library; anyone else who
    // ticks "verified" is asserting something about a building on behalf of
    // every other account, which is not theirs to assert.
    const verified = body.verified === true && user.role === 'super_admin';

    const regionCode = body.regionCode ?? regionForCountry(body.country).code;
    const capacity = deriveVenueCapacity({
      widthMm: body.widthMm,
      depthMm: body.depthMm,
      structure: body.structure,
      regionCode,
    });

    const row = await prisma.venueSpec.create({
      data: {
        ownerId: body.shareWithCompany ? null : user.id,
        companyId: body.shareWithCompany ? user.companyId : null,
        scope: body.shareWithCompany ? 'company' : 'personal',
        name: body.name,
        buildingName: body.buildingName,
        spaceType: body.spaceType,
        city: body.city,
        country: body.country.toUpperCase(),
        regionCode,
        widthMm: body.widthMm,
        depthMm: body.depthMm,
        areaSqM: (body.widthMm * body.depthMm) / 1_000_000,
        outline: (body.outline ?? null) as unknown as object,
        structure: body.structure as unknown as object,
        access: body.access as unknown as object,
        services: body.services as unknown as object,
        rules: body.rules as unknown as object,
        capacity: capacity as unknown as object,
        modelUrl: body.modelUrl ?? null,
        floorLevels: body.floorLevels ?? [],
        previewUrl: body.previewUrl ?? null,
        floorPlanUrl: body.floorPlanUrl ?? null,
        sourceNote: body.sourceNote,
        verified,
        verifiedAt: verified ? new Date() : null,
      },
    });
    res.status(201).json(specFromRow(row));
  })
);

venueLibraryRouter.patch(
  '/venue-specs/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Venue not found.');
    const user = req.user!;
    const existing = await prisma.venueSpec.findFirst({
      where: user.role === 'super_admin' ? { id } : { id, ...writeScope(user) },
    });
    if (!existing) throw ApiError.notFound('Venue not found.');

    const body = venueSpecBody.partial().parse(req.body);
    const widthMm = body.widthMm ?? existing.widthMm;
    const depthMm = body.depthMm ?? existing.depthMm;
    const structure = body.structure ?? (existing.structure as never);
    const regionCode = body.regionCode ?? existing.regionCode;

    const capacity = deriveVenueCapacity({ widthMm, depthMm, structure, regionCode });

    const row = await prisma.venueSpec.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.buildingName !== undefined ? { buildingName: body.buildingName } : {}),
        ...(body.spaceType ? { spaceType: body.spaceType } : {}),
        ...(body.city !== undefined ? { city: body.city } : {}),
        ...(body.country !== undefined ? { country: body.country.toUpperCase() } : {}),
        regionCode,
        widthMm,
        depthMm,
        areaSqM: (widthMm * depthMm) / 1_000_000,
        ...(body.outline !== undefined ? { outline: (body.outline ?? null) as unknown as object } : {}),
        ...(body.structure ? { structure: body.structure as unknown as object } : {}),
        ...(body.access ? { access: body.access as unknown as object } : {}),
        ...(body.services ? { services: body.services as unknown as object } : {}),
        ...(body.rules ? { rules: body.rules as unknown as object } : {}),
        capacity: capacity as unknown as object,
        ...(body.modelUrl !== undefined ? { modelUrl: body.modelUrl } : {}),
        ...(body.floorLevels !== undefined ? { floorLevels: body.floorLevels } : {}),
        ...(body.previewUrl !== undefined ? { previewUrl: body.previewUrl } : {}),
        ...(body.floorPlanUrl !== undefined ? { floorPlanUrl: body.floorPlanUrl } : {}),
        ...(body.sourceNote !== undefined ? { sourceNote: body.sourceNote } : {}),
        ...(body.verified !== undefined && user.role === 'super_admin'
          ? { verified: body.verified, verifiedAt: body.verified ? new Date() : null }
          : {}),
      },
    });
    res.json(specFromRow(row));
  })
);

venueLibraryRouter.delete(
  '/venue-specs/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Venue not found.');
    const user = req.user!;
    const existing = await prisma.venueSpec.findFirst({
      where: user.role === 'super_admin' ? { id } : { id, ...writeScope(user) },
    });
    if (!existing) throw ApiError.notFound('Venue not found.');
    await prisma.venueSpec.delete({ where: { id } });
    res.json({ ok: true });
  })
);

/**
 * Apply a venue's constraints to a plan.
 *
 * Replaces any constraints previously applied from a venue, and leaves ones
 * drawn by hand alone. Without that distinction, applying a second venue would
 * silently delete a planner's own keep-clear zones — which is exactly the kind
 * of quiet data loss that makes people stop trusting a feature.
 */
venueLibraryRouter.post(
  '/venue-specs/:id/apply-to-plan',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Venue not found.');
    const body = z
      .object({
        planId: z.number().int().positive(),
        /** Also set the plan's region from the venue's. */
        adoptRegion: z.boolean().default(true),
      })
      .parse(req.body);

    const row = await prisma.venueSpec.findFirst({ where: { id, ...readScope(req.user!) } });
    if (!row) throw ApiError.notFound('Venue not found.');
    const planId = BigInt(body.planId);
    await loadPlanForUser(req.user!, planId, { write: true });

    const spec = specFromRow(row);
    const sceneRow = await prisma.planScene.findUnique({ where: { planId } });
    const scene = migrateScene(sceneRow?.scene);

    const generated = constraintsFromVenue(spec);
    const objects: SceneObject[] = generated.map((constraint, index) => {
      const { positionMm, ...data } = constraint;
      return {
        id: `venue-${row.id}-${index}`,
        type: 'constraint',
        name: data.label,
        // Locked, because these describe the building rather than the design.
        // Someone dragging a fire exit to make room for a bar is not a
        // workflow anyone wants to support.
        locked: true,
        positionMm,
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        ...data,
      } as ConstraintSceneObject;
    });

    scene.objects = [
      ...scene.objects.filter(
        (o) =>
          !(o.type === 'constraint' && o.id.startsWith('venue-')) &&
          // Any shell from a previously applied venue. Stacking two buildings
          // in the same millimetres is never what someone meant.
          !(o.type === 'catalog' && (o as { venueId?: number | null }).venueId)
      ),
      ...objects,
    ];

    /*
     * The building itself, when the record has one.
     *
     * A spec-only venue applies as constraint geometry — keep-clears, the
     * rigging grid, the column positions — and that is genuinely useful. But a
     * record with a model can do the thing people actually want, which is to
     * design *inside the room*: the floor the furniture lands on, the walls it
     * measures against, the ceiling height you can see rather than read.
     *
     * Locked on arrival. A venue is the building; nudging it while placing
     * chairs inside it is never intentional, and an unlocked 4,000 m² mesh in
     * a selection rectangle is a very bad afternoon.
     */
    if (spec.modelUrl) {
      scene.objects.push({
        id: `venue-model-${row.id}`,
        type: 'catalog',
        name: spec.buildingName || spec.name,
        // Venues are not catalogue rows, so the URL is carried directly.
        catalogItemId: 0,
        modelUrl: spec.modelUrl,
        venueId: Number(row.id),
        positionMm: { x: 0, y: 0, z: 0 },
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        locked: true,
      } as SceneObject);

      /*
       * Give the plan a floor the size of the room, but only if the designer
       * has not drawn one. Area, capacity and the take-off all measure from
       * the floor polygon, and a building dropped into a plan with no floor
       * would report zero square metres. Overwriting a floor somebody drew by
       * hand, on the other hand, is data loss.
       */
      if (!scene.walls.segments.length && !scene.walls.floors.length) {
        const halfWidth = Math.round(spec.widthMm / 2);
        const halfDepth = Math.round(spec.depthMm / 2);
        scene.walls = {
          segments: [],
          floors: [
            {
              id: `venue-floor-${row.id}`,
              points: [
                { xMm: -halfWidth, zMm: -halfDepth },
                { xMm: halfWidth, zMm: -halfDepth },
                { xMm: halfWidth, zMm: halfDepth },
                { xMm: -halfWidth, zMm: halfDepth },
              ],
            },
          ],
        };
      }
    }

    if (body.adoptRegion) scene.regionCode = spec.regionCode;
    scene.showConstraints = true;

    await prisma.planScene.upsert({
      where: { planId },
      create: { planId, schemaVersion: scene.schemaVersion, scene: scene as unknown as object },
      update: { schemaVersion: scene.schemaVersion, scene: scene as unknown as object },
    });
    await prisma.plan.update({ where: { id: planId }, data: { objectCount: scene.objects.length } });

    res.json({
      ok: true,
      scene,
      applied: objects.length,
      warnings: venueWarnings(spec),
      venue: spec,
    });
  })
);

/** Recompute the capacity table, used live by the editor as sizes change. */
venueLibraryRouter.post(
  '/venue-specs/capacity',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        widthMm: z.number().int().min(1000).max(500_000),
        depthMm: z.number().int().min(1000).max(500_000),
        regionCode: z.string().max(24).default('global'),
        columns: z
          .array(z.object({ xMm: z.number(), zMm: z.number(), widthMm: z.number(), depthMm: z.number() }))
          .max(200)
          .default([]),
      })
      .parse(req.body);

    const blank = emptyVenueSpec(body.regionCode);
    res.json(
      deriveVenueCapacity({
        widthMm: body.widthMm,
        depthMm: body.depthMm,
        regionCode: body.regionCode,
        structure: { ...blank.structure, columns: body.columns },
      })
    );
  })
);
