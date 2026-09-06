import { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, Loader2, Trash2, X } from 'lucide-react';
import {
  LED_FRAMES,
  LED_FRAME_LABELS,
  LED_PANELS,
  deriveLedScreen,
  ledPanel,
  type LedScreenSceneObject,
} from '@novira/shared';
import { useEditor } from './editorStore';
import { http, ApiClientError } from '../lib/api';
import { toast } from '../components/ui';
import { ImagePicker, type PickedImage } from '../components/ImagePicker';

/**
 * The screen, edited where it is.
 *
 * Double-clicking a wall in the viewport opens this over it. That is the whole
 * point: content, curve and panel type are the things people change while
 * *looking* at the screen — you judge a curve by seeing it bend and an image by
 * seeing it land — and the round trip to a sidebar breaks that loop every time.
 *
 * It is a companion to the LED builder in the rail, not a replacement. The
 * builder still owns the long tail: exact cabinet counts, fitting to a target
 * size, power and weight, the warnings. This carries the handful of controls
 * that are worth having under your hand while the screen is in front of you.
 *
 * Anchored to the screen's own projected position, so it appears beside the
 * object it edits rather than in a fixed corner, and flips above when there is
 * no room below.
 */

const PANEL_WIDTH = 340;

export function LedQuickPanel({
  screen,
  onClose,
}: {
  screen: LedScreenSceneObject;
  onClose: () => void;
}) {
  const updateObject = useEditor((s) => s.updateObject);
  const anchor = useEditor((s) => s.selectionAnchor);
  const [importing, setImporting] = useState(false);
  const [picking, setPicking] = useState(false);

  const derived = useMemo(() => deriveLedScreen(screen), [screen]);
  const panel = ledPanel(screen.panelKey);

  const patch = (next: Partial<LedScreenSceneObject>) => updateObject(screen.id, next);

  // Escape closes, which is what every popover in this editor already does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Take whatever was chosen and make it ours.
   *
   * An upload arrives as a data URL and a library pick as a remote link; both
   * end as a file on our own host, so the texture loads with CORS headers the
   * canvas will accept. A tainted canvas silently breaks PDF export and the
   * plan thumbnail, which both read pixels back.
   */
  async function adoptContent(image: PickedImage) {
    setImporting(true);
    try {
      if (image.url.startsWith('data:')) {
        const blob = await (await fetch(image.url)).blob();
        const form = new FormData();
        form.append('file', new File([blob], image.name || 'screen-content', { type: blob.type }));
        const { data } = await http.post<{ url: string }>('/branding/images/upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        patch({ contentUrl: data.url });
      } else {
        const { data } = await http.post<{ imageUrl: string }>('/branding/images/import', {
          url: image.url,
          title: image.name,
          ...(image.license ? { license: image.license } : {}),
          ...(image.attribution ? { attribution: image.attribution } : {}),
          ...(image.sourceUrl ? { sourceUrl: image.sourceUrl } : {}),
          ...(image.sourceLabel ? { provider: image.sourceLabel } : {}),
        });
        patch({ contentUrl: data.imageUrl });
      }
    } catch (error: unknown) {
      toast(
        'error',
        error instanceof ApiClientError ? error.message : 'That image could not be put on the screen.'
      );
    } finally {
      setImporting(false);
      setPicking(false);
    }
  }

  /*
   * Placement. The anchor is the selection's projected box, so the panel sits
   * just under the screen and flips above it when the screen is low in the
   * frame. Clamped to the viewport on both axes so it is always reachable,
   * even when the wall is half off-screen.
   */
  const view = { width: window.innerWidth, height: window.innerHeight };
  /*
   * The panel is tall, so placement is chosen by which side has room for it
   * rather than by a fixed preference. Sitting below the screen is the default
   * — it keeps the wall itself unobscured while you change what is on it — and
   * it moves above only when there is genuinely more space there. Whichever
   * side wins, the result is clamped so the panel's *whole* height stays on
   * screen, which is what the first version got wrong: it anchored above and
   * let the top sections run off the top of the viewport.
   */
  const PANEL_MAX_H = 460;
  const MARGIN = 12;
  const roomBelow = anchor ? view.height - anchor.bottom - MARGIN * 2 : view.height;
  const roomAbove = anchor ? anchor.top - MARGIN * 2 : 0;
  const flip = Boolean(anchor) && roomBelow < PANEL_MAX_H && roomAbove > roomBelow;

  const rawTop = anchor ? (flip ? anchor.top - MARGIN : anchor.bottom + MARGIN) : 96;
  // When flipped the panel is translated up by its own height, so the value
  // being clamped is its bottom edge; otherwise it is its top edge.
  const top = flip
    ? Math.min(view.height - MARGIN, Math.max(PANEL_MAX_H + MARGIN, rawTop))
    : Math.max(MARGIN, Math.min(rawTop, view.height - PANEL_MAX_H - MARGIN));
  const left = anchor ? anchor.x : view.width / 2;

  const curve = screen.curveDeg ?? 0;
  const perPanel = screen.columns > 0 ? curve / screen.columns : 0;

  return (
    <>
      {/* Click anywhere else to dismiss. */}
      <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-30 cursor-default" onClick={onClose} />

      <div
        className="pointer-events-auto absolute z-40"
        style={{
          left: Math.round(Math.min(Math.max(left, PANEL_WIDTH / 2 + 8), view.width - PANEL_WIDTH / 2 - 8)),
          top: Math.round(Math.min(Math.max(top, 8), view.height - 80)),
          transform: flip ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          width: PANEL_WIDTH,
        }}
      >
        <div className="panel overflow-hidden p-0 shadow-2xl">
          {/* ── Header ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-ink">{screen.name || 'LED screen'}</p>
              <p className="text-[10px] text-ink-subtle">
                {derived.widthMm / 1000}&nbsp;×&nbsp;{derived.heightMm / 1000}&nbsp;m ·{' '}
                {screen.columns}×{screen.rows} cabinets · {derived.pixelsWide}×{derived.pixelsHigh}px
              </p>
            </div>
            <button type="button" onClick={onClose} className="icon-btn h-7 w-7 shrink-0" title="Close">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="max-h-[380px] overflow-y-auto">
            {/* ── Content ────────────────────────────────────────────── */}
            <Section title="Content">
              {screen.contentUrl ? (
                <div className="space-y-2">
                  <div className="relative overflow-hidden rounded border border-line bg-surface-muted">
                    <img
                      src={screen.contentUrl}
                      alt=""
                      className="h-24 w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => patch({ contentUrl: null })}
                      title="Take it off the screen"
                      className="absolute right-1.5 top-1.5 rounded bg-black/60 p-1 text-white hover:bg-black/80"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  {/*
                    Aspect handling. A 16:9 source on a 3:1 wall has to do
                    something, and these are the three things a video processor
                    offers, named as an operator would name them.
                  */}
                  <ChipRow
                    value={screen.contentFit ?? 'cover'}
                    options={[
                      { value: 'cover', label: 'Fill' },
                      { value: 'contain', label: 'Fit' },
                      { value: 'stretch', label: 'Stretch' },
                    ]}
                    onChange={(v) => patch({ contentFit: v as 'cover' | 'contain' | 'stretch' })}
                  />
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => setPicking(true)}
                disabled={importing}
                className="btn-secondary mt-2 flex w-full items-center justify-center gap-1.5 text-xs"
              >
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                {importing ? 'Bringing it in…' : screen.contentUrl ? 'Change the image' : 'Put an image on it'}
              </button>
            </Section>

            {/* ── Curve ──────────────────────────────────────────────── */}
            <Section title="Curve">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={curve}
                  onChange={(e) => patch({ curveDeg: Number(e.target.value) })}
                  className="flex-1 accent-primary"
                />
                <span className="w-14 shrink-0 text-right text-[11px] font-semibold tabular-nums text-ink">
                  {curve}°
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-snug text-ink-subtle">
                {Math.abs(curve) < 0.5
                  ? 'Flat.'
                  : `${Math.abs(perPanel).toFixed(1)}° between cabinets. ${
                      Math.abs(perPanel) > 6
                        ? 'Beyond about 6° a rigid cabinet shows the join — that needs flexible modules.'
                        : 'Within what rigid cabinets do cleanly.'
                    }`}
              </p>
              <ChipRow
                className="mt-2"
                value={String(curve)}
                options={[
                  { value: '0', label: 'Flat' },
                  { value: '15', label: '15°' },
                  { value: '30', label: '30°' },
                  { value: '60', label: '60°' },
                  { value: '-30', label: 'Convex' },
                ]}
                onChange={(v) => patch({ curveDeg: Number(v) })}
              />
            </Section>

            {/* ── Panel type ─────────────────────────────────────────── */}
            <Section title="LED type">
              <select
                value={screen.panelKey}
                onChange={(e) => patch({ panelKey: e.target.value })}
                className="input w-full text-xs"
              >
                {LED_PANELS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label} — {p.pitchMm}mm · {p.use}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] leading-snug text-ink-subtle">{panel.note}</p>
            </Section>

            {/* ── Rig ────────────────────────────────────────────────── */}
            <Section title="Set-up">
              <ChipRow
                value={screen.frame}
                options={LED_FRAMES.map((f) => ({ value: f, label: LED_FRAME_LABELS[f] }))}
                onChange={(v) => patch({ frame: v as LedScreenSceneObject['frame'] })}
                wrap
              />
            </Section>

            {/* ── Size ───────────────────────────────────────────────── */}
            <Section title="Cabinets">
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Across"
                  value={screen.columns}
                  min={1}
                  max={60}
                  onChange={(n) => patch({ columns: n })}
                />
                <NumberField
                  label="Down"
                  value={screen.rows}
                  min={1}
                  max={30}
                  onChange={(n) => patch({ rows: n })}
                />
              </div>
            </Section>

            {/* ── Output ─────────────────────────────────────────────── */}
            <Section title="Brightness" last>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={screen.brightness ?? 0.8}
                  onChange={(e) => patch({ brightness: Number(e.target.value) })}
                  className="flex-1 accent-primary"
                />
                <span className="w-14 shrink-0 text-right text-[11px] font-semibold tabular-nums text-ink">
                  {Math.round((screen.brightness ?? 0.8) * 100)}%
                </span>
              </div>
              {/*
                The numbers a production manager checks. Shown here because
                changing the panel type or the cabinet count moves all three,
                and finding that out later is how a wall gets specified twice.
              */}
              <dl className="mt-2 grid grid-cols-3 gap-1 text-center">
                {[
                  ['Cabinets', String(derived.cabinetCount)],
                  ['Weight', `${Math.round(derived.weightKg)} kg`],
                  ['Power', `${(derived.powerAvgW / 1000).toFixed(1)} kW`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded bg-surface-muted px-1 py-1">
                    <dt className="text-[9px] uppercase tracking-wide text-ink-subtle">{label}</dt>
                    <dd className="text-[11px] font-semibold tabular-nums text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          </div>
        </div>
      </div>

      {picking ? (
        <ImagePicker
          open
          onClose={() => setPicking(false)}
          onPick={(image) => void adoptContent(image)}
          title="Content for the screen"
        />
      ) : null}
    </>
  );
}

/* ── Small pieces ──────────────────────────────────────────────────────── */

function Section({
  title,
  children,
  last,
}: {
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`px-3 py-2.5 ${last ? '' : 'border-b border-line'}`}>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-subtle">{title}</p>
      {children}
    </div>
  );
}

function ChipRow({
  value,
  options,
  onChange,
  className = '',
  wrap,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  className?: string;
  wrap?: boolean;
}) {
  return (
    <div className={`flex gap-1 ${wrap ? 'flex-wrap' : ''} ${className}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`chip flex-1 whitespace-nowrap transition ${
            value === option.value ? 'chip-active' : 'hover:border-line-strong'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] text-ink-subtle">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, Math.round(next))));
        }}
        className="input w-full text-xs tabular-nums"
      />
    </label>
  );
}
