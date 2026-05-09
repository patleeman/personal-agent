import { useCallback, useEffect, useState } from 'react';

export function ActivityShelf({
  pa,
  shelfContext,
}: {
  pa: { runs: { list(): Promise<unknown>; cancel(runId: string): Promise<unknown> } };
  shelfContext: { conversationId: string };
}) {
  const [runCount, setRunCount] = useState<number | null>(null);
  const [cancellingRunIds, setCancellingRunIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const runs = (await pa.runs.list()) as Array<{ runId: string; status?: { status: string }; tags?: Record<string, string> }>;
        if (cancelled) return;
        const active = runs.filter((r) => r.tags?.conversationId === shelfContext.conversationId && r.status?.status === 'running');
        setRunCount(active.length);
      } catch {
        if (!cancelled) setRunCount(null);
      }
      if (!cancelled) timeout = setTimeout(poll, 5000);
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [pa, shelfContext.conversationId]);

  const handleCancel = useCallback(
    async (runId: string) => {
      setCancellingRunIds((prev) => new Set(prev).add(runId));
      try {
        await pa.runs.cancel(runId);
      } finally {
        setCancellingRunIds((prev) => {
          const next = new Set(prev);
          next.delete(runId);
          return next;
        });
      }
    },
    [pa],
  );

  if (!runCount || runCount === 0) return null;

  return (
    <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 text-[11px]">
      <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center text-accent" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
      </span>
      <span className="text-secondary">
        {runCount} active run{runCount === 1 ? '' : 's'}
      </span>
      {cancellingRunIds.size > 0 && <span className="text-dim">Cancelling…</span>}
    </div>
  );
}
