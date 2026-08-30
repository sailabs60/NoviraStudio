import { create } from 'zustand';
import type { SessionUser } from '@novira/shared';
import { api, tokenStore } from '../lib/api';

interface SessionState {
  user: SessionUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  setUser: (user: SessionUser | null) => void;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (body: Record<string, unknown>) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

/** Reflect the user's appearance preference onto the document. */
function applyTheme(user: SessionUser | null) {
  const theme = user?.appearance ?? 'light';
  document.documentElement.setAttribute('data-theme', theme);
}

export const useSession = create<SessionState>((set, get) => ({
  user: null,
  status: 'loading',

  setUser: (user) => {
    applyTheme(user);
    set({ user, status: user ? 'authenticated' : 'anonymous' });
  },

  bootstrap: async () => {
    if (!tokenStore.get()) {
      applyTheme(null);
      set({ user: null, status: 'anonymous' });
      return;
    }
    try {
      const user = await api.auth.me();
      applyTheme(user);
      set({ user, status: 'authenticated' });
    } catch {
      tokenStore.clear();
      applyTheme(null);
      set({ user: null, status: 'anonymous' });
    }
  },

  login: async (email, password) => {
    const { token, user } = await api.auth.login(email, password);
    tokenStore.set(token);
    applyTheme(user);
    set({ user, status: 'authenticated' });
  },

  register: async (body) => {
    const { token, user } = await api.auth.register(body);
    tokenStore.set(token);
    applyTheme(user);
    set({ user, status: 'authenticated' });
  },

  logout: () => {
    tokenStore.clear();
    applyTheme(null);
    set({ user: null, status: 'anonymous' });
  },

  refresh: async () => {
    if (get().status !== 'authenticated') return;
    try {
      const user = await api.auth.me();
      applyTheme(user);
      set({ user });
    } catch {
      /* keep the current session; a transient failure should not sign the user out */
    }
  },
}));
