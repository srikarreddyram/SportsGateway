import { dateLabel, todayISO } from '../lib/format';

const OFFSETS = [-2, -1, 0, 1, 2];

export function DateStrip({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto">
      {OFFSETS.map((offset) => {
        const iso = todayISO(offset);
        const active = iso === date;
        return (
          <button
            key={iso}
            onClick={() => onChange(iso)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? 'bg-accent text-white' : 'bg-surface text-text-muted hover:bg-surface-raised'
            }`}
          >
            {dateLabel(iso)}
          </button>
        );
      })}
      <input
        type="date"
        value={date}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="shrink-0 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-text-muted"
      />
    </div>
  );
}
