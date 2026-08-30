import { useMemo } from 'react';
import type { TrussSystemSpec } from '@novira/shared';

/**
 * Small drawings of what you are about to add.
 *
 * A list of names — "F34 square", "H30V", "Clearspan 15 × 30" — asks the reader
 * to already know the difference. Anyone who does not is choosing at random,
 * and anyone who does still has to read six labels to find the triangle.
 *
 * These are drawn rather than photographed, from the same specification the
 * geometry is built from. That matters more than it sounds: a photograph would
 * be a stock picture of *a* truss, whereas this is a section through the exact
 * one — the right number of chords, at the published proportions, with the
 * brace pattern that system actually has. It cannot drift out of date with the
 * catalogue, it costs nothing to download, and it stays crisp at any size.
 *
 * Everything uses `currentColor` and the theme tokens, so a thumbnail sits in
 * a light row, a dark row or a selected row without a second asset.
 */

const STROKE = 'stroke-ink-muted';
const FILL_FAINT = 'fill-ink-subtle/15';

/* ── Truss ─────────────────────────────────────────────────────────────── */

/**
 * A truss system, drawn as a rigger would sketch it: the cross-section beside a
 * short length of elevation.
 *
 * The section is what tells a ladder from a triangle from a box at a glance,
 * and the elevation carries the two things that separate two box sections of
 * the same size — the panel pitch, and whether the web has uprights in it.
 */
export function TrussThumb({ system, className }: { system: TrussSystemSpec; className?: string }) {
  const chords = useMemo(() => {
    // Normalised into a 22-unit box, keeping the real aspect of the section.
    const aspect = system.heightMm / system.widthMm;
    const halfW = 9;
    const halfH = 9 * Math.min(1.6, Math.max(0.25, aspect));
    if (system.chords === 2) {
      return [
        { x: -halfW, y: 0 },
        { x: halfW, y: 0 },
      ];
    }
    if (system.chords === 3) {
      return [
        { x: -halfW, y: halfH },
        { x: halfW, y: halfH },
        { x: 0, y: -halfH },
      ];
    }
    return [
      { x: -halfW, y: halfH },
      { x: halfW, y: halfH },
      { x: halfW, y: -halfH },
      { x: -halfW, y: -halfH },
    ];
  }, [system]);

  const pairs = useMemo(() => {
    if (chords.length <= 2) return [[0, 1] as const];
    return chords.map((_, i) => [i, (i + 1) % chords.length] as const);
  }, [chords]);

  // The elevation: panels at the system's real pitch over a 42-unit length.
  const panels = Math.max(2, Math.min(6, Math.round(3000 / system.panelLengthMm)));
  const step = 42 / panels;
  const chordGap = 13;

  return (
    <svg viewBox="0 0 72 26" className={className} aria-hidden role="presentation">
      {/* Section, on the left. */}
      <g transform="translate(13 13)">
        {pairs.map(([a, b], i) => (
          <line
            key={`web-${i}`}
            x1={chords[a]!.x}
            y1={chords[a]!.y}
            x2={chords[b]!.x}
            y2={chords[b]!.y}
            className={STROKE}
            strokeWidth={0.9}
            strokeOpacity={0.5}
          />
        ))}
        {chords.map((c, i) => (
          <circle
            key={`chord-${i}`}
            cx={c.x}
            cy={c.y}
            r={2.4}
            className={`${STROKE} ${FILL_FAINT}`}
            strokeWidth={1.2}
          />
        ))}
      </g>

      {/* Elevation, on the right. */}
      <g transform="translate(27 13)">
        <line x1={0} y1={-chordGap / 2} x2={42} y2={-chordGap / 2} className={STROKE} strokeWidth={1.6} />
        <line x1={0} y1={chordGap / 2} x2={42} y2={chordGap / 2} className={STROKE} strokeWidth={1.6} />

        {system.bracePattern !== 'ladder'
          ? Array.from({ length: panels }).map((_, p) => (
              <line
                key={`d-${p}`}
                x1={p * step}
                y1={p % 2 === 0 ? chordGap / 2 : -chordGap / 2}
                x2={(p + 1) * step}
                y2={p % 2 === 0 ? -chordGap / 2 : chordGap / 2}
                className={STROKE}
                strokeWidth={0.9}
              />
            ))
          : null}

        {system.bracePattern !== 'warren'
          ? Array.from({ length: panels + 1 }).map((_, p) => (
              <line
                key={`v-${p}`}
                x1={p * step}
                y1={-chordGap / 2}
                x2={p * step}
                y2={chordGap / 2}
                className={STROKE}
                strokeWidth={0.9}
              />
            ))
          : null}
      </g>
    </svg>
  );
}

/* ── Tent ──────────────────────────────────────────────────────────────── */

/**
 * A tent, drawn as its end elevation.
 *
 * The gable profile at the real span-to-eave ratio, and — the point of the
 * drawing — a leg at each side and nothing between them. A 20 m clearspan and
 * a 6 m frame tent are visibly different objects here, which is exactly the
 * decision the list is asking someone to make.
 */
export function TentThumb({
  widthMm,
  eaveHeightMm,
  peakHeightMm,
  className,
}: {
  widthMm: number;
  eaveHeightMm: number;
  peakHeightMm: number;
  className?: string;
}) {
  const totalMm = peakHeightMm;
  const scale = Math.min(60 / widthMm, 22 / totalMm);
  const halfW = (widthMm * scale) / 2;
  const eave = eaveHeightMm * scale;
  const peak = peakHeightMm * scale;
  const base = 25;

  return (
    <svg viewBox="0 0 72 26" className={className} aria-hidden role="presentation">
      <g transform={`translate(36 0)`}>
        {/* Ground. */}
        <line x1={-34} y1={base} x2={34} y2={base} className={STROKE} strokeWidth={0.8} strokeOpacity={0.4} />
        {/* Canopy. */}
        <path
          d={`M ${-halfW - 2} ${base - eave} L 0 ${base - peak} L ${halfW + 2} ${base - eave} Z`}
          className={`${STROKE} ${FILL_FAINT}`}
          strokeWidth={1.3}
          strokeLinejoin="round"
        />
        {/* The two legs, and only the two. */}
        <line x1={-halfW} y1={base - eave} x2={-halfW} y2={base} className={STROKE} strokeWidth={1.6} />
        <line x1={halfW} y1={base - eave} x2={halfW} y2={base} className={STROKE} strokeWidth={1.6} />
        {/* Knee braces, which is what tells this apart from a garden gazebo. */}
        <line
          x1={-halfW}
          y1={base - eave * 0.6}
          x2={-halfW * 0.66}
          y2={base - eave - (peak - eave) * 0.34}
          className={STROKE}
          strokeWidth={0.8}
        />
        <line
          x1={halfW}
          y1={base - eave * 0.6}
          x2={halfW * 0.66}
          y2={base - eave - (peak - eave) * 0.34}
          className={STROKE}
          strokeWidth={0.8}
        />
      </g>
    </svg>
  );
}

/* ── Stage ─────────────────────────────────────────────────────────────── */

/** A decked stage: the module grid in plan, with the riser height beside it. */
export function StageThumb({
  columns,
  rows,
  className,
}: {
  columns: number;
  rows: number;
  className?: string;
}) {
  const cols = Math.max(1, Math.min(8, columns));
  const rws = Math.max(1, Math.min(6, rows));
  const cell = Math.min(56 / cols, 20 / rws);
  const w = cell * cols;
  const h = cell * rws;

  return (
    <svg viewBox="0 0 72 26" className={className} aria-hidden role="presentation">
      <g transform={`translate(${36 - w / 2} ${13 - h / 2})`}>
        <rect x={0} y={0} width={w} height={h} rx={1} className={`${STROKE} ${FILL_FAINT}`} strokeWidth={1.2} />
        {Array.from({ length: cols - 1 }).map((_, i) => (
          <line
            key={`c-${i}`}
            x1={cell * (i + 1)}
            y1={0}
            x2={cell * (i + 1)}
            y2={h}
            className={STROKE}
            strokeWidth={0.7}
            strokeOpacity={0.6}
          />
        ))}
        {Array.from({ length: rws - 1 }).map((_, i) => (
          <line
            key={`r-${i}`}
            x1={0}
            y1={cell * (i + 1)}
            x2={w}
            y2={cell * (i + 1)}
            className={STROKE}
            strokeWidth={0.7}
            strokeOpacity={0.6}
          />
        ))}
      </g>
    </svg>
  );
}

/* ── LED ───────────────────────────────────────────────────────────────── */

/** An LED wall: the cabinet grid, at the aspect the count actually makes. */
export function LedThumb({
  columns,
  rows,
  curveDeg = 0,
  className,
}: {
  columns: number;
  rows: number;
  curveDeg?: number;
  className?: string;
}) {
  const cols = Math.max(1, Math.min(14, columns));
  const rws = Math.max(1, Math.min(10, rows));
  const cell = Math.min(58 / cols, 20 / rws);
  const w = cell * cols;
  const h = cell * rws;
  const bend = Math.max(-6, Math.min(6, (curveDeg / 60) * 6));

  return (
    <svg viewBox="0 0 72 26" className={className} aria-hidden role="presentation">
      <g transform={`translate(${36 - w / 2} ${13 - h / 2})`}>
        {Array.from({ length: cols }).flatMap((_, c) =>
          Array.from({ length: rws }).map((__, r) => {
            // A curved wall is faceted, so the columns step forward at the ends
            // rather than following a smooth arc — same as the geometry.
            const t = cols > 1 ? c / (cols - 1) - 0.5 : 0;
            const lift = bend * (1 - Math.cos(t * Math.PI)) * 0.5;
            return (
              <rect
                key={`${c}-${r}`}
                x={c * cell + 0.4}
                y={r * cell + 0.4 + lift}
                width={cell - 0.8}
                height={cell - 0.8}
                rx={0.4}
                className={`${STROKE} ${FILL_FAINT}`}
                strokeWidth={0.5}
              />
            );
          })
        )}
      </g>
    </svg>
  );
}

/* ── Sidewalls ─────────────────────────────────────────────────────────── */

/** A tent sidewall type, drawn as the panel a supplier would show you. */
export function SidewallThumb({ kind, className }: { kind: string; className?: string }) {
  const panel = (
    <rect x={18} y={3} width={36} height={20} rx={1} className={`${STROKE} ${FILL_FAINT}`} strokeWidth={1.1} />
  );

  return (
    <svg viewBox="0 0 72 26" className={className} aria-hidden role="presentation">
      {panel}
      {kind === 'cathedral' ? (
        <path d="M 27 21 L 27 12 A 9 9 0 0 1 45 12 L 45 21 Z" className={STROKE} strokeWidth={1} fill="none" />
      ) : null}
      {kind === 'arch-window' ? (
        <path d="M 28 21 L 28 13 A 8 8 0 0 1 44 13 L 44 21" className={STROKE} strokeWidth={1} fill="none" />
      ) : null}
      {kind === 'panoramic' || kind === 'tinted-window' ? (
        <rect
          x={22}
          y={6}
          width={28}
          height={14}
          rx={0.6}
          className={STROKE}
          strokeWidth={1}
          fill={kind === 'tinted-window' ? 'currentColor' : 'none'}
          fillOpacity={kind === 'tinted-window' ? 0.18 : 0}
        />
      ) : null}
      {kind === 'structured' ? (
        <>
          <line x1={30} y1={3} x2={30} y2={23} className={STROKE} strokeWidth={0.8} />
          <line x1={42} y1={3} x2={42} y2={23} className={STROKE} strokeWidth={0.8} />
        </>
      ) : null}
      {kind === 'curtain' ? (
        <>
          {[22, 27, 32, 37, 42, 47].map((x) => (
            <path key={x} d={`M ${x} 3 Q ${x + 2} 13 ${x} 23`} className={STROKE} strokeWidth={0.7} fill="none" />
          ))}
        </>
      ) : null}
    </svg>
  );
}
