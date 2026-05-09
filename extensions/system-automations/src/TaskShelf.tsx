import { useEffect, useState } from 'react';

export function TaskShelf({
  pa,
  shelfContext,
}: {
  pa: { automations: { list(): Promise<unknown> } };
  shelfContext: { conversationId: string };
}) {
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [dueCount, setDueCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const tasks = (await pa.automations.list()) as Array<{ enabled: boolean; nextRunAt?: string }>;
        if (cancelled) return;
        const enabled = tasks.filter((t) => t.enabled);
        const now = Date.now();
        setTaskCount(enabled.length);
        setDueCount(enabled.filter((t) => t.nextRunAt && new Date(t.nextRunAt).getTime() <= now + 60000).length);
      } catch {
        if (!cancelled) {
          setTaskCount(null);
          setDueCount(null);
        }
      }
      if (!cancelled) timeout = setTimeout(poll, 10000);
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [pa]);

  if (!taskCount || taskCount === 0) return null;

  return (
    <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 text-[11px]">
      <span className="text-secondary">
        {taskCount} scheduled task{taskCount === 1 ? '' : 's'}
      </span>
      {dueCount && dueCount > 0 ? <span className="text-accent">{dueCount} due soon</span> : null}
    </div>
  );
}
