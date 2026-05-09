import { memo, useCallback, useMemo, useState } from 'react';

import { parseSkillBlock } from '../../markdown/markdownExtensions';
import type { MessageBlock } from '../../shared/types';
import { timeAgo } from '../../shared/utils';
import { cx, SurfacePanel } from '../ui';
import type { ChatViewLayout } from './chatViewTypes.js';
import { ImagePreview, type InspectableImage } from './ImageMessageBlocks.js';
import { InlineTraceRunCard } from './InlineTraceRunCard.js';
import { buildInlineRunExpansionKey } from './linkedRunPolling.js';
import { readMentionedLinkedRunsFromText } from './linkedRuns.js';
import { renderMarkdownText, renderText, SkillInvocationCard } from './MarkdownMessage.js';
import { MessageActions } from './MessageActions.js';
import { buildReplySelectionScopeProps, type ReplySelectionGestureHandler } from './replySelection.js';
import { buildSummaryPreview } from './summaryPreview.js';

function formatInjectedContextLabel(customType?: string): string {
  if (!customType || customType === 'referenced_context') {
    return 'Injected context';
  }

  const normalized = customType.replace(/[_-]+/g, ' ').trim();
  if (!normalized) {
    return 'Injected context';
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

// ── UserMessage ───────────────────────────────────────────────────────────────

export const UserMessage = memo(function UserMessage({
  block,
  messageIndex,
  onRewindMessage,
  onForkMessage,
  onHydrateMessage,
  hydratingMessageBlockIds,
  onOpenFilePath,
  onOpenCheckpoint,
  onInspectImage,
  layout = 'default',
}: {
  block: Extract<MessageBlock, { type: 'user' }>;
  messageIndex?: number;
  onRewindMessage?: (messageIndex: number) => Promise<void> | void;
  onForkMessage?: (messageIndex: number) => Promise<void> | void;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
  onOpenFilePath?: (path: string) => void;
  onOpenCheckpoint?: (checkpointId: string) => void;
  onInspectImage?: (image: InspectableImage) => void;
  layout?: ChatViewLayout;
}) {
  const hasText = block.text.trim().length > 0;
  const skillBlock = hasText ? parseSkillBlock(block.text) : null;
  const handleRewind = useCallback(() => {
    if (typeof messageIndex !== 'number') {
      return;
    }

    return onRewindMessage?.(messageIndex);
  }, [messageIndex, onRewindMessage]);
  const handleFork = useCallback(() => {
    if (typeof messageIndex !== 'number') {
      return;
    }

    return onForkMessage?.(messageIndex);
  }, [messageIndex, onForkMessage]);
  const canAddressMessage = typeof messageIndex === 'number';

  return (
    <div className="group flex flex-col items-end gap-1.5">
      <div className={layout === 'compact' ? 'max-w-[92%] sm:max-w-[88%]' : 'max-w-[86%]'}>
        <div className="ui-message-card-user space-y-2">
          {block.images && block.images.length > 0 && (
            <div className="space-y-2">
              {block.images.map((image, index) => {
                const blockId = block.id?.trim();
                const loading = Boolean(blockId && hydratingMessageBlockIds?.has(blockId));
                const canHydrate = Boolean(image.deferred && blockId && onHydrateMessage);

                return (
                  <ImagePreview
                    key={`${image.caption ?? image.alt}-${index}`}
                    alt={image.alt}
                    src={image.src}
                    caption={image.caption}
                    width={image.width}
                    height={image.height}
                    maxHeight={280}
                    deferred={image.deferred}
                    loading={loading}
                    onLoad={canHydrate ? () => onHydrateMessage?.(blockId as string) : undefined}
                    onInspect={onInspectImage}
                  />
                );
              })}
            </div>
          )}
          {skillBlock ? (
            <div className="space-y-2 px-1.5 pb-0.5">
              <SkillInvocationCard skillBlock={skillBlock} className="ui-skill-invocation-user" onOpenFilePath={onOpenFilePath} />
              {skillBlock.userMessage && renderMarkdownText(skillBlock.userMessage, { onOpenFilePath, onOpenCheckpoint })}
            </div>
          ) : hasText ? (
            <div className="px-1.5 pb-0.5">{renderMarkdownText(block.text, { onOpenFilePath, onOpenCheckpoint })}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1 pr-1">
          <p className="ui-message-meta">{timeAgo(block.ts)}</p>
          <span className="flex-1" />
          <MessageActions
            isUser
            blockText={block.text}
            blockId={block.id}
            copyText={block.text}
            onRewind={onRewindMessage && canAddressMessage ? handleRewind : undefined}
            onFork={onForkMessage && canAddressMessage ? handleFork : undefined}
          />
        </div>
      </div>
    </div>
  );
});

// ── AssistantMessage ──────────────────────────────────────────────────────────

export const AssistantMessage = memo(function AssistantMessage({
  block,
  messageIndex,
  onForkMessage,
  onRewindMessage,
  onOpenFilePath,
  onOpenCheckpoint,
  onSelectionGesture,
  isInlineRunExpanded,
  onToggleInlineRun,
  showCursor = false,
  layout = 'default',
}: {
  block: Extract<MessageBlock, { type: 'text' }>;
  messageIndex?: number;
  onForkMessage?: (messageIndex: number) => Promise<void> | void;
  onRewindMessage?: (messageIndex: number) => Promise<void> | void;
  onOpenFilePath?: (path: string) => void;
  onOpenCheckpoint?: (checkpointId: string) => void;
  onSelectionGesture?: ReplySelectionGestureHandler;
  isInlineRunExpanded?: (inlineRunKey: string) => boolean;
  onToggleInlineRun?: (inlineRunKey: string) => void;
  showCursor?: boolean;
  layout?: ChatViewLayout;
}) {
  const shouldShowCursor = showCursor || !!block.streaming;
  const blockId = block.id?.trim() || undefined;
  const replySelectionScopeProps = buildReplySelectionScopeProps(messageIndex, blockId, onSelectionGesture);
  const handleRewind = useCallback(() => {
    if (typeof messageIndex !== 'number') {
      return;
    }

    return onRewindMessage?.(messageIndex);
  }, [messageIndex, onRewindMessage]);
  const handleFork = useCallback(() => {
    if (typeof messageIndex !== 'number') {
      return;
    }

    return onForkMessage?.(messageIndex);
  }, [messageIndex, onForkMessage]);
  const rawRunCallbackRuns = useMemo(() => readRawRunCallbackLinkedRuns(block.text), [block.text]);
  const showRawRunCallbackCard = rawRunCallbackRuns.length > 0;

  return (
    <div className={cx('group flex items-start', layout === 'compact' ? 'gap-2.5' : 'gap-3')}>
      <div className="ui-chat-avatar mt-0.5">
        <span className="ui-chat-avatar-mark">pa</span>
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div {...replySelectionScopeProps} className="ui-message-card-assistant text-primary space-y-1">
          {showRawRunCallbackCard ? (
            <RawRunCallbackCard
              runs={rawRunCallbackRuns}
              messageIndex={messageIndex}
              isInlineRunExpanded={isInlineRunExpanded}
              onToggleInlineRun={onToggleInlineRun}
            />
          ) : (
            renderText(block.text, { onOpenFilePath, onOpenCheckpoint })
          )}
          {shouldShowCursor && (
            <span
              className="inline-block w-[2px] h-[14px] bg-accent ml-0.5 rounded-sm"
              style={{ animation: 'cursorBlink 1s step-end infinite', verticalAlign: 'text-bottom' }}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <p className="ui-message-meta">{timeAgo(block.ts)}</p>
          <span className="flex-1" />
          <MessageActions
            blockText={block.text}
            blockId={blockId}
            copyText={block.text}
            onRewind={onRewindMessage && typeof messageIndex === 'number' ? handleRewind : undefined}
            onFork={onForkMessage && typeof messageIndex === 'number' ? handleFork : undefined}
          />
        </div>
      </div>
    </div>
  );
});

function readRawRunCallbackLinkedRuns(text: string) {
  if (!looksLikeRawRunCallback(text)) {
    return [];
  }

  const mentionedRuns = readMentionedLinkedRunsFromText(text);
  if (mentionedRuns.length > 0) {
    return mentionedRuns;
  }

  const directRunId = text.match(/\b(?:Durable run|Background task)\s+([^\s]+)\s+has finished\./)?.[1]?.trim();
  return directRunId ? readMentionedLinkedRunsFromText(`runId=${directRunId}`) : [];
}

function looksLikeRawRunCallback(text: string): boolean {
  return (
    /\b(?:Durable run|Background task)\s+\S+\s+has finished\./.test(text.trim()) &&
    /\btaskSlug=/.test(text) &&
    /\bstatus=/.test(text) &&
    /\blog=/.test(text) &&
    /Recent log tail:/.test(text)
  );
}

function RawRunCallbackCard({
  runs,
  messageIndex,
  isInlineRunExpanded,
  onToggleInlineRun,
}: {
  runs: ReturnType<typeof readMentionedLinkedRunsFromText>;
  messageIndex?: number;
  isInlineRunExpanded?: (inlineRunKey: string) => boolean;
  onToggleInlineRun?: (inlineRunKey: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-secondary">
        <span className="font-medium text-primary">Background work finished.</span>
        <span>Open the run card for logs and metadata.</span>
      </div>
      <div className="space-y-1.5">
        {runs.map((run) => {
          const inlineRunKey = buildInlineRunExpansionKey(messageIndex ?? 0, run.runId);
          return (
            <InlineTraceRunCard
              key={run.runId}
              run={run}
              expanded={isInlineRunExpanded?.(inlineRunKey) ?? false}
              onToggle={() => onToggleInlineRun?.(inlineRunKey)}
            />
          );
        })}
      </div>
    </div>
  );
}

export const ContextMessage = memo(function ContextMessage({
  block,
  messageIndex,
  onOpenFilePath,
  onOpenCheckpoint,
  onSelectionGesture,
  isInlineRunExpanded,
  onToggleInlineRun,
}: {
  block: Extract<MessageBlock, { type: 'context' }>;
  messageIndex?: number;
  onOpenFilePath?: (path: string) => void;
  onOpenCheckpoint?: (checkpointId: string) => void;
  onSelectionGesture?: ReplySelectionGestureHandler;
  isInlineRunExpanded?: (inlineRunKey: string) => boolean;
  onToggleInlineRun?: (inlineRunKey: string) => void;
}) {
  const label = formatInjectedContextLabel(block.customType);
  const blockId = block.id?.trim() || undefined;
  const replySelectionScopeProps = buildReplySelectionScopeProps(messageIndex, blockId, onSelectionGesture);
  const rawRunCallbackRuns = useMemo(() => readRawRunCallbackLinkedRuns(block.text), [block.text]);
  const showRawRunCallbackCard = rawRunCallbackRuns.length > 0;

  return (
    <div className="group">
      <div
        className="rounded-2xl rounded-l-md border-l-2 border-warning/35 bg-warning/5 px-3.5 py-3"
        data-context-type={block.customType ?? 'injected_context'}
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-warning">{label}</p>
          <span className="flex-1" />
          <p className="ui-message-meta">{timeAgo(block.ts)}</p>
        </div>
        <div {...replySelectionScopeProps} className="pt-2 text-primary">
          {showRawRunCallbackCard ? (
            <RawRunCallbackCard
              runs={rawRunCallbackRuns}
              messageIndex={messageIndex}
              isInlineRunExpanded={isInlineRunExpanded}
              onToggleInlineRun={onToggleInlineRun}
            />
          ) : (
            renderText(block.text, { onOpenFilePath, onOpenCheckpoint })
          )}
        </div>
      </div>
    </div>
  );
});

export function resolveCompactionSummaryLabel(title: string | undefined): string {
  const normalized = title?.trim();
  if (!normalized || normalized === 'Compaction summary') {
    return 'Context compacted';
  }

  return normalized;
}

export function resolveCompactionSummaryDetail(title: string | undefined, extraDetail?: string): string {
  const baseDetail = (() => {
    switch (title?.trim()) {
      case 'Manual compaction':
        return 'You explicitly summarized older turns to shrink the active context window.';
      case 'Proactive compaction':
        return 'Older turns were summarized because the context window was getting full. The conversation is ready for the next turn.';
      case 'Overflow recovery compaction':
        return 'Older turns were summarized after a context overflow so the interrupted turn could retry automatically.';
      default:
        return 'Older turns were summarized to keep the active context window focused.';
    }
  })();

  const normalizedExtraDetail = extraDetail?.trim();
  return normalizedExtraDetail ? `${baseDetail} ${normalizedExtraDetail}` : baseDetail;
}

export const SummaryMessage = memo(function SummaryMessage({
  block,
  messageIndex,
  onOpenFilePath,
  onOpenCheckpoint,
  onSelectionGesture,
}: {
  block: Extract<MessageBlock, { type: 'summary' }>;
  messageIndex?: number;
  onOpenFilePath?: (path: string) => void;
  onOpenCheckpoint?: (checkpointId: string) => void;
  onSelectionGesture?: ReplySelectionGestureHandler;
}) {
  const summaryPresentation = (() => {
    switch (block.kind) {
      case 'compaction':
        return {
          label: resolveCompactionSummaryLabel(block.title),
          detail: resolveCompactionSummaryDetail(block.title, block.detail),
          accentClass: 'border-warning/25 bg-warning/5',
          markerClass: 'border-warning/25 bg-warning/10 text-warning',
          labelClass: 'text-warning',
          marker: '≋',
          shouldCollapse: true,
        };
      case 'related':
        return {
          label: block.title || 'Reused thread summaries',
          detail:
            block.detail?.trim() ||
            'Selected conversations were summarized and injected before this prompt so this thread could start with reused context.',
          accentClass: 'border-accent/20 bg-accent/5',
          markerClass: 'border-accent/25 bg-accent/10 text-accent',
          labelClass: 'text-accent',
          marker: '⟲',
          shouldCollapse: true,
        };
      default:
        return {
          label: block.title || 'Branch summary',
          detail: block.detail?.trim() || 'Context from another branch was summarized while preserving the current path.',
          accentClass: 'border-teal/20 bg-teal/5',
          markerClass: 'border-teal/25 bg-teal/10 text-teal',
          labelClass: 'text-teal',
          marker: '⑂',
          shouldCollapse: false,
        };
    }
  })();
  const previewLineCount = 4;
  const previewText = useMemo(
    () => (summaryPresentation.shouldCollapse ? buildSummaryPreview(block.text, previewLineCount) : ''),
    [block.text, summaryPresentation.shouldCollapse],
  );
  const [expanded, setExpanded] = useState(() => !summaryPresentation.shouldCollapse);
  const blockId = block.id?.trim() || undefined;
  const replySelectionScopeProps = buildReplySelectionScopeProps(messageIndex, blockId, onSelectionGesture);

  return (
    <div className="group">
      <SurfacePanel muted className={cx('px-3.5 py-3.5', summaryPresentation.accentClass)} data-summary-kind={block.kind}>
        <div className="flex items-start gap-3">
          <div
            className={cx(
              'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold',
              summaryPresentation.markerClass,
            )}
          >
            <span aria-hidden="true">{summaryPresentation.marker}</span>
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cx('text-[10px] font-semibold uppercase tracking-[0.18em]', summaryPresentation.labelClass)}>
                {summaryPresentation.label}
              </p>
              <span className="flex-1" />
              <p className="ui-message-meta">{timeAgo(block.ts)}</p>
            </div>
            <div {...replySelectionScopeProps} className="space-y-3">
              <p className="text-[12px] leading-relaxed text-secondary">{summaryPresentation.detail}</p>
              <div className="text-primary">
                {summaryPresentation.shouldCollapse && !expanded ? (
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-primary">{previewText}</p>
                ) : (
                  renderText(block.text, { onOpenFilePath, onOpenCheckpoint })
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {summaryPresentation.shouldCollapse && (
                <button
                  type="button"
                  className="ui-action-button text-[11px]"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((current) => !current)}
                >
                  {expanded ? 'Hide summary' : 'Show summary'}
                </button>
              )}
              <span className="flex-1" />
              <MessageActions />
            </div>
          </div>
        </div>
      </SurfacePanel>
    </div>
  );
});
