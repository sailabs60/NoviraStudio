import { http } from './api';
import { pollJob, type AiJobLike } from './spatialApi';

/**
 * The AI studio, from the browser.
 *
 * Every generation is a job: post, get an id, poll. That is not an accident of
 * the providers — it is what lets a run be cancelled, refunded, resumed after a
 * reload, and shown with honest progress instead of a spinner that means
 * nothing.
 */

export interface ProviderState {
  available: boolean;
  name: string;
  reason?: string;
}

export interface StudioCapabilities {
  providers: { mockup: ProviderState; mesh: ProviderState; language: ProviderState };
  access: Record<
    string,
    { allowed: boolean; cost?: number; balance?: number; reason?: string; code?: string }
  >;
}

export interface Creation {
  id: string;
  kind: 'model' | 'image';
  feature: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  prompt: string;
  refinedPrompt: string | null;
  style: string | null;
  resultUrl: string | null;
  thumbnailUrl: string | null;
  error: string | null;
  createdAt: string;
}

/* ── The assistant's vocabulary ────────────────────────────────────────── */

export type AgentOperation =
  | { action: 'select'; ids: string[]; note?: string }
  | { action: 'move'; id: string; positionMm: { x: number; y: number; z: number }; note?: string }
  | { action: 'rotate'; id: string; rotationDeg: number; note?: string }
  | { action: 'recolour'; id: string; materialId: string; note?: string }
  | { action: 'delete'; ids: string[]; note?: string }
  | { action: 'duplicate'; id: string; count: number; spacingMm: number; note?: string }
  | { action: 'focus'; id: string }
  | { action: 'open_panel'; panel: string; note?: string }
  | { action: 'generate_3d'; prompt: string; name: string; note?: string }
  | { action: 'apply_look'; look: string; note?: string }
  | { action: 'survey'; note: string }
  /*
   * Set-wide operations. Everything above works on one object; these take a
   * whole group's ids so "replace all the chairs" is one operation rather than
   * 480 — which would neither fit in a reply nor be produced reliably.
   */
  | { action: 'nudge'; ids: string[]; deltaMm: { x: number; y: number; z: number }; note?: string }
  | { action: 'scale'; ids: string[]; scale: { x: number; y: number; z: number }; note?: string }
  | { action: 'resize'; id: string; dimensionsMm: { width?: number; depth?: number; height?: number }; note?: string }
  | { action: 'replace_asset'; ids: string[]; catalogItemId: number; name?: string; note?: string }
  | { action: 'set_material'; ids: string[]; materialId: string; part?: string; note?: string }
  | { action: 'set_artwork'; ids: string[]; imageUrl: string; note?: string }
  | { action: 'set_light'; ids: string[]; colorHex?: string; intensity?: number; note?: string }
  | { action: 'add_more'; likeId: string; count: number; note?: string };

export interface AgentReply {
  reply: string;
  operations: AgentOperation[];
}

export interface SceneSnapshot {
  title?: string;
  units?: string;
  regionCode?: string;
  objectCount: number;
  roomWidthMm?: number;
  roomDepthMm?: number;
  objects: Array<{
    id: string;
    name: string;
    type: string;
    positionMm: { x: number; y: number; z: number };
    widthMm?: number | null;
    depthMm?: number | null;
    heightMm?: number | null;
    /** What part of the event this plays, when it was generated as one. */
    role?: string;
  }>;
  /**
   * Every repeated set in the plan, counted.
   *
   * The object list is capped, because a 571-object event does not fit in a
   * context window. That cap used to mean an instruction like "replace all the
   * chairs" silently reached 200 of 480 of them. This summary is small, always
   * complete, and carries the ids, so an instruction about a whole set can be
   * answered exactly rather than approximately.
   */
  groups?: Array<{
    label: string;
    role?: string;
    count: number;
    /** Every id in the set. Complete, not sampled. */
    ids: string[];
  }>;
  /**
   * What the user has selected in the viewport, in full.
   *
   * "Make this 5 metres wide" is the most natural way to ask for a change, and
   * it is unanswerable without knowing what "this" is. The sampled object list
   * carries only a position and a size; a selected object gets its dimensions,
   * rotation, scale, materials and group membership, because that is the object
   * the next instruction is almost certainly about.
   */
  selection?: {
    count: number;
    /** The whole set when several are selected, so "delete these" works. */
    ids: string[];
    objects: Array<{
      id: string;
      name: string;
      type: string;
      role?: string;
      positionMm: { x: number; y: number; z: number };
      rotationDeg: { x: number; y: number; z: number };
      scale: { x: number; y: number; z: number };
      dimensionsMm?: { width: number; depth: number; height: number };
      catalogItemId?: number;
      /** The set this belongs to, so "the rest of these" resolves. */
      groupId?: string | null;
      groupCount?: number;
      materials?: string[];
    }>;
  };
}

export const studio = {
  capabilities: () => http.get<StudioCapabilities>('/ai/studio/capabilities').then((r) => r.data),

  /** Expand a short idea into a full prompt. Returns the original on failure. */
  refine: (body: { prompt: string; kind: '3d' | '2d'; editing?: boolean }) =>
    http
      .post<{ prompt: string; changed: boolean; creditsCharged: number }>('/ai/studio/refine', body)
      .then((r) => r.data),

  textTo3d: (body: {
    prompt: string;
    style?: string;
    refine?: boolean;
    planId?: number;
    idempotencyKey?: string;
  }) => http.post<AiJobLike>('/ai/studio/text-to-3d', body).then((r) => r.data),

  imageTo3d: (body: { imageUrl: string; prompt?: string; planId?: number; idempotencyKey?: string }) =>
    http.post<AiJobLike>('/ai/studio/image-to-3d', body).then((r) => r.data),

  mockup: (body: {
    prompt: string;
    sourceImageUrl?: string | null;
    styleImageUrl?: string | null;
    aspectRatio?: string;
    size?: '1K' | '2K' | '4K';
    refine?: boolean;
    planId?: number;
    idempotencyKey?: string;
  }) => http.post<AiJobLike>('/ai/studio/mockup', body).then((r) => r.data),

  /**
   * Turn a finished generation into a real catalogue item.
   *
   * The height is the point of this call. A generated mesh has no inherent
   * size, so the catalogue records the one the operator states and scales the
   * measured width and depth to match — which is what lets a generated object
   * sit in a plan drawn in millimetres rather than at an arbitrary scale.
   */
  saveToCatalog: (body: {
    jobId: string;
    name: string;
    description: string;
    categorySlug: string;
    targetHeightMm: number;
    scope?: 'personal' | 'company' | 'global';
  }) =>
    http
      .post<{
        id: number;
        name: string;
        item?: {
          id: number;
          name: string;
          modelUrl: string | null;
          widthMm: number | null;
          depthMm: number | null;
          heightMm: number | null;
        };
      }>('/ai/save-to-catalog', body)
      .then((r) => r.data),

  /** Stop a running generation and refund it. */
  cancel: (id: string) => http.post<AiJobLike>(`/ai/jobs/${id}/cancel`).then((r) => r.data),

  creations: () => http.get<{ items: Creation[] }>('/ai/studio/creations').then((r) => r.data.items),

  removeCreation: (id: string) => http.delete(`/ai/studio/creations/${id}`).then((r) => r.data),

  agent: (body: {
    message: string;
    snapshot: SceneSnapshot;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    imageDataUrl?: string | null;
  }) => http.post<AgentReply>('/ai/studio/agent', body).then((r) => r.data),

  suggest: (body: { snapshot: SceneSnapshot; avoid?: string[] }) =>
    http.post<{ suggestion: string | null; reason?: string }>('/ai/studio/suggest', body).then((r) => r.data),

  /** Wait for a generation, reporting progress as it goes. */
  wait: (jobId: string, onProgress?: (job: AiJobLike) => void) =>
    pollJob(jobId, onProgress, { intervalMs: 3000, timeoutMs: 12 * 60_000 }),
};

export type { AiJobLike };
