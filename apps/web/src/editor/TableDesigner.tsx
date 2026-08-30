import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Search, X } from 'lucide-react';
import {
  DEFAULT_LAYOUT_PARAMS,
  LAYOUT_PRESETS,
  PLACE_SETTING_SLOT_KEYS,
  PLACE_SETTING_SLOT_LABELS,
  formatLength,
  parseLength,
  type CatalogItemDto,
  type LayoutPreset,
  type PlaceSettingSlotKey,
  type TableGroup,
} from '@novira/shared';
import { api } from '../lib/api';
import { useEditor } from './editorStore';
import { estimateObjectCount, generateTableGroup, totalSeats } from './generateTables';
import { Modal } from '../components/Modal';

const PRESET_LABELS: Record<LayoutPreset, string> = {
  grid: 'Grid',
  'angled-grid': 'Angled grid',
  rows: 'Rows',
  pyramid: 'Pyramid',
  diagonal: 'Diagonal',
  curved: 'Curved',
  circle: 'Arc',
  'closed-circle': 'Circle',
  'u-shape': 'U-shape',
  aisle: 'Aisle',
};

interface Draft {
  tableItemId: number | null;
  linenItemId: number | null;
  chairItemId: number | null;
  centerpieceItemId: number | null;
  seatsPerTable: number;
  tableCount: number;
  preset: LayoutPreset;
  rows: number;
  columns: number;
  rowSpacingMm: number;
  columnSpacingMm: number;
  placeSettings: Partial<Record<PlaceSettingSlotKey, number | null>>;
}

const INITIAL: Draft = {
  tableItemId: null,
  linenItemId: null,
  chairItemId: null,
  centerpieceItemId: null,
  seatsPerTable: 8,
  tableCount: 6,
  preset: 'grid',
  rows: 2,
  columns: 3,
  rowSpacingMm: 2438,
  columnSpacingMm: 2438,
  placeSettings: {},
};

export function TableDesigner({ open, onClose }: { open: boolean; onClose: () => void }) {
  const units = useEditor((s) => s.units);
  const upsertTableGroup = useEditor((s) => s.upsertTableGroup);
  const cacheItems = useEditor((s) => s.cacheItems);
  const [draft, setDraft] = useState<Draft>(INITIAL);
  const [picker, setPicker] = useState<
    { slot: 'table' | 'linen' | 'chair' | 'centerpiece' | PlaceSettingSlotKey; title: string; category: string } | null
  >(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // Everything the designer might reference, so previews and names resolve.
  const { data: pool } = useQuery({
    queryKey: ['catalog', 'designer-pool'],
    queryFn: async () => {
      const results = await Promise.all(
        ['tables', 'chairs', 'linens', 'centerpieces', 'tableware'].map((slug) =>
          api.catalog.items({ categorySlug: slug, limit: 100 })
        )
      );
      return results.flatMap((r) => r.items);
    },
    enabled: open,
  });

  const byId = useMemo(() => {
    const map = new Map<number, CatalogItemDto>();
    for (const item of pool ?? []) map.set(item.id, item);
    return map;
  }, [pool]);

  const group: TableGroup = useMemo(
    () => ({
      id: crypto.randomUUID(),
      tableItemId: draft.tableItemId ?? 0,
      linenItemId: draft.linenItemId,
      chairItemId: draft.chairItemId,
      centerpieceItemId: draft.centerpieceItemId,
      seatsPerTable: draft.seatsPerTable,
      placeSettings: draft.placeSettings,
      layout: {
        ...DEFAULT_LAYOUT_PARAMS,
        preset: draft.preset,
        rows: draft.rows,
        columns: draft.columns,
        rowSpacingMm: draft.rowSpacingMm,
        columnSpacingMm: draft.columnSpacingMm,
      },
      tableCount: draft.tableCount,
      originMm: { x: 0, y: 0, z: 0 },
      rotationDeg: 0,
    }),
    [draft]
  );

  const table = draft.tableItemId ? byId.get(draft.tableItemId) : undefined;
  const canInsert = Boolean(table);

  function insert() {
    if (!table) return;
    const objects = generateTableGroup(group, { byId: (id) => byId.get(id) });
    if (!objects.length) return;
    // Cache the rows the new objects reference so they render immediately.
    cacheItems([...new Set(objects.map((o) => (o as { catalogItemId: number }).catalogItemId))]
      .map((id) => byId.get(id))
      .filter((i): i is CatalogItemDto => Boolean(i)));
    upsertTableGroup(group, objects);
    setDraft(INITIAL);
    onClose();
  }

  const slotItem = (id: number | null | undefined) => (id ? byId.get(id) : undefined);

  return (
    <>
      <Modal
        open={open && !picker}
        title="Table Designer"
        description="Build a complete table set — table, linen, chairs and a full cover on every seat."
        onClose={onClose}
        width="max-w-3xl"
        footer={
          <>
            <span className="mr-auto text-xs text-ink-muted">
              {draft.tableCount} tables · <strong className="text-ink">{totalSeats(group)}</strong> seats ·{' '}
              {estimateObjectCount(group)} objects
            </span>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={!canInsert} onClick={insert}>
              Insert tables
            </button>
          </>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <section>
            <h3 className="ed-section-title">The table</h3>
            <SlotButton
              label="Table"
              required
              item={slotItem(draft.tableItemId)}
              units={units}
              onPick={() => setPicker({ slot: 'table', title: 'Choose a table', category: 'tables' })}
              onClear={() => set('tableItemId', null)}
            />
            <SlotButton
              label="Linen"
              item={slotItem(draft.linenItemId)}
              units={units}
              onPick={() => setPicker({ slot: 'linen', title: 'Choose a linen', category: 'linens' })}
              onClear={() => set('linenItemId', null)}
            />
            <SlotButton
              label="Centrepiece"
              item={slotItem(draft.centerpieceItemId)}
              units={units}
              onPick={() =>
                setPicker({ slot: 'centerpiece', title: 'Choose a centrepiece', category: 'centerpieces' })
              }
              onClear={() => set('centerpieceItemId', null)}
            />

            <h3 className="ed-section-title mt-4">Seating</h3>
            <SlotButton
              label="Chair"
              item={slotItem(draft.chairItemId)}
              units={units}
              onPick={() => setPicker({ slot: 'chair', title: 'Choose a chair', category: 'chairs' })}
              onClear={() => set('chairItemId', null)}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <NumberField
                label="Seats per table"
                value={draft.seatsPerTable}
                min={0}
                max={20}
                onChange={(v) => set('seatsPerTable', v)}
              />
              <NumberField
                label="Number of tables"
                value={draft.tableCount}
                min={1}
                max={80}
                onChange={(v) => set('tableCount', v)}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-ink-subtle">
              Seat count applies to every generated table.
            </p>
          </section>

          <section>
            <h3 className="ed-section-title">Place setting</h3>
            <p className="mb-2 text-[11px] leading-relaxed text-ink-subtle">
              Each piece is cloned onto every seat and stays in step with the table, chair and layout.
            </p>
            <div className="space-y-1">
              {PLACE_SETTING_SLOT_KEYS.map((slot) => (
                <SlotButton
                  key={slot}
                  compact
                  label={PLACE_SETTING_SLOT_LABELS[slot]}
                  item={slotItem(draft.placeSettings[slot])}
                  units={units}
                  onPick={() =>
                    setPicker({
                      slot,
                      title: `Choose ${PLACE_SETTING_SLOT_LABELS[slot].toLowerCase()}`,
                      category: 'tableware',
                    })
                  }
                  onClear={() =>
                    setDraft((d) => ({ ...d, placeSettings: { ...d.placeSettings, [slot]: null } }))
                  }
                />
              ))}
            </div>
            {Object.values(draft.placeSettings).some(Boolean) ? (
              <button
                type="button"
                className="ed-action mt-2"
                onClick={() => set('placeSettings', {})}
              >
                Clear all settings
              </button>
            ) : null}
          </section>

          <section className="sm:col-span-2">
            <h3 className="ed-section-title">Layout</h3>
            <div className="mb-3 grid grid-cols-5 gap-1.5">
              {LAYOUT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => set('preset', preset)}
                  className={`rounded-md border px-2 py-2 text-[11px] font-medium transition ${
                    draft.preset === preset
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {PRESET_LABELS[preset]}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <NumberField label="Columns" value={draft.columns} min={1} max={20}
                onChange={(v) => set('columns', v)} />
              <NumberField label="Rows" value={draft.rows} min={1} max={20}
                onChange={(v) => set('rows', v)} />
              <LengthField label="Column spacing" valueMm={draft.columnSpacingMm} units={units}
                onChange={(v) => set('columnSpacingMm', v)} />
              <LengthField label="Row spacing" valueMm={draft.rowSpacingMm} units={units}
                onChange={(v) => set('rowSpacingMm', v)} />
            </div>
          </section>
        </div>
      </Modal>

      {picker ? (
        <ItemPicker
          title={picker.title}
          category={picker.category}
          units={units}
          onClose={() => setPicker(null)}
          onSelect={(item) => {
            setDraft((d) => {
              if (picker.slot === 'table') return { ...d, tableItemId: item.id, seatsPerTable: item.seatsDefault ?? d.seatsPerTable };
              if (picker.slot === 'linen') return { ...d, linenItemId: item.id };
              if (picker.slot === 'chair') return { ...d, chairItemId: item.id };
              if (picker.slot === 'centerpiece') return { ...d, centerpieceItemId: item.id };
              return { ...d, placeSettings: { ...d.placeSettings, [picker.slot]: item.id } };
            });
            setPicker(null);
          }}
        />
      ) : null}
    </>
  );
}

function SlotButton({
  label, item, units, onPick, onClear, required, compact,
}: {
  label: string;
  item?: CatalogItemDto;
  units: 'metric' | 'imperial';
  onPick: () => void;
  onClear: () => void;
  required?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'flex items-center gap-2' : 'mb-2'}>
      {compact ? <span className="w-20 shrink-0 text-[11px] text-ink-muted">{label}</span> : null}
      <div className="flex flex-1 items-center gap-1">
        <button type="button" onClick={onPick}
          className="flex flex-1 items-center gap-2 rounded-md border border-line bg-surface-muted/40 px-2 py-1.5 text-left transition hover:border-line-strong">
          {item?.previewImage ? (
            <img src={item.previewImage} alt="" className="h-7 w-7 rounded object-cover" />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded bg-surface-muted text-[9px] text-ink-subtle">
              {item ? '3D' : '+'}
            </span>
          )}
          <span className="min-w-0 flex-1">
            {!compact ? (
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                {label}{required ? ' *' : ''}
              </span>
            ) : null}
            <span className="block truncate text-xs text-ink">
              {item?.name ?? <span className="text-ink-subtle">Choose…</span>}
            </span>
            {item?.widthMm ? (
              <span className="block text-[10px] text-success">{formatLength(item.widthMm, units)}</span>
            ) : null}
          </span>
        </button>
        {item ? (
          <button type="button" onClick={onClear} aria-label={`Clear ${label}`}
            className="icon-btn h-7 w-7 shrink-0">
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function NumberField({
  label, value, min, max, onChange,
}: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="ed-label">{label}</label>
      <input type="number" className="ed-field" value={value} min={min} max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
        }} />
    </div>
  );
}

function LengthField({
  label, valueMm, units, onChange,
}: { label: string; valueMm: number; units: 'metric' | 'imperial'; onChange: (mm: number) => void }) {
  return (
    <div>
      <label className="ed-label">{label}</label>
      <input className="ed-field" defaultValue={formatLength(valueMm, units, { bare: true })}
        key={valueMm}
        onBlur={(e) => {
          const mm = parseLength(e.target.value, units);
          if (mm !== null && mm > 0) onChange(mm);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </div>
  );
}

/** Nested picker — the parent modal stays mounted behind it. */
function ItemPicker({
  title, category, units, onSelect, onClose,
}: {
  title: string;
  category: string;
  units: 'metric' | 'imperial';
  onSelect: (item: CatalogItemDto) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const { data } = useQuery({
    queryKey: ['catalog', 'picker', category, q],
    queryFn: () => api.catalog.items({ categorySlug: category, q: q || undefined, limit: 60 }),
  });

  return (
    <Modal open title={title} onClose={onClose} width="max-w-2xl"
      footer={<button type="button" className="btn-secondary" onClick={onClose}>Close</button>}>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
        <input className="input pl-8" placeholder="Quick search…" value={q} autoFocus
          onChange={(e) => setQ(e.target.value)} />
      </div>
      {!data?.items.length ? (
        <p className="py-10 text-center text-sm text-ink-subtle">
          {q ? 'Nothing matches that search.' : 'No items in this category yet.'}
        </p>
      ) : (
        <ul className="grid max-h-[52vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
          {data.items.map((item) => (
            <li key={item.id}>
              <button type="button" disabled={!item.isAccessible} onClick={() => onSelect(item)}
                className="w-full rounded-lg border border-line p-2 text-left transition hover:border-primary/60 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-40">
                <span className="mb-1.5 flex h-20 items-center justify-center overflow-hidden rounded bg-surface-muted/60">
                  {item.previewImage ? (
                    <img src={item.previewImage} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <span className="text-[10px] text-ink-subtle">3D model</span>
                  )}
                </span>
                <span className="block truncate text-xs font-medium text-ink">{item.name}</span>
                {item.widthMm ? (
                  <span className="block text-[10px] text-success">{formatLength(item.widthMm, units)}</span>
                ) : null}
                {item.seatsDefault ? (
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-muted">
                    <Check className="h-2.5 w-2.5" /> seats {item.seatsDefault}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
