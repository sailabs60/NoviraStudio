import { useState, type ReactNode } from 'react';

/**
 * The header of a browse-and-discover page.
 *
 * Used only on the four surfaces where someone arrives to *look around* rather
 * than to do a specific job — the marketplace, the specialists directory, the
 * venue library and the help centre. Everywhere else keeps a plain heading,
 * because a banner over a working screen is decoration in the way of the work.
 *
 * The photograph is optional and always has been. When the file is absent the
 * banner falls back to a brand-tinted field with the same geometry, which is a
 * deliberate design rather than a placeholder: the page has to look finished
 * whether or not anyone has generated artwork for it. See `IMAGE_PROMPTS.md`
 * for the prompt and the filename for each slot.
 */
const EXTENSIONS = ['jpg', 'png', 'webp'] as const;

export function PageBanner({
  slot,
  title,
  lead,
  actions,
}: {
  /** File name (without extension) under `public/app/`, or null for no photo. */
  slot: string | null;
  title: string;
  lead: ReactNode;
  actions?: ReactNode;
}) {
  /*
   * Tried in order, so a slot filled with a PNG works as well as one filled
   * with the JPEG that `scripts/artwork.mjs` writes. Artwork arrives by being
   * saved into a folder; the person doing that should not have to know which
   * format the loader was written for.
   */
  const [attempt, setAttempt] = useState(0);
  const hasImage = Boolean(slot) && attempt < EXTENSIONS.length;

  return (
    <header className="relative mb-6 overflow-hidden rounded-2xl border border-line bg-surface">
      {/* The photograph, held well back so text over it stays readable. */}
      {slot && hasImage ? (
        <>
          <img
            key={EXTENSIONS[attempt]}
            src={`/app/${slot}.${EXTENSIONS[attempt]}`}
            alt=""
            aria-hidden
            onError={() => setAttempt((n) => n + 1)}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span
            aria-hidden
            className="absolute inset-0 bg-gradient-to-r from-surface via-surface/92 to-surface/55"
          />
        </>
      ) : (
        <>
          <span aria-hidden className="nv-grid-fine absolute inset-0 opacity-60" />
          <span
            aria-hidden
            className="nv-drift absolute -right-24 -top-28 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
          />
        </>
      )}

      <div className="relative flex flex-wrap items-end justify-between gap-4 px-5 py-6 sm:px-7 sm:py-8">
        <div className="min-w-0">
          <h1 className="text-2xl font-black tracking-tight text-ink">{title}</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">{lead}</p>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
