import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, FileDown, Presentation, Sparkles, Wand2 } from 'lucide-react';
import {
  DECK_FORMATS,
  SLIDE_KIND_INFO,
  type DeckSlide,
  type PresentationDeck,
} from '@novira/shared';
import { useEditor } from '../editorStore';
import { pollJob, spatial } from '../../lib/spatialApi';
import { drawingToPngDataUrl } from '../PlanDrawingCanvas';
import { EmptyState, Field, Section, Select, TextInput, Toggle, toast } from '../../components/ui';
import { exportDeckPdf } from '../exportDeck';

/**
 * The client deck.
 *
 * A tender submission is the same set of documents every time, and assembling
 * it by hand is where most of the five to ten hours per project goes — and
 * where the errors come from, because it is copying numbers between a drawing,
 * a spreadsheet and a slide.
 *
 * So the deck is generated from the plan and then edited, rather than written
 * and then checked. Any slide can be rewritten; the ones carrying measured
 * figures are regenerated from the drawing every time, so they cannot drift out
 * of step with it.
 */
export function DeckBuilder() {
  const planId = useEditor((s) => s.planId);
  const title = useEditor((s) => s.title);

  const [clientName, setClientName] = useState('');
  const [venueName, setVenueName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [includePrices, setIncludePrices] = useState(true);
  const [deck, setDeck] = useState<PresentationDeck | null>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const { data: capabilities } = useQuery({
    queryKey: ['spatial-capabilities'],
    queryFn: () => spatial.ai.capabilities(),
    staleTime: 120_000,
  });

  const build = async () => {
    if (!planId) return;
    setBusy(true);
    try {
      /*
       * The plan drawing is rendered here and sent with the request, because the
       * server has the geometry but not a renderer — and a deck without the
       * layout page is missing the thing a client turns to first.
       */
      let planImageDataUrl: string | undefined;
      try {
        const drawing = await spatial.drawing(planId, { dimensions: 'overall', labels: 'true' });
        const png = drawingToPngDataUrl(drawing, new Set(drawing.legend.map((l) => l.layer)), 1600);
        planImageDataUrl = png ?? undefined;
      } catch {
        // A deck without the plan page is still a deck.
      }

      const result = await spatial.deck(planId, {
        clientName,
        venueName,
        eventDate: eventDate || null,
        includePrices,
        planImageDataUrl,
      });
      setDeck(result);
      setPreview(planImageDataUrl ?? null);
      toast('success', `${result.slides.length} slides generated from this plan.`);
    } catch {
      toast('error', 'Could not build the deck. Save the plan and try again.');
    } finally {
      setBusy(false);
    }
  };

  const writeCopy = async () => {
    if (!planId || !deck) return;
    setWriting(true);
    try {
      const started = await spatial.ai.deckCopy({ planId, clientName, eventName: title });
      const finished = await pollJob(started.id, undefined, { intervalMs: 2000 });

      if (finished.status !== 'completed' || !finished.output) {
        toast('error', finished.errorMessage ?? 'Could not write the copy.');
        return;
      }

      const output = finished.output as { concept?: string; highlights?: string[]; closing?: string };
      setDeck({
        ...deck,
        slides: deck.slides.map((slide) => {
          if (slide.kind === 'concept' && output.concept) {
            return { ...slide, body: output.concept, bullets: output.highlights ?? slide.bullets, edited: true };
          }
          if (slide.kind === 'closing' && output.closing) {
            return { ...slide, body: output.closing, edited: true };
          }
          return slide;
        }),
      });
      toast('success', 'Concept and closing rewritten. Every figure elsewhere is still measured from the plan.');
    } catch {
      toast('error', 'Could not write the copy.');
    } finally {
      setWriting(false);
    }
  };

  const updateSlide = (id: string, patch: Partial<DeckSlide>) => {
    if (!deck) return;
    setDeck({ ...deck, slides: deck.slides.map((slide) => (slide.id === id ? { ...slide, ...patch, edited: true } : slide)) });
  };

  const copyCapability = capabilities?.deck_generation;

  return (
    <>
      <Section
        title="Client presentation"
        description="Cover, concept, renders, plan, specification, quantities, commercials, schedule and compliance — generated from this plan."
      >
        <Field label="Client">
          <TextInput value={clientName} placeholder="Who this is for" onChange={(e) => setClientName(e.target.value)} />
        </Field>
        <Field label="Venue">
          <TextInput value={venueName} placeholder="Where it is" onChange={(e) => setVenueName(e.target.value)} />
        </Field>
        <Field label="Date" hint="Optional. Printed on the cover.">
          <TextInput value={eventDate} placeholder="14 March 2027" onChange={(e) => setEventDate(e.target.value)} />
        </Field>
        <Toggle
          label="Include prices"
          checked={includePrices}
          onChange={setIncludePrices}
          hint="Off produces a design and specification pack with no commercials — useful for an early conversation."
        />

        <button type="button" className="ed-action-primary w-full justify-center" onClick={() => void build()} disabled={busy || !planId}>
          <Presentation className="h-3.5 w-3.5" /> {busy ? 'Building…' : deck ? 'Rebuild the deck' : 'Build the deck'}
        </button>
        {deck ? (
          <p className="field-hint">
            Rebuilding regenerates every measured slide from the current plan. Slides you have rewritten are replaced —
            copy anything you want to keep first.
          </p>
        ) : null}
      </Section>

      {deck ? (
        <>
          <Section
            title="Write the narrative"
            help="The only part of a deck a language model should write. Every number elsewhere is measured, and the model is told explicitly not to state figures of its own."
          >
            <button
              type="button"
              className="ed-action w-full justify-center border border-line"
              onClick={() => void writeCopy()}
              disabled={writing || (copyCapability ? !copyCapability.allowed : false)}
            >
              <Wand2 className="h-3.5 w-3.5" />
              {writing ? 'Writing…' : `Write the concept${copyCapability?.cost ? ` · ${copyCapability.cost} credits` : ''}`}
            </button>
            {copyCapability && !copyCapability.allowed ? (
              <p className="field-hint text-warning">{copyCapability.reason}</p>
            ) : null}
          </Section>

          <Section
            title={`Slides (${deck.slides.filter((s) => !s.hidden).length})`}
            description="Click any slide to edit it. Hidden slides stay out of the export but are kept, in case you want them back."
          >
            <div className="space-y-1.5">
              {deck.slides.map((slide, index) => (
                <SlideRow key={slide.id} slide={slide} index={index} onPatch={(patch) => updateSlide(slide.id, patch)} />
              ))}
            </div>
          </Section>

          <Section title="Export">
            <Field label="Page size">
              <Select
                value={deck.format}
                onChange={(e) => setDeck({ ...deck, format: e.target.value as PresentationDeck['format'] })}
              >
                {(Object.keys(DECK_FORMATS) as Array<PresentationDeck['format']>).map((format) => (
                  <option key={format} value={format}>
                    {DECK_FORMATS[format].label}
                  </option>
                ))}
              </Select>
            </Field>

            <button
              type="button"
              className="ed-action-primary w-full justify-center"
              onClick={() => {
                void exportDeckPdf(deck, `${title || 'proposal'}.pdf`)
                  .then(() => toast('success', 'Deck exported as PDF.'))
                  .catch(() => toast('error', 'Could not export the deck.'));
              }}
            >
              <FileDown className="h-3.5 w-3.5" /> Export as PDF
            </button>

            <p className="field-hint">
              Images are embedded from your renders and the plan drawing. A slide with no image is laid out as text, not
              left blank.
            </p>
          </Section>

          {preview ? (
            <Section title="Plan page" collapsible defaultOpen={false}>
              <img src={preview} alt="The layout plan as it appears in the deck" className="w-full rounded-lg border border-line" />
            </Section>
          ) : null}
        </>
      ) : (
        <Section title="">
          <EmptyState
            icon={<Sparkles className="h-6 w-6" />}
            title="No deck yet"
            description="Fill in the client and venue above and press Build. Every figure comes from this plan, so the deck cannot disagree with the drawing."
          />
        </Section>
      )}
    </>
  );
}

function SlideRow({
  slide,
  index,
  onPatch,
}: {
  slide: DeckSlide;
  index: number;
  onPatch: (patch: Partial<DeckSlide>) => void;
}) {
  const [open, setOpen] = useState(false);
  const info = SLIDE_KIND_INFO[slide.kind];

  return (
    <div className={`rounded-lg border ${slide.hidden ? 'border-line/50 bg-surface-muted/20 opacity-60' : 'border-line bg-surface-muted/40'}`}>
      <div className="flex items-center gap-2 p-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <span className="block truncate text-[11px] font-semibold text-ink">
            {index + 1}. {slide.title}
          </span>
          <span className="block truncate text-[10px] text-ink-subtle">
            {info.label}
            {info.generated ? ' · generated from the plan' : ' · yours to write'}
            {slide.edited ? ' · edited' : ''}
          </span>
        </button>
        <button
          type="button"
          className="shrink-0 text-ink-subtle transition hover:text-ink"
          onClick={() => onPatch({ hidden: !slide.hidden })}
          aria-label={slide.hidden ? 'Include this slide' : 'Hide this slide'}
        >
          {slide.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>

      {open ? (
        <div className="space-y-2 border-t border-line px-2 pb-2 pt-2">
          <Field label="Heading">
            <TextInput value={slide.title} onChange={(e) => onPatch({ title: e.target.value })} />
          </Field>
          <Field label="Body">
            <textarea
              className="ed-field min-h-20 resize-y"
              value={slide.body}
              onChange={(e) => onPatch({ body: e.target.value })}
            />
          </Field>
          {slide.bullets.length ? (
            <Field label="Points" hint="One per line.">
              <textarea
                className="ed-field min-h-16 resize-y"
                value={slide.bullets.join('\n')}
                onChange={(e) => onPatch({ bullets: e.target.value.split('\n').filter(Boolean) })}
              />
            </Field>
          ) : null}
          {slide.table ? (
            <p className="text-[10px] leading-snug text-ink-subtle">
              This slide carries a table of {slide.table.rows.length} measured rows. It is regenerated from the plan on
              every rebuild rather than edited here, so it cannot disagree with the drawing.
            </p>
          ) : null}
          {slide.images.length ? (
            <div className="grid grid-cols-3 gap-1">
              {slide.images.map((image, i) => (
                <img key={i} src={image} alt="" className="aspect-video w-full rounded border border-line object-cover" />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
