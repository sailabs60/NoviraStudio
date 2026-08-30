import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { formatLength } from '@novira/shared';
import { api } from '../lib/api';
import { AppShell } from '../components/AppShell';
import { Spinner } from '../components/Spinner';
import { useSession } from '../store/session';

/**
 * Catalogue browser.
 *
 * Provenance and measured dimensions appear on every card on purpose. The whole
 * point of the ingest pipeline is that these items have been checked, and that
 * is worth showing rather than leaving implicit.
 */
export function CatalogPage() {
  const user = useSession((s) => s.user);
  const units = user?.preferredUnits ?? 'imperial';
  const [slug, setSlug] = useState('');
  const [q, setQ] = useState('');

  const { data: categories } = useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: api.catalog.categories,
  });
  const { data, isLoading } = useQuery({
    queryKey: ['catalog', 'browse', slug, q],
    queryFn: () => api.catalog.items({ categorySlug: slug || undefined, q: q || undefined, limit: 100 }),
  });

  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-ink">Catalogue</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Every item has been downloaded, measured, and checked against the plausible real-world size for
        what it claims to be.
      </p>

      <div className="mb-5 flex flex-wrap gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search the catalogue…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="select max-w-xs" value={slug} onChange={(e) => setSlug(e.target.value)}>
          <option value="">All categories</option>
          {(categories ?? [])
            .filter((c) => (c.itemCount ?? 0) > 0)
            .map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name} ({c.itemCount})
              </option>
            ))}
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-24">
          <Spinner label="Loading catalogue…" />
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-ink-subtle">{data?.total ?? 0} items</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data?.items.map((item) => (
              <article key={item.id} className="card">
                <div className="mb-2 flex h-28 items-center justify-center overflow-hidden rounded-lg bg-surface-muted/60">
                  {item.previewImage ? (
                    <img src={item.previewImage} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <span className="text-xs text-ink-subtle">3D model</span>
                  )}
                </div>
                <h2 className="truncate text-sm font-semibold text-ink">{item.name}</h2>
                <p className="mt-0.5 text-xs text-success">
                  {[item.widthMm, item.depthMm, item.heightMm]
                    .filter((v): v is number => typeof v === 'number')
                    .map((v) => formatLength(v, units))
                    .join(' × ')}
                </p>
                {item.seatsDefault ? (
                  <p className="text-[11px] text-ink-muted">Seats {item.seatsDefault}</p>
                ) : null}
                <p className="mt-1.5 flex items-center gap-1 text-[10px] text-ink-subtle">
                  <ShieldCheck className="h-3 w-3 text-success" />
                  {item.sourceLabel ?? 'Novira'}
                  {item.license ? ` · ${item.license}` : ''}
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
