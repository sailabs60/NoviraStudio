/**
 * Proposal arithmetic.
 *
 * Money is the one place in this codebase where being approximately right is
 * worse than being obviously wrong: a quote that disagrees with its own total
 * by a penny destroys a client's confidence in everything else on the page.
 *
 * So three rules hold throughout:
 *
 * 1. **Everything is an integer.** Amounts are minor units (cents, pence),
 *    rates are basis points, quantities are thousandths. No float ever touches
 *    a money value, because `0.1 + 0.2` is not `0.3` and a proposal is exactly
 *    where that surfaces.
 * 2. **Round once, at the line.** Each line rounds to a whole minor unit, and
 *    the subtotal is the sum of already-rounded lines. Rounding at the end
 *    instead produces totals that do not match the visible line amounts.
 * 3. **Discount before tax.** Tax is charged on what is actually paid. The
 *    other order overstates the tax and is wrong in every jurisdiction the
 *    author is aware of.
 */

export const PROPOSAL_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_LINE_KINDS = ['item', 'labour', 'fee', 'discount'] as const;
export type ProposalLineKind = (typeof PROPOSAL_LINE_KINDS)[number];

export interface QuoteLine {
  kind: ProposalLineKind;
  description: string;
  /** Thousandths: 1.5 is 1500. */
  quantityMilli: number;
  /** Minor units. Negative for a discount line. */
  unitPrice: number;
  taxable: boolean;
}

export interface QuoteTotals {
  /** Sum of line amounts, each already rounded. */
  subtotal: number;
  /** Proposal-wide discount, as a positive number to subtract. */
  discount: number;
  /** Subtotal less discount. */
  net: number;
  tax: number;
  total: number;
  /** Deposit requested now, and the balance that follows. */
  deposit: number;
  balance: number;
  /** Portion of the net that tax was actually charged on. */
  taxableNet: number;
}

/**
 * One line's amount.
 *
 * `Math.round` on a half-integer rounds towards positive infinity, which would
 * treat a discount line inconsistently with a charge of the same magnitude, so
 * the sign is handled explicitly and the magnitude rounded half-up.
 */
export function lineAmount(line: Pick<QuoteLine, 'quantityMilli' | 'unitPrice'>): number {
  const raw = (line.quantityMilli * line.unitPrice) / 1000;
  const sign = raw < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(raw));
}

export interface QuoteRates {
  /** Basis points: 20% is 2000. */
  taxRateBp: number;
  discountBp: number;
  depositBp: number;
}

export function computeTotals(lines: QuoteLine[], rates: QuoteRates): QuoteTotals {
  let subtotal = 0;
  let taxableSubtotal = 0;

  for (const line of lines) {
    const amount = lineAmount(line);
    subtotal += amount;
    if (line.taxable) taxableSubtotal += amount;
  }

  const discount = Math.round((subtotal * clampBp(rates.discountBp)) / 10_000);
  const net = subtotal - discount;

  /*
   * A proposal-wide discount reduces every line proportionally, so the taxable
   * share of the discount has to come off the taxable base too. Applying the
   * discount only to the total while taxing the full taxable subtotal would
   * charge tax on money the client never pays.
   */
  const taxableShare = subtotal === 0 ? 0 : taxableSubtotal / subtotal;
  const taxableNet = Math.round(net * taxableShare);
  const tax = Math.round((taxableNet * clampBp(rates.taxRateBp)) / 10_000);

  const total = net + tax;
  const deposit = Math.round((total * clampBp(rates.depositBp)) / 10_000);

  return {
    subtotal,
    discount,
    net,
    tax,
    total,
    deposit,
    balance: total - deposit,
    taxableNet,
  };
}

/** Basis points outside 0–100% are a data error, not a discount. */
function clampBp(bp: number): number {
  if (!Number.isFinite(bp)) return 0;
  return Math.max(0, Math.min(10_000, Math.round(bp)));
}

/** Minor units to a display string. */
export function formatMoney(minorUnits: number, currency = 'usd'): string {
  const value = minorUnits / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(value);
  } catch {
    // An unknown currency code should still render a number, not throw.
    return `${currency.toUpperCase()} ${value.toFixed(2)}`;
  }
}

/** Thousandths to a display string, without trailing noise. */
export function formatQuantity(quantityMilli: number): string {
  const value = quantityMilli / 1000;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
}

export function parseQuantity(input: string): number {
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 1000);
}

/** Basis points to a percentage string. */
export function formatRate(bp: number): string {
  const pct = clampBp(bp) / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2)}%`;
}
