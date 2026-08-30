import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Globe, Inbox, MapPin, Search, Send, Star, UserCog } from 'lucide-react';
import {
  AVAILABILITY_INFO,
  REGION_PACKS,
  SPECIALIST_SKILLS,
  SPECIALIST_SKILL_LABELS,
  type SpecialistAvailability,
  type SpecialistDto,
  type SpecialistSkill,
} from '@novira/shared';
import { AppShell } from '../components/AppShell';
import { PageBanner } from '../components/PageBanner';
import { spatial } from '../lib/spatialApi';
import { api } from '../lib/api';
import { Modal } from '../components/Modal';
import { useSession } from '../store/session';
import { CardSkeletons, EmptyState, Field, Money, Select, Tabs, TextInput, Toggle, toast } from '../components/ui';

/**
 * Specialists.
 *
 * "Hire a spatial specialist inside Novira" — the brief's platform play. What
 * makes it work rather than being a directory is that a request carries the
 * plan: a view-only share link is minted with it, so the specialist opens the
 * actual layout rather than asking for a PDF.
 *
 * The link is revoked automatically when a request is declined or withdrawn,
 * which is the part a directory bolted onto a chat would never do.
 */
export function SpecialistsPage() {
  const [tab, setTab] = useState<'find' | 'requests' | 'profile'>('find');
  const { data: requests } = useQuery({ queryKey: ['specialist-requests'], queryFn: () => spatial.specialists.requests() });
  const pending = (requests?.received ?? []).filter((r) => r.status === 'open').length;

  return (
    <AppShell>
      <PageBanner
        slot="specialists-hero"
        title="Specialists"
        lead="Designers, riggers, draughtsmen and visualisers who can take on part of a job. A request carries the plan with it, so nobody starts by asking what the room looks like."
      />

      <div className="mb-5">
        <Tabs
          tabs={[
            { value: 'find', label: 'Find someone', icon: <Search className="h-3 w-3" /> },
            { value: 'requests', label: 'Requests', count: pending, icon: <Inbox className="h-3 w-3" /> },
            { value: 'profile', label: 'Your profile', icon: <UserCog className="h-3 w-3" /> },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'find' ? <Directory /> : null}
      {tab === 'requests' ? <Requests /> : null}
      {tab === 'profile' ? <Profile /> : null}
    </AppShell>
  );
}

/* ── Directory ─────────────────────────────────────────────────────────── */

function Directory() {
  const [query, setQuery] = useState('');
  const [skill, setSkill] = useState<SpecialistSkill | ''>('');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(true);
  const [hiring, setHiring] = useState<SpecialistDto | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['specialists', query, skill, remoteOnly, availableOnly],
    queryFn: () =>
      spatial.specialists.list({
        q: query || undefined,
        skill: skill || undefined,
        remoteOnly: remoteOnly || undefined,
        availableOnly: availableOnly || undefined,
      }),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
          <input
            className="input pl-9"
            placeholder="Name or headline…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search specialists"
          />
        </div>
        <select className="select w-auto" value={skill} onChange={(e) => setSkill(e.target.value as SpecialistSkill | '')} aria-label="Skill">
          <option value="">Any skill</option>
          {SPECIALIST_SKILLS.map((s) => (
            <option key={s} value={s}>
              {SPECIALIST_SKILL_LABELS[s]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-muted">
          <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} /> Remote
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink-muted">
          <input type="checkbox" checked={availableOnly} onChange={(e) => setAvailableOnly(e.target.checked)} /> Available
        </label>
      </div>

      {isLoading ? (
        <CardSkeletons label="Loading specialists" />
      ) : data?.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((specialist) => (
            <article key={specialist.id} className="card flex flex-col">
              <div className="flex items-start gap-3">
                {specialist.avatarUrl ? (
                  <img src={specialist.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full border border-line object-cover" />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                    {specialist.name.charAt(0)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold text-ink">
                    {specialist.name}
                    {specialist.verified ? <span className="badge-success ml-1.5">Verified</span> : null}
                  </h2>
                  <p className="truncate text-xs text-ink-muted">{specialist.headline}</p>
                </div>
              </div>

              <p className="mt-2 line-clamp-3 text-xs leading-snug text-ink-muted">{specialist.bio}</p>

              <div className="mt-2 flex flex-wrap gap-1">
                {specialist.skills.slice(0, 4).map((s) => (
                  <span key={s} className="chip">
                    {SPECIALIST_SKILL_LABELS[s]}
                  </span>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-subtle">
                <span
                  className={
                    AVAILABILITY_INFO[specialist.availability].tone === 'success'
                      ? 'badge-success'
                      : AVAILABILITY_INFO[specialist.availability].tone === 'warning'
                        ? 'badge-warning'
                        : 'badge-neutral'
                  }
                >
                  {AVAILABILITY_INFO[specialist.availability].label}
                </span>
                {specialist.remote ? (
                  <span className="chip">
                    <Globe className="h-3 w-3" /> Remote
                  </span>
                ) : null}
                {specialist.city ? (
                  <span className="chip">
                    <MapPin className="h-3 w-3" /> {specialist.city}
                  </span>
                ) : null}
                {specialist.rating !== null ? (
                  <span className="chip">
                    <Star className="h-3 w-3" /> {specialist.rating}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                <span className="text-sm font-semibold text-ink">
                  {specialist.dayRate ? (
                    <>
                      <Money minor={specialist.dayRate} currency={specialist.currency} />
                      <span className="text-xs font-normal text-ink-subtle"> /day</span>
                    </>
                  ) : (
                    <span className="text-xs font-normal text-ink-muted">Rate on application</span>
                  )}
                </span>
                <button
                  type="button"
                  className="btn-primary btn-sm ml-auto"
                  onClick={() => setHiring(specialist)}
                  disabled={specialist.availability === 'booked'}
                >
                  <Briefcase className="h-3.5 w-3.5" /> Send a brief
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Briefcase className="h-8 w-8" />}
          title="Nobody listed yet"
          description="As people publish their profiles they appear here. If you take on work yourself, put your own profile up under Your profile."
        />
      )}

      {hiring ? <HireModal specialist={hiring} onClose={() => setHiring(null)} /> : null}
    </>
  );
}

function HireModal({ specialist, onClose }: { specialist: SpecialistDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [skill, setSkill] = useState<SpecialistSkill>(specialist.skills[0] ?? 'spatial-design');
  const [brief, setBrief] = useState('');
  const [budget, setBudget] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [projectId, setProjectId] = useState<number | ''>('');
  const [planId, setPlanId] = useState<number | ''>('');
  const [sharePlan, setSharePlan] = useState(true);

  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: api.projects.list });
  const { data: plans } = useQuery({
    queryKey: ['plans', projectId],
    queryFn: () => api.plans.listByProject(Number(projectId)),
    enabled: Boolean(projectId),
  });

  const send = useMutation({
    mutationFn: () =>
      spatial.specialists.request({
        specialistId: specialist.id,
        skill,
        brief,
        budget: budget ? Math.round(Number(budget) * 100) : null,
        currency: specialist.currency,
        neededBy: neededBy ? new Date(neededBy).toISOString() : undefined,
        projectId: projectId || undefined,
        planId: planId || undefined,
        sharePlan,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['specialist-requests'] });
      toast(
        'success',
        result.shareUrl
          ? 'Brief sent, with a view-only link to the plan. It is revoked automatically if the request is declined.'
          : 'Brief sent.'
      );
      onClose();
    },
    onError: () => toast('error', 'Could not send that brief.'),
  });

  return (
    <Modal
      open
      title={`Brief ${specialist.name}`}
      description="A request carries the plan with it, so nobody starts by asking what the room looks like."
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => send.mutate()} disabled={!brief.trim() || send.isPending}>
            <Send className="h-4 w-4" /> Send the brief
          </button>
        </>
      }
    >
      <Field label="What do you need?">
        <Select value={skill} onChange={(e) => setSkill(e.target.value as SpecialistSkill)}>
          {specialist.skills.map((s) => (
            <option key={s} value={s}>
              {SPECIALIST_SKILL_LABELS[s]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="The brief" hint="What the job is, what the deadline is, and what 'done' looks like.">
        <textarea
          className="input min-h-28 resize-y"
          value={brief}
          placeholder="We need the stand at Hall 3 detailed for fabrication — dimensioned drawings and a cut list."
          onChange={(e) => setBrief(e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Budget" hint={`Optional, in ${specialist.currency.toUpperCase()}.`}>
          <TextInput type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} />
        </Field>
        <Field label="Needed by">
          <TextInput type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
        </Field>
      </div>

      <Field label="Project">
        <Select
          value={String(projectId)}
          onChange={(e) => {
            setProjectId(Number(e.target.value) || '');
            setPlanId('');
          }}
        >
          <option value="">None</option>
          {(projects ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </Select>
      </Field>

      {projectId ? (
        <Field label="Plan">
          <Select value={String(planId)} onChange={(e) => setPlanId(Number(e.target.value) || '')}>
            <option value="">None</option>
            {(plans ?? []).map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.title}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {planId ? (
        <Toggle
          label="Share the plan"
          checked={sharePlan}
          onChange={setSharePlan}
          hint="Mints a view-only link. It is revoked automatically if the request is declined or you withdraw it."
        />
      ) : null}
    </Modal>
  );
}

/* ── Requests ──────────────────────────────────────────────────────────── */

function Requests() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['specialist-requests'], queryFn: () => spatial.specialists.requests() });

  const respond = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => spatial.specialists.respond(id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['specialist-requests'] });
      toast('success', 'Updated.');
    },
  });

  const sent = data?.sent ?? [];
  const received = data?.received ?? [];

  if (!sent.length && !received.length) {
    return (
      <EmptyState
        icon={<Inbox className="h-8 w-8" />}
        title="No requests"
        description="Briefs you send and briefs sent to you both appear here, with the plan attached to each one."
      />
    );
  }

  return (
    <div className="space-y-6">
      {received.length ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Sent to you</h2>
          <div className="space-y-2">
            {received.map((request) => (
              <RequestRow
                key={String(request.id)}
                request={request}
                incoming
                onRespond={(status) => respond.mutate({ id: Number(request.id), status })}
              />
            ))}
          </div>
        </section>
      ) : null}

      {sent.length ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">You sent</h2>
          <div className="space-y-2">
            {sent.map((request) => (
              <RequestRow
                key={String(request.id)}
                request={request}
                incoming={false}
                onRespond={(status) => respond.mutate({ id: Number(request.id), status })}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RequestRow({
  request,
  incoming,
  onRespond,
}: {
  request: Record<string, unknown>;
  incoming: boolean;
  onRespond: (status: string) => void;
}) {
  const status = String(request.status);
  return (
    <article className="card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">
            {SPECIALIST_SKILL_LABELS[String(request.skill) as SpecialistSkill] ?? String(request.skill)}
            {incoming ? ` — from ${String(request.requesterName ?? 'a client')}` : ` — ${String(request.specialistName)}`}
          </h3>
          <p className="text-xs text-ink-subtle">
            {request.planTitle ? `${String(request.planTitle)} · ` : ''}
            {new Date(String(request.createdAt)).toLocaleDateString()}
            {request.neededBy ? ` · needed by ${new Date(String(request.neededBy)).toLocaleDateString()}` : ''}
          </p>
        </div>
        <span
          className={
            status === 'accepted'
              ? 'badge-success'
              : status === 'declined' || status === 'cancelled'
                ? 'badge-danger'
                : status === 'completed'
                  ? 'badge-info'
                  : 'badge-warning'
          }
        >
          {status}
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">{String(request.brief)}</p>

      {request.budget ? (
        <p className="mt-1 text-xs text-ink-subtle">
          Budget: <Money minor={Number(request.budget)} currency={String(request.currency)} />
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
        {request.shareUrl ? (
          <a href={String(request.shareUrl)} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
            Open the plan
          </a>
        ) : null}
        {incoming && status === 'open' ? (
          <>
            <button type="button" className="btn-primary btn-sm" onClick={() => onRespond('accepted')}>
              Accept
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => onRespond('declined')}>
              Decline
            </button>
          </>
        ) : null}
        {incoming && status === 'accepted' ? (
          <button type="button" className="btn-primary btn-sm" onClick={() => onRespond('completed')}>
            Mark complete
          </button>
        ) : null}
        {!incoming && status === 'open' ? (
          <button type="button" className="btn-ghost btn-sm text-danger" onClick={() => onRespond('cancelled')}>
            Withdraw
          </button>
        ) : null}
      </div>
    </article>
  );
}

/* ── Profile ───────────────────────────────────────────────────────────── */

function Profile() {
  const queryClient = useQueryClient();
  const user = useSession((s) => s.user);
  const { data: existing } = useQuery({ queryKey: ['specialist-me'], queryFn: () => spatial.specialists.me() });

  const [draft, setDraft] = useState<Partial<SpecialistDto> | null>(null);
  const profile = draft ?? existing ?? null;

  const save = useMutation({
    mutationFn: () =>
      spatial.specialists.saveMe({
        name: profile?.name ?? `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim(),
        headline: profile?.headline ?? '',
        bio: profile?.bio ?? '',
        skills: profile?.skills?.length ? profile.skills : ['spatial-design'],
        dayRate: profile?.dayRate ?? null,
        currency: profile?.currency ?? 'usd',
        regionCode: profile?.regionCode ?? 'global',
        city: profile?.city ?? '',
        country: profile?.country ?? '',
        remote: profile?.remote ?? true,
        availability: profile?.availability ?? 'available',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['specialist-me'] });
      void queryClient.invalidateQueries({ queryKey: ['specialists'] });
      toast('success', 'Profile saved. You are now listed in the directory.');
    },
    onError: () => toast('error', 'Could not save your profile.'),
  });

  const set = <K extends keyof SpecialistDto>(key: K, value: SpecialistDto[K]) =>
    setDraft((d) => ({ ...(d ?? existing ?? {}), [key]: value }));

  const toggleSkill = (skill: SpecialistSkill) => {
    const current = profile?.skills ?? [];
    set('skills', current.includes(skill) ? current.filter((s) => s !== skill) : [...current, skill]);
  };

  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-sm text-ink-muted">
        {existing
          ? 'You are listed in the directory. Keep your availability current — a profile that says "available" and is not is the fastest way to lose a repeat client.'
          : 'Publish a profile and other agencies can send you briefs, with the plan attached.'}
      </p>

      <Field label="Name">
        <TextInput
          value={profile?.name ?? `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim()}
          onChange={(e) => set('name', e.target.value)}
        />
      </Field>
      <Field label="Headline" hint="One line. What you do and who for.">
        <TextInput
          value={profile?.headline ?? ''}
          placeholder="Exhibition stand designer — 12 years, UK and Gulf shows"
          onChange={(e) => set('headline', e.target.value)}
        />
      </Field>
      <Field label="About">
        <textarea
          className="input min-h-28 resize-y"
          value={profile?.bio ?? ''}
          onChange={(e) => set('bio', e.target.value)}
        />
      </Field>

      <Field label="What you do" hint="Pick everything you would take a brief for.">
        <div className="flex flex-wrap gap-1">
          {SPECIALIST_SKILLS.map((skill) => (
            <button
              key={skill}
              type="button"
              onClick={() => toggleSkill(skill)}
              aria-pressed={(profile?.skills ?? []).includes(skill)}
              className={`chip ${(profile?.skills ?? []).includes(skill) ? 'chip-active' : ''}`}
            >
              {SPECIALIST_SKILL_LABELS[skill]}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Day rate" hint="Leave blank for 'on application'.">
          <TextInput
            type="number"
            min={0}
            value={profile?.dayRate ? Math.round(profile.dayRate / 100) : ''}
            onChange={(e) => set('dayRate', e.target.value ? Math.round(Number(e.target.value) * 100) : null)}
          />
        </Field>
        <Field label="Currency">
          <TextInput
            value={(profile?.currency ?? 'usd').toUpperCase()}
            maxLength={3}
            onChange={(e) => set('currency', e.target.value.toLowerCase())}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="City">
          <TextInput value={profile?.city ?? ''} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Market">
          <Select value={profile?.regionCode ?? 'global'} onChange={(e) => set('regionCode', e.target.value)}>
            {REGION_PACKS.map((pack) => (
              <option key={pack.code} value={pack.code}>
                {pack.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Toggle
        label="Work remotely"
        checked={profile?.remote ?? true}
        onChange={(remote) => set('remote', remote)}
        hint="Remote specialists appear in every market's search, not just their own."
      />

      <Field label="Availability">
        <Select
          value={profile?.availability ?? 'available'}
          onChange={(e) => set('availability', e.target.value as SpecialistAvailability)}
        >
          {(Object.keys(AVAILABILITY_INFO) as SpecialistAvailability[]).map((key) => (
            <option key={key} value={key}>
              {AVAILABILITY_INFO[key].label} — {AVAILABILITY_INFO[key].note}
            </option>
          ))}
        </Select>
      </Field>

      <button type="button" className="btn-primary mt-3" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? 'Saving…' : existing ? 'Update profile' : 'Publish profile'}
      </button>
    </div>
  );
}
