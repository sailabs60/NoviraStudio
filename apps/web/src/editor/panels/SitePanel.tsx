import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Building2, Check, MapPin, Search, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  CONSTRAINT_INFO,
  CONSTRAINT_KINDS,
  REGION_PACKS,
  VEHICLE_SPECS,
  VENUE_SPACE_LABELS,
  type ConstraintKind,
  type ConstraintSceneObject,
} from '@novira/shared';
import { useEditor } from '../editorStore';
import { VenuePanel } from '../VenuePanel';
import { spatial } from '../../lib/spatialApi';
import {
  ColorField,
  EmptyState,
  Field,
  FindingCard,
  LengthField,
  NumberField,
  Section,
  Select,
  Stat,
  TextInput,
  Toggle,
  toast,
} from '../../components/ui';

/**
 * The site layer.
 *
 * Everything about the building rather than about the design: what it will
 * carry, where power lands, where the exits are, how big a truck can reach it.
 *
 * The fastest way to get all of that right is not to type it in — it is to pick
 * the venue, which is why the library sits at the top of the panel and the
 * drawing tools sit underneath. Applying a venue is one click and brings the
 * height limit, the pillars, the rigging capacity, the supplies and the truck
 * route in as real, checkable geometry.
 */
export function SitePanel() {
  const planId = useEditor((s) => s.planId);
  const objects = useEditor((s) => s.scene.objects);
  const units = useEditor((s) => s.scene.units);
  const regionCode = useEditor((s) => s.scene.regionCode);
  const setRegion = useEditor((s) => s.setRegion);
  const constraintKind = useEditor((s) => s.constraintKind);
  const setConstraintKind = useEditor((s) => s.setConstraintKind);
  const setTool = useEditor((s) => s.setTool);
  const tool = useEditor((s) => s.tool);
  const showConstraints = useEditor((s) => s.scene.showConstraints);
  const toggleConstraintsVisible = useEditor((s) => s.toggleConstraintsVisible);
  const selectedId = useEditor((s) => s.selectedIds[0]);
  const updateObject = useEditor((s) => s.updateObject);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const focusObject = useEditor((s) => s.focusObject);
  const replaceScene = useEditor((s) => s.replaceScene);
  const readOnly = useEditor((s) => s.readOnly);
  const requestFrameAll = useEditor((s) => s.requestFrameAll);

  const queryClient = useQueryClient();
  const [venueQuery, setVenueQuery] = useState('');
  const [applying, setApplying] = useState<number | null>(null);
  const [venueWarnings, setVenueWarnings] = useState<string[]>([]);

  const constraints = objects.filter((o): o is ConstraintSceneObject => o.type === 'constraint');
  const selected = constraints.find((c) => c.id === selectedId);

  const { data: venues } = useQuery({
    queryKey: ['venue-specs', venueQuery],
    queryFn: () => spatial.venues.list({ q: venueQuery || undefined, limit: 12 }),
    staleTime: 60_000,
  });

  const applyVenue = async (venueId: number) => {
    if (!planId) return;
    setApplying(venueId);
    try {
      const result = await spatial.venues.applyToPlan(venueId, planId);
      replaceScene(result.scene);
      setVenueWarnings(result.warnings);
      void queryClient.invalidateQueries({ queryKey: ['plan-review'] });
      toast(
        'success',
        result.venue.modelUrl
          ? `${result.venue.name} is in the plan — the building, plus ${result.applied} constraints. It may take a moment to load.`
          : `${result.venue.name}: ${result.applied} constraints applied to this plan.`
      );
      // A building is much larger than whatever the camera was framing, so
      // show the room rather than leaving the view inside a wall.
      if (result.venue.modelUrl) requestFrameAll();
    } catch {
      toast('error', 'Could not apply that venue. Check that the plan is saved and try again.');
    } finally {
      setApplying(null);
    }
  };

  return (
    <>
      <Section
        title="The venue"
        description="Pick the building and its limits arrive in the plan — height, pillars, rigging capacity, supplies and the truck route."
        action={
          <Link to="/venues" className="ed-action" title="Open the venue library">
            <Building2 className="h-3.5 w-3.5" />
          </Link>
        }
      >
        <Field label="Find a venue" htmlFor="venue-search">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
            <TextInput
              id="venue-search"
              className="pl-7"
              placeholder="Name or city…"
              value={venueQuery}
              onChange={(e) => setVenueQuery(e.target.value)}
            />
          </div>
        </Field>

        {venues?.items.length ? (
          <div className="space-y-1">
            {venues.items.slice(0, 6).map((venue) => (
              <div key={venue.id} className="overflow-hidden rounded-lg border border-line bg-surface-muted/40">
                {/*
                  The photograph of the room.
                  
                  A venue is a place, and a place is recognised by looking at
                  it — a list of names and dimensions makes every ballroom in a
                  hotel look identical, which is exactly the case where someone
                  has to choose between them. Only drawn when there is one, so
                  a record without a photo is a compact row rather than a card
                  with a grey hole in it.
                */}
                {venue.previewUrl ? (
                  <img
                    src={venue.previewUrl}
                    alt=""
                    loading="lazy"
                    className="h-24 w-full border-b border-line object-cover"
                  />
                ) : null}
                <div className="p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-ink">{venue.name}</p>
                    <p className="truncate text-[10px] text-ink-subtle">
                      {[venue.buildingName, venue.city, VENUE_SPACE_LABELS[venue.spaceType]].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {venue.verified ? <span className="badge-success shrink-0">Verified</span> : null}
                </div>
                <p className="mt-1 text-[10px] tabular-nums text-ink-muted">
                  {(venue.widthMm / 1000).toFixed(0)} × {(venue.depthMm / 1000).toFixed(0)} m ·{' '}
                  {(venue.structure.clearHeightMm / 1000).toFixed(1)} m clear · {venue.capacity.banquet} banquet
                </p>
                {venue.modelUrl ? (
                  <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-primary">
                    <Boxes className="h-3 w-3" />
                    Brings the building in
                    {venue.floorLevels?.length
                      ? ` · ${venue.floorLevels.length} floor${venue.floorLevels.length === 1 ? '' : 's'}`
                      : ''}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="ed-action-primary mt-1.5 w-full justify-center"
                  disabled={readOnly || applying === venue.id}
                  onClick={() => void applyVenue(venue.id!)}
                >
                  {applying === venue.id ? 'Applying…' : 'Use this venue'}
                </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            compact
            icon={<MapPin className="h-5 w-5" />}
            title={venueQuery ? 'No venues match' : 'No venues in your library yet'}
            description={
              venueQuery
                ? 'Try a different name or city, or add the venue to your library with the figures you have.'
                : 'Record a venue once — its height, pillars, loading and rules — and every future plan there starts correct.'
            }
            action={
              <Link to="/venues" className="ed-action border border-line">
                Open the venue library
              </Link>
            }
          />
        )}

        {venueWarnings.length ? (
          <div className="mt-2 space-y-1.5">
            {venueWarnings.map((warning, i) => (
              <FindingCard key={i} severity="warning" title="Before you design" detail={warning} />
            ))}
          </div>
        ) : null}
      </Section>

      <Section
        title="Or generate one"
        description="No record for the space yet? Generate a building shell to the dimensions you have — walls, openings, roof and columns — and lay out inside it."
      >
        <VenuePanel />
      </Section>

      <Section
        title="Market"
        help="Decides which truss sections are offered, which materials are locally available, and which safety rules the check applies."
      >
        <Field label="This plan is built in">
          <Select value={regionCode} onChange={(e) => setRegion(e.target.value)}>
            {REGION_PACKS.map((pack) => (
              <option key={pack.code} value={pack.code}>
                {pack.label}
              </option>
            ))}
          </Select>
        </Field>
        <p className="field-hint">
          {REGION_PACKS.find((p) => p.code === regionCode)?.regulations.authority}. Power at{' '}
          {REGION_PACKS.find((p) => p.code === regionCode)?.voltage} V.
        </p>
      </Section>

      <Section
        title="Draw a constraint"
        description="Click points on the floor to mark an area. Rigging points and supplies are a single click."
      >
        <div className="space-y-1">
          {CONSTRAINT_KINDS.map((kind) => {
            const info = CONSTRAINT_INFO[kind];
            const active = tool === 'constraint' && constraintKind === kind;
            return (
              <button
                key={kind}
                type="button"
                disabled={readOnly}
                onClick={() => {
                  setConstraintKind(kind as ConstraintKind);
                  setTool(active ? 'select' : 'constraint');
                }}
                className={`flex w-full items-start gap-2 rounded-lg border p-2 text-left transition disabled:opacity-40 ${
                  active ? 'border-primary bg-primary/10' : 'border-line bg-surface-muted/40 hover:border-line-strong'
                }`}
              >
                <span className="mt-0.5 h-3 w-3 shrink-0 rounded-sm" style={{ background: info.color }} />
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold text-ink">
                    {info.label}
                    <span className="ml-1.5 font-normal text-ink-subtle">
                      {info.geometry === 'point' ? 'one click' : 'draw an area'}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-ink-subtle">{info.note}</span>
                </span>
              </button>
            );
          })}
        </div>

        {tool === 'constraint' ? (
          <p className="notice-info mt-2 text-[11px] leading-snug">
            Click on the floor to place points.{' '}
            {CONSTRAINT_INFO[constraintKind].geometry === 'point'
              ? 'One click places it.'
              : 'Click the first point again to close the area, or press Escape to cancel.'}
          </p>
        ) : null}

        <div className="mt-2">
          <Toggle label="Show the layer" checked={showConstraints} onChange={toggleConstraintsVisible} />
        </div>
      </Section>

      <Section title={`On this site (${constraints.length})`}>
        {constraints.length === 0 ? (
          <p className="text-[11px] leading-snug text-ink-subtle">
            Nothing recorded yet. Without at least the exits and the height limit, the safety check has nothing to check
            against.
          </p>
        ) : (
          <div className="space-y-1">
            {constraints.map((constraint) => {
              const info = CONSTRAINT_INFO[constraint.constraintKind];
              return (
                <button
                  key={constraint.id}
                  type="button"
                  onClick={() => focusObject(constraint.id, 'site')}
                  className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition ${
                    constraint.id === selectedId
                      ? 'border-primary/60 bg-primary/10'
                      : 'border-transparent hover:bg-surface-muted/50'
                  }`}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: constraint.color || info.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-ink">{constraint.label}</span>
                    <span className="block truncate text-[10px] text-ink-subtle">{info.label}</span>
                  </span>
                  {constraint.locked ? <span className="badge-neutral shrink-0">From venue</span> : null}
                </button>
              );
            })}
          </div>
        )}
      </Section>

      {selected ? (
        <Section
          title="Selected constraint"
          action={
            selected.locked ? null : (
              <button type="button" className="ed-action text-danger" onClick={deleteSelected} aria-label="Delete">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )
          }
        >
          {selected.locked ? (
            <p className="notice-neutral mb-2 text-[11px] leading-snug">
              This came from the venue record and is locked — it describes the building, not the design. Edit it in the
              venue library if it is wrong.
            </p>
          ) : null}

          <Field label="Label">
            <TextInput
              value={selected.label}
              disabled={selected.locked}
              onChange={(e) => updateObject(selected.id, { label: e.target.value, name: e.target.value } as never)}
            />
          </Field>

          {selected.constraintKind === 'height-limit' ? (
            <LengthField
              label="Maximum height"
              valueMm={selected.heightLimitMm ?? 4000}
              units={units}
              minMm={500}
              maxMm={40_000}
              disabled={selected.locked}
              onChange={(heightLimitMm) => updateObject(selected.id, { heightLimitMm } as never)}
              help="Nothing may be built taller than this inside the area. Measured from the floor."
            />
          ) : null}

          {selected.constraintKind === 'rigging-point' ? (
            <>
              <NumberField
                label="Safe working load"
                value={selected.swlKg ?? 500}
                min={0}
                max={50_000}
                step={50}
                suffix="kg"
                disabled={selected.locked}
                onChange={(swlKg) => updateObject(selected.id, { swlKg } as never)}
                help="What this point is rated to carry. Get it from the venue in writing, not from a phone call."
              />
              <LengthField
                label="Height"
                valueMm={selected.rigHeightMm ?? 7000}
                units={units}
                minMm={2000}
                maxMm={40_000}
                disabled={selected.locked}
                onChange={(rigHeightMm) => updateObject(selected.id, { rigHeightMm } as never)}
              />
            </>
          ) : null}

          {selected.constraintKind === 'power' ? (
            <>
              <NumberField
                label="Current"
                value={selected.amps ?? 63}
                min={0}
                max={2000}
                step={1}
                suffix="A"
                disabled={selected.locked}
                onChange={(amps) => updateObject(selected.id, { amps } as never)}
              />
              <Field label="Phases">
                <Select
                  value={String(selected.phases ?? 3)}
                  disabled={selected.locked}
                  onChange={(e) => updateObject(selected.id, { phases: Number(e.target.value) as 1 | 3 } as never)}
                >
                  <option value="1">Single phase</option>
                  <option value="3">Three phase</option>
                </Select>
              </Field>
            </>
          ) : null}

          {selected.constraintKind === 'exit' ? (
            <LengthField
              label="Clear width"
              valueMm={selected.clearWidthMm ?? 1800}
              units={units}
              minMm={600}
              maxMm={10_000}
              disabled={selected.locked}
              onChange={(clearWidthMm) => updateObject(selected.id, { clearWidthMm } as never)}
              help="The narrowest point of the escape route, not the doorway's overall width."
            />
          ) : null}

          {selected.constraintKind === 'load-limit' ? (
            <NumberField
              label="Floor loading"
              value={selected.floorLoadKgSqM ?? 500}
              min={0}
              max={20_000}
              step={50}
              suffix="kg/m²"
              disabled={selected.locked}
              onChange={(floorLoadKgSqM) => updateObject(selected.id, { floorLoadKgSqM } as never)}
            />
          ) : null}

          {selected.constraintKind === 'truck-access' ? (
            <>
              <Field label="Largest vehicle">
                <Select
                  value={selected.vehicle ?? 'rigid'}
                  disabled={selected.locked}
                  onChange={(e) => updateObject(selected.id, { vehicle: e.target.value as never } as never)}
                >
                  {(Object.keys(VEHICLE_SPECS) as Array<keyof typeof VEHICLE_SPECS>).map((key) => (
                    <option key={key} value={key}>
                      {VEHICLE_SPECS[key].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-1.5">
                <Stat
                  label="Needs"
                  value={`${(VEHICLE_SPECS[selected.vehicle ?? 'rigid'].widthMm / 1000).toFixed(1)} m wide`}
                />
                <Stat
                  label="Headroom"
                  value={`${(VEHICLE_SPECS[selected.vehicle ?? 'rigid'].heightMm / 1000).toFixed(1)} m`}
                />
              </div>
            </>
          ) : null}

          <Field label="Note" hint="Printed on the technical drawing.">
            <TextInput
              value={selected.note ?? ''}
              disabled={selected.locked}
              onChange={(e) => updateObject(selected.id, { note: e.target.value } as never)}
            />
          </Field>

          {!selected.locked ? (
            <ColorField
              label="Colour"
              value={selected.color}
              onChange={(color) => updateObject(selected.id, { color } as never)}
            />
          ) : null}

          <Toggle
            label="Draw the volume"
            checked={Boolean(selected.showVolume)}
            disabled={selected.locked}
            onChange={(showVolume) => updateObject(selected.id, { showVolume } as never)}
            hint="Shows the ceiling plane of a height limit when it is selected. A line on the floor does not say 'nothing above 4 m here'."
          />
        </Section>
      ) : null}

      {constraints.length > 0 ? (
        <Section title="">
          <p className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
            <Check className="h-3.5 w-3.5 text-success" />
            The Check panel tests every object against these.
          </p>
        </Section>
      ) : null}
    </>
  );
}
