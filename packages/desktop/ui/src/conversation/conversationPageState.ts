import {
  getRunHeadline,
  isRunActive,
  listConnectedConversationBackgroundRuns,
  type RunPresentationLookups,
} from '../automation/runPresentation';
import { listRecentConversationBackgroundRuns } from '../automation/runPresentation';
import type { PendingConversationPrompt } from '../pending/pendingConversationPrompt';
import type { DurableRunListResult, DurableRunRecord, MessageBlock, SessionDetail, SessionMeta } from '../shared/types';
import { formatContextUsageLabel } from './conversationHeader';
import { getConversationDisplayTitle, NEW_CONVERSATION_TITLE, normalizeConversationTitle } from './conversationTitle';

const AGGRESSIVE_CHAT_RENDERING_MESSAGE_THRESHOLD = 96;

export function resolveConversationLiveSession(input: {
  streamBlockCount: number;
  isStreaming: boolean;
  confirmedLive: boolean | null;
}): boolean {
  return input.streamBlockCount > 0 || input.isStreaming || input.confirmedLive === true;
}

export function resolveConversationComposerRunState(input: {
  streamIsStreaming: boolean;
  sessionIsRunning?: boolean | null;
  bootstrapLiveSessionIsStreaming?: boolean | null;
  desktopLiveSessionIsStreaming?: boolean | null;
  hasPendingHiddenTurn: boolean;
}): { allowQueuedPrompts: boolean; defaultComposerBehavior: 'steer' | 'followUp' | undefined; streamControlsActive: boolean } {
  const streamControlsActive =
    input.streamIsStreaming ||
    input.bootstrapLiveSessionIsStreaming === true ||
    input.desktopLiveSessionIsStreaming === true ||
    (input.sessionIsRunning === true && !input.hasPendingHiddenTurn);

  return {
    allowQueuedPrompts: streamControlsActive || input.hasPendingHiddenTurn,
    defaultComposerBehavior: streamControlsActive ? 'steer' : input.hasPendingHiddenTurn ? 'followUp' : undefined,
    streamControlsActive,
  };
}

export function resolveConversationPendingStatusLabel(input: { isLiveSession: boolean; hasVisibleSessionDetail: boolean }): string {
  if (input.isLiveSession) {
    return 'Working…';
  }

  if (input.hasVisibleSessionDetail) {
    return 'Resuming…';
  }

  return 'Sending…';
}

function resolvePendingConversationPreparationStatusLabel(prompt: PendingConversationPrompt | null | undefined): string | null {
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
    return (
      resolvePendingConversationPreparationStatusLabel(input.pendingPrompt) ??
      resolveConversationPendingStatusLabel({
        isLiveSession: input.isLiveSession,
        hasVisibleSessionDetail: input.hasVisibleSessionDetail,
      })
    );
  }

  return null;
}

export function findLastCopyableAgentText(messages: MessageBlock[] | undefined): string | null {
  if (!messages) {
    return null;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const block = messages[index];
    if ((block.type === 'text' || block.type === 'summary') && block.text.trim().length > 0) {
      return block.text;
    }
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
  return (
    !input.draft &&
    Boolean(input.conversationId) &&
    input.sessionsLoaded &&
    input.confirmedLive === false &&
    !input.sessionLoading &&
    !input.hasVisibleSessionDetail &&
    !input.hasSavedConversationSessionFile &&
    !input.hasPendingInitialPrompt
  );
}

export function shouldDeferConversationFileRefresh(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  hasPendingInitialPrompt: boolean;
  pendingInitialPromptDispatching: boolean;
  hasPendingInitialPromptInFlight: boolean;
}): boolean {
  return (
    !input.draft &&
    Boolean(input.conversationId) &&
    (input.hasPendingInitialPrompt || input.pendingInitialPromptDispatching || input.hasPendingInitialPromptInFlight)
  );
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
  return (
    !input.draft &&
    Boolean(input.conversationId) &&
    input.conversationLiveDecision === true &&
    !input.conversationBootstrapLoading &&
    !input.sessionLoading &&
    !input.isStreaming &&
    !input.hasPendingInitialPrompt &&
    !input.pendingInitialPromptDispatching &&
    !input.hasPendingInitialPromptInFlight
  );
}

export function resolveConversationPageTitle(input: {
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

  return getConversationDisplayTitle(input.titleOverride, input.streamTitle, input.liveTitle, input.detailTitle, input.sessionTitle);
}

export function replaceConversationTitleInSessionList<T extends { id: string; title: string }>(
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

export function replaceConversationMetaInSessionList(
  sessions: SessionMeta[] | null,
  conversationId: string | null | undefined,
  nextMeta: SessionMeta | null | undefined,
): SessionMeta[] | null {
  if (!sessions || !conversationId || !nextMeta || nextMeta.id !== conversationId) {
    return sessions;
  }

  let changed = false;
  const updatedSessions = sessions.map((session) => {
    if (session.id !== conversationId) {
      return session;
    }

    const updated = {
      ...session,
      ...nextMeta,
      title: normalizeConversationTitle(nextMeta.title) ?? session.title,
      isRunning: nextMeta.isRunning ?? session.isRunning,
      isLive: nextMeta.isLive ?? session.isLive,
      lastActivityAt: nextMeta.lastActivityAt ?? session.lastActivityAt,
      needsAttention: nextMeta.needsAttention ?? session.needsAttention,
      attentionUpdatedAt: nextMeta.attentionUpdatedAt ?? session.attentionUpdatedAt,
      attentionUnreadMessageCount: nextMeta.attentionUnreadMessageCount ?? session.attentionUnreadMessageCount,
      attentionUnreadActivityCount: nextMeta.attentionUnreadActivityCount ?? session.attentionUnreadActivityCount,
      attentionActivityIds: nextMeta.attentionActivityIds ?? session.attentionActivityIds,
      deferredResumes: nextMeta.deferredResumes ?? session.deferredResumes,
      attachedContextDocs: nextMeta.attachedContextDocs ?? session.attachedContextDocs,
    };

    const didChange = Object.keys(updated).some((key) => updated[key as keyof SessionMeta] !== session[key as keyof SessionMeta]);
    if (didChange) {
      changed = true;
      return updated;
    }

    return session;
  });

  return changed ? updatedSessions : sessions;
}

export function mergeConversationSessionMeta(
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
      attachedContextDocs: detailMeta.attachedContextDocs ?? sessionSnapshot.attachedContextDocs,
    };
  }

  return detailMeta ?? sessionSnapshot ?? null;
}

export function formatConversationBackgroundRunStatusLabel(status: string | undefined): string {
  if (status === 'queued' || status === 'waiting' || status === 'running' || status === 'recovering') {
    return status;
  }

  return typeof status === 'string' && status.trim().length > 0 ? status : 'active';
}

export function buildConversationBackgroundRunIndicatorText(runs: DurableRunRecord[], lookups: RunPresentationLookups = {}): string {
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

export function resolveConversationBackgroundRunState(input: {
  conversationId: string | null | undefined;
  runs?: DurableRunListResult | null;
  lookups?: RunPresentationLookups;
  excludeConversationRunId?: string | null;
}): {
  connectedRuns: DurableRunRecord[];
  activeRuns: DurableRunRecord[];
  recentRuns: DurableRunRecord[];
  indicatorText: string;
} {
  if (!input.conversationId) {
    return { connectedRuns: [], activeRuns: [], recentRuns: [], indicatorText: '' };
  }

  const connectedRuns = listConnectedConversationBackgroundRuns({
    conversationId: input.conversationId,
    runs: input.runs,
    lookups: input.lookups,
    excludeConversationRunId: input.excludeConversationRunId,
  });
  const activeRuns = connectedRuns.filter((run) => isRunActive(run));
  const recentRuns = listRecentConversationBackgroundRuns(input);
  return {
    connectedRuns,
    activeRuns,
    recentRuns,
    indicatorText: buildConversationBackgroundRunIndicatorText(activeRuns, input.lookups),
  };
}

export function buildConversationSessionSummaryNotice(input: {
  draft: boolean;
  title: string;
  isLiveSession: boolean;
  currentModel?: string | null;
  fallbackModel?: string | null;
  cwd?: string | null;
  draftCwd?: string | null;
  messageCount: number;
  contextUsage?: { total: number | null; contextWindow: number } | null;
}): string {
  const currentModel = input.currentModel?.trim() || '';
  const fallbackModel = input.fallbackModel?.trim() || '';
  const cwd = input.draft ? input.draftCwd?.trim() || 'unset cwd' : input.cwd?.trim() || 'unknown cwd';
  const modelLabel = currentModel || fallbackModel || 'unknown model';
  const details = [
    input.draft ? 'Draft conversation' : input.title,
    input.isLiveSession ? 'active session' : null,
    modelLabel,
    cwd,
    `${input.messageCount} ${input.messageCount === 1 ? 'block' : 'blocks'}`,
    input.contextUsage ? formatContextUsageLabel(input.contextUsage.total, input.contextUsage.contextWindow) : null,
  ].filter((value): value is string => Boolean(value));

  return details.join(' · ');
}

export function resolveConversationInitialHistoricalWarmupTarget(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  liveDecision: boolean | null | undefined;
  historicalTotalBlocks: number;
  historicalHasOlderBlocks: boolean;
}): number | null {
  if (
    input.draft ||
    !input.conversationId ||
    input.liveDecision !== false ||
    !input.historicalHasOlderBlocks ||
    input.historicalTotalBlocks <= 0
  ) {
    return null;
  }

  // Keep the first paint small when switching threads. Older history can load
  // lazily in the background or on demand instead of blocking open.
  return null;
}

export function hasConversationLoadedHistoricalTailBlocks(
  detail: Pick<SessionDetail, 'blocks' | 'totalBlocks'> | null | undefined,
  targetTailBlocks: number | null,
): boolean {
  if (!detail || typeof targetTailBlocks !== 'number' || !Number.isSafeInteger(targetTailBlocks) || targetTailBlocks <= 0) {
    return false;
  }

  return detail.blocks.length >= Math.min(targetTailBlocks, detail.totalBlocks);
}

export function shouldShowConversationInitialHistoricalWarmupLoader(input: {
  warmupActive: boolean;
  targetTailBlocks: number | null;
  currentTailBlocks: number;
  loadedTailBlocks: boolean;
}): boolean {
  if (
    !input.warmupActive ||
    typeof input.targetTailBlocks !== 'number' ||
    !Number.isSafeInteger(input.targetTailBlocks) ||
    input.targetTailBlocks <= 0
  ) {
    return false;
  }

  return input.currentTailBlocks < input.targetTailBlocks || !input.loadedTailBlocks;
}

export function shouldShowConversationBootstrapLoadingState(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  conversationBootstrapLoading: boolean;
  hasRenderableMessages: boolean;
  hasVisibleSessionDetail: boolean;
}): boolean {
  return (
    !input.draft &&
    Boolean(input.conversationId) &&
    input.conversationBootstrapLoading &&
    !input.hasRenderableMessages &&
    !input.hasVisibleSessionDetail
  );
}

export function resolveConversationStreamTitleSync<T extends { id: string; title: string }>(input: {
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

export function shouldUseHealthyDesktopConversationState(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  desktopMode: 'checking' | 'local' | 'inactive';
  desktopError: string | null;
}): boolean {
  return !input.draft && Boolean(input.conversationId) && input.desktopMode === 'local' && !input.desktopError;
}

export function shouldSubscribeToDesktopConversationState(input: { draft: boolean }): boolean {
  return !input.draft;
}

export function resolveConversationCwdChangeAction(input: {
  conversationId: string | null | undefined;
  cwdChange: { newConversationId: string; cwd: string; autoContinued: boolean } | null | undefined;
  handledKey: string | null | undefined;
}): { action: 'none'; key: null } | { action: 'navigate'; key: string; conversationId: string } | { action: 'reconnect'; key: string } {
  if (!input.conversationId || !input.cwdChange) {
    return { action: 'none', key: null };
  }

  const key = `${input.cwdChange.newConversationId}\n${input.cwdChange.cwd}\n${input.cwdChange.autoContinued ? '1' : '0'}`;
  if (input.handledKey === key) {
    return { action: 'none', key: null };
  }

  if (input.cwdChange.newConversationId !== input.conversationId) {
    return { action: 'navigate', key, conversationId: input.cwdChange.newConversationId };
  }

  return { action: 'reconnect', key };
}

export function shouldFetchConversationAttachments(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  drawingsPickerOpen: boolean;
}): boolean {
  return !input.draft && Boolean(input.conversationId) && input.drawingsPickerOpen;
}

export function shouldShowConversationInlineLoadingState(input: {
  showConversationLoadingState: boolean;
  hasVisibleTranscript: boolean;
}): boolean {
  return input.showConversationLoadingState && input.hasVisibleTranscript;
}

export function resolveConversationVisibleScrollBinding(input: {
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
  const usingStableTranscript =
    !hasRenderableMessages && input.showConversationLoadingState && !input.draft && Boolean(input.stableTranscriptState);

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

export function resolveConversationPerformanceMode(input: { messageCount: number }): 'default' | 'aggressive' {
  return input.messageCount >= AGGRESSIVE_CHAT_RENDERING_MESSAGE_THRESHOLD ? 'aggressive' : 'default';
}

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
