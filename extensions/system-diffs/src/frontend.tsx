import type { ExtensionSurfaceProps } from '@personal-agent/extensions';
import { cx, Pill, SurfacePanel } from '@personal-agent/extensions/ui';
import {
  ConversationCheckpointWorkbenchPane,
  ConversationDiffRailContent,
  getConversationCheckpointIdFromSearch,
  readCheckpointPresentation,
  setConversationCheckpointIdInSearch,
  useConversationCheckpointSummaries,
} from '@personal-agent/extensions/workbench';
import React, { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import { CheckpointToolBlock } from './CheckpointToolBlock.js';

type CheckpointTranscriptBlock = {
  status?: string;
  running?: boolean;
  error?: boolean | string;
  input?: unknown;
  output?: string;
};

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function CheckpointFallbackToolBlock({ block }: { block: CheckpointTranscriptBlock }) {
  const isRunning = block.status === 'running' || !!block.running;
  const isError = block.status === 'error' || !!block.error;
  const input = readRecord(block.input);
  const action = readString(input.action) ?? 'checkpoint';
  const message = readString(input.message);
  const paths = Array.isArray(input.paths)
    ? input.paths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    : [];
  const title = isRunning
    ? 'Checkpoint running'
    : isError
      ? 'Checkpoint failed'
      : action === 'list'
        ? 'Listed checkpoints'
        : action === 'get'
          ? 'Loaded checkpoint'
          : 'Checkpoint';

  return (
    <SurfacePanel
      muted
      className={cx('px-3.5 py-3 text-[12px]', isError ? 'border-danger/30 bg-danger/5' : 'border-success/20 bg-success/5')}
    >
      <div className="flex items-start gap-3">
        <div className="ui-chat-avatar mt-0.5">
          <span className="ui-chat-avatar-mark">✓</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[13px] font-medium text-primary">{title}</span>
            <Pill tone={isError ? 'danger' : 'success'} mono>
              {action}
            </Pill>
            {isRunning ? <span className="text-[10px] text-dim">running…</span> : null}
          </div>
          {message || paths.length > 0 ? (
            <p className="mt-2 text-[11px] leading-relaxed text-secondary">{message ?? paths.join(', ')}</p>
          ) : null}
          {block.output ? (
            <pre
              className={cx('mt-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed', isError ? 'text-danger/85' : 'text-dim')}
            >
              {block.output}
            </pre>
          ) : null}
        </div>
      </div>
    </SurfacePanel>
  );
}

export function CheckpointTranscriptRenderer({
  block,
  context,
}: {
  block: CheckpointTranscriptBlock;
  context: { onOpenCheckpoint?: (checkpointId: string) => void; activeCheckpointId?: string | null };
}) {
  const checkpoint = readCheckpointPresentation(block as never);
  if (!checkpoint) return <CheckpointFallbackToolBlock block={block} />;
  return (
    <CheckpointToolBlock
      block={block}
      checkpoint={checkpoint}
      onOpenCheckpoint={context.onOpenCheckpoint}
      activeCheckpointId={context.activeCheckpointId}
    />
  );
}

export function ConversationDiffsPanel({ context }: ExtensionSurfaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { checkpoints, loading, error } = useConversationCheckpointSummaries(context.conversationId ?? null);
  const activeCheckpointId = getConversationCheckpointIdFromSearch(searchParams.toString());
  const handleOpenCheckpoint = useCallback(
    (checkpointId: string) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('file');
        next.delete('artifact');
        next.delete('run');
        return new URLSearchParams(setConversationCheckpointIdInSearch(next.toString(), checkpointId));
      });
    },
    [setSearchParams],
  );

  return (
    <ConversationDiffRailContent
      checkpoints={checkpoints}
      activeCheckpointId={activeCheckpointId}
      loading={loading}
      error={error}
      onOpenCheckpoint={handleOpenCheckpoint}
      workspaceCwd={context.cwd ?? null}
    />
  );
}

export function ConversationDiffDetailPanel({ context }: ExtensionSurfaceProps) {
  const checkpointId = getConversationCheckpointIdFromSearch(context.search);
  return (
    <ConversationCheckpointWorkbenchPane
      conversationId={context.conversationId ?? null}
      checkpointId={checkpointId}
      onMissingCheckpoint={() => undefined}
      workspaceCwd={context.cwd ?? null}
    />
  );
}
