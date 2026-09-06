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
    /*
     * Written as an edit instruction, not a description of a scene.
     *
     * A text-to-image model reads a prompt as "make me this". An image editor
     * reads it as "do this to what I gave you", and the difference decides
     * whether the render is the user's room or a stock ballroom. Every clause
     * here refers to *this image* and every constraint is stated as something
     * not to change, because the failure people notice is an object moving or
     * appearing, not a material being slightly off.
     */
    const base = [
      'Re-render THIS EXACT IMAGE as a photorealistic architectural photograph.',
      'This is a 3D layout of a real event. Keep it identical in structure:',
      'the same camera angle and framing, the same room shape and proportions,',
      'every object in exactly the same position, at the same size and rotation,',
      'and the same number of every item. Do not add furniture, people, plants,',
      'signage or decoration that is not already in the image. Do not remove or',
      'move anything. Do not change the layout.',
      'Improve only surface realism: material texture, reflections, shadow',
      'softness, light falloff and overall photographic quality.',
    ].join(' ');
    return userPrompt?.trim() ? `${base} Art direction: ${userPrompt.trim()}` : base;
  },

  async enhance(
    imageDataUrl: string,
    prompt: string,
    onProgress?: (progress: EnhanceProgress) => void
  ): Promise<{ url: string; provider: string; model: string }> {
    if (env.ai.nanobananaApiKey) return enhanceWithNanoBanana(imageDataUrl, prompt, onProgress);
    if (env.ai.openaiApiKey) return enhanceWithOpenAi(imageDataUrl, prompt);
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'AI Enhance is not configured on this server.');
  },
};

/**
 * Enhance a canvas image through Nano Banana.
 *
 * Two things about this provider have to be right or the job hangs rather than
 * fails, which is far worse:
 *
 *  · **The poll endpoint is `/api/v2/status?task_id=`.** This used to call
 *    `/api/v2/task/{id}`, which does not exist and answers 404 with an HTML
 *    error body. The loop looked for an `images` array that would never
 *    appear and for a `failed` state that would never be set, so it span
 *    silently for its whole deadline and the user watched 15% for three
 *    minutes. Verified against the live API: the status document is
 *    `{code:200, data:{status:'IN_PROGRESS'|'SUCCESS'|'FAILED', response:
 *    '["https://…png"]'}}`.
 *  · **`response` is a JSON *string*, not an array.** It arrives as
 *    `"[\"https://…\"]"`, so it has to be parsed before the URL can be read.
 *
 * Every request also carries a timeout. `fetch` has none by default, so a
 * provider that accepts a connection and never answers holds the job open
 * indefinitely — the difference between "this failed, here are your credits"
 * and "this is stuck forever", which is the whole complaint.
 */
const NANO_BASE = 'https://nanobnana.com';
const NANO_REQUEST_TIMEOUT_MS = 45_000;
const NANO_DEADLINE_MS = 5 * 60_000;

async function nanoFetch(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NANO_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.ai.nanobananaApiKey}`,
        'User-Agent': UA,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Read the image URL out of a status document, whatever shape it arrives in. */
function nanoImageUrl(response: unknown): string | null {
  if (!response) return null;
  if (Array.isArray(response)) return typeof response[0] === 'string' ? response[0] : null;
  if (typeof response === 'string') {
    const text = response.trim();
    if (/^https?:\/\//i.test(text)) return text;
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) && typeof parsed[0] === 'string' ? parsed[0] : null;
    } catch {
      return null;
    }
  }
  if (typeof response === 'object') {
    const images = (response as { images?: unknown }).images;
    if (Array.isArray(images) && typeof images[0] === 'string') return images[0];
  }
  return null;
}

export interface EnhanceProgress {
  /** 0-100, as reported by the provider or inferred from elapsed time. */
  percent: number;
  stage: string;
}

/**
 * Put a data URL somewhere the provider can fetch it.
 *
 * Image-to-image endpoints take *links*, not base64 — they fetch the source
 * themselves — so a frame read off the canvas has to exist at a public address
 * before it can be edited. Returns an absolute URL, because "somewhere the
 * provider can reach" is the whole requirement and a relative path is not that.
 */
async function hostImage(imageDataUrl: string, subdir: string): Promise<string> {
  const match = /^data:image\/(\w+);base64,(.+)$/s.exec(imageDataUrl);
  if (!match) {
    // Already a link: nothing to host.
    if (/^https?:\/\//i.test(imageDataUrl)) return imageDataUrl;
    throw ApiError.badRequest('The canvas image could not be read.');
  }

  const extension = match[1] === 'jpeg' ? 'jpg' : match[1]!;
  const saved = await saveAssetBuffer(
    Buffer.from(match[2]!, 'base64'),
    `${subdir}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
  );

  const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  if (saved.url.startsWith('http')) return saved.url;
  if (!base) {
    throw new ApiError(
      500,
      'NO_PUBLIC_URL',
      'PUBLIC_BASE_URL is not set, so the renderer cannot fetch the frame.'
    );
  }
  return `${base}${saved.url}`;
}

async function enhanceWithNanoBanana(
  imageDataUrl: string,
  prompt: string,
  onProgress?: (progress: EnhanceProgress) => void
) {
  /*
   * `/api/edit`, not `/api/v2/generate`.
   *
   * This is the bug behind "AI Enhance invents a completely different room".
   * `/api/v2/generate` is text-to-image: it accepts an `image` field, answers
   * 200, and then ignores it entirely — so the render came from the prompt
   * alone and had nothing to do with the plan on screen. `/api/edit` is the
   * image-to-image pipeline; verified against the live API, it returns the
   * *same* subject re-rendered photorealistically.
   *
   * The edit endpoint fetches the source itself and refuses data URLs, so the
   * canvas frame has to be written somewhere public first. That is what
   * `hostImage` does, and it is the reason this cannot simply post base64.
   */
  onProgress?.({ percent: 8, stage: 'Preparing the frame' });
  const sourceUrl = await hostImage(imageDataUrl, 'renders/source');

  const create = await nanoFetch(`${NANO_BASE}/api/edit`, {
    method: 'POST',
    body: JSON.stringify({ prompt, images: [sourceUrl] }),
  });

  const started = (await create.json().catch(() => ({}))) as {
    code?: number;
    data?: { task_id?: string };
    task_id?: string;
    message?: string;
  };
  const taskId = started.data?.task_id ?? started.task_id;
  if (started.code !== 200 || !taskId) {
    throw new ApiError(502, 'PROVIDER_ERROR', started.message ?? 'The image service rejected the request.');
  }

  onProgress?.({ percent: 20, stage: 'Sent to the renderer' });

  const deadline = Date.now() + NANO_DEADLINE_MS;
  let ticks = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    ticks += 1;

    // The v1 edit pipeline reports on `/api/status`, not the v2 path.
    const check = await nanoFetch(
      `${NANO_BASE}/api/status?task_id=${encodeURIComponent(taskId)}`
    );
    const payload = (await check.json().catch(() => ({}))) as {
      code?: number;
      data?: {
        // v2 reports a string, v1 a number. Both are handled below.
        status?: string | number;
        status_code?: number;
        response?: unknown;
        error_message?: string | null;
      };
    };

    // A transient non-200 is not a failure; the provider rate-limits and
    // occasionally answers 5xx mid-task. Only an explicit FAILED is fatal.
    const data = payload.data ?? {};
    /*
     * The two pipelines report differently and both have to be read.
     *
     * v2 (text-to-image) sets `status` to the string 'IN_PROGRESS' | 'SUCCESS'
     * | 'FAILED'. v1 (the edit endpoint this uses) sets it to a *number*: 3
     * while running, 1 on success, -1 on failure. Checking only the string
     * form meant a finished edit was never recognised and the job ran to its
     * timeout — which is exactly how "did not finish in time" appeared on a
     * render the provider had completed in under a minute.
     */
    const state = String(data.status ?? '').toUpperCase();
    const code = typeof data.status === 'number' ? data.status : data.status_code;

    if (state === 'SUCCESS' || code === 1) {
      const image = nanoImageUrl(data.response);
      if (image) {
        onProgress?.({ percent: 90, stage: 'Saving the render' });
        const url = await mirror(image, 'renders');
        return { url, provider: 'nanobanana', model: 'nanobanana-v2' };
      }
      // SUCCESS with nothing to show is a provider fault, not a wait.
      throw new ApiError(502, 'PROVIDER_ERROR', 'The renderer finished without returning an image.');
    }

    /*
     * Anything that is not "running" and not "done" is a failure.
     *
     * v1 uses `2` for a task it has given up on — most often because it could
     * not fetch the source image, which is what happens when PUBLIC_BASE_URL
     * points somewhere the provider cannot reach, such as localhost. Treating
     * only -1 as failure meant those tasks were polled until the deadline and
     * then reported as a timeout, which sent everyone looking in the wrong
     * place. Naming it is the difference between a five-minute wait and a
     * sentence that says what to fix.
     */
    if (state === 'FAILED' || state === 'ERROR' || code === -1 || code === 2) {
      const detail =
        code === 2
          ? 'The renderer could not read the frame. If this is a local server, ' +
            'PUBLIC_BASE_URL must be an address the provider can reach.'
          : data.error_message || 'The image service could not produce a render.';
      throw new ApiError(502, 'PROVIDER_ERROR', detail);
    }

    /*
     * The provider reports no percentage, so this is an honest estimate from
     * elapsed time rather than a number invented to look busy: it approaches
     * but never reaches the hand-off point, so it cannot claim to be finished
     * before the image exists.
     */
    const elapsed = ticks * 3000;
    const expected = 45_000;
    const percent = 20 + Math.round(65 * (1 - Math.exp(-elapsed / expected)));
    onProgress?.({ percent, stage: 'Rendering' });
  }

  throw new ApiError(
    504,
    'PROVIDER_TIMEOUT',
    'The renderer did not finish in time. Your credits have been returned.'
  );
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
