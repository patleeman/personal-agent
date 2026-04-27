import { cx } from '../ui';
import {
  BrowsePathButton,
  ChatBubbleIcon,
  FolderIcon,
  RemoteExecutionIcon,
} from './ConversationComposerChrome';
import { ConversationContextUsageIndicator, type ConversationContextUsageTokens } from './ConversationContextUsageIndicator';

export type ConversationGitSummaryPresentation =
  | { kind: 'none' }
  | { kind: 'summary'; text: string }
  | { kind: 'diff'; added: string; deleted: string };

export function ConversationComposerMeta({
  showExecutionTargetPicker,
  selectedExecutionTargetId,
  executionTargetOptions,
  continueInBusy,
  onSelectExecutionTarget,
  remoteOperationInlineStatus,
  remoteOperationStatusKind,
  draft,
  hasDraftCwd,
  selectedExecutionTargetIsRemote,
  selectedExecutionTargetLabel,
  draftCwdValue,
  draftCwdError,
  draftCwdPickBusy,
  availableDraftWorkspacePaths,
  onDraftRemoteCwdChange,
  onClearDraftCwdSelection,
  onSelectDraftWorkspace,
  onPickDraftCwd,
  conversationCwdEditorOpen,
  currentCwd,
  currentCwdLabel,
  conversationCwdDraft,
  conversationCwdError,
  conversationCwdBusy,
  conversationCwdPickBusy,
  onConversationCwdDraftChange,
  onSubmitConversationCwdChange,
  onCancelConversationCwdEdit,
  onPickConversationCwd,
  onBeginConversationCwdEdit,
  branchLabel,
  gitSummaryPresentation,
  hasGitSummary,
  sessionTokens,
}: {
  showExecutionTargetPicker: boolean;
  selectedExecutionTargetId: string;
  executionTargetOptions: Array<{ value: string; label: string }>;
  continueInBusy: boolean;
  onSelectExecutionTarget: (targetId: string) => void;
  remoteOperationInlineStatus: string | null;
  remoteOperationStatusKind: 'error' | 'info' | null;
  draft: boolean;
  hasDraftCwd: boolean;
  selectedExecutionTargetIsRemote: boolean;
  selectedExecutionTargetLabel: string;
  draftCwdValue: string;
  draftCwdError: string | null;
  draftCwdPickBusy: boolean;
  availableDraftWorkspacePaths: string[];
  onDraftRemoteCwdChange: (value: string) => void;
  onClearDraftCwdSelection: () => void;
  onSelectDraftWorkspace: (workspacePath: string) => void;
  onPickDraftCwd: () => void;
  conversationCwdEditorOpen: boolean;
  currentCwd: string | null;
  currentCwdLabel: string;
  conversationCwdDraft: string;
  conversationCwdError: string | null;
  conversationCwdBusy: boolean;
  conversationCwdPickBusy: boolean;
  onConversationCwdDraftChange: (value: string) => void;
  onSubmitConversationCwdChange: () => void;
  onCancelConversationCwdEdit: () => void;
  onPickConversationCwd: () => void;
  onBeginConversationCwdEdit: () => void;
  branchLabel: string | null;
  gitSummaryPresentation: ConversationGitSummaryPresentation;
  hasGitSummary: boolean;
  sessionTokens: ConversationContextUsageTokens | null;
}) {
  return (
    <div className="conversation-composer-meta mt-1.5 flex min-h-4 flex-row items-center justify-between gap-2 overflow-visible px-3 text-[10px] text-dim">
      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden">
        {showExecutionTargetPicker ? (
          <label className="relative inline-flex min-w-0 items-center">
            <span className="sr-only">Execution target</span>
            <RemoteExecutionIcon className="pointer-events-none absolute left-2 text-dim/70" />
            <select
              value={selectedExecutionTargetId}
              onChange={(event) => { onSelectExecutionTarget(event.target.value); }}
              disabled={continueInBusy}
              aria-label="Execution target"
              className="h-7 min-w-[8.25rem] max-w-[12rem] appearance-none rounded-md bg-transparent pl-6 pr-7 text-[11px] font-medium text-secondary outline-none transition-colors hover:bg-surface/45 hover:text-primary focus-visible:bg-surface/55 focus-visible:text-primary disabled:opacity-50"
            >
              {executionTargetOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-2 text-dim/70">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </label>
        ) : null}

        {remoteOperationInlineStatus ? (
          <span className={cx(remoteOperationStatusKind === 'error' ? 'text-danger/85' : 'text-accent/80')}>
            {remoteOperationInlineStatus}
          </span>
        ) : null}

        {draft ? (
          <div className="flex min-w-0 max-w-full flex-1 items-center gap-1.5 xl:max-w-[26rem] xl:flex-none">
            {hasDraftCwd ? <FolderIcon className="shrink-0 text-dim/70" /> : <ChatBubbleIcon className="shrink-0 text-dim/70" />}
            {selectedExecutionTargetIsRemote ? (
              <>
                <label className="sr-only" htmlFor="draft-composer-remote-cwd">Remote workspace path</label>
                <input
                  id="draft-composer-remote-cwd"
                  value={draftCwdValue}
                  onChange={(event) => { onDraftRemoteCwdChange(event.target.value); }}
                  placeholder="~/workingdir/project"
                  spellCheck={false}
                  className="h-7 min-w-0 w-full rounded-md border border-border-subtle bg-surface/45 px-2 text-[11px] font-mono text-primary outline-none transition-colors focus:border-accent/50 xl:max-w-[22rem]"
                  aria-label="Remote workspace path"
                />
                <BrowsePathButton
                  busy={draftCwdPickBusy}
                  onClick={onPickDraftCwd}
                  title={draftCwdPickBusy ? 'Choosing folder…' : `Choose directory on ${selectedExecutionTargetLabel}`}
                  ariaLabel={`Choose directory on ${selectedExecutionTargetLabel}`}
                />
              </>
            ) : (
              <>
                <label className="sr-only" htmlFor="draft-composer-cwd">Workspace folder</label>
                <div className="relative min-w-0 flex-1 xl:max-w-[22rem]">
                  <select
                    id="draft-composer-cwd"
                    value={draftCwdValue}
                    onChange={(event) => {
                      const nextWorkspacePath = event.target.value.trim();
                      if (!nextWorkspacePath) {
                        onClearDraftCwdSelection();
                        return;
                      }
                      onSelectDraftWorkspace(nextWorkspacePath);
                    }}
                    className="h-7 w-full min-w-0 truncate appearance-none rounded-md bg-transparent pl-1 pr-6 text-[11px] font-mono text-secondary outline-none transition-colors hover:bg-surface/45 hover:text-primary focus-visible:bg-surface/55 focus-visible:text-primary"
                  >
                    <option value="">Chat</option>
                    {availableDraftWorkspacePaths.map((workspacePath) => (
                      <option key={workspacePath} value={workspacePath}>{workspacePath}</option>
                    ))}
                  </select>
                  <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-dim/70">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </div>
                <BrowsePathButton
                  busy={draftCwdPickBusy}
                  onClick={onPickDraftCwd}
                  title={draftCwdPickBusy ? 'Choosing folder…' : 'Choose folder'}
                  ariaLabel="Choose folder"
                />
              </>
            )}
          </div>
        ) : conversationCwdEditorOpen ? (
          <form
            className="flex min-w-0 max-w-full flex-1 items-center gap-1.5 xl:max-w-[26rem] xl:flex-none"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmitConversationCwdChange();
            }}
          >
            <FolderIcon className="shrink-0 text-dim/70" />
            <input
              autoFocus
              value={conversationCwdDraft}
              onChange={(event) => { onConversationCwdDraftChange(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancelConversationCwdEdit();
                }
              }}
              placeholder={currentCwd ?? '~/workingdir/repo'}
              spellCheck={false}
              aria-label="Conversation working directory"
              className="h-7 min-w-0 w-full rounded-md border border-border-subtle bg-surface/45 px-2 text-[11px] font-mono text-primary outline-none transition-colors focus:border-accent/50 xl:max-w-[22rem]"
              disabled={conversationCwdBusy || conversationCwdPickBusy}
            />
            <BrowsePathButton
              busy={conversationCwdBusy || conversationCwdPickBusy}
              onClick={onPickConversationCwd}
              title={conversationCwdPickBusy ? 'Choosing folder…' : 'Choose folder'}
              ariaLabel="Choose folder"
            />
            <button type="submit" className="h-7 rounded-md px-2 text-[10px] text-accent transition-colors hover:bg-surface/45 disabled:opacity-50" disabled={conversationCwdBusy || conversationCwdPickBusy}>
              {conversationCwdBusy ? 'Switching…' : 'Switch'}
            </button>
            <button type="button" className="h-7 rounded-md px-2 text-[10px] text-secondary transition-colors hover:bg-surface/45 hover:text-primary disabled:opacity-50" onClick={onCancelConversationCwdEdit} disabled={conversationCwdBusy || conversationCwdPickBusy}>
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={onBeginConversationCwdEdit}
            className="flex min-w-0 max-w-full flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-secondary transition-colors hover:bg-surface/45 hover:text-primary xl:w-[26rem] xl:flex-none"
            title={currentCwd ? `Working directory: ${currentCwd}` : 'Set working directory'}
          >
            <FolderIcon className="shrink-0 text-dim/70" />
            <span className="ui-truncate-start min-w-0 flex-1 font-mono text-[11px]">{currentCwdLabel || 'Set working directory'}</span>
          </button>
        )}

        {(draft ? draftCwdError : conversationCwdError) ? (
          <span className="text-danger/85">{draft ? draftCwdError : conversationCwdError}</span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 text-right">
        {!draft && branchLabel ? (
          <span className="max-w-[8rem] truncate font-mono" title={branchLabel}>{branchLabel}</span>
        ) : null}
        {!draft && hasGitSummary ? (
          gitSummaryPresentation.kind === 'diff' ? (
            <span className="font-mono tabular-nums">
              <span className="text-success">{gitSummaryPresentation.added}</span>
              <span className="text-dim"> / </span>
              <span className="text-danger">{gitSummaryPresentation.deleted}</span>
            </span>
          ) : gitSummaryPresentation.kind === 'summary' ? (
            <span className="font-mono tabular-nums">{gitSummaryPresentation.text}</span>
          ) : null
        ) : null}
        {sessionTokens ? <ConversationContextUsageIndicator tokens={sessionTokens} /> : null}
      </div>
    </div>
  );
}
