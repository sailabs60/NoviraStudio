/**
 * Seed the server-driven configuration.
 *
 * Pricing, credit costs, plan allowances, cancellation reasons and the theme
 * are all rows rather than constants, because the admin console edits them at
 * runtime. This script sets the defaults an empty database needs to work; it is
 * idempotent, so it is safe to re-run after a schema change.
 */
import 'dotenv/config';
import {
  CATALOG_CATEGORIES,
  DEFAULT_CREDIT_RATIOS,
  DEFAULT_PLAN_CREDITS,
  FEATURE_LABELS,
  TEXTURE_CATEGORIES,
  type FeatureCode,
} from '@novira/shared';
import { prisma } from '../lib/prisma.js';

const RATIO_DESCRIPTIONS: Record<FeatureCode, string> = {
  ai_image_to_3d: 'Deducted when a user starts an image-to-3D generation.',
  ai_enhance: 'Deducted for the default AI Enhance model.',
  ai_enhance_pro: 'Deducted when the higher-quality Enhance model is selected.',
  floor_plan_ai_draw: 'Deducted when walls are traced from an imported floor plan.',
  map_import: 'Deducted after a map capture succeeds.',
  venue_generation: 'Deducted when a venue generation is queued.',
  ai_concept: 'Deducted when a layout is generated from a written brief.',
  photo_analysis: 'Deducted when a photograph is analysed into a suggested layout.',
  pro_render: 'Deducted for a cloud raytraced render. Fast preview renders are free.',
  video_render: 'Deducted when a walkthrough video is rendered in the cloud.',
  deck_generation: 'Deducted when a client presentation deck is generated.',
  ai_text_to_3d: 'Deducted when a 3D model is generated from a written description.',
  ai_mockup: 'Deducted when a 2D mockup image is generated or edited.',
  ai_prompt_refine: 'Deducted when a short idea is expanded into a full prompt.',
  ai_assistant: 'Deducted per exchange with the design assistant, including a suggestion.',
};

async function seedPlans() {
  const tiers = [
    {
      tier: 'free',
      marketingName: 'Starter',
      tagline: 'Explore the tools and get a feel for the workspace.',
      unitAmount: 0,
      monthlyCredits: DEFAULT_PLAN_CREDITS.free,
      highlight: false,
      features: [
        'Core design and visualisation tools',
        'Walls, staging, draping and layout tools',
        'Starter model set',
        'PDF and image export',
        'No AI credits',
      ],
    },
    {
      tier: 'plus',
      marketingName: 'Professional',
      tagline: 'Everything needed to design and deliver real client events.',
      unitAmount: 3500,
      monthlyCredits: DEFAULT_PLAN_CREDITS.plus,
      highlight: true,
      features: [
        'Everything in Starter',
        'Full, growing 3D model library',
        'AI Image to 3D and Floor Plan tracing',
        'AI Enhance photoreal renders',
        'Map import at true scale',
        '100 AI credits each month',
      ],
    },
    {
      tier: 'pro',
      marketingName: 'Studio',
      tagline: 'For heavier AI use and high-volume work.',
      unitAmount: 5900,
      monthlyCredits: DEFAULT_PLAN_CREDITS.pro,
      highlight: false,
      features: [
        'Everything in Professional',
        'Double the monthly AI credits',
        'Same full toolset and model library',
        'Priority for large scenes',
      ],
    },
  ] as const;

  for (const tier of tiers) {
    await prisma.planPrice.upsert({
      where: { tier: tier.tier },
      create: { ...tier, features: tier.features as unknown as object, currency: 'usd', isActive: true },
      update: {
        marketingName: tier.marketingName,
        tagline: tier.tagline,
        unitAmount: tier.unitAmount,
        monthlyCredits: tier.monthlyCredits,
        highlight: tier.highlight,
        features: tier.features as unknown as object,
      },
    });
  }
  return tiers.length;
}

async function seedRatios() {
  for (const [featureCode, credits] of Object.entries(DEFAULT_CREDIT_RATIOS) as Array<[FeatureCode, number]>) {
    await prisma.creditRatio.upsert({
      where: { featureCode },
      create: {
        featureCode,
        label: FEATURE_LABELS[featureCode],
        description: RATIO_DESCRIPTIONS[featureCode],
        credits,
        isActive: true,
      },
      // Credits are intentionally *not* overwritten: an administrator may have
      // retuned them, and a re-seed must not undo that.
      update: { label: FEATURE_LABELS[featureCode], description: RATIO_DESCRIPTIONS[featureCode] },
    });
  }
  return Object.keys(DEFAULT_CREDIT_RATIOS).length;
}

async function seedPacks() {
  const packs = [
    { creditAmount: 50, unitAmount: 1200, displayOrder: 1 },
    { creditAmount: 100, unitAmount: 2200, displayOrder: 2 },
    { creditAmount: 150, unitAmount: 3000, displayOrder: 3 },
  ];
  for (const pack of packs) {
    const existing = await prisma.creditPack.findFirst({ where: { creditAmount: pack.creditAmount } });
    if (existing) continue;
    await prisma.creditPack.create({
      data: { ...pack, currency: 'usd', expiryDays: 365, isActive: true },
    });
  }
  return packs.length;
}

async function seedCancellationReasons() {
  const reasons = [
    { label: 'Too expensive for how much I use it', requiresNote: false, sortOrder: 1 },
    { label: 'Missing a feature I need', requiresNote: true, sortOrder: 2 },
    { label: 'Found a tool that fits better', requiresNote: true, sortOrder: 3 },
    { label: 'The event season is over', requiresNote: false, sortOrder: 4 },
    { label: 'Too difficult to use', requiresNote: true, sortOrder: 5 },
    { label: 'Something else', requiresNote: true, sortOrder: 6 },
  ];
  for (const reason of reasons) {
    const existing = await prisma.cancellationReason.findFirst({ where: { label: reason.label } });
    if (existing) continue;
    await prisma.cancellationReason.create({ data: { ...reason, isActive: true } });
  }
  return reasons.length;
}

async function seedOnboarding() {
  const section1 = [
    'Event rental company',
    'Wedding or event planner',
    'Venue or hotel',
    'Corporate events team',
    'AV or production crew',
    'Caterer or decorator',
  ];
  const section2 = [
    'Weddings',
    'Corporate events and conferences',
    'Marquee and tented events',
    'Concerts and staged productions',
    'Banquets and galas',
    'Trade shows and exhibitions',
  ];

  for (const [index, label] of section1.entries()) {
    const existing = await prisma.onboardingOption.findFirst({ where: { section: 1, label } });
    if (!existing) {
      await prisma.onboardingOption.create({
        data: { section: 1, label, sortOrder: index, isActive: true },
      });
    }
  }
  for (const [index, label] of section2.entries()) {
    const existing = await prisma.onboardingOption.findFirst({ where: { section: 2, label } });
    if (!existing) {
      await prisma.onboardingOption.create({
        data: { section: 2, label, sortOrder: index, isActive: true },
      });
    }
  }
  return section1.length + section2.length;
}

async function seedThemes() {
  const presets = [
    {
      name: 'Novira Indigo',
      isActive: true,
      tokens: {
        '--nv-primary': '99 102 241',
        '--nv-primary-strong': '79 70 229',
        '--nv-bg': '2 6 23',
        '--nv-surface': '15 23 42',
      },
    },
    {
      name: 'Studio Slate',
      isActive: false,
      tokens: {
        '--nv-primary': '14 165 233',
        '--nv-primary-strong': '2 132 199',
        '--nv-bg': '2 6 23',
        '--nv-surface': '15 23 42',
      },
    },
    {
      name: 'Warm Clay',
      isActive: false,
      tokens: {
        '--nv-primary': '217 119 6',
        '--nv-primary-strong': '180 83 9',
        '--nv-bg': '28 25 23',
        '--nv-surface': '41 37 36',
      },
    },
  ];
  for (const preset of presets) {
    const existing = await prisma.themePreset.findFirst({ where: { name: preset.name } });
    if (existing) continue;
    await prisma.themePreset.create({
      data: { name: preset.name, tokens: preset.tokens, isActive: preset.isActive },
    });
  }
  return presets.length;
}

async function seedCategories() {
  for (const c of CATALOG_CATEGORIES) {
    await prisma.catalogCategory.upsert({
      where: { slug: c.slug },
      create: { slug: c.slug, name: c.name, sortOrder: c.order },
      update: { name: c.name, sortOrder: c.order },
    });
  }
  for (const [index, t] of TEXTURE_CATEGORIES.entries()) {
    await prisma.textureCategory.upsert({
      where: { slug: t.slug },
      create: { slug: t.slug, name: t.name },
      update: { name: t.name },
    });
    void index;
  }
  return CATALOG_CATEGORIES.length + TEXTURE_CATEGORIES.length;
}

async function main() {
  const results = {
    categories: await seedCategories(),
    plans: await seedPlans(),
    ratios: await seedRatios(),
    packs: await seedPacks(),
    reasons: await seedCancellationReasons(),
    onboarding: await seedOnboarding(),
    themes: await seedThemes(),
  };

  console.log('[seed] done:');
  for (const [key, count] of Object.entries(results)) {
    console.log(`  ${key.padEnd(12)} ${count}`);
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[seed] failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
