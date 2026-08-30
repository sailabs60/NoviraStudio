/**
 * Viewport capture.
 *
 * WebGL clears its drawing buffer after each frame unless the context was
 * created with `preserveDrawingBuffer`, in which case a plain read of the
 * canvas returns the last frame drawn. The editor's canvas sets that flag, so
 * the correct thing to do is simply read it.
 *
 * Forcing a render first — which this used to do unconditionally — turned out
 * to be extraordinarily expensive. A synchronous `gl.render()` from inside a
 * click handler, immediately followed by a read of the same canvas, makes the
 * browser flush the whole pipeline and wait: measured at **6.2 seconds** on a
 * plan containing the Almasi Ballroom, against **4 ms** for the same read
 * without it. Pressing Save view locked the tab for twelve seconds, because
 * the autosave preview paid the cost a second time.
 *
 * So the render only happens when the buffer genuinely is not preserved. When
 * it is, what gets captured is exactly the frame the designer was looking at
 * when they pressed the button, which is also the more correct answer.
 */

export interface CaptureHook {
  render: () => void;
  canvas: HTMLCanvasElement;
  /** True when the context keeps its last frame readable. */
  preserved: boolean;
}

let hook: CaptureHook | null = null;

/** Registered by the Viewport once react-three-fiber has a renderer. */
export function registerCapture(next: CaptureHook | null) {
  hook = next;
}

/** A PNG data URL of the current view, or null if the canvas is not ready. */
export function captureViewport(): string | null {
  if (!hook) {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    try {
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  }
  try {
    // Only when the buffer would otherwise be blank — see the note above.
    if (!hook.preserved) hook.render();
    return hook.canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * A small JPEG of the current view.
 *
 * One fresh frame and one scaled draw — deliberately never a full-size
 * `toDataURL`. Encoding a 1600 × 950 PNG is the expensive half of a capture,
 * and doing it to produce a 320 px thumbnail was costing tens of seconds on a
 * software renderer with a building in the scene: pressing Save view locked
 * the tab. Nothing here needs the full-size image, so nothing here makes one.
 *
 * Returns null rather than throwing — a missing thumbnail is cosmetic.
 */
export function captureThumbnail(maxWidth = 640, quality = 0.82): string | null {
  const source = hook?.canvas ?? document.querySelector('canvas');
  if (!source || !source.width || !source.height) return null;
  try {
    // Only when the buffer would otherwise be blank — see the note above.
    if (hook && !hook.preserved) hook.render();
    const scale = Math.min(1, maxWidth / source.width);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(source.width * scale));
    out.height = Math.max(1, Math.round(source.height * scale));
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    // Straight from the source canvas rather than round-tripping through an
    // Image: a freshly-assigned data URL is not decoded yet, so an
    // `image.complete` path always failed and fell back to the full-size PNG.
    ctx.drawImage(source, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}

/**
 * A smaller JPEG of the current view, for the dashboard thumbnail.
 * Returns null rather than throwing — a missing preview is cosmetic.
 */
export function capturePreview(maxWidth = 640): string | null {
  return captureThumbnail(maxWidth, 0.82) ?? captureViewport();
}
