/**
 * Seed the demo accounts used for local development and the end-to-end tests.
 *
 * Kept separate from `seed.ts`, which seeds server-driven configuration that a
 * real deployment also needs. These are throwaway sign-ins and must never run
 * against a production database, so the script refuses unless it is pointed at
 * a local host or explicitly forced.
 *
 * Idempotent: re-running resets the passwords and credit balances back to the
 * documented values without duplicating anyone.
 */
import bcrypt from 'bcryptjs';
import type { MemberRole, MemberVisibility, PlanTier, UserRole } from '@novira/shared';
import { prisma } from '../lib/prisma.js';
import { grantMonthly, recompute } from '../services/credits.js';

const PASSWORD = process.env.DEMO_PASSWORD ?? 'novira123';
const COMPANY_NAME = 'Ashgrove Event Hire';

type DemoUser = {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  planTier: PlanTier;
  credits: number;
  /** Company seat, or null for a solo account. */
  seat: { role: MemberRole; visibility: MemberVisibility } | null;
};

const USERS: DemoUser[] = [
  {
    email: 'planner@novira.test',
    firstName: 'Ada',
    lastName: 'Planner',
    role: 'super_admin',
    planTier: 'pro',
    credits: 200,
    seat: null,
  },
  {
    email: 'studio@novira.test',
    firstName: 'Sam',
    lastName: 'Studio',
    role: 'user',
    planTier: 'pro',
    // Pooled company credits, so the personal balance is deliberately zero.
    credits: 0,
    // 'admin' is the highest company seat the domain defines; there is no owner role.
    seat: { role: 'admin', visibility: 'company_wide' },
  },
  {
    email: 'designer@novira.test',
    firstName: 'Dee',
    lastName: 'Designer',
    role: 'user',
    planTier: 'plus',
    credits: 100,
    seat: { role: 'member', visibility: 'own_only' },
  },
];

/**
 * Refuse to seed guessable passwords into anything that is not obviously local.
 * `SEED_DEMO_FORCE=1` is the deliberate override.
 */
function assertSafeTarget() {
  if (process.env.SEED_DEMO_FORCE === '1') return;
  const url = process.env.DATABASE_URL ?? '';
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  if (!local) {
    console.error(
      `[seed:demo] refusing to seed demo accounts into "${host}".\n` +
        '            These passwords are public. Set SEED_DEMO_FORCE=1 if you really mean it.'
    );
    process.exit(1);
  }
}

async function upsertCompany() {
  const existing = await prisma.company.findFirst({ where: { name: COMPANY_NAME } });
  if (existing) return existing;
  return prisma.company.create({
    data: {
      name: COMPANY_NAME,
      mainEmail: 'studio@novira.test',
      city: 'Bristol',
      country: 'GB',
      creditMode: 'pooled',
      poolBalance: 250,
    },
  });
}

async function upsertUser(user: DemoUser, companyId: bigint | null) {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const record = await prisma.user.upsert({
    where: { email: user.email },
    create: {
      email: user.email,
      passwordHash,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      planTier: user.planTier,
      companyId,
      isEmailVerified: true,
      preferredUnits: 'imperial',
      monthlyCreditQuota: user.credits,
      onboardingCompletedAt: new Date(),
    },
    update: {
      // Reset the sign-in and the entitlements; leave their projects alone.
      passwordHash,
      role: user.role,
      planTier: user.planTier,
      companyId,
      isBlocked: false,
      isEmailVerified: true,
      monthlyCreditQuota: user.credits,
    },
  });

  // The ledger is the source of truth for balances, so top up through it rather
  // than writing `creditsRemaining` directly.
  const balance = await recompute(record.id);
  if (balance < user.credits) await grantMonthly(record.id, user.credits - balance);
  await recompute(record.id);

  return record;
}

async function upsertSeat(companyId: bigint, userId: bigint, user: DemoUser) {
  if (!user.seat) return;
  await prisma.companyMember.upsert({
    where: { companyId_invitedEmail: { companyId, invitedEmail: user.email } },
    create: {
      companyId,
      userId,
      invitedEmail: user.email,
      role: user.seat.role,
      visibility: user.seat.visibility,
      seatPlanTier: user.planTier,
      status: 'active',
    },
    update: {
      userId,
      role: user.seat.role,
      visibility: user.seat.visibility,
      seatPlanTier: user.planTier,
      status: 'active',
    },
  });
}

async function main() {
  assertSafeTarget();

  const needsCompany = USERS.some((u) => u.seat);
  const company = needsCompany ? await upsertCompany() : null;

  const rows: string[] = [];
  for (const user of USERS) {
    const companyId = user.seat && company ? company.id : null;
    const record = await upsertUser(user, companyId);
    if (companyId) await upsertSeat(companyId, record.id, user);
    rows.push(
      `  ${user.email.padEnd(24)} ${user.role.padEnd(12)} ${user.planTier.padEnd(5)} ` +
        `${String(user.credits).padStart(4)} credits${user.seat ? `  (${user.seat.role} of ${COMPANY_NAME})` : ''}`
    );
  }

  console.log(`[seed:demo] password for every account: ${PASSWORD}`);
  console.log(rows.join('\n'));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[seed:demo] failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
