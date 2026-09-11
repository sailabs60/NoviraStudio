/**
 * More: the things you do to a finished plan.
 *
 * Cost, Check and Review are not steps in designing a room — they are what you
 * do once one exists. Keeping them in the rail alongside Create and Build gave
 * them equal billing with the work itself and made nine flat icons where a
 * person scans about six.
 *
 * They keep their own panels and their own place in the store; only the way in
 * has moved. Choosing one here opens the real panel, so nothing anyone has
 * learned about those sections stops being true.
 */
import { useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useEditor, type WorkPanel } from '../editorStore';
import { MORE_ITEMS } from '../WorkRail';
import { CostPanel } from './CostPanel';
import { CheckPanel } from './CheckPanel';
import { ReviewPanel } from './ReviewPanel';

export function MorePanel() {
  const [open, setOpen] = useState<WorkPanel | null>(null);
  const checkCount = useEditor((s) => s.scene.objects.length);

  if (open) {
    const item = MORE_ITEMS.find((entry) => entry.key === open);
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-1.5 border-b border-line px-3 py-2">
          <button
            type="button"
            className="ai-btn px-2 py-1 text-[11px]"
            onClick={() => setOpen(null)}
            aria-label="Back to More"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            More
          </button>
          <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-ink">{item?.label}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {open === 'cost' ? <CostPanel /> : null}
          {open === 'check' ? <CheckPanel /> : null}
          {open === 'review' ? <ReviewPanel /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3.5">
      <h2 className="text-[14px] font-bold text-ink">More</h2>
      <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
        What you do to a plan once it exists, rather than to build one.
      </p>

      <div className="mt-3 space-y-2">
        {MORE_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface p-3 text-left transition hover:border-primary"
            onClick={() => setOpen(item.key)}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-ink-muted">
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-ink">{item.label}</span>
              <span className="block text-[11px] leading-snug text-ink-muted">{item.help}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-subtle" />
          </button>
        ))}
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-ink-subtle">
        {checkCount} objects in this plan. Cost and checks both measure the drawing itself, so they are only
        as good as what is in it.
      </p>
    </div>
  );
}
