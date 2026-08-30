import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Building2, Plus, Star, Trash2 } from 'lucide-react';
import { formatMoney } from '@novira/shared';
import { http, ApiClientError } from '../lib/api';
import { AppShell } from '../components/AppShell';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';

/**
 * Suppliers and stock.
 *
 * The column that makes this operational rather than a contacts list is the
 * catalogue link on a stock row: it ties a piece of inventory to the 3D model
 * that represents it. Once that link exists, a layout can be costed — the
 * editor knows you own twenty-four gold Chiavari chairs, the plan calls for
 * forty, and the shortfall has a price.
 *
 * "Committed" is shown next to what is owned because owning twenty chairs means
 * nothing if eighteen are already promised to another event that weekend, and
 * that is the mistake this page exists to catch.
 */

interface Vendor {
  id: number;
  name: string;
  category: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  rating: number | null;
  leadTimeDays: number | null;
  notes: string | null;
  itemCount: number;
  isOwner: boolean;
}

interface InventoryRow {
  id: number;
  name: string;
  sku: string | null;
  ownership: 'owned' | 'hired';
  quantityOwned: number;
  quantityCommitted: number;
  unitCost: number;
  rentalRate: number;
  currency: string;
  storageNote: string | null;
  vendor: { id: number; name: string } | null;
  catalogItemId: number | null;
  isOwner: boolean;
}

interface CatalogItem {
  id: number;
  name: string;
}

export function VendorsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'vendors' | 'inventory'>('vendors');
  const [vendorOpen, setVendorOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');

  const [vendorDraft, setVendorDraft] = useState({
    name: '', category: 'Furniture hire', contactName: '', email: '', phone: '',
    website: '', city: '', rating: null as number | null, leadTimeDays: null as number | null,
    notes: '', shareWithCompany: false,
  });

  const [itemDraft, setItemDraft] = useState({
    name: '', sku: '', vendorId: null as number | null, catalogItemId: null as number | null,
    ownership: 'owned' as 'owned' | 'hired', quantityOwned: 0,
    unitCost: 0, rentalRate: 0, currency: 'usd', storageNote: '', shareWithCompany: false,
  });

  const vendors = useQuery({
    queryKey: ['vendors'],
    queryFn: async () =>
      (await http.get<{ items: Vendor[]; categories: string[] }>('/vendors')).data,
  });

  const inventory = useQuery({
    queryKey: ['inventory'],
    queryFn: async () => (await http.get<{ items: InventoryRow[] }>('/inventory')).data.items,
  });

  // Only searched when the picker is open — the catalogue is large.
  const catalog = useQuery({
    queryKey: ['catalog', 'pick', catalogSearch],
    queryFn: async () =>
      (await http.get<{ items: CatalogItem[] }>(
        `/catalog/items?limit=20${catalogSearch ? `&q=${encodeURIComponent(catalogSearch)}` : ''}`
      )).data.items,
    enabled: itemOpen,
  });

  const createVendor = useMutation({
    mutationFn: async () => (await http.post('/vendors', vendorDraft)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vendors'] });
      setVendorOpen(false);
      setVendorDraft({ ...vendorDraft, name: '', contactName: '', email: '', phone: '', website: '', city: '', notes: '' });
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : 'Could not save that vendor.'),
  });

  const createItem = useMutation({
    mutationFn: async () => (await http.post('/inventory', itemDraft)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      setItemOpen(false);
      setItemDraft({ ...itemDraft, name: '', sku: '', catalogItemId: null, quantityOwned: 0, unitCost: 0, rentalRate: 0 });
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : 'Could not save that item.'),
  });

  const removeVendor = useMutation({
    mutationFn: async (id: number) => (await http.delete(`/vendors/${id}`)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['vendors'] }),
  });

  const removeItem = useMutation({
    mutationFn: async (id: number) => (await http.delete(`/inventory/${id}`)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inventory'] }),
  });

  const byCategory = useMemo(() => {
    const map = new Map<string, Vendor[]>();
    for (const v of vendors.data?.items ?? []) {
      if (!map.has(v.category)) map.set(v.category, []);
      map.get(v.category)!.push(v);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [vendors.data]);

  if (vendors.isLoading) {
    return <AppShell><div className="py-24"><Spinner label="Loading suppliers…" /></div></AppShell>;
  }

  return (
    <AppShell>
      <div className="mb-4 flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-ink">Suppliers &amp; stock</h1>
          <p className="text-xs text-ink-muted">
            Link stock to a catalogue model and any layout using it can be costed automatically.
          </p>
        </div>
        {tab === 'vendors' ? (
          <button type="button" className="btn-primary" onClick={() => setVendorOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add vendor
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={() => setItemOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add stock
          </button>
        )}
      </div>

      {error ? <div className="notice-error mb-4">{error}</div> : null}

      <div className="mb-4 flex gap-1">
        {([
          ['vendors', 'Vendors', Building2, vendors.data?.items.length ?? 0],
          ['inventory', 'Inventory', Boxes, inventory.data?.length ?? 0],
        ] as const).map(([key, label, Icon, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition ${
              tab === key
                ? 'border-primary bg-primary/10 text-ink'
                : 'border-line text-ink-muted hover:text-ink'
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
            <span className="text-xs text-ink-subtle">{count}</span>
          </button>
        ))}
      </div>

      {tab === 'vendors' ? (
        byCategory.length === 0 ? (
          <div className="card py-16 text-center">
            <p className="text-sm text-ink-muted">
              No vendors yet. Add the people you hire from and their stock follows.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {byCategory.map(([category, items]) => (
              <section key={category}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  {category}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((v) => (
                    <div key={v.id} className="card">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold text-ink">{v.name}</h3>
                          {v.contactName ? (
                            <p className="truncate text-xs text-ink-muted">{v.contactName}</p>
                          ) : null}
                        </div>
                        {v.isOwner ? (
                          <button type="button" className="icon-btn h-7 w-7"
                            aria-label={`Remove ${v.name}`}
                            onClick={() => removeVendor.mutate(v.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>

                      {v.rating ? (
                        <div className="mt-1 flex gap-0.5" aria-label={`${v.rating} out of 5`}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <Star
                              key={n}
                              className={`h-3 w-3 ${
                                n <= (v.rating ?? 0) ? 'fill-amber-400 text-amber-400' : 'text-line'
                              }`}
                            />
                          ))}
                        </div>
                      ) : null}

                      <dl className="mt-2 space-y-0.5 text-xs">
                        {v.email ? (
                          <div className="flex justify-between gap-2">
                            <dt className="text-ink-subtle">Email</dt>
                            <dd className="truncate text-ink-muted">{v.email}</dd>
                          </div>
                        ) : null}
                        {v.phone ? (
                          <div className="flex justify-between gap-2">
                            <dt className="text-ink-subtle">Phone</dt>
                            <dd className="text-ink-muted">{v.phone}</dd>
                          </div>
                        ) : null}
                        {v.leadTimeDays != null ? (
                          <div className="flex justify-between gap-2">
                            <dt className="text-ink-subtle">Lead time</dt>
                            <dd className="text-ink-muted">{v.leadTimeDays} days</dd>
                          </div>
                        ) : null}
                        <div className="flex justify-between gap-2">
                          <dt className="text-ink-subtle">Stock lines</dt>
                          <dd className="text-ink-muted">{v.itemCount}</dd>
                        </div>
                      </dl>

                      {v.notes ? (
                        <p className="mt-2 border-t border-line pt-2 text-xs leading-snug text-ink-subtle">
                          {v.notes}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )
      ) : inventory.data?.length === 0 ? (
        <div className="card py-16 text-center">
          <p className="text-sm text-ink-muted">
            No stock recorded. Add what you own, link it to a catalogue model, and layouts using it
            will be costed for you.
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-3 py-2 font-semibold">Item</th>
                <th className="px-3 py-2 font-semibold">Vendor</th>
                <th className="px-3 py-2 text-right font-semibold">Owned</th>
                <th className="px-3 py-2 text-right font-semibold">Committed</th>
                <th className="px-3 py-2 text-right font-semibold">Cost</th>
                <th className="px-3 py-2 text-right font-semibold">Hire rate</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(inventory.data ?? []).map((i) => {
                const over = i.quantityCommitted > i.quantityOwned;
                return (
                  <tr key={i.id} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-medium text-ink">{i.name}</span>
                      {i.sku ? <p className="text-xs text-ink-subtle">{i.sku}</p> : null}
                      {!i.catalogItemId ? (
                        <p className="text-[11px] text-amber-400/90">
                          Not linked to a model — layouts will not cost this
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{i.vendor?.name ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{i.quantityOwned}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        over ? 'font-semibold text-rose-300' : 'text-ink-muted'
                      }`}
                      title={over ? 'Committed to more events than you own' : undefined}
                    >
                      {i.quantityCommitted}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                      {formatMoney(i.unitCost, i.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {formatMoney(i.rentalRate, i.currency)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {i.isOwner ? (
                        <button type="button" className="icon-btn h-7 w-7"
                          aria-label={`Remove ${i.name}`}
                          onClick={() => removeItem.mutate(i.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── New vendor ──────────────────────────────────────────────────── */}
      <Modal
        open={vendorOpen}
        title="Add a vendor"
        onClose={() => setVendorOpen(false)}
        width="max-w-lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setVendorOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary"
              disabled={!vendorDraft.name.trim() || createVendor.isPending}
              onClick={() => createVendor.mutate()}>
              Save
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="label">Name</span>
            <input className="input" value={vendorDraft.name} autoFocus
              onChange={(e) => setVendorDraft({ ...vendorDraft, name: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Category</span>
            <input className="input" list="vendor-categories" value={vendorDraft.category}
              onChange={(e) => setVendorDraft({ ...vendorDraft, category: e.target.value })} />
            <datalist id="vendor-categories">
              {['Furniture hire', 'Catering', 'Florist', 'AV &amp; production', 'Staffing', 'Linen', 'Marquee', 'Lighting', 'Transport'].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="label">Contact</span>
            <input className="input" value={vendorDraft.contactName}
              onChange={(e) => setVendorDraft({ ...vendorDraft, contactName: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Email</span>
            <input className="input" type="email" value={vendorDraft.email}
              onChange={(e) => setVendorDraft({ ...vendorDraft, email: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Phone</span>
            <input className="input" value={vendorDraft.phone}
              onChange={(e) => setVendorDraft({ ...vendorDraft, phone: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">City</span>
            <input className="input" value={vendorDraft.city}
              onChange={(e) => setVendorDraft({ ...vendorDraft, city: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Lead time (days)</span>
            <input className="input" type="number" min={0}
              value={vendorDraft.leadTimeDays ?? ''}
              onChange={(e) =>
                setVendorDraft({ ...vendorDraft, leadTimeDays: e.target.value ? Number(e.target.value) : null })
              } />
          </label>
          <div className="sm:col-span-2">
            <span className="label">Your rating</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" aria-label={`${n} stars`}
                  onClick={() => setVendorDraft({ ...vendorDraft, rating: n })}>
                  <Star className={`h-5 w-5 ${
                    n <= (vendorDraft.rating ?? 0) ? 'fill-amber-400 text-amber-400' : 'text-line'
                  }`} />
                </button>
              ))}
            </div>
          </div>
          <label className="block sm:col-span-2">
            <span className="label">Notes</span>
            <textarea className="input min-h-[60px] resize-y" value={vendorDraft.notes}
              onChange={(e) => setVendorDraft({ ...vendorDraft, notes: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted sm:col-span-2">
            <input type="checkbox" checked={vendorDraft.shareWithCompany}
              onChange={(e) => setVendorDraft({ ...vendorDraft, shareWithCompany: e.target.checked })} />
            Share with my team
          </label>
        </div>
      </Modal>

      {/* ── New stock ───────────────────────────────────────────────────── */}
      <Modal
        open={itemOpen}
        title="Add stock"
        description="Linking to a catalogue model is what lets a layout be costed automatically."
        onClose={() => setItemOpen(false)}
        width="max-w-lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setItemOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary"
              disabled={!itemDraft.name.trim() || createItem.isPending}
              onClick={() => createItem.mutate()}>
              Save
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="label">Name</span>
            <input className="input" value={itemDraft.name} autoFocus
              onChange={(e) => setItemDraft({ ...itemDraft, name: e.target.value })} />
          </label>

          <div className="sm:col-span-2">
            <span className="label">Linked catalogue model</span>
            <input className="input mb-1.5" placeholder="Search the catalogue…"
              value={catalogSearch} onChange={(e) => setCatalogSearch(e.target.value)} />
            <div className="max-h-36 space-y-0.5 overflow-y-auto rounded border border-line p-1">
              {(catalog.data ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() =>
                    setItemDraft({
                      ...itemDraft,
                      catalogItemId: c.id,
                      name: itemDraft.name.trim() || c.name,
                    })
                  }
                  className={`block w-full truncate rounded px-2 py-1 text-left text-xs transition ${
                    itemDraft.catalogItemId === c.id
                      ? 'bg-primary/15 text-ink'
                      : 'text-ink-muted hover:bg-surface-muted'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
            {!itemDraft.catalogItemId ? (
              <p className="mt-1 text-xs text-amber-400/90">
                Without a link, layouts cannot count or price this item.
              </p>
            ) : null}
          </div>

          <label className="block">
            <span className="label">Vendor</span>
            <select className="input" value={itemDraft.vendorId ?? ''}
              onChange={(e) =>
                setItemDraft({ ...itemDraft, vendorId: e.target.value ? Number(e.target.value) : null })
              }>
              <option value="">None</option>
              {(vendors.data?.items ?? []).map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Quantity owned</span>
            <input className="input" type="number" min={0} value={itemDraft.quantityOwned}
              onChange={(e) => setItemDraft({ ...itemDraft, quantityOwned: Number(e.target.value) })} />
          </label>
          <label className="block">
            <span className="label">Unit cost (minor units)</span>
            <input className="input" type="number" min={0} value={itemDraft.unitCost}
              onChange={(e) => setItemDraft({ ...itemDraft, unitCost: Number(e.target.value) })} />
            <p className="mt-1 text-xs text-ink-subtle">{formatMoney(itemDraft.unitCost, itemDraft.currency)}</p>
          </label>
          <label className="block">
            <span className="label">Hire rate per event</span>
            <input className="input" type="number" min={0} value={itemDraft.rentalRate}
              onChange={(e) => setItemDraft({ ...itemDraft, rentalRate: Number(e.target.value) })} />
            <p className="mt-1 text-xs text-ink-subtle">{formatMoney(itemDraft.rentalRate, itemDraft.currency)}</p>
          </label>
          <label className="block sm:col-span-2">
            <span className="label">Where it is kept</span>
            <input className="input" value={itemDraft.storageNote} placeholder="Bay 3, west warehouse"
              onChange={(e) => setItemDraft({ ...itemDraft, storageNote: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted sm:col-span-2">
            <input type="checkbox" checked={itemDraft.shareWithCompany}
              onChange={(e) => setItemDraft({ ...itemDraft, shareWithCompany: e.target.checked })} />
            Share with my team
          </label>
        </div>
      </Modal>
    </AppShell>
  );
}
