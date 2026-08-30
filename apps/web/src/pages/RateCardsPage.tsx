import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Plus, Receipt, Search, Star, Trash2, Wand2 } from 'lucide-react';
import {
  formatRate,
  REGION_PACKS,
  TAKEOFF_GROUPS,
  TAKEOFF_GROUP_LABELS,
  TAKEOFF_UNIT_LABELS,
  type RateLine,
  type TakeoffGroup,
  type TakeoffUnit,
} from '@novira/shared';
import { AppShell } from '../components/AppShell';
import { spatial, type RateCardDto } from '../lib/spatialApi';
import { Modal } from '../components/Modal';
import {
  CardSkeletons,
  EmptyState,
  Field,
  Money,
  NumberField,
  Select,
  SliderField,
  TextInput,
  Toggle,
  toast,
} from '../components/ui';

/**
 * Rate cards.
 *
 * The measurement engine says what is in a design; this says what it costs, and
 * the two are deliberately separate so the same drawing priced in Nairobi and
 * in Dubai gives two different quotes without either touching the geometry.
 *
 * The page is built around one idea: an agency's rates are the most valuable
 * thing they own and the most tedious thing to type in. So it starts from a
 * complete working card, shows the margin on every line, and lets a whole card
 * be shifted by a percentage — which is how most agencies actually adjust
 * pricing year to year.
 */
export function RateCardsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RateCardDto | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['rate-cards'], queryFn: () => spatial.rateCards.list() });

  const seed = useMutation({
    mutationFn: (regionCode: string) => spatial.rateCards.fromDefaults({ regionCode }),
    onSuccess: (card) => {
      void queryClient.invalidateQueries({ queryKey: ['rate-cards'] });
      setEditing(card);
      toast('success', 'Card created from the built-in rates. Every line is yours to change.');
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => spatial.rateCards.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rate-cards'] });
      toast('success', 'Rate card deleted.');
    },
  });

  const duplicate = useMutation({
    mutationFn: (card: RateCardDto) => spatial.rateCards.duplicate(card.id, { name: `${card.name} (copy)` }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rate-cards'] });
      toast('success', 'Duplicated.');
    },
  });

  const setDefault = useMutation({
    mutationFn: (id: number) => spatial.rateCards.update(id, { isDefault: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rate-cards'] });
      toast('success', 'That card now prices every plan by default.');
    },
  });

  return (
    <AppShell>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Your rates</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            The cost database every estimate is priced against. Quantities are measured from the drawing; these decide
            what they are worth — which is why two agencies pricing the same design should get different numbers.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            className="select w-auto"
            defaultValue=""
            aria-label="Create from defaults for a region"
            onChange={(e) => {
              if (e.target.value) {
                seed.mutate(e.target.value);
                e.target.value = '';
              }
            }}
          >
            <option value="">Start from defaults…</option>
            {REGION_PACKS.map((pack) => (
              <option key={pack.code} value={pack.code}>
                {pack.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary"
            onClick={() =>
              setEditing({
                id: 0,
                name: '',
                currency: 'usd',
                regionCode: 'global',
                adjustmentBp: 0,
                crewRate: 4500,
                lines: data?.defaultLines ?? [],
                labourOverrides: null,
                isDefault: false,
                scope: 'personal',
                updatedAt: new Date().toISOString(),
              })
            }
          >
            <Plus className="h-4 w-4" /> New card
          </button>
        </div>
      </header>

      {isLoading ? (
        <CardSkeletons label="Loading rate cards" />
      ) : data?.items.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((card) => (
            <article key={card.id} className="card flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-ink">{card.name}</h2>
                  <p className="text-xs text-ink-muted">
                    {card.currency.toUpperCase()} · {REGION_PACKS.find((r) => r.code === card.regionCode)?.label ?? card.regionCode}
                    {card.scope === 'company' ? ' · shared with your team' : ''}
                  </p>
                </div>
                {card.isDefault ? (
                  <span className="badge-success shrink-0">
                    <Star className="h-2.5 w-2.5" /> Default
                  </span>
                ) : null}
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-ink-subtle">Rates</dt>
                  <dd className="font-semibold tabular-nums text-ink">{card.lines.length}</dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">Adjustment</dt>
                  <dd className="font-semibold tabular-nums text-ink">
                    {card.adjustmentBp === 0 ? 'None' : `${card.adjustmentBp > 0 ? '+' : ''}${formatRate(Math.abs(card.adjustmentBp))}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">Crew rate</dt>
                  <dd className="font-semibold tabular-nums text-ink">
                    <Money minor={card.crewRate} currency={card.currency} /> /hr
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">Updated</dt>
                  <dd className="tabular-nums text-ink-muted">{new Date(card.updatedAt).toLocaleDateString()}</dd>
                </div>
              </dl>

              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                <button type="button" className="btn-secondary btn-sm flex-1" onClick={() => setEditing(card)}>
                  Edit rates
                </button>
                {!card.isDefault ? (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setDefault.mutate(card.id)} title="Use this card by default">
                    <Star className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                <button type="button" className="btn-ghost btn-sm" onClick={() => duplicate.mutate(card)} aria-label="Duplicate">
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button type="button" className="btn-ghost btn-sm text-danger" onClick={() => remove.mutate(card.id)} aria-label="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Receipt className="h-8 w-8" />}
          title="No rate cards yet"
          description="Until you add one, estimates use Novira's built-in mid-market rates adjusted for the plan's region. They are a starting point, not local pricing — start from them and change what you know."
          action={
            <button type="button" className="btn-primary" onClick={() => seed.mutate('global')} disabled={seed.isPending}>
              <Wand2 className="h-4 w-4" /> Start from the built-in rates
            </button>
          }
        />
      )}

      {data?.items.length ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-ink">How pricing resolves</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-muted">
            <li>The card named on the plan, if there is one.</li>
            <li>Your company's default card.</li>
            <li>Your own default card.</li>
            <li>Novira's built-in rates, adjusted for the plan's region — with every line marked as indicative.</li>
          </ol>
          <p className="mt-2 text-xs text-ink-subtle">
            A plan always prices, even on an account that has never opened this page. An estimate that refuses to appear
            until something is configured is an estimate nobody ever sees.
          </p>
        </section>
      ) : null}

      {editing ? <RateCardEditor card={editing} onClose={() => setEditing(null)} /> : null}
    </AppShell>
  );
}

/* ── Editor ────────────────────────────────────────────────────────────── */

function RateCardEditor({ card, onClose }: { card: RateCardDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RateCardDto>(card);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<TakeoffGroup | ''>('');
  const [showCost, setShowCost] = useState(true);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: draft.name,
        currency: draft.currency,
        regionCode: draft.regionCode,
        adjustmentBp: draft.adjustmentBp,
        crewRate: draft.crewRate,
        lines: draft.lines,
        isDefault: draft.isDefault,
      };
      return draft.id ? spatial.rateCards.update(draft.id, body) : spatial.rateCards.create(body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rate-cards'] });
      void queryClient.invalidateQueries({ queryKey: ['estimate'] });
      toast('success', 'Rates saved. Every estimate priced against this card updates.');
      onClose();
    },
    onError: () => toast('error', 'Could not save the card.'),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return draft.lines.filter((line) => {
      if (group && line.group !== group) return false;
      if (!q) return true;
      return `${line.code} ${line.description}`.toLowerCase().includes(q);
    });
  }, [draft.lines, search, group]);

  const updateLine = (code: string, patch: Partial<RateLine>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((line) => (line.code === code ? { ...line, ...patch } : line)) }));

  const margin = useMemo(() => {
    const priced = draft.lines.filter((line) => line.unitCost != null && line.unitPrice > 0);
    if (!priced.length) return null;
    const totalPrice = priced.reduce((sum, line) => sum + line.unitPrice, 0);
    const totalCost = priced.reduce((sum, line) => sum + (line.unitCost ?? 0), 0);
    return Math.round(((totalPrice - totalCost) / totalPrice) * 10_000);
  }, [draft.lines]);

  return (
    <Modal
      open
      title={draft.id ? 'Edit rates' : 'New rate card'}
      description="Every rate is per unit, in the card's currency. A blank rate falls back to a unit default and is flagged on the estimate."
      onClose={onClose}
      width="max-w-4xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending || !draft.name.trim()}>
            {save.isPending ? 'Saving…' : 'Save rates'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="space-y-1">
          <Field label="Card name">
            <TextInput value={draft.name} placeholder="Kenya 2027" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Currency">
            <TextInput
              value={draft.currency.toUpperCase()}
              maxLength={3}
              onChange={(e) => setDraft({ ...draft, currency: e.target.value.toLowerCase() })}
            />
          </Field>
          <Field label="Market">
            <Select value={draft.regionCode} onChange={(e) => setDraft({ ...draft, regionCode: e.target.value })}>
              {REGION_PACKS.map((pack) => (
                <option key={pack.code} value={pack.code}>
                  {pack.label}
                </option>
              ))}
            </Select>
          </Field>

          <SliderField
            label="Adjust everything"
            value={draft.adjustmentBp}
            onChange={(adjustmentBp) => setDraft({ ...draft, adjustmentBp })}
            min={-3000}
            max={5000}
            step={50}
            format={(v) => (v === 0 ? 'No change' : `${v > 0 ? '+' : '−'}${formatRate(Math.abs(v))}`)}
            help="A blanket uplift or discount on every line. This is how most agencies adjust pricing year to year, rather than editing three hundred rates."
          />

          <NumberField
            label="Crew rate"
            value={Math.round(draft.crewRate / 100)}
            min={0}
            max={100_000}
            step={1}
            suffix={draft.currency.toUpperCase()}
            onChange={(v) => setDraft({ ...draft, crewRate: v * 100 })}
            help="Per crew-hour. Build hours are derived per trade from the quantities."
          />

          <Toggle
            label="Use by default"
            checked={draft.isDefault}
            onChange={(isDefault) => setDraft({ ...draft, isDefault })}
            hint="Every plan that does not name a card is priced against this one."
          />

          {margin !== null ? (
            <div className="mt-2 rounded-lg border border-line bg-surface-muted/40 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Average margin</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-ink">{formatRate(margin)}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-ink-subtle">
                Across the lines where you have entered a cost. Margin never appears on a client-facing document.
              </p>
            </div>
          ) : null}
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="relative min-w-40 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
              <input
                className="input py-1.5 pl-8 text-xs"
                placeholder="Find a rate…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search rates"
              />
            </div>
            <select
              className="select w-auto py-1.5 text-xs"
              value={group}
              onChange={(e) => setGroup(e.target.value as TakeoffGroup | '')}
              aria-label="Trade"
            >
              <option value="">Every trade</option>
              {TAKEOFF_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {TAKEOFF_GROUP_LABELS[g]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              <input type="checkbox" checked={showCost} onChange={(e) => setShowCost(e.target.checked)} />
              Show cost
            </label>
          </div>

          <div className="max-h-[52vh] overflow-y-auto rounded-lg border border-line">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface-strong">
                <tr className="table-head">
                  <th className="px-2 py-2">Rate</th>
                  <th className="w-16 px-2 py-2">Unit</th>
                  <th className="w-24 px-2 py-2 text-right">Sell</th>
                  {showCost ? <th className="w-24 px-2 py-2 text-right">Cost</th> : null}
                  <th className="w-16 px-2 py-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((line) => {
                  const lineMargin =
                    line.unitCost != null && line.unitPrice > 0
                      ? Math.round(((line.unitPrice - line.unitCost) / line.unitPrice) * 10_000)
                      : null;
                  return (
                    <tr key={line.code} className="table-row">
                      <td className="px-2 py-1.5">
                        <p className="font-medium text-ink">{line.description}</p>
                        <p className="font-mono text-[10px] text-ink-subtle">
                          {line.code}
                          {line.code.endsWith('*') ? ' — matches anything starting with this' : ''}
                          {line.wastageBp ? ` · ${formatRate(line.wastageBp)} waste` : ''}
                          {line.minimumCharge ? ` · min ${(line.minimumCharge / 100).toFixed(0)}` : ''}
                        </p>
                      </td>
                      <td className="px-2 py-1.5 text-ink-subtle">{TAKEOFF_UNIT_LABELS[line.unit as TakeoffUnit]}</td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          className="ed-field w-full text-right"
                          value={Math.round(line.unitPrice) / 100}
                          step={0.5}
                          min={0}
                          aria-label={`${line.description} sell price`}
                          onChange={(e) => updateLine(line.code, { unitPrice: Math.round(Number(e.target.value) * 100) })}
                        />
                      </td>
                      {showCost ? (
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            className="ed-field w-full text-right"
                            value={line.unitCost != null ? Math.round(line.unitCost) / 100 : ''}
                            step={0.5}
                            min={0}
                            placeholder="—"
                            aria-label={`${line.description} cost`}
                            onChange={(e) =>
                              updateLine(line.code, {
                                unitCost: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
                              })
                            }
                          />
                        </td>
                      ) : null}
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {lineMargin === null ? (
                          <span className="text-ink-subtle">—</span>
                        ) : (
                          <span className={lineMargin < 1500 ? 'text-danger' : lineMargin < 3000 ? 'text-warning' : 'text-success'}>
                            {formatRate(lineMargin)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-ink-subtle">No rates match that.</p>
            ) : null}
          </div>

          <p className="mt-2 text-[11px] leading-snug text-ink-subtle">
            Codes ending in <span className="font-mono">*</span> match anything starting with them, and the longest match
            wins — so <span className="font-mono">LIGHT-beam</span> takes precedence over{' '}
            <span className="font-mono">LIGHT-*</span>. That is what lets a card be refined over time without the general
            rate suddenly overtaking a specific one.
          </p>
        </div>
      </div>
    </Modal>
  );
}
