import { summarizeConversationCwd } from '../conversationCwdHistory';
import type { RelatedConversationSearchResult } from '../relatedConversationSearch';
import { timeAgo } from '../utils';
import { cx } from './ui';

function formatMatchedTerms(result: RelatedConversationSearchResult): string {
  return result.matchedTerms
    .slice(0, 3)
    .join(', ');
}

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

  const statusText = busy
    ? `Summarizing ${selectedCount}…`
    : loading
      ? 'Searching…'
      : error
        ? error
        : selectedCount > 0
          ? `${selectedCount}/${maxSelections} selected`
          : '⌃1–9';

  return (
    <section className="mx-auto mt-3 w-full max-w-[38rem] text-left">
      <div className="flex items-center justify-between gap-3 text-[11px] text-dim/85">
        <p className="min-w-0 truncate">
          <span className="font-semibold uppercase tracking-[0.14em] text-dim/80">Recent threads</span>
          <span className="ml-2 text-secondary">Select up to {maxSelections} to reuse context.</span>
        </p>
        <p className="shrink-0" aria-live="polite">{statusText}</p>
      </div>

      {results.length > 0 ? (
        <div className="mt-2 space-y-0.5">
          {results.map((result) => {
            const checked = selectedSessionIds.includes(result.sessionId);
            const inputId = `draft-related-thread-${result.sessionId}`;
            const matchedTerms = formatMatchedTerms(result);
            return (
              <label
                key={result.sessionId}
                htmlFor={inputId}
                className={cx(
                  'flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-elevated/30 focus-within:bg-elevated/40',
                  checked && 'bg-accent/7 text-accent',
                )}
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(result.sessionId)}
                  className="h-3.5 w-3.5 shrink-0 rounded border-border-default text-accent focus:ring-2 focus:ring-accent/40"
                  aria-label={`Reuse context from ${result.title}`}
                  disabled={busy}
                />
                <span className="min-w-0 flex-1 truncate text-[12px] text-primary">
                  <span className="font-medium">{result.title}</span>
                  <span className="text-dim">{` · ${summarizeConversationCwd(result.cwd) || result.cwd} · ${timeAgo(result.timestamp)}`}</span>
                  {matchedTerms && (
                    <span className="text-accent/80">{` · ${matchedTerms}`}</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 px-1.5 text-[12px] text-secondary">
          {query.trim().length > 0 ? `No recent threads match “${query.trim()}”.` : 'Type to search recent threads.'}
        </p>
      )}
    </section>
  );
}
