import type { MessageBlock, SessionMeta } from '../shared/types';
import type { PendingConversationPrompt } from '../pending/pendingConversationPrompt';
import { getConversationDisplayTitle, NEW_CONVERSATION_TITLE, normalizeConversationTitle } from './conversationTitle';

const MAX_CONVERSATION_RAIL_BLOCKS = 240;
const AGGRESSIVE_CHAT_RENDERING_MESSAGE_THRESHOLD = 96;

export function resolveConversationPendingStatusLabel(input: {
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

  return getConversationDisplayTitle(
    input.titleOverride,
    input.streamTitle,
    input.liveTitle,
    input.detailTitle,
    input.sessionTitle,
  );
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

    const didChange = Object.keys(updated).some((key) => (
      updated[key as keyof SessionMeta] !== session[key as keyof SessionMeta]
    ));
    if (didChange) {
      changed = true;
      return updated;
    }

    return session;
  });

  return changed ? updatedSessions : sessions;
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
  return !input.draft
    && Boolean(input.conversationId)
    && input.desktopMode === 'local'
    && !input.desktopError;
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
