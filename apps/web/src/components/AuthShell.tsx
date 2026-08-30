import type { ReactNode } from 'react';
import { LogoMark } from './Logo';

/**
 * Shared frame for the signed-out pages.
 *
 * A photograph of a real room, and the form beside it. Signing in is the one
 * moment before anyone has seen the product, so the page has a job beyond
 * collecting a password: it has to say what this tool is *for*. A picture of a
 * conference hall rigged and lit says it in less time than any headline.
 *
 * The split appears only on wide screens. Below `lg` the picture is dropped
 * entirely — not scaled down, not stacked above the form — because on a phone
 * it would push the fields under the fold to decorate a page someone is trying
 * to get past. What remains there is exactly the centred card that was here
 * before.
 *
 * The blueprint field and its corner glows stay: they are what the panel sits
 * on, and they are what the page falls back to if the photograph is missing.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  wide = false,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="nv-grid-bg relative flex min-h-full items-center justify-center overflow-hidden bg-bg px-4 py-12">
      {/* Soft corner glows so the grid does not read as a spreadsheet. */}
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />

      <div
        className={`relative grid w-full items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-14 ${
          wide ? 'max-w-5xl' : 'max-w-4xl'
        }`}
      >
        {/* ── The room ─────────────────────────────────────────────────── */}
        <figure className="relative hidden overflow-hidden rounded-3xl border border-line shadow-panel lg:block">
          <img
            src="/app/auth-panel.jpg"
            alt="A conference hall rigged with truss and lit for a keynote, chairs set in rows"
            className="h-full max-h-[34rem] w-full object-cover"
            loading="eager"
            decoding="async"
          />
          {/*
            A wash from the bottom so the caption is legible against whatever
            the photograph happens to be doing down there, rather than a flat
            scrim over the whole picture.
          */}
          <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/85 via-ink/45 to-transparent px-6 pb-6 pt-16">
            <p className="text-sm font-semibold text-white">
              Every plan measured in millimetres, checked against the room, and priced before it is sent.
            </p>
          </figcaption>
        </figure>

        {/* ── The form ─────────────────────────────────────────────────── */}
        <div className={`mx-auto w-full ${wide ? 'max-w-xl' : 'max-w-md'}`}>
          <div className="mb-8 text-center lg:text-left">
            <LogoMark size={44} className="mx-auto mb-4 lg:mx-0" />
            <h1 className="text-3xl font-bold tracking-tight text-ink">{title}</h1>
            <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>
          </div>
          <div className="panel p-6 sm:p-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Plan-view mark: a round table with four covers.
 *
 * Not the brand mark — that is `LogoMark`. This is a small drawn glyph used
 * where a piece of the product needs to *look like a plan* rather than be
 * branded: the empty state of a shared link, for instance.
 */
export function NoviraMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="7" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="16" cy="4.5" r="2.2" fill="currentColor" />
      <circle cx="16" cy="27.5" r="2.2" fill="currentColor" />
      <circle cx="4.5" cy="16" r="2.2" fill="currentColor" />
      <circle cx="27.5" cy="16" r="2.2" fill="currentColor" />
    </svg>
  );
}
