/**
 * Analytics and insights.
 *
 * The brief asks for four things: most used layouts, most efficient booth
 * sizes, conversion rate per layout, and an ROI calculator. The first three are
 * aggregations over work an agency has already done, and their value is that
 * they answer a question nobody currently has the data to answer — "which of
 * our stand designs actually wins?".
 *
 * The ROI calculator is different in kind: it is a model, and a model that
 * quietly invents inputs is worse than no model at all. So every figure it uses
 * is supplied by the user, every assumption is stated on the output, and the
 * result is a range rather than a single number — because that is what an
 * honest projection looks like.
 */
import { formatMoney } from './quoting.js';

/* ── Aggregations ──────────────────────────────────────────────────────── */

export interface LayoutUsageRow {
  key: string;
  label: string;
  /** How many plans used it. */
  plans: number;
  /** How many of those became an accepted proposal. */
  won: number;
  /** Accepted proposals as a share of proposals sent, in basis points. */
  conversionBp: number | null;
  /** Median accepted value, in minor units. */
  medianValue: number | null;
  currency: string;
}

export interface BoothEfficiencyRow {
  /** Stand size, as the label an organiser sells it under. */
  sizeLabel: string;
  areaSqM: number;
  plans: number;
  /** Cost per square metre, averaged over accepted proposals. */
  costPerSqM: number | null;
  /** Accepted proposals as a share of those sent, in basis points. */
  conversionBp: number | null;
  /** Median accepted value, in minor units. */
  medianValue: number | null;
  currency: string;
  /**
   * Value returned per square metre bought — the number that actually decides
   * whether a bigger stand was worth it.
   */
  valuePerSqM: number | null;
}

export interface InsightsSummary {
  totalProjects: number;
  totalPlans: number;
  proposalsSent: number;
  proposalsWon: number;
  conversionBp: number | null;
  /** Total accepted value across the period. */
  wonValue: number;
  currency: string;
  /** Median time from plan created to proposal sent, in days. */
  medianDaysToProposal: number | null;
  /** Hours saved, estimated from the automated outputs actually used. */
  hoursSaved: number;
}

/**
 * Hours a manual version of each output would take.
 *
 * These are the figures the time-saved claim rests on, so they are stated here
 * rather than buried: measuring a drawing by hand and building a bill of
 * quantities is most of a day; a rendered walkthrough is a specialist's
 * afternoon. They are deliberately conservative.
 */
export const MANUAL_HOURS = {
  takeoff: 3.5,
  boq: 2.0,
  technicalDrawing: 2.5,
  render4k: 1.5,
  walkthroughVideo: 4.0,
  presentationDeck: 3.0,
  seatingChart: 2.0,
  cadExport: 1.0,
} as const;

export type SavedOutput = keyof typeof MANUAL_HOURS;

export const MANUAL_HOURS_LABELS: Record<SavedOutput, string> = {
  takeoff: 'Measuring quantities by hand',
  boq: 'Building a bill of quantities',
  technicalDrawing: 'Drawing a dimensioned plan',
  render4k: 'Producing a high-resolution render',
  walkthroughVideo: 'Producing a walkthrough video',
  presentationDeck: 'Assembling a client deck',
  seatingChart: 'Drawing a seating chart',
  cadExport: 'Preparing CAD for the workshop',
};

export function hoursSaved(counts: Partial<Record<SavedOutput, number>>): number {
  let total = 0;
  for (const [key, count] of Object.entries(counts) as Array<[SavedOutput, number]>) {
    total += (MANUAL_HOURS[key] ?? 0) * (count ?? 0);
  }
  return Math.round(total * 10) / 10;
}

/* ── ROI ───────────────────────────────────────────────────────────────── */

export interface RoiInputs {
  /** What the activity costs: stand, build, staff, travel, everything. */
  investment: number;
  currency: string;
  /** Visitors, attendees or delegates expected. */
  audience: number;
  /** Share of the audience the team expects to speak to, in basis points. */
  engagementBp: number;
  /** Share of conversations that become a qualified lead, in basis points. */
  leadRateBp: number;
  /** Share of qualified leads that close, in basis points. */
  closeRateBp: number;
  /** Average value of a closed deal, in minor units. */
  dealValue: number;
  /** Gross margin on that deal, in basis points. */
  marginBp: number;
  /** Months over which the revenue lands, for the payback figure. */
  salesCycleMonths: number;
  /**
   * How uncertain the inputs are, in basis points. The range is the projection
   * plus or minus this — 2000 means "could be 20 % either way", which is a
   * realistic level of confidence for a first event.
   */
  uncertaintyBp: number;
}

export const DEFAULT_ROI_INPUTS: RoiInputs = {
  investment: 5_000_000,
  currency: 'usd',
  audience: 4000,
  engagementBp: 500,
  leadRateBp: 3000,
  closeRateBp: 2000,
  dealValue: 1_500_000,
  marginBp: 3500,
  salesCycleMonths: 6,
  uncertaintyBp: 2500,
};

export interface RoiResult {
  conversations: number;
  qualifiedLeads: number;
  closedDeals: number;
  /** Revenue booked, in minor units. */
  revenue: number;
  /** Gross profit on that revenue. */
  grossProfit: number;
  /** Profit less the investment. */
  netReturn: number;
  /** Return on investment, in basis points. Negative means a loss. */
  roiBp: number;
  /** Months to break even at the modelled rate. */
  paybackMonths: number | null;
  /** Cost of acquiring one qualified lead. */
  costPerLead: number | null;
  /** Cost of one conversation. */
  costPerConversation: number | null;
  /** Low and high bounds from the uncertainty. */
  range: { lowNetReturn: number; highNetReturn: number; lowRoiBp: number; highRoiBp: number };
  /** How many leads are needed just to break even — the sanity check. */
  breakEvenDeals: number;
  assumptions: string[];
}

/**
 * Model the return.
 *
 * A deliberately simple funnel — audience, conversations, leads, deals — because
 * a more elaborate model does not become more accurate, it becomes harder to
 * argue with. Everything is integer minor units, as everywhere money appears.
 */
export function computeRoi(inputs: RoiInputs): RoiResult {
  const bp = (value: number) => Math.max(0, Math.min(10_000, Math.round(value))) / 10_000;

  const conversations = Math.round(inputs.audience * bp(inputs.engagementBp));
  const qualifiedLeads = Math.round(conversations * bp(inputs.leadRateBp));
  const closedDeals = Math.round(qualifiedLeads * bp(inputs.closeRateBp));

  const revenue = closedDeals * inputs.dealValue;
  const grossProfit = Math.round(revenue * bp(inputs.marginBp));
  const netReturn = grossProfit - inputs.investment;
  const roiBp = inputs.investment > 0 ? Math.round((netReturn / inputs.investment) * 10_000) : 0;

  const monthlyProfit = inputs.salesCycleMonths > 0 ? grossProfit / inputs.salesCycleMonths : 0;
  const paybackMonths =
    monthlyProfit > 0 && netReturn > 0 ? Math.round((inputs.investment / monthlyProfit) * 10) / 10 : null;

  const costPerLead = qualifiedLeads > 0 ? Math.round(inputs.investment / qualifiedLeads) : null;
  const costPerConversation = conversations > 0 ? Math.round(inputs.investment / conversations) : null;

  const spread = bp(inputs.uncertaintyBp);
  const lowGross = Math.round(grossProfit * (1 - spread));
  const highGross = Math.round(grossProfit * (1 + spread));

  const profitPerDeal = Math.round(inputs.dealValue * bp(inputs.marginBp));
  const breakEvenDeals = profitPerDeal > 0 ? Math.ceil(inputs.investment / profitPerDeal) : 0;

  return {
    conversations,
    qualifiedLeads,
    closedDeals,
    revenue,
    grossProfit,
    netReturn,
    roiBp,
    paybackMonths,
    costPerLead,
    costPerConversation,
    range: {
      lowNetReturn: lowGross - inputs.investment,
      highNetReturn: highGross - inputs.investment,
      lowRoiBp: inputs.investment > 0 ? Math.round(((lowGross - inputs.investment) / inputs.investment) * 10_000) : 0,
      highRoiBp: inputs.investment > 0 ? Math.round(((highGross - inputs.investment) / inputs.investment) * 10_000) : 0,
    },
    breakEvenDeals,
    assumptions: [
      `${inputs.audience.toLocaleString()} people attend, and the team speaks to ${(bp(inputs.engagementBp) * 100).toFixed(1)} % of them.`,
      `${(bp(inputs.leadRateBp) * 100).toFixed(0)} % of conversations become a qualified lead, and ${(bp(inputs.closeRateBp) * 100).toFixed(0)} % of those close.`,
      `Each closed deal is worth ${formatMoney(inputs.dealValue, inputs.currency)} at ${(bp(inputs.marginBp) * 100).toFixed(0)} % gross margin.`,
      `Revenue lands over ${inputs.salesCycleMonths} months.`,
      `Shown ±${(bp(inputs.uncertaintyBp) * 100).toFixed(0)} % to reflect how uncertain a first projection is.`,
      'These are your figures, not benchmarks. The model applies them; it does not validate them.',
    ],
  };
}

/**
 * A blunt reading of the result, so nobody has to interpret basis points.
 *
 * Deliberately plain about a bad number: an ROI model that never says "this
 * does not pay back" is a sales tool, not a planning tool.
 */
export function roiVerdict(result: RoiResult): { tone: 'good' | 'marginal' | 'poor'; headline: string; detail: string } {
  if (result.roiBp >= 10_000) {
    return {
      tone: 'good',
      headline: `Returns ${(result.roiBp / 100).toFixed(0)} % on the investment`,
      detail: `${result.closedDeals} closed deals cover the cost more than twice over. Break-even needs ${result.breakEvenDeals}.`,
    };
  }
  if (result.roiBp >= 0) {
    return {
      tone: 'marginal',
      headline: `Returns ${(result.roiBp / 100).toFixed(0)} % — it pays back, but not by much`,
      detail: `Break-even needs ${result.breakEvenDeals} deals and the model projects ${result.closedDeals}. A small miss on any rate turns this negative.`,
    };
  }
  return {
    tone: 'poor',
    headline: `Does not pay back on these figures`,
    detail: `Break-even needs ${result.breakEvenDeals} deals; the funnel produces ${result.closedDeals}. Either the investment is too high for this audience, or one of the rates is being under-estimated.`,
  };
}

/* ── Aggregation helpers ───────────────────────────────────────────────── */

/** Median of a numeric list, or null when the list is empty. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;
}

/**
 * Conversion, in basis points.
 *
 * Returns null rather than 0 below a floor, because "0 % from two proposals" is
 * not information and showing it as a rate invites a decision it cannot
 * support.
 */
export function conversionRate(won: number, sent: number, minimumSample = 3): number | null {
  if (sent < minimumSample) return null;
  return Math.round((won / sent) * 10_000);
}
