/**
 * High-resolution capture.
 *
 * The viewport canvas is whatever size the panel gives it — often 900 px wide.
 * A 4K deliverable cannot come from upscaling that, so the renderer is
 * temporarily resized, drawn once, read, and put back.
 *
 * Three things make this work rather than produce a broken frame:
 *
 * 1. **The camera's aspect ratio is changed with the size.** Skipping it
 *    produces a correctly-sized image of a stretched room, which is the classic
 *    high-resolution export bug.
 * 2. **The size is restored in a `finally`.** A throw part-way through would
 *    otherwise leave the viewport at 3840 px and the tab unusable.
 * 3. **The request is clamped to what the GPU will actually allocate.** Asking
 *    for a buffer larger than `MAX_RENDERBUFFER_SIZE` fails silently on some
 *    drivers and returns a blank image on others, so it is capped and the
 *    caller is told what it really got.
 */
import * as THREE from 'three';

export interface RenderHook {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
}

let hook: RenderHook | null = null;

/** Registered by the Viewport once react-three-fiber has a renderer. */
export function registerRenderer(next: RenderHook | null) {
  hook = next;
}

export function rendererAvailable(): boolean {
  return hook !== null;
}

export interface CaptureResult {
  dataUrl: string;
  width: number;
  height: number;
  /** True when the requested size was reduced to fit the hardware. */
  clamped: boolean;
}

/** The largest square the current context will render into. */
export function maxRenderSize(): number {
  if (!hook) return 2048;
  try {
    const gl = hook.gl.getContext();
    const max = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
    // Leave headroom: allocating exactly the maximum tends to fail on the
    // integrated GPUs this is most likely to be run on.
    return Math.max(1024, Math.min(8192, Math.floor(max * 0.9)));
  } catch {
    return 2048;
  }
}

/**
 * Render one frame at a given size and return it as a PNG data URL.
 *
 * Synchronous by design: it must complete before anything else touches the
 * renderer, and a `requestAnimationFrame` dance between the resize and the read
 * is what lets react-three-fiber draw a normal frame in between and undo it.
 */
export function captureAtSize(width: number, height: number, mimeType = 'image/png', quality = 0.92): CaptureResult | null {
  if (!hook) return null;

  const { gl, scene, camera } = hook;
  const previousSize = gl.getSize(new THREE.Vector2());
  const previousPixelRatio = gl.getPixelRatio();
  const perspective = camera as THREE.PerspectiveCamera;
  const previousAspect = perspective.isPerspectiveCamera ? perspective.aspect : null;

  const limit = maxRenderSize();
  const scale = Math.min(1, limit / Math.max(width, height));
  const targetWidth = Math.max(2, Math.round(width * scale));
  const targetHeight = Math.max(2, Math.round(height * scale));

  try {
    // Pixel ratio 1: the size asked for is the size wanted, and a device ratio
    // of 2 would quietly double it past the hardware limit.
    gl.setPixelRatio(1);
    gl.setSize(targetWidth, targetHeight, false);

    if (perspective.isPerspectiveCamera) {
      perspective.aspect = targetWidth / targetHeight;
      perspective.updateProjectionMatrix();
    }

    gl.render(scene, camera);
    const dataUrl = gl.domElement.toDataURL(mimeType, quality);

    return { dataUrl, width: targetWidth, height: targetHeight, clamped: scale < 1 };
  } catch {
    return null;
  } finally {
    // Always restore, even on a throw — otherwise the viewport is left at the
    // export size and the tab is unusable.
    gl.setPixelRatio(previousPixelRatio);
    gl.setSize(previousSize.x, previousSize.y, false);
    if (perspective.isPerspectiveCamera && previousAspect !== null) {
      perspective.aspect = previousAspect;
      perspective.updateProjectionMatrix();
    }
    gl.render(scene, camera);
  }
}

/** Save a data URL to a file, which is how every export here reaches the user. */
export function saveDataUrl(dataUrl: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
