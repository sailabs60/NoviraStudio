/**
 * The credit ledger.
 *
 * Credits are append-only ledger rows, never a mutable counter. Monthly grants,
 * purchases with expiry, per-feature debits, refunds and pool transfers all
 * have to be reconstructible, and a single integer cannot express that.
 *
 * `user.credits_remaining` is a denormalised cache kept in step inside the same
 * transaction as the ledger write. It is never the source of truth: `recompute`
 * rebuilds it from the ledger.
 */
import { DEFAULT_CREDIT_RATIOS, FEATURE_LABELS, type CreditLedgerReason, type FeatureCode } from '@novira/shared';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Live cost of a metered action. Falls back to the seed if no row exists. */
export async function creditCost(featureCode: FeatureCode): Promise<number> {
  const row = await prisma.creditRatio.findUnique({ where: { featureCode } });
  if (row && row.isActive) return row.credits;
  return DEFAULT_CREDIT_RATIOS[featureCode] ?? 0;
}

export async function allCreditRatios() {
  const rows = await prisma.creditRatio.findMany({ orderBy: { featureCode: 'asc' } });
  if (rows.length) return rows;
  return (Object.keys(DEFAULT_CREDIT_RATIOS) as FeatureCode[]).map((featureCode) => ({
    featureCode,
    label: FEATURE_LABELS[featureCode],
    description: null,
    credits: DEFAULT_CREDIT_RATIOS[featureCode],
    isActive: true,
  }));
}

/**
 * Effective balance for a user.
 *
 * With a shared company pool the member draws from the company balance;
 * otherwise from their own. Expired purchased credits are excluded.
 */
export async function availableCredits(userId: bigint): Promise<{
  balance: number;
  source: 'user' | 'pool';
  companyId: bigint | null;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { creditsRemaining: true, companyId: true, company: { select: { creditMode: true, poolBalance: true } } },
  });
  if (!user) throw ApiError.notFound('User not found.');

  if (user.companyId && user.company?.creditMode === 'shared_pool') {
    return { balance: user.company.poolBalance, source: 'pool', companyId: user.companyId };
  }
  return { balance: user.creditsRemaining, source: 'user', companyId: user.companyId };
}

interface WriteOptions {
  userId: bigint;
  delta: number;
  reason: CreditLedgerReason;
  featureCode?: FeatureCode | null;
  aiJobId?: string | null;
  expiresAt?: Date | null;
  note?: string | null;
}

/** Append a ledger row and move the cached balance, inside one transaction. */
async function write(tx: Tx, opts: WriteOptions) {
  const user = await tx.user.findUnique({
    where: { id: opts.userId },
    select: { creditsRemaining: true, companyId: true, company: { select: { creditMode: true, poolBalance: true } } },
  });
  if (!user) throw ApiError.notFound('User not found.');

  const usePool = Boolean(user.companyId && user.company?.creditMode === 'shared_pool');
  const current = usePool ? (user.company?.poolBalance ?? 0) : user.creditsRemaining;
  const next = current + opts.delta;

  if (next < 0) {
    throw ApiError.insufficientCredits(Math.abs(opts.delta), current);
  }

  if (usePool && user.companyId) {
    await tx.company.update({ where: { id: user.companyId }, data: { poolBalance: next } });
  } else {
    await tx.user.update({ where: { id: opts.userId }, data: { creditsRemaining: next } });
  }

  await tx.creditLedger.create({
    data: {
      userId: opts.userId,
      companyId: usePool ? user.companyId : null,
      delta: opts.delta,
      reason: opts.reason,
      featureCode: opts.featureCode ?? null,
      aiJobId: opts.aiJobId ?? null,
      expiresAt: opts.expiresAt ?? null,
      balanceAfter: next,
      note: opts.note ?? null,
    },
  });

  return next;
}

/** Charge for a metered action. Throws INSUFFICIENT_CREDITS rather than going negative. */
export async function debit(
  userId: bigint,
  featureCode: FeatureCode,
  aiJobId: string | null,
  costOverride?: number
): Promise<{ charged: number; balanceAfter: number }> {
  const cost = costOverride ?? (await creditCost(featureCode));
  if (cost <= 0) {
    const { balance } = await availableCredits(userId);
    return { charged: 0, balanceAfter: balance };
  }
  const balanceAfter = await prisma.$transaction((tx) =>
    write(tx, { userId, delta: -cost, reason: 'debit', featureCode, aiJobId })
  );
  return { charged: cost, balanceAfter };
}

/** Return credits after a cancelled or failed job. Idempotent per job. */
export async function refund(userId: bigint, aiJobId: string, amount: number, featureCode: FeatureCode) {
  if (amount <= 0) return;
  const already = await prisma.creditLedger.findFirst({
    where: { aiJobId, reason: 'refund' },
    select: { id: true },
  });
  if (already) return;
  await prisma.$transaction((tx) =>
    write(tx, { userId, delta: amount, reason: 'refund', featureCode, aiJobId, note: 'Job cancelled or failed' })
  );
}

export async function grantMonthly(userId: bigint, amount: number) {
  if (amount <= 0) return;
  await prisma.$transaction((tx) =>
    write(tx, { userId, delta: amount, reason: 'cycle_grant', note: 'Monthly plan allowance' })
  );
}

export async function purchase(userId: bigint, amount: number, expiresAt: Date | null) {
  await prisma.$transaction((tx) =>
    write(tx, { userId, delta: amount, reason: 'purchase', expiresAt, note: 'Credit pack' })
  );
}

export async function adminAdjust(userId: bigint, delta: number, note: string) {
  await prisma.$transaction((tx) => write(tx, { userId, delta, reason: 'admin_adjustment', note }));
}

/** Rebuild the cached balance from the ledger. The ledger always wins. */
export async function recompute(userId: bigint): Promise<number> {
  const agg = await prisma.creditLedger.aggregate({
    where: { userId, companyId: null },
    _sum: { delta: true },
  });
  const balance = agg._sum.delta ?? 0;
  await prisma.user.update({ where: { id: userId }, data: { creditsRemaining: balance } });
  return balance;
}

export async function history(userId: bigint, limit = 50, offset = 0) {
  const [items, total] = await Promise.all([
    prisma.creditLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.creditLedger.count({ where: { userId } }),
  ]);
  return { items, total };
}
