/**
 * Analytics and insights.
 *
 * The four questions the brief asks are all "across everything we have done,
 * what worked?" — which is a question an agency currently cannot answer at all,
 * because the drawing, the quote and the outcome live in three different
 * places. Here they are one row, so the aggregation is possible.
 *
 * One rule runs through this file: **a rate computed from too few samples is
 * not reported**. Two proposals and one win is not a 50 % conversion rate, and
 * presenting it as one invites a decision the data cannot support. Those rows
 * come back with `conversionBp: null` and the UI says how many more are needed.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  conversionRate,
  hoursSaved,
  median,
  migrateScene,
  MANUAL_HOURS,
  type BoothSceneObject,
  type LayoutUsageRow,
  type BoothEfficiencyRow,
  type SceneDocument,
} from '@novira/shared';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthedUser } from '../middleware/auth.js';

export const insightsRouter = Router();
insightsRouter.use(requireAuth);

/** Projects this user can report on: their own, plus the company's. */
function projectScope(user: AuthedUser) {
  return { OR: [{ ownerId: user.id }, ...(user.companyId ? [{ companyId: user.companyId }] : [])] };
}

/**
 * Classify a scene into a layout family.
 *
 * Deliberately coarse. The question is "which of the handful of things we do
 * actually wins", and splitting that into forty near-identical variants would
 * put every bucket below the sample floor and answer nothing.
 */
function classifyLayout(scene: SceneDocument): { key: string; label: string } {
  const types = new Set(scene.objects.filter((o) => !o.hidden).map((o) => o.type));
  const boothCount = scene.objects.filter((o) => o.type === 'booth').length;
  const tableCount = scene.objects.filter(
    (o) => o.type === 'catalog' && Boolean((o as { tableShape?: string | null }).tableShape)
  ).length;

  if (boothCount >= 4) return { key: 'exhibition', label: 'Exhibition floor' };
  if (boothCount >= 1) return { key: 'single-stand', label: 'Single stand' };
  if (types.has('stage') && types.has('led') && tableCount >= 4) return { key: 'gala', label: 'Gala with stage and screen' };
  if (types.has('stage') && types.has('led')) return { key: 'conference', label: 'Conference with stage and screen' };
  if (types.has('stage')) return { key: 'stage-only', label: 'Stage, no screen' };
  if (tableCount >= 4) return { key: 'banquet', label: 'Banquet' };
  if (types.has('tent')) return { key: 'marquee', label: 'Marquee' };
  return { key: 'other', label: 'Other layouts' };
}

/** Nearest standard stand size, so 5.9 × 3.1 m buckets with 6 × 3 m. */
function classifyBoothSize(booth: BoothSceneObject): { label: string; areaSqM: number } {
  const w = Math.round(booth.widthMm / 1000);
  const d = Math.round(booth.depthMm / 1000);
  const [long, short] = w >= d ? [w, d] : [d, w];
  return { label: `${long} × ${short} m`, areaSqM: Math.round(((booth.widthMm * booth.depthMm) / 1_000_000) * 10) / 10 };
}

const rangeQuery = z.object({
  /** Days of history to report on. */
  days: z.coerce.number().int().min(7).max(1095).default(365),
});

insightsRouter.get(
  '/insights',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const query = rangeQuery.parse(req.query);
    const since = new Date(Date.now() - query.days * 86_400_000);

    const projects = await prisma.project.findMany({
      where: { ...projectScope(user), createdAt: { gte: since } },
      select: { id: true, createdAt: true },
    });
    const projectIds = projects.map((p) => p.id);

    const [plans, proposals] = await Promise.all([
      projectIds.length
        ? prisma.plan.findMany({
            where: { projectId: { in: projectIds } },
            select: { id: true, projectId: true, createdAt: true, scene: { select: { scene: true } } },
          })
        : Promise.resolve([]),
      projectIds.length
        ? prisma.proposal.findMany({
            where: { projectId: { in: projectIds } },
            select: { id: true, projectId: true, status: true, currency: true, createdAt: true, sentAt: true, lines: true },
          })
        : Promise.resolve([]),
    ]);

    /*
     * A proposal belongs to a project, and a project may hold several plans, so
     * a proposal's outcome is attributed to every layout family that project
     * contained. That is the honest attribution available without asking a
     * planner to link a proposal to a specific layout, and it is stated in the
     * UI so nobody reads more into it than it supports.
     */
    const layoutsByProject = new Map<string, Set<string>>();
    const labels = new Map<string, string>();
    const boothStats = new Map<string, { label: string; areaSqM: number; projects: Set<string>; plans: number }>();

    for (const plan of plans) {
      const scene = migrateScene(plan.scene?.scene);
      const layout = classifyLayout(scene);
      labels.set(layout.key, layout.label);
      const set = layoutsByProject.get(String(plan.projectId)) ?? new Set<string>();
      set.add(layout.key);
      layoutsByProject.set(String(plan.projectId), set);

      for (const object of scene.objects) {
        if (object.type !== 'booth') continue;
        const size = classifyBoothSize(object as BoothSceneObject);
        const entry = boothStats.get(size.label) ?? { label: size.label, areaSqM: size.areaSqM, projects: new Set<string>(), plans: 0 };
        entry.projects.add(String(plan.projectId));
        entry.plans += 1;
        boothStats.set(size.label, entry);
      }
    }

    const proposalValue = (lines: unknown): number => {
      if (!Array.isArray(lines)) return 0;
      return (lines as Array<{ quantityMilli?: number; unitPrice?: number }>).reduce(
        (sum, l) => sum + Math.round(((l.quantityMilli ?? 0) * (l.unitPrice ?? 0)) / 1000),
        0
      );
    };

    const sentProposals = proposals.filter((p) => p.status !== 'draft');
    const wonProposals = proposals.filter((p) => p.status === 'accepted');
    const currency = proposals[0]?.currency ?? 'usd';

    /* ── Layout usage ────────────────────────────────────────────────── */

    const layoutRows: LayoutUsageRow[] = [...labels.keys()].map((key) => {
      const projectsWithLayout = [...layoutsByProject.entries()]
        .filter(([, set]) => set.has(key))
        .map(([projectId]) => projectId);
      const set = new Set(projectsWithLayout);

      const relevantSent = sentProposals.filter((p) => set.has(String(p.projectId)));
      const relevantWon = wonProposals.filter((p) => set.has(String(p.projectId)));

      return {
        key,
        label: labels.get(key) ?? key,
        plans: plans.filter((p) => {
          const set2 = layoutsByProject.get(String(p.projectId));
          return set2?.has(key);
        }).length,
        won: relevantWon.length,
        conversionBp: conversionRate(relevantWon.length, relevantSent.length),
        medianValue: median(relevantWon.map((p) => proposalValue(p.lines))),
        currency,
      };
    });
    layoutRows.sort((a, b) => b.plans - a.plans);

    /* ── Booth efficiency ────────────────────────────────────────────── */

    const boothRows: BoothEfficiencyRow[] = [...boothStats.values()].map((entry) => {
      const relevantSent = sentProposals.filter((p) => entry.projects.has(String(p.projectId)));
      const relevantWon = wonProposals.filter((p) => entry.projects.has(String(p.projectId)));
      const values = relevantWon.map((p) => proposalValue(p.lines));
      const medianValue = median(values);

      return {
        sizeLabel: entry.label,
        areaSqM: entry.areaSqM,
        plans: entry.plans,
        costPerSqM: medianValue && entry.areaSqM > 0 ? Math.round(medianValue / entry.areaSqM) : null,
        conversionBp: conversionRate(relevantWon.length, relevantSent.length),
        medianValue,
        currency,
        // Value per square metre bought — the number that says whether the
        // bigger stand was actually worth it.
        valuePerSqM: medianValue && entry.areaSqM > 0 ? Math.round(medianValue / entry.areaSqM) : null,
      };
    });
    boothRows.sort((a, b) => a.areaSqM - b.areaSqM);

    /* ── Time to proposal ────────────────────────────────────────────── */

    const daysToProposal: number[] = [];
    for (const proposal of sentProposals) {
      const projectPlans = plans.filter((p) => String(p.projectId) === String(proposal.projectId));
      const first = projectPlans.map((p) => p.createdAt.getTime()).sort()[0];
      const sent = (proposal.sentAt ?? proposal.createdAt).getTime();
      if (first && sent > first) daysToProposal.push(Math.round((sent - first) / 86_400_000));
    }

    /* ── Time saved ──────────────────────────────────────────────────── */

    const [renderCount, jobCounts] = await Promise.all([
      prisma.aiRender.count({ where: { plan: { ownerId: user.id }, createdAt: { gte: since } } }),
      prisma.aiJob.groupBy({
        by: ['processType'],
        where: { userId: user.id, status: 'completed', createdAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);
    const jobsByType = new Map(jobCounts.map((j) => [j.processType, j._count._all]));

    const saved = hoursSaved({
      // Every plan with objects has had its quantities measured automatically,
      // which is the largest single saving and the easiest to under-claim.
      takeoff: plans.length,
      boq: sentProposals.length,
      technicalDrawing: sentProposals.length,
      render4k: renderCount,
      walkthroughVideo: jobsByType.get('video_render') ?? 0,
      presentationDeck: jobsByType.get('deck_generation') ?? 0,
      cadExport: 0,
    });

    res.json({
      summary: {
        totalProjects: projects.length,
        totalPlans: plans.length,
        proposalsSent: sentProposals.length,
        proposalsWon: wonProposals.length,
        conversionBp: conversionRate(wonProposals.length, sentProposals.length),
        wonValue: wonProposals.reduce((sum, p) => sum + proposalValue(p.lines), 0),
        currency,
        medianDaysToProposal: median(daysToProposal),
        hoursSaved: saved,
      },
      layouts: layoutRows,
      booths: boothRows,
      manualHours: MANUAL_HOURS,
      rangeDays: query.days,
      /*
       * The sample floor is returned so the UI can explain a null rate rather
       * than showing a dash and leaving people to guess whether it is a bug.
       */
      minimumSample: 3,
    });
  })
);
