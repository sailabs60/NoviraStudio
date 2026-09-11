/**
 * The AI section.
 *
 * Everything the AI does for a plan, in one place in the rail, laid out the way
 * the reference design does it: a card per job, a prompt box that is obviously
 * the thing to type in, generous spacing, and a result you act on rather than
 * merely look at.
 *
 * ## Why it is one section with tabs rather than six places
 *
 * The work is one job. You describe an event, you look at what it proposes, you
 * brand it, you ask for a change, you export the documents. Splitting that
 * across a header button, a floating assistant, a tab inside the assistant and
 * a separate studio page meant each surface was discoverable only if you
 * already knew it existed — and the complaint about the old AI was never that
 * it lacked features, it was that nobody could find or finish anything.
 *
 * ## The design
 *
 * Deliberately softer than the rest of the editor. Every other panel is a dense
 * tool surface for placing millimetres; this is where someone writes a
 * sentence, and prose wants room. Larger targets, more padding, rounder
 * corners, one clear action per card — the language of a chat product rather
 * than a CAD sidebar, in the product's own colours.
 */
import { useState, type ReactNode } from 'react';
import {
  Boxes,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Wand2,
} from 'lucide-react';
import { AiConceptTab } from './ai/AiConceptTab';
import { AiModelTab } from './ai/AiModelTab';
import { AiArtworkTab } from './ai/AiArtworkTab';
import { AiAssistantTab } from './ai/AiAssistantTab';
import { AiDocumentsTab } from './ai/AiDocumentsTab';

type AiTab = 'concept' | 'model' | 'artwork' | 'assistant' | 'documents';

const TABS: Array<{ id: AiTab; label: string; icon: ReactNode }> = [
  { id: 'concept', label: 'Concept', icon: <Wand2 className="h-3.5 w-3.5" /> },
  { id: 'model', label: '3D', icon: <Boxes className="h-3.5 w-3.5" /> },
  { id: 'artwork', label: 'Artwork', icon: <ImageIcon className="h-3.5 w-3.5" /> },
  { id: 'assistant', label: 'Ask', icon: <MessageSquare className="h-3.5 w-3.5" /> },
  { id: 'documents', label: 'Docs', icon: <FileText className="h-3.5 w-3.5" /> },
];

export function AiPanelSection() {
  const [tab, setTab] = useState<AiTab>('concept');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        No header of its own: the panel host already draws one from the rail
        item, and a second "AI" underneath it was pure duplication that cost a
        fifth of the panel's height before any content appeared.

        Tabs as a scrolling row rather than a wrapping grid. Five labels do not
        fit a narrow panel on one line, and a grid that reflows moves the tab
        someone is reaching for.
      */}
      <nav className="shrink-0 overflow-x-auto px-3.5 pb-2 pt-3">
        <div className="ed-segment w-max min-w-full">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={`ed-segment-btn flex-1 gap-1 whitespace-nowrap ${
                tab === entry.id ? 'ed-segment-btn-active' : ''
              }`}
            >
              {entry.icon}
              {entry.label}
            </button>
          ))}
        </div>
      </nav>

      {/*
        The conversation manages its own scrolling, because its composer is
        pinned to the bottom of the panel while the messages move behind it —
        a chat whose input floats in the middle of the empty space below the
        last message reads as unfinished. The other tabs are ordinary stacked
        content and scroll as one.
      */}
      {tab === 'assistant' ? (
        <div className="flex min-h-0 flex-1 flex-col px-3.5 pb-3.5">
          <AiAssistantTab />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-4">
          {tab === 'concept' ? <AiConceptTab /> : null}
          {tab === 'model' ? <AiModelTab /> : null}
          {tab === 'artwork' ? <AiArtworkTab /> : null}
          {tab === 'documents' ? <AiDocumentsTab /> : null}
        </div>
      )}
    </div>
  );
}
