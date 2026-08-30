/**
 * External AI providers.
 *
 * Each is wrapped behind a narrow interface and reached only through the job
 * subsystem. Two reasons: the field moves fast enough that providers get
 * renamed or deprecated on a monthly basis, and a provider outage must degrade
 * one feature rather than break the editor.
 *
 * A provider with no key configured reports itself unavailable instead of
 * failing at call time, so the UI can say why before the user spends a click.
 */
import { env } from '../lib/env.js';
import { saveAssetBuffer } from './storage.js';
import { ApiError } from '../lib/errors.js';

const UA = 'Novira/1.0';

export interface ProviderStatus {
  available: boolean;
  name: string;
  reason?: string;
}

/* ── Image to 3D (Tripo) ───────────────────────────────────────────────── */

const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi/task';

export const imageTo3d = {
  status(): ProviderStatus {
    return env.ai.tripoApiKey
      ? { available: true, name: 'Tripo3D' }
      : { available: false, name: 'Tripo3D', reason: 'No TRIPO_API_KEY configured.' };
  },

  /** Queue a mesh generation and return the provider's task id. */
  async start(imageDataUrl: string, options: { pbr?: boolean } = {}): Promise<string> {
    if (!env.ai.tripoApiKey) {
      throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Image to 3D is not configured on this server.');
    }

    const match = /^data:image\/(\w+);base64,(.+)$/s.exec(imageDataUrl);
    if (!match) throw ApiError.badRequest('The source image could not be read.');
    const format = match[1] === 'jpeg' ? 'jpg' : match[1]!;

    const response = await fetch(TRIPO_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.ai.tripoApiKey}`,
        'User-Agent': UA,
      },
      body: JSON.stringify({
        type: 'image_to_model',
        file: { type: format, data: match[2] },
        ...(options.pbr ? { texture: true, pbr: true } : {}),
      }),
    });

    const payload = (await response.json()) as { code?: number; data?: { task_id?: string }; message?: string };
    if (!response.ok || !payload?.data?.task_id) {
      throw new ApiError(
        502,
        'PROVIDER_ERROR',
        payload?.message ?? 'The 3D generation service rejected the request.'
      );
    }
    return payload.data.task_id;
  },

  async poll(taskId: string): Promise<{ status: string; progress: number; modelUrl?: string }> {
    const response = await fetch(`${TRIPO_BASE}/${taskId}`, {
      headers: { Authorization: `Bearer ${env.ai.tripoApiKey}`, 'User-Agent': UA },
    });
    const payload = (await response.json()) as {
      data?: { status?: string; progress?: number; output?: { pbr_model?: string; model?: string } };
    };
    const data = payload?.data ?? {};
    return {
      status: data.status ?? 'unknown',
      progress: data.progress ?? 0,
      modelUrl: data.output?.pbr_model ?? data.output?.model,
    };
  },
};

/* ── AI Enhance (image to image) ───────────────────────────────────────── */

export const imageEnhance = {
  status(): ProviderStatus {
    if (env.ai.nanobananaApiKey) return { available: true, name: 'NanoBanana' };
    if (env.ai.openaiApiKey) return { available: true, name: 'OpenAI' };
    return {
      available: false,
      name: 'none',
      reason: 'No image model configured. Set NANOBANANA_API_KEY or OPENAI_API_KEY.',
    };
  },

  /**
   * Produce a photoreal render from the current view.
   *
   * The prompt is built to preserve the layout rather than reinterpret it — the
   * whole value is that the render shows *this* plan, not a plausible event.
   */
  buildPrompt(userPrompt: string | undefined): string {
    const base =
      'Photorealistic architectural visualisation of this event layout. ' +
      'Preserve the exact camera angle, room geometry, object positions and proportions. ' +
      'Improve only materials, lighting and realism. Do not add, remove or move any object.';
    return userPrompt?.trim() ? `${base} ${userPrompt.trim()}` : base;
  },

  async enhance(
    imageDataUrl: string,
    prompt: string
  ): Promise<{ url: string; provider: string; model: string }> {
    if (env.ai.nanobananaApiKey) return enhanceWithNanoBanana(imageDataUrl, prompt);
    if (env.ai.openaiApiKey) return enhanceWithOpenAi(imageDataUrl, prompt);
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'AI Enhance is not configured on this server.');
  },
};

async function enhanceWithNanoBanana(imageDataUrl: string, prompt: string) {
  const create = await fetch('https://nanobnana.com/api/v2/generate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.ai.nanobananaApiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': UA,
    },
    body: JSON.stringify({
      prompt,
      image: imageDataUrl,
      aspect_ratio: '16:9',
      size: '2K',
      format: 'png',
      samples: 1,
    }),
  });

  const started = (await create.json()) as { code?: number; data?: { task_id?: string }; message?: string };
  if (started.code !== 200 || !started.data?.task_id) {
    throw new ApiError(502, 'PROVIDER_ERROR', started.message ?? 'The image service rejected the request.');
  }

  // Poll for the result; the provider is asynchronous.
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const check = await fetch(`https://nanobnana.com/api/v2/task/${started.data.task_id}`, {
      headers: { Authorization: `Bearer ${env.ai.nanobananaApiKey}`, 'User-Agent': UA },
    });
    const status = (await check.json()) as {
      data?: { state?: string; status?: string; images?: string[]; result?: { images?: string[] } };
    };
    const state = status.data?.state ?? status.data?.status;
    const images = status.data?.images ?? status.data?.result?.images;
    if (images?.length) {
      const url = await mirror(images[0]!, 'renders');
      return { url, provider: 'nanobanana', model: 'nanobanana-v2' };
    }
    if (state === 'failed' || state === 'error') {
      throw new ApiError(502, 'PROVIDER_ERROR', 'The image service could not produce a render.');
    }
  }
  throw new ApiError(504, 'PROVIDER_TIMEOUT', 'The render took too long. Try again.');
}

async function enhanceWithOpenAi(imageDataUrl: string, prompt: string) {
  const base64 = imageDataUrl.split(',')[1];
  if (!base64) throw ApiError.badRequest('The canvas image could not be read.');

  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', prompt);
  form.append('size', '1536x1024');
  form.append('image', new Blob([Buffer.from(base64, 'base64')], { type: 'image/png' }), 'plan.png');

  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.ai.openaiApiKey}`, 'User-Agent': UA },
    body: form,
  });

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new ApiError(502, 'PROVIDER_ERROR', payload.error?.message ?? 'The image service failed.');
  }

  const first = payload.data?.[0];
  if (first?.b64_json) {
    const saved = await saveAssetBuffer(
      Buffer.from(first.b64_json, 'base64'),
      `renders/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
    );
    return { url: saved.url, provider: 'openai', model: 'gpt-image-1' };
  }
  if (first?.url) {
    const url = await mirror(first.url, 'renders');
    return { url, provider: 'openai', model: 'gpt-image-1' };
  }
  throw new ApiError(502, 'PROVIDER_ERROR', 'The image service returned nothing usable.');
}

/**
 * Copy a provider artefact onto our own storage.
 *
 * Provider URLs expire. A render referenced from a saved plan must not vanish a
 * week later, so everything is mirrored before it is recorded.
 */
export async function mirror(url: string, subdir: string): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new ApiError(502, 'PROVIDER_ERROR', 'Could not download the generated file.');
  const buffer = Buffer.from(await response.arrayBuffer());
  const extension = url.split('?')[0]!.split('.').pop()?.slice(0, 4) || 'bin';
  const saved = await saveAssetBuffer(
    buffer,
    `${subdir}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
  );
  return saved.url;
}

/** What this server can actually do right now. */
export function providerStatuses() {
  return {
    ai_image_to_3d: imageTo3d.status(),
    ai_enhance: imageEnhance.status(),
    // Wall tracing is local, so it is always available.
    floor_plan_ai_draw: { available: true, name: 'Novira (local)' } as ProviderStatus,
  };
}
