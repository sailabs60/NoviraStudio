import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ClipboardPaste, Search, Trash2, UserPlus, X } from 'lucide-react';
import { http, ApiClientError } from '../lib/api';
import { AppShell } from '../components/AppShell';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';

/**
 * The guest list.
 *
 * Belongs to the event, not to a layout: a planner will try several seating
 * arrangements for the same people, and duplicating the list for each one is
 * how names get lost.
 *
 * The paste importer exists because guest lists arrive as spreadsheets, every
 * time. It maps columns by header rather than by position, so a list with the
 * columns in a different order still works, and it reports rows it could not
 * read rather than dropping them — a guest quietly missing is the exact failure
 * this page is meant to prevent.
 */

interface Guest {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  partyName: string | null;
  guestGroup: string | null;
  rsvp: 'pending' | 'yes' | 'no' | 'maybe';
  mealChoice: string | null;
  dietary: string | null;
  accessibility: string | null;
  isChild: boolean;
  isVendorGuest: boolean;
  notes: string | null;
}

const RSVP_LABELS: Record<Guest['rsvp'], string> = {
  yes: 'Attending',
  no: 'Declined',
  maybe: 'Maybe',
  pending: 'No reply',
};

const RSVP_TONES: Record<Guest['rsvp'], string> = {
  yes: 'bg-emerald-500/15 text-emerald-300',
  no: 'bg-rose-500/15 text-rose-300',
  maybe: 'bg-amber-500/15 text-amber-300',
  pending: 'bg-surface-muted text-ink-muted',
};

/**
 * Read pasted spreadsheet rows.
 *
 * Headers are matched loosely — "First Name", "first_name" and "Given name"
 * all mean the same thing to a planner, and refusing the paste over a header
 * spelling is not a defensible reason to make someone retype 200 names.
 */
function parsePaste(text: string): Array<Record<string, unknown>> {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 1) return [];

  const delimiter = lines[0]!.includes('\t') ? '\t' : ',';
  const split = (line: string) =>
    line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''));

  const headers = split(lines[0]!).map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
  const known: Record<string, string> = {
    firstname: 'firstName', first: 'firstName', givenname: 'firstName', forename: 'firstName',
    lastname: 'lastName', last: 'lastName', surname: 'lastName', familyname: 'lastName',
    name: 'firstName',
    email: 'email', emailaddress: 'email',
    phone: 'phone', mobile: 'phone', telephone: 'phone',
    party: 'partyName', household: 'partyName', partyname: 'partyName', family: 'partyName',
    group: 'guestGroup', side: 'guestGroup', guestgroup: 'guestGroup', table: 'guestGroup',
    rsvp: 'rsvp', status: 'rsvp', attending: 'rsvp',
    meal: 'mealChoice', mealchoice: 'mealChoice', menu: 'mealChoice', food: 'mealChoice',
    dietary: 'dietary', diet: 'dietary', allergies: 'dietary', allergy: 'dietary',
    accessibility: 'accessibility', access: 'accessibility',
    notes: 'notes', note: 'notes', comments: 'notes',
  };

  // No recognisable header row: treat the whole paste as names.
  const mapped = headers.map((h) => known[h]);
  const hasHeader = mapped.some(Boolean);
  const body = hasHeader ? lines.slice(1) : lines;

  return body.map((line) => {
    const cells = split(line);
    const row: Record<string, unknown> = {};

    if (!hasHeader) {
      // "Firstname Lastname" in a single column is the common shape.
      const parts = cells[0]!.split(/\s+/);
      row.firstName = parts[0] ?? '';
      row.lastName = parts.slice(1).join(' ');
      return row;
    }

    for (const [index, key] of mapped.entries()) {
      if (!key) continue;
      const value = cells[index]?.trim();
      if (!value) continue;

      if (key === 'rsvp') {
        const v = value.toLowerCase();
        row.rsvp = /^(y|yes|attending|accept|going|true|1)/.test(v)
          ? 'yes'
          : /^(n|no|declin|not|false|0)/.test(v)
            ? 'no'
            : /^(m|maybe|tentative)/.test(v)
              ? 'maybe'
              : 'pending';
        continue;
      }
      row[key] = value;
    }

    // A single "name" column still has to yield a surname.
    if (row.firstName && !row.lastName && String(row.firstName).includes(' ')) {
      const parts = String(row.firstName).split(/\s+/);
      row.firstName = parts[0];
      row.lastName = parts.slice(1).join(' ');
    }
    if (!row.lastName) row.lastName = '';
    return row;
  });
}

export function GuestsPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [search, setSearch] = useState('');
  const [rsvpFilter, setRsvpFilter] = useState<'all' | Guest['rsvp']>('all');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [draft, setDraft] = useState({
    firstName: '', lastName: '', email: '', partyName: '', guestGroup: '',
    rsvp: 'pending' as Guest['rsvp'], mealChoice: '', dietary: '', accessibility: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['guests', projectId],
    queryFn: async () =>
      (await http.get<{ items: Guest[]; counts: Record<string, number> }>(
        `/projects/${projectId}/guests`
      )).data,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['guests', projectId] });

  const addGuest = useMutation({
    mutationFn: async () => (await http.post(`/projects/${projectId}/guests`, draft)).data,
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
      setDraft({ ...draft, firstName: '', lastName: '', email: '', mealChoice: '', dietary: '', accessibility: '' });
    },
    onError: (err) =>
      setNotice({ tone: 'error', text: err instanceof ApiClientError ? err.message : 'Could not add that guest.' }),
  });

  const importGuests = useMutation({
    mutationFn: async () =>
      (await http.post<{ created: number; rejected: Array<{ row: number; reason: string }> }>(
        `/projects/${projectId}/guests/import`,
        { rows: parsePaste(pasteText) }
      )).data,
    onSuccess: (result) => {
      invalidate();
      setImportOpen(false);
      setPasteText('');
      setNotice(
        result.rejected.length
          ? {
              tone: 'warning',
              text: `${result.created} guests added. ${result.rejected.length} rows could not be read: ${result.rejected
                .slice(0, 3)
                .map((r) => `row ${r.row} (${r.reason})`)
                .join(', ')}${result.rejected.length > 3 ? '…' : ''}`,
            }
          : { tone: 'success', text: `${result.created} guests added.` }
      );
    },
    onError: (err) =>
      setNotice({ tone: 'error', text: err instanceof ApiClientError ? err.message : 'Could not import.' }),
  });

  const setRsvp = useMutation({
    mutationFn: async ({ id, rsvp }: { id: number; rsvp: Guest['rsvp'] }) =>
      (await http.patch(`/guests/${id}`, { rsvp })).data,
    onSuccess: invalidate,
  });

  const removeGuest = useMutation({
    mutationFn: async (id: number) => (await http.delete(`/guests/${id}`)).data,
    onSuccess: invalidate,
  });

  const preview = useMemo(() => (pasteText.trim() ? parsePaste(pasteText) : []), [pasteText]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items ?? []).filter((g) => {
      if (rsvpFilter !== 'all' && g.rsvp !== rsvpFilter) return false;
      if (!q) return true;
      return `${g.firstName} ${g.lastName} ${g.partyName ?? ''} ${g.guestGroup ?? ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [data?.items, search, rsvpFilter]);

  if (isLoading) {
    return (
      <AppShell>
        <div className="py-24"><Spinner label="Loading the guest list…" /></div>
      </AppShell>
    );
  }

  const counts = data?.counts ?? {};

  return (
    <AppShell>
      <div className="mb-4 flex items-center gap-3">
        <Link to={`/projects/${projectId}`} className="icon-btn h-8 w-8" aria-label="Back to project">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-ink">Guest list</h1>
          <p className="text-xs text-ink-muted">
            {counts.total ?? 0} guests · {counts.yes ?? 0} attending · {counts.no ?? 0} declined ·{' '}
            {counts.pending ?? 0} no reply
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => setImportOpen(true)}>
          <ClipboardPaste className="h-3.5 w-3.5" /> Paste a list
        </button>
        <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
          <UserPlus className="h-3.5 w-3.5" /> Add guest
        </button>
      </div>

      {notice ? (
        <div className={`notice-${notice.tone} mb-4 flex items-start gap-2`}>
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
          <input
            className="input pl-8"
            placeholder="Search names, households or groups…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          {(['all', 'yes', 'pending', 'maybe', 'no'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRsvpFilter(key)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
                rsvpFilter === key
                  ? 'border-primary bg-primary/10 text-ink'
                  : 'border-line text-ink-muted hover:text-ink'
              }`}
            >
              {key === 'all' ? 'Everyone' : RSVP_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card py-16 text-center">
          <p className="text-sm text-ink-muted">
            {data?.items.length
              ? 'No guests match that filter.'
              : 'No guests yet. Paste a list from a spreadsheet, or add them one at a time.'}
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Household</th>
                <th className="px-3 py-2 font-semibold">RSVP</th>
                <th className="px-3 py-2 font-semibold">Meal</th>
                <th className="px-3 py-2 font-semibold">Requirements</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr key={g.id} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-medium text-ink">
                      {g.firstName} {g.lastName}
                    </span>
                    {g.isChild ? (
                      <span className="ml-1.5 text-[10px] uppercase text-ink-subtle">child</span>
                    ) : null}
                    {g.email ? <p className="text-xs text-ink-subtle">{g.email}</p> : null}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">
                    {g.partyName ?? '—'}
                    {g.guestGroup ? (
                      <p className="text-xs text-ink-subtle">{g.guestGroup}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className={`rounded px-1.5 py-1 text-xs font-semibold ${RSVP_TONES[g.rsvp]}`}
                      value={g.rsvp}
                      onChange={(e) =>
                        setRsvp.mutate({ id: g.id, rsvp: e.target.value as Guest['rsvp'] })
                      }
                    >
                      {(Object.keys(RSVP_LABELS) as Guest['rsvp'][]).map((k) => (
                        <option key={k} value={k}>
                          {RSVP_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{g.mealChoice ?? '—'}</td>
                  <td className="px-3 py-2">
                    {g.dietary ? (
                      <span className="mr-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-300">
                        {g.dietary}
                      </span>
                    ) : null}
                    {g.accessibility ? (
                      <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] text-sky-300">
                        {g.accessibility}
                      </span>
                    ) : null}
                    {!g.dietary && !g.accessibility ? (
                      <span className="text-ink-subtle">—</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="icon-btn h-7 w-7"
                      aria-label={`Remove ${g.firstName} ${g.lastName}`}
                      onClick={() => removeGuest.mutate(g.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add ─────────────────────────────────────────────────────────── */}
      <Modal
        open={addOpen}
        title="Add a guest"
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!draft.firstName.trim() || addGuest.isPending}
              onClick={() => addGuest.mutate()}
            >
              Add
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">First name</span>
            <input className="input" value={draft.firstName} autoFocus
              onChange={(e) => setDraft({ ...draft, firstName: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Last name</span>
            <input className="input" value={draft.lastName}
              onChange={(e) => setDraft({ ...draft, lastName: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Email</span>
            <input className="input" type="email" value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Household</span>
            <input className="input" value={draft.partyName} placeholder="Okafor family"
              onChange={(e) => setDraft({ ...draft, partyName: e.target.value })} />
            <p className="mt-1 text-xs text-ink-subtle">People in one household are seated together.</p>
          </label>
          <label className="block">
            <span className="label">Group</span>
            <input className="input" value={draft.guestGroup} placeholder="Bride, sales team…"
              onChange={(e) => setDraft({ ...draft, guestGroup: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">RSVP</span>
            <select className="input" value={draft.rsvp}
              onChange={(e) => setDraft({ ...draft, rsvp: e.target.value as Guest['rsvp'] })}>
              {(Object.keys(RSVP_LABELS) as Guest['rsvp'][]).map((k) => (
                <option key={k} value={k}>{RSVP_LABELS[k]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Meal</span>
            <input className="input" value={draft.mealChoice}
              onChange={(e) => setDraft({ ...draft, mealChoice: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Dietary</span>
            <input className="input" value={draft.dietary} placeholder="Nut allergy"
              onChange={(e) => setDraft({ ...draft, dietary: e.target.value })} />
          </label>
          <label className="block sm:col-span-2">
            <span className="label">Access requirements</span>
            <input className="input" value={draft.accessibility} placeholder="Wheelchair user, needs a step-free route"
              onChange={(e) => setDraft({ ...draft, accessibility: e.target.value })} />
          </label>
        </div>
      </Modal>

      {/* ── Paste import ────────────────────────────────────────────────── */}
      <Modal
        open={importOpen}
        title="Paste a guest list"
        description="Copy straight from a spreadsheet. Columns are matched by their headings, in any order."
        onClose={() => setImportOpen(false)}
        width="max-w-2xl"
        footer={
          <>
            <span className="mr-auto text-xs text-ink-subtle">
              {preview.length ? `${preview.length} rows read` : 'Nothing pasted yet'}
            </span>
            <button type="button" className="btn-secondary" onClick={() => setImportOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!preview.length || importGuests.isPending}
              onClick={() => importGuests.mutate()}
            >
              Import {preview.length || ''}
            </button>
          </>
        }
      >
        <textarea
          className="input min-h-[180px] resize-y font-mono text-xs"
          value={pasteText}
          placeholder={'First name\tLast name\tHousehold\tRSVP\tMeal\nAda\tOkafor\tOkafor family\tyes\tBeef'}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <p className="mt-2 text-xs text-ink-subtle">
          Recognised headings include name, email, phone, household, group, RSVP, meal, dietary and
          access. A single column of full names works too.
        </p>

        {preview.length ? (
          <div className="mt-3 max-h-48 overflow-y-auto rounded border border-line">
            <table className="w-full text-xs">
              <tbody>
                {preview.slice(0, 20).map((row, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0">
                    <td className="px-2 py-1 text-ink">
                      {String(row.firstName ?? '')} {String(row.lastName ?? '')}
                    </td>
                    <td className="px-2 py-1 text-ink-subtle">{String(row.partyName ?? '')}</td>
                    <td className="px-2 py-1 text-ink-subtle">{String(row.rsvp ?? 'pending')}</td>
                    <td className="px-2 py-1 text-ink-subtle">{String(row.mealChoice ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 20 ? (
              <p className="px-2 py-1 text-[11px] text-ink-subtle">
                …and {preview.length - 20} more
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </AppShell>
  );
}
