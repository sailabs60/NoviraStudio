import { useEffect, useRef } from 'react';
import { invalidate, useFrame, useThree } from '@react-three/fiber';
import { useEditor } from './editorStore';

/**
 * Keeping the viewport responsive when the frame gets expensive.
 *
 * ## The failure this exists to prevent
 *
 * The viewport renders on demand, and any pointer activity opens a window
 * during which frames are requested continuously (see `FrameKeepAlive`). That
 * is exactly right when a frame costs 8 ms. It is a trap when a frame costs
 * 400 ms, which is what a large event in a real venue costs on a laptop with
 * integrated graphics: the pointer moves, a thousand milliseconds of frames are
 * requested, each takes most of a second, the queue never drains, and the
 * browser's main thread is saturated for as long as the user keeps moving the
 * mouse. Clicks stop landing. The editor does not report an error; it simply
 * stops answering, which is the worst failure a tool can have because it looks
 * like the user's fault.
 *
 * Measured on a 504-object banquet: **0.46 frames per second**, on a scene of
 * 26,754 triangles. Geometry was never the problem. Draw calls were, and so was
 * asking for more frames than the machine could ever deliver.
 *
 * ## What it does
 *
 * It measures how long frames are actually taking and publishes that, so the
 * expensive parts of the scene can stand down while the view is moving:
 *
 *  · **Shadows** are the first thing dropped. A shadow-casting light redraws
 *    the entire scene into a depth map — it roughly doubles the frame — and a
 *    shadow that is only missing *while the camera is turning* is a shadow
 *    nobody sees go.
 *  · **The pixel ratio** drops next. Rendering at three-quarters of the device
 *    resolution during a gesture is close to invisible in motion and costs
 *    forty per cent fewer fragments.
 *
 * Both come back the moment the view settles, so a still frame — which is what
 * anyone judges the picture by, and what every screenshot and export captures
 * — is always at full quality. This is the trade every real-time renderer
 * makes, and it is what "navigation feels smooth" actually means on hardware
 * that cannot draw the full scene sixty times a second.
 *
 * ## Why the measurement is smoothed
 *
 * A single slow frame is normal — a model finished loading, a texture was
 * uploaded, the garbage collector ran. Reacting to one would make the quality
 * flicker, which is far more noticeable than the thing it was trying to fix. So
 * the estimate is an exponential average, and the two thresholds are separated
 * by a wide margin so it cannot oscillate across the boundary.
 */

/** Above this average frame time, the scene is too expensive to draw in full. */
const HEAVY_MS = 34;
/** And below this, it is comfortably affordable again. Hysteresis, not a line. */
const LIGHT_MS = 22;
/** How long after the last input the view counts as settled. */
const SETTLE_MS = 260;

export function useFrameBudget() {
  const gl = useThree((s) => s.gl);
  const setFrameBudget = useEditor((s) => s.setFrameBudget);

  const average = useRef(16);
  const lastFrame = useRef(0);
  const heavy = useRef(false);
  /** When the pointer last did anything. */
  const lastInput = useRef(0);
  const moving = useRef(false);

  useEffect(() => {
    const dom = gl.domElement;
    const touch = () => {
      lastInput.current = performance.now();
      if (!moving.current) {
        moving.current = true;
        setFrameBudget({ moving: true, heavy: heavy.current });
      }
    };
    for (const type of ['pointermove', 'pointerdown', 'wheel'] as const) {
      dom.addEventListener(type, touch, { passive: true });
    }
    return () => {
      for (const type of ['pointermove', 'pointerdown', 'wheel'] as const) {
        dom.removeEventListener(type, touch);
      }
    };
  }, [gl, setFrameBudget]);

  useFrame(() => {
    const now = performance.now();

    /*
     * Frame time, measured between consecutive frames.
     *
     * Only counted when frames are actually consecutive. On demand rendering
     * means the gap between two frames is usually the gap between two *user
     * actions*, which says nothing about how expensive the scene is — so a gap
     * longer than a quarter second is treated as the renderer having been idle
     * rather than as a catastrophically slow frame.
     */
    if (lastFrame.current) {
      const delta = now - lastFrame.current;
      if (delta < 250) {
        // Exponential average: responsive enough to catch a scene getting
        // heavier, damped enough that one slow frame changes nothing.
        average.current = average.current * 0.85 + delta * 0.15;
      }
    }
    lastFrame.current = now;

    const wasHeavy = heavy.current;
    if (!wasHeavy && average.current > HEAVY_MS) heavy.current = true;
    else if (wasHeavy && average.current < LIGHT_MS) heavy.current = false;

    const stillMoving = now - lastInput.current < SETTLE_MS;
    if (stillMoving !== moving.current || heavy.current !== wasHeavy) {
      moving.current = stillMoving;
      setFrameBudget({ moving: stillMoving, heavy: heavy.current });
      /*
       * Settling is itself a reason to draw one more frame: it is the frame
       * that puts the shadows and the full resolution back, and without asking
       * for it the view would stay in its reduced state until something else
       * happened to request a repaint.
       */
      if (!stillMoving) invalidate();
    }
  });
}
