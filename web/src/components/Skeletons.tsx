function Shimmer({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-raised ${className}`} />;
}

export function MatchRowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-3 py-2.5">
      <Shimmer className="h-4 w-9" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Shimmer className="h-6 w-6 rounded-full" />
          <Shimmer className="h-3.5 w-32" />
        </div>
        <div className="flex items-center gap-2">
          <Shimmer className="h-6 w-6 rounded-full" />
          <Shimmer className="h-3.5 w-24" />
        </div>
      </div>
      <Shimmer className="h-8 w-6" />
    </div>
  );
}

export function LeagueSectionSkeleton() {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <header className="border-b border-border px-3 py-2">
        <Shimmer className="h-3 w-28" />
      </header>
      <div className="divide-y divide-border/60">
        <MatchRowSkeleton />
        <MatchRowSkeleton />
      </div>
    </section>
  );
}
