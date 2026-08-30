/**
 * Feature access.
 *
 * Four independent axes gate a feature, and *all four* must permit it:
 *
 *   1. subscription tier   free | plus | pro
 *   2. role                super admins bypass every gate below
 *   3. company flags       per-tenant enable/disable
 *   4. credit balance      checked at run time, not at render time
 *
 * The UI deliberately shows locked features rather than hiding them, so this
 * module returns a structured reason the client can render — and the same
 * check is enforced again on the server before any work happens.
 */
import type { FeatureCode, PlanTier } from '@novira/shared';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { availableCredits, creditCost } from './credits.js';
import type { AuthedUser } from '../middleware/auth.js';

/** Minimum tier that may run each metered feature. */
const FEATURE_MIN_TIER: Record<FeatureCode, PlanTier> = {
  ai_image_to_3d: 'plus',
  ai_enhance: 'plus',
  ai_enhance_pro: 'plus',
  floor_plan_ai_draw: 'plus',
  map_import: 'plus',
  venue_generation: 'plus',
  ai_concept: 'plus',
  photo_analysis: 'plus',
  // Pro-quality output is the Pro plan's reason to exist.
  pro_render: 'pro',
  video_render: 'pro',
  deck_generation: 'plus',
  ai_text_to_3d: 'plus',
  ai_mockup: 'plus',
  /*
   * Refinement and the assistant are open to everyone.
   *
   * They are how somebody finds out whether the generative work is worth
   * paying for, and gating the try-before-you-buy behind the buy is the
   * shortest route to nobody ever trying it. Both are cheap enough that the
   * free tier's zero balance is the real limit.
   */
  ai_prompt_refine: 'free',
  ai_assistant: 'free',
};

const TIER_RANK: Record<PlanTier, number> = { free: 0, plus: 1, pro: 2 };

export type LockReason = 'plan' | 'company' | 'credits' | 'role' | null;

export interface AccessResult {
  allowed: boolean;
  reason: LockReason;
  message: string | null;
  requiredTier: PlanTier;
  cost: number;
  balance: number;
}

export function meetsTier(userTier: PlanTier, required: PlanTier): boolean {
  return TIER_RANK[userTier] >= TIER_RANK[required];
}

/** Company-level switch for a specific feature, where one exists. */
async function companyAllows(companyId: bigint | null, featureCode: FeatureCode): Promise<boolean> {
  if (!companyId) return true;
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { aiImageTo3dEnabled: true, venueGenerationAccess: true, isActive: true },
  });
  if (!company || !company.isActive) return false;
  if (featureCode === 'ai_image_to_3d') return company.aiImageTo3dEnabled;
  if (featureCode === 'venue_generation') return company.venueGenerationAccess !== 'blocked';
  return true;
}

/**
 * Evaluate a metered feature for a user without consuming anything.
 * Used both for the UI's lock state and as the server-side preflight.
 */
export async function checkFeature(user: AuthedUser, featureCode: FeatureCode): Promise<AccessResult> {
  const requiredTier = FEATURE_MIN_TIER[featureCode] ?? 'plus';
  const cost = await creditCost(featureCode);

  // Super admins bypass plan, company and credit gating entirely.
  if (user.role === 'super_admin') {
    return { allowed: true, reason: null, message: null, requiredTier, cost: 0, balance: Number.MAX_SAFE_INTEGER };
  }

  const { balance } = await availableCredits(user.id);

  if (!(await companyAllows(user.companyId, featureCode))) {
    return {
      allowed: false,
      reason: 'company',
      message: 'This workflow is turned off for this account. An administrator can re-enable it.',
      requiredTier,
      cost,
      balance,
    };
  }

  if (!meetsTier(user.planTier, requiredTier)) {
    return {
      allowed: false,
      reason: 'plan',
      message: 'This feature is available on Plus and Pro plans.',
      requiredTier,
      cost,
      balance,
    };
  }

  if (balance < cost) {
    return {
      allowed: false,
      reason: 'credits',
      message: `This action needs ${cost} credits; you have ${balance}.`,
      requiredTier,
      cost,
      balance,
    };
  }

  return { allowed: true, reason: null, message: null, requiredTier, cost, balance };
}

/** Preflight that throws the right typed error. Call before starting any job. */
export async function assertFeature(user: AuthedUser, featureCode: FeatureCode): Promise<AccessResult> {
  const result = await checkFeature(user, featureCode);
  if (result.allowed) return result;
  if (result.reason === 'credits') throw ApiError.insufficientCredits(result.cost, result.balance);
  if (result.reason === 'company') throw ApiError.forbidden(result.message!, 'FEATURE_DISABLED');
  throw ApiError.upgradeRequired(result.message ?? undefined);
}

/**
 * Whether a user may place a given catalogue item.
 *
 * Free accounts get only items explicitly flagged for the free plan; company
 * tenants can have the global library switched off entirely.
 */
export interface CatalogAccessInput {
  scope: string;
  isFreePlanAvailable: boolean;
  companyId: bigint | null;
  ownerId: bigint | null;
}

export async function catalogItemAccess(
  user: AuthedUser | undefined,
  item: CatalogAccessInput
): Promise<{ accessible: boolean; reason: LockReason }> {
  if (!user) return { accessible: item.isFreePlanAvailable, reason: 'plan' };
  if (user.role === 'super_admin') return { accessible: true, reason: null };

  // Personal items belong to their owner; company items to the tenant.
  if (item.scope === 'personal') {
    return { accessible: item.ownerId === user.id, reason: item.ownerId === user.id ? null : 'role' };
  }
  if (item.scope === 'company') {
    const same = item.companyId !== null && item.companyId === user.companyId;
    return { accessible: same, reason: same ? null : 'role' };
  }

  // Global library.
  if (user.companyId) {
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { globalModelsEnabled: true },
    });
    if (company && !company.globalModelsEnabled) return { accessible: false, reason: 'company' };
  }
  if (user.planTier === 'free' && !item.isFreePlanAvailable) {
    return { accessible: false, reason: 'plan' };
  }
  return { accessible: true, reason: null };
}

/** Whether the global texture library is available to this user. */
export async function globalTexturesEnabled(user: AuthedUser | undefined): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (!user.companyId) return true;
  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: { globalTexturesEnabled: true },
  });
  return company?.globalTexturesEnabled ?? true;
}

/** May this user create or edit shared catalogue/texture assets? */
export async function canManageAssets(user: AuthedUser): Promise<boolean> {
  if (user.role === 'super_admin') return true;
  if (!user.companyId) return false;
  if (user.companyRole !== 'admin' && user.role !== 'company_admin') return false;
  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: { companyAdminCanManageAssets: true },
  });
  return company?.companyAdminCanManageAssets ?? false;
}
