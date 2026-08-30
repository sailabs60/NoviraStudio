/** Domain enumerations shared by the API and the web client. */

export const PLAN_TIERS = ['free', 'plus', 'pro'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const USER_ROLES = ['user', 'company_admin', 'super_admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const MEMBER_ROLES = ['member', 'admin'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBER_VISIBILITY = ['own_only', 'company_wide'] as const;
export type MemberVisibility = (typeof MEMBER_VISIBILITY)[number];

export const MEMBER_STATUS = ['invited', 'active', 'pending_payment', 'payment_failed', 'cancelled'] as const;
export type MemberStatus = (typeof MEMBER_STATUS)[number];

export const CREDIT_MODES = ['per_user', 'shared_pool'] as const;
export type CreditMode = (typeof CREDIT_MODES)[number];

export const ASSET_SCOPES = ['global', 'company', 'personal'] as const;
export type AssetScope = (typeof ASSET_SCOPES)[number];

export const REVIEW_STATUS = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUS)[number];

export const EDITOR_TYPES = ['3d', '2d'] as const;
export type EditorType = (typeof EDITOR_TYPES)[number];

export const CAMERA_MODES = ['perspective', 'top'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export const JOB_STATUS = ['queued', 'in_progress', 'completed', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUS)[number];

export const TEMPLATE_SCOPES = ['local', 'global'] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

export const SHARE_MODES = ['view', 'embed'] as const;
export type ShareMode = (typeof SHARE_MODES)[number];

/* ── Credits ───────────────────────────────────────────────────────────── */

export const FEATURE_CODES = [
  'ai_image_to_3d',
  'ai_enhance',
  'ai_enhance_pro',
  'floor_plan_ai_draw',
  'map_import',
  'venue_generation',
  'ai_concept',
  'photo_analysis',
  'pro_render',
  'video_render',
  'deck_generation',
  /* ── The AI studio ───────────────────────────────────────────────────
   * Generative work that produces an *asset* rather than a change to the
   * plan. Kept as separate codes so each can be priced, gated and disabled
   * on its own — a workspace may well want mockups without model
   * generation, and an admin has to be able to say so.
   */
  'ai_text_to_3d',
  'ai_mockup',
  'ai_prompt_refine',
  'ai_assistant',
] as const;
export type FeatureCode = (typeof FEATURE_CODES)[number];

/**
 * Default credit cost per metered action. These are seeds only — the live
 * values are rows in `credit_ratio` and are editable from the admin console,
 * so nothing in the app may hard-code them.
 */
export const DEFAULT_CREDIT_RATIOS: Record<FeatureCode, number> = {
  ai_image_to_3d: 10,
  ai_enhance: 2,
  ai_enhance_pro: 4,
  floor_plan_ai_draw: 3,
  map_import: 1,
  venue_generation: 20,
  ai_concept: 5,
  photo_analysis: 3,
  pro_render: 8,
  video_render: 15,
  deck_generation: 2,
  ai_text_to_3d: 10,
  ai_mockup: 15,
  ai_prompt_refine: 2,
  ai_assistant: 1,
};

export const FEATURE_LABELS: Record<FeatureCode, string> = {
  ai_image_to_3d: 'AI Image to 3D',
  ai_enhance: 'AI Enhance',
  ai_enhance_pro: 'AI Enhance (Pro model)',
  floor_plan_ai_draw: 'Floor Plan AI Draw',
  map_import: 'Map Import',
  venue_generation: 'Venue Generation',
  ai_concept: 'AI Concept Generator',
  photo_analysis: 'Photo to Layout',
  pro_render: 'Pro Render (raytraced)',
  video_render: 'Walkthrough Video Render',
  deck_generation: 'Presentation Deck',
  ai_text_to_3d: 'AI Text to 3D',
  ai_mockup: 'AI 2D Mockup',
  ai_prompt_refine: 'AI Prompt Refinement',
  ai_assistant: 'Design Assistant',
};

export const CREDIT_LEDGER_REASONS = [
  'cycle_grant',
  'purchase',
  'debit',
  'refund',
  'transfer_in',
  'transfer_out',
  'admin_adjustment',
] as const;
export type CreditLedgerReason = (typeof CREDIT_LEDGER_REASONS)[number];

/** Monthly credit allowance per tier — seeds for `plan_credit_quota`. */
export const DEFAULT_PLAN_CREDITS: Record<PlanTier, number> = {
  free: 0,
  plus: 100,
  pro: 200,
};

/* ── Error codes ───────────────────────────────────────────────────────── */

export const ERROR_CODES = {
  PLAN_UPGRADE_REQUIRED: 'PLAN_UPGRADE_REQUIRED',
  PLAN_REQUEST_PENDING: 'PLAN_REQUEST_PENDING',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  TEMPLATE_TITLE_EXISTS: 'TEMPLATE_TITLE_EXISTS',
  PROJECT_HAS_PLANS: 'PROJECT_HAS_PLANS',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  EMAIL_IN_USE: 'EMAIL_IN_USE',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  READ_ONLY_PLAN: 'READ_ONLY_PLAN',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/* ── Catalogue taxonomy ────────────────────────────────────────────────── */

/**
 * The event-rental catalogue taxonomy. Slugs are stable identifiers used by
 * the asset pipeline to decide what a fetched model is allowed to be filed as.
 */
export const CATALOG_CATEGORIES = [
  { slug: 'tables', name: 'Tables', order: 10 },
  { slug: 'chairs', name: 'Chairs', order: 20 },
  { slug: 'lounge', name: 'Lounge & Soft Seating', order: 30 },
  { slug: 'tents', name: 'Tents & Structures', order: 40 },
  { slug: 'staging', name: 'Staging & Risers', order: 50 },
  { slug: 'draping', name: 'Draping & Backdrops', order: 60 },
  { slug: 'dance-floors', name: 'Dance Floors & Rugs', order: 70 },
  { slug: 'bars-catering', name: 'Bars & Catering', order: 80 },
  { slug: 'tableware', name: 'Tableware & Place Settings', order: 90 },
  { slug: 'linens', name: 'Linens', order: 100 },
  { slug: 'centerpieces', name: 'Centerpieces & Florals', order: 110 },
  { slug: 'lighting', name: 'Lighting', order: 120 },
  { slug: 'av-production', name: 'AV & Production', order: 130 },
  { slug: 'plants', name: 'Plants & Greenery', order: 140 },
  { slug: 'decor', name: 'Decor & Accessories', order: 150 },
  { slug: 'doors-windows', name: 'Doors & Windows', order: 160 },
  { slug: 'signage', name: 'Signage & Wayfinding', order: 170 },
  { slug: 'outdoor', name: 'Outdoor & Site', order: 180 },
  /*
   * Production categories.
   *
   * These sit apart from the rental furniture above because they are bought by
   * a different person for a different reason: a planner picks chairs, a
   * production manager picks truss. Keeping the slugs distinct means the asset
   * pipeline can hold them to different dimensional bands — a "truss section"
   * has a plausible size range that has nothing to do with a "chair".
   */
  { slug: 'stage-structures', name: 'Stage Structures', order: 190 },
  { slug: 'truss-systems', name: 'Truss Systems', order: 200 },
  { slug: 'led-systems', name: 'LED Systems', order: 210 },
  { slug: 'booth-modules', name: 'Exhibition Booth Modules', order: 220 },
  { slug: 'lighting-fixtures', name: 'Lighting Fixtures', order: 230 },
  { slug: 'av-equipment', name: 'AV Equipment', order: 240 },
  { slug: 'seating-layouts', name: 'Seating Layouts', order: 250 },
  { slug: 'power-distribution', name: 'Power & Distribution', order: 260 },
] as const;

export type CatalogCategorySlug = (typeof CATALOG_CATEGORIES)[number]['slug'];

export const TEXTURE_CATEGORIES = [
  { slug: 'fabric', name: 'Fabric' },
  { slug: 'linens', name: 'Linens' },
  { slug: 'wood', name: 'Wood' },
  { slug: 'stone', name: 'Stone & Tile' },
  { slug: 'metal', name: 'Metal' },
  { slug: 'concrete', name: 'Concrete & Plaster' },
  { slug: 'carpet', name: 'Carpet' },
  { slug: 'wallpaper', name: 'Wallpaper' },
  { slug: 'ground', name: 'Ground & Grass' },
] as const;
