import React, { memo, useEffect, useMemo, useState, type RefObject } from 'react';
import type { AskUserQuestionAnswers, AskUserQuestionPresentation } from '../../transcript/askUserQuestions';
import type { MessageBlock } from '../../shared/types';
import { buildChatRenderItems, type ChatRenderItem } from './transcriptItems.js';
import { CHAT_VIEW_RENDERING_PROFILE, CHAT_WINDOWING_BADGE_DEFAULT_TOP_OFFSET_PX, WindowedChatChunk, type ChatViewPerformanceMode } from './chatWindowing.js';
import { ImageInspectModal, type InspectableImage } from './ImageMessageBlocks.js';
import { getStreamingStatusLabel } from './toolPresentation.js';
import type { ChatViewLayout } from './chatViewTypes.js';
import { useChatReplySelection } from './useChatReplySelection.js';
import { useInlineTraceRunExpansion } from './useInlineTraceRunExpansion.js';
import { useChatWindowing } from './useChatWindowing.js';
import { ChatRenderItemView } from './ChatRenderItemView.js';
import { SelectionContextMenu, StreamingIndicator, WindowingBadge } from './ChatTranscriptChrome.js';

// ── ToolBlock ─────────────────────────────────────────────────────────────────

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
  onFocusComposerRequest?: () => void;
  resumeConversationBusy?: boolean;
  resumeConversationTitle?: string | null;
  resumeConversationLabel?: string;
  windowingBadgeTopOffset?: number;
  anchorWindowingToTail?: boolean;
}

function shouldFocusComposerFromTranscriptPointerDown(event: React.PointerEvent<HTMLDivElement>): boolean {
  if (event.defaultPrevented || event.button !== 0) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }

  const selection = window.getSelection?.();
  if (selection && !selection.isCollapsed) {
    return false;
  }

  return !target.closest([
    '[data-message-index]',
    '[data-selection-reply-scope]',
    'a',
    'button',
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="menu"]',
  ].join(','));
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
  onFocusComposerRequest,
  resumeConversationBusy = false,
  resumeConversationTitle,
  resumeConversationLabel = 'continue',
  windowingBadgeTopOffset = CHAT_WINDOWING_BADGE_DEFAULT_TOP_OFFSET_PX,
  anchorWindowingToTail = false,
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

  const {
    shouldWindowTranscript,
    renderChunks,
    visibleChunkRange,
    updateChunkHeight,
  } = useChatWindowing({
    scrollContainerRef,
    renderItems,
    messageIndexOffset,
    renderingProfile,
    focusMessageIndex,
    anchorToTail: anchorWindowingToTail,
  });
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

  const renderChatItem = (item: ChatRenderItem, itemIndex: number) => (
    <ChatRenderItemView
      key={item.type === 'trace_cluster'
        ? `trace-${messageIndexOffset + item.startIndex}-${messageIndexOffset + item.endIndex}`
        : messageIndexOffset + item.index}
      item={item}
      itemIndex={itemIndex}
      renderItemsLength={renderItems.length}
      messageIndexOffset={messageIndexOffset}
      messages={messages}
      isStreaming={isStreaming}
      contentVisibilityStyle={contentVisibilityStyle}
      layout={layout}
      onForkMessage={onForkMessage}
      onRewindMessage={onRewindMessage}
      onReplyToSelection={onReplyToSelection}
      onHydrateMessage={onHydrateMessage}
      hydratingMessageBlockIds={hydratingMessageBlockIds}
      onOpenArtifact={onOpenArtifact}
      activeArtifactId={activeArtifactId}
      onOpenCheckpoint={onOpenCheckpoint}
      activeCheckpointId={activeCheckpointId}
      onOpenFilePath={onOpenFilePath}
      onSubmitAskUserQuestion={onSubmitAskUserQuestion}
      askUserQuestionDisplayMode={askUserQuestionDisplayMode}
      onResumeConversation={onResumeConversation}
      resumeConversationBusy={resumeConversationBusy}
      resumeConversationTitle={resumeConversationTitle}
      resumeConversationLabel={resumeConversationLabel}
      isInlineRunExpanded={isInlineRunExpanded}
      onToggleInlineRun={toggleInlineRun}
      onInspectImage={setSelectedImage}
      onSelectionGesture={scheduleReplySelectionSync}
    />
  );

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
  const windowingBadge = shouldWindowTranscript ? (
    <WindowingBadge
      topOffset={windowingBadgeTopOffset}
      loadedMessageCount={messages.length}
      mountedMessageCount={mountedMessageCount}
      mountedChunkCount={mountedChunkCount}
      totalChunkCount={renderChunks.length}
    />
  ) : null;
  return (
    <>
      <style>{`@keyframes cursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
      <div
        data-chat-transcript-panel="1"
        onContextMenu={handleTranscriptContextMenu}
        onPointerDown={(event) => {
          if (shouldFocusComposerFromTranscriptPointerDown(event)) {
            onFocusComposerRequest?.();
          }
        }}
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
        <SelectionContextMenu
          menuState={selectionContextMenu}
          menuRef={selectionContextMenuRef}
          onAction={runSelectionContextMenuAction}
        />
      ) : null}
      {selectedImage && <ImageInspectModal image={selectedImage} onClose={() => setSelectedImage(null)} />}
    </>
  );
});
