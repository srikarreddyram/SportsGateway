export type MatchFilter = 'all' | 'live';

export function FilterChips({
  value,
  onChange,
  liveCount,
}: {
  value: MatchFilter;
  onChange: (v: MatchFilter) => void;
  liveCount: number;
}) {
  const chip = (v: MatchFilter, label: string) => (
    <button
      onClick={() => onChange(v)}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        value === v ? 'bg-text text-bg' : 'bg-surface text-text-muted hover:bg-surface-raised'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-1.5">
      {chip('all', 'All')}
      {chip('live', liveCount > 0 ? `Live · ${liveCount}` : 'Live')}
    </div>
  );
}
