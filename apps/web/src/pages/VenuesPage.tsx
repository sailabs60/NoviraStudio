import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Anchor,
  Boxes,
  Building2,
  Check,
  Layers,
  Plus,
  Search,
  Trash2,
  Upload,
  Truck,
  Zap,
} from 'lucide-react';
import {
  deriveVenueCapacity,
  emptyVenueSpec,
  REGION_PACKS,
  regionForCountry,
  VEHICLE_SPECS,
  VENUE_SPACE_LABELS,
  VENUE_SPACE_TYPES,
  type VenueSpec,
  type VenueSpaceType,
} from '@novira/shared';
import { AppShell } from '../components/AppShell';
import { PageBanner } from '../components/PageBanner';
import { spatial } from '../lib/spatialApi';
import { Modal } from '../components/Modal';
import { VenueImportDialog } from './VenueImportDialog';
import {
  CardSkeletons,
  EmptyState,
  Field,
  FindingCard,
  NumberField,
  Section,
  Segmented,
  Select,
  Stat,
  TextInput,
  Toggle,
  toast,
} from '../components/ui';

/**
 * The venue library.
 *
 * The brief's claim is that with this, an agency does not need a site visit to
 * pitch. That only holds if the record carries what a site visit is actually
 * for — clear height under the beam rather than at the ridge, pillar positions,
 * what the floor takes, how big a truck reaches the door — so the form asks for
 * exactly those, and says why each one matters.
 *
 * The capacity table is derived rather than entered. Venues publish capacity
 * figures computed on an empty rectangle with no columns and no stage; deriving
 * it from the geometry gives the number the room will really take.
 */
export function VenuesPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [spaceType, setSpaceType] = useState<VenueSpaceType | ''>('');
  const [scope, setScope] = useState<'all' | 'mine' | 'company' | 'global'>('all');
  const [editing, setEditing] = useState<VenueSpec | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['venue-specs', query, spaceType, scope],
    queryFn: () =>
      spatial.venues.list({
        q: query || undefined,
        spaceType: spaceType || undefined,
        scope,
        limit: 60,
      }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => spatial.venues.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['venue-specs'] });
      toast('success', 'Venue removed.');
    },
  });

  return (
    <AppShell>
      <PageBanner
        slot="venues-hero"
        title="Venues"
        lead="Record a building once — its clear height, pillars, rigging capacity, power and access — and every plan you make there starts correct. Applying a venue to a plan brings all of it in as checkable geometry."
        actions={
          <>
            {/*
              Two ways in, and the order matters. Most people have a model of
              the building long before they have its rigging capacity to hand,
              and a form of forty fields is where a venue library goes to die —
              so uploading is offered first-class rather than buried in the form.
            */}
            <button type="button" className="btn-secondary" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" /> Upload a building
            </button>
            <button type="button" className="btn-primary" onClick={() => setEditing(emptyVenueSpec())}>
              <Plus className="h-4 w-4" /> Add a venue
            </button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
          <input
            className="input pl-9"
            placeholder="Search by name or city…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search venues"
          />
        </div>
        <select
          className="select w-auto"
          value={spaceType}
          onChange={(e) => setSpaceType(e.target.value as VenueSpaceType | '')}
          aria-label="Space type"
        >
          <option value="">Every kind of space</option>
          {VENUE_SPACE_TYPES.map((type) => (
            <option key={type} value={type}>
              {VENUE_SPACE_LABELS[type]}
            </option>
          ))}
        </select>
        <select className="select w-auto" value={scope} onChange={(e) => setScope(e.target.value as never)} aria-label="Scope">
          <option value="all">Everything I can see</option>
          <option value="mine">Mine</option>
          <option value="company">My company's</option>
          <option value="global">Shared library</option>
        </select>
      </div>

      {isLoading ? (
        <CardSkeletons label="Loading venues" />
      ) : data?.items.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((venue) => (
            <VenueCard
              key={venue.id}
              venue={venue}
              expanded={expanded === venue.id}
              onToggle={() => setExpanded(expanded === venue.id ? null : venue.id!)}
              onEdit={() => setEditing(venue)}
              onDelete={() => remove.mutate(venue.id!)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Building2 className="h-8 w-8" />}
          title="No venues yet"
          description="Add the spaces you work in most. The figures you record here are the ones every plan is then checked against — and they are the questions you would otherwise ring the venue to ask. If you already have a model of the building, upload it and most of them are measured for you."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className="btn-primary" onClick={() => setImporting(true)}>
                <Upload className="h-4 w-4" /> Upload a building
              </button>
              <button type="button" className="btn-secondary" onClick={() => setEditing(emptyVenueSpec())}>
                <Plus className="h-4 w-4" /> Enter one by hand
              </button>
            </div>
          }
        />
      )}

      {editing ? <VenueEditor spec={editing} onClose={() => setEditing(null)} /> : null}
      {importing ? (
        <VenueImportDialog
          onClose={() => setImporting(false)}
          onDone={() => {
            /* The dialog stays open on its report; the list is already refreshed. */
          }}
        />
      ) : null}
    </AppShell>
  );
}

/* ── Card ──────────────────────────────────────────────────────────────── */

function VenueCard({
  venue,
  expanded,
  onToggle,
  onEdit,
  onDelete,
}: {
  venue: VenueSpec & { warnings: string[] };
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const area = (venue.widthMm * venue.depthMm) / 1_000_000;

  return (
    <article className="card flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink">{venue.name}</h2>
          <p className="truncate text-xs text-ink-muted">
            {[venue.buildingName, venue.city, VENUE_SPACE_LABELS[venue.spaceType]].filter(Boolean).join(' · ')}
          </p>
        </div>
        {venue.verified ? <span className="badge-success shrink-0">Verified</span> : null}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-ink-subtle">Footprint</dt>
          <dd className="font-semibold tabular-nums text-ink">
            {(venue.widthMm / 1000).toFixed(1)} × {(venue.depthMm / 1000).toFixed(1)} m
          </dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Area</dt>
          <dd className="font-semibold tabular-nums text-ink">{area.toFixed(0)} m²</dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Clear height</dt>
          <dd className="font-semibold tabular-nums text-ink">{(venue.structure.clearHeightMm / 1000).toFixed(2)} m</dd>
        </div>
        <div>
          <dt className="text-ink-subtle">Rigging</dt>
          <dd className="font-semibold tabular-nums text-ink">
            {venue.structure.riggingAllowed
              ? venue.structure.totalRiggingCapacityKg
                ? `${venue.structure.totalRiggingCapacityKg} kg`
                : 'Allowed'
              : 'Not allowed'}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap gap-1">
        <span className="chip">
          <Truck className="h-3 w-3" /> {VEHICLE_SPECS[venue.access.vehicle].label}
        </span>
        <span className="chip">
          <Zap className="h-3 w-3" /> {venue.services.powerAmps} A
        </span>
        {venue.structure.columns.length ? (
          <span className="chip">
            <AlertTriangle className="h-3 w-3" /> {venue.structure.columns.length} columns
          </span>
        ) : (
          <span className="chip">Clear span</span>
        )}
        {/*
          A record with a building attached is a different proposition from one
          with figures alone — applying it puts you inside the room rather than
          inside a rectangle — so the card says so at a glance.
        */}
        {venue.modelUrl ? (
          <span className="chip chip-active" title="Applying this venue brings the building into the plan">
            <Boxes className="h-3 w-3" /> 3D building
          </span>
        ) : null}
        {venue.floorLevels?.length ? (
          <span className="chip" title="Objects dropped in the plan land on these levels">
            <Layers className="h-3 w-3" /> {venue.floorLevels.length} floor
            {venue.floorLevels.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      <button type="button" onClick={onToggle} className="mt-3 text-left text-xs font-semibold text-primary" aria-expanded={expanded}>
        {expanded ? 'Hide detail' : 'Capacity, rules and warnings'}
      </button>

      {expanded ? (
        <div className="mt-2 space-y-2 border-t border-line pt-2">
          <div className="grid grid-cols-3 gap-1.5">
            <Stat label="Theatre" value={venue.capacity.theatre} />
            <Stat label="Banquet" value={venue.capacity.banquet} />
            <Stat label="Cocktail" value={venue.capacity.cocktail} />
            <Stat label="Cabaret" value={venue.capacity.cabaret} />
            <Stat label="Classroom" value={venue.capacity.classroom} />
            <Stat label="Stands" value={venue.capacity.exhibitionStands} />
          </div>
          <p className="text-[10px] leading-snug text-ink-subtle">
            Derived from the footprint less circulation and the space the columns take, so these are what the room really
            holds rather than what a brochure claims.
          </p>

          {venue.floorLevels?.length ? (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Floors</p>
              <ul className="space-y-1">
                {venue.floorLevels.map((level) => (
                  <li
                    key={level.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-muted px-2 py-1 text-[11px]"
                  >
                    <span className="truncate font-semibold text-ink">
                      {level.name}
                      {level.isDefault ? <span className="ml-1 text-[9px] font-bold text-primary">DEFAULT</span> : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-ink-subtle">
                      {(level.elevationMm / 1000).toFixed(2)} m · {Math.round(level.areaSqM).toLocaleString()} m²
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] leading-snug text-ink-subtle">
                Found by measuring the model, not entered. Anything dropped into the plan settles on the level beneath
                it rather than falling through to zero.
              </p>
            </div>
          ) : null}

          {venue.warnings.length ? (
            <div className="space-y-1.5">
              {venue.warnings.slice(0, 4).map((warning, i) => (
                <FindingCard key={i} severity="warning" title="Before you design" detail={warning} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex gap-1.5 border-t border-line pt-3">
        <button type="button" className="btn-secondary btn-sm flex-1" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="btn-ghost btn-sm text-danger" onClick={onDelete} aria-label={`Delete ${venue.name}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}

/* ── Editor ────────────────────────────────────────────────────────────── */

function VenueEditor({ spec, onClose }: { spec: VenueSpec; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<VenueSpec>(spec);
  const [tab, setTab] = useState<'basics' | 'structure' | 'access' | 'services' | 'rules'>('basics');

  const capacity = useMemo(
    () =>
      deriveVenueCapacity({
        widthMm: draft.widthMm,
        depthMm: draft.depthMm,
        structure: draft.structure,
        regionCode: draft.regionCode,
      }),
    [draft.widthMm, draft.depthMm, draft.structure, draft.regionCode]
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: draft.name,
        buildingName: draft.buildingName,
        spaceType: draft.spaceType,
        city: draft.city,
        country: draft.country,
        regionCode: draft.regionCode,
        widthMm: draft.widthMm,
        depthMm: draft.depthMm,
        structure: draft.structure,
        access: draft.access,
        services: draft.services,
        rules: draft.rules,
        sourceNote: draft.sourceNote,
      };
      return draft.id ? spatial.venues.update(draft.id, body) : spatial.venues.create(body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['venue-specs'] });
      toast('success', draft.id ? 'Venue updated.' : 'Venue added to your library.');
      onClose();
    },
    onError: () => toast('error', 'Could not save the venue. Check the required fields.'),
  });

  const set = <K extends keyof VenueSpec>(key: K, value: VenueSpec[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setStructure = (patch: Partial<VenueSpec['structure']>) =>
    setDraft((d) => ({ ...d, structure: { ...d.structure, ...patch } }));
  const setAccess = (patch: Partial<VenueSpec['access']>) => setDraft((d) => ({ ...d, access: { ...d.access, ...patch } }));
  const setServices = (patch: Partial<VenueSpec['services']>) =>
    setDraft((d) => ({ ...d, services: { ...d.services, ...patch } }));
  const setRules = (patch: Partial<VenueSpec['rules']>) => setDraft((d) => ({ ...d, rules: { ...d.rules, ...patch } }));

  return (
    <Modal
      open
      title={draft.id ? 'Edit venue' : 'Add a venue'}
      description="Every field here is a question you would otherwise ring the venue to ask. Record it once."
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => save.mutate()}
            disabled={save.isPending || !draft.name.trim()}
          >
            {save.isPending ? 'Saving…' : 'Save venue'}
          </button>
        </>
      }
    >
      <Segmented
        value={tab}
        columns={5}
        options={[
          { value: 'basics', label: 'Basics' },
          { value: 'structure', label: 'Structure' },
          { value: 'access', label: 'Access' },
          { value: 'services', label: 'Services' },
          { value: 'rules', label: 'Rules' },
        ]}
        onChange={setTab}
      />

      <div className="max-h-[55vh] overflow-y-auto pr-1">
        {tab === 'basics' ? (
          <>
            <Field label="Space name" hint="What the venue calls this room — “Grand Ballroom”, “Hall 3”.">
              <TextInput value={draft.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Building">
              <TextInput value={draft.buildingName} onChange={(e) => set('buildingName', e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <TextInput value={draft.city} onChange={(e) => set('city', e.target.value)} />
              </Field>
              <Field label="Country" hint="Two-letter code. It sets the market and the rules applied.">
                <TextInput
                  value={draft.country}
                  maxLength={2}
                  onChange={(e) => {
                    const country = e.target.value.toUpperCase();
                    setDraft((d) => ({ ...d, country, regionCode: regionForCountry(country).code }));
                  }}
                />
              </Field>
            </div>
            <Field label="Kind of space">
              <Select value={draft.spaceType} onChange={(e) => set('spaceType', e.target.value as VenueSpaceType)}>
                {VENUE_SPACE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {VENUE_SPACE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Market">
              <Select value={draft.regionCode} onChange={(e) => set('regionCode', e.target.value)}>
                {REGION_PACKS.map((pack) => (
                  <option key={pack.code} value={pack.code}>
                    {pack.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Width"
                value={Math.round(draft.widthMm / 100) / 10}
                min={1}
                max={500}
                step={0.1}
                suffix="m"
                onChange={(v) => set('widthMm', Math.round(v * 1000))}
              />
              <NumberField
                label="Depth"
                value={Math.round(draft.depthMm / 100) / 10}
                min={1}
                max={500}
                step={0.1}
                suffix="m"
                onChange={(v) => set('depthMm', Math.round(v * 1000))}
              />
            </div>

            <div className="mt-2 rounded-lg border border-line bg-surface-muted/40 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Derived capacity</p>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                <Stat label="Theatre" value={capacity.theatre} />
                <Stat label="Banquet" value={capacity.banquet} />
                <Stat label="Cocktail" value={capacity.cocktail} />
              </div>
              <p className="mt-1.5 text-[10px] leading-snug text-ink-subtle">
                Calculated from the footprint, less circulation and the space the columns sterilise. It is usually lower
                than the number the venue publishes, and it is the one that will actually fit.
              </p>
            </div>

            <Field label="Where these figures came from" hint="A survey, the venue's technical pack, a phone call. It matters when someone checks them in a year.">
              <TextInput value={draft.sourceNote} onChange={(e) => set('sourceNote', e.target.value)} />
            </Field>
          </>
        ) : null}

        {tab === 'structure' ? (
          <>
            <NumberField
              label="Clear height"
              value={Math.round(draft.structure.clearHeightMm / 100) / 10}
              min={1}
              max={60}
              step={0.1}
              suffix="m"
              onChange={(v) => setStructure({ clearHeightMm: Math.round(v * 1000) })}
              help="Under the LOWEST obstruction — a beam, a duct, a light. Not the height at the ridge. This is the figure venues quote least accurately and the one everything depends on."
            />
            <NumberField
              label="Height at the highest point"
              value={Math.round(draft.structure.maxHeightMm / 100) / 10}
              min={1}
              max={80}
              step={0.1}
              suffix="m"
              onChange={(v) => setStructure({ maxHeightMm: Math.round(v * 1000) })}
            />
            <Toggle
              label="Rigging permitted"
              checked={draft.structure.riggingAllowed}
              onChange={(riggingAllowed) => setStructure({ riggingAllowed })}
              hint="If not, everything is ground-supported — which means base plates, ballast and floor space."
            />
            {draft.structure.riggingAllowed ? (
              <NumberField
                label="Total rigging capacity"
                value={draft.structure.totalRiggingCapacityKg ?? 0}
                min={0}
                max={100_000}
                step={100}
                suffix="kg"
                onChange={(v) => setStructure({ totalRiggingCapacityKg: v })}
                help="Get this in writing. A verbal figure from a duty manager is not a rigging plan."
              />
            ) : null}
            <NumberField
              label="Floor loading"
              value={draft.structure.floorLoadKgSqM ?? 0}
              min={0}
              max={10_000}
              step={50}
              suffix="kg/m²"
              onChange={(v) => setStructure({ floorLoadKgSqM: v })}
              help="Distributed load. Basements and raised access floors are where this bites."
            />
            <Field label="Floor surface">
              <Select
                value={draft.structure.floorSurface}
                onChange={(e) => setStructure({ floorSurface: e.target.value as never })}
              >
                {['carpet', 'concrete', 'timber', 'tile', 'grass', 'tarmac', 'raised-access'].map((surface) => (
                  <option key={surface} value={surface}>
                    {surface.replace(/-/g, ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <Toggle
              label="Floor is level"
              checked={draft.structure.levelFloor}
              onChange={(levelFloor) => setStructure({ levelFloor })}
              hint="A raked or sloping floor means packing and levelling under every deck."
            />
            <Toggle
              label="Fixings permitted"
              checked={draft.structure.fixingsAllowed}
              onChange={(fixingsAllowed) => setStructure({ fixingsAllowed })}
              hint="Whether anything may be screwed or bolted into the floor or the walls."
            />

            <ColumnEditor
              columns={draft.structure.columns}
              onChange={(columns) => setStructure({ columns })}
              widthMm={draft.widthMm}
              depthMm={draft.depthMm}
            />
          </>
        ) : null}

        {tab === 'access' ? (
          <>
            <Field label="Largest vehicle that reaches the door" help="This decides how many loads the job takes, which is a real line on the quote.">
              <Select value={draft.access.vehicle} onChange={(e) => setAccess({ vehicle: e.target.value as never })}>
                {(Object.keys(VEHICLE_SPECS) as Array<keyof typeof VEHICLE_SPECS>).map((key) => (
                  <option key={key} value={key}>
                    {VEHICLE_SPECS[key].label} — {(VEHICLE_SPECS[key].payloadKg / 1000).toFixed(1)} t payload
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Door width"
                value={Math.round(draft.access.doorWidthMm / 10) / 100}
                min={0.5}
                max={20}
                step={0.05}
                suffix="m"
                onChange={(v) => setAccess({ doorWidthMm: Math.round(v * 1000) })}
              />
              <NumberField
                label="Door height"
                value={Math.round(draft.access.doorHeightMm / 10) / 100}
                min={1}
                max={20}
                step={0.05}
                suffix="m"
                onChange={(v) => setAccess({ doorHeightMm: Math.round(v * 1000) })}
              />
            </div>
            <Toggle
              label="Dock level"
              checked={draft.access.dockLevel}
              onChange={(dockLevel) => setAccess({ dockLevel })}
              hint="Level with the truck bed. Without one you need a tail lift and more crew hours."
            />
            <NumberField
              label="Push distance"
              value={Math.round(draft.access.pushDistanceMm / 1000)}
              min={0}
              max={1000}
              step={5}
              suffix="m"
              onChange={(v) => setAccess({ pushDistanceMm: v * 1000 })}
              help="From where the truck stops to where the build happens. Over about 60 m this is a real labour cost."
            />
            <Toggle
              label="Step-free route"
              checked={draft.access.stepFree}
              onChange={(stepFree) => setAccess({ stepFree })}
            />
            <Field label="Notes" hint="Lift dimensions, one-way systems, permit requirements, anything that catches people out.">
              <TextInput value={draft.access.notes} onChange={(e) => setAccess({ notes: e.target.value })} />
            </Field>
          </>
        ) : null}

        {tab === 'services' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Power available"
                value={draft.services.powerAmps}
                min={0}
                max={5000}
                step={1}
                suffix="A"
                onChange={(powerAmps) => setServices({ powerAmps })}
              />
              <Field label="Phases">
                <Select
                  value={String(draft.services.powerPhases)}
                  onChange={(e) => setServices({ powerPhases: Number(e.target.value) as 1 | 3 })}
                >
                  <option value="1">Single phase</option>
                  <option value="3">Three phase</option>
                </Select>
              </Field>
            </div>
            <Toggle
              label="Generator access"
              checked={draft.services.generatorAccess}
              onChange={(generatorAccess) => setServices({ generatorAccess })}
              hint="Whether a generator can be brought in and parked. It is the answer when the house supply is not enough."
            />
            <Toggle label="Water available" checked={draft.services.waterAvailable} onChange={(waterAvailable) => setServices({ waterAvailable })} />
            <Toggle
              label="House lights can be dimmed"
              checked={draft.services.dimmableHouseLights}
              onChange={(dimmableHouseLights) => setServices({ dimmableHouseLights })}
              hint="If not, any lighting design has to compete with them."
            />
            <Toggle
              label="Haze permitted"
              checked={draft.services.hazeAllowed}
              onChange={(hazeAllowed) => setServices({ hazeAllowed })}
              hint="Beams are invisible without haze. Design around surfaces instead where it is banned."
            />
            <NumberField
              label="Sound limit"
              value={draft.services.soundLimitDb ?? 0}
              min={0}
              max={140}
              step={1}
              suffix="dB"
              onChange={(v) => setServices({ soundLimitDb: v || null })}
              help="Zero means no limit recorded. Confirm before promising a band."
            />
          </>
        ) : null}

        {tab === 'rules' ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Build can start" hint="24-hour time.">
                <TextInput
                  value={draft.rules.buildFrom ?? ''}
                  placeholder="06:00"
                  onChange={(e) => setRules({ buildFrom: e.target.value || null })}
                />
              </Field>
              <Field label="Build must stop">
                <TextInput
                  value={draft.rules.buildCurfew ?? ''}
                  placeholder="23:00"
                  onChange={(e) => setRules({ buildCurfew: e.target.value || null })}
                />
              </Field>
            </div>
            <Field
              label="Exclusive suppliers"
              hint="Trades the venue insists you use theirs for, comma separated. Those lines cannot be competitively quoted."
            >
              <TextInput
                value={draft.rules.exclusiveSuppliers.join(', ')}
                placeholder="Catering, rigging, power"
                onChange={(e) =>
                  setRules({ exclusiveSuppliers: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                }
              />
            </Field>
            <Toggle
              label="External supplier fee"
              checked={draft.rules.externalSupplierFee}
              onChange={(externalSupplierFee) => setRules({ externalSupplierFee })}
              hint="Whether the venue charges for bringing your own contractor in."
            />
            <Toggle label="Naked flame permitted" checked={draft.rules.flameAllowed} onChange={(flameAllowed) => setRules({ flameAllowed })} />
            <Toggle label="Confetti permitted" checked={draft.rules.confettiAllowed} onChange={(confettiAllowed) => setRules({ confettiAllowed })} />
            <Field label="Other rules" hint="One per line.">
              <textarea
                className="ed-field min-h-20 resize-y"
                value={draft.rules.notes.join('\n')}
                onChange={(e) => setRules({ notes: e.target.value.split('\n').filter(Boolean) })}
              />
            </Field>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Column positions.
 *
 * Entered as coordinates from the centre of the room, with a live plan diagram
 * beside them — typing "x = -6000" means nothing without seeing where it lands,
 * and columns are the single thing most likely to be recorded in the wrong
 * place.
 */
function ColumnEditor({
  columns,
  onChange,
  widthMm,
  depthMm,
}: {
  columns: VenueSpec['structure']['columns'];
  onChange: (columns: VenueSpec['structure']['columns']) => void;
  widthMm: number;
  depthMm: number;
}) {
  return (
    <Section
      title={`Columns (${columns.length})`}
      description="Measured from the centre of the room. They break sightlines behind them and cannot carry anything."
      action={
        <button
          type="button"
          className="ed-action"
          onClick={() => onChange([...columns, { xMm: 0, zMm: 0, widthMm: 400, depthMm: 400 }])}
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      }
    >
      {columns.length ? (
        <>
          <svg
            viewBox={`0 0 ${widthMm} ${depthMm}`}
            className="mb-2 h-28 w-full rounded border border-line bg-surface-muted/30"
            preserveAspectRatio="xMidYMid meet"
            aria-label="Column positions"
          >
            <rect x={0} y={0} width={widthMm} height={depthMm} className="fill-none stroke-line" strokeWidth={widthMm / 200} />
            {columns.map((column, i) => (
              <rect
                key={i}
                x={widthMm / 2 + column.xMm - column.widthMm / 2}
                y={depthMm / 2 + column.zMm - column.depthMm / 2}
                width={column.widthMm}
                height={column.depthMm}
                className="fill-danger/70"
              />
            ))}
          </svg>

          <div className="space-y-1.5">
            {columns.map((column, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  type="number"
                  className="ed-field w-full"
                  value={Math.round(column.xMm / 100) / 10}
                  step={0.1}
                  aria-label={`Column ${i + 1} X`}
                  onChange={(e) =>
                    onChange(columns.map((c, j) => (j === i ? { ...c, xMm: Math.round(Number(e.target.value) * 1000) } : c)))
                  }
                />
                <input
                  type="number"
                  className="ed-field w-full"
                  value={Math.round(column.zMm / 100) / 10}
                  step={0.1}
                  aria-label={`Column ${i + 1} Z`}
                  onChange={(e) =>
                    onChange(columns.map((c, j) => (j === i ? { ...c, zMm: Math.round(Number(e.target.value) * 1000) } : c)))
                  }
                />
                <button
                  type="button"
                  className="icon-btn h-8 w-8 shrink-0"
                  aria-label={`Remove column ${i + 1}`}
                  onClick={() => onChange(columns.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <p className="field-hint">X across, Z front to back, in metres from the room's centre.</p>
        </>
      ) : (
        <p className="text-[11px] text-ink-subtle">
          <Check className="mr-1 inline h-3 w-3 text-success" />
          Clear span — nothing in the middle of the room.
        </p>
      )}
    </Section>
  );
}

export { Anchor };
