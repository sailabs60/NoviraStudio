import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  ADVICE_CATEGORIES,
  ADVICE_CATEGORY_INFO,
  CONSTRAINT_INFO,
  regionPack,
  type AdviceCategory,
} from '@novira/shared';
import { useEditor } from '../editorStore';
import { spatial } from '../../lib/spatialApi';
import { EmptyState, FindingCard, Section, Stat, Tabs, Toggle } from '../../components/ui';

/**
 * The design check.
 *
 * Three checks share this panel because a planner asks one question of all
 * three — "is this buildable?" — and answering it across three separate places
 * means two of them never get looked at.
 *
 * The score at the top is deliberately blunt. It is not a measure of design
 * quality and does not pretend to be; it exists so someone can watch a number
 * move while they fix things, which is the difference between a checklist
 * people work through and one they close.
 */
export function CheckPanel() {
  const planId = useEditor((s) => s.planId);
  const objectCount = useEditor((s) => s.scene.objects.length);
  const dirty = useEditor((s) => s.dirty);
  const collisionCheck = useEditor((s) => s.scene.collisionCheck);
  const toggleCollisionCheck = useEditor((s) => s.toggleCollisionCheck);
  const showConstraints = useEditor((s) => s.scene.showConstraints);
  const toggleConstraintsVisible = useEditor((s) => s.toggleConstraintsVisible);
  const regionCode = useEditor((s) => s.scene.regionCode);
  const focusObject = useEditor((s) => s.focusObject);
  const setHighlight = useEditor((s) => s.setHighlight);
  const select = useEditor((s) => s.select);

  const [tab, setTab] = useState<'all' | AdviceCategory>('all');

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['plan-review', planId, objectCount, dirty, collisionCheck],
    queryFn: () => spatial.planReview(planId!),
    enabled: Boolean(planId),
    staleTime: 15_000,
  });

  const region = regionPack(regionCode);

  const advice = useMemo(() => {
    if (!data) return [];
    return tab === 'all' ? data.advisor.advice : data.advisor.advice.filter((a) => a.category === tab);
  }, [data, tab]);

  if (!planId) return null;

  if (isLoading || !data) {
    return (
      <Section title="Checking the plan">
        <p className="text-[11px] text-ink-subtle">Reading the layout and applying the planning rules…</p>
      </Section>
    );
  }

  const { advisor, constraints, collisions } = data;
  const totalIssues = advisor.counts.error + advisor.counts.warning + constraints.errors + constraints.warnings;

  const tabs = [
    { value: 'all' as const, label: 'Everything', count: advisor.advice.length },
    ...ADVICE_CATEGORIES.filter((category) => advisor.advice.some((a) => a.category === category)).map((category) => ({
      value: category,
      label: ADVICE_CATEGORY_INFO[category].label,
      count: advisor.advice.filter((a) => a.category === category).length,
    })),
  ];

  return (
    <>
      <Section
        title="Design score"
        description="Errors cost twelve points, warnings five, suggestions one. It is a nudge, not a grade."
        action={
          <button type="button" className="ed-action" onClick={() => refetch()} disabled={isFetching} aria-label="Re-check">
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        }
      >
        <div className="flex items-center gap-3">
          <div
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 text-lg font-bold tabular-nums ${
              advisor.score >= 85
                ? 'border-success text-success'
                : advisor.score >= 60
                  ? 'border-warning text-warning'
                  : 'border-danger text-danger'
            }`}
          >
            {advisor.score}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-ink">
              {totalIssues === 0
                ? 'Nothing outstanding'
                : `${totalIssues} thing${totalIssues === 1 ? '' : 's'} to look at`}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
              {advisor.counts.error > 0
                ? `${advisor.counts.error} must be fixed before this can be built.`
                : advisor.counts.warning > 0
                  ? 'Nothing blocking, but some things are worth checking.'
                  : 'The layout passes every check that applies.'}
            </p>
            <p className="mt-1 text-[10px] leading-snug text-ink-subtle">
              Rules applied: {region.regulations.authority}.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Site constraints" help="What the venue allows. Add rigging points, supplies, exits and height limits under Site, or apply a venue from the library.">
        <div className="grid grid-cols-2 gap-1.5">
          <Stat
            label="Rigging"
            value={constraints.riggingCapacityKg ? `${constraints.riggingUsedKg} / ${constraints.riggingCapacityKg} kg` : `${constraints.riggingUsedKg} kg`}
            tone={
              constraints.riggingCapacityKg && constraints.riggingUsedKg > constraints.riggingCapacityKg
                ? 'bad'
                : constraints.riggingUsedKg > 0 && !constraints.riggingCapacityKg
                  ? 'warn'
                  : 'good'
            }
            sub={constraints.riggingCapacityKg ? 'used / available' : 'no points marked'}
          />
          <Stat
            label="Power"
            value={constraints.supplyAmps ? `${constraints.demandAmps} / ${constraints.supplyAmps} A` : `${constraints.demandAmps} A`}
            tone={
              constraints.supplyAmps && constraints.demandAmps > constraints.supplyAmps
                ? 'bad'
                : constraints.demandAmps > 0 && !constraints.supplyAmps
                  ? 'warn'
                  : 'good'
            }
            sub={constraints.supplyAmps ? 'demand / supply' : 'no supply marked'}
          />
        </div>

        {constraints.findings.length ? (
          <div className="mt-2 space-y-1.5">
            {constraints.findings.map((finding) => (
              <FindingCard
                key={finding.constraintId + finding.title}
                severity={finding.severity}
                title={finding.title}
                detail={finding.detail}
                rule={CONSTRAINT_INFO[finding.constraintKind].note}
                onShow={
                  finding.objectIds.length
                    ? () => {
                        setHighlight(finding.objectIds);
                        select(finding.objectIds.slice(0, 1));
                      }
                    : undefined
                }
              />
            ))}
          </div>
        ) : (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> Nothing breaches the constraints recorded for this site.
          </p>
        )}

        <div className="mt-2">
          <Toggle
            label="Show the constraint layer"
            checked={showConstraints}
            onChange={toggleConstraintsVisible}
            hint="Draws the height limits, exits and routes over the plan."
          />
        </div>
      </Section>

      <Section title="Layout advice" description="Planning rules applied to the layout as drawn. Each one names the rule so you can check it against your own jurisdiction.">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />

        <div className="mt-2 space-y-1.5">
          {advice.length === 0 ? (
            <EmptyState
              compact
              icon={<ShieldCheck className="h-6 w-6" />}
              title={tab === 'all' ? 'Nothing flagged' : 'Nothing flagged here'}
              description={
                tab === 'all'
                  ? 'Egress, sightlines, screen placement, spacing, flow and access all pass on the layout as drawn.'
                  : `No ${ADVICE_CATEGORY_INFO[tab as AdviceCategory].label.toLowerCase()} issues in this layout.`
              }
            />
          ) : (
            advice.map((item) => (
              <FindingCard
                key={item.id}
                severity={item.severity}
                title={item.title}
                detail={item.detail}
                action={item.action}
                rule={item.rule}
                onShow={
                  item.objectIds.length
                    ? () => {
                        setHighlight(item.objectIds);
                        focusObject(item.objectIds[0]!, 'properties');
                      }
                    : undefined
                }
              />
            ))
          )}
        </div>
      </Section>

      <Section
        title="Collisions"
        help="Two objects occupying the same space. Off by default because a chair tucked under a table is not a mistake and nobody wants to be told about forty of them."
      >
        <Toggle label="Check for overlaps" checked={collisionCheck} onChange={toggleCollisionCheck} />

        {collisionCheck ? (
          collisions.length ? (
            <div className="mt-2 space-y-1.5">
              {collisions.slice(0, 20).map((collision) => (
                <FindingCard
                  key={`${collision.a}-${collision.b}`}
                  severity="warning"
                  title={`${collision.aName} overlaps ${collision.bName}`}
                  detail={`They share ${(collision.overlapMm / 1000).toFixed(2)} m of space at the same height.`}
                  onShow={() => {
                    setHighlight([collision.a, collision.b]);
                    select([collision.a]);
                  }}
                />
              ))}
              {collisions.length > 20 ? (
                <p className="text-[10px] text-ink-subtle">
                  {collisions.length - 20} more, hidden so the list stays usable.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Nothing overlaps.
            </p>
          )
        ) : null}
      </Section>

      <Section title="Local rules" collapsible defaultOpen={false} description={`Applied for ${region.label}. Change the region under Site if you are building elsewhere.`}>
        <dl className="space-y-1.5 text-[11px]">
          <div className="flex justify-between gap-2">
            <dt className="text-ink-subtle">Escape width</dt>
            <dd className="tabular-nums text-ink">{region.regulations.exitWidthPer100Mm} mm per 100 people</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink-subtle">Travel distance</dt>
            <dd className="tabular-nums text-ink">
              {(region.regulations.maxTravelSingleMm / 1000).toFixed(0)}–
              {(region.regulations.maxTravelDualMm / 1000).toFixed(0)} m
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink-subtle">Minimum aisle</dt>
            <dd className="tabular-nums text-ink">{(region.regulations.minAisleMm / 1000).toFixed(1)} m</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-ink-subtle">Stand height limit</dt>
            <dd className="tabular-nums text-ink">{(region.regulations.standHeightLimitMm / 1000).toFixed(1)} m</dd>
          </div>
        </dl>
        <div className="mt-2 space-y-1">
          {region.regulations.notes.map((note, i) => (
            <p key={i} className="text-[10px] leading-snug text-ink-subtle">
              {note}
            </p>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-snug text-ink-subtle">
          This is an automated check against published rules of thumb. It does not replace sign-off by the venue or the
          local authority.
        </p>
      </Section>
    </>
  );
}

/** The compact status pill shown in the editor header. */
export function CheckBadge() {
  const planId = useEditor((s) => s.planId);
  const objectCount = useEditor((s) => s.scene.objects.length);
  const setWorkPanel = useEditor((s) => s.setWorkPanel);

  const { data } = useQuery({
    queryKey: ['check-badge', planId, objectCount],
    queryFn: () => spatial.planReview(planId!),
    enabled: Boolean(planId) && objectCount > 0,
    staleTime: 30_000,
  });

  if (!data) return null;

  const errors = data.advisor.counts.error + data.constraints.errors;
  const warnings = data.advisor.counts.warning + data.constraints.warnings;

  return (
    <button
      type="button"
      onClick={() => setWorkPanel('check')}
      className={`ed-action ${errors ? 'text-danger' : warnings ? 'text-warning' : 'text-success'}`}
      title={
        errors
          ? `${errors} thing${errors === 1 ? '' : 's'} must be fixed before this can be built`
          : warnings
            ? `${warnings} thing${warnings === 1 ? '' : 's'} worth checking`
            : 'The layout passes every check'
      }
    >
      <ShieldCheck className="h-3.5 w-3.5" />
      {errors ? errors : warnings ? warnings : 'OK'}
    </button>
  );
}
