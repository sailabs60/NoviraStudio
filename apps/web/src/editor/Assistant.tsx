import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useEditor } from './editorStore';
import { useAssistant, type AssistantTab } from './assistantStore';

/**
 * The way in to the AI, from the plan.
 *
 * ## What this used to be, and why it is not that any more
 *
 * A floating 380 px window in the bottom-right corner of the viewport, with its
 * own three tabs — **Ask**, **Layout** and **Brief** — its own chat, its own
 * composer and its own copy of the concept engine.
 *
 * Every one of those already existed in the AI section of the rail, and the two
 * copies had drifted: the rail called the same tool "Brief" where the window
 * called it "Layout", the rail's version could place a generated model in the
 * room and the window's could not, and neither knew what the other had been
 * asked. A designer who typed a brief into the floating window and then opened
 * the rail found an empty panel, which reads as the feature having lost their
 * work.
 *
 * It was also physically in the way. The window and its closed bubble both sat
 * at `bottom-4 right-4`, which is exactly where the orbit compass is — so the
 * one control that tells you which way the room is facing was underneath a blue
 * button, permanently.
 *
 * ## What it is now
 *
 * The same entry point, doing the honest thing: it opens the AI section in the
 * rail, on the tab that matches what was asked for, and gets out of the way.
 * One conversation, one concept engine, one place the generated assets land —
 * and the corner of the viewport back.
 *
 * It is kept as a component rather than deleted because the entry point itself
 * is worth having. "Ask Novira" on the plan is how somebody who has never
 * opened the rail discovers that any of this exists, and the command palette
 * and several panels hand work over through `useAssistant` — all of which now
 * arrives in the one place that can finish it.
 */

/** Which rail tab answers which of the old assistant's tabs. */
function railTabFor(tab: AssistantTab): 'concept' | 'assistant' {
  // `layout` and `brief` were both "describe an event and have it built",
  // which is the rail's Brief tab; `ask` is the conversation.
  return tab === 'ask' ? 'assistant' : 'concept';
}

export function Assistant() {
  const open = useAssistant((s) => s.open);
  const tab = useAssistant((s) => s.tab);
  const hide = useAssistant((s) => s.hide);
  const takeSeed = useAssistant((s) => s.takeSeed);
  const requestPanel = useEditor((s) => s.requestPanel);
  const setAiTab = useEditor((s) => s.setAiTab);
  const seedAiAsk = useEditor((s) => s.seedAiAsk);

  /*
   * Anything that asks for the assistant is redirected to the rail, and the
   * request is then cleared so this never renders a window of its own.
   *
   * In an effect rather than during render: setting other components' state
   * mid-render is what produces React's "cannot update a component while
   * rendering a different component" warning, and the frame it would save is
   * imperceptible next to the panel animating open.
   *
   * The seed is taken *before* the tab is set, so that `seedAiAsk` — which
   * switches to the conversation itself — has the last word when there is a
   * question to ask.
   */
  useEffect(() => {
    if (!open) return;
    const seed = takeSeed();
    requestPanel('ai');
    setAiTab(railTabFor(tab));
    if (seed) seedAiAsk(seed);
    hide();
  }, [open, tab, takeSeed, requestPanel, setAiTab, seedAiAsk, hide]);

  return (
    <button
      type="button"
      onClick={() => {
        requestPanel('ai');
        setAiTab('concept');
      }}
      /*
       * Bottom-*left* of the viewport's right half rather than the corner.
       *
       * The corner belongs to the orbit compass, which this used to cover
       * completely. Sitting clear of it means both are usable, and the button
       * is still the most prominent thing on the plan that is not the plan.
       */
      className="absolute bottom-4 right-[110px] z-20 flex items-center gap-2 rounded-full bg-primary py-2.5 pl-3 pr-4 text-primary-fg shadow-glow transition hover:bg-primary-strong"
      aria-label="Open the AI section"
      title="Describe an event, ask about this plan, or generate what it needs"
    >
      <Sparkles className="h-4 w-4" />
      <span className="text-xs font-semibold">Ask Novira</span>
    </button>
  );
}

export type { AssistantTab };
