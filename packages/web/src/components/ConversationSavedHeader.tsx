import type { FormEvent } from 'react';

interface ConversationSavedHeaderProps {
  title: string;
  cwd: string | null;
  onTitleClick?: () => void;
  cwdEditing: boolean;
  cwdDraft: string;
  cwdError?: string | null;
  cwdSaveBusy?: boolean;
  executionHostId?: string | null;
  executionHostLabel?: string | null;
  continueInOptions?: Array<{ value: string; label: string }>;
  continueInBusy?: boolean;
  onContinueIn?: (hostId: string) => void;
  onCwdDraftChange: (value: string) => void;
  onCancelEditingCwd: () => void;
  onSaveCwd: () => void;
}

function RemoteExecutionIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1.75" y="2" width="4.5" height="3.5" rx="1" />
      <rect x="7.75" y="8.5" width="4.5" height="3.5" rx="1" />
      <path d="M6.2 4.8h1.5c1.1 0 2 .9 2 2v1" />
      <path d="M7.9 7.8 9.7 7.8 9.7 6" />
    </svg>
  );
}

export function ConversationSavedHeader({
  title,
  cwd,
  onTitleClick,
  cwdEditing,
  cwdDraft,
  cwdError,
  cwdSaveBusy = false,
  executionHostId,
  executionHostLabel,
  continueInOptions = [],
  continueInBusy = false,
  onContinueIn,
  onCwdDraftChange,
  onCancelEditingCwd,
  onSaveCwd,
}: ConversationSavedHeaderProps) {
  const selectedExecutionHostId = executionHostId?.trim() || 'local';
  const remoteExecutionLabel = executionHostLabel?.trim() || null;

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
        {remoteExecutionLabel ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent" title={`Running on ${remoteExecutionLabel}`}>
            <RemoteExecutionIcon />
            <span>{remoteExecutionLabel}</span>
          </span>
        ) : null}
      </div>
      {onContinueIn && continueInOptions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-secondary">
          <span>Continue in</span>
          <select
            value={selectedExecutionHostId}
            onChange={(event) => onContinueIn(event.target.value)}
            disabled={continueInBusy}
            aria-label="Execution target"
            className="min-w-[11rem] rounded-lg border border-border-default bg-surface px-2.5 py-1.5 text-[12px] text-primary outline-none transition-colors focus:border-accent/60 disabled:opacity-60"
          >
            {continueInOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {continueInBusy ? <span className="text-accent/80">Switching…</span> : null}
        </div>
      ) : null}
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
            disabled={cwdSaveBusy}
          />
          <button type="submit" className="ui-toolbar-button text-accent" disabled={cwdSaveBusy}>
            {cwdSaveBusy ? 'Switching…' : 'Switch'}
          </button>
          <button type="button" className="ui-toolbar-button" onClick={onCancelEditingCwd} disabled={cwdSaveBusy}>
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
