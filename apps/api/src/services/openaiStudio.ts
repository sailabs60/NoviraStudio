/**
 * The language model layer.
 *
 * Four jobs, and they are deliberately narrow:
 *
 *  · **Refine a prompt.** Someone types "gold chair". A generation model needs
 *    material, lighting, form and style to produce anything usable, and asking
 *    a designer to write that is asking them to learn a second craft.
 *  · **Read an image.** Extract the style, palette, lighting and materials of a
 *    reference so a generation carries them without anyone describing them.
 *  · **Answer about the scene.** The assistant sees a snapshot of what is in
 *    the plan and can propose changes as structured operations.
 *  · **Suggest the next move.** One sentence, unprompted, based on what is
 *    actually in the room.
 *
 * Two rules run through all of it.
 *
 * **The model never invents a dimension.** It produces intent — a name, a
 * position, a colour, a request to generate — and the editor's own arithmetic
 * turns that into geometry. A language model asked for "a stage 9.7 m wide"
 * will confidently give you 9.4, and in a tool that prices what it draws that
 * is not a rounding error, it is a wrong invoice.
 *
 * **Failure is never fatal.** Every function here returns the caller's input,
 * or null, when the model is unavailable or answers badly. Refinement that
 * fails leaves the original prompt, which still generates. An assistant that
 * cannot reach OpenAI says so. Nothing throws its way up into a user's plan.
 */
import { env } from '../lib/env.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o';
const TIMEOUT_MS = 45_000;

export function openAiConfigured(): boolean {
  return Boolean(env.ai.openaiApiKey);
}

type Content = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: Content;
}

/**
 * One call to the chat API.
 *
 * Returns null rather than throwing on any failure — a missing key, a timeout,
 * a rate limit, a malformed response. Every caller has a defined behaviour for
 * "the model did not answer", and that behaviour is always better than an
 * error surfacing in the middle of somebody's design session.
 */
async function chat(
  messages: Message[],
  options: { temperature?: number; maxTokens?: number; json?: boolean } = {}
): Promise<string | null> {
  if (!env.ai.openaiApiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.ai.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: options.temperature ?? 0.7,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.warn(`[openai] ${response.status}: ${detail.slice(0, 200)}`);
      return null;
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      console.warn('[openai] request failed:', (error as Error).message);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Prompt refinement ─────────────────────────────────────────────────── */

/**
 * A short idea, turned into a 3D generation prompt.
 *
 * Under 400 characters on purpose: mesh generators degrade past roughly that
 * length, drifting toward the average of everything mentioned rather than the
 * thing asked for.
 *
 * `history` is the session so far. It is what makes a follow-up like "now in
 * walnut" produce the same chair in walnut rather than an unrelated walnut
 * object.
 */
export async function refine3dPrompt(idea: string, history: string[] = []): Promise<string> {
  const refined = await chat(
    [
      {
        role: 'system',
        content: [
          'You write prompts for a 3D mesh generation model. Turn a short idea into one production-ready prompt.',
          '',
          'Rules:',
          '1. Name the object first and plainly. The generator anchors on the first noun.',
          '2. State the materials — brushed steel, oak veneer, powder-coated aluminium, moulded polypropylene.',
          '3. State the form and proportion, not the dimensions. The engine sizes it, not you.',
          '4. State the finish and how it catches light. Matt, satin, gloss, anodised.',
          '5. Say "studio lighting, neutral background, single object, centred" — these are event props, not scenes.',
          '6. Under 400 characters. Longer prompts make the generator average things.',
          '7. Return only the prompt. No preamble, no quotes, no explanation.',
          history.length
            ? `\nSESSION SO FAR — keep the same subject unless told otherwise:\n${history.join('\n')}`
            : '',
        ].join('\n'),
      },
      { role: 'user', content: idea },
    ],
    { temperature: 0.7, maxTokens: 220 }
  );

  return refined && refined.length > 5 ? refined : idea;
}

/**
 * A short idea, turned into a 2D mockup prompt.
 *
 * `editMode` changes the job entirely. When someone is editing an existing
 * image and says "add a bar", describing a bar produces a picture of a bar —
 * the original scene is gone. In edit mode the model is told to merge the new
 * request into a full description of the *whole* scene, so the image model has
 * something to hold on to.
 */
export async function refineMockupPrompt(
  idea: string,
  history: string[] = [],
  editMode = false
): Promise<string> {
  const system = editMode
    ? [
        'You are a creative director. The user is editing an existing generated image.',
        'MERGE their new request with the subject already established in the session into ONE complete scene description.',
        'Never describe only the change. If the scene is a reception counter and they say "add greenery",',
        'describe the reception counter WITH greenery — the counter must survive.',
        'Under 800 characters. Return only the merged prompt.',
      ].join('\n')
    : [
        'You write prompts for a high-end image generation model, for event and exhibition design mockups.',
        '',
        'Cover, in this order: the subject, the space it is in, the materials and finishes,',
        'the lighting and time of day, the camera position and lens, and the mood.',
        'Prefer photographic language — "shot on a 35 mm lens at f/4", "soft overhead daylight" —',
        'over adjectives like "stunning" or "beautiful", which tell the model nothing.',
        'Never ask for text, lettering, signage copy or logos: generators render them as nonsense.',
        'Under 800 characters. Return only the prompt.',
      ].join('\n');

  const refined = await chat(
    [
      {
        role: 'system',
        content: history.length ? `${system}\n\nSESSION SO FAR:\n${history.join('\n')}` : system,
      },
      { role: 'user', content: idea },
    ],
    { temperature: 0.8, maxTokens: 400 }
  );

  return refined && refined.length > 5 ? refined : idea;
}

/**
 * What a reference image looks like, in words.
 *
 * Used to carry a style across a generation without the user having to
 * describe it. Returns null on failure, and the caller simply generates
 * without the style context rather than failing.
 */
export async function analyseVisualStyle(imageUrl: string): Promise<string | null> {
  return chat(
    [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Describe this image so another model can reproduce its look exactly: palette, lighting direction ' +
              'and quality, materials and finishes, camera angle and lens character, and overall mood. ' +
              'Do not describe the subject — only the style. Under 150 words, no preamble.',
          },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    { temperature: 0.4, maxTokens: 320 }
  );
}

/* ── The scene assistant ───────────────────────────────────────────────── */

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

/**
 * What the assistant is allowed to do.
 *
 * A closed list, because an open one is how an assistant ends up "helpfully"
 * deleting a plan. Every operation is applied by the editor's own store, goes
 * through undo, and is described back to the user in plain English before it
 * shows up in the room.
 */
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

const AGENT_SYSTEM = [
  'You are the design assistant inside Novira, a 3D planning tool for events, exhibitions and stages.',
  'You are talking to a professional designer. Be brief, concrete and free of filler.',
  '',
  'YOU CAN SEE the current plan as a JSON snapshot: every object, its type, its name and its position',
  'in millimetres. Answer questions about it from that snapshot and nothing else. If it is not in the',
  'snapshot, say you cannot see it rather than guessing.',
  '',
  'YOU MUST NOT INVENT DIMENSIONS. Novira computes every size, span, load and cost itself. When a change',
  'needs arithmetic — "make the stage wide enough for 400 people" — say which panel does it and why,',
  'rather than producing a number.',
  '',
  'You may propose operations. Return JSON of the form:',
  '{ "reply": "one or two sentences", "operations": [ ... ] }',
  '',
  'Allowed operations:',
  '  { "action": "select", "ids": ["..."] }',
  '  { "action": "move", "id": "...", "positionMm": { "x": 0, "y": 0, "z": 0 } }',
  '  { "action": "rotate", "id": "...", "rotationDeg": 90 }',
  '  { "action": "recolour", "id": "...", "materialId": "builtin:oak-natural" }',
  '  { "action": "delete", "ids": ["..."] }',
  '  { "action": "duplicate", "id": "...", "count": 4, "spacingMm": 1800 }',
  '  { "action": "focus", "id": "..." }',
  '  { "action": "open_panel", "panel": "add|build|finish|site|light|cost|check|present|review" }',
  '  { "action": "generate_3d", "prompt": "...", "name": "..." }',
  '  { "action": "apply_look", "look": "corporate-summit" }',
  '  { "action": "survey", "note": "..." }',
  '',
  'Use ids exactly as they appear in the snapshot. Propose no operations at all if the user only asked a',
  'question — an answer is a complete response. Never propose deleting more than the user asked for.',
].join('\n');

export async function sceneAgent(input: {
  message: string;
  snapshot: SceneSnapshot;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  imageDataUrl?: string | null;
}): Promise<AgentReply> {
  if (!openAiConfigured()) {
    return {
      reply:
        'The assistant is not configured on this server — it needs an OpenAI key. Everything else in Novira works without it, and the Full brief tab still lays out a room using the built-in engine.',
      operations: [],
    };
  }

  const messages: Message[] = [
    { role: 'system', content: AGENT_SYSTEM },
    { role: 'system', content: `CURRENT PLAN:\n${JSON.stringify(input.snapshot).slice(0, 12_000)}` },
  ];

  for (const turn of (input.history ?? []).slice(-8)) {
    messages.push({ role: turn.role, content: turn.content.slice(0, 2000) });
  }

  if (input.imageDataUrl) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: input.message },
        { type: 'image_url', image_url: { url: input.imageDataUrl } },
      ],
    });
  } else {
    messages.push({ role: 'user', content: input.message });
  }

  const raw = await chat(messages, { temperature: 0.5, json: true, maxTokens: 700 });
  if (!raw) {
    return { reply: 'I could not reach the model just then. Try again in a moment.', operations: [] };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AgentReply>;
    return {
      reply: typeof parsed.reply === 'string' ? parsed.reply : 'Done.',
      operations: Array.isArray(parsed.operations) ? (parsed.operations as AgentOperation[]) : [],
    };
  } catch {
    // A model that ignored the format is still saying something useful.
    return { reply: raw.slice(0, 800), operations: [] };
  }
}

/* ── Smart suggestions ─────────────────────────────────────────────────── */

/**
 * One unprompted, contextual next step.
 *
 * The value is entirely in it being *specific*. "Consider adding lighting" is
 * worse than nothing — it is the design equivalent of a loading spinner. So the
 * model is given the plan and told to name a real object, a real number of
 * seats, a real gap it can see.
 *
 * `avoid` carries the suggestions already shown, so the dock does not offer the
 * same advice twice in a session.
 */
export async function smartSuggestion(snapshot: SceneSnapshot, avoid: string[] = []): Promise<string | null> {
  if (!openAiConfigured()) return null;

  const suggestion = await chat(
    [
      {
        role: 'system',
        content: [
          'You are a senior event designer looking over a colleague\'s shoulder at a plan in progress.',
          'Offer exactly one next step. Two sentences at most.',
          '',
          'It must be specific to what is actually in the plan: name an object that is there, a gap you can',
          'see, a count that looks wrong. Never offer generic advice like "consider the lighting" or',
          '"think about flow" — that is worse than silence.',
          'Never state a dimension: Novira computes those. Say what to do, not what size to make it.',
          'If the plan is empty, suggest one concrete starting point for an event, not a list.',
          'No preamble, no "you could consider". Just the suggestion.',
          avoid.length ? `\nALREADY SUGGESTED — say something different:\n${avoid.slice(-6).join('\n')}` : '',
        ].join('\n'),
      },
      { role: 'user', content: JSON.stringify(snapshot).slice(0, 8000) },
    ],
    { temperature: 0.9, maxTokens: 160 }
  );

  return suggestion;
}
