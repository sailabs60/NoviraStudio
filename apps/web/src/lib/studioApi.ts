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
  | { action: 'survey'; note: string };

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
  }>;
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
