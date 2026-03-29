import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import type { MemoryDocItem } from '../types';
import { timeAgo } from '../utils';
import { BrowserRecordRow } from '../components/ui';
import { buildCompanionNotePath, COMPANION_QUICK_NOTE_PATH } from './routes';

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
    <section className="pt-5 first:pt-0">
      <h2 className="px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-dim/70">{title}</h2>
      <div className="mt-2 space-y-2 px-4">
        {memories.map((memory) => {
          const meta = [
            memory.updated ? `updated ${timeAgo(memory.updated)}` : null,
            `@${memory.id}`,
          ].filter((value): value is string => Boolean(value));

          return (
            <BrowserRecordRow
              key={memory.id}
              to={buildCompanionNotePath(memory.id)}
              label={memory.status === 'archived' ? 'Archived note' : 'Note'}
              heading={memory.title}
              summary={memory.summary || '(no summary)'}
              meta={meta.join(' · ')}
              className="py-3.5"
              titleClassName="text-[15px]"
              summaryClassName="text-[13px]"
              metaClassName="text-[11px] break-words"
            />
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
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight text-primary">Notes</h1>
              <p className="mt-1 text-[11px] text-dim">
                {memories.length === 0
                  ? 'No note nodes yet.'
                  : `${memories.length} note nodes · ${archivedMemories.length} archived`}
              </p>
            </div>
            <Link
              to={COMPANION_QUICK_NOTE_PATH}
              className="inline-flex shrink-0 items-center rounded-full bg-accent px-3 py-2 text-[12px] font-medium text-accent-foreground transition-opacity hover:opacity-90"
            >
              Quick note
            </Link>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-4">
          {loading ? <p className="px-4 text-[13px] text-dim">Loading notes…</p> : null}
          {!loading && error ? <p className="px-4 text-[13px] text-danger">Unable to load notes: {error}</p> : null}
          {!loading && !error && memories.length === 0 ? (
            <div className="px-4 pt-5">
              <p className="text-[15px] text-primary">No notes yet.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                Save a quick note from your phone here, or distill longer-lived knowledge in the main workspace.
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
