import { useState } from 'react';
import { Layers, Tent as TentIcon, Wind } from 'lucide-react';
import { createStage, type SceneObject } from '@novira/shared';
import { useEditor } from './editorStore';
import { Modal } from '../components/Modal';
import { TENT_PRESETS, createTent } from './Tent3D';
import { TentThumb } from './BuilderThumb';
import { createCurtain } from './Curtain3D';
import { VenuePanel } from './VenuePanel';
import { BrandingPanel } from './BrandingPanel';
import { SeatingPanel } from './SeatingPanel';

/**
 * Structures.
 *
 * Tents, stages and drapes are parametric objects rather than catalogue models,
 * so they are inserted from here rather than dragged from the item list. Each
 * arrives configured with sensible defaults and is then edited in the
 * Properties panel.
 */
export function StructuresMenu() {
  const [open, setOpen] = useState<null | 'tent' | 'stage' | 'drape'>(null);
  const addObjects = useEditor((s) => s.addObjects);
  const readOnly = useEditor((s) => s.readOnly);

  const insert = (object: SceneObject) => {
    addObjects([object]);
    setOpen(null);
  };

  return (
    <>
      <div className="grid grid-cols-4 gap-1">
        <button type="button" className="ed-action flex-col gap-1 py-2" disabled={readOnly}
          onClick={() => setOpen('tent')}>
          <TentIcon className="h-4 w-4" />
          <span className="text-[10px]">Tent</span>
        </button>
        <button type="button" className="ed-action flex-col gap-1 py-2" disabled={readOnly}
          onClick={() => insert(createStage())}>
          <Layers className="h-4 w-4" />
          <span className="text-[10px]">Stage</span>
        </button>
        <button type="button" className="ed-action flex-col gap-1 py-2" disabled={readOnly}
          onClick={() => insert(createCurtain())}>
          <Wind className="h-4 w-4" />
          <span className="text-[10px]">Drape</span>
        </button>
        <VenuePanel />
      </div>

      {/* Branding sits on its own row: it is a different job from placing
          structures, and grouping them would bury it. */}
      <div className="mt-1">
        <BrandingPanel />
      </div>

      <div className="mt-1">
        <SeatingPanel />
      </div>

      <Modal
        open={open === 'tent'}
        title="Add a tent"
        description="Pick a size. Sidewalls, canopy visibility and interior layout come next."
        onClose={() => setOpen(null)}
        width="max-w-lg"
        footer={<button type="button" className="btn-secondary" onClick={() => setOpen(null)}>Cancel</button>}
      >
        <ul className="grid grid-cols-2 gap-2">
          {TENT_PRESETS.map((preset) => (
            <li key={preset.key}>
              <button
                type="button"
                onClick={() => insert(createTent(preset))}
                className="w-full rounded-lg border border-line p-2.5 text-left transition hover:border-primary/60 hover:bg-primary/5"
              >
                <TentThumb
                  widthMm={preset.widthMm}
                  eaveHeightMm={preset.family === 'clearspan' ? (preset.widthMm >= 20000 ? 4000 : 3000) : 2440}
                  peakHeightMm={
                    (preset.family === 'clearspan' ? (preset.widthMm >= 20000 ? 4000 : 3000) : 2440) +
                    Math.round(preset.widthMm * 0.22)
                  }
                  className="mb-1 h-9 w-full"
                />
                <span className="block text-sm font-medium text-ink">{preset.label}</span>
                <span className="block text-[11px] tabular-nums text-ink-subtle">
                  {(preset.widthMm / 1000).toFixed(1)} × {(preset.lengthMm / 1000).toFixed(1)} m
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
