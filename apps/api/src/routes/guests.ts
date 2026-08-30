/**
 * Guest list and seating.
 *
 * The guest list belongs to the project — one event, one list — while seating
 * belongs to a plan, because a planner will try several layouts for the same
 * people. That separation is the whole reason this is not just a table of
 * names: it means you can compare two seating charts without duplicating the
 * guest list, and a table moving in the editor moves it on the chart.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  autoSeat,
  mealCounts,
  migrateScene,
  seatableTables,
  seatsForTable,
  summariseSeating,
  type AssignmentLike,
  type GuestLike,
} from '@novira/shared';
import { prisma, toId } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';

export const guestsRouter = Router();
guestsRouter.use(requireAuth);

/** Projects the caller may read; company members share their company's work. */
async function assertProject(userId: bigint, companyId: bigint | null, projectId: bigint) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw ApiError.notFound('That project no longer exists.');
  const mine = project.ownerId === userId;
  const shared = companyId !== null && project.companyId === companyId;
  if (!mine && !shared) throw ApiError.forbidden('That project is not yours.');
  return project;
}

async function assertPlan(userId: bigint, companyId: bigint | null, planId: bigint) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw ApiError.notFound('That plan no longer exists.');
  await assertProject(userId, companyId, plan.projectId);
  return plan;
}

const guestBody = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).default(''),
  email: z.string().trim().email().max(255).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional(),
  partyName: z.string().trim().max(120).optional(),
  guestGroup: z.string().trim().max(80).optional(),
  rsvp: z.enum(['pending', 'yes', 'no', 'maybe']).default('pending'),
  mealChoice: z.string().trim().max(80).optional(),
  dietary: z.string().trim().max(2000).optional(),
  accessibility: z.string().trim().max(2000).optional(),
  isChild: z.boolean().default(false),
  isVendorGuest: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional(),
});

function guestDto(g: {
  id: bigint;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  partyName: string | null;
  guestGroup: string | null;
  rsvp: string;
  mealChoice: string | null;
  dietary: string | null;
  accessibility: string | null;
  isChild: boolean;
  isVendorGuest: boolean;
  notes: string | null;
}) {
  return {
    id: Number(g.id),
    firstName: g.firstName,
    lastName: g.lastName,
    email: g.email,
    phone: g.phone,
    partyName: g.partyName,
    guestGroup: g.guestGroup,
    rsvp: g.rsvp,
    mealChoice: g.mealChoice,
    dietary: g.dietary,
    accessibility: g.accessibility,
    isChild: g.isChild,
    isVendorGuest: g.isVendorGuest,
    notes: g.notes,
  };
}

/* ── Guest list ────────────────────────────────────────────────────────── */

guestsRouter.get(
  '/projects/:projectId/guests',
  asyncHandler(async (req, res) => {
    const projectId = toId(req.params.projectId);
    if (!projectId) throw ApiError.notFound('Project not found.');
    await assertProject(req.user!.id, req.user!.companyId, projectId);

    const guests = await prisma.guest.findMany({
      where: { projectId },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const counts = guests.reduce(
      (acc, g) => {
        acc.total += 1;
        acc[g.rsvp as 'yes' | 'no' | 'pending' | 'maybe'] =
          (acc[g.rsvp as 'yes' | 'no' | 'pending' | 'maybe'] ?? 0) + 1;
        return acc;
      },
      { total: 0, yes: 0, no: 0, pending: 0, maybe: 0 } as Record<string, number>
    );

    res.json({ items: guests.map(guestDto), counts });
  })
);

guestsRouter.post(
  '/projects/:projectId/guests',
  asyncHandler(async (req, res) => {
    const projectId = toId(req.params.projectId);
    if (!projectId) throw ApiError.notFound('Project not found.');
    await assertProject(req.user!.id, req.user!.companyId, projectId);

    const body = guestBody.parse(req.body);
    const guest = await prisma.guest.create({
      data: {
        projectId,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email || null,
        phone: body.phone || null,
        partyName: body.partyName || null,
        guestGroup: body.guestGroup || null,
        rsvp: body.rsvp,
        mealChoice: body.mealChoice || null,
        dietary: body.dietary || null,
        accessibility: body.accessibility || null,
        isChild: body.isChild,
        isVendorGuest: body.isVendorGuest,
        notes: body.notes || null,
      },
    });
    res.status(201).json(guestDto(guest));
  })
);

/**
 * Bulk import.
 *
 * Guest lists arrive as spreadsheets, so pasting a block of rows has to work.
 * Rows that cannot be read are reported rather than silently dropped — a guest
 * quietly missing from a list is exactly the failure this feature exists to
 * prevent.
 */
guestsRouter.post(
  '/projects/:projectId/guests/import',
  asyncHandler(async (req, res) => {
    const projectId = toId(req.params.projectId);
    if (!projectId) throw ApiError.notFound('Project not found.');
    await assertProject(req.user!.id, req.user!.companyId, projectId);

    const body = z.object({ rows: z.array(z.unknown()).max(2000) }).parse(req.body);

    const created: number[] = [];
    const rejected: Array<{ row: number; reason: string }> = [];

    for (const [index, raw] of body.rows.entries()) {
      const parsed = guestBody.safeParse(raw);
      if (!parsed.success) {
        rejected.push({
          row: index + 1,
          reason: parsed.error.issues[0]?.message ?? 'could not be read',
        });
        continue;
      }
      const g = parsed.data;
      const guest = await prisma.guest.create({
        data: {
          projectId,
          firstName: g.firstName,
          lastName: g.lastName,
          email: g.email || null,
          phone: g.phone || null,
          partyName: g.partyName || null,
          guestGroup: g.guestGroup || null,
          rsvp: g.rsvp,
          mealChoice: g.mealChoice || null,
          dietary: g.dietary || null,
          accessibility: g.accessibility || null,
          isChild: g.isChild,
          isVendorGuest: g.isVendorGuest,
          notes: g.notes || null,
        },
      });
      created.push(Number(guest.id));
    }

    res.status(201).json({ created: created.length, rejected });
  })
);

guestsRouter.patch(
  '/guests/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Guest not found.');
    const existing = await prisma.guest.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('That guest no longer exists.');
    await assertProject(req.user!.id, req.user!.companyId, existing.projectId);

    const body = guestBody.partial().parse(req.body);
    const guest = await prisma.guest.update({
      where: { id },
      data: {
        ...body,
        email: body.email === '' ? null : body.email,
      },
    });
    res.json(guestDto(guest));
  })
);

guestsRouter.delete(
  '/guests/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) throw ApiError.notFound('Guest not found.');
    const existing = await prisma.guest.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('That guest no longer exists.');
    await assertProject(req.user!.id, req.user!.companyId, existing.projectId);
    await prisma.guest.delete({ where: { id } });
    res.json({ deleted: true });
  })
);

/* ── Seating ───────────────────────────────────────────────────────────── */

/** Load a plan's scene and the guest list that goes with it. */
async function loadSeatingContext(userId: bigint, companyId: bigint | null, planId: bigint) {
  const plan = await assertPlan(userId, companyId, planId);
  const sceneRow = await prisma.planScene.findUnique({ where: { planId } });
  if (!sceneRow) throw ApiError.notFound('That plan has no layout yet.');

  const scene = migrateScene(sceneRow.scene);
  const tables = seatableTables(scene);
  const guests = await prisma.guest.findMany({
    where: { projectId: plan.projectId },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  const assignments = await prisma.seatAssignment.findMany({ where: { planId } });

  return { plan, scene, tables, guests, assignments };
}

guestsRouter.get(
  '/plans/:planId/seating',
  asyncHandler(async (req, res) => {
    const planId = toId(req.params.planId);
    if (!planId) throw ApiError.notFound('Plan not found.');

    const { tables, guests, assignments } = await loadSeatingContext(
      req.user!.id,
      req.user!.companyId,
      planId
    );

    const guestLikes: GuestLike[] = guests.map((g) => ({
      id: Number(g.id),
      firstName: g.firstName,
      lastName: g.lastName,
      rsvp: g.rsvp,
      partyName: g.partyName,
      guestGroup: g.guestGroup,
      dietary: g.dietary,
      accessibility: g.accessibility,
      isChild: g.isChild,
    }));
    const assignmentLikes: AssignmentLike[] = assignments.map((a) => ({
      guestId: Number(a.guestId),
      tableObjectId: a.tableObjectId,
      seatIndex: a.seatIndex,
    }));

    res.json({
      tables: tables.map((t) => ({ ...t, seats: seatsForTable(t) })),
      guests: guests.map(guestDto),
      assignments: assignmentLikes,
      summary: summariseSeating(tables, guestLikes, assignmentLikes),
    });
  })
);

const assignBody = z.object({
  guestId: z.number().int().positive(),
  tableObjectId: z.string().trim().min(1).max(64),
  seatIndex: z.number().int().min(0).max(60).nullable().optional(),
});

guestsRouter.put(
  '/plans/:planId/seating/assign',
  asyncHandler(async (req, res) => {
    const planId = toId(req.params.planId);
    if (!planId) throw ApiError.notFound('Plan not found.');
    const { tables, guests } = await loadSeatingContext(req.user!.id, req.user!.companyId, planId);

    const body = assignBody.parse(req.body);

    const table = tables.find((t) => t.objectId === body.tableObjectId);
    if (!table) throw ApiError.badRequest('That table is not in this layout.');
    if (!guests.some((g) => Number(g.id) === body.guestId)) {
      throw ApiError.badRequest('That guest is not on this event.');
    }
    if (body.seatIndex != null && body.seatIndex >= table.seatCount) {
      throw ApiError.badRequest(
        `${table.label} has ${table.seatCount} seats, so seat ${body.seatIndex + 1} does not exist.`
      );
    }

    /*
     * A specific seat can hold one guest. Moving someone into an occupied seat
     * displaces the occupant to "anywhere at this table" rather than failing —
     * dragging onto a taken chair is a normal thing to do, and refusing it
     * makes the chart feel broken.
     */
    if (body.seatIndex != null) {
      await prisma.seatAssignment.updateMany({
        where: { planId, tableObjectId: body.tableObjectId, seatIndex: body.seatIndex },
        data: { seatIndex: null },
      });
    }

    const assignment = await prisma.seatAssignment.upsert({
      where: { planId_guestId: { planId, guestId: BigInt(body.guestId) } },
      create: {
        planId,
        guestId: BigInt(body.guestId),
        tableObjectId: body.tableObjectId,
        seatIndex: body.seatIndex ?? null,
      },
      update: { tableObjectId: body.tableObjectId, seatIndex: body.seatIndex ?? null },
    });

    res.json({
      guestId: Number(assignment.guestId),
      tableObjectId: assignment.tableObjectId,
      seatIndex: assignment.seatIndex,
    });
  })
);

guestsRouter.delete(
  '/plans/:planId/seating/:guestId',
  asyncHandler(async (req, res) => {
    const planId = toId(req.params.planId);
    const guestId = toId(req.params.guestId);
    if (!planId || !guestId) throw ApiError.notFound('Not found.');
    await assertPlan(req.user!.id, req.user!.companyId, planId);

    await prisma.seatAssignment.deleteMany({ where: { planId, guestId } });
    res.json({ deleted: true });
  })
);

/** Fill the chart, keeping any seats already set by hand. */
guestsRouter.post(
  '/plans/:planId/seating/auto',
  asyncHandler(async (req, res) => {
    const planId = toId(req.params.planId);
    if (!planId) throw ApiError.notFound('Plan not found.');
    const { tables, guests, assignments } = await loadSeatingContext(
      req.user!.id,
      req.user!.companyId,
      planId
    );

    const keepManual = z
      .object({ keepExisting: z.boolean().default(true) })
      .parse(req.body ?? {}).keepExisting;

    const guestLikes: GuestLike[] = guests.map((g) => ({
      id: Number(g.id),
      firstName: g.firstName,
      lastName: g.lastName,
      rsvp: g.rsvp,
      partyName: g.partyName,
      guestGroup: g.guestGroup,
      dietary: g.dietary,
      accessibility: g.accessibility,
      isChild: g.isChild,
    }));

    const next = autoSeat(
      tables,
      guestLikes,
      keepManual
        ? assignments.map((a) => ({
            guestId: Number(a.guestId),
            tableObjectId: a.tableObjectId,
            seatIndex: a.seatIndex,
          }))
        : []
    );

    await prisma.$transaction([
      prisma.seatAssignment.deleteMany({ where: { planId } }),
      prisma.seatAssignment.createMany({
        data: next.map((a) => ({
          planId,
          guestId: BigInt(a.guestId),
          tableObjectId: a.tableObjectId,
          seatIndex: a.seatIndex,
        })),
      }),
    ]);

    res.json({
      assigned: next.length,
      summary: summariseSeating(tables, guestLikes, next),
    });
  })
);

/**
 * The kitchen sheet: meal counts per table, plus dietary requirements.
 *
 * This is the document a caterer actually asks for, and getting it wrong has
 * consequences at the event rather than in the software, so allergies are
 * listed individually by name rather than only counted.
 */
guestsRouter.get(
  '/plans/:planId/seating/catering',
  asyncHandler(async (req, res) => {
    const planId = toId(req.params.planId);
    if (!planId) throw ApiError.notFound('Plan not found.');
    const { tables, guests, assignments } = await loadSeatingContext(
      req.user!.id,
      req.user!.companyId,
      planId
    );

    const guestLikes = guests.map((g) => ({
      id: Number(g.id),
      firstName: g.firstName,
      lastName: g.lastName,
      rsvp: g.rsvp,
      mealChoice: g.mealChoice,
      dietary: g.dietary,
      partyName: g.partyName,
      guestGroup: g.guestGroup,
      accessibility: g.accessibility,
      isChild: g.isChild,
    }));
    const assignmentLikes = assignments.map((a) => ({
      guestId: Number(a.guestId),
      tableObjectId: a.tableObjectId,
      seatIndex: a.seatIndex,
    }));

    const perTable = mealCounts(guestLikes, assignmentLikes);
    const byTable = tables.map((t) => ({
      objectId: t.objectId,
      label: t.label,
      meals: Object.fromEntries(perTable.get(t.objectId) ?? []),
    }));

    const totals = new Map<string, number>();
    for (const table of perTable.values()) {
      for (const [meal, count] of table) totals.set(meal, (totals.get(meal) ?? 0) + count);
    }

    const seatedIds = new Set(assignmentLikes.map((a) => a.guestId));
    const dietary = guests
      .filter((g) => g.rsvp === 'yes' && (g.dietary?.trim() || g.accessibility?.trim()))
      .map((g) => {
        const seat = assignments.find((a) => Number(a.guestId) === Number(g.id));
        const table = seat ? tables.find((t) => t.objectId === seat.tableObjectId) : null;
        return {
          name: `${g.firstName} ${g.lastName}`.trim(),
          table: table?.label ?? 'Not seated',
          dietary: g.dietary,
          accessibility: g.accessibility,
        };
      });

    res.json({
      byTable,
      totals: Object.fromEntries(totals),
      dietary,
      unseatedAttending: guests.filter((g) => g.rsvp === 'yes' && !seatedIds.has(Number(g.id))).length,
    });
  })
);
