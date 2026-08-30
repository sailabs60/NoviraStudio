import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Eye, Palette, Upload } from 'lucide-react';
import { DEFAULT_WHITE_LABEL, whiteLabelReadiness, type WhiteLabelSettings } from '@novira/shared';
import { AppShell } from '../components/AppShell';
import { spatial } from '../lib/spatialApi';
import { http } from '../lib/api';
import { useSession } from '../store/session';
import { EmptyState, Field, FindingCard, RowSkeletons, Section, TextInput, Toggle, toast } from '../components/ui';

/**
 * White label.
 *
 * The point is that an agency can put this in front of their own client without
 * it looking like someone else's tool. That means three surfaces have to change
 * together — the app chrome, the share link a client opens, and the PDF that
 * lands in their inbox — because branding half of them reads worse than
 * branding none of them.
 *
 * The switch is therefore gated on the pieces that are actually visible to a
 * client, and the page says which are missing rather than refusing silently.
 */
export function WhiteLabelPage() {
  const queryClient = useQueryClient();
  const user = useSession((s) => s.user);
  const [draft, setDraft] = useState<WhiteLabelSettings | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['white-label'],
    queryFn: () => spatial.whiteLabel.get(),
    enabled: Boolean(user?.company),
  });

  useEffect(() => {
    if (data && !draft) setDraft(data.settings);
  }, [data, draft]);

  const save = useMutation({
    mutationFn: () => spatial.whiteLabel.save({ ...(draft ?? DEFAULT_WHITE_LABEL) }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['white-label'] });
      setDraft(result.settings);
      toast('success', result.settings.enabled ? 'White label is on.' : 'Settings saved.');
    },
    onError: (error) => toast('error', error instanceof Error ? error.message : 'Could not save.'),
  });

  if (!user?.company) {
    return (
      <AppShell>
        <EmptyState
          icon={<Palette className="h-8 w-8" />}
          title="White label needs a company workspace"
          description="Convert your account to a company workspace under Account, and you can put your own brand on every client-facing surface: the app, share links and exported documents."
        />
      </AppShell>
    );
  }

  if (isLoading || !draft) {
    return (
      <AppShell>
        <RowSkeletons label="Loading your brand settings" />
      </AppShell>
    );
  }

  const set = <K extends keyof WhiteLabelSettings>(key: K, value: WhiteLabelSettings[K]) =>
    setDraft((d) => ({ ...(d ?? DEFAULT_WHITE_LABEL), [key]: value }));

  const readiness = whiteLabelReadiness(draft);

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await http.post<{ url: string }>('/branding/images/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      set('logoUrl', response.data.url);
      toast('success', 'Logo uploaded.');
    } catch {
      toast('error', 'Could not upload that image.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <AppShell>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink">White label</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Put your own brand on everything a client sees: the app chrome, the share link they open, and the PDF that
          lands in their inbox. All three change together — branding one of them and not the others reads worse than
          branding none.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,480px)_1fr]">
        <div>
          <Section title="Your brand">
            <Field label="Brand name" hint="Shown wherever Novira's name would otherwise appear.">
              <TextInput value={draft.brandName} onChange={(e) => set('brandName', e.target.value)} />
            </Field>

            <Field label="Logo" hint="A wide logo works best. PNG with transparency, at least 400 px across.">
              <div className="flex items-center gap-2">
                {draft.logoUrl ? (
                  <img src={draft.logoUrl} alt="Your logo" className="h-10 rounded border border-line bg-white p-1" />
                ) : null}
                <label className="btn-secondary btn-sm cursor-pointer">
                  <Upload className="h-3.5 w-3.5" />
                  {uploading ? 'Uploading…' : draft.logoUrl ? 'Replace' : 'Upload'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadLogo(file);
                    }}
                  />
                </label>
                {draft.logoUrl ? (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => set('logoUrl', null)}>
                    Remove
                  </button>
                ) : null}
              </div>
            </Field>

            <Field label="Accent colour" hint="The rest of the palette derives from it.">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={draft.primaryColor}
                  onChange={(e) => set('primaryColor', e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-line bg-transparent"
                  aria-label="Accent colour"
                />
                <TextInput value={draft.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} />
              </div>
            </Field>
          </Section>

          <Section title="Contact" description="A client reading a shared proposal needs somewhere to reply.">
            <Field label="Contact email">
              <TextInput
                type="email"
                value={draft.contactEmail}
                placeholder="hello@youragency.com"
                onChange={(e) => set('contactEmail', e.target.value)}
              />
            </Field>
            <Field label="Phone">
              <TextInput value={draft.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
            </Field>
            <Field label="Website">
              <TextInput value={draft.website} placeholder="youragency.com" onChange={(e) => set('website', e.target.value)} />
            </Field>
            <Field label="Document footer" hint="Printed at the bottom of every exported document.">
              <TextInput
                value={draft.footerText}
                placeholder="Your Agency Ltd · Registered in England 12345678"
                onChange={(e) => set('footerText', e.target.value)}
              />
            </Field>
          </Section>

          <Section title="Switch it on">
            <Toggle
              label="Remove the Novira credit"
              checked={draft.hidePlatformCredit}
              onChange={(hidePlatformCredit) => set('hidePlatformCredit', hidePlatformCredit)}
              hint="Takes the “Made with Novira” line off share links and exported documents."
            />
            <Toggle
              label="White label is on"
              checked={draft.enabled}
              onChange={(enabled) => set('enabled', enabled)}
              hint="Applies your brand to the app, share links and exports."
            />

            {!readiness.ready ? (
              <FindingCard
                severity="warning"
                title="Not ready to switch on yet"
                detail={`Still needed: ${readiness.missing.join(', ')}.`}
                action="Fill these in above. Turning it on without them would put a gap where your brand should be, on the page a client sees first."
              />
            ) : (
              <FindingCard
                severity="success"
                title="Ready"
                detail="Your brand will appear on the app chrome, every share link and every exported PDF."
              />
            )}

            <button
              type="button"
              className="btn-primary mt-2 w-full justify-center"
              onClick={() => save.mutate()}
              disabled={save.isPending || (draft.enabled && !readiness.ready)}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </Section>
        </div>

        <div>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
            <Eye className="h-4 w-4" /> What a client sees
          </h2>

          <div className="space-y-4">
            <Preview title="A shared plan">
              <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: '#e5e7eb' }}>
                {draft.logoUrl ? (
                  <img src={draft.logoUrl} alt="" className="h-5" />
                ) : (
                  <span className="text-sm font-bold" style={{ color: draft.primaryColor }}>
                    {draft.brandName || 'Your brand'}
                  </span>
                )}
                <span className="ml-auto text-[10px] text-gray-500">Grand Ballroom — Option A</span>
              </div>
              <div className="flex h-24 items-center justify-center bg-gray-100 text-[10px] text-gray-400">
                the 3D plan
              </div>
              {!draft.hidePlatformCredit ? (
                <p className="px-3 py-1.5 text-center text-[9px] text-gray-400">Made with Novira</p>
              ) : null}
            </Preview>

            <Preview title="A proposal PDF">
              <div className="p-3" style={{ borderTop: `4px solid ${draft.primaryColor}` }}>
                <div className="flex items-center justify-between">
                  {draft.logoUrl ? (
                    <img src={draft.logoUrl} alt="" className="h-6" />
                  ) : (
                    <span className="text-sm font-bold text-gray-900">{draft.brandName || 'Your brand'}</span>
                  )}
                  <span className="text-[9px] text-gray-500">Proposal · 14 March</span>
                </div>
                <div className="mt-3 space-y-1">
                  <div className="h-1.5 w-3/4 rounded bg-gray-200" />
                  <div className="h-1.5 w-full rounded bg-gray-100" />
                  <div className="h-1.5 w-5/6 rounded bg-gray-100" />
                </div>
                <p className="mt-3 border-t pt-1.5 text-[8px] text-gray-400" style={{ borderColor: '#e5e7eb' }}>
                  {[draft.brandName, draft.footerText, draft.contactEmail].filter(Boolean).join(' · ') || 'Your footer'}
                  {!draft.hidePlatformCredit ? ' · Made with Novira' : ''}
                </p>
              </div>
            </Preview>

            <Preview title="The app, for your team">
              <div className="flex items-center gap-2 px-3 py-2" style={{ background: draft.primaryColor }}>
                {draft.logoUrl ? (
                  <img src={draft.logoUrl} alt="" className="h-4 brightness-0 invert" />
                ) : (
                  <span className="text-xs font-bold text-white">{draft.brandName || 'Your brand'}</span>
                )}
                <span className="ml-auto text-[9px] text-white/70">Projects · Catalogue · Venues</span>
              </div>
              <div className="flex h-16 items-center justify-center bg-gray-50 text-[10px] text-gray-400">
                the workspace
              </div>
            </Preview>
          </div>

          <div className="mt-4 rounded-lg border border-line bg-surface-muted/40 p-3">
            <p className="flex items-start gap-2 text-xs leading-snug text-ink-muted">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              White label changes what your clients and your team see. It does not change billing, support or the terms
              you are on — Novira is still the supplier behind it.
            </p>
          </div>

          {data?.settings.enabled ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-success">
              <Check className="h-3.5 w-3.5" /> White label is currently active on every client-facing surface.
            </p>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

function Preview({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <figure>
      <figcaption className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{title}</figcaption>
      <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">{children}</div>
    </figure>
  );
}
