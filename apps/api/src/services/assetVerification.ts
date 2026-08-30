/**
 * Asset verification.
 *
 * The rule this enforces: **an item only enters the catalogue if we have
 * checked that it is the thing its name claims.** Provider metadata on 3D
 * marketplaces is unreliable — names are approximate, tags are keyword spam,
 * and "sofa" routinely returns a sofa *table*, a cushion, or a texture swatch.
 * For to-scale event layout work a mislabelled or mis-scaled model is worse
 * than no model at all, because it silently produces a wrong plan.
 *
 * Verification runs five independent checks and scores them. Only assets that
 * clear the admit threshold are published; borderline ones are stored as
 * `pending` for a human to look at in the admin console, and failures are
 * rejected with a recorded reason.
 */
import type { CatalogCategorySlug } from '@novira/shared';
import type { TaxonomyEntry } from './assetTaxonomy.js';
import { classifyByHead } from './assetClassifier.js';
import { inferScale, type GltfFacts } from './gltfInspect.js';

export interface VerificationInput {
  name: string;
  description?: string | null;
  tags?: string[];
  categories?: string[];
  facts: GltfFacts;
  sourceKey: string;
  /** Sources whose curation we trust more (hand-authored CC0 packs). */
  sourceTrust?: number;
}

export interface CheckResult {
  check: string;
  passed: boolean;
  weight: number;
  score: number;
  detail: string;
}

export interface VerificationResult {
  /** publish → catalogue; review → pending queue; reject → discarded. */
  verdict: 'publish' | 'review' | 'reject';
  score: number;
  entry: TaxonomyEntry | null;
  category: CatalogCategorySlug | null;
  checks: CheckResult[];
  /** Real-world size after unit inference. */
  dimensionsMm: { width: number; depth: number; height: number } | null;
  /** Multiplier from the file's units to millimetres. */
  scaleToMm: number;
  scaleUnit: string;
  summary: string;
}

const PUBLISH_THRESHOLD = 72;
const REVIEW_THRESHOLD = 48;

/** Hand-curated CC0 libraries earn a small benefit of the doubt. */
export const SOURCE_TRUST: Record<string, number> = {
  polyhaven: 20,
  khronos: 10,
  ambientcg: 15,
  polypizza: 8,
  smithsonian: 5,
  sketchfab: 0,
  blenderkit: 0,
  opensource3d: 5,
  local: 25,
};

export function verifyAsset(input: VerificationInput): VerificationResult {
  const checks: CheckResult[] = [];
  const { facts } = input;

  /* 1 ── the file must actually load and contain geometry ─────────────── */
  if (!facts.ok) {
    return {
      verdict: 'reject',
      score: 0,
      entry: null,
      category: null,
      checks: [
        {
          check: 'loadable',
          passed: false,
          weight: 1,
          score: 0,
          detail: facts.error ?? 'Model failed to parse.',
        },
      ],
      dimensionsMm: null,
      scaleToMm: 1000,
      scaleUnit: 'metres',
      summary: `Rejected: ${facts.error ?? 'model failed to parse'}.`,
    };
  }
  checks.push({
    check: 'loadable',
    passed: true,
    weight: 1,
    score: 100,
    detail: `Parsed ${facts.meshCount} mesh(es), ${facts.triangleCount.toLocaleString()} triangles.`,
  });

  /* 2 ── the name has to mean something in an event catalogue ─────────── */
  const classification = classifyByHead(input);
  if (!classification.entry) {
    return {
      verdict: 'reject',
      score: 0,
      entry: null,
      category: null,
      checks: [
        ...checks,
        {
          check: 'identity',
          passed: false,
          weight: 3,
          score: 0,
          detail: classification.reasons.join('; ') || 'Nothing in the metadata identifies an event item.',
        },
      ],
      dimensionsMm: null,
      scaleToMm: 1000,
      scaleUnit: 'metres',
      summary: `Rejected: ${classification.reasons[0] ?? 'not identifiable as an event item'}.`,
    };
  }
  const entry = classification.entry;
  checks.push({
    check: 'identity',
    passed: classification.confidence >= 55,
    weight: 3,
    score: classification.confidence,
    detail: `Reads as "${entry.label}" — ${classification.reasons.join('; ')}.`,
  });

  /* 3 ── measured size must be plausible for what it claims to be ─────── */
  const scale = inferScale(facts, entry.dims);
  const { width, depth, height } = scale.sizeMm;
  const [wLo, wHi] = entry.dims.widthMm;
  const [hLo, hHi] = entry.dims.heightMm;
  const widthOk = width >= wLo && width <= wHi;
  const heightOk = height >= hLo && height <= hHi;

  checks.push({
    check: 'dimensions',
    passed: widthOk && heightOk,
    weight: 3,
    score: scale.fit,
    detail:
      `Measured ${width}×${depth}×${height} mm as ${scale.unitName}; ` +
      `expected width ${wLo}–${wHi} mm, height ${hLo}–${hHi} mm.` +
      (widthOk && heightOk ? '' : ' Outside the plausible range for this item type.'),
  });

  /* 4 ── proportions: a sofa is wider than it is tall, a lamp is not ──── */
  const aspect = height > 0 ? width / height : 0;
  const expectedAspect =
    ((wLo + wHi) / 2) / Math.max(1, (hLo + hHi) / 2);
  const aspectRatio = expectedAspect > 0 ? aspect / expectedAspect : 0;
  // Within a factor of ~2.5 either way is unremarkable for real furniture.
  const aspectScore = aspectRatio === 0 ? 0 : Math.max(0, 100 - Math.abs(Math.log2(aspectRatio)) * 45);
  checks.push({
    check: 'proportion',
    passed: aspectScore >= 40,
    weight: 1.5,
    score: aspectScore,
    detail: `Width:height ${aspect.toFixed(2)} against an expected ~${expectedAspect.toFixed(2)}.`,
  });

  /* 5 ── usable as a real-time asset ──────────────────────────────────── */
  const complexityIssues: string[] = [];
  let complexityScore = 100;
  if (facts.triangleCount < 12) {
    complexityScore -= 60;
    complexityIssues.push('almost no geometry');
  }
  if (facts.triangleCount > 400_000) {
    complexityScore -= 35;
    complexityIssues.push(`very heavy (${facts.triangleCount.toLocaleString()} triangles)`);
  }
  if (facts.offCentre) {
    complexityScore -= 25;
    complexityIssues.push('geometry sits far from the origin');
  }
  if (facts.fileSize > 40 * 1024 * 1024) {
    complexityScore -= 20;
    complexityIssues.push('large file');
  }
  complexityScore = Math.max(0, complexityScore);
  checks.push({
    check: 'usability',
    passed: complexityScore >= 50,
    weight: 1.5,
    score: complexityScore,
    detail: complexityIssues.length ? complexityIssues.join('; ') : 'Sensible triangle budget and origin.',
  });

  /* ── weighted score, plus a nudge for trusted sources ────────────────── */
  const totalWeight = checks.reduce((a, c) => a + c.weight, 0);
  const weighted = checks.reduce((a, c) => a + c.score * c.weight, 0) / totalWeight;
  const trust = input.sourceTrust ?? SOURCE_TRUST[input.sourceKey] ?? 0;
  const score = Math.round(Math.min(100, weighted + trust * 0.15));

  /*
   * Dimension correctness is a gate, not a contribution.
   *
   * The whole promise of the catalogue is that a placed item is the right size
   * in a to-scale plan, so an item measuring outside its plausible band can
   * never be auto-published however well it scores elsewhere. A first pass let
   * a 143 mm "stool" and a 210 mm-wide "chair" through on aggregate score
   * alone; they are now held for review instead.
   */
  const dimensionsOk = checks.find((c) => c.check === 'dimensions')!.passed;
  const wildlyOff = !dimensionsOk && scale.fit < 35;
  const identityWeak = classification.confidence < 55;

  let verdict: VerificationResult['verdict'];
  if (wildlyOff) verdict = 'reject';
  else if (score >= PUBLISH_THRESHOLD && !identityWeak && dimensionsOk) verdict = 'publish';
  else if (score >= REVIEW_THRESHOLD) verdict = 'review';
  else verdict = 'reject';

  const summary =
    verdict === 'publish'
      ? `Verified as ${entry.label} at ${width}×${depth}×${height} mm.`
      : verdict === 'review'
        ? `Looks like ${entry.label} but needs a look: ${checks.filter((c) => !c.passed).map((c) => c.check).join(', ') || 'low confidence'}.`
        : `Rejected: ${wildlyOff ? 'measured size is implausible for ' + entry.label : 'confidence too low'}.`;

  return {
    verdict,
    score,
    entry,
    category: entry.category,
    checks,
    dimensionsMm: { width, depth, height },
    scaleToMm: scale.toMm,
    scaleUnit: scale.unitName,
    summary,
  };
}
