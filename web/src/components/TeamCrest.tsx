import { initials } from '../lib/format';

/** No real crest art ships with the mock provider, so a stable initials avatar stands in. */
export function TeamCrest({ name, size = 24 }: { name: string | null; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-surface-raised text-[11px] font-semibold text-text-muted"
      style={{ width: size, height: size }}
    >
      {initials(name)}
    </div>
  );
}
