import { useCallback, useEffect, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { timeAgo } from '../utils';
import { CompanionMarkdown } from './CompanionMarkdown';
import { COMPANION_NOTES_PATH } from './routes';
import { useCompanionTopBarAction } from './CompanionLayout';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border-subtle px-4 py-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function CompanionMemoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const fetchMemory = useCallback(() => {
    if (!id) {
      throw new Error('Missing memory id.');
    }

    return api.noteDoc(id);
  }, [id]);
  const { data, loading, refreshing, error, refetch } = useApi(fetchMemory, `companion-memory:${id ?? ''}`);

  const memory = data?.memory ?? null;
  const meta = [
    memory?.updated ? `updated ${timeAgo(memory.updated)}` : null,
    memory ? `@${memory.id}` : null,
  ].filter((value): value is string => Boolean(value));
  const { setTopBarRightAction } = useCompanionTopBarAction();

  useEffect(() => {
    setTopBarRightAction(
      <button
        type="button"
        onClick={() => { void refetch({ resetLoading: false }); }}
        disabled={refreshing}
        className="flex h-9 items-center rounded-full px-3 text-[12px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
      >
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>,
    );
    return () => setTopBarRightAction(undefined);
  }, [refreshing, refetch, setTopBarRightAction]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-6">
          {loading ? <p className="px-4 text-[13px] text-dim">Loading note…</p> : null}
          {!loading && error ? <p className="px-4 text-[13px] text-danger">Unable to load note: {error}</p> : null}
          {!loading && !error && !data ? <p className="px-4 text-[13px] text-dim">Note not found.</p> : null}

          {data && memory ? (
            <div className="overflow-hidden border-y border-border-subtle bg-surface/70">
              <Section title="Content">
                <CompanionMarkdown content={data.content} stripFrontmatter />
              </Section>

            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
