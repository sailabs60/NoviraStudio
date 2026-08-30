/**
 * The estimator.
 *
 * Ties three pure modules from `shared` to the database: measure the scene
 * (`takeoff`), resolve the rate card that should price it (`rates`), and price
 * it. None of the arithmetic lives here — this file only decides *which* rate
 * card applies, which is the one part that needs to know about users, companies
 * and regions.
 *
 * Resolution order, most specific first: the card the plan names, the company
 * default, the user default, then the built-in card for the plan's region. A
 * plan always prices, even for an account that has never opened the rate
 * editor, because an estimate that refuses to appear until someone configures
 * something is an estimate nobody ever sees.
 */
import {
  defaultRateCard,
  migrateScene,
  priceTakeoff,
  regionPack,
  takeoff,
  type LabourRates,
  type PricedTakeoff,
  type RateCard,
  type RateLine,
  type SceneDocument,
  type TakeoffResult,
} from '@novira/shared';
import { prisma } from '../lib/prisma.js';
import type { AuthedUser } from '../middleware/auth.js';

export interface RateCardRow {
  id: bigint;
  ownerId: bigint | null;
  companyId: bigint | null;
  name: string;
  currency: string;
  regionCode: string;
  adjustmentBp: number;
  crewRate: number;
  lines: unknown;
  labourOverrides: unknown;
  isDefault: boolean;
  updatedAt: Date;
}

export function rateCardFromRow(row: RateCardRow): RateCard {
  const lines = Array.isArray(row.lines) ? (row.lines as RateLine[]) : [];
  return {
    id: Number(row.id),
    name: row.name,
    currency: row.currency,
    regionCode: row.regionCode,
    adjustmentBp: row.adjustmentBp,
    // A card saved with no lines would price nothing, which reads as a broken
    // estimator rather than an empty card. Fall back to the built-in lines.
    lines: lines.length ? lines : defaultRateCard(row.currency, row.regionCode).lines,
    crewRate: row.crewRate,
    labourOverrides: (row.labourOverrides as Record<string, number> | null) ?? undefined,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Cards this user may read: their own, plus any their company shares. */
export function rateCardScope(user: AuthedUser) {
  return { OR: [{ ownerId: user.id }, ...(user.companyId ? [{ companyId: user.companyId }] : [])] };
}

/**
 * Which card prices this plan.
 *
 * `preferredId` is the card named on the scene document. It is checked against
 * the same scope as everything else, so a card id copied from another
 * workspace resolves to nothing rather than leaking that workspace's pricing.
 */
/**
 * The built-in rate card, adapted for a market.
 *
 * Two separate corrections, and it matters that they stay separate. The
 * built-in rates are US-cent figures:
 *
 *  · `fxPerUsd` fixes the *currency* — without it, 3,800 US cents relabelled
 *    "TZS 3,800" is a real number in the wrong currency by a factor of about
 *    2,500, not a price anyone could quote in shillings.
 *  · `adjustmentBp` (set on the returned card) fixes the *level* — a plan in
 *    Dar es Salaam or Nairobi priced at raw mid-market US rates is roughly
 *    40–50 % too high even once the currency is right.
 *
 * Both are crude, and both are labelled as such in the UI: a starting point
 * that tells the user to enter their own rates, not a claim to know local
 * pricing or track FX. Shared by the take-off's own resolver and by "create a
 * rate card seeded from this region" — a card built by either path should
 * read the same.
 */
export function regionalDefaultRateCard(pack: ReturnType<typeof regionPack>): RateCard {
  const card = defaultRateCard(pack.currency, pack.code);

  if (pack.fxPerUsd !== 1) {
    const fx = (minorUnits: number) => Math.round(minorUnits * pack.fxPerUsd);
    card.lines = card.lines.map((line) => ({
      ...line,
      unitPrice: fx(line.unitPrice),
      unitCost: line.unitCost != null ? fx(line.unitCost) : line.unitCost,
      minimumCharge: line.minimumCharge != null ? fx(line.minimumCharge) : line.minimumCharge,
    }));
    card.crewRate = fx(card.crewRate);
  }

  card.adjustmentBp = pack.costIndexBp - 10_000;
  card.name = pack.code === 'global' ? 'Novira default rates' : `Novira default rates (${pack.label})`;
  return card;
}

export async function resolveRateCard(
  user: AuthedUser,
  opts: { preferredId?: number | null; regionCode?: string } = {}
): Promise<RateCard> {
  const region = opts.regionCode ?? 'global';

  if (opts.preferredId) {
    const named = await prisma.rateCard.findFirst({
      where: { id: BigInt(opts.preferredId), ...rateCardScope(user) },
    });
    if (named) return rateCardFromRow(named);
  }

  if (user.companyId) {
    const companyDefault = await prisma.rateCard.findFirst({
      where: { companyId: user.companyId, isDefault: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (companyDefault) return rateCardFromRow(companyDefault);
  }

  const own = await prisma.rateCard.findFirst({
    where: { ownerId: user.id, isDefault: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (own) return rateCardFromRow(own);

  const anyOwned = await prisma.rateCard.findFirst({
    where: rateCardScope(user),
    orderBy: { updatedAt: 'desc' },
  });
  if (anyOwned) return rateCardFromRow(anyOwned);

  return regionalDefaultRateCard(regionPack(region));
}

export interface PlanEstimate {
  planId: number;
  scene: SceneDocument;
  takeoff: TakeoffResult;
  priced: PricedTakeoff;
  card: RateCard;
  regionCode: string;
}

/** Measure and price one plan. */
export async function estimatePlan(
  user: AuthedUser,
  planId: bigint,
  opts: { rateCardId?: number | null } = {}
): Promise<PlanEstimate> {
  const sceneRow = await prisma.planScene.findUnique({ where: { planId } });
  const scene = migrateScene(sceneRow?.scene);

  const card = await resolveRateCard(user, {
    preferredId: opts.rateCardId ?? scene.rateCardId,
    regionCode: scene.regionCode,
  });

  const measured = takeoff(scene, (card.labourOverrides ?? {}) as Partial<LabourRates>);
  const priced = priceTakeoff(measured.lines, card);

  return {
    planId: Number(planId),
    scene,
    takeoff: measured,
    priced,
    card,
    regionCode: scene.regionCode,
  };
}

/** Serialise a card for the wire, without the row's bigints. */
export function rateCardDto(row: RateCardRow) {
  return {
    id: Number(row.id),
    name: row.name,
    currency: row.currency,
    regionCode: row.regionCode,
    adjustmentBp: row.adjustmentBp,
    crewRate: row.crewRate,
    lines: Array.isArray(row.lines) ? row.lines : [],
    labourOverrides: (row.labourOverrides as Record<string, number> | null) ?? null,
    isDefault: row.isDefault,
    scope: row.companyId ? ('company' as const) : ('personal' as const),
    updatedAt: row.updatedAt.toISOString(),
  };
}
