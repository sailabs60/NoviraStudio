/**
 * AI Event Planner — the conversational tab.
 *
 * "Talk to your AI assistant for ideas, themes, and event planning help."
 *
 * A chat, laid out as the reference does it: your messages in blue on the
 * right, the assistant's on the left, and a composer pinned at the bottom.
 *
 * ## What makes it more than a chat window
 *
 * It can see the plan and it can change it. Every reply may carry operations —
 * move the stage two metres, replace all the chairs, make the lighting warmer —
 * which are applied through the editor's own store and go through undo. What
 * happened is reported in plain English as an entry in the conversation, so the
 * scene never changes without the change being stated.
 */
import { useEffect, useRef } from 'react';
import { Loader2, Send, Sparkles, User } from 'lucide-react';
import { useEditor } from '../../editorStore';
import { useSceneAgent } from '../../useSceneAgent';

/** Openers, written as instructions rather than questions. */
const STARTERS = [
  'Give me ideas for a creative event theme for a tech conference',
  'Move the stage 2 metres forward',
  'Make the lighting warmer',
  'Add 50 more seats',
];

export function AiAssistantTab() {
  const agent = useSceneAgent();
  const objectCount = useEditor((s) => s.scene.objects.length);
  const scroller = useRef<HTMLDivElement>(null);

  // Follow the conversation down as it grows.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.messages.length, agent.thinking]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="ai-card shrink-0">
        <h3 className="ai-card-title">AI Event Planner</h3>
        <p className="ai-card-note">
          Talk to your assistant for ideas, themes and changes. It can see all {objectCount} objects in this
          plan, and anything it changes goes through undo.
        </p>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-2 overflow-y-auto py-3">
        {!agent.messages.length ? (
          <div className="space-y-2">
            <p className="px-1 text-[11px] leading-relaxed text-ink-muted">
              Ask for an idea, or tell it to change something. Try one of these:
            </p>
            {STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                className="block w-full rounded-xl border border-line bg-surface px-3 py-2 text-left text-[12px] leading-snug text-ink transition hover:border-primary hover:text-primary"
                onClick={() => agent.send(starter)}
              >
                {starter}
              </button>
            ))}
          </div>
        ) : null}

        {agent.messages.map((message) =>
          message.role === 'you' ? (
            <div key={message.id} className="flex justify-end">
              <p className="ai-bubble-user">{message.text}</p>
            </div>
          ) : message.role === 'action' ? (
            // What was actually done, distinct from what was said about it.
            <p
              key={message.id}
              className="mx-1 flex gap-1.5 rounded-lg border border-primary/20 bg-primary/[0.06] px-2.5 py-1.5 text-[11px] leading-snug text-primary"
            >
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
              {message.text}
            </p>
          ) : (
            <div key={message.id} className="flex gap-1.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-3 w-3 text-primary" />
              </span>
              <p className="ai-bubble-assistant">{message.text}</p>
            </div>
          )
        )}

        {agent.thinking ? (
          <div className="flex gap-1.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
            </span>
            <p className="ai-bubble-assistant text-ink-muted">Reading the plan…</p>
          </div>
        ) : null}
      </div>

      <form
        className="shrink-0 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          const input = (e.currentTarget.elements.namedItem('message') as HTMLInputElement | null);
          if (!input?.value.trim()) return;
          agent.send(input.value);
          input.value = '';
        }}
      >
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
            <User className="h-3.5 w-3.5 text-ink-subtle" />
          </span>
          <input
            name="message"
            placeholder="Type your message…"
            autoComplete="off"
            disabled={agent.thinking}
            className="ai-input pl-9 pr-11"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={agent.thinking}
            className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg bg-primary text-primary-fg transition hover:bg-primary-strong disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
}
