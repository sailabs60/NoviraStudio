import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ImageIcon } from 'lucide-react';

/**
 * The parts a marketing page is made of.
 *
 * Kept small and shared so every section on the landing page moves, spaces and
 * reveals the same way. A marketing page whose sections each animate slightly
 * differently reads as assembled from templates, which is precisely the
 * impression this page exists to avoid.
 */

/* ── Scroll reveal ─────────────────────────────────────────────────────── */

/**
 * Fade and lift a block as it enters the viewport.
 *
 * Once only — an element that re-animates every time it is scrolled past is a
 * page that feels nervous. `prefers-reduced-motion` is handled by the stylesheet
 * collapsing every transition, so nothing extra is needed here.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'article';
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Anything already on screen at load should not wait for a scroll event.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -12% 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-spring ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
      } ${className ?? ''}`}
    >
      {children}
    </Tag>
  );
}

/* ── Image slots ───────────────────────────────────────────────────────── */

/**
 * A picture that has not arrived yet.
 *
 * The landing page is designed around a specific set of images, each one
 * generated to a written prompt. Until a file is dropped into
 * `public/landing/`, this renders a labelled placeholder naming the exact file
 * it is waiting for — so the page is never broken, the layout is already
 * correct at the right aspect ratio, and putting the artwork in is a matter of
 * saving a file with the right name.
 *
 * `IMAGE_PROMPTS.md` in the repository root holds the prompt for each slot.
 */
/**
 * The extensions an image slot is tried in, in order.
 *
 * `scripts/artwork.mjs` writes JPEG, which is what every slot holds today. The
 * PNG step exists because artwork arrives by being *saved into a folder*, and
 * the person doing it should not have to know that the loader was written
 * expecting one format — a file dropped in as a PNG simply works.
 */
const EXTENSIONS = ['jpg', 'png', 'webp'] as const;

export function Figure({
  slot,
  dir = 'landing',
  alt,
  ratio = '16 / 10',
  className,
  rounded = 'rounded-2xl',
  priority,
}: {
  /** File name without the extension, under `public/<dir>/`. */
  slot: string;
  /** Which public folder to look in: `landing` for the marketing page, `app`
   *  for the in-product empty states and section banners. */
  dir?: 'landing' | 'app';
  alt: string;
  ratio?: string;
  className?: string;
  rounded?: string;
  priority?: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const failed = attempt >= EXTENSIONS.length;

  return (
    <div
      className={`relative overflow-hidden border border-line bg-surface-muted ${rounded} ${className ?? ''}`}
      style={{ aspectRatio: ratio }}
    >
      {!failed ? (
        <img
          key={EXTENSIONS[attempt]}
          src={`/${dir}/${slot}.${EXTENSIONS[attempt]}`}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setAttempt((n) => n + 1)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="nv-grid-fine flex h-full w-full flex-col items-center justify-center gap-2 p-5 text-center">
          <ImageIcon className="h-5 w-5 text-ink-subtle" />
          <p className="text-[11px] font-semibold text-ink-muted">{alt}</p>
          <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-subtle">
            public/{dir}/{slot}.jpg
          </code>
        </div>
      )}
    </div>
  );
}

/* ── Section furniture ─────────────────────────────────────────────────── */

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">{children}</p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = 'left',
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: 'left' | 'center';
  className?: string;
}) {
  return (
    <div className={`${align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'} ${className ?? ''}`}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="mt-2 text-balance text-3xl font-black leading-[1.1] tracking-tight text-ink sm:text-4xl">
        {title}
      </h2>
      {lead ? <p className="mt-3 text-pretty text-base leading-relaxed text-ink-muted">{lead}</p> : null}
    </div>
  );
}

/* ── The endless strip of source names ─────────────────────────────────── */

/**
 * A marquee of the libraries being searched.
 *
 * Duplicated once and translated by exactly half its width, which is what makes
 * the loop seamless — the common mistake is animating to 100 %, which produces
 * a visible jump every cycle.
 */
export function Marquee({ items }: { items: string[] }) {
  const doubled = [...items, ...items];
  return (
    <div className="nv-edge-fade-x relative overflow-hidden py-1">
      <ul className="flex w-max animate-[nv-marquee_36s_linear_infinite] items-center gap-8">
        {doubled.map((item, index) => (
          <li
            key={`${item}-${index}`}
            className="shrink-0 whitespace-nowrap text-sm font-semibold text-ink-subtle"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Numbers ───────────────────────────────────────────────────────────── */

export function StatRow({ items }: { items: Array<{ value: string; label: string }> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
      {items.map((item, index) => (
        <Reveal key={item.label} delay={index * 70}>
          <div>
            <dt className="text-2xl font-black tabular-nums tracking-tight text-ink sm:text-3xl">{item.value}</dt>
            <dd className="mt-1 text-xs leading-snug text-ink-subtle">{item.label}</dd>
          </div>
        </Reveal>
      ))}
    </dl>
  );
}

/* ── A card that tilts towards the cursor ──────────────────────────────── */

/**
 * A card with a little parallax.
 *
 * Three degrees at the corners — enough that the page feels responsive to the
 * cursor, far short of the exaggerated tilt that makes a site feel like a demo.
 * The transform is written straight to the node rather than through state,
 * because a `setState` per pointer move would re-render the section sixty times
 * a second for a purely visual effect.
 */
export function TiltCard({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    node.style.transform = `perspective(900px) rotateX(${(-y * 3).toFixed(2)}deg) rotateY(${(x * 3).toFixed(2)}deg) translateY(-2px)`;
  };

  const reset = () => {
    const node = ref.current;
    if (node) node.style.transform = '';
  };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      className={`transition-transform duration-300 ease-spring will-change-transform ${className ?? ''}`}
    >
      {children}
    </div>
  );
}
