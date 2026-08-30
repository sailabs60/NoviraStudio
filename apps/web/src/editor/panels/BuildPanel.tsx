import { useEffect, useRef, useState } from 'react';
import { Boxes, Frame, Layers, Layers3, Monitor, Store, Tent as TentIcon, Type, Wind } from 'lucide-react';
import {
  createStage,
  type CurtainSceneObject,
  type SceneObject,
  type StageSceneObject,
  type TentSceneObject,
} from '@novira/shared';
import { useEditor } from '../editorStore';
import { EmptyState, Section, Segmented } from '../../components/ui';
import { TrussBuilder } from './TrussBuilder';
import { LedBuilder } from './LedBuilder';
import { BoothBuilder } from './BoothBuilder';
import { CurtainPanel, StagePanel, TentPanel } from '../BuilderPanels';
import { TENT_PRESETS, createTent } from '../Tent3D';
import { TentThumb } from '../BuilderThumb';
import { createCurtain } from '../Curtain3D';
import { BrandingPanel } from '../BrandingPanel';

type BuildTool = 'stage' | 'truss' | 'led' | 'booth' | 'structures' | 'branding';

const TOOLS: Array<{ value: BuildTool; label: string; icon: JSX.Element; hint: string }> = [
  {
    value: 'stage',
    label: 'Stage',
    icon: <Layers3 className="h-3.5 w-3.5" />,
    hint: 'Modular decks, stairs, skirting and guardrail, with the parts list derived as you build.',
  },
  {
    value: 'truss',
    label: 'Truss',
    icon: <Frame className="h-3.5 w-3.5" />,
    hint: 'Goalposts, grids and arches. The span warning tells you if the section will not take it.',
  },
  {
    value: 'led',
    label: 'LED',
    icon: <Monitor className="h-3.5 w-3.5" />,
    hint: 'Screens built from real cabinets, with resolution, weight and power derived.',
  },
  {
    value: 'booth',
    label: 'Stands',
    icon: <Store className="h-3.5 w-3.5" />,
    hint: 'One exhibition stand in detail, or a whole hall floor laid out on the grid.',
  },
  {
    value: 'structures',
    label: 'Tents & drapes',
    icon: <TentIcon className="h-3.5 w-3.5" />,
    hint: 'Framed structures with sidewalls, and pleated drape from a nine-point control grid.',
  },
  {
    value: 'branding',
    label: 'Branding',
    icon: <Type className="h-3.5 w-3.5" />,
    hint: 'Dimensional lettering and artwork — the part where a client identity goes into the room.',
  },
];

/**
 * The build panel.
 *
 * Everything that is *made to size* rather than picked from a catalogue. The
 * distinction matters more than it sounds: a chair is a thing you hire and a
 * truss run is a thing you specify, and treating the second like the first is
 * why most 3D event tools cannot produce a usable equipment list.
 *
 * The tool follows the selection. Clicking a stage in the viewport opens the
 * stage builder, because "I clicked the thing and the panel changed to it" is
 * the behaviour people expect and never have to be taught.
 */
export function BuildPanel() {
  const selected = useEditor((s) => s.scene.objects.find((o) => o.id === s.selectedIds[0]) ?? null);
  const units = useEditor((s) => s.scene.units);
  const addObjects = useEditor((s) => s.addObjects);
  const clearSelection = useEditor((s) => s.clearSelection);
  const readOnly = useEditor((s) => s.readOnly);

  const [tool, setTool] = useState<BuildTool>('stage');
  const lastSelectedId = useRef<string | null>(null);

  const toolForType = (type: string | undefined): BuildTool | null =>
    type === 'stage'
      ? 'stage'
      : type === 'truss'
        ? 'truss'
        : type === 'led'
          ? 'led'
          : type === 'booth'
            ? 'booth'
            : type === 'tent' || type === 'curtain'
              ? 'structures'
              : type === 'text3d' || type === 'artwork'
                ? 'branding'
                : null;

  /*
   * The tool follows a *change* of selection, not the selection itself.
   *
   * Clicking a truss in the viewport should open the truss builder — that is
   * the behaviour nobody has to be taught. But deriving the tool from the
   * selection on every render meant the tabs did nothing while anything was
   * selected: pressing LED with a truss selected snapped straight back to
   * truss. Reacting to the change instead gives both behaviours.
   */
  useEffect(() => {
    const id = selected?.id ?? null;
    if (id === lastSelectedId.current) return;
    lastSelectedId.current = id;
    const next = toolForType(selected?.type);
    if (next) setTool(next);
  }, [selected]);

  const editingSelection = toolForType(selected?.type) === tool && selected !== null;

  return (
    <>
      <Section title="What are you building?">
        <Segmented
          value={tool}
          columns={2}
          options={TOOLS.map((option) => ({
            value: option.value,
            label: option.label,
            hint: option.hint,
            icon: option.icon,
          }))}
          onChange={(value) => {
            setTool(value);
            // Switching tool by hand means starting something new, so the old
            // selection is dropped — otherwise the panel would show the LED
            // tab with a truss's properties under it.
            if (toolForType(selected?.type) !== value) {
              clearSelection();
              lastSelectedId.current = null;
            }
          }}
        />
        {editingSelection ? (
          <p className="field-hint">
            <Boxes className="mr-1 inline h-3 w-3" />
            Editing what you selected. Choose another tab, or click empty floor, to start something new.
          </p>
        ) : null}
      </Section>

      {/*
        Branding is a Build tool rather than a catalogue item, because extruded
        lettering at a chosen depth in a named finish is something you specify,
        not something you pick off a shelf. For a lot of events it is the brief.
      */}
      {tool === 'branding' ? (
        <>
          <Section title="Add lettering or artwork" description="Dimensional letters and printed panels, sized and finished the way a fabricator would quote them.">
            <BrandingPanel />
          </Section>
          {/*
            Editing an existing piece happens in the right-hand dock, not here.
            Both surfaces used to render the same controls, which put two live
            copies of every field on screen at once and made neither obviously
            the real one. Build adds; the dock edits.
          */}
        </>
      ) : null}

      {tool === 'truss' ? <TrussBuilder /> : null}
      {tool === 'led' ? <LedBuilder /> : null}
      {tool === 'booth' ? <BoothBuilder /> : null}

      {tool === 'stage' ? (
        selected?.type === 'stage' ? (
          <StagePanel stage={selected as StageSceneObject} units={units} />
        ) : (
          <Section
            title="Add a stage"
            description="Built from 4 ft modular decks. Stairs, skirting and guardrail follow from the height you set."
          >
            <button
              type="button"
              className="ed-action-primary w-full justify-center"
              disabled={readOnly}
              onClick={() => addObjects([createStage() as SceneObject])}
            >
              <Layers className="h-3.5 w-3.5" /> Add a stage
            </button>
            <p className="field-hint">
              A guardrail appears automatically above 762 mm, and the stair unit is chosen from the deck height — both
              are safety rules rather than preferences.
            </p>
          </Section>
        )
      ) : null}

      {tool === 'structures' ? (
        selected?.type === 'tent' ? (
          <TentPanel tent={selected as TentSceneObject} units={units} />
        ) : selected?.type === 'curtain' ? (
          <>
            <CurtainPanel curtain={selected as CurtainSceneObject} units={units} />
            <Section title="">
              <p className="flex items-start gap-1.5 text-[11px] leading-snug text-ink-subtle">
                <Wind className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                A drape's shape comes from nine control points. Drag the handles in the viewport — the side handles set
                how far each row reaches out, the centre ones how far it bows forward.
              </p>
            </Section>
          </>
        ) : (
          <>
            <Section title="Add a tent" description="Frame tents and clearspan structures. Nothing stands inside either — the legs are on the perimeter.">
              <div className="space-y-1">
                {TENT_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    disabled={readOnly}
                    onClick={() => addObjects([createTent(preset) as SceneObject])}
                    className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface-muted/40 p-1.5 text-left transition hover:border-primary/60 hover:bg-primary/10 disabled:opacity-40"
                  >
                    <TentThumb
                      widthMm={preset.widthMm}
                      eaveHeightMm={preset.family === 'clearspan' ? (preset.widthMm >= 20000 ? 4000 : 3000) : 2440}
                      peakHeightMm={
                        (preset.family === 'clearspan' ? (preset.widthMm >= 20000 ? 4000 : 3000) : 2440) +
                        Math.round(preset.widthMm * 0.22)
                      }
                      className="h-8 w-[72px] shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-semibold text-ink">{preset.label}</span>
                      <span className="block text-[10px] tabular-nums text-ink-subtle">
                        {(preset.widthMm / 1000).toFixed(1)} × {(preset.lengthMm / 1000).toFixed(1)} m ·{' '}
                        {Math.round(preset.lengthMm / preset.bayLengthMm) + 1} bents
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Add a drape" description="Procedural pleated fabric, shaped by a nine-anchor control grid.">
              <button
                type="button"
                className="ed-action-primary w-full justify-center"
                disabled={readOnly}
                onClick={() => addObjects([createCurtain() as SceneObject])}
              >
                <Wind className="h-3.5 w-3.5" /> Add a drape
              </button>
            </Section>
          </>
        )
      ) : null}

      {!selected && tool !== 'stage' && tool !== 'structures' ? null : null}
    </>
  );
}

/** Shown when a build tool has nothing selected and nothing to add. */
export function BuildEmpty() {
  return (
    <EmptyState
      title="Nothing selected"
      description="Pick what you want to build above, or click an existing object in the plan to edit it."
    />
  );
}
