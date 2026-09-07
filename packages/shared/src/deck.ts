/**
 * The tender and presentation engine.
 *
 * A tender submission is a fixed set of documents, and an agency assembles the
 * same set every time by hand: a cover, the concept in words, hero renders, a
 * dimensioned plan, a bill of quantities, a schedule, and the commercials. The
 * brief puts five to ten hours per project on that, and it is not an
 * exaggeration — most of it is copying numbers between a drawing, a
 * spreadsheet and a slide, which is also where the errors come from.
 *
 * This module describes the deck as *data*: an ordered list of typed slides,
 * each of which knows how to fill itself from the plan. The renderer — PDF,
 * HTML, or a printed board — is a separate concern, so the same deck can be
 * produced in whichever the client asked for without rebuilding the content.
 *
 * The result is a deck that cannot disagree with the drawing, because it is
 * generated from it.
 */
import type { PricedTakeoff } from './rates.js';
import type { TakeoffResult } from './takeoff.js';
import type { AdvisorReport } from './advisor.js';
import type { SceneDocument } from './scene.js';

/* ── Slides ────────────────────────────────────────────────────────────── */

export const SLIDE_KINDS = [
  'cover',
  'concept',
  'hero-render',
  'render-grid',
  'plan-drawing',
  'technical-drawing',
  'specification',
  'quantities',
  'commercials',
  'schedule',
  'compliance',
  'team',
  'closing',
  'custom',
] as const;
export type SlideKind = (typeof SLIDE_KINDS)[number];

export interface SlideKindInfo {
  key: SlideKind;
  label: string;
  note: string;
  /** Whether the slide is generated from the plan or written by hand. */
  generated: boolean;
  /** Whether a client normally expects it. Used by the default deck. */
  standard: boolean;
}

export const SLIDE_KIND_INFO: Record<SlideKind, SlideKindInfo> = {
  cover: { key: 'cover', label: 'Cover', note: 'Client, event, date and your brand.', generated: true, standard: true },
  concept: { key: 'concept', label: 'The concept', note: 'What you are proposing and why, in words.', generated: false, standard: true },
  'hero-render': { key: 'hero-render', label: 'Hero render', note: 'One full-bleed image. The thing they remember.', generated: true, standard: true },
  'render-grid': { key: 'render-grid', label: 'Render grid', note: 'Three or four views on one page.', generated: true, standard: true },
  'plan-drawing': { key: 'plan-drawing', label: 'Layout plan', note: 'Top view, to scale, with the room dimensioned.', generated: true, standard: true },
  'technical-drawing': { key: 'technical-drawing', label: 'Technical drawing', note: 'Fully dimensioned, layered, with a title block.', generated: true, standard: true },
  specification: { key: 'specification', label: 'Specification', note: 'What each element is, in the detail a contractor needs.', generated: true, standard: true },
  quantities: { key: 'quantities', label: 'Bill of quantities', note: 'Measured quantities by trade, with the basis for each.', generated: true, standard: true },
  commercials: { key: 'commercials', label: 'Commercials', note: 'Priced summary, terms and what is excluded.', generated: true, standard: true },
  schedule: { key: 'schedule', label: 'Schedule', note: 'Build, event and de-rig, against the venue access times.', generated: false, standard: true },
  compliance: { key: 'compliance', label: 'Safety and compliance', note: 'Egress, loading and the checks the design passes.', generated: true, standard: true },
  team: { key: 'team', label: 'Team', note: 'Who will deliver it.', generated: false, standard: false },
  closing: { key: 'closing', label: 'Closing', note: 'Next steps and how to accept.', generated: true, standard: true },
  custom: { key: 'custom', label: 'Custom page', note: 'Your own heading and copy.', generated: false, standard: false },
};

export interface DeckSlide {
  id: string;
  kind: SlideKind;
  title: string;
  /** Body copy. Generated slides fill this and it stays editable. */
  body: string;
  /** Bullet points, where the slide takes them. */
  bullets: string[];
  /** Images referenced by URL — renders, drawings, logos. */
  images: string[];
  /** Tabular content for quantities and commercials. */
  table: { columns: string[]; rows: string[][] } | null;
  /** Whether the user has edited it, so regenerating does not overwrite. */
  edited: boolean;
  hidden: boolean;
}

export interface DeckTheme {
  /** Accent colour used for rules, headings and the cover. */
  primaryColor: string;
  /** Page background. */
  backgroundColor: string;
  textColor: string;
  /** Logo shown on the cover and in the footer. */
  logoUrl: string | null;
  /** Brand name, for white-labelled decks. */
  brandName: string;
  footerText: string;
  /** Whether to print the platform credit. */
  showPlatformCredit: boolean;
}

export const DEFAULT_DECK_THEME: DeckTheme = {
  primaryColor: '#0072FD',
  backgroundColor: '#ffffff',
  textColor: '#111827',
  logoUrl: null,
  brandName: '',
  footerText: '',
  showPlatformCredit: true,
};

export interface PresentationDeck {
  title: string;
  clientName: string;
  eventName: string;
  eventDate: string | null;
  venueName: string;
  preparedBy: string;
  slides: DeckSlide[];
  theme: DeckTheme;
  /** Page size, because a tender is often specified as A4 portrait. */
  format: 'a4-landscape' | 'a4-portrait' | 'widescreen';
}

/* ── Generation ────────────────────────────────────────────────────────── */

export interface DeckSource {
  planTitle: string;
  projectTitle: string;
  clientName: string;
  eventDate: string | null;
  venueName: string;
  preparedBy: string;
  scene: SceneDocument;
  takeoff: TakeoffResult;
  priced: PricedTakeoff | null;
  advice: AdvisorReport | null;
  /** Rendered images already produced for this plan, newest first. */
  renderUrls: string[];
  /** Data URL or hosted URL of the plan drawing. */
  planImageUrl: string | null;
  theme?: Partial<DeckTheme>;
}

let slideCounter = 0;
function slideId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  slideCounter += 1;
  return `slide-${Date.now().toString(36)}-${slideCounter}`;
}

const money = (minor: number, currency: string): string => {
  const value = minor / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(value);
  } catch {
    return `${currency.toUpperCase()} ${value.toFixed(2)}`;
  }
};

/**
 * Build the deck.
 *
 * Every generated slide states where its numbers came from, because a tender
 * page whose figures cannot be traced is a page a procurement team will
 * challenge. Slides with nothing to say are omitted rather than left blank — an
 * empty "Bill of quantities" page reads as an oversight, not as a plan with
 * nothing in it.
 */
export function generateDeck(source: DeckSource): PresentationDeck {
  const slides: DeckSlide[] = [];
  const theme: DeckTheme = { ...DEFAULT_DECK_THEME, ...(source.theme ?? {}) };
  const summary = source.takeoff.summary;

  const add = (
    kind: SlideKind,
    title: string,
    body: string,
    extra: Partial<Omit<DeckSlide, 'id' | 'kind' | 'title' | 'body'>> = {}
  ) => {
    slides.push({
      id: slideId(),
      kind,
      title,
      body,
      bullets: [],
      images: [],
      table: null,
      edited: false,
      hidden: false,
      ...extra,
    });
  };

  /* ── Cover ───────────────────────────────────────────────────────────── */

  add(
    'cover',
    source.projectTitle || source.planTitle,
    [source.clientName, source.venueName, source.eventDate].filter(Boolean).join(' · '),
    {
      images: source.renderUrls.slice(0, 1),
      bullets: [source.preparedBy ? `Prepared by ${source.preparedBy}` : ''].filter(Boolean),
    }
  );

  /* ── Concept ─────────────────────────────────────────────────────────── */

  const conceptBullets: string[] = [];
  if (summary.floorAreaSqM) conceptBullets.push(`${summary.floorAreaSqM.toFixed(0)} m² of floor laid out to scale.`);
  if (summary.seatCount) conceptBullets.push(`Seating for ${summary.seatCount} across ${summary.tableCount} tables.`);
  if (summary.boothCount) conceptBullets.push(`${summary.boothCount} exhibition stands.`);
  if (summary.ledSqM) conceptBullets.push(`${summary.ledSqM.toFixed(1)} m² of LED.`);
  if (summary.trussLengthM) conceptBullets.push(`${summary.trussLengthM.toFixed(1)} m of truss.`);
  if (summary.fixtureCount) conceptBullets.push(`${summary.fixtureCount} lighting fixtures.`);

  /*
   * Use the brief the plan was built from, when there is one.
   *
   * This page used to tell the designer to "describe the idea in your own
   * words" — for a generated plan that meant retyping what the engine had
   * already written, including the reason behind every decision, which is the
   * part a client actually reads. A hand-drawn plan has no brief and keeps the
   * prompt to write one.
   */
  const brief = source.scene.designBrief ?? null;

  add(
    'concept',
    'The concept',
    brief
      ? brief.prompt
      : 'Describe the idea in your own words — what the guest experiences, and why this layout delivers it. Everything below is measured from the drawing.',
    { bullets: brief ? [...brief.summary, ...conceptBullets].slice(0, 10) : conceptBullets }
  );

  /*
   * Why it is laid out this way.
   *
   * The engine records a reason for every element it places — why the stage is
   * that size, why the tables sit at a 3.8 m pitch, why the truss trims where
   * it does. Those sentences are what turn a drawing into an argument, and a
   * proposal that can answer "why is the stage there" wins work that one which
   * only shows the stage does not.
   */
  if (brief && Object.keys(brief.rationale).length) {
    add('concept', 'Why it is laid out this way', 'Every decision below was calculated from the room and the guest count.', {
      bullets: Object.entries(brief.rationale)
        .map(([kind, reason]) => `${kind.replace(/-/g, ' ')}: ${reason}`)
        .slice(0, 8),
    });
  }

  // Anything the layout could not satisfy, said plainly rather than buried.
  if (brief && brief.warnings.length) {
    add('concept', 'Worth knowing', 'Stated when the layout was generated, so it is on the record.', {
      bullets: brief.warnings.slice(0, 5),
    });
  }

  /* ── Renders ─────────────────────────────────────────────────────────── */

  if (source.renderUrls.length) {
    add('hero-render', 'The room', 'Rendered from the plan opposite. Every dimension shown is the dimension that will be built.', {
      images: source.renderUrls.slice(0, 1),
    });
    if (source.renderUrls.length > 1) {
      add('render-grid', 'Views', 'Additional angles from the same layout.', {
        images: source.renderUrls.slice(1, 5),
      });
    }
  }

  /* ── Drawings ────────────────────────────────────────────────────────── */

  if (source.planImageUrl) {
    add('plan-drawing', 'Layout plan', 'To scale. Overall dimensions are shown; every element is dimensioned on the technical drawing.', {
      images: [source.planImageUrl],
    });
  }

  /* ── Specification ───────────────────────────────────────────────────── */

  const specRows: string[][] = [];
  if (summary.trussLengthM) specRows.push(['Structure', `${summary.trussLengthM.toFixed(1)} m of truss`, `${summary.flownWeightKg} kg flown, ${summary.totalWeightKg} kg total`]);
  if (summary.ledSqM) specRows.push(['LED', `${summary.ledSqM.toFixed(1)} m²`, 'Cabinet type and pitch per the quantities']);
  if (summary.carpetSqM) specRows.push(['Flooring', `${summary.carpetSqM.toFixed(0)} m²`, 'Laid and lifted']);
  if (summary.printSqM) specRows.push(['Print', `${summary.printSqM.toFixed(1)} m²`, 'Artwork to be supplied by the client']);
  if (summary.fixtureCount) specRows.push(['Lighting', `${summary.fixtureCount} fixtures`, `${summary.powerKw} kW, about ${summary.peakAmps} A at peak`]);
  if (summary.boothCount) specRows.push(['Stands', `${summary.boothCount}`, 'Built to the organiser height rules']);
  if (summary.labourHours) specRows.push(['Labour', `${summary.labourHours} crew-hours`, 'Build and de-rig']);
  if (summary.truckLoads) specRows.push(['Transport', `${summary.truckLoads} load${summary.truckLoads === 1 ? '' : 's'}`, `${summary.structureVolumeCuM.toFixed(1)} m³ each way`]);

  if (specRows.length) {
    add('specification', 'Specification', 'Measured from the drawing rather than estimated.', {
      table: { columns: ['Element', 'Quantity', 'Notes'], rows: specRows },
    });
  }

  /* ── Quantities ──────────────────────────────────────────────────────── */

  if (source.takeoff.lines.length) {
    add('quantities', 'Bill of quantities', 'Every line is measured from the design. Hover any figure in the app to see how it was derived.', {
      table: {
        columns: ['Trade', 'Description', 'Quantity', 'Unit', 'Basis'],
        rows: source.takeoff.lines.map((line) => [
          line.group,
          line.description,
          (line.quantityMilli / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 }),
          line.unit,
          line.basis,
        ]),
      },
    });
  }

  /* ── Commercials ─────────────────────────────────────────────────────── */

  if (source.priced) {
    const rows = source.priced.byGroup.map((g) => [g.label, money(g.amount, source.priced!.currency)]);
    rows.push(['Total', money(source.priced.subtotal, source.priced.currency)]);
    add(
      'commercials',
      'Commercials',
      source.priced.unpriced.length
        ? `Priced against ${source.priced.cardName}. ${source.priced.unpriced.length} line${source.priced.unpriced.length === 1 ? '' : 's'} used an indicative rate and should be confirmed.`
        : `Priced against ${source.priced.cardName}.`,
      {
        table: { columns: ['Trade', 'Amount'], rows },
        bullets: [
          'Excludes artwork origination, venue charges and any organiser fees unless stated.',
          'Subject to final site survey and confirmation of access times.',
          'Valid for 30 days from the date of this document.',
        ],
      }
    );
  }

  /* ── Schedule ────────────────────────────────────────────────────────── */

  add(
    'schedule',
    'Schedule',
    'Set out against the venue access times. Adjust once load-in and curfew are confirmed.',
    {
      table: {
        columns: ['Phase', 'From', 'To', 'Notes'],
        rows: [
          ['Load-in', '', '', `${summary.truckLoads} truck load${summary.truckLoads === 1 ? '' : 's'}`],
          ['Build', '', '', `${summary.labourHours} crew-hours`],
          ['Technical rehearsal', '', '', ''],
          ['Event', '', '', ''],
          ['De-rig', '', '', 'Typically a third of the build time'],
        ],
      },
    }
  );

  /* ── Compliance ──────────────────────────────────────────────────────── */

  if (source.advice) {
    const safety = source.advice.advice.filter((a) => a.category === 'safety' || a.category === 'accessibility');
    add(
      'compliance',
      'Safety and compliance',
      safety.length
        ? 'The following points were raised by the automated check and are addressed as noted.'
        : 'The layout passes the automated egress, loading and accessibility checks.',
      {
        bullets: safety.length
          ? safety.map((a) => `${a.title} — ${a.action}`)
          : [
              'Escape widths and travel distances checked against the regional rules for this plan.',
              'Rigging and floor loading checked against the venue figures recorded.',
              'Step-free access checked to every raised platform.',
              'This is an automated check and does not replace sign-off by the venue or the local authority.',
            ],
      }
    );
  }

  /* ── Closing ─────────────────────────────────────────────────────────── */

  add('closing', 'Next steps', 'Confirm the layout, and we will issue the technical pack and the production schedule.', {
    bullets: [
      'Approve or comment directly on the 3D layout using the link supplied.',
      'Confirm the venue access times so the schedule can be fixed.',
      'Supply artwork to the print specification in the quantities.',
    ],
  });

  return {
    title: source.projectTitle || source.planTitle,
    clientName: source.clientName,
    eventName: source.projectTitle,
    eventDate: source.eventDate,
    venueName: source.venueName,
    preparedBy: source.preparedBy,
    slides,
    theme,
    format: 'a4-landscape',
  };
}

/** Page dimensions in millimetres, for the PDF writer. */
export const DECK_FORMATS: Record<PresentationDeck['format'], { widthMm: number; heightMm: number; label: string }> = {
  'a4-landscape': { widthMm: 297, heightMm: 210, label: 'A4 landscape' },
  'a4-portrait': { widthMm: 210, heightMm: 297, label: 'A4 portrait' },
  widescreen: { widthMm: 338.7, heightMm: 190.5, label: 'Widescreen 16:9' },
};
