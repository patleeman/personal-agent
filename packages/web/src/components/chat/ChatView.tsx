import React, { memo, useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import type { AskUserQuestionAnswers, AskUserQuestionPresentation } from '../../transcript/askUserQuestions';
import type { MessageBlock } from '../../shared/types';
import { buildChatRenderItems, type ChatRenderItem } from './transcriptItems.js';
import { buildChatRenderChunks, CHAT_VIEW_RENDERING_PROFILE, CHAT_WINDOWING_BADGE_DEFAULT_TOP_OFFSET_PX, CHAT_WINDOWING_FALLBACK_SPAN_HEIGHT, formatWindowingCount, resolveChunkIndexForOffset, WindowedChatChunk, type ChatViewPerformanceMode } from './chatWindowing.js';
import { ErrorBlock, SubagentBlock, ThinkingBlock, TraceClusterBlock } from './TraceBlocks.js';
import { ImageBlock, ImageInspectModal, type InspectableImage } from './ImageMessageBlocks.js';
import { AssistantMessage, ContextMessage, SummaryMessage, UserMessage } from './MessageBlocks.js';
import { getStreamingStatusLabel, shouldAutoOpenConversationBlock } from './toolPresentation.js';
import { ToolBlock } from './ToolBlock.js';
import type { ChatViewLayout } from './chatViewTypes.js';
import { useChatReplySelection } from './useChatReplySelection.js';
import { useInlineTraceRunExpansion } from './useInlineTraceRunExpansion.js';

// ── ToolBlock ─────────────────────────────────────────────────────────────────

function StreamingIndicator({ label }: { label: string }) {
  return (
    <div className="flex gap-3 items-start" role="status" aria-live="polite">
      <div className="ui-chat-avatar mt-0.5">
        <span className="ui-chat-avatar-mark">pa</span>
      </div>
      <div className="flex items-center gap-2 pt-1 text-[12px] text-secondary italic">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent animate-pulse not-italic" />
        <span>{label}</span>
      </div>
    </div>
  );
}

// ── ChatView ──────────────────────────────────────────────────────────────────

interface ChatViewProps {
  messages: MessageBlock[];
  messageIndexOffset?: number;
  scrollContainerRef?: RefObject<HTMLDivElement>;
  focusMessageIndex?: number | null;
  isStreaming?: boolean;
  isCompacting?: boolean;
  pendingStatusLabel?: string | null;
  performanceMode?: ChatViewPerformanceMode;
  layout?: ChatViewLayout;
  onForkMessage?: (messageIndex: number) => Promise<void> | void;
  onRewindMessage?: (messageIndex: number) => Promise<void> | void;
  onReplyToSelection?: (selection: { text: string; messageIndex: number; blockId?: string }) => Promise<void> | void;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
  onOpenCheckpoint?: (checkpointId: string) => void;
  activeCheckpointId?: string | null;
  onOpenFilePath?: (path: string) => void;
  onSubmitAskUserQuestion?: (presentation: AskUserQuestionPresentation, answers: AskUserQuestionAnswers) => Promise<void> | void;
  askUserQuestionDisplayMode?: 'inline' | 'composer';
  onResumeConversation?: () => Promise<void> | void;
  resumeConversationBusy?: boolean;
  resumeConversationTitle?: string | null;
  resumeConversationLabel?: string;
  windowingBadgeTopOffset?: number;
}

export const ChatView = memo(function ChatView({
  messages,
  messageIndexOffset = 0,
  scrollContainerRef,
  focusMessageIndex = null,
  isStreaming = false,
  isCompacting = false,
  pendingStatusLabel = null,
  performanceMode = 'default',
  layout = 'default',
  onForkMessage,
  onRewindMessage,
  onReplyToSelection,
  onHydrateMessage,
  hydratingMessageBlockIds,
  onOpenArtifact,
  activeArtifactId,
  onOpenCheckpoint,
  activeCheckpointId,
  onOpenFilePath,
  onSubmitAskUserQuestion,
  askUserQuestionDisplayMode = 'inline',
  onResumeConversation,
  resumeConversationBusy = false,
  resumeConversationTitle,
  resumeConversationLabel = 'continue',
  windowingBadgeTopOffset = CHAT_WINDOWING_BADGE_DEFAULT_TOP_OFFSET_PX,
}: ChatViewProps) {
  const renderItems = useMemo(() => buildChatRenderItems(messages), [messages]);
  const { isInlineRunExpanded, toggleInlineRun } = useInlineTraceRunExpansion(renderItems);

  const streamingStatusLabel = isCompacting
    ? 'Compacting context…'
    : pendingStatusLabel ?? getStreamingStatusLabel(messages, isStreaming);
  const renderingProfile = CHAT_VIEW_RENDERING_PROFILE[performanceMode];
  const lastBlock = messages[messages.length - 1];
  const showStreamingIndicator = !!streamingStatusLabel
    && (isCompacting || Boolean(pendingStatusLabel) || !lastBlock || lastBlock.type === 'user');
  const shouldUseContentVisibility = renderItems.length >= renderingProfile.contentVisibilityThreshold;
  const [contentVisibilityReady, setContentVisibilityReady] = useState(false);

  useEffect(() => {
    if (!shouldUseContentVisibility) {
      setContentVisibilityReady(false);
      return;
    }

    // Let the transcript fully lay out once before enabling content-visibility.
    // Initial scroll-to-bottom logic depends on an accurate scrollHeight.
    const animationFrame = window.requestAnimationFrame(() => {
      setContentVisibilityReady(true);
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [shouldUseContentVisibility]);

  const contentVisibilityStyle = useMemo<React.CSSProperties | undefined>(
    () => (shouldUseContentVisibility && contentVisibilityReady ? { contentVisibility: 'auto' } : undefined),
    [contentVisibilityReady, shouldUseContentVisibility],
  );

  const shouldWindowTranscript = Boolean(scrollContainerRef) && renderItems.length >= renderingProfile.windowingThreshold;
  const renderChunks = useMemo(
    () => (shouldWindowTranscript ? buildChatRenderChunks(renderItems, messageIndexOffset, renderingProfile.windowingChunkSize) : []),
    [messageIndexOffset, renderItems, renderingProfile.windowingChunkSize, shouldWindowTranscript],
  );
  const [viewport, setViewport] = useState<{ scrollTop: number; clientHeight: number } | null>(null);
  const [chunkHeights, setChunkHeights] = useState<Record<string, number>>({});
  const [selectedImage, setSelectedImage] = useState<InspectableImage | null>(null);
  const {
    selectionContextMenu,
    selectionContextMenuRef,
    scheduleReplySelectionSync,
    runSelectionContextMenuAction,
    handleTranscriptContextMenu,
  } = useChatReplySelection({ onReplyToSelection, scrollContainerRef });

  useEffect(() => {
    if (!selectedImage || typeof document === 'undefined') {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedImage(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedImage]);

  useEffect(() => {
    if (!shouldWindowTranscript) {
      setViewport(null);
      return;
    }

    const scrollEl = scrollContainerRef?.current;
    if (!scrollEl) {
      return;
    }

    let frame = 0;
    const sync = () => {
      frame = 0;
      const next = {
        scrollTop: scrollEl.scrollTop,
        clientHeight: scrollEl.clientHeight,
      };
      setViewport((current) => (
        current && current.scrollTop === next.scrollTop && current.clientHeight === next.clientHeight
          ? current
          : next
      ));
    };
    const scheduleSync = () => {
      if (frame !== 0) {
        return;
      }

      frame = window.requestAnimationFrame(sync);
    };

    scheduleSync();
    scrollEl.addEventListener('scroll', scheduleSync, { passive: true });
    window.addEventListener('resize', scheduleSync);

    return () => {
      scrollEl.removeEventListener('scroll', scheduleSync);
      window.removeEventListener('resize', scheduleSync);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [shouldWindowTranscript, scrollContainerRef]);

  const averageSpanHeight = useMemo(() => {
    const measurements = renderChunks
      .map((chunk) => ({ height: chunkHeights[chunk.key], spanCount: chunk.spanCount }))
      .filter((entry): entry is { height: number; spanCount: number } => typeof entry.height === 'number' && entry.height > 0 && entry.spanCount > 0);

    if (measurements.length === 0) {
      return CHAT_WINDOWING_FALLBACK_SPAN_HEIGHT;
    }

    const totalHeight = measurements.reduce((sum, entry) => sum + entry.height, 0);
    const totalSpans = measurements.reduce((sum, entry) => sum + entry.spanCount, 0);
    return totalSpans > 0 ? totalHeight / totalSpans : CHAT_WINDOWING_FALLBACK_SPAN_HEIGHT;
  }, [chunkHeights, renderChunks]);

  const chunkLayouts = useMemo(() => {
    let top = 0;
    return renderChunks.map((chunk) => {
      const estimatedHeight = Math.max(1, chunk.spanCount * averageSpanHeight);
      const height = chunkHeights[chunk.key] ?? estimatedHeight;
      const layout = {
        ...chunk,
        top,
        height,
        bottom: top + height,
      };
      top += height;
      return layout;
    });
  }, [averageSpanHeight, chunkHeights, renderChunks]);

  const updateChunkHeight = useCallback((chunkKey: string, height: number) => {
    setChunkHeights((current) => (current[chunkKey] === height ? current : { ...current, [chunkKey]: height }));
  }, []);

  const renderChatItem = useCallback((item: ChatRenderItem, itemIndex: number) => {
    const isTailItem = itemIndex === renderItems.length - 1;

    if (item.type === 'trace_cluster') {
      const live = isStreaming && isTailItem;

      return (
        <div
          key={`trace-${messageIndexOffset + item.startIndex}-${messageIndexOffset + item.endIndex}`}
          data-chat-tail={isTailItem ? '1' : undefined}
          style={contentVisibilityStyle}
        >
          {item.blocks.map((_, offset) => {
            const absoluteIndex = messageIndexOffset + item.startIndex + offset;
            return <span key={`anchor-${absoluteIndex}`} id={`msg-${absoluteIndex}`} className="block h-0 overflow-hidden" aria-hidden />;
          })}
          <TraceClusterBlock
            clusterStartIndex={item.startIndex}
            blocks={item.blocks}
            summary={item.summary}
            live={live}
            onOpenArtifact={onOpenArtifact}
            activeArtifactId={activeArtifactId}
            onOpenCheckpoint={onOpenCheckpoint}
            activeCheckpointId={activeCheckpointId}
            onOpenFilePath={onOpenFilePath}
            onResume={isTailItem ? onResumeConversation : undefined}
            resumeBusy={resumeConversationBusy}
            resumeTitle={resumeConversationTitle}
            resumeLabel={resumeConversationLabel}
            isInlineRunExpanded={isInlineRunExpanded}
            onToggleInlineRun={toggleInlineRun}
          />
        </div>
      );
    }

    const block = item.block;
    const markerKind = block.type === 'user'
      ? 'user'
      : block.type === 'text' || (block.type === 'tool_use' && block.tool === 'ask_user_question')
        ? 'assistant'
        : undefined;
    const absoluteIndex = messageIndexOffset + item.index;
    const autoOpen = shouldAutoOpenConversationBlock(block, item.index, messages.length, isStreaming);
    const showStreamingCursor = isStreaming && block.type === 'text' && item.index === messages.length - 1;

    const el = (() => {
      switch (block.type) {
        case 'user':
          return (
            <UserMessage
              block={block}
              messageIndex={absoluteIndex}
              onRewindMessage={onRewindMessage}
              onHydrateMessage={onHydrateMessage}
              hydratingMessageBlockIds={hydratingMessageBlockIds}
              onOpenFilePath={onOpenFilePath}
              onOpenCheckpoint={onOpenCheckpoint}
              onInspectImage={setSelectedImage}
              layout={layout}
            />
          );
        case 'text':
          return (
            <AssistantMessage
              block={block}
              messageIndex={absoluteIndex}
              showCursor={showStreamingCursor}
              onRewindMessage={onRewindMessage}
              onForkMessage={onForkMessage}
              onOpenFilePath={onOpenFilePath}
              onOpenCheckpoint={onOpenCheckpoint}
              onSelectionGesture={onReplyToSelection ? scheduleReplySelectionSync : undefined}
              layout={layout}
            />
          );
        case 'context':
          return <ContextMessage block={block} messageIndex={absoluteIndex} onOpenFilePath={onOpenFilePath} onOpenCheckpoint={onOpenCheckpoint} onSelectionGesture={onReplyToSelection ? scheduleReplySelectionSync : undefined} />;
        case 'summary':
          return <SummaryMessage block={block} messageIndex={absoluteIndex} onOpenFilePath={onOpenFilePath} onOpenCheckpoint={onOpenCheckpoint} onSelectionGesture={onReplyToSelection ? scheduleReplySelectionSync : undefined} />;
        case 'thinking':
          return <ThinkingBlock block={block} autoOpen={autoOpen} />;
        case 'tool_use':
          return (
            <ToolBlock
              block={block}
              autoOpen={autoOpen}
              onOpenArtifact={onOpenArtifact}
              activeArtifactId={activeArtifactId}
              onOpenCheckpoint={onOpenCheckpoint}
              activeCheckpointId={activeCheckpointId}
              onOpenFilePath={onOpenFilePath}
              onHydrateMessage={onHydrateMessage}
              hydratingMessageBlockIds={hydratingMessageBlockIds}
              messages={messages}
              messageIndex={item.index}
              onSubmitAskUserQuestion={onSubmitAskUserQuestion}
              askUserQuestionDisplayMode={askUserQuestionDisplayMode}
            />
          );
        case 'subagent':
          return <SubagentBlock block={block} />;
        case 'image':
          return <ImageBlock block={block} onHydrateMessage={onHydrateMessage} hydratingMessageBlockIds={hydratingMessageBlockIds} onInspectImage={setSelectedImage} />;
        case 'error':
          return (
            <ErrorBlock
              block={block}
              messageIndex={absoluteIndex}
              onResume={isTailItem ? onResumeConversation : undefined}
              resumeBusy={resumeConversationBusy}
              resumeTitle={resumeConversationTitle}
              resumeLabel={resumeConversationLabel}
              onOpenFilePath={onOpenFilePath}
              onSelectionGesture={onReplyToSelection ? scheduleReplySelectionSync : undefined}
            />
          );
        default:
          return null;
      }
    })();

    return el ? (
      <div
        key={absoluteIndex}
        id={`msg-${absoluteIndex}`}
        data-message-index={absoluteIndex}
        data-chat-tail={isTailItem ? '1' : undefined}
        data-conversation-rail-kind={markerKind}
        style={contentVisibilityStyle}
      >
        {el}
      </div>
    ) : null;
  }, [activeArtifactId, activeCheckpointId, askUserQuestionDisplayMode, contentVisibilityStyle, hydratingMessageBlockIds, isInlineRunExpanded, isStreaming, layout, messageIndexOffset, messages, messages.length, onForkMessage, onHydrateMessage, onOpenArtifact, onOpenCheckpoint, onOpenFilePath, onReplyToSelection, onSubmitAskUserQuestion, onResumeConversation, onRewindMessage, renderItems.length, resumeConversationBusy, resumeConversationLabel, resumeConversationTitle, scheduleReplySelectionSync, toggleInlineRun]);

  const visibleChunkRange = useMemo(() => {
    if (!shouldWindowTranscript || chunkLayouts.length === 0) {
      return null;
    }

    const totalHeight = chunkLayouts[chunkLayouts.length - 1]?.bottom ?? 0;
    const tops = chunkLayouts.map((chunk) => chunk.top);
    const heights = chunkLayouts.map((chunk) => chunk.height);
    const focusChunkIndex = focusMessageIndex === null
      ? -1
      : chunkLayouts.findIndex((chunk) => focusMessageIndex >= chunk.startMessageIndex && focusMessageIndex <= chunk.endMessageIndex);

    let startChunkIndex: number;
    let endChunkIndex: number;

    if (viewport === null) {
      const anchorChunkIndex = focusChunkIndex >= 0 ? focusChunkIndex : chunkLayouts.length - 1;
      startChunkIndex = Math.max(0, anchorChunkIndex - renderingProfile.windowingOverscanChunks);
      endChunkIndex = Math.min(chunkLayouts.length - 1, anchorChunkIndex + renderingProfile.windowingOverscanChunks);
    } else {
      const viewportTop = Math.max(0, viewport.scrollTop);
      const viewportBottom = viewportTop + Math.max(1, viewport.clientHeight);
      const firstVisibleChunkIndex = resolveChunkIndexForOffset(viewportTop, tops, heights);
      const lastVisibleChunkIndex = resolveChunkIndexForOffset(viewportBottom, tops, heights);
      startChunkIndex = Math.max(0, firstVisibleChunkIndex - renderingProfile.windowingOverscanChunks);
      endChunkIndex = Math.min(chunkLayouts.length - 1, lastVisibleChunkIndex + renderingProfile.windowingOverscanChunks);

      if (focusChunkIndex >= 0 && (focusChunkIndex < startChunkIndex || focusChunkIndex > endChunkIndex)) {
        startChunkIndex = Math.max(0, focusChunkIndex - renderingProfile.windowingOverscanChunks);
        endChunkIndex = Math.min(chunkLayouts.length - 1, focusChunkIndex + renderingProfile.windowingOverscanChunks);
      }
    }

    const topSpacerHeight = startChunkIndex > 0 ? chunkLayouts[startChunkIndex].top : 0;
    const bottomSpacerHeight = endChunkIndex < chunkLayouts.length - 1
      ? Math.max(0, totalHeight - chunkLayouts[endChunkIndex].bottom)
      : 0;

    return {
      chunks: chunkLayouts.slice(startChunkIndex, endChunkIndex + 1),
      topSpacerHeight,
      bottomSpacerHeight,
    };
  }, [chunkLayouts, focusMessageIndex, renderingProfile.windowingOverscanChunks, shouldWindowTranscript, viewport]);

  const fullTranscript = (
    <div className="space-y-4">
      {renderItems.map((item, itemIndex) => renderChatItem(item, itemIndex))}
    </div>
  );

  const windowedTranscript = visibleChunkRange ? (
    <>
      {visibleChunkRange.topSpacerHeight > 0 && <div style={{ height: visibleChunkRange.topSpacerHeight }} aria-hidden />}
      {visibleChunkRange.chunks.map((chunk) => (
        <WindowedChatChunk
          key={chunk.key}
          chunk={chunk}
          renderItem={renderChatItem}
          onHeightChange={updateChunkHeight}
          includeTrailingGap={chunk.endItemIndex < renderItems.length - 1 || showStreamingIndicator}
        />
      ))}
      {visibleChunkRange.bottomSpacerHeight > 0 && <div style={{ height: visibleChunkRange.bottomSpacerHeight }} aria-hidden />}
    </>
  ) : fullTranscript;
  const mountedMessageCount = visibleChunkRange
    ? visibleChunkRange.chunks.reduce((sum, chunk) => sum + chunk.spanCount, 0)
    : messages.length;
  const mountedChunkCount = visibleChunkRange?.chunks.length ?? renderChunks.length;
  const selectionContextMenuItemClass = 'ui-context-menu-item';
  const windowingBadge = shouldWindowTranscript ? (
    <div
      className="sticky z-10 mb-3 flex justify-end pointer-events-none"
      style={{ top: `${Math.max(0, windowingBadgeTopOffset)}px` }}
    >
      <div className="inline-flex min-h-[2rem] items-center gap-2 rounded-lg border border-border-subtle bg-surface/88 px-3 py-1.5 text-[10px] text-secondary shadow-sm backdrop-blur">
        <span className="font-medium uppercase tracking-[0.16em] text-primary/85">windowing</span>
        <span>{formatWindowingCount(messages.length)} loaded</span>
        <span className="text-dim">·</span>
        <span>{formatWindowingCount(mountedMessageCount)} mounted</span>
        <span className="text-dim">·</span>
        <span>{mountedChunkCount}/{renderChunks.length} chunks</span>
      </div>
    </div>
  ) : null;
  return (
    <>
      <style>{`@keyframes cursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
      <div
        data-chat-transcript-panel="1"
        onContextMenu={handleTranscriptContextMenu}
        className={layout === 'compact' ? 'px-2.5 py-3 sm:px-4 sm:py-4' : 'mx-auto w-full max-w-6xl pl-6 pr-10 pt-5 pb-24'}
      >
        {/* Bottom padding (pb-24) keeps the last message clear of the input area
            when the user is scrolled to the bottom and the textarea grows
            while typing (e.g. multi-line input). */}
        {windowingBadge}
        {shouldWindowTranscript ? windowedTranscript : fullTranscript}
        {showStreamingIndicator && (
          <div className={shouldWindowTranscript && visibleChunkRange?.chunks.length ? '' : 'mt-4'}>
            <StreamingIndicator label={streamingStatusLabel ?? 'Working…'} />
          </div>
        )}
      </div>
      {selectionContextMenu ? (
        <div
          ref={selectionContextMenuRef}
          className="ui-menu-shell ui-context-menu-shell fixed bottom-auto left-auto right-auto top-auto mb-0 min-w-[224px]"
          style={{ left: selectionContextMenu.x, top: selectionContextMenu.y }}
          role="menu"
          aria-label="Selected transcript text actions"
          data-selection-context-menu="true"
        >
          <div className="space-y-px">
            {selectionContextMenu.replySelection ? (
              <>
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={() => { void runSelectionContextMenuAction('reply'); }}
                  className={selectionContextMenuItemClass}
                  role="menuitem"
                >
                  Reply with Selection
                </button>
                <div className="mx-1 my-1 h-px bg-border-subtle" role="separator" />
              </>
            ) : null}
            <button
              type="button"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={() => { void runSelectionContextMenuAction('copy'); }}
              className={selectionContextMenuItemClass}
              role="menuitem"
            >
              Copy
            </button>
          </div>
        </div>
      ) : null}
      {selectedImage && <ImageInspectModal image={selectedImage} onClose={() => setSelectedImage(null)} />}
    </>
  );
});
