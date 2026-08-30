import { useMemo, useState } from 'react';
import { Eye, EyeOff, Lightbulb, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import {
  autoLightScene,
  GOBO_INFO,
  GOBO_PATTERNS,
  LIGHTING_LOOKS,
  LIGHTING_PRESETS,
  LIGHT_FIXTURE_LIST,
  LIGHT_FIXTURE_SPECS,
  LIGHT_ROLES,
  LIGHT_ROLE_INFO,
  lightingLoad,
  lightingLook,
  subjectsFromObjects,
  type GoboPattern,
  type LightFixtureKey,
  type LightFixtureSceneObject,
  type LightRole,
  type SceneObject,
} from '@novira/shared';
import { useEditor } from '../editorStore';
import { createLight, newId } from '../factories';
import {
  ColorField,
  Field,
  FindingCard,
  Section,
  Select,
  SliderField,
  Stat,
  Toggle,
  toast,
} from '../../components/ui';

/**
 * The lighting engine.
 *
 * The order of this panel is the order lighting is actually designed in: choose
 * the look, let the rig be generated, then adjust individual fixtures. Starting
 * with a blank plot and a "add spotlight" button is how a planner ends up with
 * four fixtures pointing at nothing, which looks worse than no lighting at all.
 *
 * "Auto light scene" is therefore the primary control on the panel, not a
 * convenience tucked at the bottom.
 */
export function LightPanel() {
  const objects = useEditor((s) => s.scene.objects);
  const render = useEditor((s) => s.scene.render);
  const lighting = useEditor((s) => s.scene.lighting);
  const walls = useEditor((s) => s.scene.walls);
  const selectedId = useEditor((s) => s.selectedIds[0]);
  const addObjects = useEditor((s) => s.addObjects);
  const updateObject = useEditor((s) => s.updateObject);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const commit = useEditor((s) => s.commit);
  const commitQuiet = useEditor((s) => s.commitQuiet);
  const setRender = useEditor((s) => s.setRender);
  const focusObject = useEditor((s) => s.focusObject);
  const readOnly = useEditor((s) => s.readOnly);

  const fixtures = useMemo(
    () => objects.filter((o): o is LightFixtureSceneObject => o.type === 'light'),
    [objects]
  );
  const selected = fixtures.find((f) => f.id === selectedId);
  const load = useMemo(() => lightingLoad(fixtures.filter((f) => !f.muted).map((f) => ({ fixture: f.fixture }))), [fixtures]);
  const look = lightingLook(render.look);

  /** Room extents, from the walls if there are any, otherwise from the content. */
  const roomSize = useMemo(() => {
    const points = walls.segments.flatMap((s) => [s.start, s.end]);
    const fromFloors = walls.floors.flatMap((f) => f.points);
    const all = [...points, ...fromFloors];
    if (all.length >= 2) {
      const xs = all.map((p) => p.xMm);
      const zs = all.map((p) => p.zMm);
      return { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...zs) - Math.min(...zs) };
    }
    const placed = objects.filter((o) => o.type !== 'light' && o.type !== 'constraint');
    if (!placed.length) return { width: 20_000, depth: 24_000 };
    const xs = placed.map((o) => o.positionMm.x);
    const zs = placed.map((o) => o.positionMm.z);
    return {
      width: Math.max(12_000, Math.max(...xs) - Math.min(...xs) + 12_000),
      depth: Math.max(12_000, Math.max(...zs) - Math.min(...zs) + 12_000),
    };
  }, [walls, objects]);

  const trimHeight = useMemo(() => {
    const truss = objects.find((o) => o.type === 'truss') as (SceneObject & { trimHeightMm?: number }) | undefined;
    return truss?.trimHeightMm ?? 6000;
  }, [objects]);

  const applyLook = (key: string) => {
    const chosen = lightingLook(key);
    setRender({ look: key, haze: chosen.haze, exposure: chosen.level });
    // The environment map is part of the look: a gala under a bright studio HDR
    // reads as a conference room whatever the fixtures are doing.
    commitQuiet((draft) => {
      const preset = LIGHTING_PRESETS.find((p) => p.key === chosen.environment);
      if (preset) draft.lighting.preset = preset.key;
      draft.lighting.intensity = chosen.ambient;
    });
  };

  const runAutoLight = () => {
    const subjects = subjectsFromObjects(objects);
    const placements = autoLightScene({
      look: render.look,
      subjects,
      roomWidthMm: roomSize.width,
      roomDepthMm: roomSize.depth,
      trimHeightMm: trimHeight,
    });

    if (!placements.length) {
      toast('info', 'Nothing to light yet. Add a stage, a screen or some tables first.');
      return;
    }

    /*
     * Replace only the fixtures that were generated last time. A planner who has
     * placed and aimed three specials by hand and then presses this again must
     * not lose them — so generated fixtures carry a group id and hand-placed
     * ones do not.
     */
    const groupId = 'auto-light';
    commit((draft) => {
      draft.objects = draft.objects.filter((o) => !(o.type === 'light' && o.groupId === groupId));
      for (const placement of placements) {
        const { positionMm, name, ...data } = placement;
        draft.objects.push({
          id: newId(),
          type: 'light',
          name,
          groupId,
          positionMm,
          rotationDeg: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          ...data,
        } as LightFixtureSceneObject);
      }
    });

    const kept = fixtures.filter((f) => f.groupId !== groupId).length;
    toast(
      'success',
      `${placements.length} fixtures rigged for a ${look.label.toLowerCase()} look.${kept ? ` Your ${kept} hand-placed fixture${kept === 1 ? '' : 's'} kept.` : ''}`
    );
  };

  return (
    <>
      <Section
        title="The look"
        description="A complete relationship between key, fill, back light and the room. Changing one colour without the others is what makes lighting look amateur, so these change together."
      >
        <div className="grid grid-cols-2 gap-1.5">
          {LIGHTING_LOOKS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => applyLook(option.key)}
              aria-pressed={render.look === option.key}
              className={`rounded-lg border p-2 text-left transition ${
                render.look === option.key
                  ? 'border-primary bg-primary/10'
                  : 'border-line bg-surface-muted/40 hover:border-line-strong'
              }`}
            >
              <div className="flex gap-1">
                {[option.keyColor, option.washColors[0], option.washColors[1], option.rimColor].map((color, i) => (
                  <span key={i} className="h-4 flex-1 rounded-sm" style={{ background: color }} />
                ))}
              </div>
              <p className="mt-1.5 text-[11px] font-semibold text-ink">{option.label}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-ink-subtle">{option.note}</p>
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Auto light scene"
        help="Works out where the stage, screens and tables are, and rigs a key, a fill, a back light, a room wash and accents around them."
      >
        <button type="button" className="ed-action-primary w-full justify-center" onClick={runAutoLight} disabled={readOnly}>
          <Wand2 className="h-3.5 w-3.5" /> Light this scene
        </button>
        <p className="field-hint">
          Fixtures you placed by hand are kept. Only the ones generated last time are replaced.
        </p>
      </Section>

      <Section title="Atmosphere" description="How the room reads overall, independent of any one fixture.">
        <SliderField
          label="Exposure"
          value={render.exposure}
          onChange={(exposure) => setRender({ exposure })}
          min={0.2}
          max={2}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          help="Brightens or darkens everything at once, the way a camera's exposure does. Use it to lift a dark look without relighting it."
        />
        <SliderField
          label="Haze"
          value={render.haze}
          onChange={(haze) => setRender({ haze })}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          help="Beams are invisible without haze in the air. Some venues do not permit it — check before you design a look around beams."
        />
        <SliderField
          label="Bloom"
          value={render.bloom}
          onChange={(bloom) => setRender({ bloom })}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          help="How much bright surfaces — LED, neon lettering — bleed into what is around them."
        />
        <Toggle
          label="Shadows"
          checked={lighting.shadowsEnabled}
          onChange={(shadowsEnabled) =>
            commitQuiet((draft) => {
              draft.lighting.shadowsEnabled = shadowsEnabled;
            })
          }
          hint="Off is faster on older hardware and makes almost no difference to a plan view."
        />
      </Section>

      <Section
        title={`Fixtures (${fixtures.length})`}
        action={
          <button
            type="button"
            className="ed-action"
            disabled={readOnly}
            onClick={() => addObjects([createLight({ position: { x: 0, y: trimHeight, z: 0 } })])}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        }
      >
        {fixtures.length === 0 ? (
          <p className="text-[11px] leading-snug text-ink-subtle">
            No fixtures yet. Press <strong className="text-ink-muted">Light this scene</strong> above to rig the whole
            room, or add one at a time.
          </p>
        ) : (
          <div className="space-y-1">
            {fixtures.map((fixture) => (
              <div
                key={fixture.id}
                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition ${
                  fixture.id === selectedId ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-surface-muted/50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => focusObject(fixture.id, 'light')}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-line"
                    style={{ background: fixture.muted ? 'transparent' : fixture.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-ink">
                      {fixture.name || LIGHT_FIXTURE_SPECS[fixture.fixture].label}
                    </span>
                    <span className="block truncate text-[10px] text-ink-subtle">
                      {LIGHT_FIXTURE_SPECS[fixture.fixture].label} · {LIGHT_ROLE_INFO[fixture.role].label} ·{' '}
                      {fixture.channel}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={fixture.muted ? 'Turn on' : 'Turn off'}
                  className="shrink-0 text-ink-subtle transition hover:text-ink"
                  onClick={() => updateObject(fixture.id, { muted: !fixture.muted } as Partial<SceneObject>)}
                >
                  {fixture.muted ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {selected ? <FixtureEditor fixture={selected} onPatch={(patch) => updateObject(selected.id, patch)} onDelete={deleteSelected} /> : null}

      <Section title="Power and control" description="What the rig draws and what it needs to run. These figures feed straight into the cost estimate.">
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Fixtures" value={load.fixtureCount} />
          <Stat label="Total load" value={`${(load.totalWatts / 1000).toFixed(1)} kW`} />
          <Stat
            label="Current"
            value={`${load.amps230} A`}
            tone={load.amps230 > 63 ? 'warn' : 'neutral'}
            sub="at 230 V"
          />
          <Stat
            label="Circuits"
            value={load.circuits16A}
            sub="16 A at 80 %"
            help="Electricians design to 80 % of a circuit's rating, so this is the honest number rather than the theoretical one."
          />
          <Stat label="Weight" value={`${load.totalWeightKg} kg`} help="Counts toward the flown load if the fixtures are rigged." />
          <Stat label="DMX" value={`${load.dmxUniverses} universe${load.dmxUniverses === 1 ? '' : 's'}`} />
        </div>

        {load.amps230 > 0 ? (
          <div className="mt-2 space-y-1">
            {load.lines.map((line) => (
              <div key={line.fixture} className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-ink-muted">{line.label}</span>
                <span className="shrink-0 tabular-nums text-ink-subtle">{line.wattsTotal} W</span>
                <span className="shrink-0 font-semibold tabular-nums text-ink">×{line.count}</span>
              </div>
            ))}
          </div>
        ) : null}
      </Section>
    </>
  );
}

/* ── One fixture ───────────────────────────────────────────────────────── */

function FixtureEditor({
  fixture,
  onPatch,
  onDelete,
}: {
  fixture: LightFixtureSceneObject;
  onPatch: (patch: Partial<LightFixtureSceneObject>) => void;
  onDelete: () => void;
}) {
  const spec = LIGHT_FIXTURE_SPECS[fixture.fixture];
  const [showTarget, setShowTarget] = useState(false);

  return (
    <Section
      title="Selected fixture"
      action={
        <button type="button" className="ed-action text-danger" onClick={onDelete} aria-label="Delete fixture">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      }
    >
      <Field label="Fixture type" help="Named for what you would hire. The beam angle, output and power all follow from the choice.">
        <Select
          value={fixture.fixture}
          onChange={(e) => {
            const next = e.target.value as LightFixtureKey;
            const nextSpec = LIGHT_FIXTURE_SPECS[next];
            onPatch({
              fixture: next,
              beamAngleDeg: nextSpec.beamAngleDeg,
              softness: nextSpec.softness,
              volumetric: nextSpec.volumetric,
            });
          }}
        >
          {LIGHT_FIXTURE_LIST.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label} — {option.beamAngleDeg}°, {option.wattage} W
            </option>
          ))}
        </Select>
      </Field>
      <p className="field-hint">{spec.note}</p>

      <Field label="Role" help="What this fixture is doing. Auto light scene uses roles to work out relative brightness; the key is always the brightest and the fill never matches it.">
        <Select value={fixture.role} onChange={(e) => onPatch({ role: e.target.value as LightRole })}>
          {LIGHT_ROLES.map((role) => (
            <option key={role} value={role}>
              {LIGHT_ROLE_INFO[role].label} — {LIGHT_ROLE_INFO[role].note}
            </option>
          ))}
        </Select>
      </Field>

      <ColorField
        label="Colour"
        value={fixture.color}
        onChange={(color) => onPatch({ color })}
        presets={['#ffffff', '#fff4e2', '#ffd9a0', '#8b5cf6', '#1d4ed8', '#22d3ee', '#f43f5e', '#22c55e']}
      />

      <SliderField
        label="Intensity"
        value={fixture.intensity}
        onChange={(intensity) => onPatch({ intensity })}
        min={0}
        max={2}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
      />

      <SliderField
        label="Beam angle"
        value={fixture.beamAngleDeg}
        onChange={(beamAngleDeg) => onPatch({ beamAngleDeg })}
        min={spec.minBeamDeg}
        max={spec.maxBeamDeg}
        step={1}
        format={(v) => `${v}°`}
        hint={`This fixture zooms between ${spec.minBeamDeg}° and ${spec.maxBeamDeg}°.`}
      />

      <SliderField
        label="Edge softness"
        value={fixture.softness}
        onChange={(softness) => onPatch({ softness })}
        min={0}
        max={1}
        step={0.05}
        format={(v) => (v < 0.2 ? 'Hard' : v < 0.5 ? 'Medium' : v < 0.8 ? 'Soft' : 'Very soft')}
        help="A profile spot has a hard edge you can shutter; a wash has none. Matching the fixture is what makes a render believable."
      />

      {spec.canGobo ? (
        <Field label="Gobo" help="A pattern cut into metal or glass, projected by the fixture. It is the cheapest way to make a bare wall look designed.">
          <Select value={fixture.gobo} onChange={(e) => onPatch({ gobo: e.target.value as GoboPattern })}>
            {GOBO_PATTERNS.map((pattern) => (
              <option key={pattern} value={pattern}>
                {GOBO_INFO[pattern].label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {spec.canGobo ? <p className="field-hint">{GOBO_INFO[fixture.gobo].note}</p> : null}

      <Toggle
        label="Visible beam"
        checked={fixture.volumetric}
        onChange={(volumetric) => onPatch({ volumetric })}
        hint="Draws the shaft of light. Only realistic where there is haze, and only for fixtures that actually throw a beam."
      />
      <Toggle
        label="Casts shadows"
        checked={fixture.castShadow}
        onChange={(castShadow) => onPatch({ castShadow })}
        hint="More realistic and more expensive to draw. Turn it on for the one or two fixtures that matter in a render."
      />
      <Toggle label="Turned off" checked={Boolean(fixture.muted)} onChange={(muted) => onPatch({ muted })} hint="Keeps the fixture in the plot and the equipment list, but takes it out of the picture." />

      <Field label="Channel group" hint="Fixtures on the same channel are dimmed and coloured together, as they would be on a desk.">
        <Select value={fixture.channel} onChange={(e) => onPatch({ channel: e.target.value })}>
          {['KEY', 'FILL', 'RIM', 'BACK', 'UP', 'AUD', 'ACC', 'A', 'B', 'C'].map((channel) => (
            <option key={channel} value={channel}>
              {channel}
            </option>
          ))}
        </Select>
      </Field>

      <button type="button" className="ed-action mt-1 w-full justify-center border border-line" onClick={() => setShowTarget((v) => !v)}>
        <Sparkles className="h-3.5 w-3.5" /> {showTarget ? 'Hide' : 'Show'} aim point
      </button>
      {showTarget ? (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <label key={axis} className="block">
              <span className="ed-label">{axis.toUpperCase()} (m)</span>
              <input
                type="number"
                className="ed-field"
                step={0.5}
                value={(fixture.targetMm[axis] / 1000).toFixed(2)}
                onChange={(e) =>
                  onPatch({ targetMm: { ...fixture.targetMm, [axis]: Math.round(Number(e.target.value) * 1000) } })
                }
              />
            </label>
          ))}
        </div>
      ) : null}
    </Section>
  );
}

/** Shown on the rail when a plan has LED but no lighting at all. */
export function LightingNudge() {
  const objects = useEditor((s) => s.scene.objects);
  const setWorkPanel = useEditor((s) => s.setWorkPanel);
  const hasScreens = objects.some((o) => o.type === 'led' || o.type === 'stage');
  const hasLights = objects.some((o) => o.type === 'light');

  if (!hasScreens || hasLights) return null;

  return (
    <FindingCard
      severity="suggestion"
      title="Nothing is lit yet"
      detail="There is a stage or a screen in this plan but no lighting. Most clients expect at least a key light on anyone standing in front of it."
      action="Open the Light panel and press Light this scene."
      onFix={() => setWorkPanel('light')}
      fixLabel="Open lighting"
    />
  );
}

export { Lightbulb };
