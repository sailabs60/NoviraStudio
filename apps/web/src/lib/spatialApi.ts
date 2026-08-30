/**
 * The spatial-platform API surface.
 *
 * Kept beside `api.ts` rather than inside it: that file covers the original
 * product — auth, projects, plans, catalogue — and this covers everything the
 * platform grew into. Splitting them keeps each readable, and the split is
 * along a real seam rather than an arbitrary one.
 *
 * Every method here returns plain data. Nothing in this file knows about React.
 */
import type {
  AdvisorReport,
  Advice,
  BoothEfficiencyRow,
  ConceptResult,
  ConstraintReport,
  Collision,
  LayoutUsageRow,
  MarketplaceListingDto,
  PlanCommentDto,
  PlanVersionDto,
  PlanDrawing,
  PresentationDeck,
  PricedTakeoff,
  RateCard,
  RateLine,
  RegionPack,
  SceneComparison,
  SceneDocument,
  SpecialistDto,
  SpecialistSkill,
  TakeoffLine,
  TakeoffSummary,
  VenueSpec,
  VideoExportPreset,
} from '@novira/shared';
import { http } from './api';

/* ── Wire shapes the server returns ────────────────────────────────────── */

export interface TakeoffResponse {
  planId: number;
  lines: TakeoffLine[];
  summary: TakeoffSummary;
  notes: string[];
  regionCode: string;
}

export interface EstimateResponse {
  planId: number;
  summary: TakeoffSummary;
  notes: string[];
  priced: PricedTakeoff;
  card: { id: number | null; name: string; currency: string; regionCode: string; adjustmentBp: number };
  region: RegionPack;
}

export interface PlanReviewResponse {
  planId: number;
  advisor: AdvisorReport;
  constraints: ConstraintReport;
  collisions: Collision[];
  regionCode: string;
}

export interface RateCardDto {
  id: number;
  name: string;
  currency: string;
  regionCode: string;
  adjustmentBp: number;
  crewRate: number;
  lines: RateLine[];
  labourOverrides: Record<string, number> | null;
  isDefault: boolean;
  scope: 'personal' | 'company';
  updatedAt: string;
}

export interface CompareResponse {
  from: { ref: string; label: string; objectCount: number };
  to: { ref: string; label: string; objectCount: number };
  comparison: SceneComparison;
  summary: string;
}

export interface AiJobLike {
  id: string;
  processType: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  creditsCharged: number;
  provider: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  output: Record<string, unknown> | null;
  createdAt: string;
  completedAt: string | null;
}

export interface SpatialCapability {
  allowed: boolean;
  reason?: string | null;
  cost: number;
  balance: number;
  requiredTier: string;
  provider: string;
  degraded?: boolean;
}

export interface SpatialCapabilities {
  ai_concept: SpatialCapability;
  photo_analysis: SpatialCapability;
  pro_render: SpatialCapability;
  video_render: SpatialCapability;
  deck_generation: SpatialCapability;
  videoPresets: VideoExportPreset[];
}

export interface PhotoAnalysisResult {
  spaceType: string;
  estimatedWidthM: number;
  estimatedDepthM: number;
  estimatedCeilingHeightM: number;
  confidence: string;
  lightingMood: string;
  notes: string[];
  objects: Array<{
    label: string;
    category: string;
    count: number;
    estimatedWidthM: number;
    estimatedHeightM: number;
    position: string;
    confidence: string;
    suggestions: Array<{
      id: number;
      name: string;
      categorySlug: string;
      previewImage: string | null;
      widthMm: number | null;
      heightMm: number | null;
      score: number;
      reason: string;
    }>;
  }>;
  suggestedBrief: ConceptResult['brief'] | null;
}

export interface InsightsResponse {
  summary: {
    totalProjects: number;
    totalPlans: number;
    proposalsSent: number;
    proposalsWon: number;
    conversionBp: number | null;
    wonValue: number;
    currency: string;
    medianDaysToProposal: number | null;
    hoursSaved: number;
  };
  layouts: LayoutUsageRow[];
  booths: BoothEfficiencyRow[];
  manualHours: Record<string, number>;
  rangeDays: number;
  minimumSample: number;
}

export interface MaterialsResponse {
  planId: number;
  title: string;
  summary: TakeoffSummary;
  materials: Array<{ family: string; description: string; unit: string; quantity: number; sources: string[] }>;
  weightKg: number;
  volumeCuM: number;
  truckLoads: number;
}

export interface DrawingResponse extends PlanDrawing {
  planId: number;
  title: string;
  projectTitle: string;
  preparedBy: string;
  units: 'metric' | 'imperial';
  region: RegionPack;
}

export interface WhiteLabelResponse {
  settings: {
    enabled: boolean;
    brandName: string;
    logoUrl: string | null;
    markUrl: string | null;
    primaryColor: string;
    hidePlatformCredit: boolean;
    footerText: string;
    contactEmail: string;
    contactPhone: string;
    website: string;
    subdomain: string | null;
  };
  readiness: { ready: boolean; missing: string[] };
}

/* ── The client ────────────────────────────────────────────────────────── */

export interface VenueImportReport {
  bytesBefore: number;
  bytesAfter: number;
  triangleCount: number;
  textureCount: number;
  unitScale: number;
  convertedFrom: string | null;
  floors: number;
}

export const spatial = {
  /* ── Estimating ────────────────────────────────────────────────────── */
  takeoff: (planId: number) => http.get<TakeoffResponse>(`/plans/${planId}/takeoff`).then((r) => r.data),

  estimate: (planId: number, rateCardId?: number) =>
    http
      .get<EstimateResponse>(`/plans/${planId}/estimate`, { params: rateCardId ? { rateCardId } : {} })
      .then((r) => r.data),

  planReview: (planId: number) => http.get<PlanReviewResponse>(`/plans/${planId}/review`).then((r) => r.data),

  quoteLines: (planId: number, rateCardId?: number) =>
    http
      .get<{ currency: string; lines: unknown[] }>(`/plans/${planId}/estimate/quote-lines`, {
        params: rateCardId ? { rateCardId } : {},
      })
      .then((r) => r.data),

  rateCards: {
    list: () =>
      http
        .get<{
          items: RateCardDto[];
          builtIn: RateCard;
          defaultLines: RateLine[];
          regions: Array<{ code: string; label: string; currency: string; costIndexBp: number }>;
        }>('/rate-cards')
        .then((r) => r.data),
    create: (body: Record<string, unknown>) => http.post<RateCardDto>('/rate-cards', body).then((r) => r.data),
    update: (id: number, body: Record<string, unknown>) =>
      http.patch<RateCardDto>(`/rate-cards/${id}`, body).then((r) => r.data),
    remove: (id: number) => http.delete(`/rate-cards/${id}`).then((r) => r.data),
    duplicate: (id: number, body: { name?: string; regionCode?: string } = {}) =>
      http.post<RateCardDto>(`/rate-cards/${id}/duplicate`, body).then((r) => r.data),
    fromDefaults: (body: { name?: string; regionCode?: string; shareWithCompany?: boolean } = {}) =>
      http.post<RateCardDto>('/rate-cards/from-defaults', body).then((r) => r.data),
  },

  regions: () => http.get<{ items: RegionPack[] }>('/regions').then((r) => r.data.items),

  /* ── Versions, comments, comparison ────────────────────────────────── */
  versions: {
    list: (planId: number) =>
      http.get<{ items: PlanVersionDto[] }>(`/plans/${planId}/versions`).then((r) => r.data.items),
    create: (planId: number, body: { label: string; note?: string; reason?: string; scene?: unknown; previewDataUrl?: string }) =>
      http.post<PlanVersionDto>(`/plans/${planId}/versions`, body).then((r) => r.data),
    get: (planId: number, versionId: number) =>
      http.get<PlanVersionDto & { scene: SceneDocument }>(`/plans/${planId}/versions/${versionId}`).then((r) => r.data),
    restore: (planId: number, versionId: number) =>
      http.post<{ ok: boolean; scene: SceneDocument }>(`/plans/${planId}/versions/${versionId}/restore`).then((r) => r.data),
    remove: (planId: number, versionId: number) =>
      http.delete(`/plans/${planId}/versions/${versionId}`).then((r) => r.data),
  },

  compare: (planId: number, from: string, to: string) =>
    http.get<CompareResponse>(`/plans/${planId}/compare`, { params: { from, to } }).then((r) => r.data),

  comments: {
    list: (planId: number, status: 'open' | 'resolved' | 'all' = 'all') =>
      http.get<{ items: PlanCommentDto[] }>(`/plans/${planId}/comments`, { params: { status } }).then((r) => r.data.items),
    create: (planId: number, body: Record<string, unknown>) =>
      http.post<PlanCommentDto>(`/plans/${planId}/comments`, body).then((r) => r.data),
    reply: (commentId: number, body: string) =>
      http.post(`/comments/${commentId}/replies`, { body }).then((r) => r.data),
    resolve: (commentId: number, resolved: boolean) =>
      http.post<PlanCommentDto>(`/comments/${commentId}/resolve`, { resolved }).then((r) => r.data),
    remove: (commentId: number) => http.delete(`/comments/${commentId}`).then((r) => r.data),

    /* Through a share link — no session required. */
    listPublic: (token: string) =>
      http.get<{ items: PlanCommentDto[] }>(`/share/${token}/comments`).then((r) => r.data.items),
    createPublic: (token: string, body: Record<string, unknown>) =>
      http.post<PlanCommentDto>(`/share/${token}/comments`, body).then((r) => r.data),
    replyPublic: (token: string, commentId: number, body: { body: string; authorName: string }) =>
      http.post(`/share/${token}/comments/${commentId}/replies`, body).then((r) => r.data),
  },

  /* ── Venue library ─────────────────────────────────────────────────── */
  venues: {
    list: (params: Record<string, unknown> = {}) =>
      http
        .get<{ items: Array<VenueSpec & { warnings: string[] }>; cities: string[]; countries: string[] }>('/venue-specs', { params })
        .then((r) => r.data),
    get: (id: number) => http.get<VenueSpec & { warnings: string[] }>(`/venue-specs/${id}`).then((r) => r.data),
    create: (body: Record<string, unknown>) => http.post<VenueSpec>('/venue-specs', body).then((r) => r.data),
    update: (id: number, body: Record<string, unknown>) =>
      http.patch<VenueSpec>(`/venue-specs/${id}`, body).then((r) => r.data),
    remove: (id: number) => http.delete(`/venue-specs/${id}`).then((r) => r.data),
    applyToPlan: (id: number, planId: number, adoptRegion = true) =>
      http
        .post<{ ok: boolean; scene: SceneDocument; applied: number; warnings: string[]; venue: VenueSpec }>(
          `/venue-specs/${id}/apply-to-plan`,
          { planId, adoptRegion }
        )
        .then((r) => r.data),
    capacity: (body: Record<string, unknown>) =>
      http.post<VenueSpec['capacity']>('/venue-specs/capacity', body).then((r) => r.data),

    /**
     * Turn a building model into a venue.
     *
     * Everything the record needs beyond a name and a city is measured off the
     * geometry — size, clear height, and where the floors are — so the form
     * asks for three fields rather than forty. `onProgress` reports the upload
     * itself; the optimisation that follows happens server-side and can take a
     * minute on a large building.
     */
    importModel: (
      file: File,
      meta: { name?: string; city?: string; country?: string; regionCode?: string },
      onProgress?: (percent: number) => void
    ) => {
      const form = new FormData();
      form.append('model', file);
      for (const [key, value] of Object.entries(meta)) if (value) form.append(key, value);
      return http
        .post<{ venue: VenueSpec; report: VenueImportReport }>('/venue-specs/import', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 15 * 60_000,
          onUploadProgress: (event) => {
            if (!onProgress || !event.total) return;
            onProgress(Math.round((event.loaded / event.total) * 100));
          },
        })
        .then((r) => r.data);
    },
  },

  /* ── Marketplace ───────────────────────────────────────────────────── */
  marketplace: {
    browse: (params: Record<string, unknown> = {}) =>
      http
        .get<{ items: MarketplaceListingDto[]; total: number; hasMore: boolean; commissionBp: number }>(
          '/marketplace/listings',
          { params }
        )
        .then((r) => r.data),
    get: (id: number) =>
      http
        .get<MarketplaceListingDto & { payload: unknown; reviews: Array<{ rating: number; review: string | null; authorName: string; createdAt: string }> }>(
          `/marketplace/listings/${id}`
        )
        .then((r) => r.data),
    create: (body: Record<string, unknown>) => http.post('/marketplace/listings', body).then((r) => r.data),
    update: (id: number, body: Record<string, unknown>) =>
      http.patch(`/marketplace/listings/${id}`, body).then((r) => r.data),
    remove: (id: number) => http.delete(`/marketplace/listings/${id}`).then((r) => r.data),
    mine: () =>
      http
        .get<{
          items: Array<
            MarketplaceListingDto & {
              breakdown: { price: number; commission: number; net: number; commissionBp: number };
              earnings: { gross: number; commission: number; net: number; count: number };
            }
          >;
          commissionBp: number;
        }>('/marketplace/my-listings')
        .then((r) => r.data),
    purchase: (id: number) =>
      http
        .post<{ ok: boolean; alreadyOwned?: boolean; payload: unknown; paymentMode: string }>(
          `/marketplace/listings/${id}/purchase`
        )
        .then((r) => r.data),
    purchases: () =>
      http
        .get<{ items: Array<{ purchaseId: number; price: number; currency: string; rating: number | null; listing: MarketplaceListingDto; payload: unknown; purchasedAt: string }> }>(
          '/marketplace/purchases'
        )
        .then((r) => r.data.items),
    review: (purchaseId: number, rating: number, review?: string) =>
      http.post(`/marketplace/purchases/${purchaseId}/review`, { rating, review }).then((r) => r.data),
    reviewQueue: () =>
      http.get<{ items: MarketplaceListingDto[] }>('/marketplace/review-queue').then((r) => r.data.items),
    decide: (id: number, approve: boolean, note?: string) =>
      http.post(`/marketplace/listings/${id}/decision`, { approve, note }).then((r) => r.data),
  },

  /* ── Specialists ───────────────────────────────────────────────────── */
  specialists: {
    list: (params: Record<string, unknown> = {}) =>
      http.get<{ items: SpecialistDto[] }>('/specialists', { params }).then((r) => r.data.items),
    me: () => http.get<SpecialistDto | null>('/specialists/me').then((r) => r.data),
    saveMe: (body: Record<string, unknown>) => http.put<SpecialistDto>('/specialists/me', body).then((r) => r.data),
    request: (body: {
      specialistId: number;
      skill: SpecialistSkill;
      brief: string;
      budget?: number | null;
      currency?: string;
      neededBy?: string;
      projectId?: number;
      planId?: number;
      sharePlan?: boolean;
    }) => http.post<{ id: number; status: string; shareUrl: string | null }>('/specialists/requests', body).then((r) => r.data),
    requests: () =>
      http
        .get<{
          sent: Array<Record<string, unknown>>;
          received: Array<Record<string, unknown>>;
        }>('/specialists/requests')
        .then((r) => r.data),
    respond: (id: number, status: string, note?: string) =>
      http.post(`/specialists/requests/${id}/respond`, { status, note }).then((r) => r.data),
  },

  /* ── Insights ──────────────────────────────────────────────────────── */
  insights: (days = 365) => http.get<InsightsResponse>('/insights', { params: { days } }).then((r) => r.data),

  /* ── Output ────────────────────────────────────────────────────────── */
  drawing: (planId: number, params: Record<string, unknown> = {}) =>
    http.get<DrawingResponse>(`/plans/${planId}/drawing`, { params }).then((r) => r.data),

  materials: (planId: number) => http.get<MaterialsResponse>(`/plans/${planId}/export/materials`).then((r) => r.data),

  deck: (planId: number, body: Record<string, unknown> = {}) =>
    http.post<PresentationDeck>(`/plans/${planId}/export/deck`, body).then((r) => r.data),

  /**
   * Download URLs.
   *
   * Built rather than fetched, because these responses are files and the
   * browser downloads them far better than we could reassemble a Blob — and the
   * Authorization header is not needed on a same-origin GET the user initiates,
   * since the token travels in the interceptor only for XHR. So these open
   * through a fetch-and-save helper below instead.
   */
  downloadDxf: (planId: number, params: Record<string, string> = {}) =>
    downloadFile(`/plans/${planId}/export/dxf`, params, 'dxf'),
  downloadBoq: (planId: number, params: Record<string, string> = {}) =>
    downloadFile(`/plans/${planId}/export/boq`, params, 'csv'),

  /* ── AI ────────────────────────────────────────────────────────────── */
  ai: {
    capabilities: () => http.get<SpatialCapabilities>('/ai/spatial/capabilities').then((r) => r.data),

    conceptPreview: (prompt: string, base: Record<string, unknown> = {}) =>
      http
        .post<ConceptResult & { interpreter: string; interpreterNote: string }>('/ai/concept/preview', { prompt, base })
        .then((r) => r.data),
    concept: (prompt: string, planId?: number, base: Record<string, unknown> = {}) =>
      http.post<AiJobLike>('/ai/concept', { prompt, planId, base }).then((r) => r.data),

    photoAnalysis: (imageDataUrl: string, planId?: number, sourceFilename?: string) =>
      http.post<AiJobLike>('/ai/photo-analysis', { imageDataUrl, planId, sourceFilename }).then((r) => r.data),

    proRender: (body: { imageDataUrl: string; planId?: number; style?: string; prompt?: string }) =>
      http.post<AiJobLike>('/ai/pro-render', body).then((r) => r.data),

    videoSession: (planId: number) =>
      http.post<{ sessionId: string; cost: number }>('/ai/video/session', { planId }).then((r) => r.data),
    videoFrames: (sessionId: string, frames: Array<{ index: number; dataUrl: string }>) =>
      http.post<{ ok: boolean; total: number }>(`/ai/video/${sessionId}/frames`, { frames }).then((r) => r.data),
    videoRender: (body: Record<string, unknown>) => http.post<AiJobLike>('/ai/video/render', body).then((r) => r.data),
    videoDiscard: (sessionId: string) => http.delete(`/ai/video/${sessionId}`).then((r) => r.data),

    deckCopy: (body: { planId: number; clientName?: string; eventName?: string; tone?: string }) =>
      http.post<AiJobLike>('/ai/deck-copy', body).then((r) => r.data),

    job: (id: string) => http.get<AiJobLike>(`/ai/jobs/${id}`).then((r) => r.data),
    cancel: (id: string) => http.post<AiJobLike>(`/ai/jobs/${id}/cancel`).then((r) => r.data),

    media: (planId: number) =>
      http
        .get<{
          images: Array<{ id: number; url: string; model: string | null; prompt: string | null; createdAt: string }>;
          videos: Array<{ id: number; url: string; model: string | null; prompt: string | null; createdAt: string }>;
        }>(`/ai/plans/${planId}/media`)
        .then((r) => r.data),
  },

  /* ── White label ───────────────────────────────────────────────────── */
  whiteLabel: {
    get: () => http.get<WhiteLabelResponse>('/company/white-label').then((r) => r.data),
    save: (body: Record<string, unknown>) =>
      http.patch<WhiteLabelResponse>('/company/white-label', body).then((r) => r.data),
  },
};

/**
 * Fetch a file endpoint and save it.
 *
 * A plain link would miss the Authorization header, and these endpoints are
 * behind auth. Fetching to a Blob and clicking a synthetic anchor is the
 * standard way round that, and the object URL is revoked immediately after —
 * a leaked one holds the whole file in memory for the life of the tab.
 */
async function downloadFile(path: string, params: Record<string, string>, extension: string): Promise<void> {
  const response = await http.get(path, { params, responseType: 'blob' });
  const disposition = String(response.headers['content-disposition'] ?? '');
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ?? `novira-export.${extension}`;

  const url = URL.createObjectURL(response.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Poll a job to completion.
 *
 * One place for the polling loop, because every AI feature needs it and each
 * one writing its own is how they end up with different back-off, different
 * cancellation behaviour and different bugs.
 */
export async function pollJob(
  jobId: string,
  onProgress?: (job: AiJobLike) => void,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<AiJobLike> {
  const interval = opts.intervalMs ?? 1500;
  const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60_000);

  for (;;) {
    const job = await spatial.ai.job(jobId);
    onProgress?.(job);
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return job;
    if (Date.now() > deadline) {
      throw new Error('This is taking longer than expected. It may still finish — check the jobs list in a moment.');
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export type { Advice, AdvisorReport, ConstraintReport, Collision };
