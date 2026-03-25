import { useMemo } from 'react';
import { api } from '../api';
import { useApi } from '../hooks';
import type { MemoryDocItem } from '../types';
import { timeAgo } from '../utils';

function sortCompanionMemories(memories: MemoryDocItem[]): MemoryDocItem[] {
  return [...memories].sort((left, right) => {
    const archivedOrder = Number(left.status === 'archived') - Number(right.status === 'archived');
    if (archivedOrder !== 0) {
      return archivedOrder;
    }

    const leftUsage = Number(left.usedInLastSession) * 10 + (left.recentSessionCount ?? 0);
    const rightUsage = Number(right.usedInLastSession) * 10 + (right.recentSessionCount ?? 0);
    return rightUsage - leftUsage
      || (right.updated ?? '').localeCompare(left.updated ?? '')
      || left.title.localeCompare(right.title);
  });
}

function formatReferenceCount(count: number | undefined): string {
  const value = count ?? 0;
  return `${value} ${value === 1 ? 'reference' : 'references'}`;
}

function MemoriesSection({
  title,
  memories,
}: {
  title: string;
  memories: MemoryDocItem[];
}) {
  if (memories.length === 0) {
    return null;
  }

  return (
    <section className="pt-6 first:pt-0">
      <h2 className="px-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">{title}</h2>
      <div className="mt-3 border-y border-border-subtle">
        {memories.map((memory) => {
          const meta = [
            formatReferenceCount(memory.referenceCount),
            memory.updated ? `updated ${timeAgo(memory.updated)}` : null,
            memory.role,
            memory.area,
            memory.type,
            `@${memory.id}`,
          ].filter((value): value is string => Boolean(value));
          const tags = memory.tags.slice(0, 3).join(' · ');

          return (
            <div key={memory.id} className="border-b border-border-subtle px-4 py-4 last:border-b-0">
              <h3 className="truncate text-[16px] font-medium leading-tight text-primary">{memory.title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-secondary">{memory.summary || '(no summary)'}</p>
              <p className="mt-2 break-words text-[11px] text-dim">{meta.join(' · ')}</p>
              {tags ? <p className="mt-1 break-words text-[11px] text-dim/85">{tags}</p> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function CompanionMemoriesPage() {
  const { data, loading, error } = useApi(api.memory, 'companion-memories');
  const memories = useMemo(() => sortCompanionMemories(data?.memoryDocs ?? []), [data?.memoryDocs]);
  const activeMemories = useMemo(
    () => memories.filter((memory) => memory.status !== 'archived'),
    [memories],
  );
  const archivedMemories = useMemo(
    () => memories.filter((memory) => memory.status === 'archived'),
    [memories],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border-subtle bg-base/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">assistant companion</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-primary">Memories</h1>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-secondary">
            Browse durable memory packages and recent knowledge from the same mobile companion app.
          </p>
          <p className="mt-3 text-[12px] text-dim">
            {memories.length === 0
              ? 'No memory packages available.'
              : `${memories.length} package${memories.length === 1 ? '' : 's'} · ${archivedMemories.length} archived.`}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-6">
          {loading ? <p className="px-4 text-[13px] text-dim">Loading memories…</p> : null}
          {!loading && error ? <p className="px-4 text-[13px] text-danger">Unable to load memories: {error}</p> : null}
          {!loading && !error && memories.length === 0 ? (
            <div className="px-4 pt-6">
              <p className="text-[15px] text-primary">No memories yet.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                Distill or create memory packages in the main workspace and they will show up here automatically.
              </p>
            </div>
          ) : null}
          {!loading && !error && memories.length > 0 ? (
            <>
              <MemoriesSection title="Active" memories={activeMemories} />
              <MemoriesSection title="Archived" memories={archivedMemories} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
