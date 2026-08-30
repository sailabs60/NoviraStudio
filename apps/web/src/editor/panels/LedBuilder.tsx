import { useMemo, useState } from 'react';
import { Image as ImageIcon, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  deriveLedScreen,
  fitLedScreen,
  formatLength,
  LED_FRAMES,
  LED_FRAME_LABELS,
  LED_PANELS,
  LED_PRESETS,
  type LedFrame,
  type LedScreenSceneObject,
} from '@novira/shared';
import { useEditor } from '../editorStore';
import { LedThumb } from '../BuilderThumb';
import { ImagePicker, type PickedImage } from '../../components/ImagePicker';
import { http, ApiClientError } from '../../lib/api';
import { toast } from '../../components/ui';
import { createLedScreen, uniqueName } from '../factories';
import {
  ColorField,
  Field,
  FindingCard,
  LengthField,
  NumberField,
  Section,
  Segmented,
  Select,
  SliderField,
  Stat,
} from '../../components/ui';

/**
 * The LED builder.
 *
 * The control that matters most here is the one that is *not* a slider: the
 * target size. People think in "a 10 metre screen", and hardware comes in whole
 * cabinets, so the field takes a size, fits it to the cabinet grid, and reports
 * what it actually made. Rounding silently would produce a plan that promises a
 * width the wall cannot be built to.
 *
 * Everything else — resolution, weight, power, viewing distance — is derived
 * and read-only, because all four are consequences of the panel and the count.
 */
export function LedBuilder() {
  const selected = useEditor((s) =>
    s.scene.objects.find((o) => o.id === s.selectedIds[0] && o.type === 'led')
  ) as LedScreenSceneObject | undefined;
  const objects = useEditor((s) => s.scene.objects);
  const units = useEditor((s) => s.scene.units);
  const addObjects = useEditor((s) => s.addObjects);
  const updateObject = useEditor((s) => s.updateObject);
  const readOnly = useEditor((s) => s.readOnly);

  if (!selected) {
    return (
      <Section
        title="Add a screen"
        description="Start from a shape people actually order. Everything is adjustable afterwards, and the cabinet count follows whatever size you set."
      >
        <div className="space-y-1.5">
          {LED_PRESETS.map((preset) => {
            const derived = deriveLedScreen({
              panelKey: preset.panelKey,
              columns: preset.columns,
              rows: preset.rows,
              bottomMm: preset.bottomMm,
              frame: preset.frame,
              curveDeg: preset.curveDeg,
            });
            return (
              <button
                key={preset.key}
                type="button"
                disabled={readOnly}
                onClick={() =>
                  addObjects([createLedScreen({ presetKey: preset.key, name: uniqueName(objects, preset.label) })])
                }
                className="w-full rounded-lg border border-line bg-surface-muted/40 p-2.5 text-left transition hover:border-primary/60 hover:bg-primary/10 disabled:opacity-40"
              >
                <LedThumb
                  columns={preset.columns}
                  rows={preset.rows}
                  curveDeg={preset.curveDeg}
                  className="mb-1.5 h-9 w-full"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink">{preset.label}</span>
                  <span className="chip shrink-0">{derived.areaSqM.toFixed(1)} m²</span>
                </div>
                <p className="mt-0.5 text-[10px] leading-snug text-ink-subtle">{preset.note}</p>
                <p className="mt-1 text-[10px] tabular-nums text-ink-muted">
                  {(derived.widthMm / 1000).toFixed(2)} × {(derived.heightMm / 1000).toFixed(2)} m ·{' '}
                  {derived.cabinetCount} cabinets · {derived.panel.label}
                </p>
              </button>
            );
          })}
        </div>
      </Section>
    );
  }

  return <LedEditor screen={selected} units={units} onPatch={(patch) => updateObject(selected.id, patch)} />;
}

function LedEditor({
  screen,
  units,
  onPatch,
}: {
  screen: LedScreenSceneObject;
  units: 'metric' | 'imperial';
  onPatch: (patch: Partial<LedScreenSceneObject>) => void;
}) {
  const derived = useMemo(() => deriveLedScreen(screen), [screen]);
  const [picking, setPicking] = useState(false);
  const [importing, setImporting] = useState(false);

  /**
   * Take whatever was chosen and make it ours.
   *
   * An upload arrives as a data URL and a library pick as a remote link; both
   * end the same way, as a re-encoded file on our own host. See the note in the
   * content section for why that matters.
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
        onPatch({ contentUrl: data.url });
      } else {
        const { data } = await http.post<{ imageUrl: string }>('/branding/images/import', {
          url: image.url,
          title: image.name,
          ...(image.license ? { license: image.license } : {}),
          ...(image.attribution ? { attribution: image.attribution } : {}),
          ...(image.sourceUrl ? { sourceUrl: image.sourceUrl } : {}),
          ...(image.sourceLabel ? { provider: image.sourceLabel } : {}),
        });
        onPatch({ contentUrl: data.imageUrl });
      }
    } catch (error) {
      toast(
        'error',
        error instanceof ApiClientError ? error.message : 'That image could not be put on the screen.'
      );
    } finally {
      setImporting(false);
    }
  }

  /** Fit a target size onto the cabinet grid and report what was made. */
  const fitTo = (targetWidthMm: number, targetHeightMm: number) => {
    const fitted = fitLedScreen(screen.panelKey, targetWidthMm, targetHeightMm);
    onPatch({ columns: fitted.columns, rows: fitted.rows });
  };

  return (
    <>
      <Section
        title="Size"
        description="Enter the size you want. It is fitted to whole cabinets, and what was actually built is shown underneath."
      >
        <LengthField
          label="Target width"
          valueMm={derived.widthMm}
          units={units}
          minMm={500}
          maxMm={60_000}
          onChange={(mm) => fitTo(mm, derived.heightMm)}
        />
        <LengthField
          label="Target height"
          valueMm={derived.heightMm}
          units={units}
          minMm={500}
          maxMm={20_000}
          onChange={(mm) => fitTo(derived.widthMm, mm)}
        />

        <div className="my-2 rounded-lg border border-line bg-surface-muted/40 px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">Built as</p>
          <p className="mt-0.5 text-xs font-semibold tabular-nums text-ink">
            {screen.columns} × {screen.rows} cabinets = {formatLength(derived.widthMm, units)} ×{' '}
            {formatLength(derived.heightMm, units)}
          </p>
          <p className="mt-0.5 text-[10px] text-ink-subtle">
            {derived.cabinetCount} cabinets at {derived.panel.widthMm} × {derived.panel.heightMm} mm
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Columns" value={screen.columns} min={1} max={120} onChange={(columns) => onPatch({ columns })} showRange={false} />
          <NumberField label="Rows" value={screen.rows} min={1} max={60} onChange={(rows) => onPatch({ rows })} showRange={false} />
        </div>

        <LengthField
          label="Bottom of image"
          valueMm={screen.bottomMm}
          units={units}
          minMm={0}
          maxMm={12_000}
          onChange={(bottomMm) => onPatch({ bottomMm })}
          help="Height from the floor to the bottom of the picture. Below about 1.2 m, the rows behind the first few cannot see the lower part of the content."
        />
      </Section>

      <Section title="Panel" help="Pitch is the distance between LEDs. Smaller pitch means a sharper image and a higher price, and it only matters if people stand close enough to tell.">
        <Field label="Cabinet type">
          <Select value={screen.panelKey} onChange={(e) => onPatch({ panelKey: e.target.value })}>
            {LED_PANELS.map((panel) => (
              <option key={panel.key} value={panel.key}>
                {panel.label} — {panel.pitchMm} mm pitch, {panel.use}
              </option>
            ))}
          </Select>
        </Field>
        <p className="field-hint">{derived.panel.note}</p>

        <Segmented
          label="Support"
          value={screen.frame}
          columns={2}
          options={LED_FRAMES.map((frame) => ({ value: frame, label: LED_FRAME_LABELS[frame] }))}
          onChange={(frame) => onPatch({ frame: frame as LedFrame })}
        />

        <SliderField
          label="Curve"
          value={screen.curveDeg}
          onChange={(curveDeg) => onPatch({ curveDeg })}
          min={-60}
          max={60}
          step={2}
          format={(v) => `${v}°`}
          help="Cabinets are flat, so a curve is built as facets. The wall wraps toward the audience at positive values and away at negative."
        />
      </Section>

      <Section title="What is on it" description="The image is only a preview here — content is supplied to the screen supplier separately.">
        {/*
          Content always arrives through our own host.

          A pasted link is not put on the screen directly. Three things go wrong
          when it is: a host that refuses hotlinking returns a placeholder or a
          403; a link to a *page* rather than an image loads as nothing; and any
          image that does load cross-origin taints the WebGL canvas, which
          silently breaks PDF export, the plan thumbnail and AI Enhance. So the
          link is fetched server-side, re-encoded — which also proves it really
          is an image — and served from our own origin.
        */}
        {screen.contentUrl ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-surface-muted p-1.5">
            <img
              src={screen.contentUrl}
              alt=""
              className="h-12 w-20 shrink-0 rounded border border-line bg-canvas object-contain"
            />
            <p className="min-w-0 flex-1 text-[11px] leading-snug text-ink-subtle">
              On the wall now. It is stretched across every cabinet, as content on a real screen is.
            </p>
            <button
              type="button"
              aria-label="Remove image"
              className="icon-btn h-7 w-7 shrink-0"
              onClick={() => onPatch({ contentUrl: null })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className="ed-action w-full justify-center border border-line"
          disabled={importing}
          onClick={() => setPicking(true)}
        >
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
          {importing ? 'Bringing it in…' : screen.contentUrl ? 'Put something else on it' : 'Put an image on it'}
        </button>
        <p className="field-hint">
          Search the image libraries, upload a file, or paste a link. Whichever you choose, a copy is kept with the
          plan so the screen still shows it when the original moves.
        </p>

        <ImagePicker
          open={picking}
          onClose={() => setPicking(false)}
          onPick={(image) => void adoptContent(image)}
          title="What goes on the screen"
          description="A holding slide, a logo, a key visual. The real content goes to the screen supplier separately."
          initialQuery="stage backdrop"
        />

        <ColorField
          label="Screen colour"
          value={screen.contentColor}
          onChange={(contentColor) => onPatch({ contentColor })}
          presets={['#0b1220', '#1d4ed8', '#111827', '#7c3aed', '#0f766e', '#be123c']}
        />

        <SliderField
          label="Glow into the room"
          value={screen.glowIntensity}
          onChange={(glowIntensity) => onPatch({ glowIntensity })}
          min={0}
          max={2}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          help="How much light the screen casts on everything around it. This is most of what makes a render with LED in it look like the real room."
        />

        <SliderField
          label="Brightness"
          value={screen.brightness}
          onChange={(brightness) => onPatch({ brightness })}
          min={0.1}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          hint={`Full brightness on this panel is ${derived.panel.brightnessNits} nits.`}
        />
      </Section>

      <Section title="Specification" description="Everything below follows from the panel and the cabinet count. It is what a supplier will quote against.">
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Area" value={`${derived.areaSqM.toFixed(2)} m²`} help="What LED is hired by." />
          <Stat label="Resolution" value={`${derived.pixelsWide} × ${derived.pixelsHigh}`} sub={derived.aspect} />
          <Stat label="Weight" value={`${derived.weightKg} kg`} />
          <Stat
            label="Peak power"
            value={`${derived.peakAmps230} A`}
            tone={derived.peakAmps230 > 32 ? 'warn' : 'neutral'}
            sub={`${(derived.powerPeakW / 1000).toFixed(1)} kW at 230 V`}
          />
          <Stat
            label="Closest viewer"
            value={formatLength(derived.minViewingDistanceMm, units)}
            help="Nearer than this and the pixels become visible. The rule of thumb is one metre per millimetre of pitch."
          />
          <Stat label="Processing" value={`${derived.processors} unit${derived.processors === 1 ? '' : 's'}`} sub={`${derived.dataRuns} data runs`} />
        </div>
      </Section>

      {derived.warnings.length ? (
        <Section title="Check this">
          <div className="space-y-1.5">
            {derived.warnings.map((warning, i) => (
              <FindingCard
                key={i}
                severity={warning.severity === 'error' ? 'error' : warning.severity === 'warning' ? 'warning' : 'info'}
                title={warning.severity === 'error' ? 'This will not work as specified' : 'Worth knowing'}
                detail={warning.message}
              />
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

/** The "add another screen" control, used from the build panel's header. */
export function AddScreenButton() {
  const objects = useEditor((s) => s.scene.objects);
  const addObjects = useEditor((s) => s.addObjects);
  const readOnly = useEditor((s) => s.readOnly);
  return (
    <button
      type="button"
      className="ed-action"
      disabled={readOnly}
      onClick={() => addObjects([createLedScreen({ name: uniqueName(objects, 'LED screen') })])}
    >
      <Plus className="h-3.5 w-3.5" /> Screen
    </button>
  );
}
