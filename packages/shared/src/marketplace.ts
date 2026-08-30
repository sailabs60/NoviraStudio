/**
 * Marketplace, specialists and white label.
 *
 * Three of the brief's platform features share one shape — a listing, a
 * transaction and a payout — so they share one module rather than three near
 * copies. A stage template someone sells, a venue pack, and a freelance
 * spatial designer's availability are all things offered on the platform by
 * someone other than the platform.
 *
 * The commercial rule that matters is stated once and applied everywhere: the
 * seller sets the price, the platform takes a stated commission, and the
 * seller sees the net before they publish. A marketplace that surprises a
 * seller at payout does not get a second listing.
 */

/* ── Listings ──────────────────────────────────────────────────────────── */

export const LISTING_KINDS = ['plan-template', 'booth-design', 'venue-pack', 'asset-pack', 'lighting-look', 'rate-card'] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

export interface ListingKindInfo {
  key: ListingKind;
  label: string;
  note: string;
  icon: string;
  /** What the buyer receives when they purchase. */
  delivers: string;
}

export const LISTING_KIND_INFO: Record<ListingKind, ListingKindInfo> = {
  'plan-template': {
    key: 'plan-template',
    label: 'Plan template',
    note: 'A complete layout — staging, screens, seating, lighting — ready to adapt.',
    icon: 'layout-template',
    delivers: 'A new plan in your project, with every element editable.',
  },
  'booth-design': {
    key: 'booth-design',
    label: 'Stand design',
    note: 'A designed exhibition stand at a standard module size.',
    icon: 'store',
    delivers: 'A stand object you can drop into any hall plan.',
  },
  'venue-pack': {
    key: 'venue-pack',
    label: 'Venue pack',
    note: 'Verified venue specifications for a city or a venue group.',
    icon: 'building-2',
    delivers: 'Venue records in your library, with constraints ready to apply.',
  },
  'asset-pack': {
    key: 'asset-pack',
    label: 'Asset pack',
    note: 'A themed set of 3D models, measured and catalogued.',
    icon: 'package',
    delivers: 'Catalogue items in your library, usable in every plan.',
  },
  'lighting-look': {
    key: 'lighting-look',
    label: 'Lighting look',
    note: 'A complete rig and look, designed by a lighting designer.',
    icon: 'lightbulb',
    delivers: 'A lighting preset you can apply to any plan.',
  },
  'rate-card': {
    key: 'rate-card',
    label: 'Rate card',
    note: 'Regional pricing compiled from real quotes.',
    icon: 'receipt',
    delivers: 'A rate card you can price any plan against.',
  },
};

export const LISTING_STATUSES = ['draft', 'in_review', 'published', 'rejected', 'withdrawn'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export interface MarketplaceListingDto {
  id: number;
  kind: ListingKind;
  title: string;
  summary: string;
  description: string;
  /** Price in minor units. Zero is free, and free listings are allowed. */
  price: number;
  currency: string;
  previewUrl: string | null;
  galleryUrls: string[];
  tags: string[];
  regionCode: string;
  status: ListingStatus;
  sellerName: string;
  sellerId: number;
  /** Copies sold, shown to build confidence in an unknown seller. */
  sales: number;
  /** Average rating out of five, or null under the sample floor. */
  rating: number | null;
  ratingCount: number;
  /** Whether the current viewer already owns it. */
  owned?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Platform commission, in basis points.
 *
 * A single published rate rather than a negotiated one, because a marketplace
 * where the cut is secret is a marketplace sellers leave. 20 % is the rate the
 * seller sees before they publish and on every payout line.
 */
export const MARKETPLACE_COMMISSION_BP = 2000;

export interface SellerBreakdown {
  price: number;
  commission: number;
  net: number;
  currency: string;
  commissionBp: number;
}

export function sellerBreakdown(price: number, currency: string): SellerBreakdown {
  const commission = Math.round((price * MARKETPLACE_COMMISSION_BP) / 10_000);
  return { price, commission, net: price - commission, currency, commissionBp: MARKETPLACE_COMMISSION_BP };
}

/* ── Specialists ───────────────────────────────────────────────────────── */

export const SPECIALIST_SKILLS = [
  'spatial-design',
  'stand-design',
  'lighting-design',
  'technical-drawing',
  'rigging',
  '3d-visualisation',
  'video-editing',
  'project-management',
  'health-and-safety',
  'fabrication',
] as const;
export type SpecialistSkill = (typeof SPECIALIST_SKILLS)[number];

export const SPECIALIST_SKILL_LABELS: Record<SpecialistSkill, string> = {
  'spatial-design': 'Spatial design',
  'stand-design': 'Stand design',
  'lighting-design': 'Lighting design',
  'technical-drawing': 'Technical drawing',
  rigging: 'Rigging and structures',
  '3d-visualisation': '3D visualisation',
  'video-editing': 'Video and motion',
  'project-management': 'Project management',
  'health-and-safety': 'Health and safety',
  fabrication: 'Fabrication and joinery',
};

export const SPECIALIST_AVAILABILITY = ['available', 'limited', 'booked'] as const;
export type SpecialistAvailability = (typeof SPECIALIST_AVAILABILITY)[number];

export const AVAILABILITY_INFO: Record<SpecialistAvailability, { label: string; note: string; tone: 'success' | 'warning' | 'muted' }> = {
  available: { label: 'Available now', note: 'Taking work this month.', tone: 'success' },
  limited: { label: 'Limited', note: 'Taking selective work; expect a longer lead time.', tone: 'warning' },
  booked: { label: 'Fully booked', note: 'Not taking new work at the moment.', tone: 'muted' },
};

export interface SpecialistDto {
  id: number;
  userId: number | null;
  name: string;
  headline: string;
  bio: string;
  skills: SpecialistSkill[];
  /** Day rate in minor units. Null means "on application". */
  dayRate: number | null;
  currency: string;
  regionCode: string;
  city: string;
  country: string;
  /** Remote-only specialists are useful for drawing and visualisation. */
  remote: boolean;
  availability: SpecialistAvailability;
  avatarUrl: string | null;
  portfolioUrls: string[];
  rating: number | null;
  ratingCount: number;
  completedJobs: number;
  verified: boolean;
  createdAt: string;
}

export const SPECIALIST_REQUEST_STATUSES = ['open', 'accepted', 'declined', 'completed', 'cancelled'] as const;
export type SpecialistRequestStatus = (typeof SPECIALIST_REQUEST_STATUSES)[number];

export interface SpecialistRequestDto {
  id: number;
  specialistId: number;
  specialistName: string;
  projectId: number | null;
  planId: number | null;
  planTitle: string | null;
  skill: SpecialistSkill;
  brief: string;
  /** Budget offered, in minor units. Null is "open to discussion". */
  budget: number | null;
  currency: string;
  neededBy: string | null;
  status: SpecialistRequestStatus;
  /** Whether the plan is shared with the specialist. */
  planShared: boolean;
  shareUrl: string | null;
  createdAt: string;
  respondedAt: string | null;
  responseNote: string | null;
}

/* ── White label ───────────────────────────────────────────────────────── */

/**
 * White-label settings.
 *
 * The point is that an agency can put this in front of their own client without
 * it looking like someone else's tool. That means three surfaces have to change
 * together — the app chrome, the share link a client opens, and the PDF that
 * lands in their inbox — because branding half of them is worse than branding
 * none of them.
 */
export interface WhiteLabelSettings {
  enabled: boolean;
  /** Name shown in place of Novira. */
  brandName: string;
  logoUrl: string | null;
  /** Square mark for tight spaces and the browser tab. */
  markUrl: string | null;
  /** Accent colour, as a hex string. The rest of the palette derives from it. */
  primaryColor: string;
  /** Remove the "Made with Novira" line from shares and exports. */
  hidePlatformCredit: boolean;
  /** Footer line on client-facing documents. */
  footerText: string;
  /** Address clients reply to on a shared proposal. */
  contactEmail: string;
  contactPhone: string;
  website: string;
  /** Custom subdomain, where one has been provisioned. */
  subdomain: string | null;
}

export const DEFAULT_WHITE_LABEL: WhiteLabelSettings = {
  enabled: false,
  brandName: '',
  logoUrl: null,
  markUrl: null,
  primaryColor: '#0072FD',
  hidePlatformCredit: false,
  footerText: '',
  contactEmail: '',
  contactPhone: '',
  website: '',
  subdomain: null,
};

/**
 * Whether the settings are complete enough to switch on.
 *
 * Turning white label on with no logo produces a client-facing page with a gap
 * where a brand should be, which reads worse than the platform's own mark. So
 * the switch is gated on the pieces that are actually visible to a client.
 */
export function whiteLabelReadiness(settings: WhiteLabelSettings): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!settings.brandName.trim()) missing.push('Brand name');
  if (!settings.logoUrl) missing.push('Logo');
  if (!settings.contactEmail.trim()) missing.push('Contact email — a client needs somewhere to reply');
  return { ready: missing.length === 0, missing };
}
