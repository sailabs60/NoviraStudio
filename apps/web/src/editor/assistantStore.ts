import { create } from 'zustand';

/**
 * Whether the assistant is open, and on which tab.
 *
 * A three-field store rather than local state, because the assistant is opened
 * from three places that have no relationship to each other: its own bubble,
 * the command palette, and any panel that wants to hand a task over to it. A
 * lifted `useState` would mean threading a setter through the entire editor
 * tree for the sake of one boolean.
 */
/**
 * Which of the three answers the user is after.
 *
 * `ask` is the scene-aware language model, `layout` is the deterministic
 * concept engine, `brief` is the full generator with photo analysis. They are
 * genuinely different tools rather than modes of one, which is why the tab is
 * remembered rather than reset.
 */
export type AssistantTab = 'ask' | 'layout' | 'brief';

interface AssistantState {
  open: boolean;
  minimised: boolean;
  tab: AssistantTab;
  /** Text to start the conversation with, consumed once on open. */
  seed: string | null;

  show: (tab?: AssistantTab, seed?: string) => void;
  hide: () => void;
  toggle: () => void;
  setMinimised: (minimised: boolean) => void;
  setTab: (tab: AssistantTab) => void;
  takeSeed: () => string | null;
}

export const useAssistant = create<AssistantState>((set, get) => ({
  open: false,
  minimised: false,
  tab: 'ask',
  seed: null,

  show: (tab, seed) => set({ open: true, minimised: false, ...(tab ? { tab } : {}), ...(seed ? { seed } : {}) }),
  hide: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open, minimised: false })),
  setMinimised: (minimised) => set({ minimised }),
  setTab: (tab) => set({ tab }),
  takeSeed: () => {
    const seed = get().seed;
    if (seed) set({ seed: null });
    return seed;
  },
}));
