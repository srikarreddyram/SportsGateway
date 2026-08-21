import type { CacheMeta } from '../types';
import { ageLabel } from '../lib/format';

const STYLES: Record<CacheMeta['cache'], string> = {
  HIT: 'bg-live/15 text-live border-live/30',
  STALE: 'bg-warn/15 text-warn border-warn/30',
  FALLBACK: 'bg-warn/15 text-warn border-warn/30',
  COALESCED: 'bg-accent/15 text-accent border-accent/30',
  MISS: 'bg-surface-raised text-text-muted border-border',
  BYPASS: 'bg-surface-raised text-text-muted border-border',
};

/**
 * Surfaces exactly what the gateway put in the response envelope. This exists because
 * the point of this project is the caching/degradation behavior, not the score itself —
 * a real sports app would hide this.
 */
export function CacheBadge({ meta }: { meta: CacheMeta }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide ${STYLES[meta.cache]}`}
      title={meta.note ?? `served from instance ${meta.instance}`}
    >
      {meta.cache}
      {meta.ageMs > 0 && <span className="opacity-70">· {ageLabel(meta.ageMs)}</span>}
      {meta.degraded && <span className="opacity-90">· degraded</span>}
    </span>
  );
}
