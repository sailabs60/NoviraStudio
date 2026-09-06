/**
 * Create or reset the standing sign-in accounts, on boot, when asked to.
 *
 * The demo seeder refuses to run against anything that is not localhost, and
 * rightly so — its default password is public. But the accounts themselves are
 * wanted in the deployed app: the same three sign-ins, the same super-admin,
 * the same company seats, so the people who use this do not have to keep a
 * separate set of credentials for production.
 *
 * This is the safe half of that. It runs only when `SEED_ACCOUNTS_PASSWORD` is
 * set, it refuses a weak password outright, and it is idempotent — running it
 * again resets the passwords rather than duplicating anyone. Once the accounts
 * exist the variable should be removed; leaving it set simply means the
 * passwords are reset to the same value on every deploy, which is harmless but
 * pointless.
 *
 * Deliberately *not* a route. An HTTP endpoint that mints a super-admin is a
 * permanent liability no matter how well guarded; a boot-time step gated on a
 * variable only the deployment owner can set is not reachable from outside at
 * all.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import type { MemberRole, MemberVisibility, PlanTier, UserRole } from '@novira/shared';
import { prisma } from '../lib/prisma.js';
import { grantMonthly, recompute } from '../services/credits.js';

const COMPANY_NAME = 'Ashgrove Event Hire';
const DOMAIN = process.env.SEED_ACCOUNTS_DOMAIN ?? 'novira.test';

/** Long enough that it cannot be guessed, and not the public demo password. */
const MIN_PASSWORD_LENGTH = 12;
const FORBIDDEN = new Set(['novira123', 'password', 'changeme', 'admin123']);

type Account = {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  planTier: PlanTier;
  credits: number;
  seat: { role: MemberRole; visibility: MemberVisibility } | null;
};

/** The same three accounts the local database has, so habits carry over. */
const ACCOUNTS: Account[] = [
  {
    email: `planner@${DOMAIN}`,
    firstName: 'Ada',
    lastName: 'Planner',
    role: 'super_admin',
    planTier: 'pro',
    credits: 200,
    seat: null,
  },
  {
    email: `studio@${DOMAIN}`,
    firstName: 'Sam',
    lastName: 'Studio',
    role: 'user',
    planTier: 'pro',
    credits: 0,
    seat: { role: 'admin', visibility: 'company_wide' },
  },
  {
    email: `designer@${DOMAIN}`,
    firstName: 'Dee',
    lastName: 'Designer',
    role: 'user',
    planTier: 'plus',
    credits: 100,
    seat: { role: 'member', visibility: 'own_only' },
  },
];

async function upsertCompany() {
  const existing = await prisma.company.findFirst({ where: { name: COMPANY_NAME } });
  if (existing) return existing;
  return prisma.company.create({
    data: {
      name: COMPANY_NAME,
      mainEmail: `studio@${DOMAIN}`,
      city: 'Bristol',
      country: 'GB',
      creditMode: 'pooled',
      poolBalance: 250,
    },
  });
}

async function upsertAccount(account: Account, passwordHash: string, companyId: bigint | null) {
  const record = await prisma.user.upsert({
    where: { email: account.email },
    create: {
      email: account.email,
      passwordHash,
      firstName: account.firstName,
      lastName: account.lastName,
      role: account.role,
      planTier: account.planTier,
      companyId,
      isEmailVerified: true,
      monthlyCreditQuota: account.credits,
      onboardingCompletedAt: new Date(),
    },
    update: {
      // Reset the sign-in and the entitlements; leave their projects alone.
      passwordHash,
      role: account.role,
      planTier: account.planTier,
      companyId,
      isBlocked: false,
      isEmailVerified: true,
      monthlyCreditQuota: account.credits,
    },
  });

  // The ledger is the source of truth for balances, so top up through it
  // rather than writing `creditsRemaining` directly.
  const balance = await recompute(record.id);
  if (balance < account.credits) await grantMonthly(record.id, account.credits - balance);
  await recompute(record.id);

  return record;
}

async function upsertSeat(companyId: bigint, userId: bigint, account: Account) {
  if (!account.seat) return;
  await prisma.companyMember.upsert({
    where: { companyId_invitedEmail: { companyId, invitedEmail: account.email } },
    create: {
      companyId,
      userId,
      invitedEmail: account.email,
      role: account.seat.role,
      visibility: account.seat.visibility,
      seatPlanTier: account.planTier,
      status: 'active',
    },
    update: {
      userId,
      role: account.seat.role,
      visibility: account.seat.visibility,
      seatPlanTier: account.planTier,
      status: 'active',
    },
  });
}

export async function seedAccountsIfRequested(): Promise<void> {
  const password = (process.env.SEED_ACCOUNTS_PASSWORD ?? '').trim();
  if (!password) return;

  if (password.length < MIN_PASSWORD_LENGTH || FORBIDDEN.has(password.toLowerCase())) {
    console.error(
      `[seed:accounts] refusing to seed: SEED_ACCOUNTS_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} ` +
        'characters and must not be one of the well-known demo passwords.'
    );
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const company = ACCOUNTS.some((a) => a.seat) ? await upsertCompany() : null;

    for (const account of ACCOUNTS) {
      const companyId = account.seat && company ? company.id : null;
      const user = await upsertAccount(account, passwordHash, companyId);
      if (companyId) await upsertSeat(companyId, user.id, account);
      console.log(`[seed:accounts] ready: ${account.email} (${account.role})`);
    }
    console.log('[seed:accounts] done. Remove SEED_ACCOUNTS_PASSWORD once you have signed in.');
  } catch (err) {
    // Never take the API down over this: the accounts are a convenience, and a
    // server that refuses to boot because a seed failed is a worse outcome.
    console.error('[seed:accounts] failed:', err instanceof Error ? err.message : err);
  }
}
