import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { AskUserQuestionAnswers, AskUserQuestionPresentation } from '../../transcript/askUserQuestions';
import type { MessageBlock } from '../../shared/types';
import { buildChatRenderItems, type ChatRenderItem } from './transcriptItems.js';
import { getDesktopBridge, shouldUseNativeAppContextMenus } from '../../desktop/desktopBridge';
import { findSelectionReplyScopeElement, findSelectionReplyScopeElements, readSelectedTextWithinElement } from './replySelection.js';
import { buildInlineRunExpansionKey } from './linkedRunPolling.js';
import { collectTraceClusterLinkedRuns } from './linkedRuns.js';
import { ErrorBlock, SubagentBlock, ThinkingBlock, TraceClusterBlock } from './TraceBlocks.js';
import { ImageBlock, ImageInspectModal, type InspectableImage } from './ImageMessageBlocks.js';
import { AssistantMessage, ContextMessage, SummaryMessage, UserMessage } from './MessageBlocks.js';
import { getStreamingStatusLabel, shouldAutoOpenConversationBlock } from './toolPresentation.js';
import { ToolBlock } from './ToolBlock.js';
import type { ChatViewLayout } from './chatViewTypes.js';

// ── ToolBlock ─────────────────────────────────────────────────────────────────

interface ReplySelectionState {
  text: string;
  messageIndex: number;
  blockId?: string;
}

interface ReplySelectionContextMenuState {
  x: number;
  y: number;
  text: string;
  replySelection: ReplySelectionState | null;
}

function clearWindowSelection() {
  if (typeof window === 'undefined') {
    return;
  }

  window.getSelection()?.removeAllRanges();
}


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

type ChatViewPerformanceMode = 'default' | 'aggressive';
const CHAT_VIEW_RENDERING_PROFILE: Record<ChatViewPerformanceMode, {
  contentVisibilityThreshold: number;
  windowingThreshold: number;
  windowingChunkSize: number;
  windowingOverscanChunks: number;
}> = {
  default: {
    contentVisibilityThreshold: 120,
    windowingThreshold: 240,
    windowingChunkSize: 80,
    windowingOverscanChunks: 2,
  },
  aggressive: {
    contentVisibilityThreshold: 48,
    windowingThreshold: 96,
    windowingChunkSize: 40,
    windowingOverscanChunks: 1,
  },
};

const CHAT_WINDOWING_FALLBACK_SPAN_HEIGHT = 96;
const CHAT_WINDOWING_BADGE_DEFAULT_TOP_OFFSET_PX = 12;

interface ChatRenderChunk {
  key: string;
  items: ChatRenderItem[];
  startItemIndex: number;
  endItemIndex: number;
  startMessageIndex: number;
  endMessageIndex: number;
  spanCount: number;
}

function getChatRenderItemAbsoluteRange(item: ChatRenderItem, messageIndexOffset: number): { start: number; end: number } {
  if (item.type === 'trace_cluster') {
    return {
      start: messageIndexOffset + item.startIndex,
      end: messageIndexOffset + item.endIndex,
    };
  }

  return {
    start: messageIndexOffset + item.index,
    end: messageIndexOffset + item.index,
  };
}

function buildChatRenderChunks(
  renderItems: ChatRenderItem[],
  messageIndexOffset: number,
  chunkSize: number,
): ChatRenderChunk[] {
  const chunks: ChatRenderChunk[] = [];

  for (let startItemIndex = 0; startItemIndex < renderItems.length; startItemIndex += chunkSize) {
    const items = renderItems.slice(startItemIndex, startItemIndex + chunkSize);
    const startRange = getChatRenderItemAbsoluteRange(items[0], messageIndexOffset);
    const endRange = getChatRenderItemAbsoluteRange(items[items.length - 1], messageIndexOffset);
    const spanCount = items.reduce((count, item) => {
      const range = getChatRenderItemAbsoluteRange(item, messageIndexOffset);
      return count + (range.end - range.start + 1);
    }, 0);
    chunks.push({
      key: `${startRange.start}-${endRange.end}-${items.length}`,
      items,
      startItemIndex,
      endItemIndex: startItemIndex + items.length - 1,
      startMessageIndex: startRange.start,
      endMessageIndex: endRange.end,
      spanCount,
    });
  }

  return chunks;
}

function resolveChunkIndexForOffset(offset: number, chunkTops: number[], chunkHeights: number[]): number {
  for (let index = 0; index < chunkTops.length; index += 1) {
    if (offset < chunkTops[index] + chunkHeights[index]) {
      return index;
    }
  }

  return Math.max(0, chunkTops.length - 1);
}

function formatWindowingCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }

  return String(value);
}

function WindowedChatChunk({
  chunk,
  renderItem,
  onHeightChange,
  includeTrailingGap,
}: {
  chunk: ChatRenderChunk;
  renderItem: (item: ChatRenderItem, itemIndex: number) => ReactNode;
  onHeightChange: (chunkKey: string, height: number) => void;
  includeTrailingGap: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const measure = () => {
      onHeightChange(chunk.key, element.getBoundingClientRect().height);
    };

    measure();
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => measure())
      : null;
    observer?.observe(element);

    return () => {
      observer?.disconnect();
    };
  }, [chunk.key, includeTrailingGap, onHeightChange]);

  return (
    <div ref={ref} className={includeTrailingGap ? 'space-y-4 pb-4' : 'space-y-4'}>
      {chunk.items.map((item, itemIndex) => renderItem(item, chunk.startItemIndex + itemIndex))}
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
  const [expandedInlineRunKeys, setExpandedInlineRunKeys] = useState<ReadonlySet<string>>(() => new Set());
  const visibleInlineRunKeySet = useMemo(() => {
    const next = new Set<string>();

    for (const item of renderItems) {
      if (item.type !== 'trace_cluster') {
        continue;
      }

      for (const run of collectTraceClusterLinkedRuns(item.blocks)) {
        next.add(buildInlineRunExpansionKey(item.startIndex, run.runId));
      }
    }

    return next;
  }, [renderItems]);

  useEffect(() => {
    setExpandedInlineRunKeys((current) => {
      if (current.size === 0) {
        return current;
      }

      let changed = false;
      const next = new Set<string>();
      for (const inlineRunKey of current) {
        if (visibleInlineRunKeySet.has(inlineRunKey)) {
          next.add(inlineRunKey);
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [visibleInlineRunKeySet]);

  const isInlineRunExpanded = useCallback(
    (inlineRunKey: string) => expandedInlineRunKeys.has(inlineRunKey),
    [expandedInlineRunKeys],
  );

  const toggleInlineRun = useCallback((inlineRunKey: string) => {
    setExpandedInlineRunKeys((current) => {
      const next = new Set(current);
      if (next.has(inlineRunKey)) {
        next.delete(inlineRunKey);
      } else {
        next.add(inlineRunKey);
      }
      return next;
    });
  }, []);

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
  const [replySelection, setReplySelection] = useState<ReplySelectionState | null>(null);
  const [selectionContextMenu, setSelectionContextMenu] = useState<ReplySelectionContextMenuState | null>(null);
  const [selectedImage, setSelectedImage] = useState<InspectableImage | null>(null);
  const replySelectionSyncFrameRef = useRef<number | null>(null);
  const replySelectionSyncTimeoutRefs = useRef<number[]>([]);
  const replySelectionClearTimeoutRef = useRef<number | null>(null);

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

  const selectionContextMenuRef = useRef<HTMLDivElement | null>(null);

  const clearScheduledReplySelectionSync = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (replySelectionSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(replySelectionSyncFrameRef.current);
      replySelectionSyncFrameRef.current = null;
    }

    if (replySelectionSyncTimeoutRefs.current.length > 0) {
      for (const timeoutId of replySelectionSyncTimeoutRefs.current) {
        window.clearTimeout(timeoutId);
      }
      replySelectionSyncTimeoutRefs.current = [];
    }
  }, []);

  const cancelReplySelectionClear = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (replySelectionClearTimeoutRef.current !== null) {
      window.clearTimeout(replySelectionClearTimeoutRef.current);
      replySelectionClearTimeoutRef.current = null;
    }
  }, []);

  const lastReplySelectionScopeRef = useRef<HTMLElement | null>(null);

  const closeSelectionContextMenu = useCallback(() => {
    setSelectionContextMenu((current) => (current ? null : current));
  }, []);

  const clearReplySelection = useCallback(() => {
    lastReplySelectionScopeRef.current = null;
    setReplySelection((current) => (current ? null : current));
  }, []);

  const scheduleReplySelectionClear = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      clearReplySelection();
      return;
    }

    if (document.visibilityState !== 'visible' || !document.hasFocus()) {
      return;
    }

    cancelReplySelectionClear();
    replySelectionClearTimeoutRef.current = window.setTimeout(() => {
      replySelectionClearTimeoutRef.current = null;
      clearReplySelection();
    }, 140);
  }, [cancelReplySelectionClear, clearReplySelection]);

  const resolveReplySelectionFromSelection = useCallback((scopeHint?: HTMLElement | null): { scopeElement: HTMLElement; selection: ReplySelectionState } | null => {
    if (typeof window === 'undefined') {
      return null;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const { startScope, endScope } = findSelectionReplyScopeElements(selection, range);
    const commonScope = findSelectionReplyScopeElement(range.commonAncestorContainer);
    const candidates = [scopeHint ?? null, startScope, endScope, commonScope, lastReplySelectionScopeRef.current]
      .filter((scope): scope is HTMLElement => Boolean(scope))
      .filter((scope, index, list) => list.indexOf(scope) === index);

    const matches = candidates.filter((scope) => readSelectedTextWithinElement(scope, range).length > 0);
    if (matches.length !== 1) {
      return null;
    }

    const scopeElement = matches[0];
    const text = readSelectedTextWithinElement(scopeElement, range);
    if (!text) {
      return null;
    }

    const messageIndex = Number.parseInt(scopeElement.dataset.messageIndex ?? '', 10);
    if (!Number.isFinite(messageIndex)) {
      return null;
    }

    return {
      scopeElement,
      selection: {
        text,
        messageIndex,
        blockId: scopeElement.dataset.blockId?.trim() || undefined,
      },
    };
  }, []);

  const applyResolvedReplySelection = useCallback((resolvedSelection: { scopeElement: HTMLElement; selection: ReplySelectionState } | null) => {
    if (!resolvedSelection) {
      scheduleReplySelectionClear();
      return;
    }

    cancelReplySelectionClear();
    lastReplySelectionScopeRef.current = resolvedSelection.scopeElement;

    setReplySelection((current) => {
      if (
        current
        && current.text === resolvedSelection.selection.text
        && current.messageIndex === resolvedSelection.selection.messageIndex
        && current.blockId === resolvedSelection.selection.blockId
      ) {
        return current;
      }

      return resolvedSelection.selection;
    });
  }, [cancelReplySelectionClear, scheduleReplySelectionClear]);

  const syncReplySelectionFromSelection = useCallback((scopeHint?: HTMLElement | null) => {
    applyResolvedReplySelection(resolveReplySelectionFromSelection(scopeHint));
  }, [applyResolvedReplySelection, resolveReplySelectionFromSelection]);

  const scheduleReplySelectionSync = useCallback((scopeElement?: HTMLElement | null) => {
    if (typeof window === 'undefined' || !onReplyToSelection) {
      clearScheduledReplySelectionSync();
      cancelReplySelectionClear();
      clearReplySelection();
      return;
    }

    const sync = () => {
      syncReplySelectionFromSelection(scopeElement);
    };

    clearScheduledReplySelectionSync();

    replySelectionSyncFrameRef.current = window.requestAnimationFrame(() => {
      replySelectionSyncFrameRef.current = null;
      sync();
    });

    // Electron selection updates can land a little after the initial event, but
    // a permanent polling loop made large transcripts do steady background work.
    for (const delayMs of [40, 120, 240, 480]) {
      const timeoutId = window.setTimeout(() => {
        replySelectionSyncTimeoutRefs.current = replySelectionSyncTimeoutRefs.current.filter((currentId) => currentId !== timeoutId);
        sync();
      }, delayMs);
      replySelectionSyncTimeoutRefs.current.push(timeoutId);
    }
  }, [cancelReplySelectionClear, clearReplySelection, clearScheduledReplySelectionSync, onReplyToSelection, syncReplySelectionFromSelection]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined' || !onReplyToSelection) {
      clearScheduledReplySelectionSync();
      cancelReplySelectionClear();
      clearReplySelection();
      return;
    }

    const handleDocumentReplySelectionSync = () => {
      scheduleReplySelectionSync();
    };
    const handleFocus = () => {
      scheduleReplySelectionSync();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleReplySelectionSync();
      }
    };

    document.addEventListener('selectionchange', handleDocumentReplySelectionSync);
    document.addEventListener('mouseup', handleDocumentReplySelectionSync);
    document.addEventListener('pointerup', handleDocumentReplySelectionSync);
    document.addEventListener('keyup', handleDocumentReplySelectionSync);
    document.addEventListener('touchend', handleDocumentReplySelectionSync);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handleFocus);

    return () => {
      document.removeEventListener('selectionchange', handleDocumentReplySelectionSync);
      document.removeEventListener('mouseup', handleDocumentReplySelectionSync);
      document.removeEventListener('pointerup', handleDocumentReplySelectionSync);
      document.removeEventListener('keyup', handleDocumentReplySelectionSync);
      document.removeEventListener('touchend', handleDocumentReplySelectionSync);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handleFocus);
      clearScheduledReplySelectionSync();
      cancelReplySelectionClear();
    };
  }, [cancelReplySelectionClear, clearReplySelection, clearScheduledReplySelectionSync, onReplyToSelection, scheduleReplySelectionSync]);

  useEffect(() => {
    if (!replySelection || typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const element = target instanceof HTMLElement ? target : target.parentElement;
      if (
        element?.closest('[data-selection-context-menu="true"]')
        || element?.closest('[data-selection-reply-scope="assistant-message"]')
      ) {
        return;
      }

      cancelReplySelectionClear();
      clearReplySelection();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      cancelReplySelectionClear();
      clearReplySelection();
      clearWindowSelection();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [cancelReplySelectionClear, clearReplySelection, replySelection]);

  useEffect(() => {
    if (!selectionContextMenu || typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const closeMenu = () => {
      closeSelectionContextMenu();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        closeMenu();
        return;
      }

      const element = target instanceof HTMLElement ? target : target.parentElement;
      if (element?.closest('[data-selection-context-menu="true"]')) {
        return;
      }

      closeMenu();
    };
    const handleSelectionChange = () => {
      const selectionText = window.getSelection()?.toString().trim() ?? '';
      if (!selectionText) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };
    const scrollEl = scrollContainerRef?.current;

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    scrollEl?.addEventListener('scroll', closeMenu, { passive: true });

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('resize', closeMenu);
      scrollEl?.removeEventListener('scroll', closeMenu);
    };
  }, [closeSelectionContextMenu, scrollContainerRef, selectionContextMenu]);

  const handleReplySelection = useCallback(async (selectionOverride?: ReplySelectionState | null) => {
    const activeSelection = selectionOverride ?? replySelection;
    if (!activeSelection || !onReplyToSelection) {
      return;
    }

    closeSelectionContextMenu();
    clearReplySelection();
    clearWindowSelection();
    await onReplyToSelection({
      text: activeSelection.text,
      messageIndex: activeSelection.messageIndex,
      blockId: activeSelection.blockId,
    });
  }, [clearReplySelection, closeSelectionContextMenu, onReplyToSelection, replySelection]);

  const copySelectedTranscriptText = useCallback(async (text: string | null | undefined) => {
    const nextText = typeof text === 'string' ? text.trim() : '';

    closeSelectionContextMenu();
    if (!nextText || typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      clearReplySelection();
      clearWindowSelection();
      return;
    }

    try {
      await navigator.clipboard.writeText(nextText);
    } finally {
      clearWindowSelection();
      clearReplySelection();
    }
  }, [clearReplySelection, closeSelectionContextMenu]);

  const openDomSelectionContextMenu = useCallback((menuState: ReplySelectionContextMenuState) => {
    const menuWidth = 224;
    const menuItemCount = 1 + Number(Boolean(menuState.replySelection));
    const menuHeight = menuItemCount * 33 + (menuItemCount > 1 ? 11 : 10);
    const viewportWidth = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerHeight;
    const edgePadding = 12;

    setSelectionContextMenu({
      ...menuState,
      x: Math.max(edgePadding, Math.min(menuState.x, viewportWidth - menuWidth - edgePadding)),
      y: Math.max(edgePadding, Math.min(menuState.y, viewportHeight - menuHeight - edgePadding)),
    });
  }, []);

  const runSelectionContextMenuAction = useCallback(async (
    action: 'reply' | 'copy' | null,
    menuState?: ReplySelectionContextMenuState | null,
  ) => {
    const activeMenuState = menuState ?? selectionContextMenu;
    if (!action || !activeMenuState) {
      closeSelectionContextMenu();
      return;
    }

    switch (action) {
      case 'reply':
        await handleReplySelection(activeMenuState.replySelection);
        return;
      case 'copy':
        await copySelectedTranscriptText(activeMenuState.text);
        return;
    }
  }, [closeSelectionContextMenu, copySelectedTranscriptText, handleReplySelection, selectionContextMenu]);

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
  const handleTranscriptContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (typeof window === 'undefined') {
      return;
    }

    const scopeHint = event.target instanceof Node ? findSelectionReplyScopeElement(event.target) : null;
    const resolvedReplySelection = onReplyToSelection ? resolveReplySelectionFromSelection(scopeHint) : null;
    if (onReplyToSelection) {
      applyResolvedReplySelection(resolvedReplySelection);
    }

    const selectionText = resolvedReplySelection?.selection.text ?? window.getSelection()?.toString().trim() ?? '';
    if (!selectionText) {
      closeSelectionContextMenu();
      return;
    }

    event.preventDefault();
    const menuState: ReplySelectionContextMenuState = {
      x: event.clientX,
      y: event.clientY,
      text: selectionText,
      replySelection: resolvedReplySelection?.selection ?? null,
    };
    const desktopBridge = shouldUseNativeAppContextMenus() ? getDesktopBridge() : null;

    if (desktopBridge?.showSelectionContextMenu) {
      closeSelectionContextMenu();
      void desktopBridge.showSelectionContextMenu({
        x: menuState.x,
        y: menuState.y,
        canReply: Boolean(menuState.replySelection),
        canCopy: true,
      })
        .then(({ action }) => runSelectionContextMenuAction(action, menuState))
        .catch(() => {
          openDomSelectionContextMenu(menuState);
        });
      return;
    }

    openDomSelectionContextMenu(menuState);
  }, [applyResolvedReplySelection, closeSelectionContextMenu, onReplyToSelection, openDomSelectionContextMenu, resolveReplySelectionFromSelection, runSelectionContextMenuAction]);
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
