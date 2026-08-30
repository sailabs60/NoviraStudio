/**
 * Stripe webhook receiver.
 *
 * Mounted before `express.json()` because signature verification needs the raw
 * request body, byte for byte — a parsed-and-restringified body will not match
 * the signature.
 *
 * The contract with Stripe is: reply 2xx once the event is durably recorded,
 * and Stripe stops retrying. Anything that throws gets a non-2xx and will be
 * redelivered, so every handler here is written to be safe to run twice — the
 * `stripe_event` row is claimed first, and the work itself is idempotent.
 */
import { Router, type Request, type Response } from 'express';
import express from 'express';
import type Stripe from 'stripe';
import type { PlanTier } from '@novira/shared';
import { prisma } from '../lib/prisma.js';
import { purchase, recompute } from '../services/credits.js';
import { claimEvent, constructWebhookEvent, isActiveStatus } from '../services/stripe.js';
import { applyTier } from './billing.js';

export const stripeWebhookRouter = Router();

/** Read our user id back off whatever Stripe object carried it. */
function userIdFrom(meta: Stripe.Metadata | null | undefined): bigint | null {
  const raw = meta?.noviraUserId;
  if (!raw) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/** Fall back to the customer id when metadata is missing (older objects). */
async function userIdFromCustomer(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
): Promise<bigint | null> {
  const id = typeof customer === 'string' ? customer : customer?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({
    where: { stripeCustomerId: id },
    select: { id: true },
  });
  return user?.id ?? null;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  // Only act once the money is actually there. An unpaid session can complete
  // when the customer picks a delayed payment method.
  if (session.payment_status === 'unpaid') return;

  const userId = userIdFrom(session.metadata) ?? (await userIdFromCustomer(session.customer));
  if (!userId) return;

  if (session.metadata?.kind === 'credit_pack') {
    const packId = session.metadata.noviraPackId;
    if (!packId) return;
    const pack = await prisma.creditPack.findUnique({ where: { id: BigInt(packId) } });
    if (!pack) return;

    const expiresAt = pack.expiryDays
      ? new Date(Date.now() + pack.expiryDays * 86_400_000)
      : null;
    await purchase(userId, pack.creditAmount, expiresAt);
    await recompute(userId);
    return;
  }

  // Subscription checkout. Record the Stripe ids, then apply the tier through
  // the same helper the manual approval path uses, so both routes converge.
  const tier = (session.metadata?.noviraTier ?? null) as PlanTier | null;
  if (!tier) return;

  await applyTier(userId, tier);

  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (subscriptionId) {
    const latest = await prisma.subscription.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (latest) {
      await prisma.subscription.update({
        where: { id: latest.id },
        data: {
          billingSource: 'stripe',
          stripeSubscriptionId: subscriptionId,
          stripeSubscriptionStatus: 'active',
        },
      });
    }
  }
}

async function handleSubscriptionChanged(sub: Stripe.Subscription) {
  const userId = userIdFrom(sub.metadata) ?? (await userIdFromCustomer(sub.customer));
  if (!userId) return;

  const active = isActiveStatus(sub.status);
  const tier = (sub.metadata?.noviraTier ?? null) as PlanTier | null;

  const row = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  if (row) {
    await prisma.subscription.update({
      where: { id: row.id },
      data: {
        billingSource: 'stripe',
        stripeSubscriptionId: sub.id,
        stripeSubscriptionStatus: sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        cycleEndsAt: sub.ended_at ? new Date(sub.ended_at * 1000) : row.cycleEndsAt,
      },
    });
  }

  // A subscription that has lapsed drops the account back to free. Credits
  // already granted are left alone — they were paid for.
  if (!active) {
    await prisma.user.update({
      where: { id: userId },
      data: { planTier: 'free', monthlyCreditQuota: 0 },
    });
  } else if (tier) {
    await prisma.user.update({ where: { id: userId }, data: { planTier: tier } });
  }
}

/**
 * Renewal. Stripe bills the card each month; this is where the next month's
 * credit allowance is granted.
 *
 * The first invoice of a subscription is skipped because the checkout handler
 * has already granted that month through `applyTier`.
 */
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  if (invoice.billing_reason !== 'subscription_cycle') return;

  const userId = await userIdFromCustomer(invoice.customer);
  if (!userId) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { planTier: true },
  });
  if (!user || user.planTier === 'free') return;

  await applyTier(userId, user.planTier as PlanTier);
}

stripeWebhookRouter.post(
  '/',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      return res.status(400).json({ error: { code: 'MISSING_SIGNATURE' } });
    }

    let event: Stripe.Event;
    try {
      event = constructWebhookEvent(req.body as Buffer, signature);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Signature verification failed.';
      return res.status(400).json({ error: { code: 'STRIPE_SIGNATURE_INVALID', message } });
    }

    // Claim before doing the work. A duplicate delivery returns 200 without
    // re-granting anything.
    if (!(await claimEvent(event))) {
      return res.json({ received: true, duplicate: true });
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          break;
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await handleSubscriptionChanged(event.data.object as Stripe.Subscription);
          break;
        case 'invoice.paid':
          await handleInvoicePaid(event.data.object as Stripe.Invoice);
          break;
        default:
          // Unhandled types are still recorded, so the event log shows exactly
          // what Stripe sent even when we chose not to act on it.
          break;
      }
    } catch (err) {
      // Release the claim so Stripe's retry gets a real second attempt rather
      // than being short-circuited as a duplicate.
      await prisma.stripeEvent.delete({ where: { id: event.id } }).catch(() => undefined);
      console.error(`[stripe] handler failed for ${event.type} (${event.id}):`, err);
      return res.status(500).json({ error: { code: 'WEBHOOK_HANDLER_FAILED' } });
    }

    res.json({ received: true });
  }
);
