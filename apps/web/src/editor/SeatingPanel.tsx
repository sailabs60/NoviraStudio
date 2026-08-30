import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Armchair, Loader2, Users, Wand2, X } from 'lucide-react';
import { http, ApiClientError } from '../lib/api';
import { Modal } from '../components/Modal';
import { useEditor } from './editorStore';

/**
 * Seating.
 *
 * The chart is the layout, read back — tables come from the scene, so moving a
 * table in the editor moves it here, and there is no second drawing to keep in
 * step.
 *
 * Assignment is drag-and-drop because that is how people think about seating
 * plans: you pick someone up and put them somewhere. Dropping onto an occupied
 * chair displaces its occupant to "anywhere at this table" rather than
 * refusing, since dragging onto a taken seat is a normal thing to do and
 * refusing it makes the whole chart feel brittle.
 */

interface SeatPos {
  index: number;
  xMm: number;
  zMm: number;
  rotationDeg: number;
}

interface Table {
  objectId: string;
  label: string;
  seatCount: number;
  shape: 'round' | 'rectangular' | 'other';
  xMm: number;
  zMm: number;
  widthMm: number;
  depthMm: number;
  diameterMm: number | null;
  seats: SeatPos[];
}

interface Guest {
  id: number;
  firstName: string;
  lastName: string;
  rsvp: 'pending' | 'yes' | 'no' | 'maybe';
  partyName: string | null;
  dietary: string | null;
  accessibility: string | null;
}

interface Assignment {
  guestId: number;
  tableObjectId: string;
  seatIndex: number | null;
}

interface Summary {
  attending: number;
  seated: number;
  unseated: number;
  totalSeats: number;
  spareSeats: number;
  issues: string[];
}

interface SeatingData {
  tables: Table[];
  guests: Guest[];
  assignments: Assignment[];
  summary: Summary;
}

/** Plan-space bounds of every table, for fitting the chart to its panel. */
function chartBounds(tables: Table[]) {
  if (!tables.length) return { minX: -5000, maxX: 5000, minZ: -5000, maxZ: 5000 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const t of tables) {
    const halfW = (t.diameterMm ?? t.widthMm) / 2 + 900;
    const halfD = (t.diameterMm ?? t.depthMm) / 2 + 900;
    minX = Math.min(minX, t.xMm - halfW);
    maxX = Math.max(maxX, t.xMm + halfW);
    minZ = Math.min(minZ, t.zMm - halfD);
    maxZ = Math.max(maxZ, t.zMm + halfD);
  }
  return { minX, maxX, minZ, maxZ };
}

export function SeatingPanel() {
  const qc = useQueryClient();
  const planId = useEditor((s) => s.planId);
  const readOnly = useEditor((s) => s.readOnly);

  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['seating', planId],
    queryFn: async () => (await http.get<SeatingData>(`/plans/${planId}/seating`)).data,
    enabled: open && Boolean(planId),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['seating', planId] });

  const assign = useMutation({
    mutationFn: async (body: { guestId: number; tableObjectId: string; seatIndex: number | null }) =>
      (await http.put(`/plans/${planId}/seating/assign`, body)).data,
    onSuccess: invalidate,
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : 'Could not seat that guest.'),
  });

  const unassign = useMutation({
    mutationFn: async (guestId: number) =>
      (await http.delete(`/plans/${planId}/seating/${guestId}`)).data,
    onSuccess: invalidate,
  });

  const autoSeat = useMutation({
    mutationFn: async (keepExisting: boolean) =>
      (await http.post(`/plans/${planId}/seating/auto`, { keepExisting })).data,
    onSuccess: invalidate,
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : 'Could not fill the chart.'),
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const seatedBy = useMemo(() => {
    const map = new Map<string, Guest>();
    if (!data) return map;
    const guests = new Map(data.guests.map((g) => [g.id, g]));
    for (const a of data.assignments) {
      const guest = guests.get(a.guestId);
      if (!guest) continue;
      map.set(`${a.tableObjectId}:${a.seatIndex ?? 'any'}`, guest);
    }
    return map;
  }, [data]);

  const tableOccupancy = useMemo(() => {
    const map = new Map<string, Guest[]>();
    if (!data) return map;
    const guests = new Map(data.guests.map((g) => [g.id, g]));
    for (const a of data.assignments) {
      const guest = guests.get(a.guestId);
      if (!guest) continue;
      if (!map.has(a.tableObjectId)) map.set(a.tableObjectId, []);
      map.get(a.tableObjectId)!.push(guest);
    }
    return map;
  }, [data]);

  const unseated = useMemo(() => {
    if (!data) return [];
    const seated = new Set(data.assignments.map((a) => a.guestId));
    const q = search.trim().toLowerCase();
    return data.guests
      .filter((g) => (g.rsvp === 'yes' || g.rsvp === 'maybe') && !seated.has(g.id))
      .filter((g) =>
        q ? `${g.firstName} ${g.lastName} ${g.partyName ?? ''}`.toLowerCase().includes(q) : true
      );
  }, [data, search]);

  const bounds = useMemo(() => chartBounds(data?.tables ?? []), [data?.tables]);
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
  const toPct = (xMm: number, zMm: number) => ({
    left: `${((xMm - bounds.minX) / spanX) * 100}%`,
    top: `${((zMm - bounds.minZ) / spanZ) * 100}%`,
  });

  return (
    <>
      <button
        type="button"
        className="ed-action w-full justify-center"
        title="Seating chart"
        onClick={() => setOpen(true)}
      >
        <Users className="h-3.5 w-3.5" /> Seating
      </button>

      <Modal
        open={open}
        title="Seating chart"
        description="Drag a guest onto a chair. Households are kept together automatically."
        onClose={() => setOpen(false)}
        width="max-w-6xl"
        footer={
          <>
            {data ? (
              <span className="mr-auto text-xs text-ink-subtle">
                {data.summary.seated} of {data.summary.attending} attending seated ·{' '}
                {data.summary.spareSeats} seats spare
              </span>
            ) : null}
            <button
              type="button"
              className="btn-secondary"
              disabled={readOnly || autoSeat.isPending || !data?.tables.length}
              onClick={() => autoSeat.mutate(true)}
            >
              {autoSeat.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5" />
              )}
              Fill remaining
            </button>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Close
            </button>
          </>
        }
      >
        {isLoading ? (
          <div className="flex items-center gap-2 py-16 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the layout…
          </div>
        ) : !data?.tables.length ? (
          <p className="py-16 text-center text-sm text-ink-muted">
            No seated tables in this layout yet. Add tables with a seat count and they will appear
            here.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
            {/* ── The chart ───────────────────────────────────────────── */}
            <div>
              {error ? (
                <div className="notice-error mb-2 flex items-start gap-2 text-xs">
                  <span className="flex-1">{error}</span>
                  <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : null}

              {data.summary.issues.length ? (
                <div className="notice-warning mb-2 space-y-0.5 text-xs">
                  {data.summary.issues.map((issue) => (
                    <p key={issue} className="flex items-start gap-1.5">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{issue}</span>
                    </p>
                  ))}
                </div>
              ) : null}

              <div
                className="relative aspect-[4/3] w-full rounded-lg border border-line bg-surface-muted/30"
                data-testid="seating-chart"
              >
                {data.tables.map((table) => {
                  const pos = toPct(table.xMm, table.zMm);
                  const occupants = tableOccupancy.get(table.objectId) ?? [];
                  const over = occupants.length > table.seatCount;
                  const diameterPct = ((table.diameterMm ?? table.widthMm) / spanX) * 100;

                  return (
                    <div
                      key={table.objectId}
                      className="absolute -translate-x-1/2 -translate-y-1/2"
                      style={pos}
                    >
                      {/* The table itself. */}
                      <div
                        className={`flex items-center justify-center border-2 text-[10px] font-semibold ${
                          table.shape === 'round' ? 'rounded-full' : 'rounded'
                        } ${over ? 'border-rose-400 bg-rose-500/15 text-rose-200' : 'border-line bg-surface-strong text-ink'}`}
                        style={{
                          width: `${Math.max(diameterPct * 5, 44)}px`,
                          height: `${Math.max(diameterPct * 5, 44)}px`,
                        }}
                        title={`${table.label} — ${occupants.length}/${table.seatCount}`}
                      >
                        <span className="px-1 text-center leading-tight">
                          {table.label}
                          <br />
                          <span className="text-[9px] font-normal text-ink-subtle">
                            {occupants.length}/{table.seatCount}
                          </span>
                        </span>
                      </div>

                      {/* Chairs, at the same positions the 3D layout uses. */}
                      {table.seats.map((seat) => {
                        const key = `${table.objectId}:${seat.index}`;
                        const guest = seatedBy.get(key);
                        const dx = ((seat.xMm - table.xMm) / spanX) * 100 * 5;
                        const dy = ((seat.zMm - table.zMm) / spanZ) * 100 * 5;

                        return (
                          <button
                            key={seat.index}
                            type="button"
                            className={`absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[8px] font-bold transition ${
                              guest
                                ? 'border-primary bg-primary text-primary-fg'
                                : 'border-line bg-surface-muted text-ink-subtle hover:border-primary'
                            }`}
                            style={{ left: `calc(50% + ${dx}px)`, top: `calc(50% + ${dy}px)` }}
                            title={
                              guest
                                ? `${guest.firstName} ${guest.lastName}${guest.dietary ? ` · ${guest.dietary}` : ''}`
                                : `${table.label}, seat ${seat.index + 1}`
                            }
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (dragging == null || readOnly) return;
                              assign.mutate({
                                guestId: dragging,
                                tableObjectId: table.objectId,
                                seatIndex: seat.index,
                              });
                              setDragging(null);
                            }}
                            onClick={() => {
                              if (guest && !readOnly) unassign.mutate(guest.id);
                            }}
                          >
                            {guest ? guest.firstName.charAt(0) + guest.lastName.charAt(0) : ''}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              <p className="mt-2 text-[11px] text-ink-subtle">
                Drag a name onto a chair to seat them. Click a filled chair to free it.
              </p>
            </div>

            {/* ── Who is not yet seated ───────────────────────────────── */}
            <div className="flex flex-col">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  Not seated
                </h3>
                <span className="text-xs text-ink-muted">{unseated.length}</span>
              </div>

              <input
                className="input mb-2"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <div className="max-h-[52vh] space-y-1 overflow-y-auto pr-1">
                {unseated.length === 0 ? (
                  <p className="py-6 text-center text-xs text-ink-subtle">
                    Everyone attending has a seat.
                  </p>
                ) : (
                  unseated.map((g) => (
                    <div
                      key={g.id}
                      draggable={!readOnly}
                      onDragStart={() => setDragging(g.id)}
                      onDragEnd={() => setDragging(null)}
                      className={`cursor-grab rounded border border-line bg-surface-muted/40 px-2 py-1.5 text-xs transition active:cursor-grabbing ${
                        dragging === g.id ? 'opacity-50' : 'hover:border-primary'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Armchair className="h-3 w-3 shrink-0 text-ink-subtle" />
                        <span className="truncate font-medium text-ink">
                          {g.firstName} {g.lastName}
                        </span>
                      </div>
                      {g.partyName ? (
                        <p className="truncate pl-4.5 text-[10px] text-ink-subtle">{g.partyName}</p>
                      ) : null}
                      {g.dietary || g.accessibility ? (
                        <p className="truncate pl-4.5 text-[10px] text-amber-400/90">
                          {[g.dietary, g.accessibility].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
