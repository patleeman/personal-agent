import { summarizeConversationCwd } from '../conversation/conversationCwdHistory';
import type { RelatedConversationSearchResult } from '../conversation/relatedConversationSearch';
import { timeAgo } from '../shared/utils';
import { cx, Keycap } from './ui';

const DEFAULT_RELATED_THREAD_HOTKEY_LIMIT = 9;
const WEAK_SELECTED_RELATED_THREAD_SCORE = 6;

function formatMatchedTerms(result: RelatedConversationSearchResult): string {
  return result.matchedTerms.slice(0, 3).join(', ');
}

function formatRowHotkey(index: number, limit: number): string | null {
  return index >= 0 && index < limit ? `Ctrl+${index + 1}` : null;
}

export function DraftRelatedThreadsPanel({
  query,
  results,
  selectedSessionIds,
  autoSelectedSessionIds,
  selectedCount,
  loading,
  busy,
  error,
  maxSelections,
  hotkeyLimit = DEFAULT_RELATED_THREAD_HOTKEY_LIMIT,
  onToggle,
}: {
  query: string;
  results: RelatedConversationSearchResult[];
  selectedSessionIds: string[];
  autoSelectedSessionIds?: string[];
  selectedCount: number;
  loading: boolean;
  busy: boolean;
  error: string | null;
  maxSelections: number;
  hotkeyLimit?: number;
  onToggle: (sessionId: string) => void;
}) {
  if (!query.trim() && results.length === 0 && selectedCount === 0 && !loading && !busy && !error) {
    return null;
  }

  const statusText = busy
    ? `Preparing ${selectedCount}…`
    : loading
      ? 'Searching…'
      : error
        ? error
        : selectedCount > 0
          ? `${selectedCount}/${maxSelections} selected`
          : hotkeyLimit > 1
            ? `⌃1–${hotkeyLimit}`
            : '⌃1';

  return (
    <section className="mx-auto mt-3 w-full max-w-[38rem] text-left">
      <div className="flex items-center justify-between gap-3 text-[11px] text-dim/85">
        <p className="min-w-0 truncate">
          <span className="font-semibold uppercase tracking-[0.14em] text-dim/80">Suggested context</span>
          <span className="ml-2 text-secondary">Auto-ranked from past conversations.</span>
        </p>
        <p className="shrink-0" aria-live="polite">
          {statusText}
        </p>
      </div>

      {results.length > 0 ? (
        <div className="mt-2 space-y-0.5">
          {results.map((result, index) => {
            const checked = selectedSessionIds.includes(result.sessionId);
            const autoSelected = checked && (autoSelectedSessionIds ?? []).includes(result.sessionId);
            const inputId = `draft-related-thread-${result.sessionId}`;
            const matchedTerms = formatMatchedTerms(result);
            const hotkey = formatRowHotkey(index, hotkeyLimit);
            const detail = result.summary?.displaySummary || result.snippet;
            const reason = result.reason || (matchedTerms ? `Matches ${matchedTerms}` : 'Recent in this workspace');
            const weakManualSelection = checked && !autoSelected && result.score < WEAK_SELECTED_RELATED_THREAD_SCORE;
            return (
              <label
                key={result.sessionId}
                htmlFor={inputId}
                className={cx(
                  'group flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-elevated/30 focus-within:bg-elevated/40 focus-within:ring-1 focus-within:ring-accent/20',
                  checked && 'bg-accent/7',
                  busy && 'cursor-progress',
                )}
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(result.sessionId)}
                  className={cx(
                    'h-4 w-4 shrink-0 appearance-none rounded-[4px] border border-border-default bg-surface/80 text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-[background-color,border-color,box-shadow,transform] duration-150 after:block after:h-[0.42rem] after:w-[0.22rem] after:translate-x-[0.26rem] after:translate-y-[0.01rem] after:rotate-45 after:border-b-[2px] after:border-r-[2px] after:border-transparent after:opacity-0 after:content-[""] checked:border-accent/70 checked:bg-accent/15 checked:shadow-[0_0_0_1px_rgba(var(--color-accent),0.12)] checked:after:border-current checked:after:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    !checked && 'group-hover:border-accent/30 group-hover:bg-elevated/70',
                    busy && 'cursor-progress',
                  )}
                  aria-label={`Reuse context from ${result.title}`}
                  disabled={busy}
                />
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="min-w-0 flex-1 text-[12px]">
                    <span className="block min-w-0 truncate text-primary">
                      <span className="font-medium">{result.title}</span>
                      <span className={cx('text-dim', checked && 'text-accent/70')}>
                        {` · ${summarizeConversationCwd(result.cwd) || result.cwd} · ${timeAgo(result.timestamp)}`}
                      </span>
                      {autoSelected && <span className="text-accent/80">· auto-selected</span>}
                    </span>
                    {(detail || reason) && (
                      <span className={cx('mt-0.5 block min-w-0 truncate text-[11px] text-secondary', checked && 'text-accent/70')}>
                        {[detail, reason].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    {weakManualSelection && (
                      <span className="mt-0.5 block min-w-0 truncate text-[11px] text-warning/80">
                        Weak match for this prompt; still included because you selected it.
                      </span>
                    )}
                  </span>
                  {hotkey && (
                    <Keycap className={cx('shrink-0 text-[9px]', checked && 'border-accent/25 bg-accent/10 text-accent/80')}>
                      {hotkey}
                    </Keycap>
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
