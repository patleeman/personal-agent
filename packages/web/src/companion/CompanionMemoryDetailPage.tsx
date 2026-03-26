import { useCallback, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { timeAgo } from '../utils';
import { CompanionMarkdown } from './CompanionMarkdown';
import { COMPANION_NOTES_PATH } from './routes';

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
  const tags = memory?.tags.filter((tag) => tag.trim().length > 0) ?? [];
  const meta = [
    memory?.status,
    memory?.type,
    memory?.role,
    memory?.area,
    typeof memory?.referenceCount === 'number' ? `${memory.referenceCount} ${memory.referenceCount === 1 ? 'reference' : 'references'}` : null,
    memory?.updated ? `updated ${timeAgo(memory.updated)}` : null,
    memory ? `@${memory.id}` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border-subtle bg-base/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
          <div className="flex items-center justify-between gap-3">
            <Link to={COMPANION_NOTES_PATH} className="text-[12px] font-medium text-accent">← Notes</Link>
            <button
              type="button"
              onClick={() => { void refetch({ resetLoading: false }); }}
              disabled={refreshing}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">assistant companion</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-primary">{memory?.title ?? 'Note'}</h1>
          {memory ? (
            <>
              <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-secondary">{memory.summary || 'No summary available.'}</p>
              <p className="mt-3 break-words text-[12px] text-dim">{meta.join(' · ')}</p>
              {tags.length > 0 ? <p className="mt-2 break-words text-[11px] text-dim/85">{tags.join(' · ')}</p> : null}
            </>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-6">
          {loading ? <p className="px-4 text-[13px] text-dim">Loading note…</p> : null}
          {!loading && error ? <p className="px-4 text-[13px] text-danger">Unable to load note: {error}</p> : null}
          {!loading && !error && !data ? <p className="px-4 text-[13px] text-dim">Note not found.</p> : null}

          {data && memory ? (
            <div className="overflow-hidden border-y border-border-subtle bg-surface/70">
              <Section title="Content">
                <CompanionMarkdown content={data.content} />
              </Section>

              <Section title="References">
                {data.references.length > 0 ? (
                  <div className="space-y-2">
                    {data.references.map((reference) => (
                      <div key={reference.path} className="rounded-xl bg-base/65 px-3 py-3">
                        <p className="text-[14px] font-medium text-primary">{reference.title}</p>
                        <p className="mt-1 text-[13px] leading-relaxed text-secondary">{reference.summary || 'No summary available.'}</p>
                        <p className="mt-2 break-words text-[11px] text-dim">
                          {reference.updated ? `updated ${timeAgo(reference.updated)} · ` : ''}
                          {reference.relativePath}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[13px] text-dim">No references attached to this note node.</p>
                )}
              </Section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
