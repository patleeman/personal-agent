import type { RelatedConversationSearchResult } from '../../conversation/relatedConversationSearch';
import { DraftRelatedThreadsPanel } from '../DraftRelatedThreadsPanel';
import { cx } from '../ui';
import { BrowsePathButton, ChatBubbleIcon, FolderIcon } from './ConversationComposerChrome';

const DRAFT_EMPTY_STATE_CONTENT_WIDTH_CLASS = 'max-w-[38rem]';
const EMPTY_STATE_WORKSPACE_SELECT_CLASS =
  'h-8 w-full min-w-0 truncate appearance-none bg-transparent px-0 pr-7 text-[12px] outline-none transition-colors disabled:cursor-default disabled:opacity-60';

export { DRAFT_EMPTY_STATE_CONTENT_WIDTH_CLASS };

export function ConversationDraftEmptyAction({
  hasDraftCwd,
  draftCwdValue,
  draftCwdError,
  draftCwdPickBusy,
  savedWorkspacePathsLoading,
  availableDraftWorkspacePaths,
  relatedThreadQuery,
  relatedThreadResults,
  selectedRelatedThreadIds,
  autoSelectedRelatedThreadIds,
  relatedThreadSearchLoading,
  preparingRelatedThreadContext,
  relatedThreadSearchError,
  maxRelatedThreadSelections,
  relatedThreadHotkeyLimit,
  onClearDraftCwdSelection,
  onSelectDraftWorkspace,
  onPickDraftCwd,
  onToggleRelatedThread,
}: {
  hasDraftCwd: boolean;
  draftCwdValue: string;
  draftCwdError: string | null;
  draftCwdPickBusy: boolean;
  savedWorkspacePathsLoading: boolean;
  availableDraftWorkspacePaths: string[];
  relatedThreadQuery: string;
  relatedThreadResults: RelatedConversationSearchResult[];
  selectedRelatedThreadIds: string[];
  autoSelectedRelatedThreadIds: string[];
  relatedThreadSearchLoading: boolean;
  preparingRelatedThreadContext: boolean;
  relatedThreadSearchError: string | null;
  maxRelatedThreadSelections: number;
  relatedThreadHotkeyLimit: number;
  onClearDraftCwdSelection: () => void;
  onSelectDraftWorkspace: (workspacePath: string) => void;
  onPickDraftCwd: () => void;
  onToggleRelatedThread: (sessionId: string) => void;
}) {
  return (
    <div className="mt-4 w-full space-y-3">
      <div className="flex items-center justify-start gap-2 text-[11px] uppercase tracking-[0.16em] text-dim/80">
        {hasDraftCwd ? <FolderIcon className="text-accent" /> : <ChatBubbleIcon className="text-accent" />}
        <span>{hasDraftCwd ? 'Workspace' : 'Chat'}</span>
      </div>
      <div className="flex w-full flex-wrap items-center justify-start gap-1.5">
        <label className="relative min-w-[16rem] max-w-full flex-1 rounded-md border border-border-subtle bg-surface/45 px-2 shadow-sm">
          <span className="sr-only">Saved workspace</span>
          <select
            value={draftCwdValue}
            onChange={(event) => {
              const nextWorkspacePath = event.target.value.trim();
              if (!nextWorkspacePath) {
                onClearDraftCwdSelection();
                return;
              }

              onSelectDraftWorkspace(nextWorkspacePath);
            }}
            className={cx(EMPTY_STATE_WORKSPACE_SELECT_CLASS, hasDraftCwd ? 'font-mono text-primary' : 'text-secondary')}
            aria-label="Saved workspace"
            title={hasDraftCwd ? draftCwdValue : 'Start as a chat with no attached workspace.'}
            disabled={draftCwdPickBusy || (savedWorkspacePathsLoading && availableDraftWorkspacePaths.length === 0)}
          >
            <option value="">
              {savedWorkspacePathsLoading && availableDraftWorkspacePaths.length === 0 ? 'Loading workspaces…' : 'Chat — no workspace'}
            </option>
            {availableDraftWorkspacePaths.map((workspacePath) => (
              <option key={workspacePath} value={workspacePath}>
                {workspacePath}
              </option>
            ))}
          </select>
          <svg
            aria-hidden="true"
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-dim/70"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </label>

        <BrowsePathButton
          busy={draftCwdPickBusy}
          onClick={onPickDraftCwd}
          title={draftCwdPickBusy ? 'Choosing workspace…' : 'Choose workspace folder'}
          ariaLabel="Choose workspace folder"
        />
      </div>

      {draftCwdError && <p className="text-[11px] text-danger/80">{draftCwdError}</p>}

      <DraftRelatedThreadsPanel
        query={relatedThreadQuery}
        results={relatedThreadResults}
        selectedSessionIds={selectedRelatedThreadIds}
        autoSelectedSessionIds={autoSelectedRelatedThreadIds}
        selectedCount={selectedRelatedThreadIds.length}
        loading={relatedThreadSearchLoading}
        busy={preparingRelatedThreadContext}
        error={relatedThreadSearchError}
        maxSelections={maxRelatedThreadSelections}
        hotkeyLimit={relatedThreadHotkeyLimit}
        onToggle={onToggleRelatedThread}
      />
    </div>
  );
}
