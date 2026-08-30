import { Component, useEffect, useState, type ReactNode } from 'react';

/**
 * Error boundary around a single placed model.
 *
 * `Suspense` catches the *pending* state of `useGLTF`, but not a rejection. A
 * model that 404s, is blocked by CORS, or is malformed throws during render,
 * and without a boundary that error propagates past the Suspense to the
 * `<Canvas>` — React unmounts the whole tree, the WebGL context is lost, and
 * the entire scene disappears because of one bad file.
 *
 * With hundreds of models arriving from external sources, some will fail. One
 * failure must degrade to a placeholder box, never take the plan down with it.
 */
interface Props {
  children: ReactNode;
  fallback: ReactNode;
  /** Identifies the asset in the console so a bad one can be tracked down. */
  label?: string;
  /**
   * Told when the subtree fails, so a caller can show something better than a
   * blank fallback — the preview dialog swaps to the still image and explains
   * why, rather than presenting an empty box.
   */
  onError?: (error: unknown) => void;
}

interface State {
  failed: boolean;
}

export class ModelBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Warn rather than error: the scene has recovered, and a flood of red for
    // an asset problem hides real faults.
    console.warn(`[novira] model failed to load${this.props.label ? ` (${this.props.label})` : ''}:`, error);
    this.props.onError?.(error);
  }

  /**
   * Retry when the asset being asked for changes, so replacing a broken model
   * or reconnecting does not leave a permanently dead placeholder.
   */
  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.label !== this.props.label) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Whether a model URL can actually be fetched.
 *
 * drei's `useGLTF` reports a load failure from an async callback, outside
 * React's render phase, so an error boundary cannot catch it — it surfaces as
 * an uncaught error even when the boundary has already swapped in a
 * placeholder. Checking reachability first means the loader is never handed a
 * URL that will fail, which keeps the console clean as the catalogue grows to
 * hundreds of externally-sourced assets.
 *
 * One HEAD request per distinct URL, cached for the life of the page, shared by
 * every placement of the same model.
 */
const reachability = new Map<string, Promise<boolean>>();

export function checkReachable(url: string): Promise<boolean> {
  let pending = reachability.get(url);
  if (!pending) {
    pending = fetch(url, { method: 'HEAD' })
      .then((r) => r.ok)
      .catch(() => false);
    reachability.set(url, pending);
  }
  return pending;
}

/** Forget a cached result, so a repaired asset can be retried. */
export function forgetReachable(url: string) {
  reachability.delete(url);
}

export function useModelReachable(url: string | undefined): 'checking' | 'ok' | 'broken' {
  const [state, setState] = useState<'checking' | 'ok' | 'broken'>('checking');

  useEffect(() => {
    if (!url) return;
    let active = true;
    setState('checking');
    void checkReachable(url).then((ok) => {
      if (active) setState(ok ? 'ok' : 'broken');
    });
    return () => {
      active = false;
    };
  }, [url]);

  return state;
}
