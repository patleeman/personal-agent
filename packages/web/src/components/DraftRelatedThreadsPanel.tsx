import { summarizeConversationCwd } from '../conversationCwdHistory';
import type { RelatedConversationSearchResult } from '../relatedConversationSearch';
import { timeAgo } from '../utils';
import { cx } from './ui';

export function DraftRelatedThreadsPanel({
  query,
  results,
  selectedSessionIds,
  selectedCount,
  loading,
  busy,
  error,
  maxSelections,
  onToggle,
}: {
  query: string;
  results: RelatedConversationSearchResult[];
  selectedSessionIds: string[];
  selectedCount: number;
  loading: boolean;
  busy: boolean;
  error: string | null;
  maxSelections: number;
  onToggle: (sessionId: string) => void;
}) {
  if (!query.trim() && results.length === 0 && selectedCount === 0 && !loading && !busy && !error) {
    return null;
  }

  const subtitle = busy
    ? `Summarizing ${selectedCount} selected thread${selectedCount === 1 ? '' : 's'} before the new conversation starts.`
    : `Select up to ${maxSelections} recent threads to summarize into this conversation.`;

  return (
    <section className="mx-auto mt-4 w-full max-w-[42rem] text-left">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim/80">Related past threads</p>
          <p className="mt-1 text-[12px] text-secondary">{subtitle}</p>
        </div>
        <p className="shrink-0 text-[11px] text-dim">
          {selectedCount > 0 ? `${selectedCount}/${maxSelections} selected` : '⌃1–9 toggles results'}
        </p>
      </div>

      {results.length > 0 ? (
        <div className="mt-2 divide-y divide-border-subtle/60 border-y border-border-subtle/60">
          {results.map((result) => {
            const checked = selectedSessionIds.includes(result.sessionId);
            const inputId = `draft-related-thread-${result.sessionId}`;
            const matchedTerms = result.matchedTerms.slice(0, 3).join(' · ');
            return (
              <label
                key={result.sessionId}
                htmlFor={inputId}
                className={cx(
                  'flex cursor-pointer items-center gap-2.5 px-1 py-2 transition-colors hover:bg-elevated/35 focus-within:bg-elevated/45',
                  checked && 'bg-accent/7',
                )}
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(result.sessionId)}
                  className="h-4 w-4 shrink-0 rounded border-border-default text-accent focus:ring-2 focus:ring-accent/40"
                  aria-label={`Reuse context from ${result.title}`}
                  disabled={busy}
                />
                <span className="min-w-0 flex-1 truncate text-[13px] text-primary">
                  <span className="font-medium">{result.title}</span>
                  <span className="text-secondary">{` — ${summarizeConversationCwd(result.cwd) || result.cwd} · ${timeAgo(result.timestamp)}`}</span>
                  {matchedTerms && (
                    <span className="text-dim">{` · matches `}<span className="font-mono text-[11px] text-accent/85">{matchedTerms}</span></span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="mt-2 py-2 text-[12px] text-secondary">
          {query.trim().length > 0
            ? `No recent threads match “${query.trim()}”.`
            : 'Continue typing to search recent threads.'}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-dim">
        <span>
          {selectedCount > 0
            ? 'The selected threads will be summarized before your first prompt is sent.'
            : 'Only recent threads from roughly the last 7 days are searched right now.'}
        </span>
        <span aria-live="polite">
          {busy
            ? 'Summarizing…'
            : loading
              ? 'Searching…'
              : error
                ? error
                : '⌃1–9 toggles results'}
        </span>
      </div>
    </section>
  );
}
