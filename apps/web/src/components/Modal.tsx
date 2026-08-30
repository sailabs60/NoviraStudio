import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * A dialog.
 *
 * Two things here are worth stating, because both are bugs that were fixed
 * rather than choices made up front.
 *
 * **The body scrolls, the frame does not.** The dialog used to be a plain box
 * that grew with its content and was then clipped by `overflow-hidden`. A short
 * form was fine; a long list — the catalogue picker, once the library grew past
 * a couple of hundred items — grew taller than the viewport, and everything
 * past the fold became unreachable. Not merely awkward: the content was
 * *clipped*, so it could not be scrolled to at all, and a click aimed at it
 * landed on the backdrop instead. The header and footer are now pinned and only
 * the middle scrolls, which is what makes a long picker usable.
 *
 * **Focus is trapped and returned.** A dialog that leaves focus behind it is
 * unusable with a keyboard: Tab walks off into the page underneath while the
 * dialog is still covering it.
 */
/** Open dialogs, innermost last. See the Escape handling below. */
const escapeStack: object[] = [];

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = 'max-w-md',
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  /*
   * The latest `onClose`, read by the effect below without being one of its
   * dependencies.
   *
   * Every caller in this codebase passes `onClose={() => setSomething(false)}`
   * — a fresh function every render. If a form field inside the dialog holds
   * its own state in the *same* component that owns `open` (the common case:
   * "New project", "New plan"), every keystroke re-renders that component,
   * manufactures a new `onClose`, and used to be a dependency of the
   * focus-trap effect below — tearing it down and setting it up again on
   * every character typed. The teardown restores focus to whatever was
   * focused when the dialog first opened (the button that opened it, now
   * sitting behind the overlay), and the setup's 40 ms timer then throws
   * focus at the *first* focusable element in the dialog, which is the header's
   * close button, not the field being typed in. The field never got a second
   * character without being clicked back into.
   *
   * A ref sidesteps this entirely: the effect only needs `open` to decide
   * whether to run at all, and reads whatever `onClose` currently is at the
   * moment Escape is actually pressed.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    restoreFocusTo.current = document.activeElement as HTMLElement | null;

    /*
     * Only the topmost dialog answers Escape.
     *
     * Dialogs do stack — an image picker opened from inside a generator, a
     * confirmation opened from inside a settings sheet — and every one of them
     * listens on the window. Without a stack, one Escape closes the lot and the
     * work behind the top dialog goes with it.
     */
    const token = {};
    escapeStack.push(token);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (escapeStack[escapeStack.length - 1] === token) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      // Keep Tab inside the dialog. Without this it walks into the page behind,
      // which is still covered — so focus becomes invisible.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);

    // Move focus in, so the first Tab goes somewhere sensible.
    const timer = window.setTimeout(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      target?.focus();
    }, 40);

    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
      const index = escapeStack.indexOf(token);
      if (index >= 0) escapeStack.splice(index, 1);
      restoreFocusTo.current?.focus?.();
    };
    // `onClose` is deliberately not a dependency — see `onCloseRef` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        /*
         * A column that never exceeds the viewport. The header and footer are
         * fixed; the middle takes whatever is left and scrolls.
         */
        className={`panel relative flex max-h-[calc(100vh-2rem)] w-full ${width} flex-col overflow-hidden`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-ink-muted">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="icon-btn h-8 w-8 shrink-0" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}
