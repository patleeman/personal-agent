import type { FormEvent } from 'react';
import { IconButton } from './ui';

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.75 7.5A1.5 1.5 0 0 1 5.25 6h4.018a1.5 1.5 0 0 1 1.06.44l1.172 1.17a1.5 1.5 0 0 0 1.06.44h6.19a1.5 1.5 0 0 1 1.5 1.5v7.95a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V7.5Z" />
      <path d="M3.75 9.75h16.5" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20.25h9" />
      <path d="m16.875 3.375 3.75 3.75" />
      <path d="M18.75 1.5a2.652 2.652 0 1 1 3.75 3.75L7.5 20.25l-4.5 1.5 1.5-4.5L18.75 1.5Z" />
    </svg>
  );
}

interface ConversationSavedHeaderProps {
  title: string;
  cwd: string | null;
  onTitleClick?: () => void;
  cwdEditing: boolean;
  cwdDraft: string;
  cwdError?: string | null;
  cwdPickBusy?: boolean;
  cwdSaveBusy?: boolean;
  cwdActionDisabledReason?: string | null;
  summarizeAndForkBusy?: boolean;
  summarizeAndForkDisabled?: boolean;
  summarizeAndForkTitle?: string | null;
  onPickCwd: () => void;
  onStartEditingCwd: () => void;
  onCwdDraftChange: (value: string) => void;
  onCancelEditingCwd: () => void;
  onSaveCwd: () => void;
  onSummarizeAndFork?: () => void;
}

export function ConversationSavedHeader({
  title,
  cwd,
  onTitleClick,
  cwdEditing,
  cwdDraft,
  cwdError,
  cwdPickBusy = false,
  cwdSaveBusy = false,
  cwdActionDisabledReason,
  summarizeAndForkBusy = false,
  summarizeAndForkDisabled = false,
  summarizeAndForkTitle,
  onPickCwd,
  onStartEditingCwd,
  onCwdDraftChange,
  onCancelEditingCwd,
  onSaveCwd,
  onSummarizeAndFork,
}: ConversationSavedHeaderProps) {
  const pickDisabled = Boolean(cwdActionDisabledReason) || cwdPickBusy || cwdSaveBusy;
  const editDisabled = Boolean(cwdActionDisabledReason) || cwdEditing || cwdPickBusy || cwdSaveBusy;
  const pickTitle = cwdPickBusy
    ? 'Choosing working directory…'
    : (cwdActionDisabledReason ?? 'Choose a new working directory for this conversation');
  const editTitle = cwdActionDisabledReason ?? 'Enter the working directory manually';

  return (
    <div className="space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 overflow-hidden">
        {onTitleClick ? (
          <h1 className="min-w-0 truncate">
            <button
              type="button"
              onClick={onTitleClick}
              title="Rename conversation"
              aria-label={`Rename conversation: ${title}`}
              className="ui-page-title inline-block max-w-full truncate rounded-sm text-left transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:ring-offset-2 focus-visible:ring-offset-base"
            >
              {title}
            </button>
          </h1>
        ) : (
          <h1 className="ui-page-title min-w-0 truncate">{title}</h1>
        )}
        {cwd && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-hidden">
            <span className="text-dim" aria-hidden="true">·</span>
            <span
              className="max-w-[24rem] shrink truncate font-mono text-[11px] text-dim"
              title={cwd}
            >
              {cwd}
            </span>
            <div className="flex shrink-0 items-center gap-0.5">
              <IconButton
                compact
                onClick={onPickCwd}
                disabled={pickDisabled}
                className="text-accent"
                title={pickTitle}
                aria-label="Choose a new working directory for this conversation"
              >
                <FolderIcon className={cwdPickBusy ? 'animate-pulse' : undefined} />
              </IconButton>
              <IconButton
                compact
                onClick={onStartEditingCwd}
                disabled={editDisabled}
                title={editTitle}
                aria-label="Enter the working directory manually"
              >
                <PencilIcon />
              </IconButton>
            </div>
          </div>
        )}
        {onSummarizeAndFork && (
          <button
            type="button"
            onClick={onSummarizeAndFork}
            disabled={summarizeAndForkDisabled}
            title={summarizeAndForkTitle ?? 'Duplicate this thread, compact the copy, and open it as a new conversation'}
            aria-label="Summarize and fork this conversation"
            className="ui-toolbar-button shrink-0 px-2 py-1 text-accent"
          >
            {summarizeAndForkBusy ? 'Summarizing…' : '≋⑂ summarize + fork'}
          </button>
        )}
      </div>
      {cwdEditing && (
        <form
          className="flex min-w-0 flex-wrap items-center gap-2"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            onSaveCwd();
          }}
        >
          <input
            autoFocus
            value={cwdDraft}
            onChange={(event) => onCwdDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancelEditingCwd();
              }
            }}
            placeholder={cwd ?? '~/workingdir/repo'}
            spellCheck={false}
            aria-label="Conversation working directory"
            className="min-w-[16rem] flex-1 rounded-lg border border-border-default bg-surface px-3 py-1.5 text-[12px] font-mono text-primary outline-none transition-colors focus:border-accent/60"
            disabled={cwdPickBusy || cwdSaveBusy}
          />
          <button type="submit" className="ui-toolbar-button text-accent" disabled={cwdPickBusy || cwdSaveBusy}>
            {cwdSaveBusy ? 'Switching…' : 'Switch'}
          </button>
          <button type="button" className="ui-toolbar-button" onClick={onCancelEditingCwd} disabled={cwdPickBusy || cwdSaveBusy}>
            Cancel
          </button>
        </form>
      )}
      {cwdError && (
        <p className="text-[11px] text-danger/80">{cwdError}</p>
      )}
    </div>
  );
}
