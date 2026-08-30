/** Wire types shared by the API and the web client. */

import type {
  AssetScope,
  CreditLedgerReason,
  CreditMode,
  EditorType,
  FeatureCode,
  JobStatus,
  MemberRole,
  MemberStatus,
  MemberVisibility,
  PlanTier,
  ReviewStatus,
  ShareMode,
  TemplateScope,
  UnitSystem,
  UserRole,
} from './index.js';
import type { SceneDocument } from './scene.js';

/* ── Envelope ──────────────────────────────────────────────────────────── */

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/* ── Auth & account ────────────────────────────────────────────────────── */

export interface SessionUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  role: UserRole;
  planTier: PlanTier;
  preferredUnits: UnitSystem;
  appearance: 'light' | 'dark';
  isEmailVerified: boolean;
  onboardingCompletedAt: string | null;
  creditsRemaining: number;
  monthlyCreditQuota: number;
  company: {
    id: number;
    name: string;
    logoUrl: string | null;
    creditMode: CreditMode;
    poolBalance: number;
    role: MemberRole | null;
    globalModelsEnabled: boolean;
    globalTexturesEnabled: boolean;
  } | null;
}

export interface AuthResponse {
  token: string;
  user: SessionUser;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  accountType: 'individual' | 'company';
  companyName?: string;
  companyCountry?: string;
  companyPostalCode?: string;
  phone?: string;
  marketingOptIn?: boolean;
}

/* ── Projects & plans ──────────────────────────────────────────────────── */

export interface ProjectDto {
  id: number;
  title: string;
  description: string | null;
  planCount: number;
  previewUrls: string[];
  createdAt: string;
  updatedAt: string;
  createdByName?: string;
}

export interface PlanDto {
  id: number;
  projectId: number;
  title: string;
  editorType: EditorType;
  units: UnitSystem;
  previewUrl: string | null;
  isReadOnly: boolean;
  objectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlanDetailDto extends PlanDto {
  scene: SceneDocument;
}

export interface SavePlanRequest {
  scene: SceneDocument;
  previewDataUrl?: string;
}

/* ── Catalogue ─────────────────────────────────────────────────────────── */

export interface CatalogCategoryDto {
  id: number;
  slug: string;
  name: string;
  sortOrder: number;
  itemCount?: number;
}

export interface TextureVariationDto {
  id: number;
  name: string;
  materialId: string;
  textureUrl: string;
  isDefault: boolean;
}

export interface CatalogItemDto {
  id: number;
  categoryId: number;
  categorySlug: string;
  scope: AssetScope;
  name: string;
  description: string | null;
  modelUrl: string;
  previewImage: string | null;
  widthMm: number | null;
  depthMm: number | null;
  heightMm: number | null;
  diameterMm: number | null;
  tableShape: 'round' | 'rectangular' | 'other' | null;
  seatsDefault: number | null;
  isFreePlanAvailable: boolean;
  /** False when the viewer's plan or company blocks placement. */
  isAccessible: boolean;
  lockReason?: 'plan' | 'company' | null;
  textureVariations?: TextureVariationDto[];
  sourceLabel: string | null;
  license: string | null;
  attribution: string | null;
  reviewStatus: ReviewStatus;
}

export interface CatalogQuery {
  q?: string;
  categoryId?: number;
  categorySlug?: string;
  scope?: AssetScope;
  limit?: number;
  offset?: number;
  includeTextureVariations?: boolean;
  tableShape?: 'round' | 'rectangular' | 'other';
  withLinens?: boolean;
}

/* ── Textures ──────────────────────────────────────────────────────────── */

export interface TextureAssetDto {
  id: number;
  categoryId: number;
  categorySlug: string;
  name: string;
  description: string;
  imageUrl: string;
  pbrEnabled: boolean;
  tileSizeM: number | null;
  maps?: Record<string, string>;
}

/* ── Templates & collections ───────────────────────────────────────────── */

export interface TemplateDto {
  id: number;
  scope: TemplateScope;
  title: string;
  description: string | null;
  previewUrl: string | null;
  createdAt: string;
  ownerId: number | null;
}

export interface CollectionDto {
  id: number;
  name: string;
  objectCount: number;
  previewUrl: string | null;
  summary: string | null;
  createdAt: string;
}

/* ── Sharing ───────────────────────────────────────────────────────────── */

export interface ShareDto {
  token: string;
  url: string;
  mode: ShareMode;
  expiresAt: string | null;
}

export interface SharedPlanDto {
  title: string;
  units: UnitSystem;
  scene: SceneDocument;
  companyName: string | null;
  companyLogoUrl: string | null;
}

/* ── Credits & billing ─────────────────────────────────────────────────── */

export interface CreditRatioDto {
  featureCode: FeatureCode;
  label: string;
  description: string | null;
  credits: number;
  isActive: boolean;
}

export interface CreditLedgerEntryDto {
  id: number;
  delta: number;
  reason: CreditLedgerReason;
  featureCode: FeatureCode | null;
  balanceAfter: number;
  expiresAt: string | null;
  createdAt: string;
  userName?: string;
}

export interface CreditPackDto {
  id: number;
  creditAmount: number;
  unitAmount: number;
  currency: string;
  expiryDays: number | null;
  isActive: boolean;
}

export interface PricingDto {
  tiers: Array<{
    tier: PlanTier;
    marketingName: string;
    unitAmount: number;
    currency: string;
    monthlyCredits: number;
    tagline: string;
    features: string[];
    highlight?: boolean;
  }>;
  ratios: CreditRatioDto[];
  packs: CreditPackDto[];
}

export interface SubscriptionSummaryDto {
  planTier: PlanTier;
  billingSource: 'stripe' | 'manual' | 'company';
  cycleEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  monthlyCreditQuota: number;
  creditsRemaining: number;
  purchasedExpiringAt: string | null;
  pendingRequest: { requestedPlan: PlanTier; requestedAt: string } | null;
}

/* ── Company ───────────────────────────────────────────────────────────── */

export interface CompanyMemberDto {
  id: number;
  userId: number | null;
  email: string;
  name: string | null;
  role: MemberRole;
  visibility: MemberVisibility;
  seatPlanTier: PlanTier;
  status: MemberStatus;
  creditsRemaining: number | null;
  invitationExpiresAt: string | null;
  createdAt: string;
}

/* ── AI jobs ───────────────────────────────────────────────────────────── */

export interface AiJobDto {
  id: string;
  processType: FeatureCode;
  status: JobStatus;
  progress: number;
  creditsCharged: number;
  provider: string | null;
  providerModel: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  output: Record<string, unknown> | null;
  createdAt: string;
  completedAt: string | null;
}

/* ── Admin ─────────────────────────────────────────────────────────────── */

export interface AdminDashboardDto {
  totalUsers: number;
  activeSubscribers: number;
  planSplit: Record<PlanTier, number>;
  totalProjects: number;
  totalPlans: number;
  catalogItems: number;
  creditsIssued: number;
  creditsSpent: number;
  jobsByStatus: Record<JobStatus, number>;
  recentSignups: Array<{ id: number; email: string; createdAt: string; planTier: PlanTier }>;
}

export interface AdminUserRow {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  planTier: PlanTier;
  companyName: string | null;
  creditsRemaining: number;
  monthlyCreditQuota: number;
  isBlocked: boolean;
  isEmailVerified: boolean;
  createdAt: string;
}

export interface ThemeConfigDto {
  activePresetId: number;
  presets: Array<{ id: number; name: string; tokens: Record<string, string>; isActive: boolean }>;
  tokens: Record<string, string>;
}
