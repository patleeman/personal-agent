import { Suspense, lazy, useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import { ChatView } from '../components/chat/ChatView';
import { ComposerAttachmentShelf } from '../components/chat/ComposerAttachmentShelf';
import { ConversationRail } from '../components/chat/ConversationRailOverlay';
import type { ExcalidrawEditorSavePayload } from '../components/ExcalidrawEditorModal';
import { ConversationSavedHeader } from '../components/ConversationSavedHeader';
import { DraftRelatedThreadsPanel } from '../components/DraftRelatedThreadsPanel';
import { RemoteDirectoryBrowserModal } from '../components/RemoteDirectoryBrowserModal';
import { AppPageEmptyState, EmptyState, IconButton, LoadingState, PageHeader, Pill, cx } from '../components/ui';
import type { ContextUsageSegment, ConversationAttachmentSummary, ConversationAutoModeState, ConversationContextDocRef, DeferredResumeSummary, DesktopConnectionsState, DesktopHostRecord, DesktopRemoteOperationStatus, DurableRunRecord, LiveSessionContext, LiveSessionCreateResult, MemoryData, MessageBlock, ModelInfo, PromptAttachmentRefInput, PromptImageInput, SessionDetail, SessionMeta, VaultFileListResult } from '../shared/types';
import { useInvalidateOnTopics } from '../hooks/useInvalidateOnTopics';
import { useConversationScroll } from '../hooks/useConversationScroll';
import { primeConversationBootstrapCache, useConversationBootstrap } from '../hooks/useConversationBootstrap';
import { primeSessionDetailCache, useSessionDetail } from '../hooks/useSessions';
import { useConversationEventVersion } from '../hooks/useConversationEventVersion';
import { useDesktopConversationState } from '../hooks/useDesktopConversationState';
import { normalizePendingQueueItems, retryLiveSessionActionAfterTakeover, useSessionStream } from '../hooks/useSessionStream';
import { api } from '../client/api';
import { getDesktopBridge, readDesktopConnections } from '../desktop/desktopBridge';
import { subscribeDesktopRemoteOperations } from '../desktop/desktopRemoteOperations';
import { appendComposerHistory, readComposerHistory } from '../conversation/composerHistory';
import { getConversationArtifactIdFromSearch, readArtifactPresentation, setConversationArtifactIdInSearch } from '../conversation/conversationArtifacts';
import { getConversationCheckpointIdFromSearch, readCheckpointPresentation, setConversationCheckpointIdInSearch } from '../conversation/conversationCheckpoints';
import { createConversationLiveRunId } from '../conversation/conversationRuns';
import { formatContextUsageLabel, formatThinkingLevelLabel } from '../conversation/conversationHeader';
import {
  getConversationInitialScrollKey,
  getConversationTailBlockKey,
  shouldShowScrollToBottomControl,
} from '../conversation/conversationScroll';
import { truncateConversationCwdFromFront } from '../conversation/conversationCwdHistory';
import { getConversationDisplayTitle, NEW_CONVERSATION_TITLE, normalizeConversationTitle } from '../conversation/conversationTitle';
import { displayBlockToMessageBlock } from '../transcript/messageBlocks';
import {
  THINKING_LEVEL_OPTIONS,
  getModelSelectableServiceTierOptions,
  hasSelectableModelId,
  groupModelsByProvider,
  resolveSelectableModelId,
} from '../model/modelPreferences';
import { useAppData, useAppEvents, useLiveTitles } from '../app/contexts';
import { filterModelPickerItems } from '../model/modelPicker';
import { parseDeferredResumeSlashCommand } from '../deferred-resume/deferredResumeSlashCommand';
import { parseWholeLineBashCommand } from '../conversation/conversationBashCommand';
import { parseConversationSlashCommand, type ConversationSlashCommand } from '../conversation/conversationSlashCommand';
import { buildSlashMenuItems, parseSlashInput, type SlashMenuItem } from '../commands/slashMenu';
import { buildMentionItems, filterMentionItems, MAX_MENTION_MENU_ITEMS, resolveMentionItems, type MentionItem } from '../conversation/conversationMentions';
import { buildDeferredResumeAutoResumeKey, shouldAutoResumeDeferredResumes } from '../deferred-resume/deferredResumeAutoResume';
import { buildDeferredResumeIndicatorText, compareDeferredResumes, describeDeferredResumeStatus } from '../deferred-resume/deferredResumeIndicator';
import {
  buildAskUserQuestionReplyText,
  findPendingAskUserQuestion,
  isAskUserQuestionComplete,
  moveAskUserQuestionIndex,
  resolveAskUserQuestionDefaultOptionIndex,
  resolveAskUserQuestionOptionHotkey,
  shouldAdvanceAskUserQuestionAfterSelection,
  type AskUserQuestionAnswers,
  type AskUserQuestionPresentation,
} from '../transcript/askUserQuestions';
import { buildConversationComposerStorageKey, persistForkPromptDraft, resolveBranchEntryIdForMessage, resolveRewindTargetForMessage, resolveSessionEntryIdFromBlockId } from '../conversation/forking';
import {
  beginDraftConversationAttachmentsMutation,
  buildDraftConversationComposerStorageKey,
  clearConversationAttachments,
  clearDraftConversationAttachments,
  clearDraftConversationComposer,
  clearDraftConversationContextDocs,
  clearDraftConversationCwd,
  clearDraftConversationModel,
  clearDraftConversationServiceTier,
  clearDraftConversationThinkingLevel,
  DRAFT_CONVERSATION_ROUTE,
  DRAFT_CONVERSATION_STATE_CHANGED_EVENT,
  isDraftConversationAttachmentsMutationCurrent,
  persistConversationAttachments,
  persistDraftConversationAttachments,
  persistDraftConversationComposer,
  persistDraftConversationContextDocs,
  persistDraftConversationCwd,
  persistDraftConversationModel,
  persistDraftConversationServiceTier,
  persistDraftConversationThinkingLevel,
  readConversationAttachments,
  readDraftConversationAttachments,
  readDraftConversationContextDocs,
  readDraftConversationCwd,
  readDraftConversationModel,
  readDraftConversationServiceTier,
  readDraftConversationThinkingLevel,
  type DraftConversationDrawingAttachment,
} from '../conversation/draftConversation';
import {
  clearPendingConversationPrompt,
  consumePendingConversationPrompt,
  isPendingConversationPromptDispatching,
  PENDING_CONVERSATION_PROMPT_CHANGED_EVENT,
  persistPendingConversationPrompt,
  readPendingConversationPrompt,
  setPendingConversationPromptDispatching,
  type PendingConversationPrompt,
  type PendingConversationPromptChangedDetail,
} from '../pending/pendingConversationPrompt';
import { appendPendingInitialPromptBlock } from '../pending/pendingQueueMessages';
import {
  didConversationStopMidTurn,
  didConversationStopWithError,
  getConversationResumeState,
} from '../conversation/conversationResume';
import {
  getRunHeadline,
  isRunActive,
  listConnectedConversationBackgroundRuns,
  type RunPresentationLookups,
} from '../automation/runPresentation';
import {
  normalizeConversationComposerBehavior,
  resolveConversationComposerSubmitState,
  shouldShowQuestionSubmitAsPrimaryComposerAction,
} from '../conversation/conversationComposerSubmit';
import { insertReplyQuoteIntoComposer } from '../conversation/conversationReplyQuote';
import { useReloadState } from '../local/reloadState';
import { closeConversationTab, ensureConversationTabOpen } from '../session/sessionTabs';
import { completeConversationOpenPhase, ensureConversationOpenStart } from '../client/perfDiagnostics';
import { normalizeWorkspacePaths, readStoredWorkspacePaths, writeStoredWorkspacePaths } from '../local/savedWorkspacePaths';
import { listRecentConversationResults, rankRelatedConversationSessions, selectRecentConversationCandidates, type RelatedConversationSearchResult } from '../conversation/relatedConversationSearch';
import { buildDrawingFileNames, inferDrawingTitleFromFileName, loadExcalidrawSceneFromBlob, parseExcalidrawSceneFromSourceData, serializeExcalidrawScene } from '../content/excalidrawUtils';

const ConversationArtifactModal = lazy(() => import('../components/ConversationArtifactModal').then((module) => ({ default: module.ConversationArtifactModal })));
const ConversationCheckpointModal = lazy(() => import('../components/ConversationCheckpointModal').then((module) => ({ default: module.ConversationCheckpointModal })));
const ConversationDrawingsPickerModal = lazy(() => import('../components/ConversationDrawingsPickerModal').then((module) => ({ default: module.ConversationDrawingsPickerModal })));
const ExcalidrawEditorModal = lazy(() => import('../components/ExcalidrawEditorModal').then((module) => ({ default: module.ExcalidrawEditorModal })));

const INITIAL_HISTORICAL_TAIL_BLOCKS = 120;
const HISTORICAL_TAIL_BLOCKS_STEP = 400;
const COMPOSER_SHELF_TEXT_MAX_CHARS = 640;
const COMPOSER_SHELF_TEXT_MAX_LINES = 8;
const DESKTOP_SHORTCUT_EVENT = 'personal-agent-desktop-shortcut';
const MAX_RELATED_THREAD_SELECTIONS = 3;
const MAX_RELATED_THREAD_HOTKEYS = 9;
const MAX_VISIBLE_RELATED_THREAD_RESULTS = 10;
const RELATED_THREAD_RECENT_WINDOW_DAYS = 3;
const MAX_RELATED_THREAD_CANDIDATES = 24;

type DesktopConversationShortcutAction = 'focus-composer' | 'edit-working-directory' | 'rename-conversation';
type RelatedThreadHotkeyEvent = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key' | 'code' | 'isComposing'>;

function isDesktopConversationShortcutAction(value: unknown): value is DesktopConversationShortcutAction {
  return value === 'focus-composer' || value === 'edit-working-directory' || value === 'rename-conversation';
}

function resolveRelatedThreadHotkeyIndex(event: RelatedThreadHotkeyEvent): number {
  if (event.isComposing || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return -1;
  }

  const codeMatch = event.code.match(/^Digit([1-9])$/);
  if (codeMatch) {
    return Number(codeMatch[1]) - 1;
  }

  return /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
}

function resolveConversationAutocompleteCatalogDemand(input: string): {
  needsMemoryData: boolean;
  needsVaultFiles: boolean;
} {
  const slashInput = parseSlashInput(input);
  const showModelPicker = slashInput?.command === '/model' && input.startsWith('/model ');
  const hasMentionQuery = /(^|.*\s)(@[\w./-]*)$/.test(input);

  return {
    needsMemoryData: hasMentionQuery || Boolean(slashInput && !showModelPicker),
    needsVaultFiles: hasMentionQuery,
  };
}

function isAttachableMentionItem(item: MentionItem): item is MentionItem & { path: string } {
  return (item.kind === 'note' || item.kind === 'file')
    && typeof item.path === 'string'
    && item.path.trim().length > 0;
}

function mentionItemToConversationContextDoc(item: MentionItem & { path: string }): ConversationContextDocRef {
  return {
    path: item.path,
    title: item.title?.trim() || item.label,
    kind: item.kind === 'note' ? 'doc' : 'file',
    ...(item.id ? { mentionId: item.id } : {}),
    ...(item.summary?.trim() ? { summary: item.summary.trim() } : {}),
  };
}

function dedupeConversationContextDocs(docs: ConversationContextDocRef[]): ConversationContextDocRef[] {
  const next: ConversationContextDocRef[] = [];
  const seenPaths = new Set<string>();
  for (const doc of docs) {
    const path = doc.path.trim();
    if (!path || seenPaths.has(path)) {
      continue;
    }

    seenPaths.add(path);
    next.push({
      ...doc,
      path,
      title: doc.title.trim() || path,
    });
  }

  return next;
}

function truncateConversationShelfText(
  text: string,
  options: { maxChars?: number; maxLines?: number } = {},
): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  const maxChars = Math.max(1, options.maxChars ?? COMPOSER_SHELF_TEXT_MAX_CHARS);
  const maxLines = Math.max(1, options.maxLines ?? COMPOSER_SHELF_TEXT_MAX_LINES);
  const lines = normalized.split('\n');
  const truncatedByLines = lines.length > maxLines;
  const lineLimited = truncatedByLines ? lines.slice(0, maxLines).join('\n') : normalized;
  const truncatedByChars = lineLimited.length > maxChars;
  const charLimited = truncatedByChars ? `${lineLimited.slice(0, maxChars).trimEnd()}…` : lineLimited;

  if (!truncatedByLines) {
    return charLimited;
  }

  return charLimited.endsWith('…') ? charLimited : `${charLimited.trimEnd()}…`;
}

function formatQueuedPromptShelfText(text: string, imageCount: number): string {
  if (text.trim().length > 0) {
    return text;
  }

  if (imageCount > 0) {
    return '(image only)';
  }

  return '(empty queued prompt)';
}

function formatQueuedPromptImageSummary(imageCount: number): string | null {
  if (imageCount <= 0) {
    return null;
  }

  return `${imageCount} image${imageCount === 1 ? '' : 's'} attached`;
}

function formatParallelJobStatusLabel(status: 'running' | 'ready' | 'failed' | 'importing'): string {
  switch (status) {
    case 'running':
      return 'running';
    case 'ready':
      return 'queued';
    case 'failed':
      return 'failed';
    case 'importing':
      return 'appending';
  }
}

function formatParallelJobContextSummary(input: {
  imageCount: number;
  attachmentRefs: string[];
}): string | null {
  const parts: string[] = [];
  if (input.imageCount > 0) {
    parts.push(`${input.imageCount} image${input.imageCount === 1 ? '' : 's'}`);
  }
  if (input.attachmentRefs.length > 0) {
    parts.push(`${input.attachmentRefs.length} attachment${input.attachmentRefs.length === 1 ? '' : 's'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function shouldEnableConversationLiveStream(
  conversationId: string | null | undefined,
  confirmedLive: boolean | null,
): boolean {
  return Boolean(conversationId) && confirmedLive !== false;
}

function resolveConversationLiveSession(input: {
  streamBlockCount: number;
  isStreaming: boolean;
  confirmedLive: boolean | null;
}): boolean {
  return input.streamBlockCount > 0 || input.isStreaming || input.confirmedLive === true;
}

function isConversationSessionNotLiveError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toLowerCase();
  return normalized === 'session not live'
    || normalized === 'not a live session'
    || normalized.startsWith('session ') && normalized.endsWith(' is not live');
}

function resolveConversationPendingStatusLabel(input: {
  isLiveSession: boolean;
  hasVisibleSessionDetail: boolean;
}): string {
  if (input.isLiveSession) {
    return 'Working…';
  }

  if (input.hasVisibleSessionDetail) {
    return 'Resuming…';
  }

  return 'Sending…';
}

function resolvePendingConversationPreparationStatusLabel(
  prompt: PendingConversationPrompt | null | undefined,
): string | null {
  const relatedThreadCount = prompt?.relatedConversationIds?.length ?? 0;
  if (relatedThreadCount <= 0) {
    return null;
  }

  return `Summarizing ${relatedThreadCount} related thread${relatedThreadCount === 1 ? '' : 's'}…`;
}

export function resolveDisplayedConversationPendingStatusLabel(input: {
  explicitLabel: string | null;
  draft: boolean;
  hasDraftPendingPrompt: boolean;
  pendingPrompt: PendingConversationPrompt | null | undefined;
  isStreaming: boolean;
  hasPendingInitialPrompt: boolean;
  hasPendingInitialPromptInFlight: boolean;
  isLiveSession: boolean;
  hasVisibleSessionDetail: boolean;
}): string | null {
  if (input.explicitLabel) {
    return input.explicitLabel;
  }

  if (input.isStreaming) {
    return null;
  }

  if (input.draft && input.hasDraftPendingPrompt) {
    return resolveConversationPendingStatusLabel({
      isLiveSession: false,
      hasVisibleSessionDetail: false,
    });
  }

  if (input.hasPendingInitialPrompt || input.hasPendingInitialPromptInFlight) {
    return resolvePendingConversationPreparationStatusLabel(input.pendingPrompt)
      ?? resolveConversationPendingStatusLabel({
        isLiveSession: input.isLiveSession,
        hasVisibleSessionDetail: input.hasVisibleSessionDetail,
      });
  }

  return null;
}

export function shouldShowMissingConversationState(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  sessionsLoaded: boolean;
  confirmedLive: boolean | null;
  sessionLoading: boolean;
  hasVisibleSessionDetail: boolean;
  hasSavedConversationSessionFile: boolean;
  hasPendingInitialPrompt: boolean;
}): boolean {
  return !input.draft
    && Boolean(input.conversationId)
    && input.sessionsLoaded
    && input.confirmedLive === false
    && !input.sessionLoading
    && !input.hasVisibleSessionDetail
    && !input.hasSavedConversationSessionFile
    && !input.hasPendingInitialPrompt;
}

export function shouldAutoDispatchPendingInitialPrompt(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  hasPendingInitialPrompt: boolean;
  pendingInitialPromptDispatching: boolean;
  hasStreamSnapshot: boolean;
}): boolean {
  return !input.draft
    && Boolean(input.conversationId)
    && input.hasPendingInitialPrompt
    && !input.pendingInitialPromptDispatching
    && input.hasStreamSnapshot;
}

export function hasConversationTranscriptAcceptedPendingInitialPrompt(input: {
  messages: MessageBlock[] | undefined;
  prompt: PendingConversationPrompt | null | undefined;
}): boolean {
  if (!input.prompt || !input.messages || input.messages.length === 0) {
    return false;
  }

  const pendingText = input.prompt.text.trim();
  const pendingImageCount = input.prompt.images.length;

  return input.messages.some((message) => {
    if (message.type !== 'user') {
      return false;
    }

    const messageText = message.text.trim();
    const messageImageCount = message.images?.length ?? 0;
    if (messageImageCount !== pendingImageCount) {
      return false;
    }

    if (pendingText.length === 0) {
      return pendingImageCount > 0;
    }

    return messageText === pendingText;
  });
}

export function shouldDeferConversationFileRefresh(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  hasPendingInitialPrompt: boolean;
  pendingInitialPromptDispatching: boolean;
  hasPendingInitialPromptInFlight: boolean;
}): boolean {
  return !input.draft
    && Boolean(input.conversationId)
    && (input.hasPendingInitialPrompt || input.pendingInitialPromptDispatching || input.hasPendingInitialPromptInFlight);
}

export function shouldFetchConversationLiveSessionGitContext(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  conversationLiveDecision: boolean | null;
  conversationBootstrapLoading: boolean;
  sessionLoading: boolean;
  isStreaming: boolean;
  hasPendingInitialPrompt: boolean;
  pendingInitialPromptDispatching: boolean;
  hasPendingInitialPromptInFlight: boolean;
}): boolean {
  return !input.draft
    && Boolean(input.conversationId)
    && input.conversationLiveDecision === true
    && !input.conversationBootstrapLoading
    && !input.sessionLoading
    && !input.isStreaming
    && !input.hasPendingInitialPrompt
    && !input.pendingInitialPromptDispatching
    && !input.hasPendingInitialPromptInFlight;
}

function resolveConversationPageTitle(input: {
  draft: boolean;
  titleOverride?: string | null;
  streamTitle?: string | null;
  liveTitle?: string | null;
  detailTitle?: string | null;
  sessionTitle?: string | null;
}): string {
  if (input.draft) {
    return NEW_CONVERSATION_TITLE;
  }

  return getConversationDisplayTitle(
    input.titleOverride,
    input.streamTitle,
    input.liveTitle,
    input.detailTitle,
    input.sessionTitle,
  );
}

function replaceConversationTitleInSessionList<T extends { id: string; title: string }>(
  sessions: T[] | null,
  conversationId: string | null | undefined,
  nextTitle: string | null | undefined,
): T[] | null {
  if (!sessions || !conversationId) {
    return sessions;
  }

  const normalizedTitle = normalizeConversationTitle(nextTitle);
  if (!normalizedTitle) {
    return sessions;
  }

  let changed = false;
  const updatedSessions = sessions.map((session) => {
    if (session.id !== conversationId || session.title === normalizedTitle) {
      return session;
    }

    changed = true;
    return { ...session, title: normalizedTitle };
  });

  return changed ? updatedSessions : sessions;
}

function resolveConversationStreamTitleSync<T extends { id: string; title: string }>(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  streamTitle: string | null | undefined;
  liveTitle: string | null | undefined;
  sessions: T[] | null;
}): {
  normalizedTitle: string | null;
  shouldPushLiveTitle: boolean;
  nextSessions: T[] | null;
} {
  if (input.draft || !input.conversationId) {
    return {
      normalizedTitle: null,
      shouldPushLiveTitle: false,
      nextSessions: input.sessions,
    };
  }

  const normalizedTitle = normalizeConversationTitle(input.streamTitle);
  if (!normalizedTitle) {
    return {
      normalizedTitle: null,
      shouldPushLiveTitle: false,
      nextSessions: input.sessions,
    };
  }

  return {
    normalizedTitle,
    shouldPushLiveTitle: normalizeConversationTitle(input.liveTitle) !== normalizedTitle,
    nextSessions: replaceConversationTitleInSessionList(input.sessions, input.conversationId, normalizedTitle),
  };
}

function mergeConversationSessionMeta(
  detailMeta: SessionMeta | null | undefined,
  sessionSnapshot: SessionMeta | null | undefined,
): SessionMeta | null {
  if (detailMeta && sessionSnapshot && detailMeta.id === sessionSnapshot.id) {
    return {
      ...sessionSnapshot,
      ...detailMeta,
      isRunning: detailMeta.isRunning ?? sessionSnapshot.isRunning,
      isLive: detailMeta.isLive ?? sessionSnapshot.isLive,
      lastActivityAt: detailMeta.lastActivityAt ?? sessionSnapshot.lastActivityAt,
      needsAttention: detailMeta.needsAttention ?? sessionSnapshot.needsAttention,
      attentionUpdatedAt: detailMeta.attentionUpdatedAt ?? sessionSnapshot.attentionUpdatedAt,
      attentionUnreadMessageCount: detailMeta.attentionUnreadMessageCount ?? sessionSnapshot.attentionUnreadMessageCount,
      attentionUnreadActivityCount: detailMeta.attentionUnreadActivityCount ?? sessionSnapshot.attentionUnreadActivityCount,
      attentionActivityIds: detailMeta.attentionActivityIds ?? sessionSnapshot.attentionActivityIds,
      deferredResumes: detailMeta.deferredResumes ?? sessionSnapshot.deferredResumes,
    };
  }

  return detailMeta ?? sessionSnapshot ?? null;
}

function formatConversationBackgroundRunStatusLabel(status: string | undefined): string {
  if (status === 'queued' || status === 'waiting' || status === 'running' || status === 'recovering') {
    return status;
  }

  return typeof status === 'string' && status.trim().length > 0 ? status : 'active';
}

function buildConversationBackgroundRunIndicatorText(
  runs: DurableRunRecord[],
  lookups: RunPresentationLookups = {},
): string {
  if (runs.length === 0) {
    return '';
  }

  const latestRun = runs[0]!;
  const latestTitle = getRunHeadline(latestRun, lookups).title;
  if (runs.length === 1) {
    return `${formatConversationBackgroundRunStatusLabel(latestRun.status?.status)} · ${latestTitle}`;
  }

  return `${runs.length} active · latest ${latestTitle}`;
}

const HISTORICAL_TAIL_BLOCKS_JUMP_PADDING = 40;
const MAX_AUTOMATIC_HISTORICAL_TAIL_BLOCKS = 360;
const HISTORICAL_PREFETCH_SCROLL_THRESHOLD_PX = 1400;
const HISTORICAL_BACKGROUND_PREFETCH_DELAY_MS = 1500;
const MAX_CONVERSATION_RAIL_BLOCKS = 240;
const AGGRESSIVE_CHAT_RENDERING_MESSAGE_THRESHOLD = 96;

function resolveConversationInitialHistoricalWarmupTarget(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  liveDecision: boolean | null | undefined;
  historicalTotalBlocks: number;
  historicalHasOlderBlocks: boolean;
}): number | null {
  if (
    input.draft
    || !input.conversationId
    || input.liveDecision !== false
    || !input.historicalHasOlderBlocks
    || input.historicalTotalBlocks <= 0
  ) {
    return null;
  }

  // Keep the first paint small when switching threads. Older history can load
  // lazily in the background or on demand instead of blocking open.
  return null;
}

function hasConversationLoadedHistoricalTailBlocks(
  detail: Pick<SessionDetail, 'blocks' | 'totalBlocks'> | null | undefined,
  targetTailBlocks: number | null,
): boolean {
  if (!detail || typeof targetTailBlocks !== 'number' || targetTailBlocks <= 0) {
    return false;
  }

  return detail.blocks.length >= Math.min(targetTailBlocks, detail.totalBlocks);
}

function shouldShowConversationInitialHistoricalWarmupLoader(input: {
  warmupActive: boolean;
  targetTailBlocks: number | null;
  currentTailBlocks: number;
  loadedTailBlocks: boolean;
}): boolean {
  if (!input.warmupActive || typeof input.targetTailBlocks !== 'number' || input.targetTailBlocks <= 0) {
    return false;
  }

  return input.currentTailBlocks < input.targetTailBlocks || !input.loadedTailBlocks;
}

function shouldShowConversationBootstrapLoadingState(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  conversationBootstrapLoading: boolean;
  hasRenderableMessages: boolean;
  hasVisibleSessionDetail: boolean;
}): boolean {
  return !input.draft
    && Boolean(input.conversationId)
    && input.conversationBootstrapLoading
    && !input.hasRenderableMessages
    && !input.hasVisibleSessionDetail;
}

export function shouldUseHealthyDesktopConversationState(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  desktopMode: 'checking' | 'local' | 'inactive';
  desktopError: string | null;
}): boolean {
  return !input.draft
    && Boolean(input.conversationId)
    && input.desktopMode === 'local'
    && !input.desktopError;
}

function shouldShowConversationInlineLoadingState(input: {
  showConversationLoadingState: boolean;
  hasVisibleTranscript: boolean;
}): boolean {
  return input.showConversationLoadingState && input.hasVisibleTranscript;
}

export function shouldFetchConversationAttachments(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  drawingsPickerOpen: boolean;
}): boolean {
  return !input.draft && Boolean(input.conversationId) && input.drawingsPickerOpen;
}

export function resolveConversationPerformanceMode(input: {
  messageCount: number;
}): 'default' | 'aggressive' {
  return input.messageCount >= AGGRESSIVE_CHAT_RENDERING_MESSAGE_THRESHOLD
    ? 'aggressive'
    : 'default';
}

export function shouldRenderConversationRail(input: {
  hasRenderableMessages: boolean;
  realMessages: MessageBlock[] | undefined;
  performanceMode: 'default' | 'aggressive';
}): boolean {
  return input.hasRenderableMessages
    && Boolean(input.realMessages)
    && input.performanceMode === 'default'
    && (input.realMessages?.length ?? 0) <= MAX_CONVERSATION_RAIL_BLOCKS;
}

function resolveConversationVisibleScrollBinding(input: {
  draft: boolean;
  routeConversationId: string | null | undefined;
  realMessages: MessageBlock[] | undefined;
  stableTranscriptState: {
    conversationId: string;
    messages: MessageBlock[];
  } | null;
  showConversationLoadingState: boolean;
  initialScrollKey: string | null;
  isStreaming: boolean;
}): {
  conversationId: string | null;
  messages: MessageBlock[] | undefined;
  initialScrollKey: string | null;
  isStreaming: boolean;
  usingStableTranscript: boolean;
} {
  const hasRenderableMessages = (input.realMessages?.length ?? 0) > 0;
  const usingStableTranscript = !hasRenderableMessages
    && input.showConversationLoadingState
    && !input.draft
    && Boolean(input.stableTranscriptState);

  if (usingStableTranscript) {
    return {
      conversationId: input.stableTranscriptState?.conversationId ?? null,
      messages: input.stableTranscriptState?.messages,
      initialScrollKey: null,
      isStreaming: false,
      usingStableTranscript: true,
    };
  }

  return {
    conversationId: input.routeConversationId ?? null,
    messages: input.realMessages,
    initialScrollKey: input.initialScrollKey,
    isStreaming: input.isStreaming,
    usingStableTranscript: false,
  };
}

// ── Model picker ──────────────────────────────────────────────────────────────

export function shouldLoadConversationModels(input: {
  draft: boolean;
  hasPendingInitialPrompt: boolean;
  hasPendingInitialPromptInFlight: boolean;
}): boolean {
  if (input.draft) {
    return true;
  }

  return !input.hasPendingInitialPrompt && !input.hasPendingInitialPromptInFlight;
}

function useModels(enabled: boolean) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [defaultThinkingLevel, setDefaultThinkingLevel] = useState<string>('');
  const [defaultServiceTier, setDefaultServiceTier] = useState<string>('');

  useEffect(() => {
    if (!enabled) {
      return;
    }

    api.models()
      .then((data) => {
        setModels(data.models);
        setDefaultModel(data.currentModel);
        setDefaultThinkingLevel(data.currentThinkingLevel ?? '');
        setDefaultServiceTier(data.currentServiceTier ?? '');
      })
      .catch(() => {});
  }, [enabled]);

  return {
    models,
    defaultModel,
    defaultThinkingLevel,
    defaultServiceTier,
  };
}

function ModelPicker({ models, currentModel, query, idx, onSelect, onClose }:
  { models: ModelInfo[]; currentModel: string; query: string; idx: number; onSelect: (id: string) => void; onClose: () => void }) {
  const groups: Record<string, ModelInfo[]> = {};
  for (const m of models) { (groups[m.provider] ??= []).push(m); }
  const flat = models;
  const sel  = flat.length > 0 ? flat[((idx % flat.length) + flat.length) % flat.length] : null;
  const fmtCtx = (n: number) => n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1_000}k`;

  return (
    <div className="ui-menu-shell">
      <div className="ui-menu-header">
        <p className="ui-section-label">Switch model</p>
        <IconButton onClick={onClose} title="Close model picker" aria-label="Close model picker" compact>
          <span className="text-[11px] font-mono">esc</span>
        </IconButton>
      </div>
      {flat.length === 0 ? (
        <div className="px-3 py-4 text-[12px] text-dim">
          No models match <span className="font-mono text-secondary">{query}</span>
        </div>
      ) : Object.entries(groups).map(([provider, ms]) => (
        <div key={provider}>
          <p className="px-3 pt-2 pb-0.5 text-[9px] uppercase tracking-widest text-dim/60 font-semibold">{provider}</p>
          {ms.map(m => {
            const isCurrent = m.id === currentModel;
            const isFocused = m.id === sel?.id;
            return (
              <button
                key={m.id}
                onMouseDown={e => { e.preventDefault(); onSelect(m.id); }}
                className={cx('w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors', isFocused ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50')}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isCurrent ? 'bg-accent' : 'bg-transparent border border-border-default'}`} />
                <span className="flex-1 text-[13px] font-medium truncate">{m.name}</span>
                <Pill tone={isCurrent ? 'accent' : 'muted'} mono>{m.id}</Pill>
                <span className="text-[10px] text-dim/60 shrink-0">{fmtCtx(m.context)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const COMPOSER_PREFERENCE_SELECT_CLASS = 'h-8 min-w-0 truncate rounded-md border border-transparent bg-transparent px-1.5 pr-6 text-[11px] font-medium text-secondary outline-none transition-colors hover:bg-surface/45 hover:text-primary focus-visible:border-border-subtle focus-visible:bg-surface/55 focus-visible:text-primary focus-visible:ring-1 focus-visible:ring-accent/20 disabled:cursor-default disabled:opacity-40';
const DRAFT_EMPTY_STATE_CONTENT_WIDTH_CLASS = 'max-w-[38rem]';
const EMPTY_STATE_WORKSPACE_SELECT_CLASS = 'h-8 w-full min-w-0 truncate appearance-none bg-transparent px-0 pr-7 text-[12px] outline-none transition-colors disabled:cursor-default disabled:opacity-60';

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.75 7.5A1.5 1.5 0 0 1 5.25 6h4.018a1.5 1.5 0 0 1 1.06.44l1.172 1.17a1.5 1.5 0 0 0 1.06.44h6.19a1.5 1.5 0 0 1 1.5 1.5v7.95a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V7.5Z" />
      <path d="M3.75 9.75h16.5" />
    </svg>
  );
}

function FolderPlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.75 7.5A1.5 1.5 0 0 1 5.25 6h4.018a1.5 1.5 0 0 1 1.06.44l1.172 1.17a1.5 1.5 0 0 0 1.06.44h6.19a1.5 1.5 0 0 1 1.5 1.5v7.95a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V7.5Z" />
      <path d="M3.75 9.75h16.5" />
      <path d="M16.5 12.5v6" />
      <path d="M13.5 15.5h6" />
    </svg>
  );
}

function MoreHorizontalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function BrowsePathButton({
  busy,
  title,
  ariaLabel,
  onClick,
}: {
  busy: boolean;
  title: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-secondary transition-colors hover:bg-surface/45 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/25 focus-visible:ring-offset-1 focus-visible:ring-offset-base disabled:opacity-50"
      title={title}
      aria-label={ariaLabel}
    >
      <FolderPlusIcon className={cx(busy && 'animate-pulse')} />
    </button>
  );
}

function RemoteExecutionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1.75" y="2" width="4.5" height="3.5" rx="1" />
      <rect x="7.75" y="8.5" width="4.5" height="3.5" rx="1" />
      <path d="M6.2 4.8h1.5c1.1 0 2 .9 2 2v1" />
      <path d="M7.9 7.8 9.7 7.8 9.7 6" />
    </svg>
  );
}

function ComposerActionIcon({ label, className }: { label: 'Steer' | 'Follow up' | 'Parallel'; className?: string }) {
  if (label === 'Follow up') {
    return (
      <svg className={className} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 14 4 9l5-5" />
        <path d="M20 20c0-6-4-11-11-11H4" />
      </svg>
    );
  }

  if (label === 'Parallel') {
    return (
      <svg className={className} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 7h10" />
        <path d="M7 12h10" />
        <path d="M7 17h10" />
        <path d="m15 5 4 2-4 2" />
        <path d="m9 15-4 2 4 2" />
      </svg>
    );
  }

  return (
    <svg className={className} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12h11" />
      <path d="m11 5 7 7-7 7" />
    </svg>
  );
}

function formatComposerActionLabel(label: 'Steer' | 'Follow up' | 'Parallel'): string {
  return label === 'Follow up' ? 'followup' : label.toLowerCase();
}

interface TokenCounts {
  total: number | null;
  contextWindow: number;
  segments?: ContextUsageSegment[];
}

function resolveConversationGitSummaryPresentation(git: LiveSessionContext['git']):
  | { kind: 'none' }
  | { kind: 'summary'; text: string }
  | { kind: 'diff'; added: string; deleted: string } {
  if (!git) {
    return { kind: 'none' };
  }

  if (git.linesAdded === 0 && git.linesDeleted === 0) {
    return {
      kind: 'summary',
      text: git.changeCount > 0 ? `${git.changeCount} files` : 'clean',
    };
  }

  return {
    kind: 'diff',
    added: `+${git.linesAdded.toLocaleString()}`,
    deleted: `-${git.linesDeleted.toLocaleString()}`,
  };
}

function ConversationThinkingLevelSelect({
  value,
  disabled,
  variant = 'inline',
  onChange,
}: {
  value: string;
  disabled: boolean;
  variant?: 'inline' | 'menu';
  onChange: (thinkingLevel: string) => void;
}) {
  const selectClassName = variant === 'menu'
    ? 'h-9 w-full min-w-0 appearance-none rounded-lg border border-border-subtle bg-surface/45 px-2.5 pr-7 text-[12px] font-medium text-primary outline-none transition-colors hover:bg-surface/65 focus-visible:border-accent/50 focus-visible:bg-surface/65 disabled:cursor-default disabled:opacity-40'
    : cx(COMPOSER_PREFERENCE_SELECT_CLASS, 'max-w-[6.5rem] min-w-[5.75rem] appearance-none');

  return (
    <label className={variant === 'menu' ? 'relative flex min-w-0 items-center' : 'relative inline-flex min-w-0 items-center'}>
      <span className="sr-only">Conversation thinking level</span>
      <select
        value={value}
        onChange={(event) => { onChange(event.target.value); }}
        disabled={disabled}
        className={selectClassName}
        aria-label="Conversation thinking level"
      >
        {THINKING_LEVEL_OPTIONS.map((option) => (
          <option key={option.value || 'unset'} value={option.value}>{option.label}</option>
        ))}
      </select>
      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-2.5 text-dim/70">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}

function ConversationFastModeToggle({
  enabled,
  disabled,
  onToggle,
}: {
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={enabled ? 'Disable fast mode' : 'Enable fast mode'}
      title={enabled ? 'Disable fast mode' : 'Enable fast mode'}
      onClick={onToggle}
      disabled={disabled}
      className="group inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1 text-[11px] font-medium text-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        aria-hidden="true"
        className={cx(
          'relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full border p-[1px] transition-all',
          enabled
            ? 'border-accent/55 bg-accent/75 shadow-[0_0_8px_rgba(168,85,247,0.16)]'
            : 'border-border-default bg-surface/40 group-hover:bg-surface/60',
        )}
      >
        <span
          className={cx(
            'h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform',
            enabled ? 'translate-x-[14px]' : 'translate-x-0',
          )}
        />
      </span>
      <span className={cx('leading-none', enabled && 'text-primary')}>Fast</span>
    </button>
  );
}

function ConversationCompactMenuToggle({
  label,
  enabled,
  busy = false,
  disabled,
  tone,
  title,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  busy?: boolean;
  disabled: boolean;
  tone: 'accent' | 'warning';
  title: string;
  onToggle: () => void;
}) {
  const activeTrackClassName = tone === 'warning'
    ? 'border-warning/55 bg-warning/75 shadow-[0_0_8px_rgba(245,158,11,0.16)]'
    : 'border-accent/55 bg-accent/75 shadow-[0_0_8px_rgba(168,85,247,0.16)]';
  const focusRingClassName = tone === 'warning'
    ? 'focus-visible:ring-warning/25'
    : 'focus-visible:ring-accent/25';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-busy={busy}
      aria-label={title}
      title={title}
      onClick={onToggle}
      disabled={disabled || busy}
      className={cx(
        'group inline-flex w-full items-center justify-between rounded-lg border border-border-subtle bg-surface/45 px-2.5 py-2 text-[11px] font-medium text-secondary transition-colors hover:bg-surface/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40',
        focusRingClassName,
      )}
    >
      <span className={cx('leading-none', enabled && 'text-primary')}>{label}</span>
      <span
        aria-hidden="true"
        className={cx(
          'relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full border p-[1px] transition-all',
          enabled
            ? activeTrackClassName
            : 'border-border-default bg-surface/40 group-hover:bg-surface/60',
          busy && 'opacity-80',
        )}
      >
        <span
          className={cx(
            'h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform',
            enabled ? 'translate-x-[14px]' : 'translate-x-0',
            busy && 'animate-pulse',
          )}
        />
      </span>
    </button>
  );
}

function ConversationPreferencesRow({
  models,
  currentModel,
  currentThinkingLevel,
  currentServiceTier,
  savingPreference,
  showAutoModeToggle,
  autoModeEnabled,
  autoModeBusy,
  onSelectModel,
  onSelectThinkingLevel,
  onSelectServiceTier,
  onToggleAutoMode,
}: {
  models: ModelInfo[];
  currentModel: string;
  currentThinkingLevel: string;
  currentServiceTier: string;
  savingPreference: 'model' | 'thinking' | 'serviceTier' | null;
  showAutoModeToggle: boolean;
  autoModeEnabled: boolean;
  autoModeBusy: boolean;
  onSelectModel: (modelId: string) => void;
  onSelectThinkingLevel: (thinkingLevel: string) => void;
  onSelectServiceTier: (enableFastMode: boolean) => void;
  onToggleAutoMode: () => void;
}) {
  const [compactMenuOpen, setCompactMenuOpen] = useState(false);
  const compactMenuRef = useRef<HTMLDivElement | null>(null);
  const groupedModels = useMemo(() => groupModelsByProvider(models), [models]);
  const selectedModel = useMemo(
    () => models.find((model) => model.id === currentModel) ?? null,
    [currentModel, models],
  );
  const serviceTierOptions = useMemo(
    () => getModelSelectableServiceTierOptions(selectedModel),
    [selectedModel],
  );
  const supportsFastMode = useMemo(
    () => serviceTierOptions.some((option) => option.value === 'priority'),
    [serviceTierOptions],
  );
  const fastModeEnabled = currentServiceTier === 'priority';

  useEffect(() => {
    if (!compactMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (compactMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setCompactMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setCompactMenuOpen(false);
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [compactMenuOpen]);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <label className="relative inline-flex min-w-0 items-center">
        <span className="sr-only">Conversation model</span>
        <select
          value={currentModel}
          onChange={(event) => { onSelectModel(event.target.value); }}
          disabled={savingPreference !== null || models.length === 0}
          className={cx(COMPOSER_PREFERENCE_SELECT_CLASS, 'max-w-[11.5rem] min-w-[8.25rem] appearance-none')}
          aria-label="Conversation model"
        >
          {groupedModels.map(([provider, providerModels]) => (
            <optgroup key={provider} label={provider}>
              {providerModels.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-2.5 text-dim/70">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </label>

      <div className="hidden xl:flex items-center gap-2">
        <ConversationThinkingLevelSelect
          value={currentThinkingLevel}
          disabled={savingPreference !== null}
          onChange={onSelectThinkingLevel}
        />
        {supportsFastMode && (
          <ConversationFastModeToggle
            enabled={fastModeEnabled}
            disabled={savingPreference !== null}
            onToggle={() => { onSelectServiceTier(!fastModeEnabled); }}
          />
        )}
        {showAutoModeToggle && (
          <ConversationAutoModeToggle
            enabled={autoModeEnabled}
            busy={autoModeBusy}
            disabled={false}
            onToggle={onToggleAutoMode}
          />
        )}
      </div>

      <div ref={compactMenuRef} className="relative xl:hidden">
        <IconButton
          type="button"
          onClick={() => setCompactMenuOpen((current) => !current)}
          className={cx(
            'h-8 w-8 rounded-md border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/25 focus-visible:ring-offset-1 focus-visible:ring-offset-base',
            compactMenuOpen && 'bg-surface/55 text-primary',
          )}
          aria-label="More composer settings"
          aria-expanded={compactMenuOpen}
          aria-haspopup="dialog"
          title="More composer settings"
        >
          <MoreHorizontalIcon />
        </IconButton>
        {compactMenuOpen && (
          <div className="ui-context-menu-shell absolute bottom-full right-0 z-50 mb-2 w-[15rem] p-2.5" role="dialog" aria-label="Composer settings">
            <div className="flex flex-col gap-2">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-dim/70">Thinking</p>
                <ConversationThinkingLevelSelect
                  value={currentThinkingLevel}
                  disabled={savingPreference !== null}
                  variant="menu"
                  onChange={(thinkingLevel) => {
                    onSelectThinkingLevel(thinkingLevel);
                    setCompactMenuOpen(false);
                  }}
                />
              </div>
              {supportsFastMode && (
                <ConversationCompactMenuToggle
                  label="Fast mode"
                  enabled={fastModeEnabled}
                  disabled={savingPreference !== null}
                  tone="accent"
                  title={fastModeEnabled ? 'Disable fast mode' : 'Enable fast mode'}
                  onToggle={() => {
                    onSelectServiceTier(!fastModeEnabled);
                    setCompactMenuOpen(false);
                  }}
                />
              )}
              {showAutoModeToggle && (
                <ConversationCompactMenuToggle
                  label="Auto mode"
                  enabled={autoModeEnabled}
                  busy={autoModeBusy}
                  disabled={false}
                  tone="warning"
                  title={autoModeBusy ? 'Updating auto mode…' : (autoModeEnabled ? 'Turn off conversation auto mode' : 'Turn on conversation auto mode')}
                  onToggle={() => {
                    onToggleAutoMode();
                    setCompactMenuOpen(false);
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function resolveConversationComposerShellStateClassName({
  dragOver,
  hasInteractiveOverlay,
  autoModeEnabled,
}: {
  dragOver: boolean;
  hasInteractiveOverlay: boolean;
  autoModeEnabled: boolean;
}): string {
  if (dragOver) {
    return 'border-accent/50 ring-2 ring-accent/20 bg-accent/5';
  }

  if (hasInteractiveOverlay) {
    return 'border-accent/40 ring-1 ring-accent/15';
  }

  if (autoModeEnabled) {
    return 'border-warning/30 ring-1 ring-warning/15 ui-input-shell-auto-mode';
  }

  return 'border-border-subtle';
}

function ConversationAutoModeToggle({
  enabled,
  busy,
  disabled,
  onToggle,
}: {
  enabled: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const title = busy
    ? 'Updating auto mode…'
    : enabled
      ? 'Turn off conversation auto mode'
      : 'Turn on conversation auto mode';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-busy={busy}
      aria-label={title}
      title={title}
      onClick={onToggle}
      disabled={disabled || busy}
      className="group inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1 text-[11px] font-medium text-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/25 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        aria-hidden="true"
        className={cx(
          'relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full border p-[1px] transition-all',
          enabled
            ? 'border-warning/55 bg-warning/75 shadow-[0_0_8px_rgba(245,158,11,0.16)]'
            : 'border-border-default bg-surface/40 group-hover:bg-surface/60',
          busy && 'opacity-80',
        )}
      >
        <span
          className={cx(
            'h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform',
            enabled ? 'translate-x-[14px]' : 'translate-x-0',
            busy && 'animate-pulse',
          )}
        />
      </span>
      <span className={cx('leading-none', enabled && 'text-primary')}>Auto</span>
    </button>
  );
}

// ── SlashMenu ─────────────────────────────────────────────────────────────────

function SlashMenu({ items, idx, onSelect }: { items: SlashMenuItem[]; idx: number; onSelect: (item: SlashMenuItem) => void }) {
  if (!items.length) return null;

  const selectedIndex = idx % items.length;
  const selectedItemRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div className="ui-menu-shell max-h-[28rem] overflow-y-auto py-1.5">
      {items.map((item, itemIndex) => (
        <button
          key={item.key}
          ref={itemIndex === selectedIndex ? selectedItemRef : undefined}
          onMouseDown={(event) => { event.preventDefault(); onSelect(item); }}
          className={cx('w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors', itemIndex === selectedIndex ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50')}
        >
          <span className="w-5 pt-0.5 text-center text-[13px] select-none text-dim/70">{item.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 max-w-[26rem] truncate whitespace-nowrap font-mono text-[12px] text-accent">
                {item.displayCmd}
              </span>
              {item.source && (
                <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-dim/60">
                  {item.source}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-dim/90">{item.desc}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

function MentionMenu({
  items,
  query,
  idx,
  onSelect,
}: {
  items: MentionItem[];
  query: string;
  idx: number;
  onSelect: (id: string) => void;
}) {
  const filtered = filterMentionItems(items, query, { limit: MAX_MENTION_MENU_ITEMS });
  if (!filtered.length) return null;

  const selectedIndex = idx % filtered.length;
  const selectedItemRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div className="ui-menu-shell max-h-[18rem] overflow-y-auto py-1.5">
      <div className="px-3 pt-2 pb-1">
        <p className="ui-section-label">Mention</p>
      </div>
      {filtered.map((item, i) => (
        <button
          key={`${item.kind}:${item.id}`}
          ref={i === selectedIndex ? selectedItemRef : undefined}
          onMouseDown={(event) => { event.preventDefault(); onSelect(item.id); }}
          className={cx('w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors', i === selectedIndex ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50')}
        >
          <Pill tone="muted">{item.kind}</Pill>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] text-accent truncate">{item.id}</p>
            {(item.summary || (item.title && item.title !== item.label)) && (
              <p className="mt-0.5 truncate text-[12px] text-dim/90">
                {item.summary || item.title}
              </p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

const MAX_PROMPT_IMAGE_DIMENSION = 2000;

function readBlobAsDataUrl(blob: Blob, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error(`Failed to read ${label}`));
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${label}`));
    reader.readAsDataURL(blob);
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return readBlobAsDataUrl(file, file.name);
}

function dataUrlToBase64(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode image.'));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to encode image.'));
        return;
      }

      resolve(blob);
    }, mimeType, quality);
  });
}

function normalizePromptImageMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') {
    return 'image/jpeg';
  }

  if (normalized === 'image/webp') {
    return 'image/webp';
  }

  return 'image/png';
}

export function constrainPromptImageDimensions(width: number, height: number, maxDimension = MAX_PROMPT_IMAGE_DIMENSION): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return {
      width: Math.max(1, Math.round(width) || 1),
      height: Math.max(1, Math.round(height) || 1),
    };
  }

  const longSide = Math.max(width, height);
  if (longSide <= maxDimension) {
    return {
      width: Math.round(width),
      height: Math.round(height),
    };
  }

  const scale = maxDimension / longSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function preparePromptImage(file: File): Promise<PromptImageInput> {
  const previewUrl = await readFileAsDataUrl(file);
  const mimeType = file.type || 'image/png';

  try {
    const image = await loadImageFromDataUrl(previewUrl);
    const targetSize = constrainPromptImageDimensions(image.naturalWidth, image.naturalHeight);
    if (targetSize.width === image.naturalWidth && targetSize.height === image.naturalHeight) {
      return {
        name: file.name,
        mimeType,
        data: dataUrlToBase64(previewUrl),
        previewUrl,
      } satisfies PromptImageInput;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetSize.width;
    canvas.height = targetSize.height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to resize image.');
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, targetSize.width, targetSize.height);

    const outputMimeType = normalizePromptImageMimeType(mimeType);
    const outputBlob = await canvasToBlob(
      canvas,
      outputMimeType,
      outputMimeType === 'image/png' ? undefined : 0.9,
    );
    const resizedPreviewUrl = await readBlobAsDataUrl(outputBlob, file.name);

    return {
      name: file.name,
      mimeType: outputBlob.type || outputMimeType,
      data: dataUrlToBase64(resizedPreviewUrl),
      previewUrl: resizedPreviewUrl,
    } satisfies PromptImageInput;
  } catch {
    return {
      name: file.name,
      mimeType,
      data: dataUrlToBase64(previewUrl),
      previewUrl,
    } satisfies PromptImageInput;
  }
}

function fileExtensionForMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === 'image/jpeg') {
    return 'jpg';
  }

  const [, subtype] = normalized.split('/');
  return subtype || 'png';
}

function base64ToFile(data: string, mimeType: string, name: string): File {
  const decoded = window.atob(data);
  const bytes = new Uint8Array(decoded.length);

  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }

  return new File([bytes], name, { type: mimeType });
}

function restoreQueuedImageFiles(
  images: PromptImageInput[] | undefined | null,
  behavior: 'steer' | 'followUp',
  queueIndex: number,
): File[] {
  const normalizedImages = Array.isArray(images) ? images : [];
  return normalizedImages.map((image, imageIndex) => {
    const extension = fileExtensionForMimeType(image.mimeType);
    const name = image.name?.trim() || `queued-${behavior}-${queueIndex + 1}-${imageIndex + 1}.${extension}`;
    return base64ToFile(image.data, image.mimeType, name);
  });
}

function restoreComposerImageFiles(
  images: PromptImageInput[] | undefined | null,
  fallbackNamePrefix: string,
): File[] {
  const normalizedImages = Array.isArray(images) ? images : [];
  return normalizedImages.map((image, imageIndex) => {
    const extension = fileExtensionForMimeType(image.mimeType);
    const name = image.name?.trim() || `${fallbackNamePrefix}-${imageIndex + 1}.${extension}`;
    return base64ToFile(image.data, image.mimeType, name);
  });
}

async function buildPromptImages(files: File[]): Promise<PromptImageInput[]> {
  const imageFiles = files.filter((file) => file.type.startsWith('image/'));
  return Promise.all(imageFiles.map((file) => preparePromptImage(file)));
}

type ComposerDrawingAttachment = DraftConversationDrawingAttachment;

function createComposerDrawingLocalId(): string {
  return `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isPotentialExcalidrawFile(file: File): boolean {
  const lowerName = file.name.trim().toLowerCase();
  if (lowerName.endsWith('.excalidraw')) {
    return true;
  }

  if (lowerName.endsWith('.png')) {
    return true;
  }

  return file.type === 'application/json' || file.type === 'application/vnd.excalidraw+json';
}

function drawingAttachmentToPromptImage(attachment: ComposerDrawingAttachment): PromptImageInput {
  return {
    name: `${attachment.title}.png`,
    mimeType: attachment.previewMimeType,
    data: attachment.previewData,
    previewUrl: attachment.previewUrl,
  };
}

function drawingAttachmentToPromptRef(attachment: ComposerDrawingAttachment): PromptAttachmentRefInput | null {
  const attachmentId = attachment.attachmentId?.trim();
  if (!attachmentId) {
    return null;
  }

  return {
    attachmentId,
    ...(attachment.revision ? { revision: attachment.revision } : {}),
  };
}

async function buildComposerDrawingFromFile(file: File): Promise<ComposerDrawingAttachment> {
  const scene = await loadExcalidrawSceneFromBlob(file);
  const serialized = await serializeExcalidrawScene(scene);
  const title = inferDrawingTitleFromFileName(file.name);
  const fileNames = buildDrawingFileNames(title);

  return {
    localId: createComposerDrawingLocalId(),
    title,
    sourceData: serialized.sourceData,
    sourceMimeType: serialized.sourceMimeType,
    sourceName: fileNames.sourceName,
    previewData: serialized.previewData,
    previewMimeType: serialized.previewMimeType,
    previewName: fileNames.previewName,
    previewUrl: serialized.previewUrl,
    scene,
    dirty: true,
  };
}

function formatDeferredResumeWhen(resume: DeferredResumeSummary): string {
  const target = resume.status === 'ready'
    ? resume.readyAt ?? resume.dueAt
    : resume.dueAt;
  const date = new Date(target);
  if (Number.isNaN(date.getTime())) {
    return target;
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function hasBlockingOverlayOpen(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  return document.querySelector('.ui-overlay-backdrop') !== null;
}

function primeCreatedConversationOpenCaches(
  created: LiveSessionCreateResult,
  options: {
    tailBlocks: number;
    bootstrapVersionKey: string;
    sessionDetailVersion: number;
  },
): void {
  if (!created.bootstrap) {
    return;
  }

  primeConversationBootstrapCache(
    created.id,
    created.bootstrap,
    { tailBlocks: options.tailBlocks },
    options.bootstrapVersionKey,
  );

  if (created.bootstrap.sessionDetail) {
    primeSessionDetailCache(
      created.id,
      created.bootstrap.sessionDetail,
      { tailBlocks: options.tailBlocks },
      options.sessionDetailVersion,
    );
  }
}

interface ConversationInitialModelPreferenceState {
  conversationId: string;
  currentModel: string;
  currentThinkingLevel: string;
  currentServiceTier: string;
  hasExplicitServiceTier: boolean;
}

interface ConversationInitialDeferredResumeState {
  conversationId: string;
  resumes: DeferredResumeSummary[];
}

interface ConversationDraftHydrationState {
  conversationId: string;
  enableAutoModeOnLoad?: boolean;
}

interface ConversationLocationState {
  initialModelPreferenceState?: ConversationInitialModelPreferenceState;
  initialDeferredResumeState?: ConversationInitialDeferredResumeState;
  draftHydrationState?: ConversationDraftHydrationState;
}

const DRAFT_SERVICE_TIER_DISABLED_SENTINEL = '__pa_draft_fast_mode_disabled__';

function resolveDraftConversationServiceTierState(
  storedServiceTier: string,
  defaultServiceTier: string,
): { currentServiceTier: string; hasExplicitServiceTier: boolean } {
  const normalizedStoredServiceTier = storedServiceTier.trim();
  if (normalizedStoredServiceTier === DRAFT_SERVICE_TIER_DISABLED_SENTINEL) {
    return { currentServiceTier: '', hasExplicitServiceTier: true };
  }

  if (normalizedStoredServiceTier) {
    return { currentServiceTier: normalizedStoredServiceTier, hasExplicitServiceTier: true };
  }

  return {
    currentServiceTier: defaultServiceTier.trim(),
    hasExplicitServiceTier: false,
  };
}

function buildConversationServiceTierPreferenceInput(input: {
  currentServiceTier: string;
  hasExplicitServiceTier: boolean;
}): { serviceTier?: string | null } {
  if (!input.hasExplicitServiceTier) {
    return {};
  }

  return { serviceTier: input.currentServiceTier.trim() || null };
}

function resolveFastModeToggleServiceTier(input: {
  enableFastMode: boolean;
  defaultServiceTier: string;
}): string | null {
  if (input.enableFastMode) {
    return input.defaultServiceTier === 'priority' ? '' : 'priority';
  }

  return input.defaultServiceTier === 'priority' ? null : '';
}

function buildConversationInitialModelPreferenceState(input: {
  conversationId: string;
  currentModel?: string;
  currentThinkingLevel?: string;
  currentServiceTier?: string;
  hasExplicitServiceTier?: boolean;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  defaultServiceTier?: string;
}): ConversationInitialModelPreferenceState {
  const normalizedCurrentServiceTier = input.currentServiceTier?.trim() || '';
  const hasExplicitServiceTier = Boolean(input.hasExplicitServiceTier);

  return {
    conversationId: input.conversationId,
    currentModel: input.currentModel?.trim() || input.defaultModel?.trim() || '',
    currentThinkingLevel: input.currentThinkingLevel?.trim() || input.defaultThinkingLevel?.trim() || '',
    currentServiceTier: hasExplicitServiceTier
      ? normalizedCurrentServiceTier
      : normalizedCurrentServiceTier || input.defaultServiceTier?.trim() || '',
    hasExplicitServiceTier,
  };
}

function resolveConversationInitialModelPreferenceState(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  locationState: unknown;
  defaultModel: string;
  defaultThinkingLevel: string;
  defaultServiceTier: string;
}): ConversationInitialModelPreferenceState | null {
  if (input.draft || !input.conversationId || !input.locationState || typeof input.locationState !== 'object') {
    return null;
  }

  const candidate = (input.locationState as ConversationLocationState).initialModelPreferenceState;
  if (!candidate || typeof candidate !== 'object' || candidate.conversationId !== input.conversationId) {
    return null;
  }

  return buildConversationInitialModelPreferenceState({
    conversationId: candidate.conversationId,
    currentModel: typeof candidate.currentModel === 'string' ? candidate.currentModel : '',
    currentThinkingLevel: typeof candidate.currentThinkingLevel === 'string' ? candidate.currentThinkingLevel : '',
    currentServiceTier: typeof candidate.currentServiceTier === 'string' ? candidate.currentServiceTier : '',
    hasExplicitServiceTier: typeof candidate.hasExplicitServiceTier === 'boolean' ? candidate.hasExplicitServiceTier : false,
    defaultModel: input.defaultModel,
    defaultThinkingLevel: input.defaultThinkingLevel,
    defaultServiceTier: input.defaultServiceTier,
  });
}

function resolveConversationInitialDeferredResumeState(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  locationState: unknown;
}): DeferredResumeSummary[] | null {
  if (input.draft || !input.conversationId || !input.locationState || typeof input.locationState !== 'object') {
    return null;
  }

  const candidate = (input.locationState as ConversationLocationState).initialDeferredResumeState;
  if (!candidate || typeof candidate !== 'object' || candidate.conversationId !== input.conversationId) {
    return null;
  }

  return Array.isArray(candidate.resumes) ? candidate.resumes : [];
}

function resolveConversationDraftHydrationState(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  locationState: unknown;
}): ConversationDraftHydrationState | null {
  if (input.draft || !input.conversationId || !input.locationState || typeof input.locationState !== 'object') {
    return null;
  }

  const candidate = (input.locationState as ConversationLocationState).draftHydrationState;
  if (!candidate || typeof candidate !== 'object' || candidate.conversationId !== input.conversationId) {
    return null;
  }

  return {
    conversationId: candidate.conversationId,
    ...(candidate.enableAutoModeOnLoad === true ? { enableAutoModeOnLoad: true } : {}),
  };
}

// ── ConversationPage ──────────────────────────────────────────────────────────

export function ConversationPage({ draft = false }: { draft?: boolean }) {
  const { id: routeId } = useParams<{ id?: string }>();
  const id = draft ? undefined : routeId;
  const location = useLocation();
  const navigate = useNavigate();
  const selectedArtifactId = getConversationArtifactIdFromSearch(location.search);
  const selectedCheckpointId = getConversationCheckpointIdFromSearch(location.search);
  const { versions } = useAppEvents();
  const { tasks, sessions, runs, setRuns, setSessions } = useAppData();
  const conversationEventVersion = useConversationEventVersion(id);
  const openArtifact = useCallback((artifactId: string) => {
    if (selectedArtifactId === artifactId) {
      return;
    }

    const nextSearch = setConversationCheckpointIdInSearch(
      setConversationArtifactIdInSearch(location.search, artifactId),
      null,
    );

    navigate({
      pathname: location.pathname,
      search: nextSearch,
    });
  }, [location.pathname, location.search, navigate, selectedArtifactId]);

  const openCheckpoint = useCallback((checkpointId: string) => {
    if (selectedCheckpointId === checkpointId) {
      return;
    }

    const nextSearch = setConversationArtifactIdInSearch(
      setConversationCheckpointIdInSearch(location.search, checkpointId),
      null,
    );

    navigate({
      pathname: location.pathname,
      search: nextSearch,
    });
  }, [location.pathname, location.search, navigate, selectedCheckpointId]);

  useEffect(() => {
    if (draft || !id) {
      return;
    }

    ensureConversationTabOpen(id);
  }, [draft, id]);

  // ── Live session detection ─────────────────────────────────────────────────
  const [conversationExecutionOverride, setConversationExecutionOverride] = useState<Pick<SessionMeta, 'remoteHostId' | 'remoteHostLabel' | 'remoteConversationId'> | null>(null);
  const [continueInBusy, setContinueInBusy] = useState(false);
  const [desktopConnectionsState, setDesktopConnectionsState] = useState<DesktopConnectionsState | null>(null);
  const [continueInOptions, setContinueInOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [draftExecutionTargetId, setDraftExecutionTargetId] = useState('local');
  const [remoteDirectoryBrowserState, setRemoteDirectoryBrowserState] = useState<null | { kind: 'draft' | 'conversation'; initialPath?: string | null }>(null);
  const [remoteOperationStatus, setRemoteOperationStatus] = useState<DesktopRemoteOperationStatus | null>(null);
  const remoteOperationStatusClearTimeoutRef = useRef<number | null>(null);
  const rawSessionSnapshot = useMemo(
    () => (id ? sessions?.find((session) => session.id === id) ?? null : null),
    [id, sessions],
  );
  const sessionSnapshot = useMemo(() => {
    if (!rawSessionSnapshot) {
      return null;
    }

    return conversationExecutionOverride
      ? { ...rawSessionSnapshot, ...conversationExecutionOverride }
      : rawSessionSnapshot;
  }, [conversationExecutionOverride, rawSessionSnapshot]);
  useEffect(() => {
    setConversationExecutionOverride(
      rawSessionSnapshot?.remoteHostId && rawSessionSnapshot?.remoteConversationId
        ? {
            remoteHostId: rawSessionSnapshot.remoteHostId,
            remoteHostLabel: rawSessionSnapshot.remoteHostLabel,
            remoteConversationId: rawSessionSnapshot.remoteConversationId,
          }
        : null,
    );
  }, [rawSessionSnapshot?.id, rawSessionSnapshot?.remoteConversationId, rawSessionSnapshot?.remoteHostId, rawSessionSnapshot?.remoteHostLabel]);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setDesktopConnectionsState(null);
      setContinueInOptions([]);
      return;
    }

    let cancelled = false;
    void readDesktopConnections()
      .then((connections) => {
        if (cancelled || !connections) {
          return;
        }

        setDesktopConnectionsState(connections);
        setContinueInOptions([
          { value: 'local', label: 'Local project' },
          ...connections.hosts.map((host) => ({ value: host.id, label: host.label })),
        ]);
      })
      .catch(() => {
        if (!cancelled) {
          setDesktopConnectionsState(null);
          setContinueInOptions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const executionTargetOptions = useMemo(() => {
    const baseOptions = continueInOptions.length > 0
      ? [...continueInOptions]
      : (getDesktopBridge() ? [{ value: 'local', label: 'Local project' }] : []);
    const currentRemoteHostId = sessionSnapshot?.remoteHostId?.trim() || '';
    const currentRemoteHostLabel = sessionSnapshot?.remoteHostLabel?.trim() || currentRemoteHostId;

    if (currentRemoteHostId && !baseOptions.some((option) => option.value === currentRemoteHostId)) {
      baseOptions.push({ value: currentRemoteHostId, label: currentRemoteHostLabel });
    }

    return baseOptions;
  }, [continueInOptions, sessionSnapshot?.remoteHostId, sessionSnapshot?.remoteHostLabel]);
  const selectedExecutionTargetId = draft
    ? draftExecutionTargetId
    : sessionSnapshot?.remoteHostId?.trim() || 'local';
  const selectedExecutionTargetHost = useMemo<Extract<DesktopHostRecord, { kind: 'ssh' }> | null>(
    () => selectedExecutionTargetId === 'local'
      ? null
      : desktopConnectionsState?.hosts.find((host) => host.id === selectedExecutionTargetId) ?? null,
    [desktopConnectionsState, selectedExecutionTargetId],
  );
  const selectedExecutionTargetLabel = selectedExecutionTargetHost?.label
    ?? executionTargetOptions.find((option) => option.value === selectedExecutionTargetId)?.label
    ?? (selectedExecutionTargetId === 'local' ? 'Local project' : selectedExecutionTargetId);
  const selectedExecutionTargetIsRemote = selectedExecutionTargetId !== 'local';

  const sessionsLoaded = sessions !== null;
  // We use a confirmed-live flag only for lightweight session-state labeling.
  const [confirmedLive, setConfirmedLive] = useState<boolean | null>(null);
  const [liveSessionHasPendingHiddenTurn, setLiveSessionHasPendingHiddenTurn] = useState(false);
  const [pendingInitialPrompt, setPendingInitialPrompt] = useState<PendingConversationPrompt | null>(null);
  const [pendingInitialPromptDispatching, setPendingInitialPromptDispatchingState] = useState(false);
  const [draftPendingPrompt, setDraftPendingPrompt] = useState<PendingConversationPrompt | null>(null);
  const pendingInitialPromptSessionIdRef = useRef<string | null>(null);
  const pendingInitialPromptFailureSessionIdRef = useRef<string | null>(null);
  const pinnedInitialPromptScrollSessionIdRef = useRef<string | null>(null);
  const pinnedInitialPromptTailKeyRef = useRef<string | null>(null);
  const deferredConversationFileVersionRef = useRef<{ conversationId: string; version: number } | null>(null);

  const hasPendingInitialPromptInFlight = Boolean(id) && pendingInitialPromptSessionIdRef.current === id;
  const deferConversationFileRefresh = shouldDeferConversationFileRefresh({
    draft,
    conversationId: id,
    hasPendingInitialPrompt: Boolean(pendingInitialPrompt),
    pendingInitialPromptDispatching,
    hasPendingInitialPromptInFlight,
  });
  const effectiveConversationEventVersion = deferConversationFileRefresh
    && deferredConversationFileVersionRef.current?.conversationId === id
    ? deferredConversationFileVersionRef.current.version
    : conversationEventVersion;

  const [historicalTailBlocks, setHistoricalTailBlocks] = useState(INITIAL_HISTORICAL_TAIL_BLOCKS);
  const [initialHistoricalWarmupConversationId, setInitialHistoricalWarmupConversationId] = useState<string | null>(null);
  const desktopConversation = useDesktopConversationState(id ?? null, {
    tailBlocks: historicalTailBlocks,
    enabled: !draft && !(sessionSnapshot?.remoteHostId && sessionSnapshot?.remoteConversationId),
  });
  const desktopConversationChecking = !draft && Boolean(id) && desktopConversation.mode === 'checking';
  const useDesktopConversation = shouldUseHealthyDesktopConversationState({
    draft,
    conversationId: id,
    desktopMode: desktopConversation.mode,
    desktopError: desktopConversation.error,
  });
  const visibleDesktopConversationState = useDesktopConversation && id && desktopConversation.state?.conversationId === id
    ? desktopConversation.state
    : null;
  const conversationVersionKey = `${effectiveConversationEventVersion}`;
  const {
    data: webConversationBootstrap,
    loading: webConversationBootstrapLoading,
  } = useConversationBootstrap(draft || useDesktopConversation || desktopConversationChecking ? undefined : id, {
    tailBlocks: historicalTailBlocks,
    versionKey: conversationVersionKey,
  });
  const visibleConversationBootstrap = useDesktopConversation
    ? (id && visibleDesktopConversationState
        ? {
            conversationId: id,
            sessionDetail: visibleDesktopConversationState.sessionDetail,
            liveSession: visibleDesktopConversationState.liveSession,
          }
        : null)
    : (id && webConversationBootstrap?.conversationId === id
        ? webConversationBootstrap
        : null);
  const bootstrapSessionDetail = useDesktopConversation
    ? visibleDesktopConversationState?.sessionDetail ?? null
    : (id && visibleConversationBootstrap?.sessionDetail?.meta.id === id
        ? visibleConversationBootstrap.sessionDetail
        : null);
  const conversationBootstrapLoading = useDesktopConversation
    ? desktopConversation.loading
    : (desktopConversationChecking ? true : webConversationBootstrapLoading);
  const confirmedLiveValue = useDesktopConversation
    ? visibleConversationBootstrap?.liveSession.live ?? null
    : null;
  const shouldSubscribeToLiveStream = !useDesktopConversation && !desktopConversationChecking && shouldEnableConversationLiveStream(id, confirmedLive);

  useEffect(() => {
    if (draft || !id || deferConversationFileRefresh) {
      return;
    }

    deferredConversationFileVersionRef.current = {
      conversationId: id,
      version: conversationEventVersion,
    };
  }, [conversationEventVersion, deferConversationFileRefresh, draft, id]);

  // ── Pi SDK stream — stay subscribed until we know the conversation is not live ─
  const webStream = useSessionStream(id ?? null, {
    tailBlocks: historicalTailBlocks,
    enabled: shouldSubscribeToLiveStream,
  });
  const stream = useDesktopConversation && visibleDesktopConversationState
    ? {
        ...visibleDesktopConversationState.stream,
        surfaceId: desktopConversation.surfaceId,
        reconnect: desktopConversation.reconnect,
        send: desktopConversation.send,
        parallel: desktopConversation.parallel,
        manageParallelJob: desktopConversation.manageParallelJob,
        abort: desktopConversation.abort,
        takeover: desktopConversation.takeover,
      }
    : webStream;
  const streamSend = stream.send;
  const streamParallel = stream.parallel;
  const streamManageParallelJob = stream.manageParallelJob;
  const streamAbort = stream.abort;
  const streamReconnect = stream.reconnect;
  const streamTakeover = stream.takeover;
  const currentSurfaceId = stream.surfaceId;


  useEffect(() => {
    const pendingCwdChange = stream.cwdChange;
    if (!id || !pendingCwdChange || pendingCwdChange.newConversationId === id) {
      return;
    }

    ensureConversationTabOpen(pendingCwdChange.newConversationId);
    navigate(`/conversations/${pendingCwdChange.newConversationId}`);
  }, [id, navigate, stream.cwdChange]);

  useLayoutEffect(() => {
    if (!id || draft) {
      return;
    }

    ensureConversationOpenStart(id, 'route');
  }, [draft, id]);

  // Confirm live status via bootstrap/session snapshots and probe live-only queue state only when needed.
  useEffect(() => {
    if (desktopConversationChecking) {
      return;
    }

    if (useDesktopConversation) {
      setConfirmedLive(visibleConversationBootstrap?.liveSession.live ?? false);
      setLiveSessionHasPendingHiddenTurn(visibleConversationBootstrap?.liveSession.live && visibleConversationBootstrap.liveSession.hasPendingHiddenTurn === true);
      return;
    }

    if (!id) {
      setConfirmedLive(false);
      setLiveSessionHasPendingHiddenTurn(false);
      return;
    }

    if (visibleConversationBootstrap?.liveSession.live) {
      setConfirmedLive(true);
      setLiveSessionHasPendingHiddenTurn(visibleConversationBootstrap.liveSession.hasPendingHiddenTurn === true);
      return;
    }

    if (visibleConversationBootstrap?.liveSession.live === false || sessionSnapshot?.isLive === false) {
      setConfirmedLive(false);
      setLiveSessionHasPendingHiddenTurn(false);
      return;
    }

    setConfirmedLive(sessionSnapshot?.isLive === true ? true : null);
    let cancelled = false;

    api.liveSession(id)
      .then((response) => {
        if (cancelled) {
          return;
        }

        setConfirmedLive(response.live);
        setLiveSessionHasPendingHiddenTurn(response.live && response.hasPendingHiddenTurn === true);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('404 ') || sessionsLoaded && sessionSnapshot?.isLive !== true) {
          setConfirmedLive(false);
        }
        setLiveSessionHasPendingHiddenTurn(false);
      });

    return () => {
      cancelled = true;
    };
  }, [desktopConversationChecking, useDesktopConversation, visibleConversationBootstrap?.liveSession, id, sessionSnapshot, sessionsLoaded]);

  const isLiveSession = resolveConversationLiveSession({
    streamBlockCount: stream.blocks.length,
    isStreaming: stream.isStreaming,
    confirmedLive: useDesktopConversation ? confirmedLiveValue : confirmedLive,
  });
  const conversationLiveDecision = visibleConversationBootstrap?.liveSession.live
    ?? sessionSnapshot?.isLive
    ?? (useDesktopConversation ? confirmedLiveValue : confirmedLive);
  const conversationNeedsTakeover = false;
  const allowQueuedPrompts = stream.isStreaming || liveSessionHasPendingHiddenTurn;
  const defaultComposerBehavior = stream.isStreaming
    ? 'steer'
    : liveSessionHasPendingHiddenTurn
      ? 'followUp'
      : undefined;

  useEffect(() => {
    setHistoricalTailBlocks(INITIAL_HISTORICAL_TAIL_BLOCKS);
    setInitialHistoricalWarmupConversationId(draft || !id ? null : id);
  }, [draft, id]);

  // ── Existing session data (read-only JSONL) ───────────────────────────────
  useEffect(() => {
    if (useDesktopConversation || !id || !bootstrapSessionDetail) {
      return;
    }

    primeSessionDetailCache(id, bootstrapSessionDetail, { tailBlocks: historicalTailBlocks }, effectiveConversationEventVersion);
  }, [bootstrapSessionDetail, effectiveConversationEventVersion, historicalTailBlocks, id, useDesktopConversation]);

  const bootstrapPendingInitialSessionDetail = !useDesktopConversation
    && Boolean(id)
    && conversationBootstrapLoading
    && !bootstrapSessionDetail;
  const { detail: webSessionDetail, loading: webSessionLoading, error: webSessionError } = useSessionDetail(
    bootstrapPendingInitialSessionDetail || useDesktopConversation || desktopConversationChecking ? undefined : id,
    {
      tailBlocks: historicalTailBlocks,
      version: effectiveConversationEventVersion,
    },
  );
  const sessionDetail = useDesktopConversation ? visibleDesktopConversationState?.sessionDetail ?? null : webSessionDetail;
  const sessionLoading = useDesktopConversation
    ? desktopConversation.loading
    : (desktopConversationChecking ? true : webSessionLoading);
  const sessionError = useDesktopConversation ? desktopConversation.error : (desktopConversationChecking ? null : webSessionError);
  const visibleSessionDetail = useDesktopConversation
    ? sessionDetail
    : (sessionDetail?.meta.id === id
        ? sessionDetail
        : bootstrapSessionDetail);
  const [hydratedHistoricalBlocks, setHydratedHistoricalBlocks] = useState<Record<string, MessageBlock>>({});
  const [hydratingHistoricalBlockIds, setHydratingHistoricalBlockIds] = useState<string[]>([]);
  const hydratingHistoricalBlockIdSet = useMemo(
    () => new Set(hydratingHistoricalBlockIds),
    [hydratingHistoricalBlockIds],
  );

  useEffect(() => {
    setHydratedHistoricalBlocks({});
    setHydratingHistoricalBlockIds([]);
    setRequestedFocusMessageIndex(null);
    pendingJumpMessageIndexRef.current = null;
  }, [id]);

  const hydrateHistoricalBlock = useCallback(async (blockId: string) => {
    const normalizedBlockId = blockId.trim();
    if (!id || normalizedBlockId.length === 0 || hydratingHistoricalBlockIdSet.has(normalizedBlockId)) {
      return;
    }

    setHydratingHistoricalBlockIds((current) => current.includes(normalizedBlockId)
      ? current
      : [...current, normalizedBlockId]);

    try {
      const block = await api.sessionBlock(id, normalizedBlockId);
      const messageBlock = displayBlockToMessageBlock(block);
      setHydratedHistoricalBlocks((current) => ({
        ...current,
        [normalizedBlockId]: messageBlock,
      }));
    } catch (error) {
      console.error('Failed to hydrate historical block', error);
    } finally {
      setHydratingHistoricalBlockIds((current) => current.filter((candidate) => candidate !== normalizedBlockId));
    }
  }, [hydratingHistoricalBlockIdSet, id]);

  // Historical messages from the JSONL snapshot (doesn't update after load).
  // Memoize the conversion so typing in the composer does not rebuild long transcripts.
  const baseMessages = useMemo<MessageBlock[]>(() => (
    visibleSessionDetail
      ? visibleSessionDetail.blocks.map((block) => {
          const hydrated = hydratedHistoricalBlocks[block.id];
          return hydrated ?? displayBlockToMessageBlock(block);
        })
      : []
  ), [hydratedHistoricalBlocks, visibleSessionDetail]);
  const visibleStreamBlocks = useMemo<MessageBlock[]>(() => (
    stream.blocks.map((block) => {
      const normalizedId = block.id?.trim();
      return normalizedId ? (hydratedHistoricalBlocks[normalizedId] ?? block) : block;
    })
  ), [hydratedHistoricalBlocks, stream.blocks]);

  // Pending steer/followup queue as reported by the live session.
  const pendingQueue = useMemo(() => {
    const steeringQueue = normalizePendingQueueItems(stream.pendingQueue?.steering);
    const followUpQueue = normalizePendingQueueItems(stream.pendingQueue?.followUp);

    return [
      ...steeringQueue.map((item, index) => ({
        id: item.id,
        text: item.text,
        imageCount: item.imageCount,
        restorable: item.restorable !== false,
        type: 'steer' as const,
        queueIndex: index,
      })),
      ...followUpQueue.map((item, index) => ({
        id: item.id,
        text: item.text,
        imageCount: item.imageCount,
        restorable: item.restorable !== false,
        type: 'followUp' as const,
        queueIndex: index,
      })),
    ];
  }, [stream.pendingQueue?.followUp, stream.pendingQueue?.steering]);
  const parallelJobs = useMemo(() => Array.isArray(stream.parallelJobs) ? stream.parallelJobs : [], [stream.parallelJobs]);

  // Live sessions hydrate from the SSE snapshot; until that arrives, fall back to
  // JSONL + live deltas only when we have at least one source of blocks.
  const computedMessages = useMemo<MessageBlock[] | undefined>(() => {
    if (draft) {
      return appendPendingInitialPromptBlock(undefined, draftPendingPrompt);
    }

    if (isLiveSession) {
      const liveMessages = stream.hasSnapshot
        ? visibleStreamBlocks
        : ((baseMessages.length > 0 || visibleStreamBlocks.length > 0)
            ? [...baseMessages, ...visibleStreamBlocks]
            : undefined);
      return appendPendingInitialPromptBlock(liveMessages, pendingInitialPrompt);
    }

    return visibleSessionDetail ? baseMessages : undefined;
  }, [baseMessages, draft, draftPendingPrompt, isLiveSession, pendingInitialPrompt, stream.hasSnapshot, visibleSessionDetail, visibleStreamBlocks]);
  const computedHistoricalBlockOffset = stream.hasSnapshot
    ? stream.blockOffset
    : (visibleSessionDetail?.blockOffset ?? 0);
  const computedHistoricalTotalBlocks = stream.hasSnapshot
    ? stream.totalBlocks
    : (visibleSessionDetail?.totalBlocks ?? computedMessages?.length ?? 0);
  const [stableTranscriptState, setStableTranscriptState] = useState<{
    conversationId: string;
    messages: MessageBlock[];
    historicalBlockOffset: number;
    historicalTotalBlocks: number;
  } | null>(null);

  useEffect(() => {
    if (!id || !computedMessages || computedMessages.length === 0) {
      return;
    }

    setStableTranscriptState((current) => {
      if (
        current
        && current.conversationId === id
        && current.messages === computedMessages
        && current.historicalBlockOffset === computedHistoricalBlockOffset
        && current.historicalTotalBlocks === computedHistoricalTotalBlocks
      ) {
        return current;
      }

      return {
        conversationId: id,
        messages: computedMessages,
        historicalBlockOffset: computedHistoricalBlockOffset,
        historicalTotalBlocks: computedHistoricalTotalBlocks,
      };
    });
  }, [computedHistoricalBlockOffset, computedHistoricalTotalBlocks, computedMessages, id]);

  const preservedTranscriptState = id && stableTranscriptState?.conversationId === id
    ? stableTranscriptState
    : null;
  const realMessages = computedMessages && computedMessages.length > 0
    ? computedMessages
    : preservedTranscriptState?.messages;
  const historicalBlockOffset = computedMessages && computedMessages.length > 0
    ? computedHistoricalBlockOffset
    : (preservedTranscriptState?.historicalBlockOffset ?? computedHistoricalBlockOffset);
  const historicalTotalBlocks = computedMessages && computedMessages.length > 0
    ? computedHistoricalTotalBlocks
    : (preservedTranscriptState?.historicalTotalBlocks ?? computedHistoricalTotalBlocks);
  const knownHistoricalTotalBlocks = Math.max(historicalTotalBlocks, sessionSnapshot?.messageCount ?? 0);
  const historicalHasOlderBlocks = historicalBlockOffset > 0;
  const knownHistoricalHasOlderBlocks = knownHistoricalTotalBlocks > historicalTailBlocks;
  const initialHistoricalWarmupActive = Boolean(id) && initialHistoricalWarmupConversationId === id;
  const initialHistoricalWarmupTarget = resolveConversationInitialHistoricalWarmupTarget({
    draft,
    conversationId: initialHistoricalWarmupActive ? id : null,
    liveDecision: conversationLiveDecision,
    historicalTotalBlocks: knownHistoricalTotalBlocks,
    historicalHasOlderBlocks: historicalHasOlderBlocks || knownHistoricalHasOlderBlocks,
  });
  const initialHistoricalWarmupTailLoaded = hasConversationLoadedHistoricalTailBlocks(
    visibleSessionDetail,
    initialHistoricalWarmupTarget,
  );
  const showHistoricalLoadMore = historicalHasOlderBlocks;
  const messageIndexOffset = historicalBlockOffset;
  const messageCount = realMessages?.length ?? 0;
  const hasRenderableMessages = messageCount > 0;
  const initialScrollKey = useMemo(() => getConversationInitialScrollKey(id ?? null, {
    isLiveSession,
    hasLiveSnapshot: stream.hasSnapshot,
  }), [id, isLiveSession, stream.hasSnapshot]);
  const hydratingLiveConversation = isLiveSession
    && !stream.hasSnapshot
    && !visibleSessionDetail
    && stream.blocks.length === 0;
  const showBootstrapLoadingState = shouldShowConversationBootstrapLoadingState({
    draft,
    conversationId: id,
    conversationBootstrapLoading,
    hasRenderableMessages,
    hasVisibleSessionDetail: Boolean(visibleSessionDetail),
  });
  const showConversationLoadingState = showBootstrapLoadingState
    || (!hasRenderableMessages && (sessionLoading || hydratingLiveConversation));
  const scrollBinding = resolveConversationVisibleScrollBinding({
    draft,
    routeConversationId: id,
    realMessages,
    stableTranscriptState,
    showConversationLoadingState,
    initialScrollKey,
    isStreaming: stream.isStreaming,
  });
  const pendingAskUserQuestion = useMemo(
    () => findPendingAskUserQuestion(realMessages),
    [realMessages],
  );
  const pendingAskUserQuestionKey = useMemo(() => {
    if (!pendingAskUserQuestion) {
      return '';
    }

    const blockKey = pendingAskUserQuestion.block.id ?? `${pendingAskUserQuestion.messageIndex}`;
    const questionKey = pendingAskUserQuestion.presentation.questions.map((question) => question.id).join('|');
    return `${blockKey}:${questionKey}`;
  }, [pendingAskUserQuestion]);
  const [composerQuestionIndex, setComposerQuestionIndex] = useState(0);
  const [composerQuestionOptionIndex, setComposerQuestionOptionIndex] = useState(0);
  const [composerQuestionAnswers, setComposerQuestionAnswers] = useState<AskUserQuestionAnswers>({});
  const [composerQuestionSubmitting, setComposerQuestionSubmitting] = useState(false);
  const artifactAutoOpenSeededRef = useRef(false);
  const artifactAutoOpenStartedAtRef = useRef(new Date().toISOString());
  const processedArtifactAutoOpenIdsRef = useRef<Set<string>>(new Set());
  const checkpointAutoOpenSeededRef = useRef(false);
  const checkpointAutoOpenStartedAtRef = useRef(new Date().toISOString());
  const processedCheckpointAutoOpenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    artifactAutoOpenSeededRef.current = false;
    artifactAutoOpenStartedAtRef.current = new Date().toISOString();
    processedArtifactAutoOpenIdsRef.current = new Set();
    checkpointAutoOpenSeededRef.current = false;
    checkpointAutoOpenStartedAtRef.current = new Date().toISOString();
    processedCheckpointAutoOpenIdsRef.current = new Set();
  }, [id]);

  useEffect(() => {
    if (!realMessages) {
      return;
    }

    if (!artifactAutoOpenSeededRef.current) {
      const completedArtifactIds = new Set<string>();
      for (const [index, block] of realMessages.entries()) {
        if (block.type !== 'tool_use') {
          continue;
        }

        const artifact = readArtifactPresentation(block);
        const blockKey = block._toolCallId ?? block.id ?? `artifact-${index}`;
        if (artifact && block.status !== 'running' && !block.running) {
          completedArtifactIds.add(blockKey);
        }
      }

      processedArtifactAutoOpenIdsRef.current = completedArtifactIds;
      artifactAutoOpenSeededRef.current = true;
      return;
    }

    for (let index = realMessages.length - 1; index >= 0; index -= 1) {
      const block = realMessages[index];
      if (block?.type !== 'tool_use') {
        continue;
      }

      const artifact = readArtifactPresentation(block);
      if (!artifact || !artifact.openRequested || block.status === 'running' || block.running) {
        continue;
      }

      const blockKey = block._toolCallId ?? block.id ?? `artifact-${index}`;
      if (processedArtifactAutoOpenIdsRef.current.has(blockKey)) {
        continue;
      }

      processedArtifactAutoOpenIdsRef.current.add(blockKey);

      const artifactCreatedAt = Date.parse(block.ts);
      const autoOpenStartedAt = Date.parse(artifactAutoOpenStartedAtRef.current);
      if (!Number.isFinite(artifactCreatedAt) || !Number.isFinite(autoOpenStartedAt) || artifactCreatedAt < autoOpenStartedAt) {
        continue;
      }

      openArtifact(artifact.artifactId);
      break;
    }
  }, [openArtifact, realMessages]);

  useEffect(() => {
    if (!realMessages) {
      return;
    }

    if (!checkpointAutoOpenSeededRef.current) {
      const completedCheckpointIds = new Set<string>();
      for (const [index, block] of realMessages.entries()) {
        if (block.type !== 'tool_use') {
          continue;
        }

        const checkpoint = readCheckpointPresentation(block);
        const blockKey = block._toolCallId ?? block.id ?? `checkpoint-${index}`;
        if (checkpoint && block.status !== 'running' && !block.running) {
          completedCheckpointIds.add(blockKey);
        }
      }

      processedCheckpointAutoOpenIdsRef.current = completedCheckpointIds;
      checkpointAutoOpenSeededRef.current = true;
      return;
    }

    for (let index = realMessages.length - 1; index >= 0; index -= 1) {
      const block = realMessages[index];
      if (block?.type !== 'tool_use') {
        continue;
      }

      const checkpoint = readCheckpointPresentation(block);
      if (!checkpoint || !checkpoint.openRequested || block.status === 'running' || block.running) {
        continue;
      }

      const blockKey = block._toolCallId ?? block.id ?? `checkpoint-${index}`;
      if (processedCheckpointAutoOpenIdsRef.current.has(blockKey)) {
        continue;
      }

      processedCheckpointAutoOpenIdsRef.current.add(blockKey);

      const checkpointCreatedAt = Date.parse(block.ts);
      const autoOpenStartedAt = Date.parse(checkpointAutoOpenStartedAtRef.current);
      if (!Number.isFinite(checkpointCreatedAt) || !Number.isFinite(autoOpenStartedAt) || checkpointCreatedAt < autoOpenStartedAt) {
        continue;
      }

      openCheckpoint(checkpoint.checkpointId);
      break;
    }
  }, [openCheckpoint, realMessages]);

  const { titles, setTitle: pushTitle } = useLiveTitles();

  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleSaving, setTitleSaving] = useState(false);
  const [summaryForkBusy, setSummaryForkBusy] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const conversationHeaderRef = useRef<HTMLDivElement>(null);
  const [conversationHeaderOffset, setConversationHeaderOffset] = useState(96);

  useEffect(() => {
    setTitleOverride(null);
    setIsEditingTitle(false);
    setTitleDraft('');
    setTitleSaving(false);
    setSummaryForkBusy(false);
    setConversationCwdEditorOpen(false);
    setConversationCwdDraft('');
    setConversationCwdPickBusy(false);
    setConversationCwdBusy(false);
    setConversationCwdError(null);
    setSavingPreference(null);
    setNotice(null);

    if (noticeTimeoutRef.current !== null) {
      window.clearTimeout(noticeTimeoutRef.current);
      noticeTimeoutRef.current = null;
    }
  }, [id]);

  const title = resolveConversationPageTitle({
    draft,
    titleOverride,
    streamTitle: stream.title,
    liveTitle: id ? titles.get(id) : undefined,
    detailTitle: visibleSessionDetail?.meta.title,
    sessionTitle: id ? sessions?.find((session) => session.id === id)?.title : undefined,
  });
  const model = visibleSessionDetail?.meta.model;

  useLayoutEffect(() => {
    const element = conversationHeaderRef.current;
    if (!element) {
      return;
    }

    const updateHeight = () => {
      const nextHeight = Math.max(0, Math.ceil(element.getBoundingClientRect().height));
      setConversationHeaderOffset((current) => current === nextHeight ? current : nextHeight);
    };

    updateHeight();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateHeight();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [draft, isEditingTitle, title, titleSaving]);

  useEffect(() => {
    const { normalizedTitle, shouldPushLiveTitle, nextSessions } = resolveConversationStreamTitleSync({
      draft,
      conversationId: id,
      streamTitle: stream.title,
      liveTitle: id ? titles.get(id) : undefined,
      sessions,
    });

    if (!normalizedTitle) {
      return;
    }

    if (shouldPushLiveTitle && id) {
      pushTitle(id, normalizedTitle);
    }

    if (nextSessions && nextSessions !== sessions) {
      setSessions(nextSessions);
    }
  }, [draft, id, pushTitle, sessions, setSessions, stream.title, titles]);

  const shouldLoadModels = shouldLoadConversationModels({
    draft,
    hasPendingInitialPrompt: Boolean(pendingInitialPrompt),
    hasPendingInitialPromptInFlight,
  });

  // Model
  const {
    models,
    defaultModel,
    defaultThinkingLevel,
    defaultServiceTier,
  } = useModels(shouldLoadModels);
  const [currentModel, setCurrentModel] = useState<string>('');
  const [currentThinkingLevel, setCurrentThinkingLevel] = useState<string>('');
  const [currentServiceTier, setCurrentServiceTier] = useState<string>('');
  const [hasExplicitServiceTier, setHasExplicitServiceTier] = useState(false);
  const resolvedCurrentModelId = useMemo(() => resolveSelectableModelId({
    requestedModel: currentModel,
    defaultModel,
    models,
  }), [currentModel, defaultModel, models]);
  const createLiveSessionPreferenceInput = useMemo(() => ({
    ...(resolvedCurrentModelId ? { model: resolvedCurrentModelId } : {}),
    ...(currentThinkingLevel ? { thinkingLevel: currentThinkingLevel } : {}),
    ...buildConversationServiceTierPreferenceInput({ currentServiceTier, hasExplicitServiceTier }),
  }), [currentThinkingLevel, currentServiceTier, hasExplicitServiceTier, resolvedCurrentModelId]);
  const [conversationAutoModeState, setConversationAutoModeState] = useState<ConversationAutoModeState | null>(null);
  const [conversationAutoModeBusy, setConversationAutoModeBusy] = useState(false);
  const initialModelPreferenceState = useMemo(() => resolveConversationInitialModelPreferenceState({
    draft,
    conversationId: id,
    locationState: location.state,
    defaultModel,
    defaultThinkingLevel,
    defaultServiceTier,
  }), [defaultModel, defaultThinkingLevel, defaultServiceTier, draft, id, location.state]);
  const initialDeferredResumeState = useMemo(() => resolveConversationInitialDeferredResumeState({
    draft,
    conversationId: id,
    locationState: location.state,
  }), [draft, id, location.state]);
  const initialDraftHydrationState = useMemo(() => resolveConversationDraftHydrationState({
    draft,
    conversationId: id,
    locationState: location.state,
  }), [draft, id, location.state]);
  const appliedInitialModelPreferenceLocationKeyRef = useRef<string | null>(null);
  const skippedInitialDeferredResumeLocationKeyRef = useRef<string | null>(null);
  const attemptedDeferredResumeAutoResumeKeyRef = useRef<string | null>(null);
  const appliedInitialDraftHydrationLocationKeyRef = useRef<string | null>(null);
  const appliedDraftAutoModeLocationKeyRef = useRef<string | null>(null);
  const [savedWorkspacePaths, setSavedWorkspacePaths] = useState<string[]>(() => readStoredWorkspacePaths());
  const [savedWorkspacePathsLoading, setSavedWorkspacePathsLoading] = useState(false);
  const [draftCwdValue, setDraftCwdValue] = useState('');
  const [draftCwdPickBusy, setDraftCwdPickBusy] = useState(false);
  const [draftCwdError, setDraftCwdError] = useState<string | null>(null);
  const [conversationCwdEditorOpen, setConversationCwdEditorOpen] = useState(false);
  const [conversationCwdDraft, setConversationCwdDraft] = useState('');
  const [conversationCwdPickBusy, setConversationCwdPickBusy] = useState(false);
  const [conversationCwdBusy, setConversationCwdBusy] = useState(false);
  const [conversationCwdError, setConversationCwdError] = useState<string | null>(null);

  useEffect(() => {
    if (!getDesktopBridge()) {
      return;
    }

    let cancelled = false;
    const clearRemoteOperationStatus = (delayMs = 1800) => {
      if (remoteOperationStatusClearTimeoutRef.current !== null) {
        window.clearTimeout(remoteOperationStatusClearTimeoutRef.current);
        remoteOperationStatusClearTimeoutRef.current = null;
      }
      remoteOperationStatusClearTimeoutRef.current = window.setTimeout(() => {
        if (!cancelled) {
          setRemoteOperationStatus(null);
        }
        remoteOperationStatusClearTimeoutRef.current = null;
      }, delayMs);
    };

    let unsubscribeRemoteOperations: (() => void) | null = null;
    void subscribeDesktopRemoteOperations({
      onevent: (event) => {
        if (event.hostId !== selectedExecutionTargetId || !selectedExecutionTargetIsRemote) {
          return;
        }
        if (event.scope === 'directory' && !remoteDirectoryBrowserState) {
          return;
        }
        if (event.scope === 'runtime' && !draft && id && event.conversationId && event.conversationId !== id && !continueInBusy && !conversationCwdBusy) {
          return;
        }

        if (remoteOperationStatusClearTimeoutRef.current !== null) {
          window.clearTimeout(remoteOperationStatusClearTimeoutRef.current);
          remoteOperationStatusClearTimeoutRef.current = null;
        }

        setRemoteOperationStatus(event);
        if (event.status !== 'running') {
          clearRemoteOperationStatus();
        }
      },
      onclose: () => {
        if (remoteOperationStatusClearTimeoutRef.current !== null) {
          window.clearTimeout(remoteOperationStatusClearTimeoutRef.current);
          remoteOperationStatusClearTimeoutRef.current = null;
        }
      },
    }).then((cleanup) => {
      if (cancelled) {
        cleanup();
        return;
      }
      unsubscribeRemoteOperations = cleanup;
    }).catch(() => {
      // Ignore best-effort subscription failures in non-desktop test contexts.
    });

    return () => {
      cancelled = true;
      unsubscribeRemoteOperations?.();
      if (remoteOperationStatusClearTimeoutRef.current !== null) {
        window.clearTimeout(remoteOperationStatusClearTimeoutRef.current);
        remoteOperationStatusClearTimeoutRef.current = null;
      }
    };
  }, [continueInBusy, conversationCwdBusy, draft, id, remoteDirectoryBrowserState, selectedExecutionTargetId, selectedExecutionTargetIsRemote]);

  useEffect(() => {
    if (selectedExecutionTargetIsRemote) {
      return;
    }

    if (remoteOperationStatusClearTimeoutRef.current !== null) {
      window.clearTimeout(remoteOperationStatusClearTimeoutRef.current);
      remoteOperationStatusClearTimeoutRef.current = null;
    }
    setRemoteOperationStatus(null);
  }, [selectedExecutionTargetIsRemote]);

  const remoteOperationInlineStatus = remoteOperationStatus?.scope === 'directory'
    ? null
    : (remoteOperationStatus?.message
      ?? (continueInBusy
        ? `Preparing ${selectedExecutionTargetLabel}…`
        : (conversationCwdBusy && selectedExecutionTargetIsRemote
            ? `Switching directory on ${selectedExecutionTargetLabel}…`
            : null)));
  const remoteDirectoryStatusMessage = remoteOperationStatus?.scope === 'directory'
    ? remoteOperationStatus.message
    : (remoteDirectoryBrowserState && selectedExecutionTargetHost
        ? `Connecting to ${selectedExecutionTargetHost.label}…`
        : null);
  const remoteDirectoryStatusTone = remoteOperationStatus?.scope === 'directory' && remoteOperationStatus.status === 'error'
    ? 'danger'
    : 'accent';

  useEffect(() => {
    if (!draft) {
      setDraftCwdValue('');
      return;
    }

    const syncDraftPreferences = () => {
      const serviceTierState = resolveDraftConversationServiceTierState(
        readDraftConversationServiceTier(),
        defaultServiceTier,
      );
      setCurrentModel(resolveSelectableModelId({
        requestedModel: readDraftConversationModel(),
        defaultModel,
        models,
      }));
      setCurrentThinkingLevel(readDraftConversationThinkingLevel().trim() || defaultThinkingLevel);
      setCurrentServiceTier(serviceTierState.currentServiceTier);
      setHasExplicitServiceTier(serviceTierState.hasExplicitServiceTier);
      setDraftCwdValue(readDraftConversationCwd().trim());
    };

    syncDraftPreferences();
    window.addEventListener(DRAFT_CONVERSATION_STATE_CHANGED_EVENT, syncDraftPreferences);
    return () => {
      window.removeEventListener(DRAFT_CONVERSATION_STATE_CHANGED_EVENT, syncDraftPreferences);
    };
  }, [defaultModel, defaultThinkingLevel, defaultServiceTier, draft, models]);

  useEffect(() => {
    if (!draft || models.length === 0) {
      return;
    }

    const storedDraftModel = readDraftConversationModel();
    if (!storedDraftModel || hasSelectableModelId(models, storedDraftModel)) {
      return;
    }

    clearDraftConversationModel();
  }, [draft, models]);

  useEffect(() => {
    if (!draft) {
      setDraftCwdPickBusy(false);
      setDraftCwdError(null);
    }
  }, [draft]);

  useEffect(() => {
    if (draft) {
      return;
    }

    if (!id) {
      setCurrentModel(defaultModel);
      setCurrentThinkingLevel(defaultThinkingLevel);
      setCurrentServiceTier(defaultServiceTier);
      setHasExplicitServiceTier(false);
      return;
    }

    if (initialModelPreferenceState && appliedInitialModelPreferenceLocationKeyRef.current !== location.key) {
      appliedInitialModelPreferenceLocationKeyRef.current = location.key;
      setCurrentModel(initialModelPreferenceState.currentModel);
      setCurrentThinkingLevel(initialModelPreferenceState.currentThinkingLevel);
      setCurrentServiceTier(initialModelPreferenceState.currentServiceTier);
      setHasExplicitServiceTier(initialModelPreferenceState.hasExplicitServiceTier);
      return;
    }

    let cancelled = false;
    api.conversationModelPreferences(id)
      .then((data) => {
        if (cancelled) {
          return;
        }

        setCurrentModel(data.currentModel || defaultModel);
        setCurrentThinkingLevel(data.currentThinkingLevel ?? defaultThinkingLevel);
        setCurrentServiceTier(data.currentServiceTier ?? defaultServiceTier);
        setHasExplicitServiceTier(Boolean(data.hasExplicitServiceTier));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setCurrentModel(defaultModel);
        setCurrentThinkingLevel(defaultThinkingLevel);
        setCurrentServiceTier(defaultServiceTier);
        setHasExplicitServiceTier(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationEventVersion, defaultModel, defaultThinkingLevel, defaultServiceTier, draft, id, initialModelPreferenceState, location.key]);

  useEffect(() => {
    if (draft) {
      setConversationAutoModeState(null);
      setConversationAutoModeBusy(false);
      return;
    }

    if (!id) {
      setConversationAutoModeState({ enabled: false, stopReason: null, updatedAt: null });
      return;
    }

    let cancelled = false;
    api.conversationAutoMode(id)
      .then((data) => {
        if (!cancelled) {
          setConversationAutoModeState(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConversationAutoModeState({ enabled: false, stopReason: null, updatedAt: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationEventVersion, draft, id]);

  useEffect(() => {
    if (draft || !id || !initialDraftHydrationState) {
      return;
    }

    if (appliedInitialDraftHydrationLocationKeyRef.current === location.key) {
      return;
    }

    appliedInitialDraftHydrationLocationKeyRef.current = location.key;
    const storedAttachments = readDraftConversationAttachments();
    if (storedAttachments.images.length > 0) {
      setAttachments(storedAttachments.images.map((image, index) => {
        const extension = fileExtensionForMimeType(image.mimeType);
        const name = image.name?.trim() || `draft-image-${index + 1}.${extension}`;
        return base64ToFile(image.data, image.mimeType, name);
      }));
    }
    if (storedAttachments.drawings.length > 0) {
      setDrawingAttachments(storedAttachments.drawings);
    }
    clearDraftConversationAttachments();
  }, [draft, id, initialDraftHydrationState, location.key]);

  const effectiveConversationAutoModeState = stream.autoModeState ?? conversationAutoModeState;
  const conversationAutoModeEnabled = effectiveConversationAutoModeState?.enabled === true;

  // Current context usage (compaction-aware)
  const sessionTokens = useMemo(() => {
    if (isLiveSession) {
      const modelInfo = models.find(m => m.id === (stream.contextUsage?.modelId || currentModel || model));
      return {
        total: stream.contextUsage?.tokens ?? null,
        contextWindow: stream.contextUsage?.contextWindow ?? modelInfo?.context ?? 200_000,
        segments: stream.contextUsage?.segments,
      } satisfies TokenCounts;
    }

    if (!visibleSessionDetail) return undefined;

    const historicalUsage = visibleSessionDetail.contextUsage;
    const modelInfo = models.find(m => m.id === (historicalUsage?.modelId || currentModel || model));
    return {
      total: historicalUsage?.tokens ?? null,
      contextWindow: modelInfo?.context ?? 128_000,
      segments: historicalUsage?.segments,
    } satisfies TokenCounts;
  }, [isLiveSession, stream.contextUsage, visibleSessionDetail, models, currentModel, model]);

  const [liveSessionContext, setLiveSessionContext] = useState<LiveSessionContext | null>(null);

  const [notice, setNotice] = useState<{ tone: 'accent' | 'danger'; text: string } | null>(null);
  const [savingPreference, setSavingPreference] = useState<'model' | 'thinking' | 'serviceTier' | null>(null);
  const [modelIdx, setModelIdx] = useState(0);
  const noticeTimeoutRef = useRef<number | null>(null);
  const showNotice = useCallback((tone: 'accent' | 'danger', text: string, durationMs = 2500) => {
    setNotice({ tone, text });
    if (noticeTimeoutRef.current !== null) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimeoutRef.current = null;
    }, durationMs);
  }, []);

  const applyDraftExecutionTarget = useCallback(async (conversationId: string, cwd?: string | null) => {
    const hostId = draftExecutionTargetId.trim();
    if (!hostId || hostId === 'local') {
      return null;
    }

    return api.continueConversationInHost(conversationId, hostId, cwd);
  }, [draftExecutionTargetId]);

  const handleContinueConversationInHost = useCallback(async (hostId: string) => {
    if (hostId === selectedExecutionTargetId) {
      return;
    }

    if (!id) {
      setDraftExecutionTargetId(hostId);
      return;
    }

    if (continueInBusy) {
      return;
    }

    setContinueInBusy(true);
    try {
      const result = await api.continueConversationInHost(id, hostId);
      setConversationExecutionOverride(
        result.remoteHostId && result.remoteConversationId
          ? {
              remoteHostId: result.remoteHostId,
              remoteHostLabel: result.remoteHostLabel,
              remoteConversationId: result.remoteConversationId,
            }
          : null,
      );
      showNotice(
        'accent',
        result.remoteHostId
          ? `Continuing on ${result.remoteHostLabel ?? result.remoteHostId}.`
          : 'Continuing locally.',
        3000,
      );
      streamReconnect();
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setContinueInBusy(false);
    }
  }, [continueInBusy, id, selectedExecutionTargetId, showNotice, streamReconnect]);

  useEffect(() => {
    if (draft || !id || !initialDraftHydrationState?.enableAutoModeOnLoad) {
      return;
    }

    if (appliedDraftAutoModeLocationKeyRef.current === location.key) {
      return;
    }

    appliedDraftAutoModeLocationKeyRef.current = location.key;
    setConversationAutoModeBusy(true);
    api.updateConversationAutoMode(id, { enabled: true }, currentSurfaceId)
      .then((nextState) => {
        setConversationAutoModeState(nextState);
      })
      .catch((error) => {
        showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
      })
      .finally(() => {
        setConversationAutoModeBusy(false);
      });
  }, [currentSurfaceId, draft, id, initialDraftHydrationState, location.key, showNotice]);

  const ensureConversationCanControl = useCallback((_action: string): boolean => {
    return true;
  }, []);
  const composerDraftStorageKey = draft
    ? buildDraftConversationComposerStorageKey()
    : id
      ? buildConversationComposerStorageKey(id)
      : null;

  // Input state
  const [input, setInputState] = useReloadState<string>({
    storageKey: composerDraftStorageKey,
    initialValue: '',
    shouldPersist: (value) => value.length > 0,
  });
  const setInput = useCallback((next: string) => {
    if (draft) {
      persistDraftConversationComposer(next);
    } else if (id) {
      persistForkPromptDraft(id, next);
    }

    setInputState(next);
  }, [draft, id, setInputState]);
  const [debouncedRelatedThreadsQuery, setDebouncedRelatedThreadsQuery] = useState(() => input.trim());
  const [relatedThreadSearchIndex, setRelatedThreadSearchIndex] = useState<Record<string, string>>({});
  const [relatedThreadSearchLoading, setRelatedThreadSearchLoading] = useState(false);
  const [relatedThreadSearchError, setRelatedThreadSearchError] = useState<string | null>(null);
  const [selectedRelatedThreadIds, setSelectedRelatedThreadIds] = useState<string[]>([]);
  const [preparingRelatedThreadContext, setPreparingRelatedThreadContext] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [screenshotCaptureBusy, setScreenshotCaptureBusy] = useState(false);
  const [drawingAttachments, setDrawingAttachments] = useState<ComposerDrawingAttachment[]>([]);
  const [editingDrawingLocalId, setEditingDrawingLocalId] = useState<string | null>(null);
  const [drawingsPickerOpen, setDrawingsPickerOpen] = useState(false);
  const [conversationAttachments, setConversationAttachments] = useState<ConversationAttachmentSummary[]>([]);
  const [attachedContextDocs, setAttachedContextDocs] = useState<ConversationContextDocRef[]>([]);
  const [contextDocsBusy, setContextDocsBusy] = useState(false);
  const [drawingsBusy, setDrawingsBusy] = useState(false);
  const [drawingsError, setDrawingsError] = useState<string | null>(null);
  const [composerAltHeld, setComposerAltHeld] = useState(false);
  const [composerParallelHeld, setComposerParallelHeld] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const composerHistoryScopeId = draft ? null : id ?? null;
  const [composerHistory, setComposerHistory] = useState<string[]>(() => readComposerHistory(composerHistoryScopeId));
  const [composerHistoryIndex, setComposerHistoryIndex] = useState<number | null>(null);
  const composerHistoryDraftRef = useRef('');
  const composerAttachmentScopeKey = draft ? 'draft' : (id ? `conversation:${id}` : null);
  const composerAttachmentsHydratedRef = useRef(false);
  const lastComposerAttachmentScopeKeyRef = useRef<string | null>(composerAttachmentScopeKey);

  if (lastComposerAttachmentScopeKeyRef.current !== composerAttachmentScopeKey) {
    lastComposerAttachmentScopeKeyRef.current = composerAttachmentScopeKey;
    composerAttachmentsHydratedRef.current = false;
  }

  useLayoutEffect(() => {
    const storedAttachments = draft
      ? readDraftConversationAttachments()
      : (id ? readConversationAttachments(id) : { images: [], drawings: [] });
    const fallbackNamePrefix = draft
      ? 'draft-image'
      : (id ? `conversation-${id}-image` : 'conversation-image');

    setAttachments(restoreComposerImageFiles(storedAttachments.images, fallbackNamePrefix));
    setDrawingAttachments(storedAttachments.drawings);
    setEditingDrawingLocalId(null);
    setDrawingsPickerOpen(false);
    setConversationAttachments([]);
    setAttachedContextDocs(draft ? readDraftConversationContextDocs() : []);
    setDrawingsError(null);
    setDragOver(false);
    setSlashIdx(0);
    setMentionIdx(0);
    composerAttachmentsHydratedRef.current = true;
  }, [draft, id]);

  // Track keyboard open/close via visualViewport (mobile keyboard)
  useEffect(() => {
    const syncKeyboardInset = () => {
      const visualViewport = window.visualViewport;
      if (!visualViewport) {
        setKeyboardInset(0);
        return;
      }

      const nextInset = Math.max(
        0,
        Math.round(window.innerHeight - (visualViewport.height + visualViewport.offsetTop)),
      );
      setKeyboardInset((current) => (current === nextInset ? current : nextInset));
    };

    syncKeyboardInset();
    window.addEventListener('resize', syncKeyboardInset);
    window.visualViewport?.addEventListener('resize', syncKeyboardInset);
    window.visualViewport?.addEventListener('scroll', syncKeyboardInset);

    return () => {
      window.removeEventListener('resize', syncKeyboardInset);
      window.visualViewport?.removeEventListener('resize', syncKeyboardInset);
      window.visualViewport?.removeEventListener('scroll', syncKeyboardInset);
    };
  }, []);

  useEffect(() => {
    if (!composerAttachmentsHydratedRef.current || (!draft && !id)) {
      return;
    }

    const mutationVersion = beginDraftConversationAttachmentsMutation();

    void buildPromptImages(attachments)
      .then((images) => {
        if (!isDraftConversationAttachmentsMutationCurrent(mutationVersion)) {
          return;
        }

        const nextAttachments = {
          images,
          drawings: drawingAttachments,
        };

        if (draft) {
          persistDraftConversationAttachments(nextAttachments);
          return;
        }

        if (id) {
          persistConversationAttachments(id, nextAttachments);
        }
      })
      .catch(() => {
        // Ignore composer attachment persistence failures.
      });
  }, [attachments, draft, drawingAttachments, id]);

  useEffect(() => {
    function handleModifierChange(event: KeyboardEvent) {
      setComposerAltHeld(event.altKey);
      setComposerParallelHeld(event.ctrlKey || event.metaKey);
    }

    function resetModifierState() {
      setComposerAltHeld(false);
      setComposerParallelHeld(false);
    }

    window.addEventListener('keydown', handleModifierChange);
    window.addEventListener('keyup', handleModifierChange);
    window.addEventListener('blur', resetModifierState);

    return () => {
      window.removeEventListener('keydown', handleModifierChange);
      window.removeEventListener('keyup', handleModifierChange);
      window.removeEventListener('blur', resetModifierState);
    };
  }, []);

  useEffect(() => {
    setComposerHistory(readComposerHistory(composerHistoryScopeId));
    setComposerHistoryIndex(null);
    composerHistoryDraftRef.current = '';
  }, [composerHistoryScopeId]);

  useEffect(() => {
    if (composerHistoryIndex === null) {
      return;
    }

    if (input === composerHistory[composerHistoryIndex]) {
      return;
    }

    setComposerHistoryIndex(null);
    composerHistoryDraftRef.current = '';
  }, [composerHistory, composerHistoryIndex, input]);

  const restoreComposerDraft = useCallback(async (
    nextInput: string,
    nextAttachments: File[],
    nextDrawingAttachments: ComposerDrawingAttachment[],
  ) => {
    try {
      const images = await buildPromptImages(nextAttachments);
      const persistedAttachments = {
        images,
        drawings: nextDrawingAttachments,
      };

      if (draft) {
        persistDraftConversationAttachments(persistedAttachments);
      } else if (id) {
        if (nextAttachments.length === 0 && nextDrawingAttachments.length === 0) {
          clearConversationAttachments(id);
        } else {
          persistConversationAttachments(id, persistedAttachments);
        }
      }
    } catch {
      // Ignore composer attachment draft restoration failures.
    }

    setInput(nextInput);
    setAttachments(nextAttachments);
    setDrawingAttachments(nextDrawingAttachments);
  }, [draft, id, setInput]);

  useEffect(() => {
    if (draft || !id) {
      setPendingInitialPrompt(null);
      setPendingInitialPromptDispatchingState(false);
      pendingInitialPromptSessionIdRef.current = null;
      pendingInitialPromptFailureSessionIdRef.current = null;
      pinnedInitialPromptScrollSessionIdRef.current = null;
      pinnedInitialPromptTailKeyRef.current = null;
      return;
    }

    setPendingInitialPrompt(readPendingConversationPrompt(id));
    setPendingInitialPromptDispatchingState(isPendingConversationPromptDispatching(id));
    pendingInitialPromptSessionIdRef.current = null;
    pendingInitialPromptFailureSessionIdRef.current = null;
    pinnedInitialPromptScrollSessionIdRef.current = null;
    pinnedInitialPromptTailKeyRef.current = null;
  }, [draft, id]);

  useEffect(() => {
    if (draft || !id || typeof window === 'undefined') {
      return;
    }

    const handlePendingPromptChange = (event: Event) => {
      const detail = (event as CustomEvent<PendingConversationPromptChangedDetail>).detail;
      if (!detail || detail.sessionId !== id) {
        return;
      }

      setPendingInitialPrompt(detail.prompt);
      setPendingInitialPromptDispatchingState(detail.dispatching);
    };

    window.addEventListener(PENDING_CONVERSATION_PROMPT_CHANGED_EVENT, handlePendingPromptChange);
    return () => {
      window.removeEventListener(PENDING_CONVERSATION_PROMPT_CHANGED_EVENT, handlePendingPromptChange);
    };
  }, [draft, id]);

  useEffect(() => {
    if (
      draft
      || !id
      || !pendingInitialPrompt
      || !pendingInitialPromptDispatching
      || !hasConversationTranscriptAcceptedPendingInitialPrompt({
        messages: realMessages,
        prompt: pendingInitialPrompt,
      })
    ) {
      return;
    }

    clearPendingConversationPrompt(id);
    setPendingConversationPromptDispatching(id, false);
    setPendingInitialPrompt(null);
    setPendingInitialPromptDispatchingState(false);
  }, [draft, id, pendingInitialPrompt, pendingInitialPromptDispatching, realMessages]);

  useEffect(() => {
    if (!id || !pendingInitialPrompt) {
      pendingInitialPromptFailureSessionIdRef.current = null;
    }
  }, [id, pendingInitialPrompt]);

  useEffect(() => {
    if (!draft) {
      setDraftPendingPrompt(null);
    }
  }, [draft, id]);

  const [pendingAssistantStatusLabel, setPendingAssistantStatusLabel] = useState<string | null>(null);
  const [wholeLineBashRunning, setWholeLineBashRunning] = useState(false);
  const wholeLineBashRunningRef = useRef(false);
  const [showBackgroundRunDetails, setShowBackgroundRunDetails] = useState(false);

  useEffect(() => {
    setPendingAssistantStatusLabel(null);
    setShowBackgroundRunDetails(false);
  }, [id]);

  useEffect(() => {
    if (!stream.isStreaming) {
      return;
    }

    setPendingAssistantStatusLabel(null);
  }, [stream.isStreaming]);

  const prevStreamingRef = useRef(false);
  const autocompleteCatalogDemand = useMemo(
    () => resolveConversationAutocompleteCatalogDemand(input),
    [input],
  );
  const [shouldLoadMemoryData, setShouldLoadMemoryData] = useState(() => autocompleteCatalogDemand.needsMemoryData);
  const [shouldLoadVaultFiles, setShouldLoadVaultFiles] = useState(() => autocompleteCatalogDemand.needsVaultFiles);
  const [memoryData, setMemoryData] = useState<MemoryData | null>(null);
  const [vaultFilesData, setVaultFilesData] = useState<VaultFileListResult | null>(null);
  const requestedMemoryDataRef = useRef(false);
  const requestedVaultFilesRef = useRef(false);
  const conversationRunId = useMemo(() => (id ? createConversationLiveRunId(id) : null), [id]);
  const [conversationRun, setConversationRun] = useState<DurableRunRecord | null>(null);
  const [resumeConversationBusy, setResumeConversationBusy] = useState(false);
  const [deferredResumes, setDeferredResumes] = useState<DeferredResumeSummary[]>([]);
  const [deferredResumesBusy, setDeferredResumesBusy] = useState(false);
  const [showDeferredResumeDetails, setShowDeferredResumeDetails] = useState(false);
  const [deferredResumeNowMs, setDeferredResumeNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (draft || runs !== null) {
      return;
    }

    let cancelled = false;
    void api.runs()
      .then((result) => {
        if (!cancelled) {
          setRuns(result);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [draft, runs, setRuns]);

  useEffect(() => {
    if (autocompleteCatalogDemand.needsMemoryData) {
      setShouldLoadMemoryData(true);
    }
    if (autocompleteCatalogDemand.needsVaultFiles) {
      setShouldLoadVaultFiles(true);
    }
  }, [autocompleteCatalogDemand.needsMemoryData, autocompleteCatalogDemand.needsVaultFiles]);

  useEffect(() => {
    if (!shouldLoadMemoryData || requestedMemoryDataRef.current) {
      return;
    }

    requestedMemoryDataRef.current = true;
    let cancelled = false;

    api.memory()
      .then((data) => {
        if (!cancelled) {
          setMemoryData(data);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [shouldLoadMemoryData]);

  useEffect(() => {
    if (!shouldLoadVaultFiles || requestedVaultFilesRef.current) {
      return;
    }

    requestedVaultFilesRef.current = true;
    let cancelled = false;

    api.vaultFiles()
      .then((data) => {
        if (!cancelled) {
          setVaultFilesData(data);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [shouldLoadVaultFiles]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const composerResizeFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef   = useRef<HTMLDivElement>(null);
  const pendingJumpMessageIndexRef = useRef<number | null>(null);
  const [requestedFocusMessageIndex, setRequestedFocusMessageIndex] = useState<number | null>(null);

  useEffect(() => {
    setComposerQuestionIndex(0);
    setComposerQuestionOptionIndex(0);
    setComposerQuestionAnswers({});
    setComposerQuestionSubmitting(false);
  }, [pendingAskUserQuestionKey]);

  const composerActiveQuestion = pendingAskUserQuestion?.presentation.questions[
    Math.max(0, Math.min(composerQuestionIndex, (pendingAskUserQuestion?.presentation.questions.length ?? 1) - 1))
  ] ?? null;

  useEffect(() => {
    if (!composerActiveQuestion) {
      setComposerQuestionOptionIndex(0);
      return;
    }

    setComposerQuestionOptionIndex(resolveAskUserQuestionDefaultOptionIndex(composerActiveQuestion, composerQuestionAnswers));
  }, [composerActiveQuestion, composerQuestionAnswers]);

  const {
    atBottom,
    syncScrollStateFromDom,
    scrollToBottom,
    capturePrependRestore,
  } = useConversationScroll({
    conversationId: scrollBinding.conversationId,
    messages: scrollBinding.messages,
    scrollRef,
    sessionLoading,
    isStreaming: scrollBinding.isStreaming,
    initialScrollKey: scrollBinding.initialScrollKey,
    prependRestoreKey: historicalBlockOffset,
  });
  const showInitialHistoricalWarmupLoader = shouldShowConversationInitialHistoricalWarmupLoader({
    warmupActive: initialHistoricalWarmupActive,
    targetTailBlocks: initialHistoricalWarmupTarget,
    currentTailBlocks: historicalTailBlocks,
    loadedTailBlocks: initialHistoricalWarmupTailLoaded,
  });
  const previousInitialHistoricalWarmupLoaderRef = useRef(false);

  useEffect(() => {
    if (!initialHistoricalWarmupActive || !id) {
      return;
    }

    if (conversationLiveDecision === true || knownHistoricalTotalBlocks <= 0) {
      setInitialHistoricalWarmupConversationId(null);
      return;
    }

    if (!historicalHasOlderBlocks && !knownHistoricalHasOlderBlocks) {
      if (conversationBootstrapLoading || sessionLoading) {
        return;
      }

      setInitialHistoricalWarmupConversationId(null);
      return;
    }

    if (conversationLiveDecision !== false || !initialHistoricalWarmupTarget) {
      return;
    }

    if (historicalTailBlocks < initialHistoricalWarmupTarget) {
      setHistoricalTailBlocks(initialHistoricalWarmupTarget);
      return;
    }

    if (!initialHistoricalWarmupTailLoaded) {
      return;
    }

    setInitialHistoricalWarmupConversationId(null);
  }, [
    conversationBootstrapLoading,
    conversationLiveDecision,
    historicalHasOlderBlocks,
    historicalTailBlocks,
    id,
    initialHistoricalWarmupActive,
    initialHistoricalWarmupTailLoaded,
    initialHistoricalWarmupTarget,
    knownHistoricalHasOlderBlocks,
    knownHistoricalTotalBlocks,
    sessionLoading,
  ]);

  useEffect(() => {
    previousInitialHistoricalWarmupLoaderRef.current = false;
  }, [id]);

  useEffect(() => {
    const wasLoading = previousInitialHistoricalWarmupLoaderRef.current;
    previousInitialHistoricalWarmupLoaderRef.current = showInitialHistoricalWarmupLoader;

    if (!wasLoading || showInitialHistoricalWarmupLoader || !id || !realMessages?.length) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      scrollToBottom();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [id, realMessages, scrollToBottom, showInitialHistoricalWarmupLoader]);

  const loadOlderMessages = useCallback((targetMessageIndex?: number, options?: { automatic?: boolean }) => {
    if (!id || sessionLoading || historicalTotalBlocks <= 0) {
      return;
    }

    if (options?.automatic && historicalTailBlocks >= Math.min(historicalTotalBlocks, MAX_AUTOMATIC_HISTORICAL_TAIL_BLOCKS)) {
      return;
    }

    const minimumTailBlocks = typeof targetMessageIndex === 'number'
      ? Math.max(
          historicalTailBlocks + HISTORICAL_TAIL_BLOCKS_STEP,
          historicalTotalBlocks - targetMessageIndex + HISTORICAL_TAIL_BLOCKS_JUMP_PADDING,
        )
      : historicalTailBlocks + HISTORICAL_TAIL_BLOCKS_STEP;
    const nextTailBlocks = Math.min(historicalTotalBlocks, minimumTailBlocks);

    if (nextTailBlocks <= historicalTailBlocks) {
      return;
    }

    if (targetMessageIndex === undefined) {
      capturePrependRestore();
    }

    setHistoricalTailBlocks(nextTailBlocks);
  }, [capturePrependRestore, historicalTailBlocks, historicalTotalBlocks, id, sessionLoading]);

  // Derive menu states
  const slashInput = useMemo(() => parseSlashInput(input), [input]);
  const showModelPicker = slashInput?.command === '/model' && input.startsWith('/model ');
  const mentionMatch  = input.match(/(^|.*\s)(@[\w./-]*)$/);
  const showSlash     = !!slashInput && input === slashInput.command && !showModelPicker;
  const showMention   = !!mentionMatch && !showSlash && !showModelPicker;
  const slashQuery    = slashInput?.command ?? '';
  const modelQuery    = showModelPicker ? slashInput?.argument ?? '' : '';
  const mentionQuery  = mentionMatch?.[2] ?? '';
  const slashItems = useMemo(() => buildSlashMenuItems(input, memoryData?.skills ?? []), [input, memoryData]);
  const modelItems = useMemo(() => filterModelPickerItems(models, modelQuery), [models, modelQuery]);
  const mentionItems = useMemo(() => buildMentionItems({
    tasks: tasks ?? [],
    memoryDocs: memoryData?.memoryDocs ?? [],
    vaultFiles: vaultFilesData?.files ?? [],
  }), [tasks, memoryData, vaultFilesData]);
  const currentSessionMeta = useMemo(
    () => mergeConversationSessionMeta(visibleSessionDetail?.meta, sessionSnapshot),
    [sessionSnapshot, visibleSessionDetail?.meta],
  );

  useEffect(() => {
    if (draft) {
      return;
    }

    setAttachedContextDocs(currentSessionMeta?.attachedContextDocs ?? []);
  }, [currentSessionMeta?.attachedContextDocs, draft, id]);
  const runLookups = useMemo<RunPresentationLookups>(() => ({ tasks, sessions }), [tasks, sessions]);
  const currentCwd = useMemo(
    () => draft
      ? (draftCwdValue || null)
      : (liveSessionContext?.cwd ?? currentSessionMeta?.cwd ?? null),
    [draft, draftCwdValue, liveSessionContext?.cwd, currentSessionMeta?.cwd],
  );
  const currentCwdLabel = useMemo(
    () => (currentCwd ? truncateConversationCwdFromFront(currentCwd) : ''),
    [currentCwd],
  );
  const hasDraftCwd = draftCwdValue.length > 0;
  const availableDraftWorkspacePaths = useMemo(
    () => normalizeWorkspacePaths(draftCwdValue ? [draftCwdValue, ...savedWorkspacePaths] : savedWorkspacePaths),
    [draftCwdValue, savedWorkspacePaths],
  );
  const relatedThreadCandidates = useMemo(
    () => draft
      ? selectRecentConversationCandidates(sessions, {
          workspaceCwd: draftCwdValue || null,
          recentWindowDays: RELATED_THREAD_RECENT_WINDOW_DAYS,
          limit: MAX_RELATED_THREAD_CANDIDATES,
          closedOnly: true,
        })
      : [],
    [draft, draftCwdValue, sessions],
  );
  const relatedThreadCandidateById = useMemo(
    () => new Map(relatedThreadCandidates.map((session) => [session.id, session] as const)),
    [relatedThreadCandidates],
  );
  const relatedThreadCandidateIds = useMemo(
    () => relatedThreadCandidates.map((session) => session.id),
    [relatedThreadCandidates],
  );
  const relatedThreadSearchResults = useMemo(
    () => rankRelatedConversationSessions({
      sessions: relatedThreadCandidates,
      searchIndex: relatedThreadSearchIndex,
      query: debouncedRelatedThreadsQuery,
      workspaceCwd: draftCwdValue || null,
      limit: MAX_VISIBLE_RELATED_THREAD_RESULTS,
    }),
    [debouncedRelatedThreadsQuery, draftCwdValue, relatedThreadCandidates, relatedThreadSearchIndex],
  );
  const recentClosedThreadResults = useMemo(
    () => listRecentConversationResults(relatedThreadCandidates, {
      workspaceCwd: draftCwdValue || null,
      recentWindowDays: null,
      limit: MAX_VISIBLE_RELATED_THREAD_RESULTS,
    }),
    [draftCwdValue, relatedThreadCandidates],
  );
  const visibleRelatedThreadResults = useMemo<RelatedConversationSearchResult[]>(() => {
    const baseResults = debouncedRelatedThreadsQuery.trim().length > 0
      ? relatedThreadSearchResults
      : recentClosedThreadResults;
    const results: RelatedConversationSearchResult[] = [];
    const seen = new Set<string>();

    for (const sessionId of selectedRelatedThreadIds) {
      if (seen.has(sessionId)) {
        continue;
      }

      const existing = baseResults.find((result) => result.sessionId === sessionId);
      if (existing) {
        results.push(existing);
        seen.add(sessionId);
        continue;
      }

      const session = relatedThreadCandidateById.get(sessionId);
      if (!session) {
        continue;
      }

      const normalizedSnippet = (relatedThreadSearchIndex[sessionId] ?? '').replace(/\s+/g, ' ').trim();
      const snippet = normalizedSnippet.length > 140
        ? `${normalizedSnippet.slice(0, 139).trimEnd()}…`
        : normalizedSnippet;
      results.push({
        sessionId,
        title: session.title,
        cwd: session.cwd,
        timestamp: session.lastActivityAt ?? session.timestamp,
        snippet,
        matchedTerms: [],
        score: Number.MAX_SAFE_INTEGER - results.length,
        sameWorkspace: Boolean(draftCwdValue && session.cwd === draftCwdValue),
      });
      seen.add(sessionId);
    }

    for (const result of baseResults) {
      if (seen.has(result.sessionId)) {
        continue;
      }

      results.push(result);
      seen.add(result.sessionId);
      if (results.length >= MAX_VISIBLE_RELATED_THREAD_RESULTS) {
        break;
      }
    }

    return results.slice(0, MAX_VISIBLE_RELATED_THREAD_RESULTS);
  }, [debouncedRelatedThreadsQuery, draftCwdValue, recentClosedThreadResults, relatedThreadCandidateById, relatedThreadSearchIndex, relatedThreadSearchResults, selectedRelatedThreadIds]);
  const toggleRelatedThreadSelection = useCallback((sessionId: string) => {
    setSelectedRelatedThreadIds((current) => {
      if (current.includes(sessionId)) {
        return current.filter((candidate) => candidate !== sessionId);
      }

      if (current.length >= MAX_RELATED_THREAD_SELECTIONS) {
        showNotice('danger', `Choose up to ${MAX_RELATED_THREAD_SELECTIONS} related threads.`, 2500);
        return current;
      }

      return [...current, sessionId];
    });
  }, [showNotice]);
  const branchLabel = liveSessionContext?.branch ?? null;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedRelatedThreadsQuery(input.trim());
    }, 180);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [input]);

  useEffect(() => {
    setSelectedRelatedThreadIds((current) => current.filter((sessionId) => relatedThreadCandidateById.has(sessionId)));
  }, [relatedThreadCandidateById]);

  useEffect(() => {
    if (!draft || preparingRelatedThreadContext || visibleRelatedThreadResults.length === 0) {
      return;
    }

    function handleRelatedThreadHotkey(event: KeyboardEvent) {
      if (event.defaultPrevented) {
        return;
      }

      const hotkeyIndex = resolveRelatedThreadHotkeyIndex(event);
      if (hotkeyIndex < 0 || hotkeyIndex >= Math.min(visibleRelatedThreadResults.length, MAX_RELATED_THREAD_HOTKEYS)) {
        return;
      }

      const result = visibleRelatedThreadResults[hotkeyIndex];
      if (!result) {
        return;
      }

      event.preventDefault();
      toggleRelatedThreadSelection(result.sessionId);
    }

    window.addEventListener('keydown', handleRelatedThreadHotkey);
    return () => {
      window.removeEventListener('keydown', handleRelatedThreadHotkey);
    };
  }, [draft, preparingRelatedThreadContext, toggleRelatedThreadSelection, visibleRelatedThreadResults]);

  useEffect(() => {
    if (!draft || (input.trim().length === 0 && selectedRelatedThreadIds.length === 0) || relatedThreadCandidateIds.length === 0) {
      setRelatedThreadSearchLoading(false);
      setRelatedThreadSearchError(null);
      return;
    }

    const missingSessionIds = relatedThreadCandidateIds.filter((sessionId) => relatedThreadSearchIndex[sessionId] === undefined);
    if (missingSessionIds.length === 0) {
      setRelatedThreadSearchLoading(false);
      setRelatedThreadSearchError(null);
      return;
    }

    let cancelled = false;
    setRelatedThreadSearchLoading(true);
    setRelatedThreadSearchError(null);

    api.sessionSearchIndex(missingSessionIds)
      .then((result) => {
        if (cancelled) {
          return;
        }

        setRelatedThreadSearchIndex((current) => ({
          ...current,
          ...result.index,
        }));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setRelatedThreadSearchError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setRelatedThreadSearchLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [draft, input, relatedThreadCandidateIds, relatedThreadSearchIndex, selectedRelatedThreadIds.length]);

  useEffect(() => {
    if (draft) {
      setConversationCwdEditorOpen(false);
      setConversationCwdDraft('');
      setConversationCwdPickBusy(false);
      setConversationCwdBusy(false);
      setConversationCwdError(null);
      return;
    }

    if (!conversationCwdEditorOpen) {
      setConversationCwdDraft(currentCwd ?? '');
    }
  }, [conversationCwdEditorOpen, currentCwd, draft]);
  const gitSummaryPresentation = useMemo(
    () => resolveConversationGitSummaryPresentation(liveSessionContext?.git ?? null),
    [liveSessionContext?.git],
  );
  const hasGitSummary = gitSummaryPresentation.kind !== 'none';
  const showExecutionTargetPicker = executionTargetOptions.length > 0;
  const showComposerMeta = showExecutionTargetPicker
    || Boolean(sessionTokens)
    || Boolean(draft ? draftCwdValue : (currentCwd || conversationCwdEditorOpen || conversationCwdError))
    || (!draft && (Boolean(branchLabel) || hasGitSummary));

  useEffect(() => {
    const nextSessions = replaceConversationTitleInSessionList(sessions, id, visibleSessionDetail?.meta.title);
    if (nextSessions && nextSessions !== sessions) {
      setSessions(nextSessions);
    }
  }, [id, sessions, setSessions, visibleSessionDetail?.meta.title]);

  useEffect(() => {
    if (!id) {
      setDeferredResumes([]);
      return;
    }

    if (currentSessionMeta?.id === id) {
      setDeferredResumes(currentSessionMeta.deferredResumes ?? []);
    }
  }, [currentSessionMeta, id]);

  const savedConversationSessionFile = currentSessionMeta?.file
    ?? visibleSessionDetail?.meta.file
    ?? null;
  const orderedDeferredResumes = useMemo(
    () => [...deferredResumes].sort(compareDeferredResumes),
    [deferredResumes],
  );
  const connectedBackgroundRuns = useMemo(() => {
    if (!id) {
      return [];
    }

    return listConnectedConversationBackgroundRuns({
      conversationId: id,
      runs,
      lookups: runLookups,
      excludeConversationRunId: conversationRunId,
    });
  }, [conversationRunId, id, runLookups, runs]);
  const activeConversationBackgroundRuns = useMemo(
    () => connectedBackgroundRuns.filter((run) => isRunActive(run)),
    [connectedBackgroundRuns],
  );
  const backgroundRunIndicatorText = useMemo(
    () => buildConversationBackgroundRunIndicatorText(activeConversationBackgroundRuns, runLookups),
    [activeConversationBackgroundRuns, runLookups],
  );
  const showActiveBackgroundRunDetails = showBackgroundRunDetails;
  const hasReadyDeferredResumes = orderedDeferredResumes.some((resume) => resume.status === 'ready');
  const deferredResumeAutoResumeKey = useMemo(
    () => buildDeferredResumeAutoResumeKey({
      resumes: orderedDeferredResumes,
      isLiveSession,
      sessionFile: savedConversationSessionFile,
    }),
    [isLiveSession, orderedDeferredResumes, savedConversationSessionFile],
  );
  const deferredResumeIndicatorText = useMemo(
    () => buildDeferredResumeIndicatorText(orderedDeferredResumes, deferredResumeNowMs),
    [orderedDeferredResumes, deferredResumeNowMs],
  );
  const lastConversationMessage = realMessages?.[realMessages.length - 1] ?? null;
  const lastCopyableAgentText = useMemo(() => {
    if (!realMessages) {
      return null;
    }

    for (let index = realMessages.length - 1; index >= 0; index -= 1) {
      const block = realMessages[index];
      if ((block.type === 'text' || block.type === 'summary') && block.text.trim().length > 0) {
        return block.text;
      }
    }

    return null;
  }, [realMessages]);
  const conversationResumeState = useMemo(() => getConversationResumeState({
    run: conversationRun,
    isLiveSession,
    lastMessage: lastConversationMessage,
  }), [conversationRun, isLiveSession, lastConversationMessage]);
  const draftMentionItems = useMemo(() => resolveMentionItems(input, mentionItems), [input, mentionItems]);
  const attachableDraftMentionItems = useMemo(
    () => draftMentionItems.filter((item): item is MentionItem & { path: string } => isAttachableMentionItem(item)),
    [draftMentionItems],
  );
  const attachedContextDocPathSet = useMemo(
    () => new Set(attachedContextDocs.map((doc) => doc.path)),
    [attachedContextDocs],
  );
  const unattachedDraftMentionItems = useMemo(
    () => attachableDraftMentionItems.filter((item) => !attachedContextDocPathSet.has(item.path)),
    [attachableDraftMentionItems, attachedContextDocPathSet],
  );
  const shouldLoadConversationRun = Boolean(conversationRunId)
    && !draft
    && !isLiveSession
    && (
      didConversationStopMidTurn(lastConversationMessage)
      || didConversationStopWithError(lastConversationMessage)
    );

  useEffect(() => {
    if (!conversationRunId || !shouldLoadConversationRun) {
      setConversationRun(null);
      return;
    }

    let cancelled = false;
    api.durableRun(conversationRunId)
      .then((data) => {
        if (!cancelled) {
          setConversationRun(data.run);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConversationRun(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationRunId, shouldLoadConversationRun, versions.runs]);

  const displayedPendingAssistantStatusLabel = resolveDisplayedConversationPendingStatusLabel({
    explicitLabel: pendingAssistantStatusLabel,
    draft,
    hasDraftPendingPrompt: Boolean(draftPendingPrompt),
    pendingPrompt: pendingInitialPrompt ?? draftPendingPrompt,
    isStreaming: stream.isStreaming,
    hasPendingInitialPrompt: Boolean(pendingInitialPrompt),
    hasPendingInitialPromptInFlight,
    isLiveSession,
    hasVisibleSessionDetail: Boolean(visibleSessionDetail),
  });
  const refetchConversationAttachments = useCallback(async () => {
    if (!id) {
      setConversationAttachments([]);
      return [] as ConversationAttachmentSummary[];
    }

    const data = await api.conversationAttachments(id);
    setConversationAttachments(data.attachments);
    return data.attachments;
  }, [id]);
  const shouldFetchConversationAttachmentsNow = shouldFetchConversationAttachments({
    draft,
    conversationId: id,
    drawingsPickerOpen,
  });

  const shouldFetchLiveSessionGitContext = shouldFetchConversationLiveSessionGitContext({
    draft,
    conversationId: id,
    conversationLiveDecision,
    conversationBootstrapLoading,
    sessionLoading,
    isStreaming: stream.isStreaming,
    hasPendingInitialPrompt: Boolean(pendingInitialPrompt),
    pendingInitialPromptDispatching,
    hasPendingInitialPromptInFlight,
  });

  const refetchDeferredResumes = useCallback(async () => {
    if (!id) {
      setDeferredResumes([]);
      return [] as DeferredResumeSummary[];
    }

    const data = await api.deferredResumes(id);
    setDeferredResumes(data.resumes);
    return data.resumes;
  }, [id]);

  const refetchLiveSessionContext = useCallback(async () => {
    if (draft || !id) {
      setLiveSessionContext(null);
      return null;
    }

    try {
      const next = await api.liveSessionContext(id);
      setLiveSessionContext(next);
      return next;
    } catch {
      setLiveSessionContext(null);
      return null;
    }
  }, [draft, id]);

  const refetchLiveSessionContextIfReady = useCallback(async () => {
    if (!shouldFetchLiveSessionGitContext && !liveSessionContext) {
      return null;
    }

    return refetchLiveSessionContext();
  }, [liveSessionContext, refetchLiveSessionContext, shouldFetchLiveSessionGitContext]);

  const syncSavedWorkspacePaths = useCallback((workspacePaths: string[]) => {
    const normalized = normalizeWorkspacePaths(workspacePaths);
    setSavedWorkspacePaths(normalized);
    writeStoredWorkspacePaths(normalized);
    return normalized;
  }, []);

  const refetchSavedWorkspacePaths = useCallback(async () => {
    if (!draft) {
      return [] as string[];
    }

    setSavedWorkspacePathsLoading(true);
    try {
      const workspacePaths = normalizeWorkspacePaths(await api.savedWorkspacePaths());
      syncSavedWorkspacePaths(workspacePaths);
      return workspacePaths;
    } catch {
      return [] as string[];
    } finally {
      setSavedWorkspacePathsLoading(false);
    }
  }, [draft, syncSavedWorkspacePaths]);

  useEffect(() => {
    if (!draft) {
      return;
    }

    void refetchSavedWorkspacePaths();
  }, [draft, refetchSavedWorkspacePaths]);

  useInvalidateOnTopics(['attachments'], refetchConversationAttachments);
  useInvalidateOnTopics(['workspace'], refetchLiveSessionContextIfReady);
  useInvalidateOnTopics(['workspace'], refetchSavedWorkspacePaths);

  const resumeDeferredConversation = useCallback(async () => {
    if (!id || !savedConversationSessionFile) {
      throw new Error('Open the saved conversation before continuing deferred work.');
    }

    const recovered = await api.recoverConversation(id);
    if (recovered.conversationId && recovered.conversationId !== id) {
      ensureConversationTabOpen(recovered.conversationId);
      navigate(`/conversations/${recovered.conversationId}`);
      return;
    }

    setConfirmedLive(true);
    stream.reconnect();
    window.setTimeout(() => {
      void refetchDeferredResumes().catch(() => {});
    }, 200);
  }, [id, navigate, refetchDeferredResumes, savedConversationSessionFile, stream.reconnect]);

  useEffect(() => {
    setConversationAttachments([]);
  }, [draft, id]);

  useEffect(() => {
    if (!shouldFetchConversationAttachmentsNow) {
      return;
    }

    setDrawingsError(null);
    void refetchConversationAttachments().catch((error) => {
      setDrawingsError(error instanceof Error ? error.message : String(error));
    });
  }, [refetchConversationAttachments, shouldFetchConversationAttachmentsNow]);

  useEffect(() => {
    if (conversationLiveDecision !== true) {
      setLiveSessionContext(null);
      return;
    }

    if (!shouldFetchLiveSessionGitContext) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refetchLiveSessionContext().catch(() => {});
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [conversationLiveDecision, refetchLiveSessionContext, shouldFetchLiveSessionGitContext]);

  useEffect(() => {
    if (!id) {
      setDeferredResumes([]);
      return;
    }

    if (initialDeferredResumeState && skippedInitialDeferredResumeLocationKeyRef.current !== location.key) {
      skippedInitialDeferredResumeLocationKeyRef.current = location.key;
      setDeferredResumes(initialDeferredResumeState);
      return;
    }

    void refetchDeferredResumes().catch(() => {});
  }, [id, initialDeferredResumeState, location.key, refetchDeferredResumes]);

  useEffect(() => {
    if (deferredResumes.length === 0) {
      setShowDeferredResumeDetails(false);
      return;
    }

    const intervalHandle = window.setInterval(() => {
      setDeferredResumeNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalHandle);
    };
  }, [deferredResumes.length]);

  useEffect(() => {
    if (!shouldAutoResumeDeferredResumes({
      autoResumeKey: deferredResumeAutoResumeKey,
      lastAttemptedKey: attemptedDeferredResumeAutoResumeKeyRef.current,
      draft,
      isLiveSession,
      deferredResumesBusy,
      resumeConversationBusy,
    })) {
      return;
    }

    attemptedDeferredResumeAutoResumeKeyRef.current = deferredResumeAutoResumeKey;
    void resumeDeferredConversation().catch((error) => {
      console.error('Deferred resume auto-resume failed:', error);
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    });
  }, [
    deferredResumeAutoResumeKey,
    deferredResumesBusy,
    draft,
    isLiveSession,
    resumeConversationBusy,
    resumeDeferredConversation,
    showNotice,
  ]);

  // Auto-resize textarea. Schedule the measurement once per frame so typing
  // does not force multiple synchronous layouts against a large transcript.
  const resizeComposer = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }

    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const scheduleComposerResize = useCallback(() => {
    if (typeof window === 'undefined' || composerResizeFrameRef.current !== null) {
      return;
    }

    composerResizeFrameRef.current = window.requestAnimationFrame(() => {
      composerResizeFrameRef.current = null;
      resizeComposer();
    });
  }, [resizeComposer]);

  const rememberComposerInput = useCallback((value: string, scopeId: string | null = composerHistoryScopeId) => {
    const nextHistory = appendComposerHistory(scopeId, value);
    setComposerHistory(nextHistory);
    setComposerHistoryIndex(null);
    composerHistoryDraftRef.current = '';
  }, [composerHistoryScopeId]);

  const rememberComposerSelection = useCallback((element?: HTMLTextAreaElement | null) => {
    const target = element ?? textareaRef.current;
    if (!target) {
      return;
    }

    composerSelectionRef.current = {
      start: target.selectionStart ?? target.value.length,
      end: target.selectionEnd ?? target.value.length,
    };
  }, []);

  const moveComposerCaretToEnd = useCallback(() => {
    window.requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) {
        return;
      }

      const end = el.value.length;
      el.focus();
      el.setSelectionRange(end, end);
      composerSelectionRef.current = { start: end, end };
    });
  }, []);

  useEffect(() => {
    if (!pendingAskUserQuestion || input.length > 0 || attachments.length > 0 || drawingAttachments.length > 0) {
      return;
    }

    moveComposerCaretToEnd();
  }, [attachments.length, drawingAttachments.length, input.length, moveComposerCaretToEnd, pendingAskUserQuestionKey]);

  const submitAskUserQuestion = useCallback(async (
    presentation: AskUserQuestionPresentation,
    answers: AskUserQuestionAnswers,
  ) => {
    const textToSend = buildAskUserQuestionReplyText(presentation, answers).trim();
    if (!textToSend) {
      return;
    }

    if (!id) {
      showNotice('danger', 'Question replies require an existing conversation.', 4000);
      return;
    }

    const requestedBehavior = isLiveSession ? defaultComposerBehavior : undefined;
    const queuedBehavior = normalizeConversationComposerBehavior(requestedBehavior, allowQueuedPrompts);

    try {
      if (isLiveSession) {
        await streamSend(textToSend, queuedBehavior);
        window.setTimeout(() => {
          scrollToBottom();
        }, 50);
        return;
      }

      if (!visibleSessionDetail) {
        showNotice('danger', 'Conversation is still loading. Try again in a moment.', 4000);
        return;
      }

      await api.resumeSession(visibleSessionDetail.meta.file, visibleSessionDetail.meta.cwd);
      setConfirmedLive(true);
      streamReconnect();
      await streamSend(textToSend, queuedBehavior);
      window.setTimeout(() => {
        scrollToBottom();
      }, 50);
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
      throw error;
    }
  }, [
    allowQueuedPrompts,
    defaultComposerBehavior,
    id,
    isLiveSession,
    scrollToBottom,
    showNotice,
    streamReconnect,
    streamSend,
    visibleSessionDetail,
  ]);

  const composerQuestionAnsweredCount = pendingAskUserQuestion
    ? pendingAskUserQuestion.presentation.questions.filter((question) => (composerQuestionAnswers[question.id]?.length ?? 0) > 0).length
    : 0;
  const composerQuestionCanSubmit = pendingAskUserQuestion
    ? isAskUserQuestionComplete(pendingAskUserQuestion.presentation, composerQuestionAnswers)
    : false;

  const activateComposerQuestion = useCallback((index: number) => {
    if (!pendingAskUserQuestion) {
      return;
    }

    const nextIndex = Math.max(0, Math.min(index, pendingAskUserQuestion.presentation.questions.length - 1));
    const nextQuestion = pendingAskUserQuestion.presentation.questions[nextIndex];
    const nextOptionIndex = resolveAskUserQuestionDefaultOptionIndex(nextQuestion, composerQuestionAnswers);
    setComposerQuestionIndex(nextIndex);
    setComposerQuestionOptionIndex(nextOptionIndex >= 0 ? nextOptionIndex : 0);
    moveComposerCaretToEnd();
  }, [composerQuestionAnswers, moveComposerCaretToEnd, pendingAskUserQuestion]);

  const advanceComposerQuestionAfterAnswer = useCallback((questionIndex: number, nextAnswers: AskUserQuestionAnswers) => {
    if (!pendingAskUserQuestion) {
      return;
    }

    const nextQuestionIndex = questionIndex + 1;
    if (nextQuestionIndex < pendingAskUserQuestion.presentation.questions.length) {
      const nextQuestion = pendingAskUserQuestion.presentation.questions[nextQuestionIndex];
      const nextOptionIndex = resolveAskUserQuestionDefaultOptionIndex(nextQuestion, nextAnswers);
      setComposerQuestionIndex(nextQuestionIndex);
      setComposerQuestionOptionIndex(nextOptionIndex >= 0 ? nextOptionIndex : 0);
    }

    moveComposerCaretToEnd();
  }, [moveComposerCaretToEnd, pendingAskUserQuestion]);

  const handleComposerQuestionOptionSelect = useCallback((questionIndex: number, optionIndex: number) => {
    if (!pendingAskUserQuestion || composerQuestionSubmitting) {
      return;
    }

    const question = pendingAskUserQuestion.presentation.questions[questionIndex];
    const option = question?.options[optionIndex];
    if (!question || !option) {
      return;
    }

    setComposerQuestionOptionIndex(optionIndex);

    if (question.style === 'check') {
      const currentValues = composerQuestionAnswers[question.id] ?? [];
      const alreadySelected = currentValues.includes(option.value);
      const nextValues = alreadySelected
        ? currentValues.filter((candidate) => candidate !== option.value)
        : [...currentValues, option.value];
      const nextAnswers = {
        ...composerQuestionAnswers,
        [question.id]: nextValues,
      };

      setComposerQuestionAnswers(nextAnswers);
      if (shouldAdvanceAskUserQuestionAfterSelection(question, nextValues)) {
        advanceComposerQuestionAfterAnswer(questionIndex, nextAnswers);
      }
      return;
    }

    const nextValues = [option.value];
    const nextAnswers = {
      ...composerQuestionAnswers,
      [question.id]: nextValues,
    };
    setComposerQuestionAnswers(nextAnswers);
    if (shouldAdvanceAskUserQuestionAfterSelection(question, nextValues)) {
      advanceComposerQuestionAfterAnswer(questionIndex, nextAnswers);
    }
  }, [advanceComposerQuestionAfterAnswer, composerQuestionAnswers, composerQuestionSubmitting, pendingAskUserQuestion]);

  const submitComposerQuestionIfReady = useCallback(async () => {
    if (!pendingAskUserQuestion || !composerQuestionCanSubmit || composerQuestionSubmitting) {
      return false;
    }

    setComposerQuestionSubmitting(true);
    try {
      await submitAskUserQuestion(pendingAskUserQuestion.presentation, composerQuestionAnswers);
      return true;
    } finally {
      setComposerQuestionSubmitting(false);
    }
  }, [composerQuestionAnswers, composerQuestionCanSubmit, composerQuestionSubmitting, pendingAskUserQuestion, submitAskUserQuestion]);

  const navigateComposerHistory = useCallback((direction: 'older' | 'newer') => {
    if (composerHistory.length === 0) {
      return false;
    }

    if (direction === 'older') {
      const nextIndex = composerHistoryIndex === null
        ? composerHistory.length - 1
        : Math.max(0, composerHistoryIndex - 1);

      if (composerHistoryIndex === null) {
        composerHistoryDraftRef.current = input;
      }

      setComposerHistoryIndex(nextIndex);
      setInput(composerHistory[nextIndex]);
      moveComposerCaretToEnd();
      return true;
    }

    if (composerHistoryIndex === null) {
      return false;
    }

    if (composerHistoryIndex >= composerHistory.length - 1) {
      setComposerHistoryIndex(null);
      setInput(composerHistoryDraftRef.current);
      composerHistoryDraftRef.current = '';
      moveComposerCaretToEnd();
      return true;
    }

    const nextIndex = composerHistoryIndex + 1;
    setComposerHistoryIndex(nextIndex);
    setInput(composerHistory[nextIndex]);
    moveComposerCaretToEnd();
    return true;
  }, [composerHistory, composerHistoryIndex, input, moveComposerCaretToEnd, setInput]);

  useLayoutEffect(() => {
    scheduleComposerResize();
  }, [input, scheduleComposerResize]);

  useEffect(() => () => {
    if (composerResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(composerResizeFrameRef.current);
      composerResizeFrameRef.current = null;
    }
  }, []);

  useEffect(() => { setSlashIdx(0); }, [slashQuery]);
  useEffect(() => { setModelIdx(0); }, [modelQuery]);

  useEffect(() => {
    return () => {
      if (noticeTimeoutRef.current !== null) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, []);

  // Scroll tracking
  const handleScroll = useCallback(() => {
    syncScrollStateFromDom();

    const el = scrollRef.current;
    if (!el) {
      return;
    }

    if (historicalHasOlderBlocks && !sessionLoading && el.scrollTop <= HISTORICAL_PREFETCH_SCROLL_THRESHOLD_PX) {
      loadOlderMessages();
    }
  }, [historicalHasOlderBlocks, loadOlderMessages, sessionLoading, syncScrollStateFromDom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    if (!id || sessionLoading || !historicalHasOlderBlocks || historicalTailBlocks >= Math.min(historicalTotalBlocks, MAX_AUTOMATIC_HISTORICAL_TAIL_BLOCKS)) {
      return;
    }

    if (isLiveSession && stream.isStreaming) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      loadOlderMessages(undefined, { automatic: true });
    }, HISTORICAL_BACKGROUND_PREFETCH_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [historicalHasOlderBlocks, historicalTailBlocks, historicalTotalBlocks, id, isLiveSession, loadOlderMessages, sessionLoading, stream.isStreaming]);

  // Esc aborts an active run.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented) {
        return;
      }

      if (hasBlockingOverlayOpen()) {
        return;
      }

      if (stream.isStreaming) {
        e.preventDefault();
        void streamAbort();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [stream.isStreaming, streamAbort]);

  // Forked/new conversations with a queued initial prompt should stay pinned to
  // the bottom only until that queued user block lands and the assistant starts
  // its response. After that, let the transcript stay put so the response can be
  // read from the top while it streams.
  useLayoutEffect(() => {
    if (!id || pinnedInitialPromptScrollSessionIdRef.current !== id || !scrollRef.current) {
      return;
    }

    const tailBlock = realMessages?.[realMessages.length - 1];
    const tailKey = getConversationTailBlockKey(tailBlock);
    if (pinnedInitialPromptTailKeyRef.current) {
      if (tailKey && tailKey !== pinnedInitialPromptTailKeyRef.current) {
        pinnedInitialPromptScrollSessionIdRef.current = null;
        pinnedInitialPromptTailKeyRef.current = null;
        return;
      }
    } else if (tailBlock?.type === 'user' && tailKey) {
      pinnedInitialPromptTailKeyRef.current = tailKey;
    }

    const pinToBottom = () => {
      scrollToBottom();
    };

    pinToBottom();
    const animationFrame = window.requestAnimationFrame(pinToBottom);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [id, realMessages, scrollToBottom]);

  // Focus input on navigation
  useEffect(() => { textareaRef.current?.focus(); }, [id]);

  useEffect(() => {
    if (prevStreamingRef.current && !stream.isStreaming) {
      if (pinnedInitialPromptScrollSessionIdRef.current === id) {
        pinnedInitialPromptScrollSessionIdRef.current = null;
        pinnedInitialPromptTailKeyRef.current = null;
      }
    }
    prevStreamingRef.current = stream.isStreaming;
  }, [id, stream.isStreaming]);

  // Jump to message by index
  const jumpToMessage = useCallback((index: number) => {
    const el = scrollRef.current?.querySelector(`#msg-${index}`);
    if (el) {
      pendingJumpMessageIndexRef.current = null;
      setRequestedFocusMessageIndex(null);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    pendingJumpMessageIndexRef.current = index;
    setRequestedFocusMessageIndex(index);
    if (index < historicalBlockOffset) {
      loadOlderMessages(index);
    }
  }, [historicalBlockOffset, loadOlderMessages]);

  useLayoutEffect(() => {
    const pendingIndex = pendingJumpMessageIndexRef.current;
    if (pendingIndex === null || pendingIndex < historicalBlockOffset) {
      return;
    }

    const el = scrollRef.current?.querySelector(`#msg-${pendingIndex}`);
    if (!el) {
      return;
    }

    pendingJumpMessageIndexRef.current = null;
    setRequestedFocusMessageIndex(null);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [historicalBlockOffset, realMessages]);

  useEffect(() => {
    if (!isEditingTitle) {
      return;
    }

    window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [isEditingTitle]);

  useEffect(() => {
    if (isEditingTitle) {
      return;
    }

    setTitleDraft(title);
  }, [title, isEditingTitle]);

  const beginTitleEdit = useCallback(() => {
    if (draft || !id || titleSaving) {
      return;
    }

    if (conversationNeedsTakeover) {
      showNotice('danger', 'Take over this conversation to rename it.', 4000);
      return;
    }

    setConversationCwdEditorOpen(false);
    setConversationCwdError(null);
    setTitleDraft(title === NEW_CONVERSATION_TITLE ? '' : title);
    setIsEditingTitle(true);
  }, [conversationNeedsTakeover, draft, id, title, titleSaving, showNotice]);

  const cancelTitleEdit = useCallback(() => {
    setIsEditingTitle(false);
    setTitleDraft(title);
  }, [title]);

  const saveTitleEdit = useCallback(async () => {
    if (draft || !id) {
      return;
    }

    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      showNotice('danger', 'Conversation title is required.');
      return;
    }

    await renameConversationTo(nextTitle);
  }, [draft, id, renameConversationTo, showNotice, titleDraft]);

  const submitConversationCwdChange = useCallback(async (nextCwdOverride?: string) => {
    if (draft || !id || conversationCwdBusy) {
      return;
    }

    if (!ensureConversationCanControl('change its working directory')) {
      return;
    }

    if (stream.isStreaming) {
      showNotice('danger', 'Stop the current response before changing the working directory.', 4000);
      return;
    }

    const nextCwd = (nextCwdOverride ?? conversationCwdDraft).trim();
    if (!nextCwd) {
      setConversationCwdError('Enter a directory path.');
      return;
    }

    setConversationCwdBusy(true);
    setConversationCwdError(null);

    try {
      const result = await api.changeConversationCwd(id, nextCwd, currentSurfaceId);
      setConversationCwdEditorOpen(false);
      setConversationCwdDraft(result.cwd);

      if (!result.changed || result.id === id) {
        void refetchLiveSessionContext();
        return;
      }

      ensureConversationTabOpen(result.id);
      closeConversationTab(id);
      navigate(`/conversations/${result.id}`);
    } catch (error) {
      setConversationCwdError(error instanceof Error ? error.message : 'Could not change the working directory.');
    } finally {
      setConversationCwdBusy(false);
    }
  }, [conversationCwdBusy, conversationCwdDraft, currentSurfaceId, draft, ensureConversationCanControl, id, navigate, refetchLiveSessionContext, showNotice, stream.isStreaming]);

  const pickConversationCwd = useCallback(async () => {
    if (draft || !id || conversationCwdPickBusy || conversationCwdBusy) {
      return;
    }

    if (!ensureConversationCanControl('change its working directory')) {
      return;
    }

    if (selectedExecutionTargetIsRemote) {
      openRemoteDirectoryBrowser('conversation', conversationCwdDraft.trim() || currentCwd || undefined);
      return;
    }

    setConversationCwdPickBusy(true);
    setConversationCwdError(null);

    try {
      const result = await api.pickFolder({
        cwd: conversationCwdDraft.trim() || currentCwd || undefined,
        prompt: 'Choose a working directory',
      });
      if (result.cancelled || !result.path) {
        return;
      }

      setConversationCwdDraft(result.path);
      setConversationCwdEditorOpen(true);
    } catch (error) {
      setConversationCwdError(error instanceof Error ? error.message : 'Could not choose a folder.');
    } finally {
      setConversationCwdPickBusy(false);
    }
  }, [conversationCwdBusy, conversationCwdDraft, conversationCwdPickBusy, currentCwd, draft, ensureConversationCanControl, id, openRemoteDirectoryBrowser, selectedExecutionTargetIsRemote]);

  const beginConversationCwdEdit = useCallback(() => {
    if (draft || !id || conversationCwdBusy) {
      return;
    }

    if (!ensureConversationCanControl('change its working directory')) {
      return;
    }

    if (stream.isStreaming) {
      showNotice('danger', 'Stop the current response before changing the working directory.', 4000);
      return;
    }

    setConversationCwdDraft(currentCwd ?? '');
    setConversationCwdError(null);
    setConversationCwdEditorOpen(true);
  }, [conversationCwdBusy, currentCwd, draft, ensureConversationCanControl, id, showNotice, stream.isStreaming]);

  const cancelConversationCwdEdit = useCallback(() => {
    setConversationCwdDraft(currentCwd ?? '');
    setConversationCwdError(null);
    setConversationCwdEditorOpen(false);
  }, [currentCwd]);

  const preparePendingConversationPromptWithRelatedContext = useCallback(async (
    prompt: PendingConversationPrompt,
  ): Promise<PendingConversationPrompt> => {
    if ((prompt.contextMessages?.length ?? 0) > 0) {
      return prompt;
    }

    const relatedConversationIds = Array.from(new Set(
      (prompt.relatedConversationIds ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ));
    if (relatedConversationIds.length === 0) {
      return prompt;
    }

    const relatedContext = await api.relatedConversationContext(relatedConversationIds, prompt.text);
    return {
      ...prompt,
      relatedConversationIds,
      contextMessages: relatedContext.contextMessages,
    };
  }, []);

  useEffect(() => {
    if (!shouldAutoDispatchPendingInitialPrompt({
      draft,
      conversationId: id,
      hasPendingInitialPrompt: Boolean(pendingInitialPrompt),
      pendingInitialPromptDispatching,
      hasStreamSnapshot: stream.hasSnapshot,
    })) {
      return;
    }

    if (
      pendingInitialPromptSessionIdRef.current === id
      || pendingInitialPromptFailureSessionIdRef.current === id
      || !pendingInitialPrompt
    ) {
      return;
    }

    const keepsStoredPromptDuringDispatch = (pendingInitialPrompt.relatedConversationIds?.length ?? 0) > 0;
    const claimedInitialPrompt = keepsStoredPromptDuringDispatch
      ? pendingInitialPrompt
      : consumePendingConversationPrompt(id);
    if (!claimedInitialPrompt) {
      setPendingInitialPrompt(null);
      return;
    }

    pendingInitialPromptSessionIdRef.current = id;
    pinnedInitialPromptScrollSessionIdRef.current = id;
    pinnedInitialPromptTailKeyRef.current = null;

    if (keepsStoredPromptDuringDispatch) {
      setPendingConversationPromptDispatching(id, true);
    } else {
      setPendingInitialPrompt(null);
    }

    void (async () => {
      let preparedInitialPrompt = claimedInitialPrompt;
      try {
        preparedInitialPrompt = await preparePendingConversationPromptWithRelatedContext(claimedInitialPrompt);
        if (preparedInitialPrompt !== claimedInitialPrompt) {
          persistPendingConversationPrompt(id, preparedInitialPrompt);
        }

        await stream.send(
          preparedInitialPrompt.text,
          normalizeConversationComposerBehavior(preparedInitialPrompt.behavior, allowQueuedPrompts),
          preparedInitialPrompt.images,
          preparedInitialPrompt.attachmentRefs,
          preparedInitialPrompt.contextMessages,
        );
        pendingInitialPromptSessionIdRef.current = null;
      } catch (error) {
        pendingInitialPromptSessionIdRef.current = null;
        pendingInitialPromptFailureSessionIdRef.current = id;
        pinnedInitialPromptScrollSessionIdRef.current = null;
        pinnedInitialPromptTailKeyRef.current = null;
        persistPendingConversationPrompt(id, preparedInitialPrompt);
        setPendingConversationPromptDispatching(id, false);
        setPendingInitialPrompt(preparedInitialPrompt);
        persistForkPromptDraft(id, preparedInitialPrompt.text);
        console.error('Initial prompt failed:', error);
        showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
      }
    })();
  }, [
    draft,
    id,
    pendingInitialPrompt,
    pendingInitialPromptDispatching,
    allowQueuedPrompts,
    preparePendingConversationPromptWithRelatedContext,
    stream.hasSnapshot,
    stream.send,
    showNotice,
  ]);

  const ensureConversationIsLive = useCallback(async (actionDescription = 'continue') => {
    if (!id) {
      throw new Error('Conversation unavailable.');
    }

    if (isLiveSession) {
      return id;
    }

    const recovered = await api.recoverConversation(id);
    if (!recovered.live) {
      throw new Error(`This conversation could not ${actionDescription}.`);
    }

    if (recovered.conversationId === id) {
      setConfirmedLive(true);
      streamReconnect();
    }

    return recovered.conversationId;
  }, [id, isLiveSession, streamReconnect, streamTakeover]);

  const materializeDraftConversation = useCallback(async (options: { enableAutoModeOnLoad?: boolean } = {}) => {
    if (!draft) {
      if (!id) {
        throw new Error('Conversation unavailable.');
      }

      return id;
    }

    const draftExecutionTarget = draftExecutionTargetId.trim() || 'local';
    const draftRemoteCwd = draftExecutionTarget === 'local' ? undefined : (draftCwdValue || null);
    if (draftExecutionTarget !== 'local' && !draftRemoteCwd) {
      throw new Error(`Choose a remote directory on ${selectedExecutionTargetLabel} first.`);
    }

    const created = await api.createLiveSession(
      draftExecutionTarget === 'local' ? (draftCwdValue || undefined) : undefined,
      undefined,
      createLiveSessionPreferenceInput,
    );
    if (draftExecutionTarget === 'local') {
      primeCreatedConversationOpenCaches(created, {
        tailBlocks: INITIAL_HISTORICAL_TAIL_BLOCKS,
        bootstrapVersionKey: conversationVersionKey,
        sessionDetailVersion: conversationEventVersion,
      });
    } else {
      await applyDraftExecutionTarget(created.id, draftRemoteCwd);
    }

    const newId = created.id;
    if (input.length > 0) {
      persistForkPromptDraft(newId, input);
    }

    clearDraftConversationComposer();
    clearDraftConversationCwd();
    clearDraftConversationModel();
    clearDraftConversationThinkingLevel();
    clearDraftConversationServiceTier();

    ensureConversationTabOpen(newId);
    navigate(`/conversations/${newId}`, {
      replace: true,
      state: {
        initialModelPreferenceState: buildConversationInitialModelPreferenceState({
          conversationId: newId,
          currentModel,
          currentThinkingLevel,
          currentServiceTier,
          hasExplicitServiceTier,
          defaultModel,
          defaultThinkingLevel,
          defaultServiceTier,
        }),
        initialDeferredResumeState: {
          conversationId: newId,
          resumes: [],
        },
        draftHydrationState: {
          conversationId: newId,
          ...(options.enableAutoModeOnLoad ? { enableAutoModeOnLoad: true } : {}),
        },
      } satisfies ConversationLocationState,
    });

    return newId;
  }, [conversationEventVersion, conversationVersionKey, createLiveSessionPreferenceInput, currentModel, currentThinkingLevel, currentServiceTier, defaultModel, defaultThinkingLevel, defaultServiceTier, draft, draftCwdValue, hasExplicitServiceTier, id, input, navigate]);

  const toggleConversationAutoMode = useCallback(async () => {
    if (conversationAutoModeBusy) {
      return;
    }

    const nextEnabled = !conversationAutoModeEnabled;
    setConversationAutoModeBusy(true);

    try {
      if (draft) {
        if (!nextEnabled) {
          return;
        }

        await materializeDraftConversation({ enableAutoModeOnLoad: true });
        return;
      }

      if (!id) {
        return;
      }

      const targetConversationId = nextEnabled
        ? await ensureConversationIsLive('enable auto mode')
        : id;
      const nextState = await api.updateConversationAutoMode(
        targetConversationId,
        { enabled: nextEnabled },
        currentSurfaceId,
      );

      if (targetConversationId === id) {
        setConversationAutoModeState(nextState);
      }
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setConversationAutoModeBusy(false);
    }
  }, [conversationAutoModeBusy, conversationAutoModeEnabled, currentSurfaceId, draft, ensureConversationIsLive, id, materializeDraftConversation, showNotice]);

  const rewindConversationFromMessage = useCallback(async (messageIndex: number) => {
    if (!id || !realMessages) {
      return;
    }

    const localMessageIndex = messageIndex - messageIndexOffset;
    if (localMessageIndex < 0 || localMessageIndex >= realMessages.length) {
      showNotice('danger', 'Load the relevant part of the conversation before rewinding from it.');
      return;
    }

    try {
      const liveConversationId = await ensureConversationIsLive('be rewound');
      const entries = await api.forkEntries(liveConversationId);
      const target = resolveRewindTargetForMessage(realMessages, localMessageIndex, entries);
      if (!target) {
        throw new Error('No forkable message found for that point in the conversation.');
      }

      if (!ensureConversationCanControl('rewind from this message')) {
        return;
      }

      const { newSessionId } = await api.forkSession(liveConversationId, target.entryId, {
        preserveSource: true,
        beforeEntry: target.beforeEntry,
      }, currentSurfaceId);
      if (target.promptDraft) {
        persistForkPromptDraft(newSessionId, target.promptDraft);
      }
      ensureConversationTabOpen(newSessionId);
      navigate(`/conversations/${newSessionId}`);
    } catch (error) {
      showNotice('danger', `Rewind failed: ${(error as Error).message}`);
    }
  }, [currentSurfaceId, ensureConversationCanControl, ensureConversationIsLive, id, messageIndexOffset, navigate, realMessages, showNotice]);

  const forkConversationFromMessage = useCallback(async (messageIndex: number) => {
    if (!id || !realMessages) {
      return;
    }

    const localMessageIndex = messageIndex - messageIndexOffset;
    if (localMessageIndex < 0 || localMessageIndex >= realMessages.length) {
      showNotice('danger', 'Load the relevant part of the conversation before branching from it.');
      return;
    }

    const clickedBlock = realMessages[localMessageIndex];
    if (clickedBlock?.type !== 'text') {
      await rewindConversationFromMessage(messageIndex);
      return;
    }

    try {
      const liveConversationId = await ensureConversationIsLive('be forked');
      let entryId = resolveSessionEntryIdFromBlockId(clickedBlock.id);
      if (!entryId) {
        const detail = await api.sessionDetail(liveConversationId, {
          tailBlocks: Math.max(realMessages.length, 1),
        });
        entryId = resolveBranchEntryIdForMessage(clickedBlock, messageIndex, detail);
      }
      if (!entryId) {
        throw new Error('The selected assistant message is not ready to branch yet. Try again in a moment.');
      }

      if (!ensureConversationCanControl('branch from this message')) {
        return;
      }

      const { newSessionId } = await api.branchSession(liveConversationId, entryId, currentSurfaceId);
      ensureConversationTabOpen(newSessionId);
      navigate(`/conversations/${newSessionId}`);
    } catch (error) {
      showNotice('danger', `Fork failed: ${(error as Error).message}`);
    }
  }, [currentSurfaceId, ensureConversationCanControl, ensureConversationIsLive, id, messageIndexOffset, navigate, realMessages, rewindConversationFromMessage, showNotice]);

  async function saveModelPreference(modelId: string) {
    if (!modelId || modelId === currentModel || savingPreference !== null) {
      return;
    }

    setSavingPreference('model');
    try {
      if (draft) {
        if (modelId === defaultModel) {
          clearDraftConversationModel();
        } else {
          persistDraftConversationModel(modelId);
        }
        setCurrentModel(modelId);
      } else if (id) {
        if (isLiveSession && !ensureConversationCanControl('change the model')) {
          return;
        }

        const next = await api.updateConversationModelPreferences(id, { model: modelId }, currentSurfaceId);
        setCurrentModel(next.currentModel);
        setCurrentThinkingLevel(next.currentThinkingLevel);
        setCurrentServiceTier(next.currentServiceTier);
        setHasExplicitServiceTier(next.hasExplicitServiceTier);
      }

      const selectedModel = models.find((candidate) => candidate.id === modelId);
      if (selectedModel) {
        showNotice('accent', `Model set to ${selectedModel.name} for this conversation.`);
      }
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setSavingPreference(null);
    }
  }

  async function saveThinkingLevelPreference(thinkingLevel: string) {
    if (thinkingLevel === currentThinkingLevel || savingPreference !== null) {
      return;
    }

    setSavingPreference('thinking');
    try {
      let savedThinkingLevel = thinkingLevel || defaultThinkingLevel;

      if (draft) {
        if (!thinkingLevel || thinkingLevel === defaultThinkingLevel) {
          clearDraftConversationThinkingLevel();
        } else {
          persistDraftConversationThinkingLevel(thinkingLevel);
        }
        setCurrentThinkingLevel(savedThinkingLevel);
      } else if (id) {
        if (isLiveSession && !ensureConversationCanControl('change the thinking level')) {
          return;
        }

        const next = await api.updateConversationModelPreferences(id, { thinkingLevel }, currentSurfaceId);
        setCurrentModel(next.currentModel);
        setCurrentThinkingLevel(next.currentThinkingLevel);
        setCurrentServiceTier(next.currentServiceTier);
        setHasExplicitServiceTier(next.hasExplicitServiceTier);
        savedThinkingLevel = next.currentThinkingLevel;
      }

      showNotice('accent', `Thinking level set to ${formatThinkingLevelLabel(savedThinkingLevel)}.`);
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setSavingPreference(null);
    }
  }

  async function saveServiceTierPreference(enableFastMode: boolean) {
    if (savingPreference !== null) {
      return;
    }

    const serviceTier = resolveFastModeToggleServiceTier({
      enableFastMode,
      defaultServiceTier,
    });

    setSavingPreference('serviceTier');
    try {
      let savedServiceTier = enableFastMode ? 'priority' : '';

      if (draft) {
        if (serviceTier === null) {
          persistDraftConversationServiceTier(DRAFT_SERVICE_TIER_DISABLED_SENTINEL);
          setCurrentServiceTier('');
          setHasExplicitServiceTier(true);
        } else if (!serviceTier || serviceTier === defaultServiceTier) {
          clearDraftConversationServiceTier();
          setCurrentServiceTier(serviceTier || defaultServiceTier);
          setHasExplicitServiceTier(false);
        } else {
          persistDraftConversationServiceTier(serviceTier);
          setCurrentServiceTier(serviceTier);
          setHasExplicitServiceTier(true);
        }
      } else if (id) {
        if (isLiveSession && !ensureConversationCanControl('change the service tier')) {
          return;
        }

        const next = await api.updateConversationModelPreferences(id, { serviceTier }, currentSurfaceId);
        setCurrentModel(next.currentModel);
        setCurrentThinkingLevel(next.currentThinkingLevel);
        setCurrentServiceTier(next.currentServiceTier);
        setHasExplicitServiceTier(next.hasExplicitServiceTier);
        savedServiceTier = next.currentServiceTier;
      }

      showNotice('accent', savedServiceTier === 'priority' ? 'Fast mode enabled.' : 'Fast mode disabled.');
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setSavingPreference(null);
    }
  }

  function selectModel(modelId: string) {
    setInput('');
    setModelIdx(0);
    textareaRef.current?.focus();
    void saveModelPreference(modelId);
  }

  // /clear — destroy current session, create new one in same cwd
  async function handleClear() {
    if (!id) return;
    if (!ensureConversationCanControl('clear it')) {
      return;
    }

    try {
      if (stream.isStreaming) {
        await stream.abort();
      }
      await api.destroySession(id, currentSurfaceId).catch(() => {});
      const cwd = visibleSessionDetail?.meta.cwd ?? undefined;
      const created = await api.createLiveSession(cwd, undefined, createLiveSessionPreferenceInput);
      primeCreatedConversationOpenCaches(created, {
        tailBlocks: INITIAL_HISTORICAL_TAIL_BLOCKS,
        bootstrapVersionKey: conversationVersionKey,
        sessionDetailVersion: conversationEventVersion,
      });
      ensureConversationTabOpen(created.id);
      navigate(`/conversations/${created.id}`, {
        state: {
          initialModelPreferenceState: buildConversationInitialModelPreferenceState({
            conversationId: created.id,
            currentModel,
            currentThinkingLevel,
            currentServiceTier,
            hasExplicitServiceTier,
            defaultModel,
            defaultThinkingLevel,
            defaultServiceTier,
          }),
          initialDeferredResumeState: {
            conversationId: created.id,
            resumes: [],
          },
        },
      });
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  async function summarizeAndForkConversation() {
    if (draft || !id) {
      showNotice('danger', 'Summarize + fork requires an existing conversation.', 4000);
      return;
    }

    if (summaryForkBusy) {
      return;
    }

    setSummaryForkBusy(true);
    try {
      showNotice('accent', 'Creating summary fork…', 5000);
      const liveConversationId = await ensureConversationIsLive('be summarized and forked');
      const { newSessionId } = await retryLiveSessionActionAfterTakeover({
        attemptAction: () => api.summarizeAndForkSession(liveConversationId, currentSurfaceId),
        takeOverSessionControl: () => streamTakeover(),
      });
      ensureConversationTabOpen(newSessionId);
      navigate(`/conversations/${newSessionId}`);
    } catch (error) {
      showNotice('danger', `Summarize + fork failed: ${error instanceof Error ? error.message : String(error)}`, 4000);
    } finally {
      setSummaryForkBusy(false);
    }
  }

  function addImageAttachments(files: File[]) {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length > 0) {
      setAttachments((prev) => [...prev, ...imageFiles]);
    }
  }

  async function addComposerFiles(files: File[]) {
    const nextImageFiles: File[] = [];
    const nextDrawingAttachments: ComposerDrawingAttachment[] = [];
    const rejectedFiles: string[] = [];

    for (const file of files) {
      if (isPotentialExcalidrawFile(file)) {
        try {
          const drawing = await buildComposerDrawingFromFile(file);
          nextDrawingAttachments.push(drawing);
          continue;
        } catch (error) {
          if (file.name.trim().toLowerCase().endsWith('.excalidraw')) {
            showNotice('danger', `Failed to parse ${file.name}: ${error instanceof Error ? error.message : String(error)}`, 4000);
            continue;
          }
        }
      }

      if (file.type.startsWith('image/')) {
        nextImageFiles.push(file);
        continue;
      }

      rejectedFiles.push(file.name || 'Unnamed file');
    }

    if (nextImageFiles.length > 0) {
      addImageAttachments(nextImageFiles);
    }

    if (nextDrawingAttachments.length > 0) {
      setDrawingAttachments((current) => [...current, ...nextDrawingAttachments]);
      showNotice('accent', `Attached ${nextDrawingAttachments.length} drawing${nextDrawingAttachments.length === 1 ? '' : 's'}.`);
    }

    if (rejectedFiles.length > 0) {
      const preview = rejectedFiles.slice(0, 3).join(', ');
      const suffix = rejectedFiles.length > 3 ? `, +${rejectedFiles.length - 3} more` : '';
      showNotice('danger', `Unsupported file type: ${preview}${suffix}`, 4000);
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function captureComposerScreenshot() {
    if (composerDisabled || screenshotCaptureBusy) {
      return;
    }

    setScreenshotCaptureBusy(true);
    try {
      const desktopBridge = getDesktopBridge();
      if (!desktopBridge) {
        throw new Error('Screenshot capture is only available in the desktop app.');
      }

      const result = await desktopBridge.captureScreenshot();
      if (result.cancelled || !result.image) {
        return;
      }

      setAttachments((current) => [
        ...current,
        base64ToFile(
          result.image.data,
          result.image.mimeType,
          result.image.name?.trim() || 'Screenshot.png',
        ),
      ]);
      textareaRef.current?.focus();
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setScreenshotCaptureBusy(false);
    }
  }

  function openDrawingEditor() {
    setEditingDrawingLocalId('__new__');
  }

  function closeDrawingEditor() {
    setEditingDrawingLocalId(null);
  }

  function editDrawing(localId: string) {
    setEditingDrawingLocalId(localId);
  }

  function removeDrawingAttachment(localId: string) {
    setDrawingAttachments((current) => current.filter((attachment) => attachment.localId !== localId));
  }

  async function saveDrawingFromEditor(payload: ExcalidrawEditorSavePayload) {
    const activeLocalId = editingDrawingLocalId;

    setDrawingAttachments((current) => {
      if (activeLocalId && activeLocalId !== '__new__') {
        return current.map((attachment) => {
          if (attachment.localId !== activeLocalId) {
            return attachment;
          }

          return {
            ...attachment,
            title: payload.title,
            sourceData: payload.sourceData,
            sourceMimeType: payload.sourceMimeType,
            sourceName: payload.sourceName,
            previewData: payload.previewData,
            previewMimeType: payload.previewMimeType,
            previewName: payload.previewName,
            previewUrl: payload.previewUrl,
            scene: payload.scene,
            dirty: true,
          } satisfies ComposerDrawingAttachment;
        });
      }

      return [
        ...current,
        {
          localId: createComposerDrawingLocalId(),
          title: payload.title,
          sourceData: payload.sourceData,
          sourceMimeType: payload.sourceMimeType,
          sourceName: payload.sourceName,
          previewData: payload.previewData,
          previewMimeType: payload.previewMimeType,
          previewName: payload.previewName,
          previewUrl: payload.previewUrl,
          scene: payload.scene,
          dirty: true,
        } satisfies ComposerDrawingAttachment,
      ];
    });

    closeDrawingEditor();
    showNotice('accent', 'Drawing saved to composer.');
  }

  async function attachSavedDrawing(selection: { attachment: ConversationAttachmentSummary; revision: number }) {
    if (!id) {
      showNotice('danger', 'Saved drawing picker requires an existing conversation.', 4000);
      return;
    }

    setDrawingsBusy(true);
    setDrawingsError(null);
    try {
      const detail = await api.conversationAttachment(id, selection.attachment.id);
      const record = detail.attachment;
      const revision = record.revisions.find((entry) => entry.revision === selection.revision)
        ?? record.latestRevision;

      const sourceDataUrl = (await api.conversationAttachmentAsset(id, record.id, 'source', revision.revision)).dataUrl;
      const sourceCommaIndex = sourceDataUrl.indexOf(',');
      const sourceData = sourceCommaIndex >= 0 ? sourceDataUrl.slice(sourceCommaIndex + 1) : sourceDataUrl;
      const previewDataUrl = (await api.conversationAttachmentAsset(id, record.id, 'preview', revision.revision)).dataUrl;
      const previewCommaIndex = previewDataUrl.indexOf(',');
      const previewData = previewCommaIndex >= 0 ? previewDataUrl.slice(previewCommaIndex + 1) : previewDataUrl;
      const scene = parseExcalidrawSceneFromSourceData(sourceData);

      const nextAttachment: ComposerDrawingAttachment = {
        localId: createComposerDrawingLocalId(),
        attachmentId: record.id,
        revision: revision.revision,
        title: record.title,
        sourceData,
        sourceMimeType: revision.sourceMimeType,
        sourceName: revision.sourceName,
        previewData,
        previewMimeType: revision.previewMimeType,
        previewName: revision.previewName,
        previewUrl: previewDataUrl,
        scene,
        dirty: false,
      };

      setDrawingAttachments((current) => {
        const alreadyAttached = current.some((attachment) => (
          attachment.attachmentId === nextAttachment.attachmentId
          && attachment.revision === nextAttachment.revision
          && !attachment.dirty
        ));

        if (alreadyAttached) {
          return current;
        }

        return [...current, nextAttachment];
      });

      setDrawingsPickerOpen(false);
      showNotice('accent', `Attached drawing ${record.title} (rev ${revision.revision}).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDrawingsError(message);
      showNotice('danger', message, 4000);
    } finally {
      setDrawingsBusy(false);
    }
  }

  async function persistDrawingsForConversation(
    conversationId: string,
    currentDrawings: ComposerDrawingAttachment[],
  ): Promise<ComposerDrawingAttachment[]> {
    const persisted: ComposerDrawingAttachment[] = [];

    for (const drawing of currentDrawings) {
      if (drawing.attachmentId && !drawing.dirty) {
        persisted.push(drawing);
        continue;
      }

      if (drawing.attachmentId) {
        const result = await api.updateConversationAttachment(conversationId, drawing.attachmentId, {
          title: drawing.title,
          sourceData: drawing.sourceData,
          sourceName: drawing.sourceName,
          sourceMimeType: drawing.sourceMimeType,
          previewData: drawing.previewData,
          previewName: drawing.previewName,
          previewMimeType: drawing.previewMimeType,
        });

        persisted.push({
          ...drawing,
          attachmentId: result.attachment.id,
          revision: result.attachment.currentRevision,
          title: result.attachment.title,
          sourceName: result.attachment.latestRevision.sourceName,
          sourceMimeType: result.attachment.latestRevision.sourceMimeType,
          previewName: result.attachment.latestRevision.previewName,
          previewMimeType: result.attachment.latestRevision.previewMimeType,
          dirty: false,
        });
        continue;
      }

      const result = await api.createConversationAttachment(conversationId, {
        kind: 'excalidraw',
        title: drawing.title,
        sourceData: drawing.sourceData,
        sourceName: drawing.sourceName,
        sourceMimeType: drawing.sourceMimeType,
        previewData: drawing.previewData,
        previewName: drawing.previewName,
        previewMimeType: drawing.previewMimeType,
      });

      persisted.push({
        ...drawing,
        attachmentId: result.attachment.id,
        revision: result.attachment.currentRevision,
        title: result.attachment.title,
        sourceName: result.attachment.latestRevision.sourceName,
        sourceMimeType: result.attachment.latestRevision.sourceMimeType,
        previewName: result.attachment.latestRevision.previewName,
        previewMimeType: result.attachment.latestRevision.previewMimeType,
        dirty: false,
      });
    }

    return persisted;
  }

  async function scheduleDeferredResume(delay: string, prompt?: string, behavior?: 'steer' | 'followUp') {
    if (!id || draft) {
      showNotice('danger', 'Wakeup requires an existing conversation.', 4000);
      return;
    }

    setDeferredResumesBusy(true);
    try {
      const result = await api.scheduleDeferredResume(id, { delay, prompt, behavior });
      setDeferredResumes(result.resumes);
      setInput('');
      showNotice(
        'accent',
        `Wakeup scheduled${behavior === 'followUp' ? ' as follow-up' : ''} for ${describeDeferredResumeStatus(result.resume)}.`,
      );
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setDeferredResumesBusy(false);
    }
  }

  async function fireDeferredResumeNow(resumeId: string) {
    if (!id) {
      return;
    }

    setDeferredResumesBusy(true);
    try {
      const result = await api.fireDeferredResumeNow(id, resumeId);
      setDeferredResumes(result.resumes);
      showNotice('accent', 'Wakeup firing…');
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setDeferredResumesBusy(false);
    }
  }

  async function cancelDeferredResume(resumeId: string) {
    if (!id) {
      return;
    }

    setDeferredResumesBusy(true);
    try {
      const result = await api.cancelDeferredResume(id, resumeId);
      setDeferredResumes(result.resumes);
      showNotice('accent', 'Wakeup cancelled.');
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setDeferredResumesBusy(false);
    }
  }

  async function continueDeferredResumesNow() {
    if (!id) {
      return;
    }

    if (isLiveSession) {
      await refetchDeferredResumes().catch(() => {});
      return;
    }

    try {
      await resumeDeferredConversation();
      showNotice('accent', 'Resuming deferred work…');
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  const resumeConversation = useCallback(async () => {
    if (!id || draft || resumeConversationBusy) {
      return;
    }

    setResumeConversationBusy(true);
    try {
      const result = await api.recoverConversation(id);
      if (result.conversationId && result.conversationId !== id) {
        ensureConversationTabOpen(result.conversationId);
        navigate(`/conversations/${result.conversationId}`);
        return;
      }

      setConfirmedLive(true);
      stream.reconnect();
      showNotice(
        'accent',
        result.replayedPendingOperation
          ? 'Continuing interrupted turn…'
          : result.usedFallbackPrompt
            ? 'Continuing with a follow-up prompt…'
            : 'Conversation ready to continue.',
      );
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setResumeConversationBusy(false);
    }
  }, [draft, id, navigate, resumeConversationBusy, showNotice, stream.reconnect]);

  async function renameConversationTo(nextTitle: string) {
    if (draft || !id) {
      showNotice('danger', 'Renaming requires an existing conversation.', 4000);
      return;
    }

    setTitleSaving(true);
    try {
      if (!ensureConversationCanControl('rename it')) {
        return;
      }

      const result = await api.renameConversation(id, nextTitle, currentSurfaceId);
      setTitleOverride(result.title);
      if (isLiveSession) {
        pushTitle(id, result.title);
      }
      const nextSessions = replaceConversationTitleInSessionList(sessions, id, result.title);
      if (nextSessions && nextSessions !== sessions) {
        setSessions(nextSessions);
      }
      setIsEditingTitle(false);
      showNotice('accent', 'Conversation renamed.');
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setTitleSaving(false);
    }
  }

  function resetDraftConversationState() {
    clearDraftConversationAttachments();
    clearDraftConversationComposer();
    clearDraftConversationCwd();
    clearDraftConversationModel();
    clearDraftConversationThinkingLevel();
    clearDraftConversationServiceTier();
    setCurrentModel(defaultModel);
    setCurrentThinkingLevel(defaultThinkingLevel);
    setCurrentServiceTier(defaultServiceTier);
    setHasExplicitServiceTier(false);
    setDraftCwdValue('');
    setDraftCwdPickBusy(false);
    setDraftCwdError(null);
    setInput('');
    setAttachments([]);
    setDrawingAttachments([]);
    setDrawingsError(null);
  }

  function startNewConversation() {
    resetDraftConversationState();
    if (location.pathname !== DRAFT_CONVERSATION_ROUTE) {
      navigate(DRAFT_CONVERSATION_ROUTE);
    }
  }

  const setDraftConversationCwd = useCallback((nextCwd: string) => {
    const normalizedCwd = nextCwd.trim();
    if (normalizedCwd) {
      persistDraftConversationCwd(normalizedCwd);
    } else {
      clearDraftConversationCwd();
    }

    setDraftCwdValue(normalizedCwd);
  }, []);

  function openRemoteDirectoryBrowser(kind: 'draft' | 'conversation', initialPath?: string | null) {
    if (!selectedExecutionTargetHost) {
      const message = 'Choose an SSH remote first.';
      if (kind === 'draft') {
        setDraftCwdError(message);
      } else {
        setConversationCwdError(message);
      }
      return;
    }

    setRemoteDirectoryBrowserState({ kind, initialPath });
  }

  function handleRemoteDirectorySelected(path: string) {
    if (remoteDirectoryBrowserState?.kind === 'draft') {
      const nextWorkspacePaths = syncSavedWorkspacePaths([...savedWorkspacePaths, path]);
      void api.setSavedWorkspacePaths(nextWorkspacePaths).catch(() => {
        // Ignore best-effort sync failures.
      });
      setDraftConversationCwd(path);
      setDraftCwdError(null);
    } else {
      setConversationCwdDraft(path);
      setConversationCwdEditorOpen(true);
      setConversationCwdError(null);
    }

    setRemoteDirectoryBrowserState(null);
    if (remoteOperationStatus?.scope === 'directory') {
      setRemoteOperationStatus(null);
    }
  }

  const pickDraftConversationCwd = useCallback(async () => {
    if (!draft || draftCwdPickBusy) {
      return;
    }

    if (selectedExecutionTargetIsRemote) {
      openRemoteDirectoryBrowser('draft', draftCwdValue || undefined);
      return;
    }

    setDraftCwdPickBusy(true);
    setDraftCwdError(null);
    try {
      const result = await api.pickFolder({
        cwd: draftCwdValue || undefined,
        prompt: 'Choose a workspace folder',
      });
      if (result.cancelled || !result.path) {
        return;
      }

      const nextWorkspacePaths = syncSavedWorkspacePaths([...savedWorkspacePaths, result.path]);
      void api.setSavedWorkspacePaths(nextWorkspacePaths).catch(() => {
        // Ignore best-effort sync failures.
      });
      setDraftConversationCwd(result.path);
    } catch (error) {
      setDraftCwdError(error instanceof Error ? error.message : 'Could not choose a folder.');
    } finally {
      setDraftCwdPickBusy(false);
    }
  }, [draft, draftCwdPickBusy, draftCwdValue, openRemoteDirectoryBrowser, savedWorkspacePaths, selectedExecutionTargetIsRemote, setDraftConversationCwd, syncSavedWorkspacePaths]);

  const selectDraftConversationWorkspace = useCallback((workspacePath: string) => {
    const normalizedWorkspacePath = workspacePath.trim();
    if (!normalizedWorkspacePath) {
      return;
    }

    setDraftConversationCwd(normalizedWorkspacePath);
    setDraftCwdError(null);
  }, [setDraftConversationCwd]);

  const clearDraftConversationCwdSelection = useCallback(() => {
    clearDraftConversationCwd();
    setDraftCwdValue('');
    setDraftCwdError(null);
  }, []);

  useEffect(() => {
    function handleDesktopShortcut(event: Event) {
      if (document.querySelector('.ui-overlay-backdrop') !== null) {
        return;
      }

      const action = (event as CustomEvent<{ action?: unknown }>).detail?.action;
      if (!isDesktopConversationShortcutAction(action)) {
        return;
      }

      if (action === 'focus-composer') {
        const composer = textareaRef.current;
        if (!composer) {
          return;
        }

        composer.focus();
        const end = composer.value.length;
        composer.selectionStart = end;
        composer.selectionEnd = end;
        return;
      }

      if (action === 'rename-conversation') {
        beginTitleEdit();
        return;
      }

      if (draft) {
        if (draftCwdPickBusy) {
          return;
        }

        void pickDraftConversationCwd();
        return;
      }

      beginConversationCwdEdit();
    }

    window.addEventListener(DESKTOP_SHORTCUT_EVENT, handleDesktopShortcut);
    return () => window.removeEventListener(DESKTOP_SHORTCUT_EVENT, handleDesktopShortcut);
  }, [beginConversationCwdEdit, beginTitleEdit, draft, draftCwdPickBusy, pickDraftConversationCwd]);

  function showSessionSummary() {
    const cwd = draft
      ? (draftCwdValue || 'unset cwd')
      : (currentSessionMeta?.cwd ?? 'unknown cwd');
    const modelLabel = currentModel || model || 'unknown model';
    const details = [
      draft ? 'Draft conversation' : title,
      isLiveSession ? 'active session' : null,
      modelLabel,
      cwd,
      `${messageCount} ${messageCount === 1 ? 'block' : 'blocks'}`,
      sessionTokens ? formatContextUsageLabel(sessionTokens.total, sessionTokens.contextWindow) : null,
    ].filter((value): value is string => Boolean(value));

    showNotice('accent', details.join(' · '), 5000);
  }

  async function copyLastAgentMessage() {
    if (!lastCopyableAgentText) {
      showNotice('danger', 'No assistant message is available to copy right now.', 4000);
      return;
    }

    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      showNotice('danger', 'Clipboard access is unavailable in this browser.', 4000);
      return;
    }

    try {
      await navigator.clipboard.writeText(lastCopyableAgentText);
      showNotice('accent', 'Copied the last assistant message.');
    } catch {
      showNotice('danger', 'Copy to clipboard failed.', 4000);
    }
  }

  async function executeConversationSlashCommand(command: ConversationSlashCommand): Promise<{ kind: 'handled' } | { kind: 'send'; text: string }> {
    switch (command.action) {
      case 'clear':
        setInput('');
        setAttachments([]);
        setDrawingAttachments([]);
        setDrawingsError(null);
        if (!draft) {
          await handleClear();
        }
        return { kind: 'handled' };
      case 'compact': {
        if (draft) {
          showNotice('danger', 'Compaction requires an existing conversation.', 4000);
          return { kind: 'handled' };
        }

        setInput('');
        try {
          const liveConversationId = await ensureConversationIsLive('be compacted');
          await retryLiveSessionActionAfterTakeover({
            attemptAction: () => api.compactSession(liveConversationId, command.customInstructions, currentSurfaceId),
            takeOverSessionControl: () => streamTakeover(),
          });
          showNotice('accent', 'Manual compaction complete.');
        } catch (error) {
          showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
        }
        return { kind: 'handled' };
      }
      case 'copy':
        setInput('');
        await copyLastAgentMessage();
        return { kind: 'handled' };
      case 'draw':
        setInput('');
        openDrawingEditor();
        return { kind: 'handled' };
      case 'drawings':
        setInput('');
        if (!id) {
          showNotice('danger', 'Saved drawings are only available in existing conversations.', 4000);
        } else {
          setDrawingsPickerOpen(true);
        }
        return { kind: 'handled' };
      case 'export': {
        if (draft) {
          showNotice('danger', 'Export requires an existing conversation.', 4000);
          return { kind: 'handled' };
        }

        setInput('');
        try {
          const liveConversationId = await ensureConversationIsLive('be exported');
          const result = await api.exportSession(liveConversationId, command.outputPath);
          showNotice('accent', `Exported session HTML to ${result.path}`, 5000);
        } catch (error) {
          showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
        }
        return { kind: 'handled' };
      }
      case 'fork':
        setInput('');
        if (!id) {
          showNotice('danger', 'Forking requires an existing conversation.', 4000);
          return { kind: 'handled' };
        }
        try {
          const liveConversationId = await ensureConversationIsLive('be forked');
          const entries = await api.forkEntries(liveConversationId);
          const entry = entries[entries.length - 1];
          if (!entry) {
            showNotice('danger', 'No forkable messages yet.', 4000);
            return { kind: 'handled' };
          }

          if (!ensureConversationCanControl('fork it')) {
            return { kind: 'handled' };
          }

          const { newSessionId } = await api.forkSession(liveConversationId, entry.entryId, {
            preserveSource: true,
            beforeEntry: true,
          }, currentSurfaceId);
          persistForkPromptDraft(newSessionId, entry.text);
          ensureConversationTabOpen(newSessionId);
          navigate(`/conversations/${newSessionId}`);
        } catch (error) {
          showNotice('danger', `Fork failed: ${error instanceof Error ? error.message : String(error)}`, 4000);
        }
        return { kind: 'handled' };
      case 'summarizeFork':
        setInput('');
        await summarizeAndForkConversation();
        return { kind: 'handled' };
      case 'image':
        setInput('');
        openFilePicker();
        return { kind: 'handled' };
      case 'name':
        setInput('');
        if (command.name) {
          await renameConversationTo(command.name);
        } else {
          beginTitleEdit();
        }
        return { kind: 'handled' };
      case 'new':
        startNewConversation();
        return { kind: 'handled' };
      case 'reload': {
        if (draft) {
          showNotice('danger', 'Reload requires an existing conversation.', 4000);
          return { kind: 'handled' };
        }

        setInput('');
        try {
          const liveConversationId = await ensureConversationIsLive('reload its resources');
          if (!ensureConversationCanControl('reload its resources')) {
            return { kind: 'handled' };
          }
          await api.reloadSession(liveConversationId, currentSurfaceId);
          showNotice('accent', 'Session resources reloaded.');
        } catch (error) {
          showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
        }
        return { kind: 'handled' };
      }
      case 'run':
        return {
          kind: 'send',
          text: `Run this shell command and show me the output:\n\`\`\`\n${command.command}\n\`\`\``,
        };
      case 'search':
        return { kind: 'send', text: `Search the web for: ${command.query}` };
      case 'session':
        setInput('');
        showSessionSummary();
        return { kind: 'handled' };
      case 'summarize':
        return { kind: 'send', text: 'Summarize our conversation so far concisely.' };
      case 'think':
        return {
          kind: 'send',
          text: command.topic
            ? `Think step-by-step about: ${command.topic}`
            : 'Think step-by-step about our conversation so far and share your reasoning.',
        };
    }
  }

  const handleReplyToSelection = useCallback((selection: { text: string }) => {
    if (!selection.text) {
      return;
    }

    const currentInput = textareaRef.current?.value ?? input;
    const next = insertReplyQuoteIntoComposer(currentInput, selection.text);

    setInput(next.text);
    setSlashIdx(0);
    setMentionIdx(0);
    composerSelectionRef.current = {
      start: next.selectionStart,
      end: next.selectionEnd,
    };

    window.requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el || el.disabled) {
        return;
      }

      el.focus();
      el.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }, [input, setInput]);

  async function runWholeLineBashCommand(inputSnapshot: string, command: { command: string; excludeFromContext: boolean }) {
    if (wholeLineBashRunningRef.current) {
      return;
    }

    const normalizedCommand = command.command.trim();
    if (!normalizedCommand) {
      showNotice('danger', 'Usage: !<command>', 4000);
      return;
    }

    wholeLineBashRunningRef.current = true;
    setWholeLineBashRunning(true);
    setPendingAssistantStatusLabel('Running bash…');
    setInput('');
    rememberComposerInput(inputSnapshot);

    try {
      let conversationId = id ?? null;

      if (!conversationId) {
        const draftExecutionTarget = draftExecutionTargetId.trim() || 'local';
        const draftRemoteCwd = draftExecutionTarget === 'local' ? undefined : (draftCwdValue || null);
        if (draftExecutionTarget !== 'local' && !draftRemoteCwd) {
          throw new Error(`Choose a remote directory on ${selectedExecutionTargetLabel} first.`);
        }

        const created = await api.createLiveSession(
          draftExecutionTarget === 'local' ? (draftCwdValue || undefined) : undefined,
          undefined,
          createLiveSessionPreferenceInput,
        );
        conversationId = created.id;
        if (draftExecutionTarget !== 'local') {
          await applyDraftExecutionTarget(created.id, draftRemoteCwd);
        }
      } else {
        conversationId = await ensureConversationIsLive('run bash commands');
      }

      await api.executeLiveSessionBash(conversationId, normalizedCommand, {
        excludeFromContext: command.excludeFromContext,
      });

      if (draft) {
        clearDraftConversationComposer();
        clearDraftConversationAttachments();
        clearDraftConversationCwd();
        clearDraftConversationModel();
        clearDraftConversationThinkingLevel();
        clearDraftConversationServiceTier();
      }

      if (conversationId !== id) {
        ensureConversationTabOpen(conversationId);
        navigate(`/conversations/${conversationId}`, {
          replace: draft,
          state: {
            initialModelPreferenceState: buildConversationInitialModelPreferenceState({
              conversationId,
              currentModel,
              currentThinkingLevel,
              currentServiceTier,
              hasExplicitServiceTier,
              defaultModel,
              defaultThinkingLevel,
              defaultServiceTier,
            }),
            initialDeferredResumeState: {
              conversationId,
              resumes: [],
            },
          },
        });
        return;
      }

      window.setTimeout(() => {
        scrollToBottom();
      }, 50);
    } catch (error) {
      setInput(inputSnapshot);
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      wholeLineBashRunningRef.current = false;
      setWholeLineBashRunning(false);
      setPendingAssistantStatusLabel(null);
    }
  }

  async function submitComposer(behavior?: 'steer' | 'followUp') {
    if (preparingRelatedThreadContext) {
      return;
    }

    const inputSnapshot = input;
    const text = inputSnapshot.trim();
    const pendingImageAttachments = attachments;
    const pendingDrawingAttachments = drawingAttachments;
    const pendingAttachedContextDocs = attachedContextDocs;
    if (!text && pendingImageAttachments.length === 0 && pendingDrawingAttachments.length === 0) {
      return;
    }

    let slashTextToSend: string | null = null;
    if (pendingImageAttachments.length === 0 && pendingDrawingAttachments.length === 0) {
      const wholeLineBash = parseWholeLineBashCommand(text);
      if (wholeLineBash) {
        await runWholeLineBashCommand(inputSnapshot, wholeLineBash);
        return;
      }

      const deferredResumeSlash = parseDeferredResumeSlashCommand(text);
      if (deferredResumeSlash) {
        if (deferredResumeSlash.kind === 'invalid') {
          showNotice('danger', deferredResumeSlash.message, 4000);
        } else {
          rememberComposerInput(inputSnapshot);
          await scheduleDeferredResume(
            deferredResumeSlash.command.delay,
            deferredResumeSlash.command.prompt,
            deferredResumeSlash.command.behavior,
          );
        }
        return;
      }

      const conversationSlash = parseConversationSlashCommand(text);
      if (conversationSlash) {
        if (conversationSlash.kind === 'invalid') {
          showNotice('danger', conversationSlash.message, 4000);
          return;
        }

        if (!['run', 'search', 'summarize', 'think'].includes(conversationSlash.command.action)) {
          rememberComposerInput(inputSnapshot);
        }

        const slashResult = await executeConversationSlashCommand(conversationSlash.command);
        if (slashResult.kind === 'handled') {
          return;
        }

        slashTextToSend = slashResult.text;
      }
    }

    try {
      const filePromptImages = await buildPromptImages(pendingImageAttachments);
      const drawingPromptImages = pendingDrawingAttachments.map((drawing) => drawingAttachmentToPromptImage(drawing));
      const promptImages = [...filePromptImages, ...drawingPromptImages];
      const textToSend = slashTextToSend ?? text;

      setInput('');
      setAttachments([]);
      setDrawingAttachments([]);
      setDrawingsError(null);

      const requestedBehavior = behavior ?? (isLiveSession ? defaultComposerBehavior : undefined);
      const queuedBehavior = normalizeConversationComposerBehavior(requestedBehavior, allowQueuedPrompts);
      const draftExecutionTarget = draftExecutionTargetId.trim() || 'local';
      const draftRemoteCwd = draftExecutionTarget === 'local' ? undefined : (draftCwdValue || null);
      if (!id && !visibleSessionDetail && draftExecutionTarget !== 'local' && !draftRemoteCwd) {
        showNotice('danger', `Choose a remote directory on ${selectedExecutionTargetLabel} first.`, 4000);
        setInput(inputSnapshot);
        setAttachments(pendingImageAttachments);
        setDrawingAttachments(pendingDrawingAttachments);
        return;
      }

      const persistPromptDrawings = async (conversationId: string): Promise<PromptAttachmentRefInput[]> => {
        if (pendingDrawingAttachments.length === 0) {
          return [];
        }

        setDrawingsBusy(true);
        try {
          const persistedDrawings = await persistDrawingsForConversation(conversationId, pendingDrawingAttachments);
          return persistedDrawings
            .map((drawing) => drawingAttachmentToPromptRef(drawing))
            .filter((attachmentRef): attachmentRef is PromptAttachmentRefInput => attachmentRef !== null);
        } finally {
          setDrawingsBusy(false);
        }
      };

      const persistPromptContextDocs = async (conversationId: string): Promise<ConversationContextDocRef[]> => {
        if (pendingAttachedContextDocs.length === 0) {
          return [];
        }

        const result = await api.updateConversationContextDocs(conversationId, pendingAttachedContextDocs);
        return result.attachedContextDocs;
      };

      if (!id && !visibleSessionDetail) {
        const selectedRelatedThreadIdsSnapshot = [...selectedRelatedThreadIds];

        if (selectedRelatedThreadIdsSnapshot.length > 0) {
          let createdSessionId: string | null = null;
          let navigatedToCreatedConversation = false;
          setPreparingRelatedThreadContext(true);
          setPendingAssistantStatusLabel('Creating conversation…');

          try {
            const created = await api.createLiveSession(
              draftExecutionTarget === 'local' ? (draftCwdValue || undefined) : undefined,
              undefined,
              createLiveSessionPreferenceInput,
            );
            createdSessionId = created.id;
            if (draftExecutionTarget === 'local') {
              primeCreatedConversationOpenCaches(created, {
                tailBlocks: INITIAL_HISTORICAL_TAIL_BLOCKS,
                bootstrapVersionKey: conversationVersionKey,
                sessionDetailVersion: conversationEventVersion,
              });
            } else {
              await applyDraftExecutionTarget(created.id, draftRemoteCwd);
            }

            const attachmentRefs = await persistPromptDrawings(created.id);
            await persistPromptContextDocs(created.id);

            const initialPrompt: PendingConversationPrompt = {
              text: textToSend,
              behavior: queuedBehavior,
              images: promptImages,
              attachmentRefs,
              relatedConversationIds: selectedRelatedThreadIdsSnapshot,
            };

            rememberComposerInput(inputSnapshot, created.id);
            persistPendingConversationPrompt(created.id, initialPrompt);

            clearDraftConversationAttachments();
            clearDraftConversationContextDocs();
            clearDraftConversationCwd();
            clearDraftConversationModel();
            clearDraftConversationThinkingLevel();
            clearDraftConversationServiceTier();
            setSelectedRelatedThreadIds([]);

            ensureConversationTabOpen(created.id);
            navigate(`/conversations/${created.id}`, {
              replace: true,
              state: {
                initialModelPreferenceState: buildConversationInitialModelPreferenceState({
                  conversationId: created.id,
                  currentModel,
                  currentThinkingLevel,
                  currentServiceTier,
                  hasExplicitServiceTier,
                  defaultModel,
                  defaultThinkingLevel,
                  defaultServiceTier,
                }),
                initialDeferredResumeState: {
                  conversationId: created.id,
                  resumes: [],
                },
              },
            });
            navigatedToCreatedConversation = true;
          } catch (error) {
            if (createdSessionId && !navigatedToCreatedConversation) {
              await api.destroySession(createdSessionId).catch(() => {});
            }
            showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
            await restoreComposerDraft(inputSnapshot, pendingImageAttachments, pendingDrawingAttachments);
          } finally {
            setPreparingRelatedThreadContext(false);
            setPendingAssistantStatusLabel(null);
          }
          return;
        }

        rememberComposerInput(inputSnapshot);
        setDraftPendingPrompt({
          text: textToSend,
          behavior: queuedBehavior,
          images: promptImages,
          attachmentRefs: [],
        });
        setPendingAssistantStatusLabel(resolveConversationPendingStatusLabel({
          isLiveSession: false,
          hasVisibleSessionDetail: false,
        }));
        let createdSessionId: string | null = null;
        let navigatedToCreatedConversation = false;
        try {
          const created = await api.createLiveSession(
            draftExecutionTarget === 'local' ? (draftCwdValue || undefined) : undefined,
            undefined,
            createLiveSessionPreferenceInput,
          );
          createdSessionId = created.id;
          if (draftExecutionTarget === 'local') {
            primeCreatedConversationOpenCaches(created, {
              tailBlocks: INITIAL_HISTORICAL_TAIL_BLOCKS,
              bootstrapVersionKey: conversationVersionKey,
              sessionDetailVersion: conversationEventVersion,
            });
          } else {
            await applyDraftExecutionTarget(created.id, draftRemoteCwd);
          }
          const newId = created.id;
          const attachmentRefs = await persistPromptDrawings(newId);
          await persistPromptContextDocs(newId);
          const initialPrompt = {
            text: textToSend,
            behavior: queuedBehavior,
            images: promptImages,
            attachmentRefs,
          };

          rememberComposerInput(inputSnapshot, newId);
          persistPendingConversationPrompt(newId, initialPrompt);
          setPendingConversationPromptDispatching(newId, true);

          clearDraftConversationAttachments();
          clearDraftConversationContextDocs();
          clearDraftConversationCwd();
          clearDraftConversationModel();
          clearDraftConversationThinkingLevel();
          clearDraftConversationServiceTier();

          ensureConversationTabOpen(newId);
          navigate(`/conversations/${newId}`, {
            replace: true,
            state: {
              initialModelPreferenceState: buildConversationInitialModelPreferenceState({
                conversationId: newId,
                currentModel,
                currentThinkingLevel,
                currentServiceTier,
                hasExplicitServiceTier,
                defaultModel,
                defaultThinkingLevel,
                defaultServiceTier,
              }),
              initialDeferredResumeState: {
                conversationId: newId,
                resumes: [],
              },
            },
          });
          navigatedToCreatedConversation = true;

          // Kick off the first turn immediately, but do not hold route
          // navigation open on the prompt-start roundtrip. The pending prompt
          // stays mirrored in storage until the new conversation page can see
          // the accepted user turn in its transcript, so the optimistic state
          // survives the route handoff and can still retry if this detached
          // start fails before that handoff completes.
          void api.promptSession(
            newId,
            initialPrompt.text,
            initialPrompt.behavior,
            initialPrompt.images,
            initialPrompt.attachmentRefs,
          ).catch((error) => {
            setPendingConversationPromptDispatching(newId, false);
            console.error('Initial prompt failed:', error);
          });
        } catch (error) {
          if (createdSessionId && !navigatedToCreatedConversation) {
            await api.destroySession(createdSessionId).catch(() => {});
          }
          setPendingAssistantStatusLabel(null);
          setDraftPendingPrompt(null);
          showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
          await restoreComposerDraft(inputSnapshot, pendingImageAttachments, pendingDrawingAttachments);
        }
        return;
      }

      if (!id) {
        return;
      }

      if (!isLiveSession && !visibleSessionDetail) {
        showNotice('danger', 'Conversation is still loading. Try sending again in a moment.', 4000);
        await restoreComposerDraft(inputSnapshot, pendingImageAttachments, pendingDrawingAttachments);
        return;
      }

      const attachmentRefs = await persistPromptDrawings(id);

      if (isLiveSession) {
        rememberComposerInput(inputSnapshot);
        setPendingAssistantStatusLabel(resolveConversationPendingStatusLabel({
          isLiveSession,
          hasVisibleSessionDetail: Boolean(visibleSessionDetail),
        }));

        try {
          await stream.send(textToSend, queuedBehavior, promptImages, attachmentRefs);
        } catch (error) {
          if (!isConversationSessionNotLiveError(error)) {
            throw error;
          }

          setConfirmedLive(false);
          const recovered = await api.recoverConversation(id);
          if (recovered.conversationId !== id) {
            ensureConversationTabOpen(recovered.conversationId);
            navigate(`/conversations/${recovered.conversationId}`);
            return;
          }

          setConfirmedLive(true);
          stream.reconnect();
          setPendingAssistantStatusLabel('Resuming…');
          await stream.send(textToSend, queuedBehavior, promptImages, attachmentRefs);
        }

        await refetchConversationAttachments();

        window.setTimeout(() => {
          scrollToBottom();
        }, 50);
      } else if (visibleSessionDetail) {
        try {
          rememberComposerInput(inputSnapshot);
          setPendingAssistantStatusLabel(resolveConversationPendingStatusLabel({
            isLiveSession: false,
            hasVisibleSessionDetail: true,
          }));
          const recovered = await api.recoverConversation(id);
          if (recovered.conversationId !== id) {
            ensureConversationTabOpen(recovered.conversationId);
            navigate(`/conversations/${recovered.conversationId}`);
            return;
          }
          setConfirmedLive(true);
          stream.reconnect();
          setPendingAssistantStatusLabel('Working…');
          await stream.send(textToSend, queuedBehavior, promptImages, attachmentRefs);
          await refetchConversationAttachments();
          window.setTimeout(() => {
            scrollToBottom();
          }, 50);
        } catch (error) {
          console.error('Auto-resume failed:', error);
          setPendingAssistantStatusLabel(null);
          await restoreComposerDraft(inputSnapshot, pendingImageAttachments, pendingDrawingAttachments);
          showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
        }
      }
    } catch (error) {
      console.error('Failed to prepare attachments:', error);
      setPendingAssistantStatusLabel(null);
      await restoreComposerDraft(inputSnapshot, pendingImageAttachments, pendingDrawingAttachments);
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  async function submitParallelComposer() {
    if (draft || !id || !isLiveSession) {
      showNotice('danger', 'Parallel prompts require a live conversation.', 4000);
      return;
    }

    if (!stream.isStreaming && !liveSessionHasPendingHiddenTurn) {
      showNotice('danger', 'Parallel prompts are only available while this conversation is busy.', 4000);
      return;
    }

    const inputSnapshot = input;
    const text = inputSnapshot.trim();
    const pendingImageAttachments = attachments;
    const pendingDrawingAttachments = drawingAttachments;
    if (!text && pendingImageAttachments.length === 0 && pendingDrawingAttachments.length === 0) {
      return;
    }

    try {
      const filePromptImages = await buildPromptImages(pendingImageAttachments);
      const drawingPromptImages = pendingDrawingAttachments.map((drawing) => drawingAttachmentToPromptImage(drawing));
      const promptImages = [...filePromptImages, ...drawingPromptImages];

      const persistPromptDrawings = async (): Promise<PromptAttachmentRefInput[]> => {
        if (pendingDrawingAttachments.length === 0) {
          return [];
        }

        setDrawingsBusy(true);
        try {
          const persistedDrawings = await persistDrawingsForConversation(id, pendingDrawingAttachments);
          return persistedDrawings
            .map((drawing) => drawingAttachmentToPromptRef(drawing))
            .filter((attachmentRef): attachmentRef is PromptAttachmentRefInput => attachmentRef !== null);
        } finally {
          setDrawingsBusy(false);
        }
      };

      const attachmentRefs = await persistPromptDrawings();
      rememberComposerInput(inputSnapshot);
      setInput('');
      setAttachments([]);
      setDrawingAttachments([]);
      setDrawingsError(null);

      await streamParallel(text, promptImages, attachmentRefs);
      await refetchConversationAttachments();
      showNotice('accent', 'Parallel prompt started.', 2500);
    } catch (error) {
      await restoreComposerDraft(inputSnapshot, pendingImageAttachments, pendingDrawingAttachments);
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  async function submitComposerActionForModifiers(altKeyHeld: boolean, parallelKeyHeld: boolean) {
    const nextSubmit = resolveConversationComposerSubmitState(
      stream.isStreaming,
      altKeyHeld,
      liveSessionHasPendingHiddenTurn,
      parallelKeyHeld,
    );

    if (nextSubmit.action === 'parallel') {
      await submitParallelComposer();
      return;
    }

    await submitComposer(nextSubmit.behavior);
  }

  async function manageParallelJob(jobId: string, action: 'importNow' | 'skip' | 'cancel') {
    if (draft || !id || !isLiveSession) {
      showNotice('danger', 'Parallel prompts require a live conversation.', 4000);
      return;
    }

    try {
      const result = await streamManageParallelJob(jobId, action);
      if (!result) {
        return;
      }

      if (action === 'importNow') {
        showNotice('accent', result.status === 'imported' ? 'Parallel response appended.' : 'Parallel response queued for append.', 2500);
        return;
      }

      if (action === 'skip') {
        showNotice('accent', 'Parallel response skipped.', 2500);
        return;
      }

      showNotice('accent', 'Parallel prompt cancelled.', 2500);
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  async function restoreQueuedPromptToComposer(behavior: 'steer' | 'followUp', queueIndex: number, previewId?: string) {
    if (!id || !isLiveSession) {
      showNotice('danger', 'Queued prompts can only be restored from a live session.', 4000);
      return;
    }

    try {
      if (!ensureConversationCanControl('restore queued prompts')) {
        return;
      }

      const restored = await api.restoreQueuedMessage(id, {
        behavior,
        index: queueIndex,
        ...(previewId ? { previewId } : {}),
      }, currentSurfaceId);
      const restoredText = typeof restored.text === 'string' ? restored.text : '';
      const restoredFiles = restoreQueuedImageFiles(restored.images, behavior, queueIndex);
      const hasRestoredText = restoredText.trim().length > 0;

      if (!hasRestoredText && restoredFiles.length === 0) {
        showNotice('danger', 'Queued prompt had nothing to restore.', 4000);
        return;
      }

      if (hasRestoredText) {
        const currentInput = textareaRef.current?.value ?? input;
        setInput([restoredText, currentInput].filter((value) => value.trim().length > 0).join('\n\n'));
      }
      if (restoredFiles.length > 0) {
        setAttachments((current) => [...restoredFiles, ...current]);
      }

      moveComposerCaretToEnd();

      const restoredParts = [
        hasRestoredText ? 'text' : null,
        restoredFiles.length > 0 ? `${restoredFiles.length} image${restoredFiles.length === 1 ? '' : 's'}` : null,
      ].filter((value): value is string => Boolean(value));
      showNotice('accent', `Restored queued ${restoredParts.join(' + ')} to the composer.`);
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) {
      return;
    }

    e.preventDefault();
    void addComposerFiles(files);
  }

  function canNavigateComposerHistory(textarea: HTMLTextAreaElement, key: 'ArrowUp' | 'ArrowDown'): boolean {
    if (textarea.selectionStart !== textarea.selectionEnd) {
      return false;
    }

    const caret = textarea.selectionStart;
    return key === 'ArrowUp'
      ? !textarea.value.slice(0, caret).includes('\n')
      : !textarea.value.slice(caret).includes('\n');
  }

  // Keyboard handling
  async function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c' && !e.nativeEvent.isComposing) {
      if (input.trim().length > 0) {
        rememberComposerInput(input);
      }
      if (input.length > 0 || attachments.length > 0 || drawingAttachments.length > 0) {
        e.preventDefault();
        setInput('');
        setAttachments([]);
        setDrawingAttachments([]);
      }
      return;
    }

    if (showModelPicker) {
      if (e.key === 'Escape')    { e.preventDefault(); setInput(''); return; }
      if (modelItems.length === 0) {
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); setModelIdx(i => (i + 1) % modelItems.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setModelIdx(i => (i - 1 + modelItems.length) % modelItems.length); return; }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const sel = modelItems[modelIdx % modelItems.length];
        if (sel) selectModel(sel.id);
        return;
      }
    }
    if (showSlash || showMention) {
      if (e.key === 'ArrowDown') { e.preventDefault(); showSlash ? setSlashIdx(i => i + 1) : setMentionIdx(i => i + 1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); showSlash ? setSlashIdx(i => Math.max(0, i - 1)) : setMentionIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setInput(''); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        if (showSlash && e.key === 'Enter') {
          const exactConversationSlash = parseConversationSlashCommand(input.trim());
          if (exactConversationSlash) {
            e.preventDefault();
            await submitComposer();
            return;
          }
        }

        e.preventDefault();
        if (showSlash) {
          const sel = slashItems[slashIdx % (slashItems.length || 1)];
          if (sel) {
            const parsedSelectedSlash = parseConversationSlashCommand(sel.displayCmd.trim());
            if (parsedSelectedSlash?.kind === 'command') {
              setSlashIdx(0);
              await executeConversationSlashCommand(parsedSelectedSlash.command);
            } else {
              setInput(sel.insertText);
              setSlashIdx(0);
            }
          }
        } else {
          const filtered = filterMentionItems(mentionItems, mentionQuery, { limit: MAX_MENTION_MENU_ITEMS });
          const sel = filtered[mentionIdx % (filtered.length || 1)];
          if (sel) { setInput(input.replace(/@[\w./-]*$/, sel.id + ' ')); setMentionIdx(0); }
        }
        return;
      }
    }

    const canUseComposerQuestionHotkeys = Boolean(pendingAskUserQuestion)
      && !composerQuestionSubmitting
      && input.length === 0
      && attachments.length === 0
      && drawingAttachments.length === 0
      && !e.ctrlKey
      && !e.metaKey
      && !e.altKey
      && !e.nativeEvent.isComposing;

    if (canUseComposerQuestionHotkeys) {
      if (e.key === 'ArrowDown' && composerActiveQuestion) {
        e.preventDefault();
        setComposerQuestionOptionIndex((current) => moveAskUserQuestionIndex(current, composerActiveQuestion.options.length, 1));
        return;
      }

      if (e.key === 'ArrowUp' && composerActiveQuestion) {
        e.preventDefault();
        setComposerQuestionOptionIndex((current) => moveAskUserQuestionIndex(current, composerActiveQuestion.options.length, -1));
        return;
      }

      const optionHotkeyIndex = resolveAskUserQuestionOptionHotkey(e.key);
      if (composerActiveQuestion && optionHotkeyIndex >= 0 && optionHotkeyIndex < composerActiveQuestion.options.length) {
        e.preventDefault();
        handleComposerQuestionOptionSelect(composerQuestionIndex, optionHotkeyIndex);
        return;
      }

      const questionDirection = e.key === 'Tab'
        ? (e.shiftKey ? -1 : 1)
        : e.key === 'ArrowRight'
          ? 1
          : e.key === 'ArrowLeft'
            ? -1
            : 0;
      if (questionDirection !== 0) {
        const pendingPresentation = pendingAskUserQuestion?.presentation;
        if (!pendingPresentation) {
          return;
        }

        e.preventDefault();
        if (questionDirection > 0) {
          if (composerQuestionIndex < pendingPresentation.questions.length - 1) {
            activateComposerQuestion(composerQuestionIndex + 1);
          }
        } else {
          activateComposerQuestion(Math.max(0, composerQuestionIndex - 1));
        }
        return;
      }

      if ((e.key === 'Enter' || e.key === ' ') && !e.shiftKey) {
        e.preventDefault();
        if (composerQuestionCanSubmit) {
          await submitComposerQuestionIfReady();
        } else if (composerActiveQuestion?.options.length) {
          handleComposerQuestionOptionSelect(composerQuestionIndex, composerQuestionOptionIndex);
        }
        return;
      }
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (canNavigateComposerHistory(e.currentTarget, e.key) && navigateComposerHistory(e.key === 'ArrowUp' ? 'older' : 'newer')) {
        e.preventDefault();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      await submitComposerActionForModifiers(e.altKey, e.ctrlKey || e.metaKey);
    }
  }

  // Drag-and-drop
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function handleDragLeave() { setDragOver(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      void addComposerFiles(files);
    }
  }
  function removeAttachment(i: number) {
    setAttachments(prev => prev.filter((_, j) => j !== i));
  }

  async function saveAttachedContextDocs(nextDocs: ConversationContextDocRef[]) {
    const normalized = dedupeConversationContextDocs(nextDocs);

    if (draft) {
      setAttachedContextDocs(normalized);
      persistDraftConversationContextDocs(normalized);
      return normalized;
    }

    if (!id) {
      return attachedContextDocs;
    }

    setContextDocsBusy(true);
    try {
      const result = await api.updateConversationContextDocs(id, normalized);
      setAttachedContextDocs(result.attachedContextDocs);
      return result.attachedContextDocs;
    } finally {
      setContextDocsBusy(false);
    }
  }

  async function attachMentionedDocsToConversation(items: Array<MentionItem & { path: string }>) {
    if (items.length === 0) {
      return;
    }

    try {
      await saveAttachedContextDocs([
        ...attachedContextDocs,
        ...items.map((item) => mentionItemToConversationContextDoc(item)),
      ]);
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  async function removeAttachedContextDoc(path: string) {
    try {
      await saveAttachedContextDocs(attachedContextDocs.filter((doc) => doc.path !== path));
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  const composerHasContent = input.trim().length > 0 || attachments.length > 0 || drawingAttachments.length > 0;
  const composerShowsQuestionSubmit = shouldShowQuestionSubmitAsPrimaryComposerAction(
    Boolean(pendingAskUserQuestion),
    composerHasContent,
    stream.isStreaming,
  );
  const composerSubmit = resolveConversationComposerSubmitState(
    stream.isStreaming,
    composerAltHeld,
    liveSessionHasPendingHiddenTurn,
    composerParallelHeld,
  );
  const showScrollToBottomControl = shouldShowScrollToBottomControl(messageCount, atBottom);
  const composerDisabled = conversationNeedsTakeover || preparingRelatedThreadContext || wholeLineBashRunning;
  const screenshotCaptureAvailable = getDesktopBridge() !== null
    && (typeof navigator === 'undefined' || /Mac/i.test(navigator.userAgent));
  const renameConversationDisabled = conversationNeedsTakeover
    || conversationCwdEditorOpen
    || conversationCwdBusy;
  const hasComposerShelfContent = attachedContextDocs.length > 0
    || draftMentionItems.length > 0
    || pendingQueue.length > 0
    || parallelJobs.length > 0
    || (!draft && orderedDeferredResumes.length > 0)
    || Boolean(pendingAskUserQuestion && composerActiveQuestion);
  const hasComposerAttachmentShelfContent = attachments.length > 0
    || drawingAttachments.length > 0
    || drawingsBusy
    || Boolean(drawingsError);
  const keyboardOpen = keyboardInset > 120;
  const conversationPerformanceMode = resolveConversationPerformanceMode({
    messageCount: realMessages?.length ?? 0,
  });
  // Keep the rail off once transcripts are large enough to trigger aggressive
  // transcript rendering. The rail continuously re-measures mounted message
  // markers, which makes composer-driven layout work scale with transcript size.
  const showConversationRail = shouldRenderConversationRail({
    hasRenderableMessages,
    realMessages,
    performanceMode: conversationPerformanceMode,
  });
  const editingDrawingAttachment = useMemo(() => {
    if (!editingDrawingLocalId || editingDrawingLocalId === '__new__') {
      return null;
    }

    return drawingAttachments.find((attachment) => attachment.localId === editingDrawingLocalId) ?? null;
  }, [drawingAttachments, editingDrawingLocalId]);
  const visibleTranscriptState = hasRenderableMessages && realMessages
    ? {
        conversationId: id ?? 'draft-conversation',
        messages: realMessages,
        historicalBlockOffset,
        historicalTotalBlocks,
      }
    : (showConversationLoadingState && !draft ? stableTranscriptState : null);
  const visibleTranscriptMessages = visibleTranscriptState?.messages;
  const visibleTranscriptMessageIndexOffset = visibleTranscriptState?.historicalBlockOffset ?? 0;
  const visibleTranscriptHasOlderBlocks = !showConversationLoadingState
    && !draft
    && Boolean(id)
    && visibleTranscriptState?.conversationId === id
    && showHistoricalLoadMore;
  const renderingStaleTranscript = Boolean(visibleTranscriptState?.conversationId && id && visibleTranscriptState.conversationId !== id);
  const showInlineConversationLoadingState = shouldShowConversationInlineLoadingState({
    showConversationLoadingState,
    hasVisibleTranscript: Boolean(visibleTranscriptMessages?.length),
  });
  const showBlockingConversationLoadingState = showConversationLoadingState && !showInlineConversationLoadingState;

  useEffect(() => {
    if (!id || draft || showConversationLoadingState) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      completeConversationOpenPhase(id, 'content', {
        renderState: hasRenderableMessages ? 'messages' : sessionError ? 'error' : 'empty',
        messageCount: realMessages?.length ?? 0,
        sessionLoading,
        isLiveSession,
        hasStreamSnapshot: stream.hasSnapshot,
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [draft, hasRenderableMessages, id, isLiveSession, realMessages?.length, sessionError, sessionLoading, showConversationLoadingState, stream.hasSnapshot]);

  const transcriptPane = useMemo(() => (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        className="conversation-scroll-shell h-full overflow-y-auto overflow-x-hidden"
        style={{ scrollPaddingTop: `${conversationHeaderOffset + 16}px` }}
      >
        <div ref={conversationHeaderRef} className="sticky top-0 z-30 bg-base/95 px-4 pt-3 backdrop-blur sm:px-6 sm:pt-4">
          <div className="mx-auto w-full max-w-6xl pb-3 pt-1">
            <div className="max-w-4xl">
              {isEditingTitle && !draft ? (
                <form
                  className="max-w-4xl space-y-3 pr-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveTitleEdit();
                  }}
                >
                  <input
                    ref={titleInputRef}
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelTitleEdit();
                      }
                    }}
                    placeholder="Name this conversation"
                    className="w-full rounded-2xl border border-transparent bg-transparent -mx-3 px-3 py-2 text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] text-primary outline-none transition-colors placeholder:text-dim/60 hover:border-border-subtle/70 hover:bg-base/25 focus:border-accent/45 focus:bg-base/35 sm:text-[34px]"
                    disabled={titleSaving}
                  />
                  <div className="flex items-center gap-2 pl-0.5">
                    <button type="submit" className="ui-toolbar-button text-primary" disabled={titleSaving}>
                      {titleSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" className="ui-toolbar-button" onClick={cancelTitleEdit} disabled={titleSaving}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : draft ? (
                <h1 className="max-w-4xl break-words pr-4 text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] text-primary sm:text-[34px]">{title}</h1>
              ) : (
                <ConversationSavedHeader
                  title={title}
                  cwd={currentCwd}
                  onTitleClick={!renameConversationDisabled ? beginTitleEdit : undefined}
                  cwdEditing={false}
                  cwdDraft={conversationCwdDraft}
                  cwdError={null}
                  cwdSaveBusy={conversationCwdBusy}
                  onCwdDraftChange={(value) => {
                    setConversationCwdDraft(value);
                    if (conversationCwdError) {
                      setConversationCwdError(null);
                    }
                  }}
                  onCancelEditingCwd={cancelConversationCwdEdit}
                  onSaveCwd={() => { void submitConversationCwdChange(); }}
                />
              )}
            </div>
            {visibleTranscriptHasOlderBlocks && (
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border-subtle/30 pt-3">
                <div className="min-w-0 text-[11px] text-secondary/80">
                  Showing latest <span className="font-medium text-primary/85">{realMessages?.length ?? visibleTranscriptMessages.length}</span> of{' '}
                  <span className="font-medium text-primary/85">{historicalTotalBlocks}</span> blocks.
                </div>
                <button
                  type="button"
                  onClick={() => loadOlderMessages()}
                  disabled={sessionLoading}
                  className="ui-toolbar-button shrink-0 text-[11px] text-secondary/90 hover:text-primary"
                >
                  {sessionLoading ? 'Loading older…' : `Load ${Math.min(HISTORICAL_TAIL_BLOCKS_STEP, historicalBlockOffset)} older`}
                </button>
              </div>
            )}
          </div>
        </div>
        {showBlockingConversationLoadingState ? (
          <LoadingState
            label="Loading messages…"
            className="justify-center h-full"
          />
        ) : visibleTranscriptMessages ? (
          <>
            <ChatView
              key={visibleTranscriptState?.conversationId ?? id ?? 'draft-conversation'}
              messages={visibleTranscriptMessages}
              messageIndexOffset={visibleTranscriptMessageIndexOffset}
              scrollContainerRef={scrollRef}
              focusMessageIndex={renderingStaleTranscript ? null : requestedFocusMessageIndex}
              isStreaming={renderingStaleTranscript ? false : stream.isStreaming}
              isCompacting={renderingStaleTranscript ? false : stream.isCompacting}
              pendingStatusLabel={renderingStaleTranscript ? null : displayedPendingAssistantStatusLabel}
              performanceMode={conversationPerformanceMode}
              onForkMessage={!renderingStaleTranscript && id && !stream.isStreaming ? forkConversationFromMessage : undefined}
              onRewindMessage={!renderingStaleTranscript && id && !stream.isStreaming ? rewindConversationFromMessage : undefined}
              onReplyToSelection={renderingStaleTranscript ? undefined : handleReplyToSelection}
              onHydrateMessage={renderingStaleTranscript ? undefined : hydrateHistoricalBlock}
              hydratingMessageBlockIds={renderingStaleTranscript ? undefined : hydratingHistoricalBlockIdSet}
              onOpenArtifact={renderingStaleTranscript ? undefined : openArtifact}
              activeArtifactId={renderingStaleTranscript ? null : selectedArtifactId}
              onOpenCheckpoint={renderingStaleTranscript ? undefined : openCheckpoint}
              activeCheckpointId={renderingStaleTranscript ? null : selectedCheckpointId}
              onSubmitAskUserQuestion={renderingStaleTranscript ? undefined : submitAskUserQuestion}
              askUserQuestionDisplayMode="composer"
              onResumeConversation={renderingStaleTranscript || !conversationResumeState.canResume ? undefined : resumeConversation}
              resumeConversationBusy={renderingStaleTranscript ? false : resumeConversationBusy}
              resumeConversationTitle={renderingStaleTranscript ? undefined : conversationResumeState.title}
              resumeConversationLabel={conversationResumeState.actionLabel ?? 'continue'}
              windowingBadgeTopOffset={conversationHeaderOffset + 12}
            />
          </>
        ) : (
          <AppPageEmptyState
            align={draft ? 'start' : 'center'}
            className={draft ? 'px-4 pt-12 sm:px-6' : undefined}
            contentClassName={draft ? `${DRAFT_EMPTY_STATE_CONTENT_WIDTH_CLASS} text-left` : undefined}
            icon={draft ? undefined : (
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center mx-auto">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                  <path d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
                </svg>
              </div>
            )}
            title={draft ? <span className="sr-only">Choose a workspace</span> : (isLiveSession ? 'No messages yet' : 'This conversation is empty')}
            body={draft
              ? undefined
              : isLiveSession
                ? 'This conversation is live but has no messages yet. Send a prompt to get started.'
                : 'Start a Pi session to populate this conversation.'}
            action={draft ? (
              <div className="mt-4 w-full space-y-3">
                <div className="flex items-center justify-start gap-2 text-[11px] uppercase tracking-[0.16em] text-dim/80">
                  <FolderIcon className="text-accent" />
                  <span>Workspace</span>
                </div>
                <div className="flex w-full flex-wrap items-center justify-start gap-1.5">
                  {selectedExecutionTargetIsRemote ? (
                    <label className="min-w-[16rem] max-w-full flex-1 rounded-md border border-border-subtle bg-surface/45 px-2 shadow-sm">
                      <span className="sr-only">Remote workspace path</span>
                      <input
                        value={draftCwdValue}
                        onChange={(event) => {
                          setDraftConversationCwd(event.target.value);
                          if (draftCwdError) {
                            setDraftCwdError(null);
                          }
                        }}
                        className="h-10 w-full min-w-0 bg-transparent font-mono text-[13px] text-primary outline-none placeholder:text-secondary/70"
                        aria-label="Remote workspace path"
                        placeholder="~/workingdir/project"
                        spellCheck={false}
                      />
                    </label>
                  ) : (
                    <label className="relative min-w-[16rem] max-w-full flex-1 rounded-md border border-border-subtle bg-surface/45 px-2 shadow-sm">
                      <span className="sr-only">Saved workspace</span>
                      <select
                        value={draftCwdValue}
                        onChange={(event) => {
                          const nextWorkspacePath = event.target.value.trim();
                          if (!nextWorkspacePath) {
                            clearDraftConversationCwdSelection();
                            return;
                          }

                          selectDraftConversationWorkspace(nextWorkspacePath);
                        }}
                        className={cx(
                          EMPTY_STATE_WORKSPACE_SELECT_CLASS,
                          hasDraftCwd ? 'font-mono text-primary' : 'text-secondary',
                        )}
                        aria-label="Saved workspace"
                        title={hasDraftCwd
                          ? draftCwdValue
                          : 'Using the saved default from Settings, or the current repo root if no default is saved.'}
                        disabled={draftCwdPickBusy || (savedWorkspacePathsLoading && availableDraftWorkspacePaths.length === 0)}
                      >
                        <option value="">
                          {savedWorkspacePathsLoading && availableDraftWorkspacePaths.length === 0
                            ? 'Loading workspaces…'
                            : 'Use saved default workspace'}
                        </option>
                        {availableDraftWorkspacePaths.map((workspacePath) => (
                          <option key={workspacePath} value={workspacePath}>
                            {workspacePath}
                          </option>
                        ))}
                      </select>
                      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-dim/70">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </label>
                  )}

                  <BrowsePathButton
                    busy={draftCwdPickBusy}
                    onClick={() => { void pickDraftConversationCwd(); }}
                    title={draftCwdPickBusy ? 'Choosing workspace…' : selectedExecutionTargetIsRemote ? `Choose directory on ${selectedExecutionTargetLabel}` : 'Choose workspace folder'}
                    ariaLabel={selectedExecutionTargetIsRemote ? `Choose directory on ${selectedExecutionTargetLabel}` : 'Choose workspace folder'}
                  />
                </div>

                {selectedExecutionTargetIsRemote ? (
                  <p className="text-[11px] text-secondary">Remote path on {selectedExecutionTargetLabel}.</p>
                ) : null}

                {draftCwdError && (
                  <p className="text-[11px] text-danger/80">{draftCwdError}</p>
                )}

                <DraftRelatedThreadsPanel
                  query={debouncedRelatedThreadsQuery}
                  results={visibleRelatedThreadResults}
                  selectedSessionIds={selectedRelatedThreadIds}
                  selectedCount={selectedRelatedThreadIds.length}
                  loading={relatedThreadSearchLoading}
                  busy={preparingRelatedThreadContext}
                  error={relatedThreadSearchError}
                  maxSelections={MAX_RELATED_THREAD_SELECTIONS}
                  hotkeyLimit={MAX_RELATED_THREAD_HOTKEYS}
                  onToggle={toggleRelatedThreadSelection}
                />
              </div>
            ) : undefined}
          />
        )}
        {!showConversationLoadingState && showScrollToBottomControl && (
          <button
            onClick={() => {
              scrollToBottom({ behavior: 'smooth' });
            }}
            className="sticky bottom-4 left-1/2 -translate-x-1/2 ui-pill ui-pill-muted shadow-md"
          >
            ↓ scroll to bottom
          </button>
        )}
      </div>
      {showInlineConversationLoadingState && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-base/85 px-6 py-4 backdrop-blur-sm">
          <LoadingState
            label={renderingStaleTranscript ? 'Loading new messages…' : 'Loading messages…'}
            className="justify-center"
          />
        </div>
      )}
      {!showConversationLoadingState && showConversationRail && realMessages && (
        <ConversationRail
          messages={realMessages}
          messageIndexOffset={messageIndexOffset}
          scrollContainerRef={scrollRef}
          onJumpToMessage={jumpToMessage}
        />
      )}
    </div>
  ), [
    conversationResumeState.actionLabel,
    conversationResumeState.canResume,
    conversationResumeState.title,
    draft,
    draftCwdError,
    draftCwdPickBusy,
    draftCwdValue,
    debouncedRelatedThreadsQuery,
    forkConversationFromMessage,
    hasRenderableMessages,
    hydrateHistoricalBlock,
    hydratingHistoricalBlockIdSet,
    id,
    isLiveSession,
    jumpToMessage,
    loadOlderMessages,
    openArtifact,
    openCheckpoint,
    displayedPendingAssistantStatusLabel,
    realMessages,
    renderingStaleTranscript,
    requestedFocusMessageIndex,
    resumeConversation,
    resumeConversationBusy,
    rewindConversationFromMessage,
    selectedArtifactId,
    selectedCheckpointId,
    sessionLoading,
    showConversationRail,
    showConversationLoadingState,
    showInlineConversationLoadingState,
    showScrollToBottomControl,
    stream.isCompacting,
    stream.isStreaming,
    conversationPerformanceMode,
    submitAskUserQuestion,
    historicalTotalBlocks,
    availableDraftWorkspacePaths,
    hasDraftCwd,
    clearDraftConversationCwdSelection,
    pickDraftConversationCwd,
    savedWorkspacePathsLoading,
    selectDraftConversationWorkspace,
    beginTitleEdit,
    cancelConversationCwdEdit,
    cancelTitleEdit,
    conversationCwdBusy,
    conversationCwdDraft,
    conversationCwdError,
    conversationHeaderOffset,
    currentCwd,
    isEditingTitle,
    renameConversationDisabled,
    saveTitleEdit,
    submitConversationCwdChange,
    title,
    titleDraft,
    titleSaving,
    visibleTranscriptHasOlderBlocks,
    visibleTranscriptMessageIndexOffset,
    visibleTranscriptMessages,
    visibleTranscriptState?.conversationId,
    relatedThreadSearchError,
    relatedThreadSearchLoading,
    preparingRelatedThreadContext,
    selectedRelatedThreadIds,
    toggleRelatedThreadSelection,
    visibleRelatedThreadResults,
  ]);

  const missingConversation = shouldShowMissingConversationState({
    draft,
    conversationId: id,
    sessionsLoaded,
    confirmedLive,
    sessionLoading,
    hasVisibleSessionDetail: Boolean(visibleSessionDetail),
    hasSavedConversationSessionFile: Boolean(savedConversationSessionFile),
    hasPendingInitialPrompt: Boolean(pendingInitialPrompt),
  });

  if (missingConversation) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader className="gap-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="ui-page-title truncate">Conversation not found</h1>
          </div>
        </PageHeader>
        <EmptyState
          className="h-full flex flex-col justify-center px-8"
          title="Conversation not found"
          body={sessionError ?? 'This conversation no longer exists or the live session has ended.'}
          action={(
            <Link to="/conversations/new" className="ui-action-button">
              Start a new conversation
            </Link>
          )}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {transcriptPane}

      {/* Input area */}
      {!keyboardOpen && (
        <div
          className={`px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+1rem)] transition-colors ${dragOver ? 'bg-accent/5' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
        {notice && (
          <div className="mb-2 text-center">
            <Pill tone={notice.tone}>{notice.text}</Pill>
          </div>
        )}

        <div className="relative mx-auto w-full max-w-6xl">
          {showSlash   && <SlashMenu items={slashItems} idx={slashIdx} onSelect={(item) => {
            const c = item.displayCmd.trim();
            const parsedConversationSlash = parseConversationSlashCommand(c);
            if (parsedConversationSlash?.kind === 'command') {
              setSlashIdx(0);
              void executeConversationSlashCommand(parsedConversationSlash.command);
              return;
            }
            setInput(item.insertText); setSlashIdx(0); textareaRef.current?.focus();
          }} />}
          {showMention && <MentionMenu items={mentionItems} query={mentionQuery} idx={mentionIdx} onSelect={id  => { setInput(input.replace(/@[\w./-]*$/, id + ' ')); setMentionIdx(0); textareaRef.current?.focus(); }} />}
          {showModelPicker && <ModelPicker models={modelItems} currentModel={currentModel} query={modelQuery} idx={modelIdx}
            onSelect={selectModel} onClose={() => { setInput(''); textareaRef.current?.focus(); }} />}

          {hasComposerAttachmentShelfContent && (
            <div className="mb-2 max-h-[min(34vh,20rem)] overflow-y-auto overscroll-contain">
              <ComposerAttachmentShelf
                attachments={attachments}
                drawingAttachments={drawingAttachments}
                drawingsBusy={drawingsBusy}
                drawingsError={drawingsError}
                onRemoveAttachment={removeAttachment}
                onEditDrawing={editDrawing}
                onRemoveDrawingAttachment={removeDrawingAttachment}
              />
            </div>
          )}

          <div className={cx(
            'ui-input-shell',
            resolveConversationComposerShellStateClassName({
              dragOver,
              hasInteractiveOverlay: showModelPicker || showSlash || showMention,
              autoModeEnabled: conversationAutoModeEnabled,
            }),
          )}>

            {/* Drag overlay hint */}
            {dragOver && (
              <div className="px-4 py-3 text-center text-[12px] text-accent border-b border-accent/20">
                📎 Drop files to attach
              </div>
            )}

            {hasComposerShelfContent && (
              <div className="max-h-[min(34vh,20rem)] overflow-y-auto overscroll-contain">
                {attachedContextDocs.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 pt-3 pb-2.5">
                    <span className="ui-section-label">Attached context</span>
                    {attachedContextDocs.map((doc) => (
                      <span
                        key={doc.path}
                        className="inline-flex items-center gap-1.5 rounded-full bg-elevated px-2 py-1 text-[11px] text-secondary"
                        title={doc.summary ? `${doc.path}\n\n${doc.summary}` : doc.path}
                      >
                        <span className="text-[10px] uppercase tracking-[0.14em] text-dim/70">{doc.kind}</span>
                        <span className="max-w-[18rem] truncate text-secondary">{doc.title}</span>
                        <button
                          type="button"
                          onClick={() => { void removeAttachedContextDoc(doc.path); }}
                          disabled={contextDocsBusy}
                          className="ui-icon-button ui-icon-button-compact ml-0.5 shrink-0 leading-none disabled:opacity-50"
                          title={`Remove ${doc.title} from attached context`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Prompt references */}
                {draftMentionItems.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 pt-3 pb-2.5">
                    <span className="ui-section-label">Prompt references</span>
                    {unattachedDraftMentionItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => { void attachMentionedDocsToConversation(unattachedDraftMentionItems); }}
                        disabled={contextDocsBusy}
                        className="text-[11px] text-accent transition-colors hover:text-accent/80 disabled:cursor-default disabled:opacity-50"
                      >
                        {contextDocsBusy ? 'attaching…' : `attach ${unattachedDraftMentionItems.length}`}
                      </button>
                    )}
                    {draftMentionItems.map((item) => (
                      <span
                        key={`${item.kind}:${item.id}`}
                        className="inline-flex items-center gap-1.5 rounded-full bg-elevated px-2 py-1 text-[11px] text-secondary"
                        title={item.summary || item.title || item.id}
                      >
                        <span className="text-[10px] uppercase tracking-[0.14em] text-dim/70">{item.kind}</span>
                        <span className="font-mono text-accent">{item.id}</span>
                      </span>
                    ))}
                  </div>
                )}

                {/* Pending steer / follow-up queue */}
                {pendingQueue.length > 0 && (
                  <div className="px-3 pt-2.5 pb-2 border-b border-border-subtle flex flex-col gap-1.5">
                    <span className="ui-section-label">Queued</span>
                    {pendingQueue.map(msg => (
                      <div key={msg.id} className="grid min-w-0 grid-cols-[auto,minmax(0,1fr),auto] items-start gap-x-2 gap-y-1">
                        <Pill tone={msg.type === 'steer' ? 'warning' : 'teal'} className="mt-0.5">
                          {msg.type === 'steer' ? '⤵ steer' : '↷ followup'}
                        </Pill>
                        <div className="min-w-0">
                          <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-secondary">
                            {truncateConversationShelfText(formatQueuedPromptShelfText(msg.text, msg.imageCount))}
                          </p>
                          {formatQueuedPromptImageSummary(msg.imageCount) ? (
                            <p className="mt-0.5 text-[11px] text-dim">{formatQueuedPromptImageSummary(msg.imageCount)}</p>
                          ) : null}
                        </div>
                        {msg.restorable !== false ? (
                          <button
                            type="button"
                            onClick={() => { void restoreQueuedPromptToComposer(msg.type, msg.queueIndex, msg.id); }}
                            disabled={conversationNeedsTakeover}
                            className="shrink-0 pt-0.5 text-[11px] text-dim transition-colors hover:text-primary disabled:cursor-default disabled:opacity-50"
                            title={conversationNeedsTakeover ? 'Take over this conversation before restoring queued prompts' : 'Restore this queued prompt to the composer'}
                            aria-label="Restore queued prompt to the composer"
                          >
                            restore
                          </button>
                        ) : (
                          <span className="shrink-0 pt-0.5 text-[11px] text-dim/70">remote</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {parallelJobs.length > 0 && (
                  <div className="px-3 pt-2.5 pb-2 border-b border-border-subtle flex flex-col gap-1.5">
                    <span className="ui-section-label">Parallel</span>
                    {parallelJobs.map((job) => {
                      const contextSummary = formatParallelJobContextSummary({
                        imageCount: job.imageCount,
                        attachmentRefs: job.attachmentRefs,
                      });
                      const attachmentSummary = job.attachmentRefs.length > 0
                        ? truncateConversationShelfText(job.attachmentRefs.join(', '), { maxChars: 140, maxLines: 2 })
                        : null;
                      const touchedFileSummary = job.touchedFiles.length > 0
                        ? truncateConversationShelfText(job.touchedFiles.join(', '), { maxChars: 180, maxLines: 2 })
                        : null;
                      const parentTouchedSummary = job.parentTouchedFiles.length > 0
                        ? truncateConversationShelfText(job.parentTouchedFiles.join(', '), { maxChars: 180, maxLines: 2 })
                        : null;
                      const overlapSummary = job.overlapFiles.length > 0
                        ? truncateConversationShelfText(job.overlapFiles.join(', '), { maxChars: 180, maxLines: 2 })
                        : null;
                      const sideEffectSummary = job.sideEffects.length > 0
                        ? truncateConversationShelfText(job.sideEffects.join(' · '), { maxChars: 180, maxLines: 3 })
                        : null;

                      return (
                        <div key={job.id} className="grid min-w-0 grid-cols-[auto,minmax(0,1fr),auto] items-start gap-x-2 gap-y-1">
                          <Pill tone={job.status === 'failed' ? 'danger' : job.status === 'running' ? 'steel' : 'accent'} className="mt-0.5">
                            ⇄ {formatParallelJobStatusLabel(job.status)}
                          </Pill>
                          <div className="min-w-0">
                            <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-secondary">
                              {truncateConversationShelfText(job.prompt || '(empty prompt)')}
                            </p>
                            {contextSummary ? (
                              <p className="mt-0.5 text-[11px] text-dim">{contextSummary}</p>
                            ) : null}
                            {attachmentSummary ? (
                              <p className="mt-0.5 text-[11px] text-dim">attachments: {attachmentSummary}</p>
                            ) : null}
                            {touchedFileSummary ? (
                              <p className="mt-0.5 text-[11px] text-dim">files: {touchedFileSummary}</p>
                            ) : null}
                            {parentTouchedSummary ? (
                              <p className="mt-0.5 text-[11px] text-dim">parent: {parentTouchedSummary}</p>
                            ) : null}
                            {overlapSummary ? (
                              <p className="mt-0.5 text-[11px] text-warning">overlap: {overlapSummary}</p>
                            ) : null}
                            {sideEffectSummary ? (
                              <p className="mt-0.5 text-[11px] text-dim">effects: {sideEffectSummary}</p>
                            ) : null}
                            {job.status === 'failed' && job.error ? (
                              <p className="mt-0.5 text-[11px] text-danger">{truncateConversationShelfText(job.error, { maxChars: 140, maxLines: 2 })}</p>
                            ) : job.resultPreview ? (
                              <p className="mt-0.5 text-[11px] text-dim">{truncateConversationShelfText(job.resultPreview, { maxChars: 140, maxLines: 2 })}</p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-3 pt-0.5 text-[11px]">
                            {(job.status === 'ready' || job.status === 'failed') && (
                              <button
                                type="button"
                                onClick={() => { void manageParallelJob(job.id, 'importNow'); }}
                                className="text-dim transition-colors hover:text-primary"
                                title="Append this parallel response to the main thread next"
                                aria-label="Import parallel response now"
                              >
                                import
                              </button>
                            )}
                            {job.status === 'running' ? (
                              <button
                                type="button"
                                onClick={() => { void manageParallelJob(job.id, 'cancel'); }}
                                className="text-dim transition-colors hover:text-primary"
                                title="Cancel this running parallel prompt"
                                aria-label="Cancel running parallel prompt"
                              >
                                cancel
                              </button>
                            ) : job.status !== 'importing' ? (
                              <button
                                type="button"
                                onClick={() => { void manageParallelJob(job.id, 'skip'); }}
                                className="text-dim transition-colors hover:text-primary"
                                title="Drop this parallel response without importing it"
                                aria-label="Skip parallel response"
                              >
                                skip
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => {
                                ensureConversationTabOpen(job.childConversationId);
                                navigate(`/conversations/${job.childConversationId}`);
                              }}
                              className="text-dim transition-colors hover:text-primary"
                              title="Open side thread"
                              aria-label="Open side thread"
                            >
                              open
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!draft && activeConversationBackgroundRuns.length > 0 && (
                  <>
                    <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2 text-[11px]">
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center text-accent" aria-hidden="true">
                          <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
                        </span>
                        <span className="shrink-0 text-secondary">Background Work</span>
                        <span className="truncate text-dim">{backgroundRunIndicatorText}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-[11px]">
                        <button
                          type="button"
                          onClick={() => { setShowBackgroundRunDetails((open) => !open); }}
                          className="text-dim transition-colors hover:text-primary"
                        >
                          {showActiveBackgroundRunDetails ? 'hide' : 'details'}
                        </button>
                      </div>
                    </div>

                    {showActiveBackgroundRunDetails && (
                      <div className="flex flex-col gap-2 border-b border-border-subtle px-3 pt-2.5 pb-2.5">
                        {activeConversationBackgroundRuns.map((run) => {
                          const headline = getRunHeadline(run, runLookups);
                          const summary = headline.summary === 'Background run'
                            ? `Run ${run.runId}`
                            : headline.summary;
                          const statusLabel = formatConversationBackgroundRunStatusLabel(run.status?.status);
                          const statusClass = run.status?.status === 'recovering'
                            ? 'text-warning'
                            : run.status?.status === 'queued' || run.status?.status === 'waiting'
                              ? 'text-dim'
                              : 'text-accent';

                          return (
                            <div key={run.runId} className="flex items-start gap-3 text-[12px]">
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className={cx('shrink-0 font-medium', statusClass)}>{statusLabel}</span>
                                  <span className="truncate text-primary">{headline.title}</span>
                                </div>
                                <div className="mt-0.5 text-[11px] text-dim">{summary}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {/* Deferred resume indicator */}
                {!draft && orderedDeferredResumes.length > 0 && (
                  <>
                    <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2 text-[11px]">
                      <div className="min-w-0 flex items-center gap-2">
                        <span className={cx(
                          'shrink-0',
                          hasReadyDeferredResumes ? 'text-warning' : 'text-dim',
                        )}>
                          ⏰
                        </span>
                        <span className="shrink-0 text-secondary">Wakeups</span>
                        <span className="truncate text-dim">{deferredResumeIndicatorText}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-[11px]">
                        {hasReadyDeferredResumes && !isLiveSession && (
                          <button
                            type="button"
                            onClick={() => { void continueDeferredResumesNow(); }}
                            className="text-accent transition-colors hover:text-accent/80"
                          >
                            continue now
                          </button>
                        )}
                        {deferredResumesBusy && <span className="text-dim">updating…</span>}
                        <button
                          type="button"
                          onClick={() => { setShowDeferredResumeDetails((open) => !open); }}
                          className="text-dim transition-colors hover:text-primary"
                        >
                          {showDeferredResumeDetails ? 'hide' : 'details'}
                        </button>
                      </div>
                    </div>

                    {showDeferredResumeDetails && (
                      <div className="flex flex-col gap-2 border-b border-border-subtle px-3 pt-2.5 pb-2.5">
                        {orderedDeferredResumes.map((resume) => (
                          <div key={resume.id} className="flex items-start gap-3 text-[12px]">
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className={cx(
                                  'shrink-0 font-medium',
                                  resume.status === 'ready' ? 'text-warning' : 'text-secondary',
                                )}>
                                  {describeDeferredResumeStatus(resume, deferredResumeNowMs)}
                                </span>
                                <span className="truncate text-primary">{resume.title ?? resume.prompt}</span>
                              </div>
                              <div className="mt-0.5 text-[11px] text-dim">
                                {resume.kind === 'reminder' ? 'Reminder' : resume.kind === 'task-callback' ? 'Task callback' : 'Wakeup'}
                                {resume.behavior === 'followUp' ? ' · follow-up' : ''} · {resume.status === 'ready' ? 'Ready' : 'Due'} {formatDeferredResumeWhen(resume)}
                                {resume.attempts > 0 ? ` · retries ${resume.attempts}` : ''}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                              {resume.status === 'scheduled' && (
                                <button
                                  type="button"
                                  onClick={() => { void fireDeferredResumeNow(resume.id); }}
                                  className="text-[11px] text-accent transition-colors hover:text-accent/80 disabled:opacity-40"
                                  disabled={deferredResumesBusy}
                                >
                                  fire now
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => { void cancelDeferredResume(resume.id); }}
                                className="text-[11px] text-dim transition-colors hover:text-danger disabled:opacity-40"
                                disabled={deferredResumesBusy}
                              >
                                cancel
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {pendingAskUserQuestion && composerActiveQuestion && (
                  <div className="border-b border-border-subtle px-3 py-2.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="ui-section-label">Answer below</span>
                      <Pill tone="warning">{composerQuestionAnsweredCount}/{pendingAskUserQuestion.presentation.questions.length}</Pill>
                    </div>

                    {pendingAskUserQuestion.presentation.questions.length > 1 && (
                      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
                        {pendingAskUserQuestion.presentation.questions.map((question, index) => {
                          const answered = (composerQuestionAnswers[question.id]?.length ?? 0) > 0;
                          const active = index === composerQuestionIndex;
                          return (
                            <button
                              key={question.id}
                              type="button"
                              onClick={() => activateComposerQuestion(index)}
                              className={cx(
                                'ui-action-button min-w-0 px-1 py-0.5 text-[10px]',
                                active
                                  ? 'text-primary'
                                  : answered
                                    ? 'text-secondary'
                                    : 'text-dim',
                              )}
                            >
                              <span aria-hidden="true" className={cx('shrink-0 text-[10px]', answered ? 'text-success' : active ? 'text-accent' : 'text-dim/70')}>
                                {answered ? '✓' : active ? '•' : '○'}
                              </span>
                              <span className="truncate">{question.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="mt-1.5">
                      <p className="text-[12px] font-medium text-primary break-words">{composerActiveQuestion.label}</p>
                      {composerActiveQuestion.details && (
                        <p className="mt-0.5 text-[11px] leading-relaxed text-secondary break-words">{composerActiveQuestion.details}</p>
                      )}
                    </div>

                    <div
                      className="mt-1 -mx-0.5"
                      role={composerActiveQuestion.style === 'check' ? 'group' : 'radiogroup'}
                      aria-label={composerActiveQuestion.label}
                    >
                      {composerActiveQuestion.options.map((option, optionIndex) => {
                        const selectedValues = composerQuestionAnswers[composerActiveQuestion.id] ?? [];
                        const checked = selectedValues.includes(option.value);
                        const active = optionIndex === composerQuestionOptionIndex;
                        const indicator = composerActiveQuestion.style === 'check'
                          ? (checked ? '☑' : '☐')
                          : (checked ? '◉' : '◯');
                        return (
                          <button
                            key={`${composerActiveQuestion.id}:${option.value}`}
                            type="button"
                            disabled={composerQuestionSubmitting}
                            onClick={() => handleComposerQuestionOptionSelect(composerQuestionIndex, optionIndex)}
                            className={cx(
                              'ui-list-row -mx-0.5 w-full items-start gap-2 px-2.5 py-1 text-left disabled:opacity-40',
                              checked || active ? 'ui-list-row-selected' : 'ui-list-row-hover',
                            )}
                          >
                            <span className={cx('mt-px w-8 shrink-0 text-[11px]', checked || active ? 'text-accent' : 'text-dim')} aria-hidden="true">
                              {optionIndex + 1}. {indicator}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="ui-row-title block break-words">{option.label}</span>
                              {option.details && (
                                <span className="ui-row-summary block break-words">{option.details}</span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <p className="mt-1.5 text-[10px] text-dim">
                      Type 1-9 to select · Tab/Shift+Tab or ←/→ switches questions · ↑/↓ moves · Enter selects or submits · type a normal message to skip
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Textarea */}
            <div className="px-3 pt-2.5 pb-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.excalidraw,application/json"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) {
                    void addComposerFiles(files);
                  }
                  e.target.value = '';
                }}
              />

              <div className="flex flex-col gap-0">
                  <div className="px-3 pt-1">
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={e => {
                        setInput(e.target.value);
                        setSlashIdx(0);
                        setMentionIdx(0);
                        rememberComposerSelection(e.target);
                      }}
                      onSelect={e => { rememberComposerSelection(e.currentTarget); }}
                      onClick={e => { rememberComposerSelection(e.currentTarget); }}
                      onKeyUp={e => { rememberComposerSelection(e.currentTarget); }}
                      onFocus={e => { rememberComposerSelection(e.currentTarget); }}
                      onKeyDown={handleKeyDown}
                      onPaste={handlePaste}
                      rows={1}
                      disabled={composerDisabled}
                      className="w-full resize-none bg-transparent text-sm leading-relaxed text-primary outline-none placeholder:text-dim disabled:cursor-default disabled:text-dim"
                      placeholder={pendingAskUserQuestion
                        ? 'Type 1-9 to answer, Tab or ←/→ to move, or write a normal message to skip…'
                        : 'Message… (/ for commands, @ to reference notes, tasks, and indexed folders/files)'}
                      title={pendingAskUserQuestion
                        ? '1-9 selects the current answer. Tab/Shift+Tab or ←/→ moves between questions. Enter selects or submits. Ctrl+C clears the composer.'
                        : 'Ctrl+C clears the composer. Ctrl/⌘+Enter starts a parallel prompt while the conversation is busy. Alt+Enter queues a follow up. ↑/↓ recalls recent prompts.'}
                      style={{ minHeight: '44px', maxHeight: '180px' }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 px-3 py-0.5">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={openFilePicker}
                        disabled={composerDisabled}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-elevated/60 hover:text-primary disabled:opacity-40"
                        title="Attach image or file"
                        aria-label="Attach image or file"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                      </button>
                      {screenshotCaptureAvailable && (
                        <button
                          type="button"
                          onClick={() => { void captureComposerScreenshot(); }}
                          disabled={composerDisabled || screenshotCaptureBusy}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-elevated/60 hover:text-primary disabled:opacity-40"
                          title="Capture screenshot"
                          aria-label="Capture screenshot"
                        >
                          {screenshotCaptureBusy ? (
                            <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
                          ) : (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z" />
                              <path d="M9 5 10.5 3.5h3L15 5" />
                              <circle cx="12" cy="12" r="3.25" />
                            </svg>
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={openDrawingEditor}
                        disabled={composerDisabled || stream.isStreaming}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-elevated/60 hover:text-primary disabled:opacity-40"
                        title="Create drawing"
                        aria-label="Create drawing"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </button>
                      <ConversationPreferencesRow
                        models={models}
                        currentModel={currentModel || model || defaultModel}
                        currentThinkingLevel={currentThinkingLevel}
                        currentServiceTier={currentServiceTier}
                        savingPreference={savingPreference}
                        showAutoModeToggle={Boolean(draft || id)}
                        autoModeEnabled={conversationAutoModeEnabled}
                        autoModeBusy={conversationAutoModeBusy}
                        onSelectModel={(modelId) => { void saveModelPreference(modelId); }}
                        onSelectThinkingLevel={(thinkingLevel) => { void saveThinkingLevelPreference(thinkingLevel); }}
                        onSelectServiceTier={(enableFastMode) => { void saveServiceTierPreference(enableFastMode); }}
                        onToggleAutoMode={() => { void toggleConversationAutoMode(); }}
                      />
                    </div>

                    <div className="ml-auto flex shrink-0 items-center gap-2">
                      {stream.isStreaming ? (
                        <>
                          {composerHasContent ? (
                            <button
                              type="button"
                              onClick={(event) => {
                                void submitComposerActionForModifiers(
                                  composerAltHeld || event.altKey,
                                  composerParallelHeld || event.ctrlKey || event.metaKey,
                                );
                              }}
                              disabled={composerDisabled}
                              className={cx(
                                'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium transition-colors disabled:cursor-default disabled:opacity-40',
                                composerSubmit.label === 'Parallel'
                                  ? 'bg-steel/12 text-steel hover:bg-steel/20'
                                  : composerSubmit.label === 'Follow up'
                                    ? 'bg-elevated text-primary hover:bg-elevated/80'
                                    : 'bg-warning/15 text-warning hover:bg-warning/25',
                              )}
                              title={composerSubmit.label === 'Parallel' ? 'Parallel (Ctrl/⌘+Enter)' : composerSubmit.label}
                              aria-label={composerSubmit.label}
                            >
                              {composerSubmit.label !== 'Send' ? (
                                <>
                                  <ComposerActionIcon label={composerSubmit.label} className="shrink-0" />
                                  <span>{formatComposerActionLabel(composerSubmit.label)}</span>
                                </>
                              ) : null}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => { void stream.abort(); }}
                            disabled={conversationNeedsTakeover}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger transition-colors hover:bg-danger/25 disabled:cursor-default disabled:opacity-60"
                            title={conversationNeedsTakeover ? 'Take over this conversation before stopping' : 'Stop'}
                            aria-label="Stop"
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                              <rect x="3.25" y="3.25" width="9.5" height="9.5" rx="1.2" />
                            </svg>
                          </button>
                        </>
                      ) : composerShowsQuestionSubmit ? (
                        <button
                          type="button"
                          onClick={() => { void submitComposerQuestionIfReady(); }}
                          disabled={composerDisabled || !composerQuestionCanSubmit || composerQuestionSubmitting}
                          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 text-[11px] font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-default disabled:opacity-40"
                          title={composerQuestionCanSubmit ? 'Submit answers' : 'Answer all questions to submit'}
                          aria-label="Submit answers"
                        >
                          <span aria-hidden="true">✓</span>
                          <span>{composerQuestionSubmitting ? 'Submitting…' : 'Submit'}</span>
                        </button>
                      ) : composerHasContent ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            void submitComposerActionForModifiers(
                              composerAltHeld || event.altKey,
                              composerParallelHeld || event.ctrlKey || event.metaKey,
                            );
                          }}
                          disabled={composerDisabled}
                          className={cx(
                            'flex shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-default disabled:opacity-40',
                            composerSubmit.label === 'Send'
                              ? 'h-8 w-8 bg-accent text-white hover:bg-accent/90'
                              : 'h-9 gap-1.5 px-3 text-[11px] font-medium',
                            composerSubmit.label === 'Steer'
                              ? 'bg-warning/15 text-warning hover:bg-warning/25'
                              : composerSubmit.label === 'Follow up'
                                ? 'bg-elevated text-primary hover:bg-elevated/80'
                                : composerSubmit.label === 'Parallel'
                                  ? 'bg-steel/12 text-steel hover:bg-steel/20'
                                  : '',
                          )}
                          title={composerSubmit.label === 'Parallel' ? 'Parallel (Ctrl/⌘+Enter)' : composerSubmit.label}
                          aria-label={composerSubmit.label}
                        >
                          {composerSubmit.label === 'Send' ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="m18 15-6-6-6 6" />
                            </svg>
                          ) : (
                            <>
                              <ComposerActionIcon label={composerSubmit.label} className="shrink-0" />
                              <span>{formatComposerActionLabel(composerSubmit.label)}</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={true}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-default/70 bg-surface/65 text-dim/70"
                          title="Send"
                          aria-label="Send"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m18 15-6-6-6 6" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
            </div>
          </div>

          {showComposerMeta ? (
            <div className="conversation-composer-meta mt-1.5 flex min-h-4 flex-col gap-1.5 px-3 text-[10px] text-dim xl:flex-row xl:items-start xl:justify-between xl:gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 overflow-hidden">
                {showExecutionTargetPicker ? (
                  <label className="relative inline-flex min-w-0 items-center">
                    <span className="sr-only">Execution target</span>
                    <RemoteExecutionIcon className="pointer-events-none absolute left-2 text-dim/70" />
                    <select
                      value={selectedExecutionTargetId}
                      onChange={(event) => { void handleContinueConversationInHost(event.target.value); }}
                      disabled={continueInBusy}
                      aria-label="Execution target"
                      className="h-7 min-w-[8.25rem] max-w-[12rem] appearance-none rounded-md bg-transparent pl-6 pr-7 text-[11px] font-medium text-secondary outline-none transition-colors hover:bg-surface/45 hover:text-primary focus-visible:bg-surface/55 focus-visible:text-primary disabled:opacity-50"
                    >
                      {executionTargetOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-2 text-dim/70">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </label>
                ) : null}

                {remoteOperationInlineStatus ? (
                  <span className={cx(
                    remoteOperationStatus?.status === 'error' ? 'text-danger/85' : 'text-accent/80',
                  )}>
                    {remoteOperationInlineStatus}
                  </span>
                ) : null}

                {draft ? (
                  <div className="flex min-w-0 max-w-full flex-1 items-center gap-1.5 xl:max-w-[26rem] xl:flex-none">
                    <FolderIcon className="shrink-0 text-dim/70" />
                    {selectedExecutionTargetIsRemote ? (
                      <>
                        <label className="sr-only" htmlFor="draft-composer-remote-cwd">Remote workspace path</label>
                        <input
                          id="draft-composer-remote-cwd"
                          value={draftCwdValue}
                          onChange={(event) => {
                            setDraftConversationCwd(event.target.value);
                            if (draftCwdError) {
                              setDraftCwdError(null);
                            }
                          }}
                          placeholder="~/workingdir/project"
                          spellCheck={false}
                          className="h-7 min-w-0 w-full rounded-md border border-border-subtle bg-surface/45 px-2 text-[11px] font-mono text-primary outline-none transition-colors focus:border-accent/50 xl:max-w-[22rem]"
                          aria-label="Remote workspace path"
                        />
                        <BrowsePathButton
                          busy={draftCwdPickBusy}
                          onClick={() => { void pickDraftConversationCwd(); }}
                          title={draftCwdPickBusy ? 'Choosing folder…' : `Choose directory on ${selectedExecutionTargetLabel}`}
                          ariaLabel={`Choose directory on ${selectedExecutionTargetLabel}`}
                        />
                      </>
                    ) : (
                      <>
                        <label className="sr-only" htmlFor="draft-composer-cwd">Workspace folder</label>
                        <div className="relative min-w-0 flex-1 xl:max-w-[22rem]">
                          <select
                            id="draft-composer-cwd"
                            value={draftCwdValue}
                            onChange={(event) => { setDraftConversationCwd(event.target.value); }}
                            className="h-7 w-full min-w-0 truncate appearance-none rounded-md bg-transparent pl-1 pr-6 text-[11px] font-mono text-secondary outline-none transition-colors hover:bg-surface/45 hover:text-primary focus-visible:bg-surface/55 focus-visible:text-primary"
                          >
                            <option value="">Default workspace</option>
                            {availableDraftWorkspacePaths.map((workspacePath) => (
                              <option key={workspacePath} value={workspacePath}>{workspacePath}</option>
                            ))}
                          </select>
                          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-dim/70">
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </div>
                        <BrowsePathButton
                          busy={draftCwdPickBusy}
                          onClick={() => { void pickDraftConversationCwd(); }}
                          title={draftCwdPickBusy ? 'Choosing folder…' : 'Choose folder'}
                          ariaLabel="Choose folder"
                        />
                      </>
                    )}
                  </div>
                ) : conversationCwdEditorOpen ? (
                  <form
                    className="flex min-w-0 max-w-full flex-1 items-center gap-1.5 xl:max-w-[26rem] xl:flex-none"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitConversationCwdChange();
                    }}
                  >
                    <FolderIcon className="shrink-0 text-dim/70" />
                    <input
                      autoFocus
                      value={conversationCwdDraft}
                      onChange={(event) => {
                        setConversationCwdDraft(event.target.value);
                        if (conversationCwdError) {
                          setConversationCwdError(null);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          cancelConversationCwdEdit();
                        }
                      }}
                      placeholder={currentCwd ?? '~/workingdir/repo'}
                      spellCheck={false}
                      aria-label="Conversation working directory"
                      className="h-7 min-w-0 w-full rounded-md border border-border-subtle bg-surface/45 px-2 text-[11px] font-mono text-primary outline-none transition-colors focus:border-accent/50 xl:max-w-[22rem]"
                      disabled={conversationCwdBusy || conversationCwdPickBusy}
                    />
                    <BrowsePathButton
                      busy={conversationCwdBusy || conversationCwdPickBusy}
                      onClick={() => { void pickConversationCwd(); }}
                      title={conversationCwdPickBusy ? 'Choosing folder…' : 'Choose folder'}
                      ariaLabel="Choose folder"
                    />
                    <button type="submit" className="h-7 rounded-md px-2 text-[10px] text-accent transition-colors hover:bg-surface/45 disabled:opacity-50" disabled={conversationCwdBusy || conversationCwdPickBusy}>
                      {conversationCwdBusy ? 'Switching…' : 'Switch'}
                    </button>
                    <button type="button" className="h-7 rounded-md px-2 text-[10px] text-secondary transition-colors hover:bg-surface/45 hover:text-primary disabled:opacity-50" onClick={cancelConversationCwdEdit} disabled={conversationCwdBusy || conversationCwdPickBusy}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={beginConversationCwdEdit}
                    className="flex min-w-0 max-w-full flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-secondary transition-colors hover:bg-surface/45 hover:text-primary xl:w-[26rem] xl:flex-none"
                    title={currentCwd ? `Working directory: ${currentCwd}` : 'Set working directory'}
                  >
                    <FolderIcon className="shrink-0 text-dim/70" />
                    <span className="ui-truncate-start min-w-0 flex-1 font-mono text-[11px]">{currentCwdLabel || 'Set working directory'}</span>
                  </button>
                )}

                {(draft ? draftCwdError : conversationCwdError) ? (
                  <span className="text-danger/85">{draft ? draftCwdError : conversationCwdError}</span>
                ) : null}
              </div>

              <div className="flex min-w-0 items-center justify-between gap-2 overflow-hidden xl:shrink-0 xl:justify-end xl:text-right">
                {!draft && branchLabel ? (
                  <span className="truncate font-mono" title={branchLabel}>{branchLabel}</span>
                ) : null}
                {!draft && hasGitSummary ? (
                  gitSummaryPresentation.kind === 'diff' ? (
                    <span className="font-mono tabular-nums">
                      <span className="text-success">{gitSummaryPresentation.added}</span>
                      <span className="text-dim"> / </span>
                      <span className="text-danger">{gitSummaryPresentation.deleted}</span>
                    </span>
                  ) : (
                    <span className="font-mono tabular-nums">{gitSummaryPresentation.text}</span>
                  )
                ) : null}
                {sessionTokens ? (
                  <span className="font-mono tabular-nums">{formatContextUsageLabel(sessionTokens.total, sessionTokens.contextWindow)}</span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      )}

      {remoteDirectoryBrowserState && selectedExecutionTargetHost ? (
        <RemoteDirectoryBrowserModal
          hostId={selectedExecutionTargetHost.id}
          hostLabel={selectedExecutionTargetHost.label}
          initialPath={remoteDirectoryBrowserState.initialPath}
          title={remoteDirectoryBrowserState.kind === 'draft' ? 'Choose remote workspace' : 'Choose remote working directory'}
          statusMessage={remoteDirectoryStatusMessage}
          statusTone={remoteDirectoryStatusTone}
          onSelect={handleRemoteDirectorySelected}
          onClose={() => {
            setRemoteDirectoryBrowserState(null);
            if (remoteOperationStatus?.scope === 'directory') {
              setRemoteOperationStatus(null);
            }
          }}
        />
      ) : null}

      {selectedArtifactId && id && (
        <Suspense fallback={null}>
          <ConversationArtifactModal conversationId={id} artifactId={selectedArtifactId} />
        </Suspense>
      )}

      {selectedCheckpointId && id && (
        <Suspense fallback={null}>
          <ConversationCheckpointModal conversationId={id} checkpointId={selectedCheckpointId} />
        </Suspense>
      )}

      {editingDrawingLocalId && (
        <Suspense fallback={null}>
          <ExcalidrawEditorModal
            key={editingDrawingLocalId}
            initialTitle={editingDrawingAttachment?.title ?? 'Drawing'}
            initialScene={editingDrawingAttachment?.scene ?? null}
            saveLabel={editingDrawingAttachment ? 'Update drawing' : 'Save drawing'}
            onSave={saveDrawingFromEditor}
            onClose={closeDrawingEditor}
          />
        </Suspense>
      )}

      {drawingsPickerOpen && id && (
        <Suspense fallback={null}>
          <ConversationDrawingsPickerModal
            attachments={conversationAttachments}
            onLoadAttachment={async (attachmentId) => {
              const detail = await api.conversationAttachment(id, attachmentId);
              return detail.attachment;
            }}
            onAttach={(selection) => { void attachSavedDrawing(selection); }}
            onClose={() => setDrawingsPickerOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
