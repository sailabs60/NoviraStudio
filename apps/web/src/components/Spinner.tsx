export function Spinner({ label, className = '' }: { label?: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-primary" />
      {label ? <p className="text-sm text-ink-muted">{label}</p> : null}
    </div>
  );
}
