import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, FileSpreadsheet, Info, RefreshCw, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  formatRate,
  TAKEOFF_GROUPS,
  TAKEOFF_GROUP_LABELS,
  TAKEOFF_UNIT_LABELS,
  type TakeoffGroup,
} from '@novira/shared';
import { useEditor } from '../editorStore';
import { spatial } from '../../lib/spatialApi';
import { EmptyState, Field, Money, Section, Segmented, Select, Stat, Toggle, toast } from '../../components/ui';

/**
 * The instant cost estimator.
 *
 * The brief's claim is that this is what makes the product necessary, and the
 * detail that makes it *trustworthy* is the one thing that would be easy to
 * leave out: every line says how it was measured. A planner about to put a
 * number in a tender needs to be able to check it, and "46 m of truss" that
 * cannot be traced back to the drawing is a number they will re-measure by hand
 * anyway — at which point the feature has saved nobody anything.
 *
 * So each row is expandable, and what it expands to is the basis.
 */
export function CostPanel() {
  const planId = useEditor((s) => s.planId);
  const scene = useEditor((s) => s.scene);
  const dirty = useEditor((s) => s.dirty);
  const rateCardId = useEditor((s) => s.scene.rateCardId);
  const setRateCard = useEditor((s) => s.setRateCard);
  const focusObject = useEditor((s) => s.focusObject);

  const [showPrices, setShowPrices] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<TakeoffGroup>>(new Set(TAKEOFF_GROUPS));

  /*
   * Keyed on the object count and the save state rather than the whole scene:
   * re-running the estimate on every pointer move while someone drags a table
   * would hammer the server for a number that has not meaningfully changed.
   * `dirty` brings it back in step as soon as the plan is saved.
   */
  const estimateKey = ['estimate', planId, rateCardId, scene.objects.length, dirty] as const;

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: estimateKey,
    queryFn: () => spatial.estimate(planId!, rateCardId ?? undefined),
    enabled: Boolean(planId),
    staleTime: 15_000,
  });

  const { data: cards } = useQuery({
    queryKey: ['rate-cards'],
    queryFn: () => spatial.rateCards.list(),
    staleTime: 300_000,
  });

  const grouped = useMemo(() => {
    if (!data) return [];
    return TAKEOFF_GROUPS.map((group) => ({
      group,
      label: TAKEOFF_GROUP_LABELS[group],
      lines: data.priced.lines.filter((l) => l.group === group),
      amount: data.priced.byGroup.find((g) => g.group === group)?.amount ?? 0,
    })).filter((g) => g.lines.length > 0);
  }, [data]);

  if (!planId) return null;

  if (isLoading) {
    return (
      <Section title="Measuring the plan">
        <p className="text-[11px] text-ink-subtle">Reading the geometry and pricing it…</p>
      </Section>
    );
  }

  if (error || !data) {
    return (
      <Section title="Cost estimate">
        <EmptyState
          compact
          title="Could not measure this plan"
          description="Save the plan and try again. If it keeps failing, the estimate is derived on the server and the error will be in its log."
          action={
            <button type="button" className="ed-action border border-line" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
          }
        />
      </Section>
    );
  }

  const { summary, priced } = data;
  const isEmpty = priced.lines.length === 0;

  return (
    <>
      <Section
        title="The headline figures"
        description="Measured from the drawing, not estimated. Change the plan and these change with it."
        action={
          <button type="button" className="ed-action" onClick={() => refetch()} disabled={isFetching} aria-label="Recalculate">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        }
      >
        {isEmpty ? (
          <EmptyState
            compact
            title="Nothing to measure yet"
            description="Add truss, screens, staging, stands or furniture and the quantities appear here as you build."
          />
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="LED" value={`${summary.ledSqM} m²`} help="Square metres of screen. This is what LED is hired by." />
            <Stat label="Truss" value={`${summary.trussLengthM} m`} help="Path length of every run, including the uprights." />
            <Stat label="Carpet" value={`${summary.carpetSqM} m²`} help="Venue floor less what stands and staging sit on." />
            <Stat label="Print" value={`${summary.printSqM} m²`} help="Only surfaces that are actually printable." />
            <Stat label="Structure" value={`${summary.structureVolumeCuM} m³`} help="Enclosed volume, used to estimate freight." />
            <Stat label="Labour" value={`${summary.labourHours} hrs`} help="Crew-hours across every trade, build and de-rig." />
          </div>
        )}
      </Section>

      {!isEmpty ? (
        <>
          <Section title="Supporting figures" collapsible defaultOpen={false}>
            <div className="grid grid-cols-2 gap-1.5">
              <Stat label="Total weight" value={`${summary.totalWeightKg} kg`} />
              <Stat label="Flown" value={`${summary.flownWeightKg} kg`} tone={summary.flownWeightKg > 0 ? 'warn' : 'neutral'} />
              <Stat label="Power" value={`${summary.powerKw} kW`} sub={`${summary.peakAmps} A peak`} />
              <Stat label="Transport" value={`${summary.truckLoads} load${summary.truckLoads === 1 ? '' : 's'}`} />
              <Stat label="Seats" value={summary.seatCount} />
              <Stat label="Stands" value={summary.boothCount} />
            </div>
          </Section>

          <Section
            title="Pricing"
            help="Quantities come from the drawing; prices come from a rate card. Two agencies pricing the same drawing get different quotes, and that is correct."
          >
            <Field label="Rate card">
              <Select
                value={rateCardId ?? ''}
                onChange={(e) => setRateCard(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">{priced.cardName} (automatic)</option>
                {(cards?.items ?? []).map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.name} · {card.currency.toUpperCase()}
                    {card.isDefault ? ' · default' : ''}
                  </option>
                ))}
              </Select>
            </Field>

            {data.card.id === null ? (
              <div className="notice-info mb-2 text-[11px] leading-snug">
                <Info className="mr-1 inline h-3 w-3" />
                These are Novira's default rates
                {data.card.adjustmentBp !== 0
                  ? `, adjusted ${data.card.adjustmentBp > 0 ? 'up' : 'down'} ${formatRate(Math.abs(data.card.adjustmentBp))} for ${data.region.label}`
                  : ''}
                . They are a starting point, not local pricing —{' '}
                <Link to="/rate-cards" className="font-semibold underline underline-offset-2">
                  enter your own
                </Link>{' '}
                and every estimate after this uses them.
              </div>
            ) : null}

            <Toggle
              label="Show prices"
              checked={showPrices}
              onChange={setShowPrices}
              hint="Turn prices off to hand the quantities to a production team without the commercials."
            />

            {showPrices ? (
              <div className="mt-1 space-y-1.5">
                {priced.byGroup.map((group) => (
                  <div key={group.group} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="min-w-0 flex-1 truncate text-ink-muted">{group.label}</span>
                    <Money minor={group.amount} currency={priced.currency} className="shrink-0 font-semibold text-ink" />
                  </div>
                ))}
                <div className="mt-1.5 flex items-baseline justify-between gap-2 border-t border-line pt-1.5">
                  <span className="text-xs font-bold text-ink">Total</span>
                  <Money minor={priced.subtotal} currency={priced.currency} className="text-sm font-bold text-ink" />
                </div>
                {priced.marginBp !== null ? (
                  <p className="text-[10px] text-ink-subtle">
                    Margin {formatRate(priced.marginBp)} on a cost of{' '}
                    <Money minor={priced.cost} currency={priced.currency} />. Never shown to a client.
                  </p>
                ) : null}
              </div>
            ) : null}

            {priced.unpriced.length ? (
              <p className="field-hint mt-2 text-warning">
                {priced.unpriced.length} line{priced.unpriced.length === 1 ? '' : 's'} had no rate and used an indicative
                one. They are marked below.
              </p>
            ) : null}
          </Section>

          <Section
            title="Every line"
            description="Click any row to see exactly how the quantity was measured."
            action={
              <div className="flex gap-1">
                <button
                  type="button"
                  className="ed-action"
                  onClick={() => {
                    void spatial
                      .downloadBoq(planId, { prices: String(showPrices), ...(rateCardId ? { rateCardId: String(rateCardId) } : {}) })
                      .then(() => toast('success', 'Bill of quantities downloaded.'))
                      .catch(() => toast('error', 'Could not export the bill of quantities.'));
                  }}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
                </button>
              </div>
            }
          >
            <div className="space-y-2">
              {grouped.map((group) => {
                const open = openGroups.has(group.group);
                return (
                  <div key={group.group}>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenGroups((current) => {
                          const next = new Set(current);
                          if (next.has(group.group)) next.delete(group.group);
                          else next.add(group.group);
                          return next;
                        })
                      }
                      className="flex w-full items-baseline justify-between gap-2 border-b border-line pb-1 text-left"
                      aria-expanded={open}
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">{group.label}</span>
                      {showPrices ? (
                        <Money minor={group.amount} currency={priced.currency} className="text-[11px] font-semibold text-ink-muted" />
                      ) : (
                        <span className="text-[10px] text-ink-subtle">{group.lines.length}</span>
                      )}
                    </button>

                    {open
                      ? group.lines.map((line) => (
                          <div key={line.code} className="border-b border-line/40 py-1.5">
                            <button
                              type="button"
                              onClick={() => setExpanded(expanded === line.code ? null : line.code)}
                              className="flex w-full items-baseline gap-2 text-left"
                              aria-expanded={expanded === line.code}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[11px] text-ink">{line.description}</span>
                                <span className="block text-[10px] tabular-nums text-ink-subtle">
                                  {(line.quantityMilli / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                                  {TAKEOFF_UNIT_LABELS[line.unit]}
                                  {line.wastageBp ? ` · incl. ${formatRate(line.wastageBp)} waste` : ''}
                                  {line.estimated ? ' · indicative rate' : ''}
                                </span>
                              </span>
                              {showPrices ? (
                                <Money minor={line.amount} currency={priced.currency} className="shrink-0 text-[11px] font-semibold text-ink" />
                              ) : null}
                            </button>

                            {expanded === line.code ? (
                              <div className="mt-1.5 rounded-md border border-line bg-surface-muted/40 px-2 py-1.5">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">
                                  How this was measured
                                </p>
                                <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{line.basis}</p>
                                {showPrices ? (
                                  <p className="mt-1 text-[10px] text-ink-subtle">
                                    <Money minor={line.unitPrice} currency={priced.currency} /> per{' '}
                                    {TAKEOFF_UNIT_LABELS[line.unit]}
                                    {line.estimated ? ' — no rate on the card, so a unit default was used' : ''}
                                  </p>
                                ) : null}
                                {line.objectIds.length ? (
                                  <button
                                    type="button"
                                    className="ed-action mt-1 px-1.5 py-0.5 text-[10px]"
                                    onClick={() => focusObject(line.objectIds[0]!, 'properties')}
                                  >
                                    Show me in the plan
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ))
                      : null}
                  </div>
                );
              })}
            </div>
          </Section>
        </>
      ) : null}

      {data.notes.length ? (
        <Section title="Worth knowing">
          <div className="space-y-1.5">
            {data.notes.map((note, i) => (
              <p key={i} className="notice-warning text-[11px] leading-snug">
                {note}
              </p>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Take it further">
        <div className="space-y-1">
          <Link to="/rate-cards" className="ed-action w-full justify-start border border-line">
            <Settings2 className="h-3.5 w-3.5" /> Edit your rates
          </Link>
          <button
            type="button"
            className="ed-action w-full justify-start border border-line"
            onClick={() => {
              void spatial
                .downloadBoq(planId, { format: 'csv', prices: 'true' })
                .then(() => toast('success', 'Priced bill of quantities downloaded.'))
                .catch(() => toast('error', 'Could not export.'));
            }}
          >
            <Download className="h-3.5 w-3.5" /> Download the priced BOQ
          </button>
          <Link to={`/projects`} className="ed-action w-full justify-start border border-line">
            <ExternalLink className="h-3.5 w-3.5" /> Turn this into a client proposal
          </Link>
        </div>
        <p className="field-hint">
          The proposal builder starts from these lines. Labour, fees and anything you write by hand survive a
          regeneration.
        </p>
      </Section>
    </>
  );
}

/** Compact cost readout for the editor header. */
export function CostBadge() {
  const planId = useEditor((s) => s.planId);
  const objectCount = useEditor((s) => s.scene.objects.length);
  const setWorkPanel = useEditor((s) => s.setWorkPanel);

  const { data } = useQuery({
    queryKey: ['estimate-badge', planId, objectCount],
    queryFn: () => spatial.estimate(planId!),
    enabled: Boolean(planId) && objectCount > 0,
    staleTime: 30_000,
  });

  if (!data || data.priced.subtotal === 0) return null;

  return (
    <button
      type="button"
      onClick={() => setWorkPanel('cost')}
      className="ed-action"
      title="Estimated cost of this plan. Click for the full breakdown."
    >
      <Money minor={data.priced.subtotal} currency={data.priced.currency} className="font-semibold" />
    </button>
  );
}

export { Segmented };
