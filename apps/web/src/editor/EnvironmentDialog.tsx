import { useMemo, useState } from 'react';
import { Check, Compass, Globe2, Image as ImageIcon, Sun, X } from 'lucide-react';
import { LIGHTING_PRESETS } from '@novira/shared';
import { Modal } from '../components/Modal';
import { LazyImage } from '../components/LazyImage';
import { AssetBrowser } from './AssetBrowser';
import { useEditor } from './editorStore';

/**
 * The environment chooser.
 *
 * An HDRI is not a wallpaper. It is the light in the room: it decides the
 * colour of every reflection, the direction and softness of every shadow, and
 * whether a brushed-steel counter reads as metal at all. Which is why this is a
 * proper window rather than a dropdown buried in a panel, and why it is opened
 * straight from the bottom toolbar next to the other things people change
 * constantly.
 *
 * Three ways in, in the order people actually use them:
 *
 *  · **Studio** — nine curated skies covering the situations an event is shot
 *    in. One click, no thinking, and each is served from Poly Haven at 1k so it
 *    loads in a second.
 *  · **Browse** — the full online library, thousands of maps, searchable.
 *  · **Adjust** — background, rotation, exposure and sun height. Rotation is
 *    the one people miss: it aims the sun, and without it you are stuck with
 *    wherever the photographer happened to be standing.
 */

/**
 * The curated set.
 *
 * Chosen for the situations event work is actually presented in — a product
 * shot, a hall, a marquee at golden hour — rather than for looking impressive
 * in a grid. Poly Haven serves both the map and its thumbnail, CC0, so nothing
 * here needs a key or an account.
 */
const CURATED = [
  { id: 'studio_small_03', name: 'Studio', note: 'Neutral softboxes. The safe default for a product-style view.' },
  { id: 'brown_photostudio_02', name: 'Photo studio', note: 'Warmer key, deeper falloff. Flattering on timber and fabric.' },
  { id: 'je_gray_02', name: 'Grey studio', note: 'Flat and even. Shows form without colouring it.' },
  { id: 'empty_warehouse_01', name: 'Warehouse', note: 'The interior most exhibition halls actually are.' },
  { id: 'st_fagans_interior', name: 'Interior', note: 'Windows down one side — a room with real daylight.' },
  { id: 'kloppenheim_06', name: 'Overcast', note: 'Soft, shadowless daylight. Nothing competes with the design.' },
  { id: 'sunflowers_puresky', name: 'Clear sky', note: 'Hard sun and a blue bounce. Outdoor builds and marquees.' },
  { id: 'the_sky_is_on_fire', name: 'Golden hour', note: 'Long shadows and warm rim light. The hero render.' },
  { id: 'dikhololo_night', name: 'Night', note: 'Almost no ambient, so your own fixtures do all the work.' },
] as const;

const hdrUrl = (id: string) => `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${id}_1k.hdr`;
const thumbUrl = (id: string) => `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=280&height=158`;

export function EnvironmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'studio' | 'browse'>('studio');

  const lighting = useEditor((s) => s.scene.lighting);
  const render = useEditor((s) => s.scene.render);
  const commit = useEditor((s) => s.commit);
  const setEnvironmentHdri = useEditor((s) => s.setEnvironmentHdri);
  const setRender = useEditor((s) => s.setRender);
  const readOnly = useEditor((s) => s.readOnly);

  const activeUrl = lighting.customHdriUrl;
  const activeShipped = useMemo(
    () => (activeUrl ? null : LIGHTING_PRESETS.find((p) => p.key === lighting.preset) ?? null),
    [activeUrl, lighting.preset]
  );

  const patchLighting = (patch: Partial<typeof lighting>) =>
    commit((draft) => {
      draft.lighting = { ...draft.lighting, ...patch };
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Environment"
      width="max-w-3xl"
      footer={
        <>
          <p className="mr-auto hidden max-w-md text-[11px] leading-snug text-ink-subtle sm:block">
            The environment lights the whole scene — reflections, shadow direction and colour all come from it.
            Maps are served from Poly Haven under CC0.
          </p>
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* ── What is applied right now ─────────────────────────────── */}
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-muted p-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Sun className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink">
              {lighting.customHdriLabel ?? activeShipped?.label ?? 'Studio'}
            </p>
            <p className="truncate text-[11px] text-ink-subtle">
              {activeUrl ? 'From the online library' : 'Included with Novira'}
            </p>
          </div>
          {activeUrl ? (
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={readOnly}
              onClick={() => setEnvironmentHdri(null)}
            >
              <X className="h-3 w-3" /> Reset
            </button>
          ) : null}
        </div>

        {/* ── Adjust ────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-line p-3">
          <h3 className="ed-section-title mb-3">Adjust</h3>

          <label className="mb-3 flex items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-line accent-primary"
              checked={Boolean(lighting.showEnvironmentBackground)}
              disabled={readOnly}
              onChange={(e) => patchLighting({ showEnvironmentBackground: e.target.checked })}
            />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-ink">Show it behind the room</span>
              <span className="block text-[11px] leading-snug text-ink-subtle">
                Puts the sky itself in the background. Right for a hero render; distracting while you are laying out
                a floor, which is why it is off by default.
              </span>
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <Slider
              label="Rotation"
              hint="Aims the sun. The most useful control an environment has."
              icon={<Compass className="h-3 w-3" />}
              value={lighting.environmentRotationDeg ?? 0}
              min={0}
              max={359}
              step={1}
              suffix="°"
              disabled={readOnly}
              onChange={(v) => patchLighting({ environmentRotationDeg: v })}
            />
            <Slider
              label="Exposure"
              hint="Brightens or darkens the whole frame without relighting anything."
              value={render.exposure}
              min={0.2}
              max={2.5}
              step={0.05}
              format={(v) => `${v.toFixed(2)}×`}
              disabled={readOnly}
              onChange={(v) => setRender({ exposure: v })}
            />
            <Slider
              label="Environment strength"
              hint="How much of the light comes from the map rather than from your own fixtures."
              value={lighting.intensity}
              min={0}
              max={2}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              disabled={readOnly}
              onChange={(v) => patchLighting({ intensity: v })}
            />
            <Slider
              label="Sun height"
              hint="Raises the key light. Low is long shadows; high is midday."
              value={lighting.heightZ}
              min={1}
              max={30}
              step={0.5}
              format={(v) => `${v.toFixed(1)} m`}
              disabled={readOnly}
              onChange={(v) => patchLighting({ heightZ: v })}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-line accent-primary"
                checked={lighting.shadowsEnabled}
                disabled={readOnly}
                onChange={(e) => patchLighting({ shadowsEnabled: e.target.checked })}
              />
              Shadows
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-line accent-primary"
                checked={render.contactShadows}
                disabled={readOnly}
                onChange={(e) => setRender({ contactShadows: e.target.checked })}
              />
              Contact shadows
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-line accent-primary"
                checked={lighting.glowEnabled}
                disabled={readOnly}
                onChange={(e) => patchLighting({ glowEnabled: e.target.checked })}
              />
              Glow on emissive surfaces
            </label>
          </div>
        </section>

        {/* ── Choose ────────────────────────────────────────────────── */}
        <div>
          <div className="ed-segment mb-3 w-full">
            <button
              type="button"
              onClick={() => setTab('studio')}
              className={`ed-segment-btn flex flex-1 items-center justify-center gap-1.5 ${
                tab === 'studio' ? 'ed-segment-btn-active' : ''
              }`}
            >
              <ImageIcon className="h-3 w-3" /> Curated
            </button>
            <button
              type="button"
              onClick={() => setTab('browse')}
              className={`ed-segment-btn flex flex-1 items-center justify-center gap-1.5 ${
                tab === 'browse' ? 'ed-segment-btn-active' : ''
              }`}
            >
              <Globe2 className="h-3 w-3" /> Browse thousands
            </button>
          </div>

          {tab === 'studio' ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {CURATED.map((entry) => {
                const url = hdrUrl(entry.id);
                const selected = activeUrl === url;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={readOnly}
                    title={entry.note}
                    onClick={() => setEnvironmentHdri(url, entry.name)}
                    className={`group overflow-hidden rounded-xl border text-left transition disabled:opacity-50 ${
                      selected
                        ? 'border-primary ring-2 ring-primary/25'
                        : 'border-line hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-card'
                    }`}
                  >
                    <span className="relative block">
                      <LazyImage
                        src={thumbUrl(entry.id)}
                        alt={entry.name}
                        ratio="16 / 9"
                        wrapperClassName="w-full border-0"
                        rounded=""
                        fallback={<Sun className="h-4 w-4 text-ink-subtle/60" />}
                      />
                      {selected ? (
                        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-fg shadow-btn">
                          <Check className="h-3 w-3" />
                        </span>
                      ) : null}
                    </span>
                    <span className="block border-t border-line px-2 py-1.5">
                      <span className={`block truncate text-[11px] font-bold ${selected ? 'text-primary' : 'text-ink'}`}>
                        {entry.name}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-ink-subtle line-clamp-2">
                        {entry.note}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="h-[360px] overflow-hidden rounded-xl border border-line">
              <AssetBrowser
                category="hdris"
                usableOnly
                emptyHint="No environments came back from the libraries. The curated set above always works."
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ── A labelled slider that shows its value ────────────────────────────── */

function Slider({
  label,
  hint,
  icon,
  value,
  min,
  max,
  step,
  suffix,
  format,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  icon?: React.ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  format?: (value: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block" title={hint}>
      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted">
        {icon}
        {label}
        <span className="ml-auto tabular-nums text-ink">
          {format ? format(value) : `${Math.round(value)}${suffix ?? ''}`}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        className="w-full accent-primary"
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
