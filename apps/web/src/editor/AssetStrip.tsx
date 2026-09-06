import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Store,
  UserCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  AVAILABILITY_INFO,
  BOOTH_SIZES,
  migrateScene,
  BOOTH_TYPE_SPECS,
  BOOTH_TYPES,
  SPECIALIST_SKILL_LABELS,
  type BoothType,
} from '@novira/shared';
import { http } from '../lib/api';
import { spatial } from '../lib/spatialApi';
import { assets } from '../lib/assetsApi';
import { LazyImage } from '../components/LazyImage';
import { useEditor } from './editorStore';
import { createBooth } from './factories';
import { draggableProps } from './useDropTarget';
import { Modal } from '../components/Modal';
import { toast } from '../components/ui';

/**
 * The starting-point drawer.
 *
 * Everything here is a *starting point* rather than a component: a whole hall
 * already laid out, a stand at a standard module size, something you imported
 * last week, or a person who can do the work for you. That is a different kind
 * of thing from what the left panel holds, which is why it gets a horizontal
 * shelf of its own instead of another tab in a crowded column.
 *
 * It is a drawer rather than a permanent band, opened from **Start from…** on
 * the bottom toolbar. Keeping it open by default cost 170 px of the plan
 * forever to show something most people want twice a project — at the start,
 * and when they are stuck.
 */

type Tab = 'halls' | 'booths' | 'mine' | 'designers';

const TABS: Array<{ key: Tab; label: string; icon: typeof Building2; note: string }> = [
  {
    key: 'halls',
    label: 'Pre-designed halls',
    icon: Building2,
    note: 'Complete layouts you or Novira have saved, ready to adapt.',
  },
  {
    key: 'booths',
    label: 'Booth templates',
    icon: Store,
    note: 'Stands at the module sizes exhibition floors are actually sold in.',
  },
  { key: 'mine', label: 'My assets', icon: Box, note: 'Everything you have imported from the online libraries.' },
  {
    key: 'designers',
    label: 'Certified designers',
    icon: UserCheck,
    note: 'People who can take on part of the job, with the plan attached.',
  },
];

export function AssetStrip({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('halls');

  if (!open) return null;

  const current = TABS.find((t) => t.key === tab)!;

  return (
    <section
      id="novira-templates-drawer"
      aria-label="Templates and starting points"
      className="nv-rise shrink-0 border-t border-line bg-surface shadow-[0_-8px_24px_-16px_rgb(var(--nv-shadow)/0.25)]"
    >
      <div className="flex h-10 items-center gap-1 px-2">
        {TABS.map((entry) => {
          const Icon = entry.icon;
          const active = tab === entry.key;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              aria-pressed={active}
              title={entry.note}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                active ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{entry.label}</span>
            </button>
          );
        })}

        <span className="ml-3 hidden min-w-0 flex-1 truncate text-[11px] text-ink-subtle lg:block">
          {current.note}
        </span>

        <button
          type="button"
          onClick={onClose}
          className="icon-btn-bare ml-auto shrink-0"
          aria-label="Close the templates drawer"
          title="Close"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className="border-t border-line">
        {tab === 'halls' ? (
          <HallShelf />
        ) : tab === 'booths' ? (
          <BoothShelf />
        ) : tab === 'mine' ? (
          <MineShelf />
        ) : (
          <DesignerShelf />
        )}
      </div>
    </section>
  );
}

/* ── A scrollable shelf with arrow controls ────────────────────────────── */

function Shelf({ children, empty }: { children: React.ReactNode; empty?: React.ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);

  const nudge = (direction: -1 | 1) => {
    scroller.current?.scrollBy({ left: direction * 320, behavior: 'smooth' });
  };

  if (empty) {
    return <div className="flex h-[132px] items-center justify-center px-4 text-center">{empty}</div>;
  }

  return (
    <div className="group/shelf relative">
      <div ref={scroller} className="nv-no-scrollbar flex gap-2 overflow-x-auto px-3 py-2.5">
        {children}
      </div>

      {/* Arrows appear on hover: a trackpad user never needs them, a mouse user does. */}
      <button
        type="button"
        onClick={() => nudge(-1)}
        aria-label="Scroll left"
        className="absolute left-1 top-1/2 hidden -translate-y-1/2 rounded-full border border-line bg-surface p-1 shadow-btn opacity-0 transition group-hover/shelf:opacity-100 md:block"
      >
        <ChevronLeft className="h-4 w-4 text-ink-muted" />
      </button>
      <button
        type="button"
        onClick={() => nudge(1)}
        aria-label="Scroll right"
        className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-full border border-line bg-surface p-1 shadow-btn opacity-0 transition group-hover/shelf:opacity-100 md:block"
      >
        <ChevronRight className="h-4 w-4 text-ink-muted" />
      </button>
    </div>
  );
}

/* ── Pre-designed halls ────────────────────────────────────────────────── */

interface TemplateRow {
  id: number;
  scope: 'local' | 'global';
  title: string;
  description: string | null;
  previewUrl: string | null;
}

/**
 * Whole plans, ready to adapt.
 *
 * Loading one replaces the scene, which is destructive and irreversible from
 * the user's point of view even though undo covers it — so it always goes
 * through a confirmation that names what is about to be lost.
 */
function HallShelf() {
  const replaceScene = useEditor((s) => s.replaceScene);
  const objectCount = useEditor((s) => s.scene.objects.length);
  const readOnly = useEditor((s) => s.readOnly);
  const [pending, setPending] = useState<TemplateRow | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: async () => (await http.get<{ items: TemplateRow[] }>('/templates')).data.items,
    staleTime: 5 * 60_000,
  });

  const { data: venues } = useQuery({
    queryKey: ['venue-specs', 'strip'],
    queryFn: () => spatial.venues.list({ limit: 12 }),
    staleTime: 10 * 60_000,
  });

  const load = async (row: TemplateRow) => {
    try {
      const { data } = await http.get<{ scene: unknown }>(`/templates/${row.id}`);
      // Through the migration, so a template saved under an older schema opens.
      replaceScene(migrateScene(data.scene));
      toast('success', `${row.title} loaded. Undo puts your previous layout back.`);
    } catch {
      toast('error', 'That template could not be loaded.');
    } finally {
      setPending(null);
    }
  };

  if (isLoading) return <SkeletonShelf />;

  if (!templates.length && !venues?.items.length) {
    return (
      <Shelf
        empty={
          <p className="max-w-md text-xs leading-relaxed text-ink-subtle">
            No saved halls yet. Lay a room out the way you like it, then <strong>Save as template</strong> from the
            plan menu — it appears here for every project afterwards.
          </p>
        }
      >
        {null}
      </Shelf>
    );
  }

  return (
    <>
      <Shelf>
        {templates.map((row) => (
          <button
            key={row.id}
            type="button"
            disabled={readOnly}
            onClick={() => (objectCount ? setPending(row) : void load(row))}
            className="group w-[188px] shrink-0 overflow-hidden rounded-lg border border-line bg-surface text-left transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-card disabled:opacity-50"
          >
            <LazyImage
              src={row.previewUrl}
              alt={row.title}
              ratio="16 / 10"
              wrapperClassName="w-full"
              fallback={<Building2 className="h-5 w-5 text-ink-subtle/60" />}
            />
            <span className="block border-t border-line px-2 py-1.5">
              <span className="block truncate text-[11px] font-semibold text-ink">{row.title}</span>
              <span className="block truncate text-[9px] text-ink-subtle">
                {row.scope === 'global' ? 'Novira template' : 'Your template'}
              </span>
            </span>
          </button>
        ))}

        {venues?.items.map((venue) => (
          <Link
            key={`venue-${venue.id}`}
            to="/venues"
            className="flex w-[188px] shrink-0 flex-col justify-between rounded-lg border border-line bg-surface p-2.5 transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-card"
          >
            <span>
              {/*
                The room itself, when there is a photo of it. A venue is a
                place, and a card that shows only its name makes every
                ballroom in the same hotel look identical — which is exactly
                the moment someone is choosing between them.
              */}
              {venue.previewUrl ? (
                <img
                  src={venue.previewUrl}
                  alt=""
                  loading="lazy"
                  className="mb-1.5 h-16 w-full rounded border border-line object-cover"
                />
              ) : (
                <Building2 className="h-4 w-4 text-primary" />
              )}
              <span className="mt-1.5 block truncate text-[11px] font-semibold text-ink">{venue.name}</span>
              <span className="block truncate text-[9px] text-ink-subtle">
                {venue.city}
                {venue.country ? `, ${venue.country}` : ''}
              </span>
            </span>
            <span className="mt-2 text-[9px] font-semibold text-primary">Open the venue library →</span>
          </Link>
        ))}
      </Shelf>

      <Modal
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        title="Replace this layout?"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setPending(null)}>
              Keep what I have
            </button>
            <button type="button" className="btn-primary" onClick={() => pending && void load(pending)}>
              Load the template
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          Loading <strong className="text-ink">{pending?.title}</strong> replaces everything currently in this
          plan — {objectCount} object{objectCount === 1 ? '' : 's'}. Undo puts it back, but nothing is saved to the
          server until the next autosave.
        </p>
      </Modal>
    </>
  );
}

/* ── Booth templates ───────────────────────────────────────────────────── */

/**
 * Stands at real module sizes.
 *
 * Exhibition floors are sold in modules — 3 × 3, 6 × 3, 20 × 20 ft — and a
 * stand that is not one of those sizes cannot be booked. So the shelf is
 * organised by size and type rather than by look, and every card produces a
 * stand that is exactly the size on its label.
 */
function BoothShelf() {
  const addObjects = useEditor((s) => s.addObjects);
  const readOnly = useEditor((s) => s.readOnly);
  const [type, setType] = useState<BoothType>('inline');

  const spec = BOOTH_TYPE_SPECS[type];

  return (
    <div>
      <div className="nv-no-scrollbar flex gap-1.5 overflow-x-auto px-3 pt-2">
        {BOOTH_TYPES.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setType(key)}
            title={BOOTH_TYPE_SPECS[key].note}
            className={`chip shrink-0 whitespace-nowrap ${type === key ? 'chip-active' : ''}`}
          >
            {BOOTH_TYPE_SPECS[key].label}
          </button>
        ))}
        <span className="ml-1 shrink-0 self-center text-[10px] text-ink-subtle">{spec.note}</span>
      </div>

      <Shelf>
        {BOOTH_SIZES.map((size) => (
          <button
            key={`${size.label}-${size.widthMm}x${size.depthMm}`}
            type="button"
            disabled={readOnly}
            onClick={() => {
              const booth = createBooth({
                boothType: type,
                widthMm: size.widthMm,
                depthMm: size.depthMm,
              });
              addObjects([booth]);
              toast('success', `${spec.label} stand at ${size.label} placed at the origin.`);
            }}
            className="flex w-[132px] shrink-0 flex-col rounded-lg border border-line bg-surface p-2.5 text-left transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-card disabled:opacity-50"
          >
            <BoothDiagram widthMm={size.widthMm} depthMm={size.depthMm} type={type} />
            <span className="mt-2 truncate text-[11px] font-semibold text-ink">{size.label}</span>
            <span className="truncate text-[9px] text-ink-subtle">
              {((size.widthMm * size.depthMm) / 1_000_000).toFixed(1)} m² · {spec.openSides} open side
              {spec.openSides === 1 ? '' : 's'}
            </span>
          </button>
        ))}
      </Shelf>
    </div>
  );
}

/** A to-scale plan of the stand, so the proportions are visible before placing. */
function BoothDiagram({ widthMm, depthMm, type }: { widthMm: number; depthMm: number; type: BoothType }) {
  const spec = BOOTH_TYPE_SPECS[type];
  const aspect = widthMm / depthMm;
  const boxWidth = aspect >= 1 ? 100 : 100 * aspect;
  const boxHeight = aspect >= 1 ? 100 / aspect : 100;

  return (
    <span className="flex h-[54px] w-full items-center justify-center rounded bg-surface-muted">
      <svg viewBox="0 0 100 100" width={boxWidth * 0.5} height={boxHeight * 0.5} aria-hidden>
        <rect x="2" y="2" width="96" height="96" fill="rgb(var(--nv-primary) / 0.1)" />
        {/* Closed sides get a wall; open sides are left as the aisle they are. */}
        {spec.defaultWalls.includes('back') ? <line x1="2" y1="2" x2="98" y2="2" stroke="rgb(var(--nv-primary))" strokeWidth="5" /> : null}
        {spec.defaultWalls.includes('front') ? <line x1="2" y1="98" x2="98" y2="98" stroke="rgb(var(--nv-primary))" strokeWidth="5" /> : null}
        {spec.defaultWalls.includes('left') ? <line x1="2" y1="2" x2="2" y2="98" stroke="rgb(var(--nv-primary))" strokeWidth="5" /> : null}
        {spec.defaultWalls.includes('right') ? <line x1="98" y1="2" x2="98" y2="98" stroke="rgb(var(--nv-primary))" strokeWidth="5" /> : null}
      </svg>
    </span>
  );
}

/* ── My assets ─────────────────────────────────────────────────────────── */

function MineShelf() {
  const units = useEditor((s) => s.units);
  const cacheItems = useEditor((s) => s.cacheItems);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['assets', 'imported'],
    queryFn: () => assets.imported(),
    staleTime: 60_000,
  });

  useMemo(() => {
    if (items.length) cacheItems(items);
    return null;
  }, [items, cacheItems]);

  if (isLoading) return <SkeletonShelf />;

  if (!items.length) {
    return (
      <Shelf
        empty={
          <p className="max-w-md text-xs leading-relaxed text-ink-subtle">
            Nothing imported yet. Open <strong>Create → 3D Models → Online</strong> and drag anything into the plan —
            it is copied here, measured, and available in every project afterwards.
          </p>
        }
      >
        {null}
      </Shelf>
    );
  }

  return (
    <Shelf>
      {items.map((item) => (
        <figure
          key={item.id}
          {...draggableProps({ kind: 'catalog', item })}
          title={`${item.name} — drag into the plan`}
          className="w-[116px] shrink-0 cursor-grab overflow-hidden rounded-lg border border-line bg-surface transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-card active:cursor-grabbing"
        >
          <LazyImage
            src={item.previewImage}
            alt={item.name}
            ratio="1 / 1"
            wrapperClassName="w-full"
            fallback={<Box className="h-4 w-4 text-ink-subtle/60" />}
          />
          <figcaption className="border-t border-line px-1.5 py-1">
            <span className="block truncate text-[10px] font-semibold text-ink">{item.name}</span>
            <span className="block truncate text-[9px] tabular-nums text-ink-subtle">
              {item.widthMm ? `${(item.widthMm / (units === 'metric' ? 1000 : 25.4)).toFixed(2)} ${units === 'metric' ? 'm' : 'in'}` : ''}
            </span>
          </figcaption>
        </figure>
      ))}
    </Shelf>
  );
}

/* ── Certified designers ───────────────────────────────────────────────── */

/**
 * People, not assets.
 *
 * On the same strip because it belongs to the same question — "I need this to
 * exist and I am not going to build it myself" — and because the moment a
 * designer realises they are out of their depth is the moment they are looking
 * at the plan, not at a marketing page.
 */
function DesignerShelf() {
  const { data: specialists = [], isLoading } = useQuery({
    queryKey: ['specialists', 'strip'],
    queryFn: () => spatial.specialists.list({ limit: 12 }),
    staleTime: 10 * 60_000,
  });

  if (isLoading) return <SkeletonShelf />;

  if (!specialists.length) {
    return (
      <Shelf
        empty={
          <p className="max-w-md text-xs leading-relaxed text-ink-subtle">
            No specialists listed for your region yet.{' '}
            <Link to="/specialists" className="font-semibold text-primary hover:underline">
              Browse the full directory
            </Link>{' '}
            or list yourself.
          </p>
        }
      >
        {null}
      </Shelf>
    );
  }

  return (
    <Shelf>
      {specialists.map((person) => {
        const availability = AVAILABILITY_INFO[person.availability];
        return (
          <Link
            key={person.id}
            to="/specialists"
            className="flex w-[212px] shrink-0 gap-2.5 rounded-lg border border-line bg-surface p-2.5 transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-card"
          >
            {person.avatarUrl ? (
              <img src={person.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[13px] font-bold text-primary">
                {person.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1">
                <span className="truncate text-[11px] font-semibold text-ink">{person.name}</span>
                {person.verified ? <UserCheck className="h-3 w-3 shrink-0 text-primary" /> : null}
              </span>
              <span className="block truncate text-[9px] text-ink-subtle">{person.headline}</span>
              <span className="mt-1 flex flex-wrap gap-1">
                <span
                  className={`badge ${
                    availability.tone === 'success'
                      ? 'badge-success'
                      : availability.tone === 'warning'
                        ? 'badge-warning'
                        : 'badge-neutral'
                  }`}
                >
                  {availability.label}
                </span>
                {person.skills[0] ? (
                  <span className="badge-neutral">{SPECIALIST_SKILL_LABELS[person.skills[0]]}</span>
                ) : null}
              </span>
            </span>
          </Link>
        );
      })}
    </Shelf>
  );
}

function SkeletonShelf() {
  return (
    <div className="flex gap-2 px-3 py-2.5" aria-hidden>
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="h-[104px] w-[188px] shrink-0 rounded-lg border border-line">
          <div className="nv-shimmer h-full w-full rounded-lg bg-surface-muted" />
        </div>
      ))}
    </div>
  );
}
