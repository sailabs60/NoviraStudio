/**
 * AI spatial features: concept generation and photo analysis.
 *
 * Both follow the same division of labour, and it is the important design
 * decision in this file:
 *
 *   **The model reads. The engine builds.**
 *
 * A language model is good at turning "modern banking summit with a curved LED
 * wall" into structured intent, and bad at producing a stage that is actually
 * 9.7 m wide. A vision model is good at saying "there is a stage, a screen and
 * about sixty chairs in this photograph", and bad at saying how far apart they
 * are. So in both cases the model produces a *description*, and the
 * deterministic engines in `shared` produce the geometry from it.
 *
 * The consequence is that both features work with no model configured at all —
 * degraded, and honest about it, rather than absent. That matters: an agency
 * without an AI budget still gets a layout from a sentence.
 */
import {
  CONCEPT_SYSTEM_PROMPT,
  generateConcept,
  parseBrief,
  type ConceptBrief,
  type ConceptResult,
} from '@novira/shared';
import { env } from '../lib/env.js';
import { ApiError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

const UA = 'Novira/1.0';

/**
 * The model that reads a brief and lays out a room.
 *
 * `gpt-4o`, not `gpt-4o-mini`. This is the one job in the product where model
 * capability shows up directly in the output: turning "a 200-guest awards
 * dinner" into a room size, a table count, a stage position and a set of
 * camera angles is spatial reasoning, and the mini model is measurably weaker
 * at exactly that — it produces plausible prose and layouts that do not fit
 * the room it just specified.
 *
 * Published evaluations put GPT-4o strongest on 2D layout and relative
 * placement and weakest on 3D pose, which is why everything asked of it here
 * is expressed as a plan: positions in millimetres on a floor, not
 * orientations in space. That plays to what it is good at.
 *
 * Overridable so a deployment can trade cost for quality without a rebuild.
 */
const REASONING_MODEL = process.env.OPENAI_REASONING_MODEL ?? 'gpt-4o';

/**
 * The model that looks at photographs.
 *
 * Also `gpt-4o`: estimating a room's dimensions and spotting what is in it
 * from a single photo is the same spatial problem as above, and the mini
 * model's estimates were loose enough to need correcting by hand, which
 * defeats the point of the feature.
 */
const VISION_MODEL = process.env.OPENAI_VISION_MODEL ?? 'gpt-4o';

/* ── Text model ────────────────────────────────────────────────────────── */

export const textModel = {
  status() {
    return env.ai.openaiApiKey
      ? { available: true, name: 'OpenAI', model: REASONING_MODEL }
      : { available: false, name: 'none', reason: 'No OPENAI_API_KEY configured. Prompts are read by the built-in parser instead.' };
  },

  /**
   * Ask the model for JSON and nothing else.
   *
   * `response_format: json_object` is used rather than trusting the prompt,
   * because "return only JSON" is advice a model takes most of the time, and
   * the failure mode — a code fence around the object — is one that would
   * otherwise need a fragile unwrapping step here.
   */
  async json(system: string, user: string): Promise<Record<string, unknown> | null> {
    if (!env.ai.openaiApiKey) return null;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.ai.openaiApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': UA,
      },
      body: JSON.stringify({
        model: REASONING_MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      // A model that returns malformed JSON is a provider failure, and the
      // caller has a working fallback — so this degrades rather than throws.
      return null;
    }
  },
};

/* ── Vision model ──────────────────────────────────────────────────────── */

export const visionModel = {
  status() {
    return env.ai.openaiApiKey
      ? { available: true, name: 'OpenAI', model: VISION_MODEL }
      : { available: false, name: 'none', reason: 'No OPENAI_API_KEY configured. Photo analysis is unavailable.' };
  },

  async describe(imageDataUrl: string, system: string, instruction: string): Promise<Record<string, unknown> | null> {
    if (!env.ai.openaiApiKey) return null;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.ai.openaiApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': UA,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              { type: 'text', text: instruction },
              { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
            ],
          },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  },
};

/* ── Concept generation ────────────────────────────────────────────────── */

export interface ConceptRunResult extends ConceptResult {
  /** Whether a language model read the prompt, or the built-in parser did. */
  interpreter: 'model' | 'parser';
  interpreterNote: string;
}

/**
 * Turn a prompt into a layout.
 *
 * The model's output is passed through `parseBrief` even when it succeeds. That
 * is deliberate: the parser validates every field against the enumerations, so
 * a model that invents an event kind or returns a string where a number belongs
 * cannot produce a malformed brief. The model widens what can be understood; it
 * never bypasses the schema.
 */
export async function runConcept(prompt: string, base: Partial<ConceptBrief> = {}): Promise<ConceptRunResult> {
  let interpreter: 'model' | 'parser' = 'parser';
  let modelBrief: Partial<ConceptBrief> = {};

  const raw = await textModel.json(CONCEPT_SYSTEM_PROMPT, prompt).catch(() => null);
  if (raw) {
    interpreter = 'model';
    modelBrief = {
      eventKind: raw.eventKind as ConceptBrief['eventKind'],
      seating: raw.seating as ConceptBrief['seating'],
      attendance: Number(raw.attendance) || undefined,
      roomWidthMm: Number(raw.roomWidthMm) || undefined,
      roomDepthMm: Number(raw.roomDepthMm) || undefined,
      roomHeightMm: Number(raw.roomHeightMm) || undefined,
      stage: typeof raw.stage === 'boolean' ? raw.stage : undefined,
      stageProminence: raw.stageProminence as ConceptBrief['stageProminence'],
      screen: raw.screen as ConceptBrief['screen'],
      truss: raw.truss as ConceptBrief['truss'],
      look: typeof raw.look === 'string' ? raw.look : undefined,
      danceFloor: typeof raw.danceFloor === 'boolean' ? raw.danceFloor : undefined,
      bar: typeof raw.bar === 'boolean' ? raw.bar : undefined,
      registration: typeof raw.registration === 'boolean' ? raw.registration : undefined,
      catering: typeof raw.catering === 'boolean' ? raw.catering : undefined,
      boothCount: Number(raw.boothCount) || undefined,
      boothType: raw.boothType as ConceptBrief['boothType'],
    };
    // The schema says 0 means "not stated"; strip those so the derivation runs.
    for (const key of ['roomWidthMm', 'roomDepthMm', 'roomHeightMm', 'attendance'] as const) {
      if (!modelBrief[key]) delete modelBrief[key];
    }
  }

  const brief = parseBrief(prompt, { ...base, ...modelBrief });
  const result = generateConcept(brief);

  return {
    ...result,
    interpreter,
    interpreterNote:
      interpreter === 'model'
        ? 'A language model read your description; every dimension below was then calculated, not generated.'
        : 'Read by the built-in parser. It understands event type, size, seating, screens, truss and extras — see what it picked up below.',
  };
}

/* ── Photo analysis ────────────────────────────────────────────────────── */

const PHOTO_SYSTEM_PROMPT = `You analyse a photograph of an event space and describe what is in it, for a spatial planning tool.

Return ONLY a JSON object:
{
  "spaceType": "ballroom" | "exhibition-hall" | "conference-room" | "auditorium" | "outdoor" | "marquee-site" | "warehouse" | "atrium" | "restaurant" | "arena",
  "estimatedWidthM": number,
  "estimatedDepthM": number,
  "estimatedCeilingHeightM": number,
  "confidence": "high" | "medium" | "low",
  "objects": [
    {
      "label": "short noun phrase, e.g. round banquet table",
      "category": "tables" | "chairs" | "lounge" | "staging" | "draping" | "lighting" | "av-production" | "decor" | "plants" | "bars-catering" | "signage" | "led-systems" | "truss-systems" | "booth-modules" | "other",
      "count": integer,
      "estimatedWidthM": number,
      "estimatedHeightM": number,
      "position": "front" | "centre" | "back" | "left" | "right",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "lightingMood": "bright" | "warm" | "dramatic" | "daylight" | "dark",
  "notes": ["anything a planner should know, one sentence each"]
}

Rules:
- Count only what you can actually see. Do not extrapolate to a whole room from one corner.
- Dimensions are estimates from apparent scale against known objects such as chairs and doors. Say "low" confidence when you are guessing.
- Never invent objects that are not visible.`;

export interface PhotoObject {
  label: string;
  category: string;
  count: number;
  estimatedWidthM: number;
  estimatedHeightM: number;
  position: string;
  confidence: string;
  /** Catalogue items that match this object, best first. */
  suggestions: Array<{
    id: number;
    name: string;
    categorySlug: string;
    previewImage: string | null;
    widthMm: number | null;
    heightMm: number | null;
    /** 0-100. How well the catalogue item matches what was seen. */
    score: number;
    reason: string;
  }>;
}

export interface PhotoAnalysis {
  spaceType: string;
  estimatedWidthM: number;
  estimatedDepthM: number;
  estimatedCeilingHeightM: number;
  confidence: string;
  lightingMood: string;
  objects: PhotoObject[];
  notes: string[];
  /** The layout that would be produced from what was seen. */
  suggestedBrief: ConceptBrief | null;
}

/**
 * Score a catalogue item against something seen in a photograph.
 *
 * Category agreement carries most of the weight, then measured size, then the
 * words in the name. Size is scored on the ratio rather than the difference, so
 * a 10 % error on a chair and a 10 % error on a stage cost the same — which is
 * how a human judges "about right".
 */
function scoreMatch(
  seen: { label: string; category: string; estimatedWidthM: number; estimatedHeightM: number },
  item: { name: string; categorySlug: string; widthMm: number | null; heightMm: number | null }
): { score: number; reason: string } {
  const reasons: string[] = [];
  let score = 0;

  if (item.categorySlug === seen.category) {
    score += 45;
    reasons.push('same category');
  }

  const seenWords = seen.label.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const itemName = item.name.toLowerCase();
  const wordHits = seenWords.filter((w) => itemName.includes(w));
  if (wordHits.length) {
    score += Math.min(30, wordHits.length * 12);
    reasons.push(`name matches "${wordHits.join('", "')}"`);
  }

  if (item.widthMm && seen.estimatedWidthM > 0) {
    const ratio = item.widthMm / 1000 / seen.estimatedWidthM;
    const closeness = ratio > 1 ? 1 / ratio : ratio;
    if (closeness > 0.7) {
      score += Math.round(closeness * 20);
      reasons.push(`width within ${Math.round((1 - closeness) * 100)} %`);
    }
  }
  if (item.heightMm && seen.estimatedHeightM > 0) {
    const ratio = item.heightMm / 1000 / seen.estimatedHeightM;
    const closeness = ratio > 1 ? 1 / ratio : ratio;
    if (closeness > 0.7) score += Math.round(closeness * 5);
  }

  return { score: Math.min(100, score), reason: reasons.join(', ') || 'category and size are approximate' };
}

/**
 * Analyse a photograph into objects, and match those to the catalogue.
 *
 * This is phase one of the brief's photo-to-3D: identify what is there and
 * suggest real, measured models for it. It is more useful than a generated mesh
 * for exactly the reason the asset pipeline exists — a catalogue chair is 450
 * mm wide because it was measured, and a reconstructed one is whatever the
 * photograph implied.
 */
export async function analysePhoto(
  imageDataUrl: string,
  opts: { userId: bigint; companyId: bigint | null }
): Promise<PhotoAnalysis> {
  const raw = await visionModel.describe(
    imageDataUrl,
    PHOTO_SYSTEM_PROMPT,
    'Analyse this event space photograph. Identify the space, estimate its dimensions, and list what you can see.'
  );

  if (!raw) {
    throw new ApiError(
      503,
      'PROVIDER_UNAVAILABLE',
      'Photo analysis needs a vision model. Set OPENAI_API_KEY on the server, or place items from the catalogue by hand.'
    );
  }

  const seenObjects = Array.isArray(raw.objects) ? (raw.objects as Array<Record<string, unknown>>) : [];

  // One query for the whole catalogue slice we might match against, rather than
  // one per detected object — a photograph of a banquet returns a dozen object
  // types and a dozen round trips would dominate the run time.
  const categories = [...new Set(seenObjects.map((o) => String(o.category ?? 'other')))];
  const candidates = await prisma.catalogItem.findMany({
    where: {
      isActive: true,
      reviewStatus: 'approved',
      OR: [{ scope: 'global' }, { ownerId: opts.userId }, ...(opts.companyId ? [{ companyId: opts.companyId }] : [])],
      category: { slug: { in: categories.filter((c) => c !== 'other') } },
    },
    select: {
      id: true,
      name: true,
      widthMm: true,
      heightMm: true,
      previewImage: true,
      category: { select: { slug: true } },
    },
    take: 600,
  });

  const objects: PhotoObject[] = seenObjects.map((o) => {
    const seen = {
      label: String(o.label ?? 'object'),
      category: String(o.category ?? 'other'),
      estimatedWidthM: Number(o.estimatedWidthM) || 0,
      estimatedHeightM: Number(o.estimatedHeightM) || 0,
    };
    const scored = candidates
      .map((item) => {
        const { score, reason } = scoreMatch(seen, {
          name: item.name,
          categorySlug: item.category.slug,
          widthMm: item.widthMm,
          heightMm: item.heightMm,
        });
        return {
          id: Number(item.id),
          name: item.name,
          categorySlug: item.category.slug,
          previewImage: item.previewImage,
          widthMm: item.widthMm,
          heightMm: item.heightMm,
          score,
          reason,
        };
      })
      // Below 40 the "match" is a category coincidence and offering it as a
      // suggestion is worse than offering nothing.
      .filter((s) => s.score >= 40)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    return {
      label: seen.label,
      category: seen.category,
      count: Math.max(1, Number(o.count) || 1),
      estimatedWidthM: seen.estimatedWidthM,
      estimatedHeightM: seen.estimatedHeightM,
      position: String(o.position ?? 'centre'),
      confidence: String(o.confidence ?? 'low'),
      suggestions: scored,
    };
  });

  /*
   * Turn what was seen into a brief, so "photo → layout" is one step rather
   * than two. The sentence is assembled from the detections, which also makes
   * the interpretation visible: the user can read what the analysis thought it
   * saw before anything is placed.
   */
  const totalChairs = objects.filter((o) => o.category === 'chairs').reduce((sum, o) => sum + o.count, 0);
  const hasStage = objects.some((o) => o.category === 'staging');
  const hasScreen = objects.some((o) => o.category === 'led-systems' || /screen|led/i.test(o.label));
  const hasTables = objects.some((o) => o.category === 'tables');

  const descriptionParts = [
    hasTables && totalChairs ? 'banquet' : totalChairs ? 'conference' : 'reception',
    totalChairs ? `for ${Math.max(totalChairs, 20)} people` : '',
    hasStage ? 'with a stage' : '',
    hasScreen ? 'and an LED screen' : '',
    Number(raw.estimatedWidthM) && Number(raw.estimatedDepthM)
      ? `in a ${Number(raw.estimatedWidthM).toFixed(0)} x ${Number(raw.estimatedDepthM).toFixed(0)} m room`
      : '',
  ].filter(Boolean);

  const suggestedBrief = parseBrief(descriptionParts.join(' '), {
    roomWidthMm: Number(raw.estimatedWidthM) ? Math.round(Number(raw.estimatedWidthM) * 1000) : undefined,
    roomDepthMm: Number(raw.estimatedDepthM) ? Math.round(Number(raw.estimatedDepthM) * 1000) : undefined,
    roomHeightMm: Number(raw.estimatedCeilingHeightM) ? Math.round(Number(raw.estimatedCeilingHeightM) * 1000) : undefined,
  });

  const notes = Array.isArray(raw.notes) ? (raw.notes as string[]).slice(0, 8) : [];
  if (String(raw.confidence) !== 'high') {
    notes.unshift(
      'Dimensions are estimated from apparent scale in the photograph. Measure the room before committing to a layout built from them.'
    );
  }

  return {
    spaceType: String(raw.spaceType ?? 'ballroom'),
    estimatedWidthM: Number(raw.estimatedWidthM) || 0,
    estimatedDepthM: Number(raw.estimatedDepthM) || 0,
    estimatedCeilingHeightM: Number(raw.estimatedCeilingHeightM) || 0,
    confidence: String(raw.confidence ?? 'low'),
    lightingMood: String(raw.lightingMood ?? 'bright'),
    objects,
    notes,
    suggestedBrief,
  };
}
