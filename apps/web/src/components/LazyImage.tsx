import { useEffect, useRef, useState } from 'react';

/**
 * A thumbnail that is not requested until it is nearly on screen.
 *
 * The native `loading="lazy"` is close, but it does not cover the case that
 * actually hurts here: a grid of thousands of rows where the browser has
 * already committed to fetches for rows the user has scrolled past. An
 * observer we own can be disconnected the instant a row leaves, and the
 * `rootMargin` is ours to tune — 400 px ahead, so an image is decoded by the
 * time it arrives rather than fading in after it.
 *
 * Once loaded, always loaded. Dropping back to a placeholder because a row
 * briefly left the viewport looks like a fault, and the memory it saves is not
 * worth the flicker.
 */
export function LazyImage({
  src,
  alt,
  className,
  wrapperClassName,
  ratio,
  fallback,
  eager = false,
  rounded,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  wrapperClassName?: string;
  /** CSS aspect ratio for the reserved box, e.g. `'4 / 3'`. */
  ratio?: string;
  /** Shown while off-screen, while loading, and if the image fails. */
  fallback?: React.ReactNode;
  /** Skip the observer for the handful of images above the fold. */
  eager?: boolean;
  /** Corner rounding on the wrapper. Pass `''` to inherit the parent's. */
  rounded?: string;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(eager);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (near || !holder.current) return;
    const node = holder.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);

  // A new source is a new image: reset, or the old one lingers under it.
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  const showImage = near && src && !failed;

  return (
    <div
      ref={holder}
      className={`relative overflow-hidden bg-surface-muted ${rounded ?? ''} ${wrapperClassName ?? ''}`}
      style={ratio ? { aspectRatio: ratio } : undefined}
    >
      {/*
        The placeholder sits under the image rather than instead of it, so the
        swap is a fade with no reflow — the box was always the right size.
      */}
      {!loaded ? (
        <div className={`absolute inset-0 flex items-center justify-center ${failed ? '' : 'nv-shimmer'}`}>
          {fallback ?? null}
        </div>
      ) : null}

      {showImage ? (
        <img
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`relative h-full w-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          } ${className ?? ''}`}
        />
      ) : null}
    </div>
  );
}
