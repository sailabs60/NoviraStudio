import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, Search, Send, ShoppingBag, Star, Store, Tag, Trash2 } from 'lucide-react';
import {
  LISTING_KINDS,
  LISTING_KIND_INFO,
  REGION_PACKS,
  sellerBreakdown,
  type ListingKind,
  type MarketplaceListingDto,
} from '@novira/shared';
import { AppShell } from '../components/AppShell';
import { PageBanner } from '../components/PageBanner';
import { spatial } from '../lib/spatialApi';
import { api } from '../lib/api';
import { Modal } from '../components/Modal';
import { CardSkeletons, EmptyState, Field, Money, Select, Tabs, TextInput, Toggle, toast } from '../components/ui';

/**
 * The marketplace.
 *
 * Templates, stand designs, venue packs, asset packs, lighting looks and rate
 * cards, sold by the people who made them.
 *
 * The commercial rule is stated everywhere it applies rather than hidden in
 * terms: the platform takes a fixed, published commission, and a seller sees
 * exactly what they will be paid before they publish. A marketplace where the
 * cut is a surprise at payout does not get a second listing.
 */
export function MarketplacePage() {
  const [tab, setTab] = useState<'browse' | 'purchases' | 'selling'>('browse');

  return (
    <AppShell>
      <PageBanner
        slot="marketplace-hero"
        title="Marketplace"
        lead={`Complete layouts, stand designs, verified venue packs, asset packs and regional rate cards — made by other agencies and designers. Sell your own and keep ${100 - 20} % of every sale.`}
      />

      <div className="mb-5">
        <Tabs
          tabs={[
            { value: 'browse', label: 'Browse', icon: <ShoppingBag className="h-3 w-3" /> },
            { value: 'purchases', label: 'What you own', icon: <Download className="h-3 w-3" /> },
            { value: 'selling', label: 'Your listings', icon: <Store className="h-3 w-3" /> },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'browse' ? <Browse /> : null}
      {tab === 'purchases' ? <Purchases /> : null}
      {tab === 'selling' ? <Selling /> : null}
    </AppShell>
  );
}

/* ── Browse ────────────────────────────────────────────────────────────── */

function Browse() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ListingKind | ''>('');
  const [sort, setSort] = useState<'newest' | 'popular' | 'price-asc' | 'rating'>('newest');
  const [freeOnly, setFreeOnly] = useState(false);
  const [detail, setDetail] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['marketplace', query, kind, sort, freeOnly],
    queryFn: () =>
      spatial.marketplace.browse({
        q: query || undefined,
        kind: kind || undefined,
        sort,
        freeOnly: freeOnly || undefined,
      }),
  });

  const purchase = useMutation({
    mutationFn: (id: number) => spatial.marketplace.purchase(id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['marketplace'] });
      void queryClient.invalidateQueries({ queryKey: ['marketplace-purchases'] });
      toast(
        'success',
        result.alreadyOwned ? 'You already own this — find it under What you own.' : 'Added to your library.'
      );
    },
    onError: () => toast('error', 'Could not complete that purchase.'),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
          <input
            className="input pl-9"
            placeholder="Search listings…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the marketplace"
          />
        </div>
        <select className="select w-auto" value={kind} onChange={(e) => setKind(e.target.value as ListingKind | '')} aria-label="Kind">
          <option value="">Everything</option>
          {LISTING_KINDS.map((k) => (
            <option key={k} value={k}>
              {LISTING_KIND_INFO[k].label}
            </option>
          ))}
        </select>
        <select className="select w-auto" value={sort} onChange={(e) => setSort(e.target.value as never)} aria-label="Sort">
          <option value="newest">Newest</option>
          <option value="popular">Most sold</option>
          <option value="rating">Best rated</option>
          <option value="price-asc">Cheapest first</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-muted">
          <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
          Free only
        </label>
      </div>

      {isLoading ? (
        <CardSkeletons label="Loading listings" />
      ) : data?.items.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              onOpen={() => setDetail(listing.id)}
              onBuy={() => purchase.mutate(listing.id)}
              busy={purchase.isPending}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<ShoppingBag className="h-8 w-8" />}
          title="Nothing listed yet"
          description="The marketplace fills up as people publish. If you have a layout, a stand design or a set of venue records worth sharing, list it — free listings are welcome and are the fastest way to build a reputation."
        />
      )}

      {detail ? <ListingDetail id={detail} onClose={() => setDetail(null)} onBuy={() => purchase.mutate(detail)} /> : null}
    </>
  );
}

function ListingCard({
  listing,
  onOpen,
  onBuy,
  busy,
}: {
  listing: MarketplaceListingDto;
  onOpen: () => void;
  onBuy: () => void;
  busy: boolean;
}) {
  const info = LISTING_KIND_INFO[listing.kind];
  return (
    <article className="card flex flex-col">
      {listing.previewUrl ? (
        <img src={listing.previewUrl} alt="" className="mb-3 aspect-video w-full rounded-lg border border-line object-cover" loading="lazy" />
      ) : (
        <div className="mb-3 flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-line text-ink-subtle">
          <Tag className="h-6 w-6" />
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink">{listing.title}</h2>
          <p className="truncate text-xs text-ink-muted">
            {info.label} · {listing.sellerName}
          </p>
        </div>
        {listing.owned ? <span className="badge-success shrink-0">Owned</span> : null}
      </div>

      <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-ink-muted">{listing.summary || info.note}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-subtle">
        {listing.rating !== null ? (
          <span className="chip">
            <Star className="h-3 w-3" /> {listing.rating} ({listing.ratingCount})
          </span>
        ) : null}
        {listing.sales > 0 ? <span className="chip">{listing.sales} sold</span> : null}
        <span className="chip">{REGION_PACKS.find((r) => r.code === listing.regionCode)?.label ?? 'Global'}</span>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
        <span className="text-sm font-bold text-ink">
          {listing.price === 0 ? 'Free' : <Money minor={listing.price} currency={listing.currency} />}
        </span>
        <button type="button" className="btn-ghost btn-sm ml-auto" onClick={onOpen}>
          Details
        </button>
        <button type="button" className="btn-primary btn-sm" onClick={onBuy} disabled={busy || listing.owned}>
          {listing.owned ? <Check className="h-3.5 w-3.5" /> : listing.price === 0 ? 'Get it' : 'Buy'}
        </button>
      </div>
    </article>
  );
}

function ListingDetail({ id, onClose, onBuy }: { id: number; onClose: () => void; onBuy: () => void }) {
  const { data } = useQuery({ queryKey: ['marketplace-listing', id], queryFn: () => spatial.marketplace.get(id) });
  if (!data) return null;
  const info = LISTING_KIND_INFO[data.kind];

  return (
    <Modal
      open
      title={data.title}
      description={`${info.label} by ${data.sellerName}`}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn-primary" onClick={onBuy} disabled={data.owned}>
            {data.owned ? 'You own this' : data.price === 0 ? 'Get it' : 'Buy for '}
            {!data.owned && data.price > 0 ? <Money minor={data.price} currency={data.currency} /> : null}
          </button>
        </>
      }
    >
      {data.previewUrl ? (
        <img src={data.previewUrl} alt="" className="mb-3 w-full rounded-lg border border-line" />
      ) : null}

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{data.description || data.summary}</p>

      <div className="mt-4 rounded-lg border border-line bg-surface-muted/40 p-3">
        <p className="text-xs font-semibold text-ink">What you get</p>
        <p className="mt-0.5 text-xs text-ink-muted">{info.delivers}</p>
      </div>

      {data.galleryUrls.length ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {data.galleryUrls.map((url) => (
            <img key={url} src={url} alt="" className="aspect-video w-full rounded border border-line object-cover" loading="lazy" />
          ))}
        </div>
      ) : null}

      {data.reviews.length ? (
        <section className="mt-4">
          <h3 className="text-sm font-semibold text-ink">Reviews</h3>
          <div className="mt-2 space-y-2">
            {data.reviews.map((review, i) => (
              <div key={i} className="rounded-lg border border-line p-2">
                <p className="text-xs font-semibold text-ink">
                  {'★'.repeat(review.rating)}
                  <span className="ml-1.5 font-normal text-ink-subtle">{review.authorName}</span>
                </p>
                {review.review ? <p className="mt-0.5 text-xs text-ink-muted">{review.review}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </Modal>
  );
}

/* ── Purchases ─────────────────────────────────────────────────────────── */

function Purchases() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['marketplace-purchases'], queryFn: () => spatial.marketplace.purchases() });
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState('');

  const submitReview = useMutation({
    mutationFn: (purchaseId: number) => spatial.marketplace.review(purchaseId, rating, review || undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['marketplace-purchases'] });
      setReviewing(null);
      setReview('');
      toast('success', 'Thanks — that helps the next buyer.');
    },
  });

  if (!data?.length) {
    return (
      <EmptyState
        icon={<Download className="h-8 w-8" />}
        title="Nothing bought yet"
        description="Anything you get from the marketplace appears here, and stays available even if the seller later withdraws the listing."
      />
    );
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.map((purchase) => (
          <article key={purchase.purchaseId} className="card">
            <h2 className="text-sm font-semibold text-ink">{purchase.listing.title}</h2>
            <p className="text-xs text-ink-muted">
              {LISTING_KIND_INFO[purchase.listing.kind].label} · {purchase.listing.sellerName}
            </p>
            <p className="mt-1 text-xs text-ink-subtle">
              {purchase.price === 0 ? 'Free' : <Money minor={purchase.price} currency={purchase.currency} />} ·{' '}
              {new Date(purchase.purchasedAt).toLocaleDateString()}
            </p>

            <div className="mt-3 flex gap-1.5 border-t border-line pt-3">
              <ImportButton listing={purchase.listing} payload={purchase.payload} />
              <button type="button" className="btn-ghost btn-sm" onClick={() => setReviewing(purchase.purchaseId)}>
                {purchase.rating ? `${'★'.repeat(purchase.rating)}` : 'Review'}
              </button>
            </div>
          </article>
        ))}
      </div>

      {reviewing ? (
        <Modal
          open
          title="Leave a review"
          description="Only people who own something can review it, which is what makes the ratings worth reading."
          onClose={() => setReviewing(null)}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setReviewing(null)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={() => submitReview.mutate(reviewing)}>
                Post review
              </button>
            </>
          }
        >
          <Field label="Rating">
            <Select value={String(rating)} onChange={(e) => setRating(Number(e.target.value))}>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {'★'.repeat(n)} — {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What did you think?" hint="Optional, and the most useful part for the next buyer.">
            <textarea className="input min-h-24 resize-y" value={review} onChange={(e) => setReview(e.target.value)} />
          </Field>
        </Modal>
      ) : null}
    </>
  );
}

/**
 * Import a purchase into the user's own workspace.
 *
 * What "import" means depends on what was bought, which is why the payload
 * carries a type — a scene becomes a plan, venue records become library
 * entries, and a rate card becomes a rate card.
 */
function ImportButton({ listing, payload }: { listing: MarketplaceListingDto; payload: unknown }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const data = payload as { type?: string; scene?: unknown; card?: Record<string, unknown>; venues?: Array<Record<string, unknown>> } | null;
    if (!data) {
      toast('error', 'That purchase has nothing to import.');
      return;
    }
    setBusy(true);
    try {
      if (data.type === 'rate-card' && data.card) {
        await spatial.rateCards.create({
          name: String(data.card.name ?? listing.title),
          currency: String(data.card.currency ?? 'usd'),
          regionCode: String(data.card.regionCode ?? 'global'),
          lines: data.card.lines,
          crewRate: Number(data.card.crewRate ?? 4500),
        });
        void queryClient.invalidateQueries({ queryKey: ['rate-cards'] });
        toast('success', 'Rate card added. Set it as your default to price with it.');
        return;
      }

      if (data.type === 'venue-pack' && Array.isArray(data.venues)) {
        for (const venue of data.venues) {
          await spatial.venues.create(venue);
        }
        void queryClient.invalidateQueries({ queryKey: ['venue-specs'] });
        toast('success', `${data.venues.length} venues added to your library.`);
        return;
      }

      if (data.type === 'scene' && data.scene) {
        // A plan needs a project to live in, so one is created for it rather
        // than making the buyer set that up first.
        const project = await api.projects.create(listing.title, `Imported from the marketplace: ${listing.sellerName}`);
        const plan = await api.plans.create(project.id, listing.title);
        await api.plans.save(plan.id, { scene: data.scene });
        void queryClient.invalidateQueries({ queryKey: ['projects'] });
        toast('success', 'Added as a new project. Open it from Projects.');
        return;
      }

      toast('info', 'That purchase is stored, but this version cannot import it automatically yet.');
    } catch {
      toast('error', 'Could not import that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="btn-primary btn-sm flex-1" onClick={() => void run()} disabled={busy}>
      <Download className="h-3.5 w-3.5" /> {busy ? 'Importing…' : 'Use it'}
    </button>
  );
}

/* ── Selling ───────────────────────────────────────────────────────────── */

function Selling() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const { data } = useQuery({ queryKey: ['marketplace-mine'], queryFn: () => spatial.marketplace.mine() });

  const submit = useMutation({
    mutationFn: (id: number) => spatial.marketplace.update(id, { submit: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['marketplace-mine'] });
      toast('success', 'Sent for review. Everything is checked before it goes public.');
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => spatial.marketplace.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['marketplace-mine'] });
      toast('success', 'Listing removed.');
    },
  });

  const totalEarned = (data?.items ?? []).reduce((sum, item) => sum + item.earnings.net, 0);
  const currency = data?.items[0]?.currency ?? 'usd';

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          {totalEarned > 0 ? (
            <p className="text-sm text-ink-muted">
              Earned so far:{' '}
              <strong className="text-ink">
                <Money minor={totalEarned} currency={currency} />
              </strong>{' '}
              after commission.
            </p>
          ) : (
            <p className="text-sm text-ink-muted">
              Novira takes {data?.commissionBp ? data.commissionBp / 100 : 20} % of each sale. You see the net before you
              publish, and on every payout line.
            </p>
          )}
        </div>
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
          <Store className="h-4 w-4" /> List something
        </button>
      </div>

      {data?.items.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((listing) => (
            <article key={listing.id} className="card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-ink">{listing.title}</h2>
                  <p className="text-xs text-ink-muted">{LISTING_KIND_INFO[listing.kind].label}</p>
                </div>
                <span
                  className={`shrink-0 ${
                    listing.status === 'published'
                      ? 'badge-success'
                      : listing.status === 'in_review'
                        ? 'badge-warning'
                        : listing.status === 'rejected'
                          ? 'badge-danger'
                          : 'badge-neutral'
                  }`}
                >
                  {listing.status.replace('_', ' ')}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-ink-subtle">Price</dt>
                  <dd className="font-semibold text-ink">
                    {listing.price === 0 ? 'Free' : <Money minor={listing.price} currency={listing.currency} />}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">You keep</dt>
                  <dd className="font-semibold text-ink">
                    <Money minor={listing.breakdown.net} currency={listing.currency} />
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">Sold</dt>
                  <dd className="font-semibold tabular-nums text-ink">{listing.earnings.count}</dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">Earned</dt>
                  <dd className="font-semibold text-ink">
                    <Money minor={listing.earnings.net} currency={listing.currency} />
                  </dd>
                </div>
              </dl>

              <div className="mt-3 flex gap-1.5 border-t border-line pt-3">
                {listing.status === 'draft' || listing.status === 'rejected' ? (
                  <button type="button" className="btn-primary btn-sm flex-1" onClick={() => submit.mutate(listing.id)}>
                    <Send className="h-3.5 w-3.5" /> Submit for review
                  </button>
                ) : (
                  <span className="flex-1 text-xs text-ink-subtle">
                    {listing.status === 'in_review' ? 'Waiting for review.' : 'Live in the marketplace.'}
                  </span>
                )}
                <button type="button" className="btn-ghost btn-sm text-danger" onClick={() => remove.mutate(listing.id)} aria-label="Remove">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Store className="h-8 w-8" />}
          title="Nothing listed"
          description="A layout you have built, a stand design, the venue records you have compiled, or the rate card you have refined — all of them are worth something to someone starting from nothing."
        />
      )}

      {creating ? <CreateListing onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function CreateListing({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ListingKind>('plan-template');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState(0);
  const [currency, setCurrency] = useState('usd');
  const [regionCode, setRegionCode] = useState('global');
  const [sourcePlanId, setSourcePlanId] = useState<number | ''>('');
  const [sourceRateCardId, setSourceRateCardId] = useState<number | ''>('');
  const [free, setFree] = useState(true);

  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: api.projects.list });
  const { data: cards } = useQuery({ queryKey: ['rate-cards'], queryFn: () => spatial.rateCards.list() });

  const firstProject = projects?.[0];
  const { data: plans } = useQuery({
    queryKey: ['plans', firstProject?.id],
    queryFn: () => api.plans.listByProject(firstProject!.id),
    enabled: Boolean(firstProject),
  });

  const create = useMutation({
    mutationFn: () =>
      spatial.marketplace.create({
        kind,
        title,
        summary,
        description,
        price: free ? 0 : Math.round(price * 100),
        currency,
        regionCode,
        ...(kind === 'rate-card'
          ? { sourceRateCardId: sourceRateCardId || undefined }
          : { sourcePlanId: sourcePlanId || undefined }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['marketplace-mine'] });
      toast('success', 'Draft created. Submit it for review when you are ready.');
      onClose();
    },
    onError: () => toast('error', 'Could not create the listing. Choose something to sell.'),
  });

  const breakdown = sellerBreakdown(free ? 0 : Math.round(price * 100), currency);

  return (
    <Modal
      open
      title="List something for sale"
      description="What you list is a snapshot taken now — editing the source afterwards does not change what buyers received."
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => create.mutate()} disabled={!title.trim() || create.isPending}>
            Create draft
          </button>
        </>
      }
    >
      <Field label="What are you selling?">
        <Select value={kind} onChange={(e) => setKind(e.target.value as ListingKind)}>
          {LISTING_KINDS.map((k) => (
            <option key={k} value={k}>
              {LISTING_KIND_INFO[k].label} — {LISTING_KIND_INFO[k].note}
            </option>
          ))}
        </Select>
      </Field>

      {kind === 'rate-card' ? (
        <Field label="Which rate card">
          <Select value={String(sourceRateCardId)} onChange={(e) => setSourceRateCardId(Number(e.target.value) || '')}>
            <option value="">Choose…</option>
            {(cards?.items ?? []).map((card) => (
              <option key={card.id} value={card.id}>
                {card.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label="Which plan" hint="The whole scene is copied into the listing.">
          <Select value={String(sourcePlanId)} onChange={(e) => setSourcePlanId(Number(e.target.value) || '')}>
            <option value="">Choose…</option>
            {(plans ?? []).map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.title}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Title">
        <TextInput value={title} placeholder="Curved LED summit stage, 400 delegates" onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="One-line summary">
        <TextInput value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <Field label="Description" hint="What it is, what it is for, and what a buyer will need to change.">
        <textarea className="input min-h-24 resize-y" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <Field label="Market">
        <Select value={regionCode} onChange={(e) => setRegionCode(e.target.value)}>
          {REGION_PACKS.map((pack) => (
            <option key={pack.code} value={pack.code}>
              {pack.label}
            </option>
          ))}
        </Select>
      </Field>

      <Toggle
        label="Give it away free"
        checked={free}
        onChange={setFree}
        hint="Free listings are welcome, and are the fastest way to build a reputation from nothing."
      />

      {!free ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price">
              <TextInput type="number" min={0} step={1} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
            </Field>
            <Field label="Currency">
              <TextInput value={currency.toUpperCase()} maxLength={3} onChange={(e) => setCurrency(e.target.value.toLowerCase())} />
            </Field>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted/40 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-ink-muted">Buyer pays</span>
              <Money minor={breakdown.price} currency={currency} className="font-semibold text-ink" />
            </div>
            <div className="flex justify-between">
              <span className="text-ink-muted">Commission ({breakdown.commissionBp / 100} %)</span>
              <Money minor={-breakdown.commission} currency={currency} className="text-ink-muted" />
            </div>
            <div className="mt-1 flex justify-between border-t border-line pt-1">
              <span className="font-semibold text-ink">You receive</span>
              <Money minor={breakdown.net} currency={currency} className="font-bold text-ink" />
            </div>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
