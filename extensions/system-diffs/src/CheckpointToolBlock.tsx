import { timeAgo } from '@personal-agent/extensions/data';
import { CheckpointInlineDiff, cx, Pill, SurfacePanel } from '@personal-agent/extensions/ui';
import type { readCheckpointPresentation } from '@personal-agent/extensions/workbench';
import React, { memo } from 'react';

const CheckpointToolBlock = memo(function CheckpointToolBlock({
  block,
  checkpoint,
  onOpenCheckpoint,
  activeCheckpointId,
}: {
  block: { status?: string; running?: boolean; error?: boolean | string; output?: string };
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
            <Pill tone={isError ? 'danger' : 'success'} mono>
              {checkpoint.shortSha}
            </Pill>
            {typeof checkpoint.fileCount === 'number' ? <span className="text-[10px] text-dim">{checkpoint.fileCount} files</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
            {typeof checkpoint.linesAdded === 'number' && typeof checkpoint.linesDeleted === 'number' ? (
              <span className="font-mono tabular-nums text-secondary">
                <span className="text-success">+{checkpoint.linesAdded}</span>{' '}
                <span className="text-danger">-{checkpoint.linesDeleted}</span>
              </span>
            ) : null}
            {typeof commentCount === 'number' && commentCount > 0 ? (
              <span className="text-dim">
                {commentCount} comment{commentCount === 1 ? '' : 's'}
              </span>
            ) : null}
            {checkpoint.updatedAt && <span className="text-dim">updated {timeAgo(checkpoint.updatedAt)}</span>}
          </div>
          {isError && block.output && <p className="mt-2 text-[12px] leading-relaxed text-danger/85">{block.output}</p>}
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

export { CheckpointToolBlock };
