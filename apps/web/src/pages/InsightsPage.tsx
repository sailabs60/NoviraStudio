import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calculator, Clock, Info, TrendingUp } from 'lucide-react';
import {
  computeRoi,
  DEFAULT_ROI_INPUTS,
  formatRate,
  MANUAL_HOURS_LABELS,
  roiVerdict,
  type RoiInputs,
  type SavedOutput,
} from '@novira/shared';
import { AppShell } from '../components/AppShell';
import { spatial } from '../lib/spatialApi';
import {
  EmptyState,
  Field,
  Money,
  NumberField,
  RowSkeletons,
  Section,
  Segmented,
  SliderField,
  Stat,
  Tabs,
  TextInput,
} from '../components/ui';

/**
 * Insights.
 *
 * Four questions the brief asks, and a fifth the product can answer that
 * nothing else can: how much time it has actually saved.
 *
 * One rule runs through every table here — **a rate computed from too few
 * proposals is not shown**. Two proposals and one win is not a 50 % conversion
 * rate, and presenting it as one invites a decision the data cannot support. So
 * those cells say how many more are needed instead.
 */
export function InsightsPage() {
  const [tab, setTab] = useState<'performance' | 'roi'>('performance');
  const [days, setDays] = useState(365);

  const { data, isLoading } = useQuery({
    queryKey: ['insights', days],
    queryFn: () => spatial.insights(days),
  });

  return (
    <AppShell>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Insights</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Which layouts you build most, which of them win, what stand sizes pay for themselves — and a model for the
            return on a piece of work before you commit to it.
          </p>
        </div>
        {tab === 'performance' ? (
          <select className="select w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 6 months</option>
            <option value={365}>Last year</option>
            <option value={730}>Last 2 years</option>
          </select>
        ) : null}
      </header>

      <div className="mb-5">
        <Tabs
          tabs={[
            { value: 'performance', label: 'What has worked', icon: <TrendingUp className="h-3 w-3" /> },
            { value: 'roi', label: 'ROI calculator', icon: <Calculator className="h-3 w-3" /> },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'performance' ? (
        isLoading ? (
          <RowSkeletons label="Reading your history" />
        ) : data ? (
          <Performance data={data} />
        ) : null
      ) : (
        <RoiCalculator />
      )}
    </AppShell>
  );
}

/* ── Performance ───────────────────────────────────────────────────────── */

function Performance({ data }: { data: NonNullable<Awaited<ReturnType<typeof spatial.insights>>> }) {
  const { summary, layouts, booths, minimumSample } = data;

  if (summary.totalPlans === 0) {
    return (
      <EmptyState
        icon={<TrendingUp className="h-8 w-8" />}
        title="Nothing to report yet"
        description="Once you have built a few plans and sent a few proposals, this shows which of your layouts win, what they are worth, and how long they take to get out of the door."
      />
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">The period</h2>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Projects" value={summary.totalProjects} />
          <Stat label="Plans" value={summary.totalPlans} />
          <Stat label="Proposals sent" value={summary.proposalsSent} />
          <Stat label="Won" value={summary.proposalsWon} tone={summary.proposalsWon > 0 ? 'good' : 'neutral'} />
          <Stat
            label="Conversion"
            value={summary.conversionBp === null ? '—' : formatRate(summary.conversionBp)}
            help={summary.conversionBp === null ? `Needs at least ${minimumSample} sent proposals to mean anything.` : undefined}
          />
          <Stat label="Won value" value={<Money minor={summary.wonValue} currency={summary.currency} />} />
        </div>
      </section>

      <section className="card">
        <div className="flex items-start gap-3">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">
              About {summary.hoursSaved} hours of work you did not have to do
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Every plan has had its quantities measured automatically, every proposal has had a bill of quantities and a
              dimensioned drawing generated from it, and every render and video was produced rather than commissioned.
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-primary">How that is counted</summary>
              <ul className="mt-1.5 space-y-1 text-xs text-ink-muted">
                {(Object.keys(MANUAL_HOURS_LABELS) as SavedOutput[]).map((key) => (
                  <li key={key} className="flex justify-between gap-3">
                    <span>{MANUAL_HOURS_LABELS[key]}</span>
                    <span className="tabular-nums text-ink-subtle">{data.manualHours[key]} hrs each</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] leading-snug text-ink-subtle">
                These are deliberately conservative estimates of the manual equivalent, stated here rather than buried so
                you can judge the claim rather than take it.
              </p>
            </details>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Layouts</h2>
          <p className="text-xs text-ink-subtle">
            {summary.medianDaysToProposal !== null
              ? `Median ${summary.medianDaysToProposal} days from first plan to proposal sent`
              : ''}
          </p>
        </div>
        {layouts.length ? (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="table-head">
                  <th className="px-3 py-2">Layout</th>
                  <th className="px-3 py-2 text-right">Plans</th>
                  <th className="px-3 py-2 text-right">Won</th>
                  <th className="px-3 py-2 text-right">Conversion</th>
                  <th className="px-3 py-2 text-right">Median value</th>
                </tr>
              </thead>
              <tbody>
                {layouts.map((row) => (
                  <tr key={row.key} className="table-row">
                    <td className="px-3 py-2 font-medium text-ink">{row.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.plans}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.won}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.conversionBp === null ? (
                        <span className="text-ink-subtle" title={`Needs at least ${minimumSample} proposals`}>
                          not enough data
                        </span>
                      ) : (
                        <span className={row.conversionBp >= 3000 ? 'text-success' : ''}>{formatRate(row.conversionBp)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.medianValue === null ? '—' : <Money minor={row.medianValue} currency={row.currency} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No plans in this period.</p>
        )}
        <p className="mt-2 text-xs leading-snug text-ink-subtle">
          <Info className="mr-1 inline h-3 w-3" />A proposal belongs to a project, and a project can hold several plans,
          so an outcome is attributed to every layout family that project contained. It is the honest attribution
          available without asking you to link each proposal to a specific layout.
        </p>
      </section>

      {booths.length ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Stand sizes</h2>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="table-head">
                  <th className="px-3 py-2">Size</th>
                  <th className="px-3 py-2 text-right">Area</th>
                  <th className="px-3 py-2 text-right">Built</th>
                  <th className="px-3 py-2 text-right">Conversion</th>
                  <th className="px-3 py-2 text-right">Value per m²</th>
                </tr>
              </thead>
              <tbody>
                {booths.map((row) => (
                  <tr key={row.sizeLabel} className="table-row">
                    <td className="px-3 py-2 font-medium text-ink">{row.sizeLabel}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.areaSqM} m²</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.plans}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.conversionBp === null ? (
                        <span className="text-ink-subtle">not enough data</span>
                      ) : (
                        formatRate(row.conversionBp)
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.valuePerSqM === null ? '—' : <Money minor={row.valuePerSqM} currency={row.currency} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs leading-snug text-ink-subtle">
            Value per square metre is the number that says whether a bigger stand was worth it. A 6 × 6 that returns less
            per square metre than a 6 × 3 is an argument for the smaller one.
          </p>
        </section>
      ) : null}
    </div>
  );
}

/* ── ROI ───────────────────────────────────────────────────────────────── */

const PRESETS: Array<{ key: string; label: string; note: string; patch: Partial<RoiInputs> }> = [
  {
    key: 'exhibition',
    label: 'Exhibition stand',
    note: 'A trade show with a large audience and a low engagement rate.',
    patch: { audience: 8000, engagementBp: 300, leadRateBp: 2500, closeRateBp: 2000, salesCycleMonths: 6 },
  },
  {
    key: 'conference',
    label: 'Hosted conference',
    note: 'Your own event: a smaller audience, but almost everyone is spoken to.',
    patch: { audience: 400, engagementBp: 6000, leadRateBp: 2000, closeRateBp: 2500, salesCycleMonths: 4 },
  },
  {
    key: 'launch',
    label: 'Product launch',
    note: 'Press and partners. Fewer, larger deals, over a longer cycle.',
    patch: { audience: 200, engagementBp: 8000, leadRateBp: 1500, closeRateBp: 3000, salesCycleMonths: 9 },
  },
];

function RoiCalculator() {
  const [inputs, setInputs] = useState<RoiInputs>(DEFAULT_ROI_INPUTS);
  const result = useMemo(() => computeRoi(inputs), [inputs]);
  const verdict = roiVerdict(result);

  const set = <K extends keyof RoiInputs>(key: K, value: RoiInputs[K]) => setInputs((i) => ({ ...i, [key]: value }));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
      <div>
        <Section title="Start from" description="A shape of event, then change the numbers to your own.">
          <Segmented
            value=""
            columns={1}
            options={PRESETS.map((preset) => ({ value: preset.key, label: preset.label, hint: preset.note }))}
            onChange={(key) => {
              const preset = PRESETS.find((p) => p.key === key);
              if (preset) setInputs((i) => ({ ...i, ...preset.patch }));
            }}
          />
        </Section>

        <Section title="The investment">
          <NumberField
            label="Total cost"
            value={Math.round(inputs.investment / 100)}
            min={0}
            max={100_000_000}
            step={1000}
            suffix={inputs.currency.toUpperCase()}
            showRange={false}
            onChange={(v) => set('investment', v * 100)}
            help="Everything: stand, build, staff, travel, hospitality. Under-counting this is the most common way an ROI model flatters a decision."
          />
          <Field label="Currency">
            <TextInput
              value={inputs.currency.toUpperCase()}
              maxLength={3}
              onChange={(e) => set('currency', e.target.value.toLowerCase())}
            />
          </Field>
        </Section>

        <Section title="The funnel">
          <NumberField
            label="Audience"
            value={inputs.audience}
            min={1}
            max={1_000_000}
            step={50}
            showRange={false}
            onChange={(audience) => set('audience', audience)}
            help="Visitors, attendees or delegates at the event."
          />
          <SliderField
            label="You speak to"
            value={inputs.engagementBp}
            onChange={(v) => set('engagementBp', v)}
            min={0}
            max={10_000}
            step={50}
            format={(v) => `${(v / 100).toFixed(1)}% — ${Math.round((inputs.audience * v) / 10_000)} people`}
          />
          <SliderField
            label="Become a qualified lead"
            value={inputs.leadRateBp}
            onChange={(v) => set('leadRateBp', v)}
            min={0}
            max={10_000}
            step={100}
            format={(v) => `${(v / 100).toFixed(0)}% — ${result.qualifiedLeads} leads`}
          />
          <SliderField
            label="Of those, close"
            value={inputs.closeRateBp}
            onChange={(v) => set('closeRateBp', v)}
            min={0}
            max={10_000}
            step={100}
            format={(v) => `${(v / 100).toFixed(0)}% — ${result.closedDeals} deals`}
          />
        </Section>

        <Section title="The deal">
          <NumberField
            label="Average deal value"
            value={Math.round(inputs.dealValue / 100)}
            min={0}
            max={100_000_000}
            step={500}
            suffix={inputs.currency.toUpperCase()}
            showRange={false}
            onChange={(v) => set('dealValue', v * 100)}
          />
          <SliderField
            label="Gross margin"
            value={inputs.marginBp}
            onChange={(v) => set('marginBp', v)}
            min={0}
            max={10_000}
            step={100}
            format={(v) => `${(v / 100).toFixed(0)}%`}
            help="Profit on the revenue, not the revenue itself. Modelling on revenue is how an event that loses money looks like a success."
          />
          <NumberField
            label="Revenue lands over"
            value={inputs.salesCycleMonths}
            min={1}
            max={48}
            step={1}
            suffix="months"
            onChange={(v) => set('salesCycleMonths', v)}
          />
          <SliderField
            label="Uncertainty"
            value={inputs.uncertaintyBp}
            onChange={(v) => set('uncertaintyBp', v)}
            min={0}
            max={7500}
            step={250}
            format={(v) => `±${(v / 100).toFixed(0)}%`}
            help="How confident you are in these rates. A first event deserves a wide band; the fifth one at the same show does not."
          />
        </Section>
      </div>

      <div>
        <div
          className={`card border-2 ${
            verdict.tone === 'good' ? 'border-success/50' : verdict.tone === 'marginal' ? 'border-warning/50' : 'border-danger/50'
          }`}
        >
          <h2
            className={`text-lg font-bold ${
              verdict.tone === 'good' ? 'text-success' : verdict.tone === 'marginal' ? 'text-warning' : 'text-danger'
            }`}
          >
            {verdict.headline}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{verdict.detail}</p>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Conversations" value={result.conversations.toLocaleString()} />
          <Stat label="Qualified leads" value={result.qualifiedLeads.toLocaleString()} />
          <Stat label="Closed deals" value={result.closedDeals.toLocaleString()} />
          <Stat label="Break-even needs" value={`${result.breakEvenDeals} deals`} help="How many closed deals just cover the investment." />
          <Stat label="Revenue" value={<Money minor={result.revenue} currency={inputs.currency} />} />
          <Stat label="Gross profit" value={<Money minor={result.grossProfit} currency={inputs.currency} />} />
          <Stat
            label="Net return"
            value={<Money minor={result.netReturn} currency={inputs.currency} />}
            tone={result.netReturn > 0 ? 'good' : 'bad'}
          />
          <Stat
            label="ROI"
            value={formatRate(Math.abs(result.roiBp)).replace('%', '%') + (result.roiBp < 0 ? ' loss' : '')}
            tone={result.roiBp >= 10_000 ? 'good' : result.roiBp >= 0 ? 'warn' : 'bad'}
          />
        </div>

        <div className="mt-4 card">
          <h3 className="text-sm font-semibold text-ink">The range</h3>
          <p className="mt-1 text-sm text-ink-muted">
            At ±{(inputs.uncertaintyBp / 100).toFixed(0)} % on the rates, the net return lands between{' '}
            <strong className="text-ink">
              <Money minor={result.range.lowNetReturn} currency={inputs.currency} />
            </strong>{' '}
            and{' '}
            <strong className="text-ink">
              <Money minor={result.range.highNetReturn} currency={inputs.currency} />
            </strong>{' '}
            — an ROI of {formatRate(Math.abs(result.range.lowRoiBp))} to {formatRate(Math.abs(result.range.highRoiBp))}.
          </p>
          {result.costPerLead !== null ? (
            <p className="mt-2 text-sm text-ink-muted">
              That is <Money minor={result.costPerLead} currency={inputs.currency} /> per qualified lead, and{' '}
              <Money minor={result.costPerConversation ?? 0} currency={inputs.currency} /> per conversation. Compare those
              against what a lead costs you through any other channel.
            </p>
          ) : null}
          {result.paybackMonths !== null ? (
            <p className="mt-2 text-sm text-ink-muted">
              Payback in about <strong className="text-ink">{result.paybackMonths} months</strong>.
            </p>
          ) : null}
        </div>

        <div className="mt-4 card">
          <h3 className="text-sm font-semibold text-ink">What this assumes</h3>
          <ul className="mt-1.5 space-y-1 text-sm text-ink-muted">
            {result.assumptions.map((assumption, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-ink-subtle">·</span>
                <span>{assumption}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
