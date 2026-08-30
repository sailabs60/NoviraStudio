import { useState } from 'react';
import { Check, Eraser, PenLine, Trash2, X } from 'lucide-react';
import {
  DEFAULT_WALL_HEIGHT_MM,
  DEFAULT_WALL_THICKNESS_MM,
  createRoom,
  formatArea,
  formatLength,
  parseLength,
  polygonArea,
  segmentLength,
} from '@novira/shared';
import { useEditor } from './editorStore';

/**
 * Wall tooling.
 *
 * Replaces the Properties panel while the wall tool is active. Three jobs:
 * draw a run, drop a rectangular room when the dimensions are already known,
 * and edit whatever is currently selected.
 */
export function WallPanel() {
  const units = useEditor((s) => s.units);
  const setTool = useEditor((s) => s.setTool);
  const readOnly = useEditor((s) => s.readOnly);

  const wallDrawing = useEditor((s) => s.wallDrawing);
  const wallDraft = useEditor((s) => s.wallDraft);
  const startWallDraw = useEditor((s) => s.startWallDraw);
  const finishWallRun = useEditor((s) => s.finishWallRun);
  const cancelWallDraw = useEditor((s) => s.cancelWallDraw);
  const clearAllWalls = useEditor((s) => s.clearAllWalls);
  const addRoom = useEditor((s) => s.addRoom);

  const segments = useEditor((s) => s.scene.walls.segments);
  const floors = useEditor((s) => s.scene.walls.floors);
  const selectedWallId = useEditor((s) => s.selectedWallId);
  const selectedFloorId = useEditor((s) => s.selectedFloorId);
  const updateWall = useEditor((s) => s.updateWall);
  const updateAllWalls = useEditor((s) => s.updateAllWalls);
  const deleteWall = useEditor((s) => s.deleteWall);
  const updateFloor = useEditor((s) => s.updateFloor);

  const [roomLength, setRoomLength] = useState(9144); // 30 ft
  const [roomWidth, setRoomWidth] = useState(6096); // 20 ft
  const [roomThickness, setRoomThickness] = useState(DEFAULT_WALL_THICKNESS_MM);

  const wall = segments.find((w) => w.id === selectedWallId) ?? null;
  const floor = floors.find((f) => f.id === selectedFloorId) ?? null;

  return (
    <div className="flex flex-col">
      {/*
        The way out.

        While a drawing tool is active it takes over the whole work column, so
        the control that turned it on is no longer on screen. Without an
        explicit exit the only escape is a keyboard shortcut nobody has been
        told about — which is how a tool becomes a trap.
      */}
      <header className="flex items-start gap-2 border-b border-line px-3 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink">Walls</h2>
          <p className="mt-0.5 text-[11px] text-ink-muted">Create and edit wall segments.</p>
        </div>
        <button
          type="button"
          className="ed-action shrink-0 border border-line"
          onClick={() => setTool('select')}
          title="Stop drawing walls and go back to selecting"
        >
          <Check className="h-3.5 w-3.5" /> Done
        </button>
      </header>

      {/* ── Draw a run ─────────────────────────────────────────────────── */}
      <section className="ed-section">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="ed-section-title mb-0">Create wall</h3>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
              wallDrawing ? 'bg-primary/20 text-primary' : 'bg-surface-muted text-ink-subtle'
            }`}
          >
            {wallDrawing ? 'Drawing' : 'Idle'}
          </span>
        </div>

        <div className="mb-2 flex gap-1.5">
          <button
            type="button"
            className={`ed-action flex-1 justify-center ${wallDrawing ? 'ed-action-primary' : ''}`}
            disabled={readOnly}
            onClick={startWallDraw}
            title="Start creating"
          >
            <PenLine className="h-3.5 w-3.5" /> Start
          </button>
          <button
            type="button"
            className="ed-action flex-1 justify-center"
            disabled={!wallDrawing || wallDraft.length < 2}
            onClick={() => finishWallRun(false)}
            title="Finish drawing"
          >
            <Check className="h-3.5 w-3.5" /> Finish
          </button>
          <button
            type="button"
            className="ed-action"
            disabled={!wallDrawing}
            onClick={cancelWallDraw}
            aria-label="Cancel drawing"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="text-[10px] leading-relaxed text-ink-subtle">
          {wallDrawing
            ? `${wallDraft.length} point${wallDraft.length === 1 ? '' : 's'} placed. Click the first point to close the room, or right-click to finish an open run.`
            : 'Click Start, then click along the walls on the canvas.'}
        </p>

        <p className="mt-2 text-[11px] text-ink-muted">
          Segments: <strong className="text-ink">{segments.length}</strong>
        </p>

        {segments.length ? (
          <button
            type="button"
            className="ed-action mt-2 text-danger hover:bg-danger/10 hover:text-danger"
            disabled={readOnly}
            onClick={clearAllWalls}
          >
            <Eraser className="h-3.5 w-3.5" /> Clear all walls
          </button>
        ) : null}
      </section>

      {/* ── Quick room ─────────────────────────────────────────────────── */}
      <section className="ed-section">
        <h3 className="ed-section-title">Quick room</h3>
        <p className="mb-2 text-[10px] leading-relaxed text-ink-subtle">
          Creates a rectangular room at the centre from length × width. Thickness is the wall width.
        </p>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <LenField label="Length" valueMm={roomLength} units={units} onChange={setRoomLength} />
          <LenField label="Width" valueMm={roomWidth} units={units} onChange={setRoomWidth} />
        </div>
        <LenField label="Wall thickness" valueMm={roomThickness} units={units} onChange={setRoomThickness} />
        <button
          type="button"
          className="ed-action-primary mt-2 w-full justify-center"
          disabled={readOnly || roomLength < 500 || roomWidth < 500}
          onClick={() =>
            addRoom(createRoom(roomLength, roomWidth, roomThickness, DEFAULT_WALL_HEIGHT_MM).segments)
          }
        >
          Create room
        </button>
      </section>

      {/* ── Edit the selected wall ─────────────────────────────────────── */}
      <section className="ed-section">
        <h3 className="ed-section-title">Edit wall</h3>
        {!wall ? (
          <p className="text-[11px] leading-relaxed text-ink-subtle">
            Click a wall segment in the canvas to adjust it.
          </p>
        ) : (
          <>
            <p className="mb-2 text-[11px] text-ink-muted">
              Length <strong className="text-ink">{formatLength(segmentLength(wall.start, wall.end), units)}</strong>
            </p>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <LenField
                label="Thickness"
                valueMm={wall.thicknessMm}
                units={units}
                onChange={(mm) => updateWall(wall.id, { thicknessMm: mm })}
              />
              <LenField
                label="Height"
                valueMm={wall.heightMm}
                units={units}
                onChange={(mm) => updateWall(wall.id, { heightMm: mm })}
              />
            </div>

            <label className="ed-label">Colour</label>
            <input
              type="color"
              className="mb-2 h-8 w-full cursor-pointer rounded border border-line bg-surface-muted"
              value={wall.color ?? '#e2e0dc'}
              disabled={readOnly}
              onChange={(e) => updateWall(wall.id, { color: e.target.value })}
            />

            <div className="flex gap-1.5">
              <button
                type="button"
                className="ed-action flex-1 justify-center"
                disabled={readOnly}
                onClick={() =>
                  updateAllWalls({
                    thicknessMm: wall.thicknessMm,
                    heightMm: wall.heightMm,
                    color: wall.color,
                  })
                }
              >
                Apply to all walls
              </button>
              <button
                type="button"
                className="ed-action text-danger hover:bg-danger/10 hover:text-danger"
                disabled={readOnly}
                onClick={() => deleteWall(wall.id)}
                aria-label="Delete wall segment"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        )}
      </section>

      {/* ── Floor ──────────────────────────────────────────────────────── */}
      <section className="ed-section">
        <h3 className="ed-section-title">Floor</h3>
        {!floor ? (
          <p className="text-[11px] leading-relaxed text-ink-subtle">
            {floors.length
              ? 'Click a floor area in the canvas to style it.'
              : 'Close a run of walls into a loop and a floor appears automatically.'}
          </p>
        ) : (
          <>
            <dl className="mb-2 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <dt className="text-ink-subtle">Area</dt>
                <dd className="font-medium text-ink">{formatArea(polygonArea(floor.points), units)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-subtle">Vertices</dt>
                <dd className="font-medium text-ink">{floor.points.length}</dd>
              </div>
            </dl>
            <label className="ed-label">Floor colour</label>
            <input
              type="color"
              className="h-8 w-full cursor-pointer rounded border border-line bg-surface-muted"
              value={floor.color ?? '#9aa3b2'}
              disabled={readOnly}
              onChange={(e) => updateFloor(floor.id, { color: e.target.value })}
            />
          </>
        )}
      </section>
    </div>
  );
}

function LenField({
  label,
  valueMm,
  units,
  onChange,
}: {
  label: string;
  valueMm: number;
  units: 'metric' | 'imperial';
  onChange: (mm: number) => void;
}) {
  return (
    <div>
      <label className="ed-label">{label}</label>
      <input
        className="ed-field"
        defaultValue={formatLength(valueMm, units, { bare: true })}
        key={valueMm}
        onBlur={(e) => {
          const mm = parseLength(e.target.value, units);
          if (mm !== null && mm > 0) onChange(mm);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}
