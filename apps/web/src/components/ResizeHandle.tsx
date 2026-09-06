import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag-to-resize for the editor's panels.
 *
 * A plan is not one shape of work. Laying out a room wants the viewport as
 * large as it will go; picking furniture wants the library wide enough to see
 * what a chair looks like; checking a specification wants the properties dock
 * wide enough that nothing wraps. A fixed 368 px serves the middle of that
 * range and none of the ends, which is why every tool of this kind lets the
 * edges move.
 *
 * The size is remembered per panel, because a working width is a preference
 * rather than a per-session accident — coming back to a layout you set up is
 * most of the value.
 *
 * Implementation notes worth keeping:
 *
 *  · **Pointer capture, not a window listener.** The pointer keeps reporting
 *    to this element even when it moves over the WebGL canvas, which otherwise
 *    swallows the events and leaves the handle stuck mid-drag.
 *  · **`user-select: none` on the body for the duration.** Without it a drag
 *    across the panel selects its text, which looks broken.
 *  · **Keyboard too.** A splitter that only responds to a precise drag is not
 *    usable by everyone; arrows move it, and the browser's own focus ring is
 *    left visible on purpose.
 */

export interface ResizeHandleProps {
  /** Which edge of the panel this handle sits on. */
  side: 'left' | 'right' | 'top';
  size: number;
  onResize: (size: number) => void;
  min: number;
  max: number;
  /** Announced to screen readers, e.g. "Library width". */
  label: string;
  /** Double-clicking the handle returns the panel to this width. */
  onReset?: () => void;
}

export function ResizeHandle({ side, size, onResize, min, max, label, onReset }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ pointer: 0, size: 0 });

  const clamp = useCallback((value: number) => Math.round(Math.min(max, Math.max(min, value))), [min, max]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      start.current = { pointer: side === 'top' ? e.clientY : e.clientX, size };
      setDragging(true);
    },
    [side, size]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const current = side === 'top' ? e.clientY : e.clientX;
      const delta = current - start.current.pointer;
      /*
       * Which way the drag grows the panel depends on which edge the handle is
       * on. A handle on the panel's right edge grows it as the pointer moves
       * right; one on its left edge grows it as the pointer moves left; one on
       * a bottom bar's top edge grows it as the pointer moves up.
       */
      const signed = side === 'right' ? delta : -delta;
      onResize(clamp(start.current.size + signed));
    },
    [dragging, side, onResize, clamp]
  );

  const stop = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }, []);

  // Keep the page from selecting text while a drag is in progress.
  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = side === 'top' ? 'row-resize' : 'col-resize';
    return () => {
      document.body.style.userSelect = previous;
      document.body.style.cursor = '';
    };
  }, [dragging, side]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 48 : 16;
      const grow = side === 'top' ? 'ArrowUp' : side === 'right' ? 'ArrowRight' : 'ArrowLeft';
      const shrink = side === 'top' ? 'ArrowDown' : side === 'right' ? 'ArrowLeft' : 'ArrowRight';
      if (e.key === grow) {
        e.preventDefault();
        onResize(clamp(size + step));
      } else if (e.key === shrink) {
        e.preventDefault();
        onResize(clamp(size - step));
      }
    },
    [side, size, onResize, clamp]
  );

  const vertical = side !== 'top';

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={size}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onReset?.()}
      title={`Drag to resize · double-click to reset · arrows to nudge`}
      className={[
        'group relative z-20 shrink-0 touch-none',
        // A 5px target that reads as a 1px line: wide enough to hit reliably,
        // thin enough not to look like a gutter.
        vertical ? 'w-[5px] cursor-col-resize self-stretch' : 'h-[5px] cursor-row-resize w-full',
        'outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
      ].join(' ')}
    >
      {/* The visible line, brightening on hover and while dragging. */}
      <span
        aria-hidden
        className={[
          'absolute bg-line transition-colors',
          vertical ? 'inset-y-0 left-1/2 w-px -translate-x-1/2' : 'inset-x-0 top-1/2 h-px -translate-y-1/2',
          dragging ? '!bg-primary' : 'group-hover:bg-primary/60',
        ].join(' ')}
      />
    </div>
  );
}

/**
 * A panel size that survives a reload.
 *
 * `localStorage` can throw outright in a private window or with site data
 * blocked, so every access is guarded and a failure simply means the default
 * width — a panel that cannot remember its size is a small loss; a crash on
 * boot is not.
 */
export function useStoredSize(key: string, fallback: number) {
  const [size, setSize] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(`novira.layout.${key}`);
      const value = raw ? Number(raw) : NaN;
      return Number.isFinite(value) && value > 0 ? value : fallback;
    } catch {
      return fallback;
    }
  });

  const store = useCallback(
    (next: number) => {
      setSize(next);
      try {
        window.localStorage.setItem(`novira.layout.${key}`, String(next));
      } catch {
        /* private window, or site data blocked */
      }
    },
    [key]
  );

  const reset = useCallback(() => store(fallback), [store, fallback]);

  return [size, store, reset] as const;
}
