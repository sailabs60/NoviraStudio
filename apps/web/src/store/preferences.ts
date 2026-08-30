/**
 * Interface preferences.
 *
 * Theme is an account setting and lives on the user record. These four are
 * device settings and live in local storage, deliberately: someone using a
 * high-contrast, large-text layout on a laptop in a dim venue does not
 * necessarily want it on the studio monitor, and forcing one choice across both
 * makes the accessible option feel like a cost rather than a help.
 *
 * All four are applied as attributes on the document element, where the CSS in
 * `styles.css` picks them up. Nothing re-renders to change them.
 */
import { create } from 'zustand';

export type Density = 'compact' | 'comfortable';
export type Contrast = 'normal' | 'high';
export type TextSize = 'normal' | 'large' | 'larger';

export interface Preferences {
  density: Density;
  contrast: Contrast;
  textSize: TextSize;
  /** Show the explanatory hints under controls. On by default, and meant to be. */
  showHints: boolean;
  /** Whether the guided tour has been completed or dismissed. */
  tourCompleted: boolean;
  /** Panels the user has collapsed, so the editor opens as they left it. */
  collapsedPanels: string[];
}

const STORAGE_KEY = 'novira.preferences';

const DEFAULTS: Preferences = {
  density: 'compact',
  contrast: 'normal',
  textSize: 'normal',
  showHints: true,
  tourCompleted: false,
  collapsedPanels: [],
};

function read(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    // Private browsing, a corrupt value, or storage disabled entirely. None of
    // those should stop the app loading, so the defaults stand.
    return { ...DEFAULTS };
  }
}

function write(preferences: Preferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* the preference simply will not persist */
  }
}

export function applyPreferences(preferences: Preferences) {
  const root = document.documentElement;
  root.setAttribute('data-density', preferences.density);
  root.setAttribute('data-contrast', preferences.contrast);
  root.setAttribute('data-text-size', preferences.textSize);
}

interface PreferencesState extends Preferences {
  set: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  reset: () => void;
  togglePanel: (key: string) => void;
  isCollapsed: (key: string) => boolean;
}

export const usePreferences = create<PreferencesState>((setState, get) => {
  const initial = read();
  // Applied at module load rather than in an effect, so the first paint is
  // already correct — a flash of the wrong text size is exactly the thing a
  // large-text user does not need.
  if (typeof document !== 'undefined') applyPreferences(initial);

  return {
    ...initial,

    set: (key, value) => {
      setState({ [key]: value } as never);
      const next = { ...get(), [key]: value } as Preferences;
      applyPreferences(next);
      write(next);
    },

    reset: () => {
      setState({ ...DEFAULTS });
      applyPreferences(DEFAULTS);
      write(DEFAULTS);
    },

    togglePanel: (key) => {
      const current = get().collapsedPanels;
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      setState({ collapsedPanels: next });
      write({ ...get(), collapsedPanels: next } as Preferences);
    },

    isCollapsed: (key) => get().collapsedPanels.includes(key),
  };
});
