import React, { memo, type RefObject, useEffect, useMemo, useRef, useState } from 'react';

import { recordChatRenderTiming } from '../../client/perfDiagnostics';
import { type ExtensionSelectionActionRegistration, useExtensionRegistry } from '../../extensions/useExtensionRegistry';
import type { LiveSessionToolDefinition, MessageBlock } from '../../shared/types';
import type { AskUserQuestionAnswers, AskUserQuestionPresentation } from '../../transcript/askUserQuestions';
import { ChatRenderItemView } from './ChatRenderItemView.js';
import { SelectionContextMenu, StreamingIndicator } from './ChatTranscriptChrome.js';
import type { ChatViewLayout } from './chatViewTypes.js';
import { CHAT_VIEW_RENDERING_PROFILE, type ChatViewPerformanceMode, WindowedChatChunk } from './chatWindowing.js';
import { ImageInspectModal, type InspectableImage } from './ImageMessageBlocks.js';
import { SystemPromptMessage } from './MessageBlocks.js';
import { getStreamingStatusLabel } from './toolPresentation.js';
import { buildChatRenderItems, type ChatRenderItem } from './transcriptItems.js';
import { type TranscriptSelectionAction, useChatReplySelection } from './useChatReplySelection.js';
import { useChatWindowing } from './useChatWindowing.js';
import { useInlineTraceRunExpansion } from './useInlineTraceRunExpansion.js';

// ── ToolBlock ─────────────────────────────────────────────────────────────────

// ── ChatView ──────────────────────────────────────────────────────────────────

interface ChatViewProps {
  messages: MessageBlock[];
  conversationId?: string | null;
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
  onReplyToSelection?: (selection: {
    text: string;
    messageIndex: number;
    blockId?: string;
    action?: TranscriptSelectionAction;
  }) => Promise<void> | void;
  selectionActions?: ExtensionSelectionActionRegistration[];
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
  onOpenCheckpoint?: (checkpointId: string) => void;
  activeCheckpointId?: string | null;
  onOpenBrowser?: () => void;
  onOpenFilePath?: (path: string) => void;
  onSubmitAskUserQuestion?: (presentation: AskUserQuestionPresentation, answers: AskUserQuestionAnswers) => Promise<void> | void;
  askUserQuestionDisplayMode?: 'inline' | 'composer';
  onResumeConversation?: () => Promise<void> | void;
  onFocusComposerRequest?: () => void;
  resumeConversationBusy?: boolean;
  resumeConversationTitle?: string | null;
  resumeConversationLabel?: string;
  windowingHeaderContent?: React.ReactNode;
  anchorWindowingToTail?: boolean;
  systemPrompt?: string | null;
  toolDefinitions?: LiveSessionToolDefinition[];
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

  return !target.closest(
    [
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
    ].join(','),
  );
}

function isLeadingContextItem(item: ChatRenderItem): boolean {
  return item.type === 'message' && (item.block.type === 'context' || item.block.type === 'summary');
}

export const ChatView = memo(function ChatView({
  messages,
  conversationId = null,
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
  selectionActions,
  onHydrateMessage,
  hydratingMessageBlockIds,
  onOpenArtifact,
  activeArtifactId,
  onOpenCheckpoint,
  activeCheckpointId,
  onOpenBrowser,
  onOpenFilePath,
  onSubmitAskUserQuestion,
  askUserQuestionDisplayMode = 'inline',
  onResumeConversation,
  onFocusComposerRequest,
  resumeConversationBusy = false,
  resumeConversationTitle,
  resumeConversationLabel = 'continue',
  windowingHeaderContent,
  anchorWindowingToTail = false,
  systemPrompt = null,
  toolDefinitions = [],
}: ChatViewProps) {
  const renderStartedAtRef = useRef(performance.now());
  renderStartedAtRef.current = performance.now();
  const extensionRegistry = useExtensionRegistry();
  const standaloneTools = useMemo(() => {
    const tools = new Set<string>();
    for (const extension of extensionRegistry.extensions) {
      if (!extension.enabled) continue;
      for (const renderer of extension.manifest?.contributes?.transcriptRenderers ?? []) {
        if (renderer.standalone) {
          tools.add(renderer.tool);
        }
      }
    }
    return tools;
  }, [extensionRegistry.extensions]);
  const renderItems = useMemo(() => buildChatRenderItems(messages, standaloneTools), [messages, standaloneTools]);
  const renderItemStats = useMemo(() => {
    let messageItems = 0;
    let traceClusters = 0;
    let traceBlocks = 0;
    let toolBlocks = 0;
    let standaloneToolBlocks = 0;
    let markdownBlocks = 0;

    for (const item of renderItems) {
      if (item.type === 'trace_cluster') {
        traceClusters += 1;
        traceBlocks += item.blocks.length;
        toolBlocks += item.blocks.filter((block) => block.type === 'tool_use').length;
        continue;
      }

      messageItems += 1;
      const block = item.block;
      if (block.type === 'tool_use') {
        toolBlocks += 1;
        standaloneToolBlocks += 1;
      } else if (block.type === 'assistant' || block.type === 'user') {
        markdownBlocks += 1;
      }
    }

    return { messageItems, traceClusters, traceBlocks, toolBlocks, standaloneToolBlocks, markdownBlocks };
  }, [renderItems]);
  const { isInlineRunExpanded, toggleInlineRun } = useInlineTraceRunExpansion(renderItems);

  const streamingStatusLabel = isCompacting
    ? 'Compacting context…'
    : (pendingStatusLabel ?? getStreamingStatusLabel(messages, isStreaming));
  const renderingProfile = CHAT_VIEW_RENDERING_PROFILE[performanceMode];
  const lastBlock = messages[messages.length - 1];
  const showStreamingIndicator =
    !!streamingStatusLabel && (isCompacting || Boolean(pendingStatusLabel) || !lastBlock || lastBlock.type === 'user');
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
    () =>
      shouldUseContentVisibility && contentVisibilityReady
        ? {
            contentVisibility: 'auto',
            // Without an intrinsic-size fallback, Chromium treats skipped
            // offscreen transcript blocks as effectively zero-height until they
            // scroll into view. That makes the scrollbar jump exactly when
            // lazy content hydrates or images finish loading. `auto` lets the
            // browser remember measured sizes, with a sane first-pass fallback.
            containIntrinsicSize: 'auto 96px',
          }
        : undefined,
    [contentVisibilityReady, shouldUseContentVisibility],
  );

  const { shouldWindowTranscript, renderChunks, visibleChunkRange, updateChunkHeight, renderItemSpanCount } = useChatWindowing({
    scrollContainerRef,
    renderItems,
    messageIndexOffset,
    renderingProfile,
    focusMessageIndex,
    anchorToTail: anchorWindowingToTail,
  });
  const [selectedImage, setSelectedImage] = useState<InspectableImage | null>(null);
  const transcriptSelectionActions = (selectionActions ?? []).filter(
    (action) => action.kinds.includes('text') || action.kinds.includes('transcriptRange'),
  );
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

  const renderChatItem = (item: ChatRenderItem, itemIndex: number, renderItemsLength = renderItems.length) => (
    <ChatRenderItemView
      key={
        item.type === 'trace_cluster'
          ? // Use only startIndex so the component stays mounted when new blocks
            // append to the cluster during streaming. Using endIndex would change
            // the key on every append, unmounting all child ToolBlocks and losing
            // their expansion (preference) state.
            `trace-${messageIndexOffset + item.startIndex}`
          : messageIndexOffset + item.index
      }
      item={item}
      itemIndex={itemIndex}
      renderItemsLength={renderItemsLength}
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
      onOpenBrowser={onOpenBrowser}
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

  const leadingContextItemCount = (() => {
    let count = 0;
    for (const item of renderItems) {
      if (!isLeadingContextItem(item)) {
        break;
      }
      count += 1;
    }
    return count;
  })();
  const hasSystemPromptContext = Boolean(systemPrompt?.trim()) || toolDefinitions.length > 0;
  const shouldGroupIntroContext = !shouldWindowTranscript && (hasSystemPromptContext || leadingContextItemCount > 0);
  const introContextItems = shouldGroupIntroContext ? renderItems.slice(0, leadingContextItemCount) : [];
  const transcriptItems = shouldGroupIntroContext ? renderItems.slice(leadingContextItemCount) : renderItems;

  const fullTranscript = (
    <div className="space-y-4">{transcriptItems.map((item, itemIndex) => renderChatItem(item, itemIndex + leadingContextItemCount))}</div>
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
  ) : (
    fullTranscript
  );
  const mountedMessageCount = visibleChunkRange
    ? visibleChunkRange.chunks.reduce((sum, chunk) => sum + chunk.spanCount, 0)
    : messages.length;
  const mountedChunkCount = visibleChunkRange?.chunks.length ?? renderChunks.length;
  const transcriptBoundary = windowingHeaderContent ? <div className="mb-5">{windowingHeaderContent}</div> : null;

  useEffect(() => {
    const startedAtMs = renderStartedAtRef.current;
    const timeout = window.setTimeout(() => {
      recordChatRenderTiming({
        conversationId,
        route: `${window.location.pathname}${window.location.search}`,
        startedAtMs,
        meta: {
          messageCount: messages.length,
          renderItemCount: renderItems.length,
          renderItemSpanCount,
          mountedMessageCount,
          mountedChunkCount,
          totalChunkCount: renderChunks.length,
          shouldWindowTranscript,
          performanceMode,
          layout,
          isStreaming,
          ...renderItemStats,
        },
      });
    });

    return () => window.clearTimeout(timeout);
  }, [
    conversationId,
    isStreaming,
    layout,
    messages.length,
    mountedChunkCount,
    mountedMessageCount,
    performanceMode,
    renderChunks.length,
    renderItemSpanCount,
    renderItemStats,
    renderItems.length,
    shouldWindowTranscript,
  ]);

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
        {shouldGroupIntroContext ? (
          <div className={transcriptItems.length > 0 || transcriptBoundary ? 'mb-7 space-y-1.5' : 'space-y-1.5'}>
            {hasSystemPromptContext ? <SystemPromptMessage text={systemPrompt ?? ''} toolDefinitions={toolDefinitions} /> : null}
            {introContextItems.map((item, itemIndex) => renderChatItem(item, itemIndex))}
          </div>
        ) : hasSystemPromptContext ? (
          <div className="mb-1.5">
            <SystemPromptMessage text={systemPrompt ?? ''} toolDefinitions={toolDefinitions} />
          </div>
        ) : null}
        {transcriptBoundary}
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
          selectionActions={transcriptSelectionActions}
          onAction={runSelectionContextMenuAction}
        />
      ) : null}
      {selectedImage && <ImageInspectModal image={selectedImage} onClose={() => setSelectedImage(null)} />}
    </>
  );
});
