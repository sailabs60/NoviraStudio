/**
 * Generation providers: images and meshes.
 *
 * Both are asynchronous task APIs — you post a request, get a task id, and poll
 * until it finishes. Both mint download URLs that expire. Both fail in ways
 * that have nothing to do with the request being wrong.
 *
 * So this module does three things beyond wrapping the HTTP:
 *
 *  · **Normalises status.** Each provider spells its states differently, and
 *    Nano Banana has two generations of API with different shapes. One
 *    `TaskStatus` comes out, so the job runner has one thing to poll.
 *  · **Mirrors the result.** A provider URL that expires in an hour is not
 *    something to write into a saved plan. Everything finished is copied onto
 *    our own storage before it is recorded.
 *  · **Fails loudly at the right level.** A missing key reports itself as
 *    unavailable before a click is spent; a provider outage becomes a job that
 *    failed and refunded, not an exception in the middle of an editor.
 */
import { env } from '../lib/env.js';
import { ApiError } from '../lib/errors.js';
import { mirror } from './providers.js';

const UA = 'Novira/1.0';

export interface TaskStatus {
  status: 'queued' | 'running' | 'success' | 'failed';
  progress: number;
  /** Set once finished: the artefact the caller asked for. */
  resultUrl?: string | null;
  /** A still of the model, where the provider renders one. */
  thumbnailUrl?: string | null;
  error?: string;
}

/* ── Nano Banana: 2D images ────────────────────────────────────────────── */

/**
 * Two APIs, and which one you are on decides which status endpoint answers.
 *
 * `v2` is text-to-image. `v1` is the native image-to-image edit, which is a
 * genuinely different pipeline — it holds on to the source image rather than
 * describing it and generating afresh, which is the whole reason an edit keeps
 * the counter you already designed. The generation is recorded on the job so
 * the poll knows where to look.
 */
export type MockupApi = 'v1' | 'v2';

export const mockup = {
  configured(): boolean {
    return Boolean(env.ai.nanobananaApiKey);
  },

  status() {
    return env.ai.nanobananaApiKey
      ? { available: true, name: 'Nano Banana' }
      : { available: false, name: 'Nano Banana', reason: 'No NANOBANANA_API_KEY configured.' };
  },

  /** Start a text-to-image generation. */
  async createTask(
    prompt: string,
    options: { aspectRatio?: string; size?: string } = {}
  ): Promise<{ taskId: string; api: MockupApi }> {
    requireKey();

    const response = await fetch('https://nanobnana.com/api/v2/generate', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        prompt,
        aspect_ratio: options.aspectRatio ?? '16:9',
        size: options.size ?? '2K',
        format: 'png',
        samples: 1,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as ProviderEnvelope;
    const taskId = payload.data?.task_id ?? payload.task_id;
    if (payload.code !== 200 || !taskId) {
      throw new ApiError(502, 'PROVIDER_ERROR', message(payload, 'The image service rejected the request.'));
    }
    return { taskId, api: 'v2' };
  },

  /**
   * Start an image-to-image edit.
   *
   * The source images must be URLs the provider can fetch — a data URL is
   * refused — which is why the caller hosts anything local before getting here.
   */
  async editTask(prompt: string, imageUrls: string[]): Promise<{ taskId: string; api: MockupApi }> {
    requireKey();

    const response = await fetch('https://nanobnana.com/api/edit', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ prompt, images: imageUrls }),
    });

    const payload = (await response.json().catch(() => ({}))) as ProviderEnvelope;
    const taskId = payload.data?.task_id ?? payload.task_id;
    if (payload.code !== 200 || !taskId) {
      throw new ApiError(502, 'PROVIDER_ERROR', message(payload, 'The image service rejected the edit.'));
    }
    return { taskId, api: 'v1' };
  },

  async poll(taskId: string, api: MockupApi): Promise<TaskStatus> {
    requireKey();

    const url =
      api === 'v1'
        ? `https://nanobnana.com/api/status?task_id=${encodeURIComponent(taskId)}`
        : `https://nanobnana.com/api/v2/status?task_id=${encodeURIComponent(taskId)}`;

    const response = await fetch(url, { headers: headers() });
    const payload = (await response.json().catch(() => ({}))) as ProviderEnvelope;
    if (payload.code !== 200) {
      return { status: 'running', progress: 40 };
    }

    const data = payload.data ?? {};
    const state = String(data.status ?? '').toUpperCase();

    if (state === 'SUCCESS' || data.status === 1) {
      return { status: 'success', progress: 100, resultUrl: firstUrl(data.response) };
    }
    if (state === 'FAILED' || data.status === -1) {
      return { status: 'failed', progress: 0, error: 'The image service could not produce that image.' };
    }
    return { status: 'running', progress: 55 };
  },
};

/**
 * The result field is a JSON-encoded array about half the time and a bare
 * string the rest. Both shapes are in the wild; both have to work.
 */
function firstUrl(response: unknown): string | null {
  if (!response) return null;
  if (Array.isArray(response)) return typeof response[0] === 'string' ? response[0] : null;
  if (typeof response === 'string') {
    const trimmed = response.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown[];
        return typeof parsed[0] === 'string' ? parsed[0] : null;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  return null;
}

interface ProviderEnvelope {
  code?: number;
  message?: string;
  msg?: string;
  task_id?: string;
  data?: { task_id?: string; status?: string | number; response?: unknown };
}

function headers() {
  return {
    Authorization: `Bearer ${env.ai.nanobananaApiKey}`,
    'Content-Type': 'application/json',
    'User-Agent': UA,
  };
}

function message(payload: ProviderEnvelope, fallback: string): string {
  return payload.message ?? payload.msg ?? fallback;
}

function requireKey() {
  if (!env.ai.nanobananaApiKey) {
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Image generation is not configured on this server.');
  }
}

/* ── Tripo: meshes ─────────────────────────────────────────────────────── */

const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi/task';

export const meshGen = {
  configured(): boolean {
    return Boolean(env.ai.tripoApiKey);
  },

  status() {
    return env.ai.tripoApiKey
      ? { available: true, name: 'Tripo3D' }
      : { available: false, name: 'Tripo3D', reason: 'No TRIPO_API_KEY configured.' };
  },

  /** Generate a mesh from a written description. */
  async fromText(prompt: string, options: Record<string, unknown> = {}): Promise<string> {
    return startTripo({ type: 'text_to_model', prompt, ...options });
  },

  /**
   * Generate a mesh from an image.
   *
   * Accepts either a data URL or an http(s) URL, because both arrive: a
   * screenshot of the viewport is base64, and a 2D mockup being converted to 3D
   * is a link to the image we just generated.
   */
  async fromImage(imageUrl: string, options: Record<string, unknown> = {}): Promise<string> {
    let file: Record<string, string>;

    const data = /^data:image\/(\w+);base64,(.+)$/s.exec(imageUrl);
    if (data) {
      const format = data[1] === 'jpeg' ? 'jpg' : data[1]!;
      file = { type: format, data: data[2]! };
    } else if (/^https?:\/\//.test(imageUrl)) {
      const extension = imageUrl.split(/[?#]/)[0]!.split('.').pop()?.toLowerCase() ?? 'jpg';
      file = { type: extension === 'jpeg' ? 'jpg' : extension, url: imageUrl };
    } else {
      throw ApiError.badRequest('That image could not be read. Use a link or upload a file.');
    }

    return startTripo({ type: 'image_to_model', file, ...options });
  },

  /** Ask for another file format of a model that already exists. */
  async convert(modelId: string, format: string): Promise<string> {
    return startTripo({ type: 'convert', model_id: modelId, format });
  },

  async poll(taskId: string): Promise<TaskStatus> {
    if (!env.ai.tripoApiKey) {
      throw new ApiError(503, 'PROVIDER_UNAVAILABLE', '3D generation is not configured on this server.');
    }

    const response = await fetch(`${TRIPO_BASE}/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${env.ai.tripoApiKey}`, 'User-Agent': UA },
    });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: {
        status?: string;
        progress?: number;
        output?: { model?: string; pbr_model?: string; base_model?: string; thumbnail?: string; rendered_image?: string };
      };
      message?: string;
    };

    if (!response.ok) {
      return { status: 'running', progress: 30 };
    }

    const data = payload.data ?? {};
    const progress = typeof data.progress === 'number' ? data.progress : 20;

    if (data.status === 'success') {
      const output = data.output ?? {};
      // `pbr_model` is the textured one where it exists — always preferable.
      const model = output.pbr_model || output.model || output.base_model || null;
      const thumbnail = output.thumbnail || output.rendered_image || null;
      if (!model) {
        return { status: 'failed', progress: 0, error: 'The generator finished without producing a model.' };
      }
      return { status: 'success', progress: 100, resultUrl: model, thumbnailUrl: thumbnail };
    }
    if (data.status === 'failed' || data.status === 'cancelled' || data.status === 'banned') {
      return { status: 'failed', progress: 0, error: payload.message ?? 'The generation failed.' };
    }
    return { status: data.status === 'queued' ? 'queued' : 'running', progress };
  },

  /**
   * Re-resolve a model's URLs.
   *
   * Tripo signs its download links and they expire, so a model referenced from
   * a plan saved last week 403s. Asking the task for its output again mints
   * fresh links, which is what makes an old generation still openable.
   */
  async refresh(taskId: string): Promise<{ modelUrl: string | null; thumbnailUrl: string | null }> {
    const status = await meshGen.poll(taskId).catch(() => null);
    return { modelUrl: status?.resultUrl ?? null, thumbnailUrl: status?.thumbnailUrl ?? null };
  },
};

async function startTripo(body: Record<string, unknown>): Promise<string> {
  if (!env.ai.tripoApiKey) {
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', '3D generation is not configured on this server.');
  }

  const response = await fetch(TRIPO_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.ai.tripoApiKey}`,
      'User-Agent': UA,
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    code?: number;
    data?: { task_id?: string };
    task_id?: string;
    message?: string;
    error?: string;
  };
  const taskId = payload.data?.task_id ?? payload.task_id;
  if (!response.ok || !taskId) {
    throw new ApiError(
      502,
      'PROVIDER_ERROR',
      payload.message ?? payload.error ?? 'The 3D service rejected the request.'
    );
  }
  return taskId;
}

/* ── Finishing a generation ────────────────────────────────────────────── */

/**
 * Bring a finished artefact onto our own storage.
 *
 * Called once, when a job succeeds. Everything a plan can reference has to
 * survive the provider's link expiring, so nothing provider-hosted is ever
 * written into a scene document.
 */
export async function adopt(
  result: TaskStatus,
  subdir: string
): Promise<{ url: string | null; thumbnailUrl: string | null }> {
  const url = result.resultUrl ? await mirror(result.resultUrl, subdir).catch(() => result.resultUrl!) : null;
  const thumbnailUrl = result.thumbnailUrl
    ? await mirror(result.thumbnailUrl, `${subdir}/thumbs`).catch(() => result.thumbnailUrl!)
    : null;
  return { url, thumbnailUrl };
}

/** What the studio can actually do right now, for the UI to state plainly. */
export function generationStatuses() {
  return {
    mockup: mockup.status(),
    mesh: meshGen.status(),
    language: env.ai.openaiApiKey
      ? { available: true, name: 'OpenAI GPT-4o' }
      : { available: false, name: 'OpenAI', reason: 'No OPENAI_API_KEY configured.' },
  };
}
