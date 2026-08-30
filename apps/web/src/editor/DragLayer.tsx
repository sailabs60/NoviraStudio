import { createPortal } from 'react-dom';
import { Ban, Box, Brush, Check, Image as ImageIcon, Sun } from 'lucide-react';
import { payloadLabel, payloadThumbnail, useDrag } from './dragStore';

/**
 * The chip that follows the cursor during a drag.
 *
 * Native HTML drag-and-drop offers a drag image, but it is a static bitmap
 * frozen at the moment the drag started — it cannot say "this will land here",
 * "this will paint the seat cushion", or "you cannot drop that there". Those
 * three sentences are the entire value of a drag preview, so the browser's
 * drag image is suppressed and this is drawn instead.
 *
 * It is a portal on `body` at a high z-index because a drag crosses every
 * panel boundary in the app; anything else would clip it against the panel it
 * started in.
 */
export function DragLayer() {
  const payload = useDrag((s) => s.payload);
  const pointer = useDrag((s) => s.pointer);
  const intent = useDrag((s) => s.intent);
  const busy = useDrag((s) => s.busy);

  if (!payload || !pointer) return null;

  const label = payloadLabel(payload);
  const thumb = payloadThumbnail(payload);

  const tone =
    intent.type === 'reject'
      ? 'border-danger/40 bg-danger-soft text-danger'
      : intent.type === 'none'
        ? 'border-line bg-surface text-ink-muted'
        : 'border-primary/40 bg-primary-soft text-primary';

  const hint = describe(intent, busy);

  const Icon =
    intent.type === 'reject'
      ? Ban
      : payload.kind === 'material'
        ? Brush
        : payload.kind === 'hdri'
          ? Sun
          : payload.kind === 'image'
            ? ImageIcon
            : Box;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[200] -translate-y-1/2 translate-x-4"
      style={{ left: pointer.x, top: pointer.y }}
      aria-hidden
    >
      <div className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 shadow-pop backdrop-blur ${tone}`}>
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className="h-9 w-9 shrink-0 rounded-lg border border-line/60 bg-surface object-cover"
          />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line/60 bg-surface">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <span className="min-w-0 max-w-[220px]">
          <span className="block truncate text-xs font-semibold">{label}</span>
          <span className="mt-0.5 flex items-center gap-1 text-[10px] font-medium opacity-90">
            {intent.type !== 'none' && intent.type !== 'reject' && !busy ? (
              <Check className="h-3 w-3 shrink-0" />
            ) : null}
            <span className="truncate">{hint}</span>
          </span>
        </span>
      </div>
    </div>,
    document.body
  );
}

function describe(intent: ReturnType<typeof useDrag.getState>['intent'], busy: string | null): string {
  if (busy) return busy;
  switch (intent.type) {
    case 'place': {
      const where = `${(intent.xMm / 1000).toFixed(2)} m, ${(intent.zMm / 1000).toFixed(2)} m`;
      /*
       * Saying the height only when it is not zero. On an empty floor it is
       * noise; on a venue with a raised stage or a mezzanine it is the single
       * most useful thing the chip can tell you before you let go.
       */
      const level = intent.onSurface && Math.abs(intent.yMm) > 20 ? ` · on a surface ${(intent.yMm / 1000).toFixed(2)} m up` : '';
      return `Drop at ${where}${level}${intent.snapped ? ' · snapped' : ''}`;
    }
    case 'paint':
      return `Paint ${intent.partLabel} on ${intent.objectName}`;
    case 'paint-floor':
      return 'Apply to the floor';
    case 'environment':
      return 'Light the whole scene with this';
    case 'reject':
      return intent.reason;
    default:
      return 'Move over the 3D view';
  }
}
