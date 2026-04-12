import type { FormEvent } from 'react';

interface ConversationSavedHeaderProps {
  title: string;
  cwd: string | null;
  onTitleClick?: () => void;
  cwdEditing: boolean;
  cwdDraft: string;
  cwdError?: string | null;
  cwdSaveBusy?: boolean;
  onCwdDraftChange: (value: string) => void;
  onCancelEditingCwd: () => void;
  onSaveCwd: () => void;
}

export function ConversationSavedHeader({
  title,
  cwd,
  onTitleClick,
  cwdEditing,
  cwdDraft,
  cwdError,
  cwdSaveBusy = false,
  onCwdDraftChange,
  onCancelEditingCwd,
  onSaveCwd,
}: ConversationSavedHeaderProps) {
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
