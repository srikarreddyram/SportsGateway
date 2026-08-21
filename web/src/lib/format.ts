export function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function kickoffTime(iso: string | null): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dateLabel(iso: string): string {
  const today = todayISO();
  if (iso === today) return 'Today';
  if (iso === todayISO(-1)) return 'Yesterday';
  if (iso === todayISO(1)) return 'Tomorrow';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function initials(name: string | null): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  const letters = parts.length > 1 ? [parts[0][0], parts[parts.length - 1][0]] : [parts[0]?.[0], parts[0]?.[1]];
  return letters.filter(Boolean).join('').toUpperCase();
}

export function fullKickoff(iso: string | null): string {
  if (!iso) return 'TBD';
  return new Date(iso).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ageLabel(ageMs: number): string {
  if (ageMs < 1000) return 'just now';
  const s = Math.round(ageMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}
