/**
 * Interface primitives.
 *
 * Every new surface in the product is built from these, and they exist for one
 * reason: the brief asks for something usable "with no need of past
 * experience". That is not a visual problem, it is an information problem —
 * people fail at software when a control does not say what it does, what will
 * happen, or what a sensible value would be.
 *
 * So the primitives here make the explanatory parts *structural* rather than
 * optional. A `Field` takes a hint. A `NumberField` takes a range and shows it.
 * A `Section` takes a description. You cannot add a control to this product
 * without being asked what it is for, which is exactly the point.
 */
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { AlertTriangle, Check, ChevronDown, HelpCircle, Info, X } from 'lucide-react';
import { formatLength, parseLength, type UnitSystem } from '@novira/shared';

/* ── Help ──────────────────────────────────────────────────────────────── */

/**
 * A question mark that explains a control.
 *
 * Opens on hover *and* on focus, and closes on Escape, so it is reachable
 * without a mouse. Tooltips that only appear on hover are invisible to anyone
 * navigating by keyboard, which is the population most likely to need them.
 */
export function HelpTip({ text, label = 'What is this?' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-subtle transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-50 mb-1.5 w-60 -translate-x-1/2 rounded-lg border border-line bg-surface-strong px-3 py-2 text-[11px] font-normal leading-snug text-ink-muted shadow-panel"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

/* ── Layout ────────────────────────────────────────────────────────────── */

export function Section({
  title,
  description,
  help,
  action,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  description?: string;
  help?: string;
  action?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className="ed-section">
      <div className="mb-2 flex items-center gap-2">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={bodyId}
            className="flex flex-1 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ink-subtle transition ${open ? '' : '-rotate-90'}`} />
            <span className="ed-section-title mb-0">{title}</span>
          </button>
        ) : (
          <h3 className="ed-section-title mb-0 flex-1">{title}</h3>
        )}
        {help ? <HelpTip text={help} /> : null}
        {action}
      </div>
      {description && open ? <p className="mb-2.5 text-[11px] leading-snug text-ink-subtle">{description}</p> : null}
      <div id={bodyId} hidden={!open}>
        {open ? children : null}
      </div>
    </section>
  );
}

export function Field({
  label,
  hint,
  help,
  error,
  children,
  htmlFor,
  inline = false,
}: {
  label: string;
  hint?: string;
  help?: string;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
  inline?: boolean;
}) {
  return (
    <div className={inline ? 'flex items-center justify-between gap-3 py-1' : 'mb-2.5'}>
      <div className={inline ? 'min-w-0' : ''}>
        <label htmlFor={htmlFor} className="ed-label mb-0.5 flex items-center gap-1">
          {label}
          {help ? <HelpTip text={help} /> : null}
        </label>
        {hint && inline ? <p className="text-[10px] leading-snug text-ink-subtle">{hint}</p> : null}
      </div>
      <div className={inline ? 'shrink-0' : 'mt-1'}>{children}</div>
      {hint && !inline ? <p className="field-hint">{hint}</p> : null}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

/* ── Controls ──────────────────────────────────────────────────────────── */

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className = '', ...props }, ref) {
    return <input ref={ref} className={`ed-field ${className}`} {...props} />;
  }
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = '', children, ...props }, ref) {
    return (
      <select ref={ref} className={`ed-field ${className}`} {...props}>
        {children}
      </select>
    );
  }
);

/**
 * A number with a stated range.
 *
 * The range is shown, not just enforced. "Between 2 and 12" beside a control is
 * the difference between someone typing a value and someone guessing at one,
 * and it costs nothing to say.
 */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  hint,
  help,
  disabled,
  showRange = true,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  hint?: string;
  help?: string;
  disabled?: boolean;
  showRange?: boolean;
}) {
  const id = useId();
  const rangeHint = showRange ? `${min}–${max}${suffix ? ` ${suffix}` : ''}` : undefined;

  return (
    <Field label={label} help={help} htmlFor={id} hint={hint ?? rangeHint}>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="number"
          className="ed-field flex-1"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (!Number.isFinite(next)) return;
            onChange(Math.min(max, Math.max(min, next)));
          }}
        />
        {suffix ? <span className="shrink-0 text-[10px] font-medium text-ink-subtle">{suffix}</span> : null}
      </div>
    </Field>
  );
}

/**
 * A length, entered and displayed in the plan's own unit system.
 *
 * Storage is always millimetres; this is the only place the conversion is
 * exposed to a user, so someone working in feet never sees a millimetre and
 * someone working in metres never sees an inch.
 */
export function LengthField({
  label,
  valueMm,
  onChange,
  units,
  minMm = 0,
  maxMm = 100_000,
  hint,
  help,
  disabled,
}: {
  label: string;
  valueMm: number;
  onChange: (mm: number) => void;
  units: UnitSystem;
  minMm?: number;
  maxMm?: number;
  hint?: string;
  help?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(() => formatLength(valueMm, units, { bare: true }));
  const [focused, setFocused] = useState(false);

  // Follow the document while the field is not being edited. Rewriting the text
  // under someone's cursor is the classic controlled-input bug.
  useEffect(() => {
    if (!focused) setText(formatLength(valueMm, units, { bare: true }));
  }, [valueMm, units, focused]);

  const commit = () => {
    const parsed = parseLength(text, units);
    if (parsed === null) {
      setText(formatLength(valueMm, units, { bare: true }));
      return;
    }
    onChange(Math.min(maxMm, Math.max(minMm, parsed)));
  };

  return (
    <Field
      label={label}
      help={help}
      htmlFor={id}
      hint={hint ?? `${formatLength(minMm, units)} to ${formatLength(maxMm, units)}`}
    >
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          className="ed-field flex-1"
          value={text}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <span className="shrink-0 text-[10px] font-medium text-ink-subtle">
          {units === 'metric' ? 'm' : 'ft/in'}
        </span>
      </div>
    </Field>
  );
}

/** A slider with its value shown. A slider with no readout is a guess. */
export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
  help,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  help?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="mb-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="ed-label mb-0 flex items-center gap-1">
          {label}
          {help ? <HelpTip text={help} /> : null}
        </label>
        <span className="text-[11px] font-semibold tabular-nums text-ink">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        id={id}
        type="range"
        className="w-full accent-[rgb(var(--nv-primary))]"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
  help,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
  help?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="mb-2 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="flex cursor-pointer items-center gap-1 text-xs font-medium text-ink">
          {label}
          {help ? <HelpTip text={help} /> : null}
        </label>
        {hint ? <p className="mt-0.5 text-[10px] leading-snug text-ink-subtle">{hint}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-40 ${
          checked ? 'bg-primary' : 'bg-surface-muted'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
            checked ? 'left-[1.125rem]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  help,
  columns,
}: {
  label?: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  help?: string;
  columns?: number;
}) {
  const active = options.find((o) => o.value === value);
  return (
    <div className="mb-2.5">
      {label ? (
        <span className="ed-label mb-1 flex items-center gap-1">
          {label}
          {help ? <HelpTip text={help} /> : null}
        </span>
      ) : null}
      <div
        role="radiogroup"
        aria-label={label}
        className={columns ? 'grid gap-1' : 'flex flex-wrap gap-1'}
        style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              option.value === value
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-line bg-surface-muted/40 text-ink-muted hover:border-line-strong hover:text-ink'
            }`}
          >
            {option.icon}
            {option.label}
          </button>
        ))}
      </div>
      {/* The selected option's hint, always visible — a title attribute is
          invisible on touch and to a screen reader user who is not hovering. */}
      {active?.hint ? <p className="field-hint">{active.hint}</p> : null}
    </div>
  );
}

export function ColorField({
  label,
  value,
  onChange,
  help,
  presets,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  presets?: string[];
}) {
  const id = useId();
  return (
    <Field label={label} help={help} htmlFor={id}>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-9 shrink-0 cursor-pointer rounded border border-line bg-transparent"
        />
        <input
          className="ed-field flex-1 font-mono text-[11px]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} hex value`}
        />
      </div>
      {presets?.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-label={`Use ${preset}`}
              onClick={() => onChange(preset)}
              className={`h-5 w-5 rounded border transition ${
                value.toLowerCase() === preset.toLowerCase() ? 'border-primary ring-1 ring-primary' : 'border-line'
              }`}
              style={{ background: preset }}
            />
          ))}
        </div>
      ) : null}
    </Field>
  );
}

/* ── Feedback ──────────────────────────────────────────────────────────── */

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center rounded-xl border border-dashed border-line text-center ${compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-10'}`}>
      {icon ? <div className="text-ink-subtle">{icon}</div> : null}
      <div>
        <p className={`font-semibold text-ink ${compact ? 'text-sm' : 'text-base'}`}>{title}</p>
        <p className={`mx-auto mt-1 max-w-sm leading-snug text-ink-muted ${compact ? 'text-[11px]' : 'text-sm'}`}>
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

export type Severity = 'error' | 'warning' | 'info' | 'success' | 'suggestion';

const SEVERITY_STYLE: Record<Severity, { box: string; icon: ReactNode; label: string }> = {
  error: { box: 'border-danger/40 bg-danger/10', icon: <AlertTriangle className="h-3.5 w-3.5 text-danger" />, label: 'Must fix' },
  warning: { box: 'border-warning/40 bg-warning/10', icon: <AlertTriangle className="h-3.5 w-3.5 text-warning" />, label: 'Check this' },
  info: { box: 'border-info/40 bg-info/10', icon: <Info className="h-3.5 w-3.5 text-info" />, label: 'Note' },
  success: { box: 'border-success/40 bg-success/10', icon: <Check className="h-3.5 w-3.5 text-success" />, label: 'Passed' },
  suggestion: { box: 'border-line bg-surface-muted/50', icon: <Info className="h-3.5 w-3.5 text-ink-subtle" />, label: 'Suggestion' },
};

/**
 * One finding.
 *
 * Always three parts: what is wrong, what to do about it, and where the rule
 * came from. A warning a planner cannot check is a warning they learn to
 * ignore, so the rule is never omitted.
 */
export function FindingCard({
  severity,
  title,
  detail,
  action,
  rule,
  onShow,
  onFix,
  fixLabel = 'Fix it',
}: {
  severity: Severity;
  title: string;
  detail: string;
  action?: string;
  rule?: string;
  onShow?: () => void;
  onFix?: () => void;
  fixLabel?: string;
}) {
  const style = SEVERITY_STYLE[severity];
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${style.box}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{style.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-snug text-ink">{title}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{detail}</p>
          {action ? (
            <p className="mt-1 text-[11px] leading-snug text-ink">
              <span className="font-semibold">What to do: </span>
              {action}
            </p>
          ) : null}
          {rule ? <p className="mt-1 text-[10px] italic leading-snug text-ink-subtle">Rule applied: {rule}</p> : null}
          {onShow || onFix ? (
            <div className="mt-1.5 flex gap-1">
              {onShow ? (
                <button type="button" onClick={onShow} className="ed-action px-1.5 py-0.5 text-[10px]">
                  Show me
                </button>
              ) : null}
              {onFix ? (
                <button type="button" onClick={onFix} className="ed-action-primary px-1.5 py-0.5 text-[10px]">
                  {fixLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Data ──────────────────────────────────────────────────────────────── */

export function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
  help,
}: {
  label: string;
  /** A node rather than a string, so a formatted money value can be passed in. */
  value: ReactNode;
  sub?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  help?: string;
}) {
  const toneClass =
    tone === 'good' ? 'text-success' : tone === 'warn' ? 'text-warning' : tone === 'bad' ? 'text-danger' : 'text-ink';
  return (
    <div className="stat-tile">
      <p className={`stat-value ${toneClass}`}>{value}</p>
      <p className="stat-label flex items-center gap-1">
        {label}
        {help ? <HelpTip text={help} /> : null}
      </p>
      {sub ? <p className="mt-0.5 text-[10px] leading-snug text-ink-subtle">{sub}</p> : null}
    </div>
  );
}

/**
 * A progress bar for a long-running job.
 *
 * Always shows a label as well as a bar. A bar alone tells someone that
 * something is happening but not what, which is the state people cancel out of.
 */
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div>
      {label ? (
        <div className="mb-1 flex items-center justify-between text-[11px] text-ink-muted">
          <span>{label}</span>
          <span className="tabular-nums">{Math.round(clamped)}%</span>
        </div>
      ) : null}
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

/* ── Tabs ──────────────────────────────────────────────────────────────── */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ value: T; label: string; count?: number; icon?: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  /* Arrow-key navigation, as the tab pattern requires. */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = tabs.findIndex((t) => t.value === value);
    if (event.key === 'ArrowRight') onChange(tabs[(index + 1) % tabs.length]!.value);
    if (event.key === 'ArrowLeft') onChange(tabs[(index - 1 + tabs.length) % tabs.length]!.value);
  };

  return (
    <div ref={ref} role="tablist" onKeyDown={onKeyDown} className="flex gap-0.5 overflow-x-auto border-b border-line px-1">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          type="button"
          aria-selected={tab.value === value}
          tabIndex={tab.value === value ? 0 : -1}
          onClick={() => onChange(tab.value)}
          className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            tab.value === value
              ? 'border-primary text-primary'
              : 'border-transparent text-ink-subtle hover:text-ink'
          }`}
        >
          {tab.icon}
          {tab.label}
          {tab.count !== undefined && tab.count > 0 ? (
            <span className="rounded-full bg-surface-muted px-1.5 text-[10px] tabular-nums text-ink-muted">
              {tab.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ── Toasts ────────────────────────────────────────────────────────────── */

export interface ToastMessage {
  id: string;
  tone: 'success' | 'error' | 'info';
  text: string;
  /** Undo, or another single follow-up the user might want. */
  action?: { label: string; onClick: () => void };
}

let toastListener: ((toast: ToastMessage) => void) | null = null;

/**
 * Show a message.
 *
 * A module-level channel rather than a context, because the things that need to
 * report success are stores and API helpers, not components — threading a hook
 * through every one of them would mean the message is often simply not shown.
 */
export function toast(tone: ToastMessage['tone'], text: string, action?: ToastMessage['action']) {
  toastListener?.({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, tone, text, action });
}

export function ToastHost() {
  const [items, setItems] = useState<ToastMessage[]>([]);

  useEffect(() => {
    toastListener = (item) => {
      setItems((current) => [...current, item]);
      window.setTimeout(() => setItems((current) => current.filter((t) => t.id !== item.id)), 7000);
    };
    return () => {
      toastListener = null;
    };
  }, []);

  if (!items.length) return null;

  return (
    <div
      /*
       * Above the editor's bottom toolbar, not on top of it.
       *
       * At `bottom-4` a toast sat squarely over Save view, Start from and the
       * read-out — `pointer-events-auto` on each toast, so it also took the
       * clicks. The toolbar is 44 px tall, so clearing it needs 64 px; on
       * pages with no bottom bar the toast simply floats a little higher.
       */
      className="pointer-events-none fixed bottom-16 left-1/2 z-[80] flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4"
      // Announced by assistive technology without stealing focus.
      role="status"
      aria-live="polite"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={`pointer-events-auto flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm shadow-panel backdrop-blur ${
            item.tone === 'success'
              ? 'border-success/40 bg-success/15 text-success'
              : item.tone === 'error'
                ? 'border-danger/40 bg-danger/15 text-danger'
                : 'border-line bg-surface-strong/95 text-ink'
          }`}
        >
          <span className="min-w-0 flex-1">{item.text}</span>
          {item.action ? (
            <button
              type="button"
              onClick={() => {
                item.action!.onClick();
                setItems((current) => current.filter((t) => t.id !== item.id));
              }}
              className="shrink-0 text-xs font-bold underline underline-offset-2"
            >
              {item.action.label}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setItems((current) => current.filter((t) => t.id !== item.id))}
            className="shrink-0 opacity-60 transition hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── Loading ───────────────────────────────────────────────────────────── */

/**
 * A placeholder in the shape of what is coming.
 *
 * A bare "Loading…" tells someone that something is happening but not what, and
 * the page then jumps as content of an unexpected shape arrives. A skeleton in
 * roughly the right shape does both jobs, and costs nothing.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-muted/70 ${className}`} aria-hidden="true" />;
}

/** A grid of card-shaped placeholders, for a page that lists things. */
export function CardSkeletons({ count = 6, label = 'Loading' }: { count?: number; label?: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label={label}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card">
          <Skeleton className="mb-3 h-4 w-2/3" />
          <Skeleton className="mb-2 h-3 w-1/2" />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
          <Skeleton className="mt-4 h-8" />
        </div>
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/** Rows of placeholders, for a page that shows a table or a report. */
export function RowSkeletons({ count = 5, label = 'Loading' }: { count?: number; label?: string }) {
  return (
    <div className="space-y-2" role="status" aria-label={label}>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/* ── Money ─────────────────────────────────────────────────────────────── */

export function Money({ minor, currency, className = '' }: { minor: number; currency: string; className?: string }) {
  const value = minor / 100;
  let text: string;
  try {
    text = new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(value);
  } catch {
    text = `${currency.toUpperCase()} ${value.toFixed(2)}`;
  }
  return <span className={`tabular-nums ${className}`}>{text}</span>;
}
