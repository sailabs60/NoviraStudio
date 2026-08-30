/**
 * Stripe integration.
 *
 * Two things shape this file:
 *
 * 1. Stripe is optional. Without `STRIPE_SECRET_KEY` the billing surface still
 *    works through the approval queue, so every export here either throws a
 *    clear error or is simply never reached when the key is absent. Importing
 *    this module must never crash a deployment that does not use Stripe, which
 *    is why the client is built lazily rather than at module load.
 *
 * 2. Prices are created on demand. A deployment should not need someone to go
 *    and hand-build products in the Stripe dashboard before upgrades work, so
 *    `stripePriceId` on `plan_price` / `credit_pack` is filled in the first
 *    time a tier or pack is bought, and reused afterwards. Amounts still come
 *    from our own tables, which the admin console edits.
 */
import Stripe from 'stripe';
import type { PlanTier } from '@novira/shared';
import { prisma } from '../lib/prisma.js';
import { env, stripeConfigured } from '../lib/env.js';
import { ApiError } from '../lib/errors.js';

let client: Stripe | null = null;

/** The configured client, or an error explaining that billing is in manual mode. */
export function stripeClient(): Stripe {
  if (!stripeConfigured) {
    throw new ApiError(
      503,
      'STRIPE_NOT_CONFIGURED',
      'Card payment is not enabled on this deployment.'
    );
  }
  if (!client) {
    client = new Stripe(env.stripe.secretKey, {
      // Pinning the version means a Stripe-side upgrade cannot silently change
      // the shape of what the webhook receives.
      apiVersion: '2026-08-26.dahlia',
      appInfo: { name: 'Novira', version: '0.1.0' },
      maxNetworkRetries: 2,
    });
  }
  return client;
}

/** Where Stripe sends the browser back to. */
function returnUrls(path: string) {
  const base = env.corsOrigin.replace(/\/$/, '');
  return {
    success: `${base}${path}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel: `${base}${path}?checkout=cancelled`,
  };
}

/**
 * Find or create the Stripe customer for a user.
 *
 * The id is cached on the user row so repeat checkouts reuse the same customer
 * and Stripe shows one coherent billing history rather than a new customer per
 * purchase.
 */
export async function ensureCustomer(userId: bigint): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      stripeCustomerId: true,
      companyId: true,
    },
  });
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripeClient().customers.create({
    email: user.email,
    name: `${user.firstName} ${user.lastName}`.trim(),
    metadata: {
      noviraUserId: String(user.id),
      ...(user.companyId ? { noviraCompanyId: String(user.companyId) } : {}),
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

/**
 * Resolve the Stripe price for a plan tier, creating it the first time.
 *
 * If the stored price no longer matches our own amount — an admin edited the
 * pricing table — a new Stripe price is created and recorded, because Stripe
 * prices are immutable.
 */
async function priceForTier(tier: PlanTier): Promise<string> {
  const plan = await prisma.planPrice.findUnique({ where: { tier } });
  if (!plan) throw ApiError.badRequest('That plan is not available.');

  if (plan.stripePriceId) {
    const existing = await stripeClient()
      .prices.retrieve(plan.stripePriceId)
      .catch(() => null);
    const matches =
      existing &&
      existing.active &&
      existing.unit_amount === plan.unitAmount &&
      existing.currency === plan.currency;
    if (matches) return plan.stripePriceId;
  }

  const price = await stripeClient().prices.create({
    currency: plan.currency,
    unit_amount: plan.unitAmount,
    recurring: { interval: 'month' },
    product_data: { name: `Novira ${plan.marketingName}` },
    metadata: { noviraTier: tier },
  });

  await prisma.planPrice.update({ where: { tier }, data: { stripePriceId: price.id } });
  return price.id;
}

/** Same idea for a one-off credit pack, billed as a payment rather than a subscription. */
async function priceForPack(packId: bigint): Promise<string> {
  const pack = await prisma.creditPack.findUniqueOrThrow({ where: { id: packId } });

  if (pack.stripePriceId) {
    const existing = await stripeClient()
      .prices.retrieve(pack.stripePriceId)
      .catch(() => null);
    if (
      existing &&
      existing.active &&
      existing.unit_amount === pack.unitAmount &&
      existing.currency === pack.currency
    ) {
      return pack.stripePriceId;
    }
  }

  const price = await stripeClient().prices.create({
    currency: pack.currency,
    unit_amount: pack.unitAmount,
    product_data: { name: `Novira ${pack.creditAmount} credits` },
    metadata: { noviraPackId: String(pack.id) },
  });

  await prisma.creditPack.update({ where: { id: pack.id }, data: { stripePriceId: price.id } });
  return price.id;
}

/**
 * Checkout for a subscription upgrade.
 *
 * The metadata is what the webhook reads back; it is the only thing tying the
 * Stripe session to our user, so it must always be set.
 */
export async function createSubscriptionCheckout(userId: bigint, tier: PlanTier) {
  const customer = await ensureCustomer(userId);
  const price = await priceForTier(tier);
  const urls = returnUrls('/billing');

  const session = await stripeClient().checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price, quantity: 1 }],
    success_url: urls.success,
    cancel_url: urls.cancel,
    allow_promotion_codes: true,
    client_reference_id: String(userId),
    metadata: { noviraUserId: String(userId), noviraTier: tier, kind: 'subscription' },
    subscription_data: {
      metadata: { noviraUserId: String(userId), noviraTier: tier },
    },
  });

  return { id: session.id, url: session.url };
}

/** Checkout for a one-off credit pack. */
export async function createPackCheckout(userId: bigint, packId: bigint) {
  const customer = await ensureCustomer(userId);
  const price = await priceForPack(packId);
  const urls = returnUrls('/billing');

  const session = await stripeClient().checkout.sessions.create({
    mode: 'payment',
    customer,
    line_items: [{ price, quantity: 1 }],
    success_url: urls.success,
    cancel_url: urls.cancel,
    client_reference_id: String(userId),
    metadata: { noviraUserId: String(userId), noviraPackId: String(packId), kind: 'credit_pack' },
    payment_intent_data: {
      metadata: { noviraUserId: String(userId), noviraPackId: String(packId) },
    },
  });

  return { id: session.id, url: session.url };
}

/**
 * The Stripe-hosted billing portal.
 *
 * Card updates, invoices and self-service cancellation all live there, so we
 * do not rebuild any of it.
 */
export async function createPortalSession(userId: bigint) {
  const customer = await ensureCustomer(userId);
  const base = env.corsOrigin.replace(/\/$/, '');
  const session = await stripeClient().billingPortal.sessions.create({
    customer,
    return_url: `${base}/billing`,
  });
  return { url: session.url };
}

/** Verify a webhook signature and return the parsed event. */
export function constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
  if (!env.stripe.webhookSecret) {
    throw new ApiError(
      503,
      'STRIPE_WEBHOOK_NOT_CONFIGURED',
      'No webhook secret is configured, so incoming events cannot be verified.'
    );
  }
  try {
    return stripeClient().webhooks.constructEvent(rawBody, signature, env.stripe.webhookSecret);
  } catch (err) {
    // An unverifiable event is either a misconfiguration or a forgery. Either
    // way it must not be processed.
    throw new ApiError(
      400,
      'STRIPE_SIGNATURE_INVALID',
      err instanceof Error ? err.message : 'Signature verification failed.'
    );
  }
}

/**
 * Record that an event has been handled.
 *
 * Returns false if it was already recorded, which is the caller's signal to
 * skip the work — Stripe retries until it receives a 2xx, so a slow handler
 * will be delivered the same event more than once.
 */
export async function claimEvent(event: Stripe.Event): Promise<boolean> {
  try {
    await prisma.stripeEvent.create({
      data: { id: event.id, type: event.type, payload: event.data.object as object },
    });
    return true;
  } catch {
    return false;
  }
}

/** Map Stripe's subscription status onto whether the plan should still be active. */
export function isActiveStatus(status: string): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due';
}
