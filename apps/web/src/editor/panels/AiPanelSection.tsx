/**
 * The AI section.
 *
 * Everything the AI does for a plan, in one place in the rail: describe an
 * event and have it built, make the models and artwork it needs, put those in
 * the room, ask for changes, and produce the documents at the end.
 *
 * ## Why it is one section rather than six places
 *
 * The work is one job. You describe an event, you look at what it proposes, you
 * brand it, you ask for a change, you export the documents. Splitting that
 * across a header button, a floating assistant, a tab inside the assistant and
 * a separate studio page meant each surface was discoverable only if you
 * already knew it existed — and the complaint about the old AI was never that
 * it lacked features, it was that nobody could find or finish anything.
 *
 * ## Why the tabs are grouped and labelled the way they are
 *
 * Five equal-weight tabs in a scrolling strip — Concept, 3D, Artwork, Ask,
 * Docs — read as five unrelated tools and told the designer nothing about the
 * order to use them in. Worse, two of the five were dead ends: what the 3D and
 * Artwork tabs generated lived in per-session React state, so it was lost on
 * reload and there was no durable place to go and find it again.
 *
 * So the section is now **three stages, in the order the work actually
 * happens**, each with a heading that says what the stage is for:
 *
 *  1. **Design** — Brief (describe the event, have the room built) and Ask
 *     (talk to something that can see the plan and change it). Both are
 *     conversations about the whole plan.
 *  2. **Make** — 3D and Artwork: producing the pieces the plan needs that the
 *     catalogue does not have.
 *  3. **Use** — Assets: the durable library of everything that has been made,
 *     with the button that puts it in the room, which is the step that was
 *     missing entirely. And Docs, which is what the finished plan becomes.
 *
 * Grouping is not decoration here. It is the answer to "what do I do next",
 * which is the question the old strip of five left unanswered.
 *
 * ## The design
 *
 * Deliberately softer than the rest of the editor. Every other panel is a dense
 * tool surface for placing millimetres; this is where someone writes a
 * sentence, and prose wants room. Larger targets, more padding, rounder
 * corners, one clear action per card — the language of a chat product rather
 * than a CAD sidebar, in the product's own colours.
 */
import { type ReactNode } from 'react';
import {
  Boxes,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { AiConceptTab } from './ai/AiConceptTab';
import { AiModelTab } from './ai/AiModelTab';
import { AiArtworkTab } from './ai/AiArtworkTab';
import { AiAssistantTab } from './ai/AiAssistantTab';
import { AiAssetsTab } from './ai/AiAssetsTab';
import { AiDocumentsTab } from './ai/AiDocumentsTab';
import { useEditor } from '../editorStore';

type AiTab = 'concept' | 'assistant' | 'model' | 'artwork' | 'assets' | 'documents';

interface TabDef {
  id: AiTab;
  label: string;
  icon: ReactNode;
  /** One line, shown under the tabs, saying what this tab is for. */
  blurb: string;
}

interface TabGroup {
  /** What stage of the work this is. */
  heading: string;
  tabs: TabDef[];
}

/**
 * The stages, and what falls under each.
 *
 * "Brief" rather than "Concept" because that is the word the trade uses for
 * the thing being typed in, and it is what the panel is asking for. "Ask"
 * stays as it is — it is the shortest true label for a conversation.
 */
const GROUPS: TabGroup[] = [
  {
    heading: 'Design it',
    tabs: [
      {
        id: 'concept',
        label: 'Brief',
        icon: <Wand2 className="h-3.5 w-3.5" />,
        blurb: 'Describe the event and have the whole room laid out, every dimension computed.',
      },
      {
        id: 'assistant',
        label: 'Ask',
        icon: <MessageSquare className="h-3.5 w-3.5" />,
        blurb: 'Talk to an assistant that can see this plan and change it. Everything it does can be undone.',
      },
    ],
  },
  {
    heading: 'Make what it needs',
    tabs: [
      {
        id: 'model',
        label: '3D',
        icon: <Boxes className="h-3.5 w-3.5" />,
        blurb: 'Generate a model of something that is not in the catalogue.',
      },
      {
        id: 'artwork',
        label: 'Artwork',
        icon: <ImageIcon className="h-3.5 w-3.5" />,
        blurb: 'Logos, posters, banners and screen content, at the right shape for each.',
      },
    ],
  },
  {
    heading: 'Put it to work',
    tabs: [
      {
        id: 'assets',
        label: 'Assets',
        icon: <Sparkles className="h-3.5 w-3.5" />,
        blurb: 'Everything generated so far — place a model in the room, or put an image on a screen.',
      },
      {
        id: 'documents',
        label: 'Docs',
        icon: <FileText className="h-3.5 w-3.5" />,
        blurb: 'The proposal, the bill of quantities and the drawings, from the plan as it stands.',
      },
    ],
  },
];

const ALL_TABS = GROUPS.flatMap((group) => group.tabs);

export function AiPanelSection() {
  /*
   * The open tab lives in the store, not here.
   *
   * This section is opened *at a particular tab* from four places that have no
   * relationship to each other — the Ask Novira button on the plan, the command
   * palette, the header, and any panel handing work over. Local state would
   * mean every one of them could open the section and none of them could say
   * which part of it they meant.
   */
  const tab = useEditor((s) => s.aiTab) as AiTab;
  const setTab = useEditor((s) => s.setAiTab);
  const objectCount = useEditor((s) => s.scene.objects.length);

  const current = ALL_TABS.find((entry) => entry.id === tab)!;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        No header of its own: the panel host already draws one from the rail
        item, and a second "AI" underneath it was pure duplication that cost a
        fifth of the panel's height before any content appeared.

        The tabs are a two-row grid grouped by stage rather than a scrolling
        strip of six. Six labels do not fit a narrow panel on one line, and a
        strip that scrolls hides half of them behind a gesture nobody makes —
        which is how the Assets tab could exist and still be unfindable. Three
        headings of two make every tab visible at once, in the order the work
        happens.
      */}
      <nav className="shrink-0 space-y-2.5 px-3.5 pb-2.5 pt-3">
        {GROUPS.map((group, index) => {
          // A stage is "reached" once anything in it or before it is open, so
          // the numbers read as progress rather than as decoration.
          const stageIndex = GROUPS.findIndex((g) => g.tabs.some((t) => t.id === tab));
          const reached = index <= stageIndex;
          return (
            <div key={group.heading}>
              {/*
                Numbered, as the reference design numbers them.

                The number is the whole point: it says these are *stages of one
                job* in an order, not three unrelated drawers. Somebody opening
                this section for the first time needs to know that describing
                the event comes before generating a chandelier for it, and a
                numeral says that in less space than any sentence could.
              */}
              <div className="mb-1.5 flex items-center gap-1.5">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold tabular-nums transition ${
                    reached ? 'bg-primary text-primary-fg' : 'bg-surface-muted text-ink-subtle'
                  }`}
                >
                  {index + 1}
                </span>
                <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-ink-subtle">
                  {group.heading}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {group.tabs.map((entry) => {
                  const active = tab === entry.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setTab(entry.id)}
                      aria-pressed={active}
                      className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition ${
                        active
                          ? 'border-primary bg-primary text-primary-fg shadow-btn'
                          : 'border-line bg-surface text-ink-muted hover:border-primary/40 hover:bg-primary/[0.04] hover:text-ink'
                      }`}
                    >
                      {entry.icon}
                      {entry.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/*
        What the open tab is for, in one line.

        Not a tooltip. The question a designer has on opening this section is
        "which of these do I want", and a sentence they can read without
        hovering is the only answer that arrives before they have already
        guessed. It changes with the tab, so it is never stale.
      */}
      <p className="shrink-0 border-b border-line px-3.5 pb-2.5 text-[11px] leading-relaxed text-ink-muted">
        {current.blurb}
        {tab === 'concept' && objectCount > 0 ? (
          <span className="mt-1 block text-[10px] text-warning">
            This plan already has {objectCount} object{objectCount === 1 ? '' : 's'} — building a brief replaces
            them. Undo puts them back.
          </span>
        ) : null}
      </p>

      {/*
        The conversation manages its own scrolling, because its composer is
        pinned to the bottom of the panel while the messages move behind it —
        a chat whose input floats in the middle of the empty space below the
        last message reads as unfinished. The other tabs are ordinary stacked
        content and scroll as one.
      */}
      {tab === 'assistant' ? (
        <div className="flex min-h-0 flex-1 flex-col px-3.5 pb-3.5 pt-3">
          <AiAssistantTab />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-4 pt-3">
          {tab === 'concept' ? <AiConceptTab /> : null}
          {tab === 'model' ? <AiModelTab /> : null}
          {tab === 'artwork' ? <AiArtworkTab /> : null}
          {tab === 'assets' ? <AiAssetsTab /> : null}
          {tab === 'documents' ? <AiDocumentsTab /> : null}
        </div>
      )}
    </div>
  );
}
