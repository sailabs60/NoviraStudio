/**
 * AI Document Generation.
 *
 * "Create professional documents instantly from your event details."
 *
 * A list of the documents a plan can produce, each with one button. The
 * reference shows exactly this: a row per document, an icon, a line of what it
 * contains, and Download.
 *
 * Nothing here is invented. Every figure comes from the drawing — the take-off
 * measures the plan, the rate card prices it, and the design brief supplies the
 * concept and the reasoning. A proposal whose numbers cannot be traced is one a
 * procurement team will challenge, which is why each row says where its
 * contents come from.
 */
import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Loader2, Presentation } from 'lucide-react';
import { useEditor } from '../../editorStore';
import { spatial } from '../../../lib/spatialApi';
import { toast } from '../../../components/ui';

type Kind = 'deck' | 'quantities' | 'drawing' | 'cad';

const DOCUMENTS: Array<{
  id: Kind;
  label: string;
  note: string;
  icon: typeof FileText;
  tint: string;
}> = [
  {
    id: 'deck',
    label: 'Client proposal',
    note: 'The concept, why it is laid out this way, renders, quantities and commercials.',
    icon: Presentation,
    tint: 'text-danger',
  },
  {
    id: 'quantities',
    label: 'Bill of quantities',
    note: 'Every line measured from the drawing — LED, truss, carpet, print, labour.',
    icon: FileSpreadsheet,
    tint: 'text-primary',
  },
  {
    id: 'drawing',
    label: 'Technical drawing',
    note: 'A dimensioned plan of the room, to scale.',
    icon: FileText,
    tint: 'text-ink-muted',
  },
  {
    id: 'cad',
    label: 'CAD export',
    note: 'DXF for a production team to work from.',
    icon: FileText,
    tint: 'text-ink-muted',
  },
];

export function AiDocumentsTab() {
  const planId = useEditor((s) => s.planId);
  const designBrief = useEditor((s) => s.scene.designBrief);
  const objectCount = useEditor((s) => s.scene.objects.length);
  const setWorkPanel = useEditor((s) => s.setWorkPanel);
  const [busy, setBusy] = useState<Kind | null>(null);

  const make = async (kind: Kind) => {
    if (!planId) {
      toast('error', 'Save the plan first.');
      return;
    }
    setBusy(kind);
    try {
      if (kind === 'deck') {
        const deck = await spatial.deck(planId, { includePrices: true });
        toast('success', `${deck.slides.length}-page proposal built. Open Present to review and export it.`, {
          label: 'Open',
          onClick: () => setWorkPanel('present'),
        });
        return;
      }
      // The rest already have their own export surfaces; this is the way in.
      setWorkPanel('present');
      toast('info', 'Exports live under Present, where you can set the sheet size and scale.');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : 'Could not build that document.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="ai-card">
        <h3 className="ai-card-title">AI Document Generation</h3>
        <p className="ai-card-note">Create professional documents instantly from your event details.</p>

        {designBrief ? (
          <div className="ai-hint mt-3">
            Built from this plan's brief — “{designBrief.prompt.slice(0, 90)}
            {designBrief.prompt.length > 90 ? '…' : ''}” — and its {objectCount} measured objects.
          </div>
        ) : (
          <p className="ai-card-note">
            Every figure is measured from the drawing rather than estimated. Generate a concept first and the
            proposal will carry it, along with the reason behind each decision.
          </p>
        )}
      </div>

      <div className="space-y-2">
        {DOCUMENTS.map((document) => {
          const Icon = document.icon;
          return (
            <div
              key={document.id}
              className="flex items-center gap-2.5 rounded-xl border border-line bg-surface p-3"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted">
                <Icon className={`h-4 w-4 ${document.tint}`} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-ink">{document.label}</span>
                <span className="block text-[11px] leading-snug text-ink-muted">{document.note}</span>
              </span>
              <button
                type="button"
                className="ai-btn shrink-0 px-2.5 py-1.5 text-[11px]"
                onClick={() => make(document.id)}
                disabled={busy !== null}
              >
                {busy === document.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Build
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
