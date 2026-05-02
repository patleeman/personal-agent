import { memo } from 'react';
import { readArtifactPresentation } from '../../conversation/conversationArtifacts';
import { readCheckpointPresentation } from '../../conversation/conversationCheckpoints';
import type { MessageBlock } from '../../shared/types';
import { timeAgo } from '../../shared/utils';
import { Pill, SurfacePanel, cx } from '../ui';
import { CheckpointInlineDiff } from './CheckpointInlineDiff';

const ArtifactToolBlock = memo(function ArtifactToolBlock({
  block,
  artifact,
  onOpenArtifact,
  activeArtifactId,
}: {
  block: Extract<MessageBlock, { type: 'tool_use' }>;
  artifact: NonNullable<ReturnType<typeof readArtifactPresentation>>;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
}) {
  const isRunning = block.status === 'running' || !!block.running;
  const isError = block.status === 'error' || !!block.error;
  const isActive = activeArtifactId === artifact.artifactId;
  const actionLabel = isActive ? 'opened' : 'open';

  return (
    <SurfacePanel
      muted
      className={cx(
        'px-3.5 py-3 text-[12px] transition-colors',
        isError && 'border-danger/30 bg-danger/5',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="ui-chat-avatar mt-0.5">
          <span className="ui-chat-avatar-mark">◫</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[13px] font-medium text-primary">{artifact.title}</span>
            <Pill tone={isError ? 'danger' : 'accent'} mono>{artifact.kind}</Pill>
            {artifact.revision !== undefined && <span className="text-[10px] text-dim">rev {artifact.revision}</span>}
          </div>
          <p className="mt-1 break-all font-mono text-[11px] text-secondary">{artifact.artifactId}</p>
          {block.output && !isError && (
            <p className="mt-2 text-[12px] leading-relaxed text-secondary">{block.output}</p>
          )}
          {isError && block.output && (
            <p className="mt-2 text-[12px] leading-relaxed text-danger/85">{block.output}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
            {isRunning ? (
              <span className="inline-flex items-center gap-1.5 text-dim">
                <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
                saving artifact…
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onOpenArtifact?.(artifact.artifactId)}
                disabled={!onOpenArtifact}
                className={cx(
                  'text-accent transition-colors hover:text-accent/80 disabled:cursor-default disabled:text-dim',
                  isActive && 'text-dim hover:text-dim',
                )}
              >
                {actionLabel}
              </button>
            )}
            {artifact.updatedAt && <span className="text-dim">updated {timeAgo(artifact.updatedAt)}</span>}
          </div>
        </div>
      </div>
    </SurfacePanel>
  );
});

const CheckpointToolBlock = memo(function CheckpointToolBlock({
  block,
  checkpoint,
  onOpenCheckpoint,
  activeCheckpointId,
}: {
  block: Extract<MessageBlock, { type: 'tool_use' }>;
  checkpoint: NonNullable<ReturnType<typeof readCheckpointPresentation>>;
  onOpenCheckpoint?: (checkpointId: string) => void;
  activeCheckpointId?: string | null;
}) {
  const isRunning = block.status === 'running' || !!block.running;
  const isError = block.status === 'error' || !!block.error;
  const isActive = activeCheckpointId === checkpoint.checkpointId;
  const commentCount = (checkpoint as { commentCount?: number }).commentCount;

  return (
    <SurfacePanel
      muted
      className={cx(
        'px-3.5 py-3 text-[12px] transition-colors',
        isError ? 'border-danger/30 bg-danger/5' : 'border-success/20 bg-success/5',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="ui-chat-avatar mt-0.5">
          <span className="ui-chat-avatar-mark">✓</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[13px] font-medium text-primary">{checkpoint.subject}</span>
            <Pill tone={isError ? 'danger' : 'success'} mono>{checkpoint.shortSha}</Pill>
            {typeof checkpoint.fileCount === 'number' ? <span className="text-[10px] text-dim">{checkpoint.fileCount} files</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
            {typeof checkpoint.linesAdded === 'number' && typeof checkpoint.linesDeleted === 'number' ? (
              <span className="font-mono tabular-nums text-secondary"><span className="text-success">+{checkpoint.linesAdded}</span> <span className="text-danger">-{checkpoint.linesDeleted}</span></span>
            ) : null}
            {typeof commentCount === 'number' && commentCount > 0 ? (
              <span className="text-dim">{commentCount} comment{commentCount === 1 ? '' : 's'}</span>
            ) : null}
            {checkpoint.updatedAt && <span className="text-dim">updated {timeAgo(checkpoint.updatedAt)}</span>}
          </div>
          {isError && block.output && (
            <p className="mt-2 text-[12px] leading-relaxed text-danger/85">{block.output}</p>
          )}
          {isRunning ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 text-dim">
                <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
                saving checkpoint…
              </span>
            </div>
          ) : !isError && checkpoint.conversationId ? (
            <CheckpointInlineDiff
              conversationId={checkpoint.conversationId}
              checkpointId={checkpoint.checkpointId}
              onOpenCheckpoint={onOpenCheckpoint}
              modalOpen={isActive}
            />
          ) : !isError && onOpenCheckpoint ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => onOpenCheckpoint(checkpoint.checkpointId)}
                className={cx('ui-action-button text-[11px]', isActive ? 'text-secondary' : 'text-accent')}
              >
                {isActive ? 'Modal open' : 'Open modal'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </SurfacePanel>
  );
});

const BROWSER_TOOL_LABELS: Record<string, string> = {
  browser_snapshot: 'Browser snapshot',
  browser_cdp: 'Browser action',
  browser_screenshot: 'Browser screenshot',
};

function readBrowserUrl(block: Extract<MessageBlock, { type: 'tool_use' }>): string | null {
  const details = block.details && typeof block.details === 'object'
    ? block.details as { url?: unknown; state?: { url?: unknown } }
    : null;
  const input = block.input && typeof block.input === 'object'
    ? block.input as { command?: unknown }
    : null;

  if (typeof details?.url === 'string' && details.url.trim()) {
    return details.url.trim();
  }
  if (typeof details?.state?.url === 'string' && details.state.url.trim()) {
    return details.state.url.trim();
  }
  if (input?.command && typeof input.command === 'object' && !Array.isArray(input.command)) {
    const command = input.command as { method?: unknown; params?: { url?: unknown } };
    if (command.method === 'Page.navigate' && typeof command.params?.url === 'string' && command.params.url.trim()) {
      return command.params.url.trim();
    }
  }
  return null;
}

const BrowserToolBlock = memo(function BrowserToolBlock({
  block,
  onOpenBrowser,
}: {
  block: Extract<MessageBlock, { type: 'tool_use' }>;
  onOpenBrowser?: () => void;
}) {
  const isRunning = block.status === 'running' || !!block.running;
  const isError = block.status === 'error' || !!block.error;
  const url = readBrowserUrl(block);
  const title = BROWSER_TOOL_LABELS[block.tool] ?? 'Browser tool';

  return (
    <SurfacePanel
      muted
      className={cx(
        'px-3.5 py-3 text-[12px] transition-colors',
        isError && 'border-danger/30 bg-danger/5',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="ui-chat-avatar mt-0.5">
          <span className="ui-chat-avatar-mark">◎</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[13px] font-medium text-primary">{title}</span>
            <Pill tone={isError ? 'danger' : 'teal'} mono>browser</Pill>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-secondary">
            The agent used the Workbench Browser. Open it when you want to see or control the page.
          </p>
          {url ? <p className="mt-1 truncate font-mono text-[11px] text-secondary">{url}</p> : null}
          {isError && block.output ? (
            <p className="mt-2 text-[12px] leading-relaxed text-danger/85">{block.output}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
            {isRunning ? (
              <span className="inline-flex items-center gap-1.5 text-dim">
                <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
                using browser…
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onOpenBrowser?.()}
                disabled={!onOpenBrowser}
                className="text-accent transition-colors hover:text-accent/80 disabled:cursor-default disabled:text-dim"
              >
                Open browser
              </button>
            )}
          </div>
        </div>
      </div>
    </SurfacePanel>
  );
});

export { ArtifactToolBlock, CheckpointToolBlock, BrowserToolBlock };
