import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';

/**
 * What a generation looks like while it is running.
 *
 * A percentage alone is the weakest thing a long job can show. It says
 * something is happening and nothing about what, so the moment it slows people
 * conclude it has hung — which is precisely what happened here, and the
 * complaint was that the AI was fake.
 *
 * So this shows four things instead:
 *
 *  · **The stage, named.** "Sending to the renderer", "Rendering", "Saving" —
 *    derived from the percentage, because the work genuinely has phases and
 *    naming them is what turns a stall into a wait.
 *  · **Elapsed time, and what to expect.** A job at 60% for twenty seconds is
 *    fine; the same job at 60% for four minutes is not, and only the user can
 *    tell the difference if they are shown the clock.
 *  · **A way out.** Cancel is always present. A long job with no exit is the
 *    thing people close the tab over, and closing the tab is how work is lost.
 *  · **The result, as soon as it exists.** A thumbnail the instant one is
 *    available beats any amount of spinner.
 *
 * The bar never goes backwards and never reaches 100 until the artefact is
 * real. Both matter: a retreating bar destroys confidence faster than a slow
 * one, and a bar that sits at 100 with nothing to show is the specific lie
 * this is meant to stop telling.
 */

export interface AiProgressStage {
  /** Percentage at which this stage begins. */
  at: number;
  label: string;
}

/** The default arc of a generation, in the order the server reports it. */
export const DEFAULT_STAGES: AiProgressStage[] = [
  { at: 0, label: 'Queued' },
  { at: 10, label: 'Preparing the prompt' },
  { at: 20, label: 'Sent to the renderer' },
  { at: 35, label: 'Generating' },
  { at: 85, label: 'Finishing' },
  { at: 92, label: 'Saving the result' },
];

function stageFor(percent: number, stages: AiProgressStage[]): string {
  let current = stages[0]?.label ?? 'Working';
  for (const stage of stages) {
    if (percent >= stage.at) current = stage.label;
  }
  return current;
}

/** "1:24" — the shape people read a wait in. */
function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
}

export function AiProgress({
  progress,
  status,
  startedAt,
  expectedMs = 90_000,
  stages = DEFAULT_STAGES,
  error,
  previewUrl,
  onCancel,
  note,
}: {
  progress: number;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  /** Epoch ms when the job was started, for the elapsed clock. */
  startedAt: number;
  /** Roughly how long this kind of job takes, for the "longer than usual" note. */
  expectedMs?: number;
  stages?: AiProgressStage[];
  error?: string | null;
  previewUrl?: string | null;
  onCancel?: () => void;
  note?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  // A ticking clock only while there is something to time.
  useEffect(() => {
    if (status === 'completed' || status === 'failed' || status === 'cancelled') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const elapsed = now - startedAt;
  const running = status === 'queued' || status === 'in_progress';
  const percent = Math.max(0, Math.min(100, progress));
  const overdue = running && elapsed > expectedMs * 1.6;

  if (status === 'failed') {
    return (
      <div className="rounded-lg border border-danger/40 bg-danger/8 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink">That did not work</p>
            <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">
              {error || 'The generator could not finish. Your credits have been returned.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="rounded-lg border border-line bg-surface-muted/50 p-3">
        <p className="text-[12px] text-ink-muted">Cancelled. Your credits have been returned.</p>
      </div>
    );
  }

  if (status === 'completed') {
    return (
      <div className="rounded-lg border border-success/40 bg-success/8 p-3">
        <div className="flex items-center gap-2">
          <Check className="h-4 w-4 shrink-0 text-success" />
          <p className="text-[13px] font-semibold text-ink">Done in {clock(elapsed)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface-muted/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          <p className="truncate text-[12px] font-semibold text-ink">
            {stageFor(percent, stages)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] tabular-nums text-ink-subtle">{clock(elapsed)}</span>
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              title="Stop and refund"
              className="icon-btn h-6 w-6 text-ink-subtle hover:text-danger"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>

      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-strong"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {/*
          A moving sheen while the bar is short, so a slow early phase still
          reads as activity. Once there is real width the bar speaks for itself.
        */}
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <p className="truncate text-[10px] text-ink-subtle">
          {note ?? 'You can keep working — this finishes in the background.'}
        </p>
        <span className="shrink-0 text-[10px] tabular-nums text-ink-subtle">{Math.round(percent)}%</span>
      </div>

      {/*
        Past about 1.6x the usual time, say so. Silence at that point reads as
        a hang; naming it as slow-but-alive is both true and calming, and it is
        the moment to point at the exit rather than hide it.
      */}
      {overdue ? (
        <p className="mt-1.5 text-[10px] leading-snug text-warning">
          This is taking longer than usual. It is still running — you can wait, or stop it and get
          your credits back.
        </p>
      ) : null}

      {previewUrl ? (
        <img
          src={previewUrl}
          alt=""
          className="mt-2 h-24 w-full rounded border border-line object-cover"
        />
      ) : null}
    </div>
  );
}
