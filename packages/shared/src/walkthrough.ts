/**
 * The walkthrough engine.
 *
 * Agencies win work with motion, and the difference between a video that sells
 * and one that does not is almost entirely camera discipline: constant speed,
 * eased starts and stops, no roll, and a subject that stays framed. Left to
 * drag an orbit control and screen-record it, nobody produces that.
 *
 * So a walkthrough here is a sequence of *shots*, each with a kind, a duration
 * and an easing curve, and the engine samples the camera at any time along the
 * sequence. That gives three things at once: a live preview in the viewport, a
 * deterministic frame for an offline render, and a timeline someone can edit
 * shot by shot without retiming everything else.
 *
 * Positions are millimetres, angles degrees, durations milliseconds.
 */
import type { CameraEasing, CameraShot, CameraShotKind, SceneWalkthrough, Vec3 } from './scene.js';

/* ── Easing ────────────────────────────────────────────────────────────── */

/**
 * Easing curves.
 *
 * `ease-in-out` is the default and does most of the work: a camera that starts
 * and stops abruptly reads as a computer moving, and one that eases reads as an
 * operator. Linear is kept for orbit loops, where an ease produces a visible
 * stutter every time the loop repeats.
 */
export const EASING_FUNCTIONS: Record<CameraEasing, (t: number) => number> = {
  linear: (t) => t,
  'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  'ease-out': (t) => 1 - (1 - t) ** 3,
  'ease-in': (t) => t * t * t,
};

export const EASING_LABELS: Record<CameraEasing, string> = {
  linear: 'Constant speed',
  'ease-in-out': 'Ease in and out',
  'ease-out': 'Fast start, gentle stop',
  'ease-in': 'Gentle start, fast finish',
};

export const SHOT_KIND_INFO: Record<CameraShotKind, { label: string; note: string; icon: string }> = {
  static: { label: 'Hold', note: 'The camera does not move. Use it to let something land.', icon: 'square' },
  dolly: { label: 'Dolly', note: 'Travel in a straight line — the push in, or the pull back.', icon: 'move-right' },
  orbit: { label: 'Orbit', note: 'Circle a subject at a fixed distance. The product-shot move.', icon: 'rotate-3d' },
  flythrough: { label: 'Fly through', note: 'Travel a path through the space at eye level or above.', icon: 'plane' },
  crane: { label: 'Crane', note: 'Rise or fall while holding on the subject.', icon: 'move-vertical' },
  reveal: { label: 'Reveal', note: 'Start tight on a detail and pull out to show the whole room.', icon: 'maximize' },
};

/* ── Sampling ──────────────────────────────────────────────────────────── */

export interface CameraSample {
  positionMm: Vec3;
  targetMm: Vec3;
  fov: number;
  /** Index of the shot this frame belongs to, for the timeline cursor. */
  shotIndex: number;
  /** Progress through that shot, 0-1. */
  shotProgress: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
});

/** Total run time of a sequence, holds included. */
export function walkthroughDuration(shots: CameraShot[]): number {
  return shots.reduce((sum, shot) => sum + Math.max(0, shot.durationMs) + Math.max(0, shot.holdMs ?? 0), 0);
}

/**
 * Where the camera is at time `timeMs`.
 *
 * Every shot kind reduces to an interpolation between two positions and two
 * look-at points; an orbit differs only in that its position is derived from an
 * angle rather than a straight line. Keeping them all in one function is what
 * guarantees the joins between shots are continuous.
 */
export function sampleWalkthrough(shots: CameraShot[], timeMs: number): CameraSample | null {
  if (!shots.length) return null;

  let remaining = Math.max(0, timeMs);
  for (const [index, shot] of shots.entries()) {
    const move = Math.max(1, shot.durationMs);
    const hold = Math.max(0, shot.holdMs ?? 0);

    if (remaining > move + hold && index < shots.length - 1) {
      remaining -= move + hold;
      continue;
    }

    const raw = Math.min(1, remaining / move);
    const eased = EASING_FUNCTIONS[shot.easing](raw);
    const lookAtEnd = shot.lookAtEndMm ?? shot.lookAtMm;

    let positionMm: Vec3;
    switch (shot.kind) {
      case 'orbit': {
        /*
         * Orbit keeps the radius and height of the start point and sweeps the
         * angle. Deriving the radius from the start rather than storing it
         * separately means dragging the start handle in the viewport changes
         * the orbit exactly as you would expect.
         */
        const centre = shot.lookAtMm;
        const dx = shot.fromMm.x - centre.x;
        const dz = shot.fromMm.z - centre.z;
        const radius = Math.hypot(dx, dz);
        const startAngle = Math.atan2(dz, dx);
        const sweep = ((shot.sweepDeg ?? 360) * Math.PI) / 180;
        const angle = startAngle + sweep * eased;
        positionMm = {
          x: centre.x + Math.cos(angle) * radius,
          y: lerp(shot.fromMm.y, shot.toMm.y, eased),
          z: centre.z + Math.sin(angle) * radius,
        };
        break;
      }
      case 'static':
        positionMm = { ...shot.fromMm };
        break;
      default:
        positionMm = lerpVec(shot.fromMm, shot.toMm, eased);
        break;
    }

    return {
      positionMm,
      targetMm: lerpVec(shot.lookAtMm, lookAtEnd, eased),
      fov: shot.fov,
      shotIndex: index,
      shotProgress: raw,
    };
  }

  const last = shots[shots.length - 1]!;
  return {
    positionMm: last.kind === 'static' ? { ...last.fromMm } : { ...last.toMm },
    targetMm: { ...(last.lookAtEndMm ?? last.lookAtMm) },
    fov: last.fov,
    shotIndex: shots.length - 1,
    shotProgress: 1,
  };
}

/* ── Automatic sequences ───────────────────────────────────────────────── */

export interface AutoWalkthroughInput {
  /** Extents of everything placed, in plan millimetres. */
  boundsMm: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Ceiling or trim height, so a crane does not go through the roof. */
  roomHeightMm: number;
  /** Points of interest, in the order they should be visited. */
  subjects: Array<{ name: string; xMm: number; zMm: number; widthMm: number; heightMm: number }>;
  /** Eye height for the ground-level shots. */
  eyeHeightMm: number;
  /** Overall length to aim for. Shots are scaled to fit it. */
  targetDurationMs: number;
  style: 'cinematic' | 'walkthrough' | 'orbit' | 'reel';
}

export const WALKTHROUGH_STYLES: Array<{ key: AutoWalkthroughInput['style']; label: string; note: string; durationMs: number }> = [
  { key: 'cinematic', label: 'Cinematic', note: 'Wide establishing shot, a push in, an orbit and a hero hold. The deck opener.', durationMs: 28_000 },
  { key: 'walkthrough', label: 'Walk through', note: 'Eye level from the entrance to the stage, as a guest would arrive.', durationMs: 22_000 },
  { key: 'orbit', label: 'Orbit', note: 'One slow circle of the whole room. Shows the layout with no cuts.', durationMs: 18_000 },
  { key: 'reel', label: 'Vertical reel', note: 'Short, punchy cuts framed 9:16 for social.', durationMs: 12_000 },
];

let shotCounter = 0;
function shotId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  shotCounter += 1;
  return `shot-${Date.now().toString(36)}-${shotCounter}`;
}

/**
 * Generate a sequence from the plan.
 *
 * The camera geometry is derived from the bounds rather than fixed, so the same
 * generator produces a sensible move for a 6 m stand and a 60 m hall. Shot
 * durations are proportions of the target, which is what keeps the total
 * predictable when a style adds or drops a shot.
 */
export function generateWalkthrough(input: AutoWalkthroughInput): CameraShot[] {
  const { boundsMm, roomHeightMm, subjects, eyeHeightMm, style } = input;
  const centre: Vec3 = {
    x: (boundsMm.minX + boundsMm.maxX) / 2,
    y: 0,
    z: (boundsMm.minZ + boundsMm.maxZ) / 2,
  };
  const width = Math.max(1000, boundsMm.maxX - boundsMm.minX);
  const depth = Math.max(1000, boundsMm.maxZ - boundsMm.minZ);
  const span = Math.max(width, depth);

  const hero = subjects[0] ?? { name: 'the room', xMm: centre.x, zMm: centre.z, widthMm: width, heightMm: 3000 };
  const heroTarget: Vec3 = { x: hero.xMm, y: Math.max(1500, hero.heightMm * 0.55), z: hero.zMm };
  const eyeTarget: Vec3 = { x: hero.xMm, y: eyeHeightMm, z: hero.zMm };

  // Camera distance that frames the span at a 40° field of view, plus headroom.
  const frameDistance = (span / 2 / Math.tan((40 * Math.PI) / 360)) * 1.15;
  const total = Math.max(6000, input.targetDurationMs);

  const make = (
    name: string,
    kind: CameraShotKind,
    from: Vec3,
    to: Vec3,
    lookAt: Vec3,
    share: number,
    easing: CameraEasing = 'ease-in-out',
    extra: Partial<CameraShot> = {}
  ): CameraShot => ({
    id: shotId(),
    name,
    kind,
    fromMm: from,
    toMm: to,
    lookAtMm: lookAt,
    durationMs: Math.round(total * share),
    easing,
    fov: 45,
    ...extra,
  });

  switch (style) {
    case 'orbit':
      return [
        make(
          'Full orbit',
          'orbit',
          { x: centre.x + frameDistance, y: Math.min(roomHeightMm * 0.8, span * 0.45), z: centre.z },
          { x: centre.x + frameDistance, y: Math.min(roomHeightMm * 0.8, span * 0.45), z: centre.z },
          { x: centre.x, y: 1500, z: centre.z },
          1,
          'linear',
          { sweepDeg: 360, fov: 42 }
        ),
      ];

    case 'walkthrough': {
      // Enter at the back, walk the centre line, stop short of the subject.
      const entry: Vec3 = { x: centre.x, y: eyeHeightMm, z: boundsMm.maxZ + 3000 };
      const middle: Vec3 = { x: centre.x, y: eyeHeightMm, z: centre.z + depth * 0.15 };
      const front: Vec3 = { x: hero.xMm, y: eyeHeightMm, z: hero.zMm + Math.max(4000, hero.widthMm * 0.9) };
      return [
        make('Arrive', 'dolly', entry, middle, eyeTarget, 0.4, 'ease-out', { fov: 60 }),
        make('Approach', 'dolly', middle, front, heroTarget, 0.4, 'ease-in-out', { fov: 55 }),
        make('Hold on the stage', 'static', front, front, heroTarget, 0.2, 'linear', { fov: 50, holdMs: 400 }),
      ];
    }

    case 'reel': {
      // Short cuts, each holding briefly. Framed tight, because a vertical crop
      // throws away most of the width.
      const picks = (subjects.length ? subjects : [hero]).slice(0, 4);
      const share = 1 / picks.length;
      return picks.map((subject, i) => {
        const distance = Math.max(4000, subject.widthMm * 1.4);
        const from: Vec3 = {
          x: subject.xMm + distance * (i % 2 === 0 ? 0.6 : -0.6),
          y: Math.max(1600, subject.heightMm * 0.8),
          z: subject.zMm + distance,
        };
        const to: Vec3 = {
          x: subject.xMm + distance * (i % 2 === 0 ? 0.2 : -0.2),
          y: Math.max(1500, subject.heightMm * 0.7),
          z: subject.zMm + distance * 0.7,
        };
        return make(
          subject.name,
          'dolly',
          from,
          to,
          { x: subject.xMm, y: Math.max(1200, subject.heightMm * 0.5), z: subject.zMm },
          share,
          'ease-out',
          { fov: 38 }
        );
      });
    }

    case 'cinematic':
    default: {
      const high = Math.min(roomHeightMm * 0.85, span * 0.5);
      const wide: Vec3 = { x: centre.x - frameDistance * 0.75, y: high, z: centre.z + frameDistance * 0.75 };
      const closer: Vec3 = { x: hero.xMm - hero.widthMm * 0.4, y: high * 0.55, z: hero.zMm + Math.max(6000, hero.widthMm) };
      const orbitStart: Vec3 = { x: hero.xMm + Math.max(8000, hero.widthMm * 1.2), y: high * 0.5, z: hero.zMm };
      const heroShot: Vec3 = { x: hero.xMm, y: Math.max(1800, hero.heightMm * 0.9), z: hero.zMm + Math.max(7000, hero.widthMm * 1.1) };

      return [
        make('Establish', 'crane', wide, { ...wide, y: high * 0.7 }, { x: centre.x, y: 1500, z: centre.z }, 0.25, 'ease-out', { fov: 50 }),
        make('Push in', 'dolly', wide, closer, heroTarget, 0.3),
        make('Orbit the stage', 'orbit', orbitStart, orbitStart, heroTarget, 0.3, 'linear', { sweepDeg: 110, fov: 40 }),
        make('Hero', 'static', heroShot, heroShot, heroTarget, 0.15, 'linear', { fov: 36, holdMs: 600 }),
      ];
    }
  }
}

/* ── Export presets ────────────────────────────────────────────────────── */

export interface VideoExportPreset {
  key: string;
  label: string;
  note: string;
  width: number;
  height: number;
  fps: number;
  /** Rough bitrate target, so a preview does not produce a 400 MB file. */
  bitrateMbps: number;
}

export const VIDEO_PRESETS: VideoExportPreset[] = [
  { key: 'uhd', label: '4K landscape', note: '3840 × 2160 at 30 fps. The tender deliverable.', width: 3840, height: 2160, fps: 30, bitrateMbps: 45 },
  { key: 'hd', label: '1080p landscape', note: '1920 × 1080 at 30 fps. Fast, and fine for email.', width: 1920, height: 1080, fps: 30, bitrateMbps: 16 },
  { key: 'square', label: 'Square', note: '1080 × 1080 for a feed post.', width: 1080, height: 1080, fps: 30, bitrateMbps: 12 },
  { key: 'vertical', label: 'Vertical reel', note: '1080 × 1920 for stories and reels.', width: 1080, height: 1920, fps: 30, bitrateMbps: 14 },
  { key: 'preview', label: 'Quick preview', note: '1280 × 720 at 24 fps. Renders in seconds.', width: 1280, height: 720, fps: 24, bitrateMbps: 6 },
];

/** Still-image export sizes, including the 4K render the brief names. */
export const STILL_PRESETS: Array<{ key: string; label: string; width: number; height: number; note: string }> = [
  { key: '4k', label: '4K (3840 × 2160)', width: 3840, height: 2160, note: 'The tender standard. Prints well up to A2.' },
  { key: '2k', label: '2K (2560 × 1440)', width: 2560, height: 1440, note: 'Good for slides and email.' },
  { key: 'a3-300', label: 'A3 at 300 dpi', width: 4961, height: 3508, note: 'Print-ready board.' },
  { key: 'square-2k', label: 'Square (2048 × 2048)', width: 2048, height: 2048, note: 'Social and thumbnails.' },
  { key: 'vertical-2k', label: 'Vertical (1440 × 2560)', width: 1440, height: 2560, note: 'Phone-first presentation.' },
];

/** Ambient beds offered for an exported video. */
export const MUSIC_BEDS: Array<{ key: SceneWalkthrough['music']; label: string; note: string }> = [
  { key: 'none', label: 'No music', note: 'Silent, so the client can lay their own audio over it.' },
  { key: 'ambient', label: 'Ambient', note: 'Sparse and slow. Does not compete with a voiceover.' },
  { key: 'uplifting', label: 'Uplifting', note: 'Builds to the reveal. The default for a launch.' },
  { key: 'cinematic', label: 'Cinematic', note: 'Wide and orchestral. Suits a slow establishing move.' },
  { key: 'energetic', label: 'Energetic', note: 'Driving. Made for a fast vertical cut.' },
];
