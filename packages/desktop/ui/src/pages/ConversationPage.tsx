import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import { useAppData, useAppEvents, useLiveTitles } from '../app/contexts';
import type { RunPresentationLookups } from '../automation/runPresentation';
import { api } from '../client/api';
import { completeConversationOpenPhase, ensureConversationOpenStart } from '../client/perfDiagnostics';
import { buildSlashMenuItems, parseSlashInput } from '../commands/slashMenu';
import { ChatView } from '../components/chat/ChatView';
import { ComposerAttachmentShelf } from '../components/chat/ComposerAttachmentShelf';
import { ConversationActivityShelf } from '../components/conversation/ConversationActivityShelf';
import { resolveConversationComposerShellStateClassName } from '../components/conversation/ConversationComposerChrome';
import { ConversationComposerInputControls } from '../components/conversation/ConversationComposerInputControls';
import { MentionMenu, ModelPicker, SlashMenu } from '../components/conversation/ConversationComposerMenus';
import { ConversationComposerMeta } from '../components/conversation/ConversationComposerMeta';
import { ConversationContextShelf } from '../components/conversation/ConversationContextShelf';
import {
  ConversationDraftEmptyAction,
  DRAFT_EMPTY_STATE_CONTENT_WIDTH_CLASS,
} from '../components/conversation/ConversationDraftEmptyAction';
import { ConversationGoalPanel } from '../components/conversation/ConversationGoalPanel';
import { ConversationQuestionShelf } from '../components/conversation/ConversationQuestionShelf';
import { ConversationQueueShelf } from '../components/conversation/ConversationQueueShelf';
import { ConversationSavedHeader } from '../components/ConversationSavedHeader';
import { addNotification } from '../components/notifications/notificationStore';
import { AppPageEmptyState, cx, EmptyState, LoadingState, PageHeader, Pill } from '../components/ui';
import type { ExcalidrawSceneData } from '../content/excalidrawUtils';
import { parseExcalidrawSceneFromSourceData } from '../content/excalidrawUtils';
import { appendComposerHistory, readComposerHistory } from '../conversation/composerHistory';
import {
  getConversationArtifactIdFromSearch,
  readArtifactPresentation,
  setConversationArtifactIdInSearch,
} from '../conversation/conversationArtifacts';
import { parseWholeLineBashCommand } from '../conversation/conversationBashCommand';
import { getConversationCheckpointIdFromSearch, setConversationCheckpointIdInSearch } from '../conversation/conversationCheckpoints';
import {
  canNavigateComposerHistoryValue,
  insertTextAtComposerSelection,
  resolveComposerClearShortcut,
  resolveComposerHistoryNavigation,
} from '../conversation/conversationComposerEditing';
import {
  appendMentionedConversationContextDocs,
  dedupeConversationContextDocs,
  removeConversationContextDocByPath,
  resolveConversationAutocompleteCatalogDemand,
  resolveConversationContextUsageTokens,
  resolveConversationGitSummaryPresentation,
  selectUnattachedMentionItems,
} from '../conversation/conversationComposerPresentation';
import {
  normalizeConversationComposerBehavior,
  resolveConversationComposerSubmitState,
  shouldShowQuestionSubmitAsPrimaryComposerAction,
} from '../conversation/conversationComposerSubmit';
import { truncateConversationCwdFromFront } from '../conversation/conversationCwdHistory';
import { formatThinkingLevelLabel } from '../conversation/conversationHeader';
import {
  buildConversationInitialModelPreferenceState,
  buildConversationServiceTierPreferenceInput,
  resolveConversationDraftHydrationState,
  resolveConversationInitialDeferredResumeState,
  resolveConversationInitialModelPreferenceState,
  resolveDraftConversationServiceTierState,
  resolveFastModeToggleServiceTier,
} from '../conversation/conversationInitialState';
import {
  buildMentionItems,
  filterMentionItems,
  MAX_MENTION_MENU_ITEMS,
  type MentionItem,
  resolveMentionItems,
} from '../conversation/conversationMentions';
import {
  resolveDraftModelPreferenceUpdate,
  resolveDraftServiceTierPreferenceUpdate,
  resolveDraftThinkingPreferenceUpdate,
} from '../conversation/conversationModelPreferences';
import {
  hasConversationLoadedHistoricalTailBlocks,
  mergeConversationSessionMeta,
  replaceConversationMetaInSessionList,
  replaceConversationTitleInSessionList,
  resolveConversationBackgroundRunState,
  resolveConversationComposerRunState,
  resolveConversationCwdChangeAction,
  resolveConversationInitialHistoricalWarmupTarget,
  resolveConversationLiveSession,
  resolveConversationPageTitle,
  resolveConversationPendingStatusLabel,
  resolveConversationPerformanceMode,
  resolveConversationStreamTitleSync,
  resolveConversationVisibleScrollBinding,
  resolveDisplayedConversationPendingStatusLabel,
  shouldDeferConversationFileRefresh,
  shouldFetchConversationAttachments,
  shouldFetchConversationLiveSessionGitContext,
  shouldLoadConversationModels,
  shouldShowConversationBootstrapLoadingState,
  shouldShowConversationInitialHistoricalWarmupLoader,
  shouldShowConversationInlineLoadingState,
  shouldShowMissingConversationState,
  shouldSubscribeToDesktopConversationState,
  shouldUseHealthyDesktopConversationState,
} from '../conversation/conversationPageState';
import { insertReplyQuoteIntoComposer } from '../conversation/conversationReplyQuote';
import { didConversationStopMidTurn, didConversationStopWithError, getConversationResumeState } from '../conversation/conversationResume';
import {
  createConversationLiveRunId,
  getConversationRunIdFromSearch,
  setConversationRunIdInSearch,
} from '../conversation/conversationRuns';
import {
  getConversationInitialScrollKey,
  getConversationTailBlockKey,
  shouldShowScrollToBottomControl,
} from '../conversation/conversationScroll';
import { isConversationSessionNotLiveError, primeCreatedConversationOpenCaches } from '../conversation/conversationSessionLifecycle';
import { type ConversationSlashCommand, parseConversationSlashCommand } from '../conversation/conversationSlashCommand';
import { NEW_CONVERSATION_TITLE } from '../conversation/conversationTitle';
import {
  beginDraftConversationAttachmentsMutation,
  buildDraftConversationComposerStorageKey,
  clearConversationAttachments,
  clearDraftConversationAttachments,
  clearDraftConversationComposer,
  clearDraftConversationContextDocs,
  clearDraftConversationCwd,
  clearDraftConversationModel,
  clearDraftConversationModelPreferences,
  clearDraftConversationServiceTier,
  clearDraftConversationThinkingLevel,
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
} from '../conversation/draftConversation';
import {
  buildConversationComposerStorageKey,
  persistForkPromptDraft,
  resolveBranchEntryIdFromSessionDetailResult,
  resolveRewindTargetForMessage,
  resolveSessionEntryIdFromBlockId,
} from '../conversation/forking';
import {
  hasConversationTranscriptAcceptedPendingInitialPrompt,
  normalizePendingRelatedConversationIds,
  shouldAutoDispatchPendingInitialPrompt,
  shouldClaimPendingInitialPromptForSession,
  shouldKeepStoredPendingInitialPromptDuringDispatch,
} from '../conversation/pendingInitialPromptLogic';
import {
  buildComposerFilePreparationNotices,
  buildPromptImages,
  type ComposerDrawingAttachment,
  type ComposerImageAttachment,
  createComposerDrawingLocalId,
  drawingAttachmentToPromptImage,
  drawingAttachmentToPromptRef,
  prepareComposerFiles,
  readComposerTransferFiles,
  removeComposerDrawingAttachmentByLocalId,
  removeComposerImageFileAtIndex,
  restoreComposerImageFiles,
  restoreQueuedImageFiles,
} from '../conversation/promptAttachments';
import {
  listRecentConversationResults,
  rankRelatedConversationSessions,
  type RelatedConversationSearchResult,
  selectRecentConversationCandidates,
} from '../conversation/relatedConversationSearch';
import {
  buildRelatedThreadCandidateLookup,
  pruneRelatedThreadSelectionIds,
  resolveRelatedThreadPreselectionUpdate,
  selectMissingRelatedThreadSearchIndexIds,
  selectMissingRelatedThreadSummaryIds,
  selectVisibleRelatedThreadResults,
  toggleRelatedThreadSelectionIds,
} from '../conversation/relatedThreadSelection';
import { collectCompletedToolAutoOpenBlockKeys, findRequestedToolPresentationToOpen } from '../conversation/toolAutoOpen';
import { useComposerModifierKeys, useVisualViewportKeyboardInset } from '../conversation/useConversationKeyboardState';
import { useConversationModels } from '../conversation/useConversationModels';
import { useDesktopConversationShortcuts } from '../conversation/useDesktopConversationShortcuts';
import { hasBlockingConversationOverlay, useEscapeAbortStream } from '../conversation/useEscapeAbortStream';
import { useInitialDraftAttachmentHydration } from '../conversation/useInitialDraftAttachmentHydration';
import { MAX_RELATED_THREAD_HOTKEYS, useRelatedThreadHotkeys } from '../conversation/useRelatedThreadHotkeys';
import { useWorkspaceComposerEvents } from '../conversation/useWorkspaceComposerEvents';
import { shouldAutoResumeDeferredResumes } from '../deferred-resume/deferredResumeAutoResume';
import { describeDeferredResumeStatus, resolveDeferredResumePresentationState } from '../deferred-resume/deferredResumeIndicator';
import { parseDeferredResumeSlashCommand } from '../deferred-resume/deferredResumeSlashCommand';
import {
  DESKTOP_SHOW_WORKBENCH_BROWSER_EVENT,
  type DesktopWorkbenchBrowserCommentTarget,
  type DesktopWorkbenchBrowserState,
  getDesktopBridge,
} from '../desktop/desktopBridge';
import { ComposerShelfHost } from '../extensions/ComposerShelfHost';
import { ConversationHeaderHost } from '../extensions/ConversationHeaderHost';
import { buildExtensionMentionItems } from '../extensions/extensionMentions';
import { createNativeExtensionClient } from '../extensions/nativePaClient';
import { NewConversationPanelHost } from '../extensions/NewConversationPanelHost';
import type { ExtensionMentionRegistration, ExtensionSlashCommandRegistration } from '../extensions/types';
import { useExtensionRegistry } from '../extensions/useExtensionRegistry';
import { INITIAL_STREAM_STATE, retryLiveSessionActionAfterTakeover } from '../hooks/sessionStream';
import { useConversationBootstrap } from '../hooks/useConversationBootstrap';
import { useConversationEventVersion } from '../hooks/useConversationEventVersion';
import { useConversationScroll } from '../hooks/useConversationScroll';
import { useDesktopConversationState } from '../hooks/useDesktopConversationState';
import { useInvalidateOnTopics } from '../hooks/useInvalidateOnTopics';
import { primeSessionDetailCache, useSessionDetail } from '../hooks/useSessions';
import { useReloadState } from '../local/reloadState';
import { normalizeWorkspacePaths, readStoredWorkspacePaths, writeStoredWorkspacePaths } from '../local/savedWorkspacePaths';
import { filterModelPickerItems } from '../model/modelPicker';
import { hasSelectableModelId, resolveSelectableModelId } from '../model/modelPreferences';
import {
  clearPendingConversationPrompt,
  consumePendingConversationPrompt,
  isPendingConversationPromptDispatching,
  PENDING_CONVERSATION_PROMPT_CHANGED_EVENT,
  type PendingConversationPrompt,
  type PendingConversationPromptChangedDetail,
  persistPendingConversationPrompt,
  readPendingConversationPrompt,
  setPendingConversationPromptDispatching,
} from '../pending/pendingConversationPrompt';
import {
  appendPendingInitialPromptBlock,
  buildConversationPendingQueueItems,
  resolveRestoredQueuedPromptComposerUpdate,
} from '../pending/pendingQueueMessages';
import { closeConversationTab, ensureConversationTabOpen } from '../session/sessionTabs';
import type {
  ConversationAttachmentSummary,
  ConversationContextDocRef,
  DeferredResumeSummary,
  DurableRunRecord,
  LiveSessionContext,
  MemoryData,
  MessageBlock,
  PromptAttachmentRefInput,
} from '../shared/types';
import type { ConversationSummaryRecord } from '../shared/types';
import {
  type AskUserQuestionAnswers,
  type AskUserQuestionPresentation,
  buildAskUserQuestionReplyText,
  buildPendingAskUserQuestionKey,
  countAnsweredAskUserQuestions,
  findPendingAskUserQuestion,
  isAskUserQuestionComplete,
  moveAskUserQuestionIndex,
  resolveAskUserQuestionAnswerSelection,
  resolveAskUserQuestionDefaultOptionIndex,
  resolveAskUserQuestionOptionHotkey,
  shouldAdvanceAskUserQuestionAfterSelection,
} from '../transcript/askUserQuestions';
import {
  addHydratingHistoricalBlockId,
  buildHydratingHistoricalBlockIdSet,
  displayBlockToMessageBlock,
  mergeHydratedHistoricalBlocks,
  mergeHydratedStreamBlocks,
  normalizeHistoricalBlockId,
  removeHydratingHistoricalBlockId,
} from '../transcript/messageBlocks';
import { APP_LAYOUT_MODE_CHANGED_EVENT, type AppLayoutMode, readAppLayoutMode, writeAppLayoutMode } from '../ui-state/appLayoutMode';

export {
  replaceConversationMetaInSessionList,
  resolveConversationComposerRunState,
  resolveConversationCwdChangeAction,
  resolveConversationPerformanceMode,
  resolveDisplayedConversationPendingStatusLabel,
  shouldDeferConversationFileRefresh,
  shouldFetchConversationAttachments,
  shouldFetchConversationLiveSessionGitContext,
  shouldLoadConversationModels,
  shouldShowMissingConversationState,
  shouldUseHealthyDesktopConversationState,
} from '../conversation/conversationPageState';
export {
  hasConversationTranscriptAcceptedPendingInitialPrompt,
  shouldAutoDispatchPendingInitialPrompt,
} from '../conversation/pendingInitialPromptLogic';
export { constrainPromptImageDimensions } from '../conversation/promptAttachments';

const ConversationArtifactModal = lazy(() =>
  import('../components/ConversationArtifactModal').then((module) => ({ default: module.ConversationArtifactModal })),
);
const ConversationDrawingsPickerModal = lazy(() =>
  import('../components/ConversationDrawingsPickerModal').then((module) => ({ default: module.ConversationDrawingsPickerModal })),
);

interface ExcalidrawEditorSavePayload {
  title: string;
  scene: ExcalidrawSceneData;
  sourceData: string;
  sourceMimeType: string;
  sourceName: string;
  previewData: string;
  previewMimeType: string;
  previewName: string;
  previewUrl: string;
}

const INITIAL_HISTORICAL_TAIL_BLOCKS = 60;
const HISTORICAL_TAIL_BLOCKS_STEP = 200;
const MAX_RELATED_THREAD_SELECTIONS = 5;
const MAX_VISIBLE_RELATED_THREAD_RESULTS = 10;
const RELATED_THREAD_RECENT_WINDOW_DAYS = 3;
const MAX_RELATED_THREAD_CANDIDATES = 24;

const HISTORICAL_TAIL_BLOCKS_JUMP_PADDING = 40;
const MAX_AUTOMATIC_HISTORICAL_TAIL_BLOCKS = 200;
const MAX_RENDERED_BLOCKS = 300;
const HISTORICAL_PREFETCH_SCROLL_THRESHOLD_PX = 1400;
const HISTORICAL_BACKGROUND_PREFETCH_DELAY_MS = 1500;
const EMPTY_ASK_USER_QUESTION_ANSWERS: AskUserQuestionAnswers = {};
const WORKBENCH_BROWSER_COMMENT_ADDED_EVENT = 'pa:workbench-browser-comment-added';
const EMPTY_PENDING_BROWSER_COMMENTS: PendingBrowserComment[] = [];

interface PendingBrowserComment {
  id: string;
  createdAt: string;
  target: DesktopWorkbenchBrowserCommentTarget;
  comment: string;
}

function isPendingBrowserComment(value: unknown): value is PendingBrowserComment {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const comment = value as Partial<PendingBrowserComment>;
  return (
    typeof comment.id === 'string' &&
    typeof comment.createdAt === 'string' &&
    typeof comment.comment === 'string' &&
    Boolean(comment.target) &&
    typeof comment.target?.url === 'string'
  );
}

function formatBrowserCommentTargetLabel(target: DesktopWorkbenchBrowserCommentTarget): string {
  const role = target.role?.trim() || 'element';
  const name = target.accessibleName?.trim() || target.textSnippet?.trim() || target.selector?.trim() || target.url;
  return `${role}${name ? `: ${name}` : ''}`;
}

function formatBrowserCommentsContext(comments: PendingBrowserComment[]): string {
  const lines = ['Browser comments from the workbench:'];
  comments.forEach((entry, index) => {
    const target = entry.target;
    lines.push('', `Comment ${index + 1}:`, `URL: ${target.url}`, `Page title: ${target.title || '(untitled)'}`);
    lines.push(`Target: ${formatBrowserCommentTargetLabel(target)}`);
    if (target.selector) lines.push(`Selector: ${target.selector}`);
    if (target.xpath) lines.push(`XPath: ${target.xpath}`);
    if (target.testId) lines.push(`Test id: ${target.testId}`);
    if (target.textSnippet) lines.push(`Element text: ${target.textSnippet}`);
    if (target.surroundingText) lines.push(`Nearby text: ${target.surroundingText}`);
    if (target.elementHtmlPreview) lines.push(`Element HTML preview: ${target.elementHtmlPreview}`);
    lines.push(
      `Viewport rect: x=${target.viewportRect.x}, y=${target.viewportRect.y}, width=${target.viewportRect.width}, height=${target.viewportRect.height}`,
    );
    lines.push(`User comment: ${entry.comment}`);
  });
  return lines.join('\n');
}

function buildBrowserCommentContextMessages(comments: PendingBrowserComment[]): Array<{ customType: string; content: string }> | undefined {
  if (comments.length === 0) {
    return undefined;
  }
  return [{ customType: 'browser-comments', content: formatBrowserCommentsContext(comments) }];
}

function buildBrowserChangedContextMessage(state: DesktopWorkbenchBrowserState | null): { customType: string; content: string } | null {
  if (!state?.changedSinceLastSnapshot) {
    return null;
  }

  return {
    customType: 'browser-changed-since-snapshot',
    content: [
      'The Workbench Browser changed after the agent last snapshotted it. The user may have navigated, logged in, typed, clicked, or otherwise changed page state manually.',
      `Current URL: ${state.url || '(unknown)'}`,
      `Current title: ${state.title || '(untitled)'}`,
      `Current loading state: ${state.loading ? 'loading' : 'not loading'}`,
      `Browser revision: ${state.browserRevision ?? 'unknown'}`,
      `Last snapshot revision: ${state.lastSnapshotRevision ?? 'unknown'}`,
      state.lastChangeReason ? `Last change reason: ${state.lastChangeReason}` : '',
      state.lastChangedAt ? `Last changed at: ${state.lastChangedAt}` : '',
      'Take a fresh browser_snapshot before relying on prior page observations.',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

async function readBrowserChangedContextMessage(sessionKey: string): Promise<{ customType: string; content: string } | null> {
  const bridge = getDesktopBridge();
  if (!bridge?.getWorkbenchBrowserState) {
    return null;
  }

  try {
    return buildBrowserChangedContextMessage(await bridge.getWorkbenchBrowserState({ sessionKey }));
  } catch {
    return null;
  }
}

function mergeContextMessages(
  ...groups: Array<Array<{ customType: string; content: string }> | undefined>
): Array<{ customType: string; content: string }> | undefined {
  const messages = groups.flatMap((group) => group ?? []);
  return messages.length > 0 ? messages : undefined;
}

function buildBrowserCommentsStorageKey(draft: boolean, conversationId: string | undefined): string | null {
  if (draft) {
    return 'pa:reload:draft-conversation:browser-comments';
  }
  return conversationId ? `pa:reload:conversation:${conversationId}:browser-comments` : null;
}

function normalizePendingBrowserComments(value: unknown): PendingBrowserComment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isPendingBrowserComment).slice(0, 20);
}

function buildComposerQuestionAnswersStorageKey(conversationId: string | undefined, pendingQuestionKey: string): string | null {
  if (!conversationId || !pendingQuestionKey) {
    return null;
  }

  return `pa:conversation-question-answers:${conversationId}:${pendingQuestionKey}`;
}

function hasAskUserQuestionAnswers(answers: AskUserQuestionAnswers): boolean {
  return Object.values(answers).some((values) => values.length > 0);
}

function hasBlockingOverlayOpen(): boolean {
  return typeof document !== 'undefined' && hasBlockingConversationOverlay();
}

export function shouldEnableMessageForkControls({
  renderingStaleTranscript,
  conversationId,
}: {
  renderingStaleTranscript: boolean;
  conversationId: string | undefined;
}): boolean {
  return !renderingStaleTranscript && Boolean(conversationId);
}

// ── ConversationPage ──────────────────────────────────────────────────────────

export function createDraftMissionTask(description: string) {
  return { id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 3)}`, description, status: 'pending' as const };
}

export function buildMissionAutoModeInputFromDraft(
  draftMission: { goal?: string },
  currentState: { mission?: { tasks?: Array<{ id: string; description: string; status: string }> } },
) {
  return { mode: 'mission' as const, enabled: true, mission: { goal: draftMission.goal ?? '', tasks: currentState.mission?.tasks ?? [] } };
}

export type GoalModeToggleAction =
  | { kind: 'enable-now'; conversationId: string; objective: string }
  | { kind: 'enable-pending' }
  | { kind: 'disable-now'; conversationId: string }
  | { kind: 'disable-pending' };

export function resolveGoalModeToggleAction(input: {
  conversationId?: string;
  goalEnabled: boolean;
  composerText: string;
}): GoalModeToggleAction {
  if (input.goalEnabled) {
    return input.conversationId ? { kind: 'disable-now', conversationId: input.conversationId } : { kind: 'disable-pending' };
  }

  const objective = input.composerText.trim();
  if (input.conversationId && objective) {
    return { kind: 'enable-now', conversationId: input.conversationId, objective };
  }

  return { kind: 'enable-pending' };
}

export async function applyGoalModeToggleAction(
  action: GoalModeToggleAction,
  updateGoal: (conversationId: string, input: { objective?: string }) => Promise<unknown>,
  setPending: (pending: boolean) => void,
): Promise<void> {
  if (action.kind === 'enable-now') {
    setPending(true);
    try {
      await updateGoal(action.conversationId, { objective: action.objective });
    } catch (error) {
      setPending(false);
      throw error;
    }
    return;
  }

  if (action.kind === 'enable-pending') {
    setPending(true);
    return;
  }

  setPending(false);
  if (action.kind === 'disable-now') {
    await updateGoal(action.conversationId, {});
  }
}

export function ConversationPage({ draft = false }: { draft?: boolean }) {
  const { id: routeId } = useParams<{ id?: string }>();
  const id = draft ? undefined : routeId;
  const location = useLocation();
  const navigate = useNavigate();
  const selectedArtifactId = getConversationArtifactIdFromSearch(location.search);
  const selectedCheckpointId = getConversationCheckpointIdFromSearch(location.search);
  const selectedRunId = getConversationRunIdFromSearch(location.search);
  const previousSelectedCheckpointIdRef = useRef<string | null | undefined>(undefined);
  const previousSelectedRunIdRef = useRef<string | null | undefined>(undefined);
  const [appLayoutMode, setAppLayoutMode] = useState<AppLayoutMode>(() => readAppLayoutMode());
  const artifactOpensInWorkbenchPane = appLayoutMode === 'workbench';
  const { versions } = useAppEvents();
  const { tasks, sessions, runs, setRuns, setSessions } = useAppData();
  const conversationEventVersion = useConversationEventVersion(id);
  const openArtifact = useCallback(
    (artifactId: string) => {
      if (selectedArtifactId === artifactId) {
        return;
      }

      const nextSearch = setConversationCheckpointIdInSearch(setConversationArtifactIdInSearch(location.search, artifactId), null);

      navigate({
        pathname: location.pathname,
        search: nextSearch,
      });
    },
    [location.pathname, location.search, navigate, selectedArtifactId],
  );

  const openCheckpoint = useCallback(
    (checkpointId: string) => {
      setAppLayoutMode('workbench');
      writeAppLayoutMode('workbench');

      if (selectedCheckpointId === checkpointId) {
        return;
      }

      const nextSearch = setConversationArtifactIdInSearch(setConversationCheckpointIdInSearch(location.search, checkpointId), null);

      navigate({
        pathname: location.pathname,
        search: nextSearch,
      });
    },
    [location.pathname, location.search, navigate, selectedCheckpointId],
  );

  const openRun = useCallback(
    (runId: string) => {
      setAppLayoutMode('workbench');
      writeAppLayoutMode('workbench');

      const nextSearch = setConversationArtifactIdInSearch(
        setConversationCheckpointIdInSearch(setConversationRunIdInSearch(location.search, runId), null),
        null,
      );

      navigate({
        pathname: location.pathname,
        search: nextSearch,
      });
    },
    [location.pathname, location.search, navigate],
  );

  const openWorkbenchBrowser = useCallback(() => {
    window.dispatchEvent(new CustomEvent(DESKTOP_SHOW_WORKBENCH_BROWSER_EVENT));
  }, []);

  const openKnowledgeFilePath = useCallback(
    (fileId: string) => {
      const normalizedFileId = fileId.trim();
      if (!normalizedFileId) {
        return;
      }

      setAppLayoutMode('workbench');
      writeAppLayoutMode('workbench');

      const nextSearch = new URLSearchParams(location.search);
      nextSearch.delete('artifact');
      nextSearch.delete('checkpoint');
      nextSearch.delete('run');
      nextSearch.set('file', normalizedFileId);

      navigate({
        pathname: location.pathname,
        search: nextSearch.toString(),
      });
    },
    [location.pathname, location.search, navigate],
  );

  useEffect(() => {
    function handleAppLayoutModeChanged() {
      setAppLayoutMode(readAppLayoutMode());
    }

    window.addEventListener(APP_LAYOUT_MODE_CHANGED_EVENT, handleAppLayoutModeChanged);
    window.addEventListener('storage', handleAppLayoutModeChanged);
    return () => {
      window.removeEventListener(APP_LAYOUT_MODE_CHANGED_EVENT, handleAppLayoutModeChanged);
      window.removeEventListener('storage', handleAppLayoutModeChanged);
    };
  }, []);

  useEffect(() => {
    const previousSelectedCheckpointId = previousSelectedCheckpointIdRef.current;
    previousSelectedCheckpointIdRef.current = selectedCheckpointId;

    if (!selectedCheckpointId || selectedCheckpointId === previousSelectedCheckpointId || appLayoutMode === 'workbench') {
      return;
    }

    setAppLayoutMode('workbench');
    writeAppLayoutMode('workbench');
  }, [appLayoutMode, selectedCheckpointId]);

  useEffect(() => {
    const previousSelectedRunId = previousSelectedRunIdRef.current;
    previousSelectedRunIdRef.current = selectedRunId;

    if (!selectedRunId || selectedRunId === previousSelectedRunId || appLayoutMode === 'workbench') {
      return;
    }

    setAppLayoutMode('workbench');
    writeAppLayoutMode('workbench');
  }, [appLayoutMode, selectedRunId]);

  useEffect(() => {
    if (draft || !id) {
      return;
    }

    ensureConversationTabOpen(id);
  }, [draft, id]);

  // ── Live session detection ─────────────────────────────────────────────────
  const rawSessionSnapshot = useMemo(() => (id ? (sessions?.find((session) => session.id === id) ?? null) : null), [id, sessions]);
  const sessionSnapshot = rawSessionSnapshot;

  const sessionsLoaded = sessions !== null;
  // We use a confirmed-live flag only for lightweight session-state labeling.
  const [confirmedLive, setConfirmedLive] = useState<boolean | null>(null);
  const [liveSessionHasStaleTurnState, setLiveSessionHasStaleTurnState] = useState(false);
  const [pendingInitialPrompt, setPendingInitialPrompt] = useState<PendingConversationPrompt | null>(null);
  const [pendingInitialPromptDispatching, setPendingInitialPromptDispatchingState] = useState(false);
  const [draftPendingPrompt, setDraftPendingPrompt] = useState<PendingConversationPrompt | null>(null);
  const pendingInitialPromptSessionIdRef = useRef<string | null>(null);
  const pendingInitialPromptFailureSessionIdRef = useRef<string | null>(null);
  const pinnedInitialPromptScrollSessionIdRef = useRef<string | null>(null);
  const pinnedInitialPromptTailKeyRef = useRef<string | null>(null);
  const deferredConversationFileVersionRef = useRef<{ conversationId: string; version: number } | null>(null);
  const handledCwdChangeKeyRef = useRef<string | null>(null);

  const hasPendingInitialPromptInFlight = Boolean(id) && pendingInitialPromptSessionIdRef.current === id;
  const deferConversationFileRefresh = shouldDeferConversationFileRefresh({
    draft,
    conversationId: id,
    hasPendingInitialPrompt: Boolean(pendingInitialPrompt),
    pendingInitialPromptDispatching,
    hasPendingInitialPromptInFlight,
  });
  const deferredConversationFileVersion = deferredConversationFileVersionRef.current;
  const effectiveConversationEventVersion =
    deferConversationFileRefresh && deferredConversationFileVersion !== null && deferredConversationFileVersion.conversationId === id
      ? deferredConversationFileVersion.version
      : conversationEventVersion;

  const [historicalTailBlocks, setHistoricalTailBlocks] = useState(INITIAL_HISTORICAL_TAIL_BLOCKS);
  const [initialHistoricalWarmupConversationId, setInitialHistoricalWarmupConversationId] = useState<string | null>(null);
  const desktopConversation = useDesktopConversationState(id ?? null, {
    tailBlocks: historicalTailBlocks,
    enabled: shouldSubscribeToDesktopConversationState({ draft }),
  });
  const desktopConversationChecking = !draft && Boolean(id) && desktopConversation.mode === 'checking';
  const useDesktopConversation = shouldUseHealthyDesktopConversationState({
    draft,
    conversationId: id,
    desktopMode: desktopConversation.mode,
    desktopError: desktopConversation.error,
  });
  const visibleDesktopConversationState =
    useDesktopConversation && id && desktopConversation.state?.conversationId === id ? desktopConversation.state : null;
  const conversationVersionKey = `${effectiveConversationEventVersion}`;
  const { data: webConversationBootstrap, loading: webConversationBootstrapLoading } = useConversationBootstrap(
    draft || useDesktopConversation || desktopConversationChecking ? undefined : id,
    {
      tailBlocks: historicalTailBlocks,
      versionKey: conversationVersionKey,
    },
  );
  const visibleConversationBootstrap = useDesktopConversation
    ? id && visibleDesktopConversationState
      ? {
          conversationId: id,
          sessionDetail: visibleDesktopConversationState.sessionDetail,
          liveSession: visibleDesktopConversationState.liveSession,
        }
      : null
    : id && webConversationBootstrap?.conversationId === id
      ? webConversationBootstrap
      : null;
  const bootstrapSessionDetail = useDesktopConversation
    ? (visibleDesktopConversationState?.sessionDetail ?? null)
    : id && visibleConversationBootstrap?.sessionDetail?.meta.id === id
      ? visibleConversationBootstrap.sessionDetail
      : null;
  const conversationBootstrapLoading = useDesktopConversation
    ? desktopConversation.loading
    : desktopConversationChecking
      ? true
      : webConversationBootstrapLoading;
  const confirmedLiveValue = useDesktopConversation ? (visibleConversationBootstrap?.liveSession.live ?? null) : null;

  useEffect(() => {
    if (draft || !id || deferConversationFileRefresh) {
      return;
    }

    deferredConversationFileVersionRef.current = {
      conversationId: id,
      version: conversationEventVersion,
    };
  }, [conversationEventVersion, deferConversationFileRefresh, draft, id]);

  // ── Desktop bridge is the only stream path. If the bridge is unavailable
  // the conversation is read-only — no live streaming is possible.
  const stream =
    useDesktopConversation && visibleDesktopConversationState
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
      : {
          ...INITIAL_STREAM_STATE,
          surfaceId: '',
          reconnect: async () => {},
          send: async () => undefined,
          parallel: async () => {},
          manageParallelJob: async () => {},
          abort: async () => {},
          takeover: async () => {},
        };
  const streamSend = stream.send;
  const streamParallel = stream.parallel;
  const streamManageParallelJob = stream.manageParallelJob;
  const streamAbort = stream.abort;
  const streamReconnect = stream.reconnect;
  const streamTakeover = stream.takeover;
  const currentSurfaceId = stream.surfaceId;

  useEffect(() => {
    const cwdChangeAction = resolveConversationCwdChangeAction({
      conversationId: id,
      cwdChange: stream.cwdChange,
      handledKey: handledCwdChangeKeyRef.current,
    });
    if (cwdChangeAction.action === 'none') {
      return;
    }

    handledCwdChangeKeyRef.current = cwdChangeAction.key;
    if (stream.cwdChange?.autoContinued) {
      setPendingAssistantStatusLabel('Working…');
    }

    if (cwdChangeAction.action === 'navigate') {
      ensureConversationTabOpen(cwdChangeAction.conversationId);
      navigate(`/conversations/${cwdChangeAction.conversationId}`);
      return;
    }

    streamReconnect();
  }, [id, navigate, stream.cwdChange, streamReconnect]);

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
      setLiveSessionHasStaleTurnState(
        visibleConversationBootstrap?.liveSession.live === true && visibleConversationBootstrap.liveSession.hasStaleTurnState === true,
      );
      return;
    }

    if (!id) {
      setConfirmedLive(false);
      setLiveSessionHasStaleTurnState(false);
      return;
    }

    if (visibleConversationBootstrap?.liveSession.live) {
      setConfirmedLive(true);
      setLiveSessionHasStaleTurnState(visibleConversationBootstrap.liveSession.hasStaleTurnState === true);
      return;
    }

    if (visibleConversationBootstrap?.liveSession.live === false || sessionSnapshot?.isLive === false) {
      setConfirmedLive(false);
      setLiveSessionHasStaleTurnState(false);
      return;
    }

    setConfirmedLive(sessionSnapshot?.isLive === true ? true : null);
    let cancelled = false;

    api
      .liveSession(id)
      .then((response) => {
        if (cancelled) {
          return;
        }

        setConfirmedLive(response.live);
        setLiveSessionHasStaleTurnState(response.live && response.hasStaleTurnState === true);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith('404 ') || (sessionsLoaded && sessionSnapshot?.isLive !== true)) {
          setConfirmedLive(false);
        }
        setLiveSessionHasStaleTurnState(false);
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
  const conversationLiveDecision =
    visibleConversationBootstrap?.liveSession.live ??
    sessionSnapshot?.isLive ??
    (useDesktopConversation ? confirmedLiveValue : confirmedLive);
  const conversationNeedsTakeover = false;
  const composerRunState = resolveConversationComposerRunState({
    streamIsStreaming: stream.isStreaming,
    sessionIsRunning: sessionSnapshot?.isRunning,
    bootstrapLiveSessionIsStreaming:
      visibleConversationBootstrap?.liveSession.live === true ? visibleConversationBootstrap.liveSession.isStreaming : false,
    desktopLiveSessionIsStreaming:
      visibleDesktopConversationState?.liveSession.live === true ? visibleDesktopConversationState.liveSession.isStreaming : false,
    hasStaleTurnState: liveSessionHasStaleTurnState,
  });
  const allowQueuedPrompts = composerRunState.allowQueuedPrompts;
  const defaultComposerBehavior = composerRunState.defaultComposerBehavior;
  const conversationRunningForPage = composerRunState.streamControlsActive || liveSessionHasStaleTurnState;

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

  const bootstrapPendingInitialSessionDetail =
    !useDesktopConversation && Boolean(id) && conversationBootstrapLoading && !bootstrapSessionDetail;
  const {
    detail: webSessionDetail,
    loading: webSessionLoading,
    error: webSessionError,
  } = useSessionDetail(bootstrapPendingInitialSessionDetail || useDesktopConversation || desktopConversationChecking ? undefined : id, {
    tailBlocks: historicalTailBlocks,
    version: effectiveConversationEventVersion,
  });
  const sessionDetail = useDesktopConversation ? (visibleDesktopConversationState?.sessionDetail ?? null) : webSessionDetail;
  const sessionLoading = useDesktopConversation ? desktopConversation.loading : desktopConversationChecking ? true : webSessionLoading;
  const sessionError = useDesktopConversation ? desktopConversation.error : desktopConversationChecking ? null : webSessionError;
  const visibleSessionDetail = useDesktopConversation
    ? sessionDetail
    : sessionDetail?.meta.id === id
      ? sessionDetail
      : bootstrapSessionDetail;
  const [hydratedHistoricalBlocks, setHydratedHistoricalBlocks] = useState<Record<string, MessageBlock>>({});
  const [hydratingHistoricalBlockIds, setHydratingHistoricalBlockIds] = useState<string[]>([]);
  const hydratingHistoricalBlockIdSet = useMemo(
    () => buildHydratingHistoricalBlockIdSet(hydratingHistoricalBlockIds),
    [hydratingHistoricalBlockIds],
  );

  useEffect(() => {
    setHydratedHistoricalBlocks({});
    setHydratingHistoricalBlockIds([]);
    setRequestedFocusMessageIndex(null);
    pendingJumpMessageIndexRef.current = null;
  }, [id]);

  const hydrateHistoricalBlock = useCallback(
    async (blockId: string) => {
      const normalizedBlockId = normalizeHistoricalBlockId(blockId);
      if (!id || !normalizedBlockId || hydratingHistoricalBlockIds.includes(normalizedBlockId)) {
        return;
      }

      setHydratingHistoricalBlockIds((current) => addHydratingHistoricalBlockId(current, normalizedBlockId));

      try {
        const block = await api.sessionBlock(id, normalizedBlockId);
        const messageBlock = displayBlockToMessageBlock(block);
        setHydratedHistoricalBlocks((current) => ({
          ...current,
          [normalizedBlockId]: messageBlock,
        }));
      } catch (error) {
        console.error('Failed to hydrate historical block', error);
        addNotification({
          type: 'warning',
          message: 'Failed to load message details',
          details: error instanceof Error ? error.message : String(error),
          source: 'core',
        });
      } finally {
        setHydratingHistoricalBlockIds((current) => removeHydratingHistoricalBlockId(current, normalizedBlockId));
      }
    },
    [hydratingHistoricalBlockIds, id],
  );

  // Historical messages from the JSONL snapshot (doesn't update after load).
  // Memoize the conversion so typing in the composer does not rebuild long transcripts.
  const baseMessages = useMemo<MessageBlock[]>(
    () => (visibleSessionDetail ? mergeHydratedHistoricalBlocks(visibleSessionDetail.blocks, hydratedHistoricalBlocks) : []),
    [hydratedHistoricalBlocks, visibleSessionDetail],
  );
  const visibleStreamBlocks = useMemo<MessageBlock[]>(
    () => mergeHydratedStreamBlocks(stream.blocks, hydratedHistoricalBlocks),
    [hydratedHistoricalBlocks, stream.blocks],
  );

  // Pending steer/followup queue as reported by the live session.
  const pendingQueue = useMemo(() => buildConversationPendingQueueItems(stream.pendingQueue), [stream.pendingQueue]);
  const parallelJobs = useMemo(() => (Array.isArray(stream.parallelJobs) ? stream.parallelJobs : []), [stream.parallelJobs]);

  // Live sessions hydrate from the SSE snapshot; until that arrives, fall back to
  // JSONL + live deltas only when we have at least one source of blocks.
  const computedMessagesRaw = useMemo<MessageBlock[] | undefined>(() => {
    if (draft) {
      return appendPendingInitialPromptBlock(undefined, draftPendingPrompt);
    }

    if (isLiveSession) {
      const liveMessages = stream.hasSnapshot
        ? visibleStreamBlocks
        : baseMessages.length > 0 || visibleStreamBlocks.length > 0
          ? [...baseMessages, ...visibleStreamBlocks]
          : undefined;
      return appendPendingInitialPromptBlock(liveMessages, pendingInitialPrompt);
    }

    return visibleSessionDetail ? baseMessages : undefined;
  }, [
    baseMessages,
    draft,
    draftPendingPrompt,
    isLiveSession,
    pendingInitialPrompt,
    stream.hasSnapshot,
    visibleSessionDetail,
    visibleStreamBlocks,
  ]);
  const computedHistoricalBlockOffsetRaw = stream.hasSnapshot ? stream.blockOffset : (visibleSessionDetail?.blockOffset ?? 0);
  const computedHistoricalTotalBlocksRaw = stream.hasSnapshot
    ? stream.totalBlocks
    : (visibleSessionDetail?.totalBlocks ?? computedMessagesRaw?.length ?? 0);

  // Prune old transcript blocks above MAX_RENDERED_BLOCKS so the renderer doesn't
  // accumulate thousands of blocks in memory. Dropped blocks are still on disk and
  // re-fetched if the user scrolls back up.
  const { computedMessages, computedHistoricalBlockOffset, computedHistoricalTotalBlocks } = useMemo(() => {
    const msgs = computedMessagesRaw;
    if (!msgs || msgs.length <= MAX_RENDERED_BLOCKS) {
      return {
        computedMessages: msgs,
        computedHistoricalBlockOffset: computedHistoricalBlockOffsetRaw,
        computedHistoricalTotalBlocks: computedHistoricalTotalBlocksRaw,
      };
    }

    const excess = msgs.length - MAX_RENDERED_BLOCKS;
    return {
      computedMessages: msgs.slice(excess),
      computedHistoricalBlockOffset: computedHistoricalBlockOffsetRaw + excess,
      computedHistoricalTotalBlocks: computedHistoricalTotalBlocksRaw,
    };
  }, [computedHistoricalBlockOffsetRaw, computedHistoricalTotalBlocksRaw, computedMessagesRaw]);

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
        current &&
        current.conversationId === id &&
        current.messages === computedMessages &&
        current.historicalBlockOffset === computedHistoricalBlockOffset &&
        current.historicalTotalBlocks === computedHistoricalTotalBlocks
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

  const preservedTranscriptState = id && stableTranscriptState?.conversationId === id ? stableTranscriptState : null;
  const realMessages = computedMessages && computedMessages.length > 0 ? computedMessages : preservedTranscriptState?.messages;
  const historicalBlockOffset =
    computedMessages && computedMessages.length > 0
      ? computedHistoricalBlockOffset
      : (preservedTranscriptState?.historicalBlockOffset ?? computedHistoricalBlockOffset);
  const historicalTotalBlocks =
    computedMessages && computedMessages.length > 0
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
  const initialHistoricalWarmupTailLoaded = hasConversationLoadedHistoricalTailBlocks(visibleSessionDetail, initialHistoricalWarmupTarget);
  const showHistoricalLoadMore = historicalHasOlderBlocks;
  const messageIndexOffset = historicalBlockOffset;
  const messageCount = realMessages?.length ?? 0;
  const hasRenderableMessages = messageCount > 0;
  const initialScrollKey = useMemo(
    () =>
      getConversationInitialScrollKey(id ?? null, {
        isLiveSession,
        hasLiveSnapshot: stream.hasSnapshot,
      }),
    [id, isLiveSession, stream.hasSnapshot],
  );
  const hydratingLiveConversation = isLiveSession && !stream.hasSnapshot && !visibleSessionDetail && stream.blocks.length === 0;
  const showBootstrapLoadingState = shouldShowConversationBootstrapLoadingState({
    draft,
    conversationId: id,
    conversationBootstrapLoading,
    hasRenderableMessages,
    hasVisibleSessionDetail: Boolean(visibleSessionDetail),
  });
  const showConversationLoadingState =
    showBootstrapLoadingState || (!hasRenderableMessages && (sessionLoading || hydratingLiveConversation));
  const scrollBinding = resolveConversationVisibleScrollBinding({
    draft,
    routeConversationId: id,
    realMessages,
    stableTranscriptState,
    showConversationLoadingState,
    initialScrollKey,
    isStreaming: stream.isStreaming,
  });
  const pendingAskUserQuestion = useMemo(() => findPendingAskUserQuestion(realMessages), [realMessages]);
  const pendingAskUserQuestionKey = useMemo(() => buildPendingAskUserQuestionKey(pendingAskUserQuestion), [pendingAskUserQuestion]);
  const composerQuestionAnswersStorageKey = useMemo(
    () => buildComposerQuestionAnswersStorageKey(id, pendingAskUserQuestionKey),
    [id, pendingAskUserQuestionKey],
  );
  const [composerQuestionIndex, setComposerQuestionIndex] = useState(0);
  const [composerQuestionOptionIndex, setComposerQuestionOptionIndex] = useState(0);
  const [composerQuestionAnswers, setComposerQuestionAnswers, clearComposerQuestionAnswers] = useReloadState<AskUserQuestionAnswers>({
    storageKey: composerQuestionAnswersStorageKey,
    initialValue: EMPTY_ASK_USER_QUESTION_ANSWERS,
    shouldPersist: hasAskUserQuestionAnswers,
  });
  const [composerQuestionSubmitting, setComposerQuestionSubmitting] = useState(false);
  const artifactAutoOpenSeededRef = useRef(false);
  const artifactAutoOpenStartedAtRef = useRef(new Date().toISOString());
  const processedArtifactAutoOpenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    artifactAutoOpenSeededRef.current = false;
    artifactAutoOpenStartedAtRef.current = new Date().toISOString();
    processedArtifactAutoOpenIdsRef.current = new Set();
  }, [id]);

  useEffect(() => {
    if (!realMessages) {
      return;
    }

    if (!artifactAutoOpenSeededRef.current) {
      processedArtifactAutoOpenIdsRef.current = collectCompletedToolAutoOpenBlockKeys(realMessages, readArtifactPresentation, 'artifact');
      artifactAutoOpenSeededRef.current = true;
      return;
    }

    const nextArtifact = findRequestedToolPresentationToOpen({
      messages: realMessages,
      processedBlockKeys: processedArtifactAutoOpenIdsRef.current,
      autoOpenStartedAt: artifactAutoOpenStartedAtRef.current,
      readPresentation: readArtifactPresentation,
      getTargetId: (artifact) => artifact.artifactId,
      keyPrefix: 'artifact',
    });
    for (const blockKey of nextArtifact.processedBlockKeys) {
      processedArtifactAutoOpenIdsRef.current.add(blockKey);
    }
    if (nextArtifact.targetId) {
      openArtifact(nextArtifact.targetId);
    }
  }, [openArtifact, realMessages]);

  const { titles, setTitle: pushTitle } = useLiveTitles();

  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleSaving, setTitleSaving] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const conversationHeaderRef = useRef<HTMLDivElement>(null);
  const [conversationHeaderOffset, setConversationHeaderOffset] = useState(96);

  useEffect(() => {
    setTitleOverride(null);
    setIsEditingTitle(false);
    setTitleDraft('');
    setTitleSaving(false);
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
      setConversationHeaderOffset((current) => (current === nextHeight ? current : nextHeight));
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
  const { models, defaultModel, defaultVisionModel, defaultThinkingLevel, defaultServiceTier } = useConversationModels(shouldLoadModels);
  const [currentModel, setCurrentModel] = useState<string>('');
  const [currentThinkingLevel, setCurrentThinkingLevel] = useState<string>('');
  const [currentServiceTier, setCurrentServiceTier] = useState<string>('');
  const [hasExplicitServiceTier, setHasExplicitServiceTier] = useState(false);
  const resolvedCurrentModelId = useMemo(
    () =>
      resolveSelectableModelId({
        requestedModel: currentModel,
        defaultModel,
        models,
      }),
    [currentModel, defaultModel, models],
  );
  const selectedComposerModel = useMemo(
    () => models.find((model) => model.id === (currentModel || defaultModel)) ?? null,
    [currentModel, defaultModel, models],
  );
  const createLiveSessionPreferenceInput = useMemo(
    () => ({
      ...(resolvedCurrentModelId ? { model: resolvedCurrentModelId } : {}),
      ...(currentThinkingLevel ? { thinkingLevel: currentThinkingLevel } : {}),
      ...buildConversationServiceTierPreferenceInput({ currentServiceTier, hasExplicitServiceTier }),
    }),
    [currentThinkingLevel, currentServiceTier, hasExplicitServiceTier, resolvedCurrentModelId],
  );
  const initialModelPreferenceState = useMemo(
    () =>
      resolveConversationInitialModelPreferenceState({
        draft,
        conversationId: id,
        locationState: location.state,
        defaultModel,
        defaultThinkingLevel,
        defaultServiceTier,
      }),
    [defaultModel, defaultThinkingLevel, defaultServiceTier, draft, id, location.state],
  );
  const initialDeferredResumeState = useMemo(
    () =>
      resolveConversationInitialDeferredResumeState({
        draft,
        conversationId: id,
        locationState: location.state,
      }),
    [draft, id, location.state],
  );
  const initialDraftHydrationState = useMemo(
    () =>
      resolveConversationDraftHydrationState({
        draft,
        conversationId: id,
        locationState: location.state,
      }),
    [draft, id, location.state],
  );
  const appliedInitialModelPreferenceLocationKeyRef = useRef<string | null>(null);
  const skippedInitialDeferredResumeLocationKeyRef = useRef<string | null>(null);
  const attemptedDeferredResumeAutoResumeKeyRef = useRef<string | null>(null);
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
    if (!draft) {
      setDraftCwdValue('');
      return;
    }

    const syncDraftPreferences = () => {
      const serviceTierState = resolveDraftConversationServiceTierState(readDraftConversationServiceTier(), defaultServiceTier);
      setCurrentModel(
        resolveSelectableModelId({
          requestedModel: readDraftConversationModel(),
          defaultModel,
          models,
        }),
      );
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
    api
      .conversationModelPreferences(id)
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
  }, [
    conversationEventVersion,
    defaultModel,
    defaultThinkingLevel,
    defaultServiceTier,
    draft,
    id,
    initialModelPreferenceState,
    location.key,
  ]);

  useEffect(() => {
    if (draft) {
      return;
    }

    if (!id) {
      return;
    }
  }, [conversationEventVersion, draft, id, initialDraftHydrationState]);

  const composerDraftStorageKey = draft ? buildDraftConversationComposerStorageKey() : id ? buildConversationComposerStorageKey(id) : null;
  const browserCommentsStorageKey = buildBrowserCommentsStorageKey(draft, id);

  // Input state
  const [input, setInputState] = useReloadState<string>({
    storageKey: composerDraftStorageKey,
    initialValue: '',
    shouldPersist: (value) => value.length > 0,
  });

  // Goal mode
  const [composerGoalPending, setComposerGoalPending] = useState(false);
  useEffect(() => {
    if (composerGoalPending && stream.goalState?.status === 'active') {
      setComposerGoalPending(false);
    }
  }, [composerGoalPending, stream.goalState?.status]);
  const goalEnabled = composerGoalPending || stream.goalState?.status === 'active';
  const toggleGoalMode = useCallback(async () => {
    const action = resolveGoalModeToggleAction({ conversationId: id, goalEnabled, composerText: input });
    await applyGoalModeToggleAction(action, api.updateGoal, setComposerGoalPending);
  }, [id, goalEnabled, input]);
  const [extensionSlashCommands, setExtensionSlashCommands] = useState<ExtensionSlashCommandRegistration[]>([]);
  const [extensionMentionRegistrations, setExtensionMentionRegistrations] = useState<ExtensionMentionRegistration[]>([]);
  const [extensionMentionItems, setExtensionMentionItems] = useState<MentionItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.extensionSlashCommands(), api.extensionMentions()])
      .then(([commands, mentions]) => {
        if (!cancelled) {
          setExtensionSlashCommands(commands);
          setExtensionMentionRegistrations(mentions);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExtensionSlashCommands([]);
          setExtensionMentionRegistrations([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Current context usage (compaction-aware)
  const sessionTokens = useMemo(
    () =>
      resolveConversationContextUsageTokens({
        isLiveSession,
        liveUsage: stream.contextUsage,
        historicalUsage: visibleSessionDetail?.contextUsage,
        models,
        currentModel,
        routeModel: model,
      }),
    [currentModel, isLiveSession, model, models, stream.contextUsage, visibleSessionDetail?.contextUsage],
  );

  const [liveSessionContext, setLiveSessionContext] = useState<LiveSessionContext | null>(null);
  const [draftWorkspaceGit, setDraftWorkspaceGit] = useState<{
    branch: string | null;
    changeCount: number;
    linesAdded: number;
    linesDeleted: number;
  } | null>(null);

  const [notice, setNotice] = useState<{ tone: 'accent' | 'danger'; text: string } | null>(null);
  const [savingPreference, setSavingPreference] = useState<'model' | 'thinking' | 'serviceTier' | null>(null);
  const [modelIdx, setModelIdx] = useState(0);
  const noticeTimeoutRef = useRef<number | null>(null);
  const showNotice = useCallback((tone: 'accent' | 'danger', text: string, durationMs = 2500) => {
    setNotice({ tone, text });
    if (tone === 'danger') {
      addNotification({ type: 'warning', message: text, source: 'core' });
    }
    if (noticeTimeoutRef.current !== null) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimeoutRef.current = null;
    }, durationMs);
  }, []);

  const ensureConversationCanControl = useCallback((_action: string): boolean => {
    return true;
  }, []);
  const setInput = useCallback(
    (next: string) => {
      if (draft) {
        persistDraftConversationComposer(next);
      } else if (id) {
        persistForkPromptDraft(id, next);
      }

      setInputState(next);
    },
    [draft, id, setInputState],
  );
  const [debouncedRelatedThreadsQuery, setDebouncedRelatedThreadsQuery] = useState(() => input.trim());
  const [relatedThreadSearchIndex, setRelatedThreadSearchIndex] = useState<Record<string, string>>({});
  const [relatedThreadSummaries, setRelatedThreadSummaries] = useState<Record<string, ConversationSummaryRecord>>({});
  const [relatedThreadSearchLoading, setRelatedThreadSearchLoading] = useState(false);
  const [relatedThreadSearchError, setRelatedThreadSearchError] = useState<string | null>(null);
  const [selectedRelatedThreadIds, setSelectedRelatedThreadIds] = useState<string[]>([]);
  const [autoSelectedRelatedThreadIds, setAutoSelectedRelatedThreadIds] = useState<string[]>([]);
  const [preparingRelatedThreadContext, setPreparingRelatedThreadContext] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const keyboardInset = useVisualViewportKeyboardInset();
  const [attachments, setAttachments] = useState<ComposerImageAttachment[]>([]);
  const showTextOnlyImageHint =
    attachments.length > 0 && selectedComposerModel !== null && !selectedComposerModel.input?.includes('image') && !defaultVisionModel;
  const [drawingAttachments, setDrawingAttachments] = useState<ComposerDrawingAttachment[]>([]);
  const [pendingBrowserComments, setPendingBrowserComments] = useReloadState<PendingBrowserComment[]>({
    storageKey: browserCommentsStorageKey,
    initialValue: EMPTY_PENDING_BROWSER_COMMENTS,
    deserialize: (raw) => normalizePendingBrowserComments(JSON.parse(raw) as unknown),
    shouldPersist: (comments) => comments.length > 0,
  });
  const [drawingsPickerOpen, setDrawingsPickerOpen] = useState(false);
  const [conversationAttachments, setConversationAttachments] = useState<ConversationAttachmentSummary[]>([]);
  const [attachedContextDocs, setAttachedContextDocs] = useState<ConversationContextDocRef[]>([]);
  const [contextDocsBusy, setContextDocsBusy] = useState(false);
  const [drawingsBusy, setDrawingsBusy] = useState(false);
  const [drawingsError, setDrawingsError] = useState<string | null>(null);
  const { composerAltHeld, composerParallelHeld } = useComposerModifierKeys();
  const [dragOver, setDragOver] = useState(false);
  const composerHistoryScopeId = draft ? null : (id ?? null);
  const [composerHistory, setComposerHistory] = useState<string[]>(() => readComposerHistory(composerHistoryScopeId));
  const [composerHistoryIndex, setComposerHistoryIndex] = useState<number | null>(null);
  const composerHistoryDraftRef = useRef('');
  const composerAttachmentScopeKey = draft ? 'draft' : id ? `conversation:${id}` : null;

  useEffect(() => {
    function handleBrowserCommentAdded(event: Event) {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isPendingBrowserComment(detail)) {
        return;
      }
      setPendingBrowserComments((current) => [...current, detail]);
      showNotice('accent', 'Browser comment attached to composer.', 2500);
    }

    window.addEventListener(WORKBENCH_BROWSER_COMMENT_ADDED_EVENT, handleBrowserCommentAdded);
    return () => window.removeEventListener(WORKBENCH_BROWSER_COMMENT_ADDED_EVENT, handleBrowserCommentAdded);
  }, [showNotice]);
  const composerAttachmentsHydratedRef = useRef(false);
  const lastComposerAttachmentScopeKeyRef = useRef<string | null>(composerAttachmentScopeKey);

  if (lastComposerAttachmentScopeKeyRef.current !== composerAttachmentScopeKey) {
    lastComposerAttachmentScopeKeyRef.current = composerAttachmentScopeKey;
    composerAttachmentsHydratedRef.current = false;
  }

  useInitialDraftAttachmentHydration({
    draft,
    conversationId: id,
    enabled: Boolean(initialDraftHydrationState),
    locationKey: location.key,
    setAttachments,
    setDrawingAttachments,
  });

  useLayoutEffect(() => {
    const storedAttachments = draft
      ? readDraftConversationAttachments()
      : id
        ? readConversationAttachments(id)
        : { images: [], drawings: [] };
    const fallbackNamePrefix = draft ? 'draft-image' : id ? `conversation-${id}-image` : 'conversation-image';

    setAttachments(restoreComposerImageFiles(storedAttachments.images, fallbackNamePrefix));
    setDrawingAttachments(storedAttachments.drawings);
    setDrawingsPickerOpen(false);
    setConversationAttachments([]);
    setAttachedContextDocs(draft ? readDraftConversationContextDocs() : []);
    setDrawingsError(null);
    setDragOver(false);
    setSlashIdx(0);
    setMentionIdx(0);
    composerAttachmentsHydratedRef.current = true;
  }, [draft, id]);

  useEffect(() => {
    if (!composerAttachmentsHydratedRef.current || (!draft && !id)) {
      return;
    }

    const mutationVersion = beginDraftConversationAttachmentsMutation();
    const images = buildPromptImages(attachments);
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
  }, [attachments, draft, drawingAttachments, id]);

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

  const restoreComposerDraft = useCallback(
    async (nextInput: string, nextAttachments: ComposerImageAttachment[], nextDrawingAttachments: ComposerDrawingAttachment[]) => {
      try {
        const images = buildPromptImages(nextAttachments);
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
    },
    [draft, id, setInput],
  );

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
      draft ||
      !id ||
      !pendingInitialPrompt ||
      !pendingInitialPromptDispatching ||
      !hasConversationTranscriptAcceptedPendingInitialPrompt({
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
    if (draft || !id || !pendingInitialPrompt || pendingInitialPromptDispatching || (realMessages?.length ?? 0) === 0) {
      return;
    }

    clearPendingConversationPrompt(id);
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
  const composerDisabled = conversationNeedsTakeover || preparingRelatedThreadContext || wholeLineBashRunning;

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
  const autocompleteCatalogDemand = useMemo(() => resolveConversationAutocompleteCatalogDemand(input), [input]);
  const [shouldLoadMemoryData, setShouldLoadMemoryData] = useState(() => autocompleteCatalogDemand.needsMemoryData);
  const [memoryData, setMemoryData] = useState<MemoryData | null>(null);
  const requestedMemoryDataRef = useRef(false);
  const conversationRunId = useMemo(() => (id ? createConversationLiveRunId(id) : null), [id]);
  const [conversationRun, setConversationRun] = useState<DurableRunRecord | null>(null);
  const [resumeConversationBusy, setResumeConversationBusy] = useState(false);
  const [deferredResumes, setDeferredResumes] = useState<DeferredResumeSummary[]>([]);
  const [deferredResumesBusy, setDeferredResumesBusy] = useState(false);
  const [showDeferredResumeDetails, setShowDeferredResumeDetails] = useState(false);
  const [cancellingBackgroundRunIds, setCancellingBackgroundRunIds] = useState<Set<string>>(() => new Set());
  const [deferredResumeNowMs, setDeferredResumeNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (draft || runs !== null) {
      return;
    }

    let cancelled = false;
    void api
      .runs()
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

  const cancelBackgroundRunFromShelf = useCallback(
    (runId: string) => {
      const normalizedRunId = runId.trim();
      if (!normalizedRunId) {
        return;
      }

      setCancellingBackgroundRunIds((current) => new Set(current).add(normalizedRunId));
      void api
        .cancelDurableRun(normalizedRunId)
        .then(() => api.runs())
        .then((result) => {
          setRuns(result);
        })
        .catch(() => {})
        .finally(() => {
          setCancellingBackgroundRunIds((current) => {
            const next = new Set(current);
            next.delete(normalizedRunId);
            return next;
          });
        });
    },
    [setRuns],
  );

  useEffect(() => {
    if (autocompleteCatalogDemand.needsMemoryData) {
      setShouldLoadMemoryData(true);
    }
  }, [autocompleteCatalogDemand.needsMemoryData]);

  useEffect(() => {
    if (!shouldLoadMemoryData || requestedMemoryDataRef.current) {
      return;
    }

    requestedMemoryDataRef.current = true;
    let cancelled = false;

    api
      .memory()
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

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerShellRef = useRef<HTMLDivElement | null>(null);
  const [composerShellWidth, setComposerShellWidth] = useState<number | null>(null);
  const composerSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const composerResizeFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingJumpMessageIndexRef = useRef<number | null>(null);
  const [requestedFocusMessageIndex, setRequestedFocusMessageIndex] = useState<number | null>(null);

  const resetComposerMenus = useCallback(() => {
    setSlashIdx(0);
    setMentionIdx(0);
  }, []);

  useWorkspaceComposerEvents({
    input,
    textareaRef,
    composerSelectionRef,
    setInput,
    resetMenus: resetComposerMenus,
  });

  useEffect(() => {
    setComposerQuestionIndex(0);
    setComposerQuestionOptionIndex(0);
    setComposerQuestionSubmitting(false);
  }, [pendingAskUserQuestionKey]);

  const composerActiveQuestion =
    pendingAskUserQuestion?.presentation.questions[
      Math.max(0, Math.min(composerQuestionIndex, (pendingAskUserQuestion?.presentation.questions.length ?? 1) - 1))
    ] ?? null;

  useLayoutEffect(() => {
    const element = composerShellRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.max(0, Math.floor(element.getBoundingClientRect().width));
      setComposerShellWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!composerActiveQuestion) {
      setComposerQuestionOptionIndex(0);
      return;
    }

    setComposerQuestionOptionIndex(resolveAskUserQuestionDefaultOptionIndex(composerActiveQuestion, composerQuestionAnswers));
  }, [composerActiveQuestion, composerQuestionAnswers]);

  const { atBottom, syncScrollStateFromDom, scrollToBottom, capturePrependRestore } = useConversationScroll({
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

  const loadOlderMessages = useCallback(
    (targetMessageIndex?: number, options?: { automatic?: boolean }) => {
      if (!id || sessionLoading || historicalTotalBlocks <= 0) {
        return;
      }

      if (options?.automatic && historicalTailBlocks >= Math.min(historicalTotalBlocks, MAX_AUTOMATIC_HISTORICAL_TAIL_BLOCKS)) {
        return;
      }

      const minimumTailBlocks =
        typeof targetMessageIndex === 'number'
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
    },
    [capturePrependRestore, historicalTailBlocks, historicalTotalBlocks, id, sessionLoading],
  );

  // Derive menu states
  const slashInput = useMemo(() => parseSlashInput(input), [input]);
  const showModelPicker = slashInput?.command === '/model' && input.startsWith('/model ');
  const mentionMatch = input.match(/(^|.*\s)(@[\w./-]*)$/);
  const showSlash = !!slashInput && input === slashInput.command && !showModelPicker;
  const showMention = !!mentionMatch && !showSlash && !showModelPicker;
  const slashQuery = slashInput?.command ?? '';
  const modelQuery = showModelPicker ? (slashInput?.argument ?? '') : '';
  const mentionQuery = mentionMatch?.[2] ?? '';
  const slashItems = useMemo(
    () => buildSlashMenuItems(input, memoryData?.skills ?? [], extensionSlashCommands),
    [extensionSlashCommands, input, memoryData],
  );
  const modelItems = useMemo(() => filterModelPickerItems(models, modelQuery), [models, modelQuery]);

  useEffect(() => {
    let cancelled = false;
    void buildExtensionMentionItems(extensionMentionRegistrations, {
      memoryDocs: memoryData?.memoryDocs ?? [],
    })
      .then((items) => {
        if (!cancelled) setExtensionMentionItems(items);
      })
      .catch(() => {
        if (!cancelled) setExtensionMentionItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [extensionMentionRegistrations, memoryData?.memoryDocs]);

  const mentionItems = useMemo(
    () =>
      buildMentionItems({
        tasks: tasks ?? [],
        extensionItems: extensionMentionItems,
      }),
    [tasks, extensionMentionItems],
  );
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
    () => (draft ? draftCwdValue || null : (liveSessionContext?.cwd ?? currentSessionMeta?.cwd ?? null)),
    [draft, draftCwdValue, liveSessionContext?.cwd, currentSessionMeta?.cwd],
  );
  const currentCwdLabel = useMemo(() => (currentCwd ? truncateConversationCwdFromFront(currentCwd) : ''), [currentCwd]);
  const hasDraftCwd = draftCwdValue.length > 0;
  const availableDraftWorkspacePaths = useMemo(
    () => normalizeWorkspacePaths(draftCwdValue ? [draftCwdValue, ...savedWorkspacePaths] : savedWorkspacePaths),
    [draftCwdValue, savedWorkspacePaths],
  );
  const relatedThreadCandidates = useMemo(
    () =>
      draft
        ? selectRecentConversationCandidates(sessions, {
            workspaceCwd: draftCwdValue || null,
            recentWindowDays: RELATED_THREAD_RECENT_WINDOW_DAYS,
            limit: MAX_RELATED_THREAD_CANDIDATES,
            closedOnly: true,
          })
        : [],
    [draft, draftCwdValue, sessions],
  );
  const relatedThreadCandidateLookup = useMemo(() => buildRelatedThreadCandidateLookup(relatedThreadCandidates), [relatedThreadCandidates]);
  const relatedThreadCandidateById = relatedThreadCandidateLookup.candidateById;
  const relatedThreadCandidateIds = relatedThreadCandidateLookup.candidateIds;
  const relatedThreadSearchResults = useMemo(
    () =>
      rankRelatedConversationSessions({
        sessions: relatedThreadCandidates,
        searchIndex: relatedThreadSearchIndex,
        summaries: relatedThreadSummaries,
        query: debouncedRelatedThreadsQuery,
        workspaceCwd: draftCwdValue || null,
        limit: MAX_VISIBLE_RELATED_THREAD_RESULTS,
      }),
    [debouncedRelatedThreadsQuery, draftCwdValue, relatedThreadCandidates, relatedThreadSearchIndex, relatedThreadSummaries],
  );
  const recentClosedThreadResults = useMemo(
    () =>
      listRecentConversationResults(relatedThreadCandidates, {
        workspaceCwd: draftCwdValue || null,
        summaries: relatedThreadSummaries,
        recentWindowDays: null,
        limit: MAX_VISIBLE_RELATED_THREAD_RESULTS,
      }),
    [draftCwdValue, relatedThreadCandidates, relatedThreadSummaries],
  );
  const visibleRelatedThreadResults = useMemo<RelatedConversationSearchResult[]>(
    () =>
      selectVisibleRelatedThreadResults({
        selectedRelatedThreadIds,
        query: debouncedRelatedThreadsQuery,
        searchResults: relatedThreadSearchResults,
        recentResults: recentClosedThreadResults,
        candidateById: relatedThreadCandidateById,
        searchIndex: relatedThreadSearchIndex,
        summaries: relatedThreadSummaries,
        workspaceCwd: draftCwdValue || null,
        limit: MAX_VISIBLE_RELATED_THREAD_RESULTS,
      }),
    [
      debouncedRelatedThreadsQuery,
      draftCwdValue,
      recentClosedThreadResults,
      relatedThreadCandidateById,
      relatedThreadSearchIndex,
      relatedThreadSearchResults,
      relatedThreadSummaries,
      selectedRelatedThreadIds,
    ],
  );
  const toggleRelatedThreadSelection = useCallback(
    (sessionId: string) => {
      setSelectedRelatedThreadIds((current) => {
        const result = toggleRelatedThreadSelectionIds({
          current,
          sessionId,
          maxSelections: MAX_RELATED_THREAD_SELECTIONS,
        });
        if (result.rejected) {
          showNotice('danger', `Choose up to ${MAX_RELATED_THREAD_SELECTIONS} related threads.`, 2500);
        }
        return result.next;
      });
    },
    [showNotice],
  );
  const branchLabel = draft ? (draftWorkspaceGit?.branch ?? null) : (liveSessionContext?.branch ?? null);
  const extensionRegistry = useExtensionRegistry();

  useEffect(() => {
    if (!id || draft || extensionRegistry.loading) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      completeConversationOpenPhase(id, 'extensions', {
        extensionCount: extensionRegistry.extensions.length,
        routeCount: extensionRegistry.routes.length,
        surfaceCount: extensionRegistry.surfaces.length,
        composerButtonCount: extensionRegistry.composerButtons.length,
        composerShelfCount: extensionRegistry.composerShelves.length,
        conversationHeaderElementCount: extensionRegistry.conversationHeaderElements.length,
        error: extensionRegistry.error,
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [
    draft,
    extensionRegistry.composerButtons.length,
    extensionRegistry.composerShelves.length,
    extensionRegistry.conversationHeaderElements.length,
    extensionRegistry.error,
    extensionRegistry.extensions.length,
    extensionRegistry.loading,
    extensionRegistry.routes.length,
    extensionRegistry.surfaces.length,
    id,
  ]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedRelatedThreadsQuery(input.trim());
    }, 180);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [input]);

  useEffect(() => {
    if (!draft || debouncedRelatedThreadsQuery.length === 0) {
      return;
    }

    // Find the extension that provides the warmPointers action (system-suggested-context)
    // instead of hardcoding its id.
    const suggestedCtxExtension = extensionRegistry.extensions.find((e) => e.backendActions?.some((a) => a.id === 'warmPointers'));
    if (suggestedCtxExtension) {
      api
        .invokeExtensionAction(suggestedCtxExtension.id, 'warmPointers', {
          prompt: debouncedRelatedThreadsQuery,
          currentConversationId: id,
          currentCwd: draftCwdValue || null,
        })
        .catch(() => {
          // Suggested context is an enhancement. Never interrupt drafting or submit for cache misses.
        });
    }
  }, [debouncedRelatedThreadsQuery, draft, draftCwdValue, extensionRegistry.extensions, id]);

  useEffect(() => {
    setSelectedRelatedThreadIds((current) => pruneRelatedThreadSelectionIds(current, relatedThreadCandidateById));
  }, [relatedThreadCandidateById]);

  useRelatedThreadHotkeys({
    enabled: draft && !preparingRelatedThreadContext,
    results: visibleRelatedThreadResults,
    onToggle: toggleRelatedThreadSelection,
  });

  useEffect(() => {
    const missingSessionIds = selectMissingRelatedThreadSearchIndexIds({
      draft,
      inputText: input,
      selectedThreadIds: selectedRelatedThreadIds,
      candidateIds: relatedThreadCandidateIds,
      searchIndex: relatedThreadSearchIndex,
    });
    if (missingSessionIds.length === 0) {
      setRelatedThreadSearchLoading(false);
      setRelatedThreadSearchError(null);
      return;
    }

    let cancelled = false;
    setRelatedThreadSearchLoading(true);
    setRelatedThreadSearchError(null);

    api
      .sessionSearchIndex(missingSessionIds)
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
    const missingSessionIds = selectMissingRelatedThreadSummaryIds({
      draft,
      candidateIds: relatedThreadCandidateIds,
      summaries: relatedThreadSummaries,
    });
    if (missingSessionIds.length === 0) {
      return;
    }

    let cancelled = false;
    api
      .conversationSummaries(missingSessionIds)
      .then((result) => {
        if (cancelled || Object.keys(result.summaries).length === 0) {
          return;
        }

        setRelatedThreadSummaries((current) => ({ ...current, ...result.summaries }));
      })
      .catch(() => {
        // Summary metadata is an enhancement. Keep the picker usable on cache misses or generation failures.
      });

    return () => {
      cancelled = true;
    };
  }, [draft, relatedThreadCandidateIds, relatedThreadSummaries]);

  useEffect(() => {
    const update = resolveRelatedThreadPreselectionUpdate({
      draft,
      query: debouncedRelatedThreadsQuery,
      selectedThreadIds: selectedRelatedThreadIds,
      autoSelectedThreadIds: autoSelectedRelatedThreadIds,
      searchResults: relatedThreadSearchResults,
      maxAutoSelections: MAX_RELATED_THREAD_SELECTIONS,
    });
    if (!update.changed) {
      return;
    }
    setSelectedRelatedThreadIds(update.selectedThreadIds);
    setAutoSelectedRelatedThreadIds(update.autoSelectedThreadIds);
  }, [autoSelectedRelatedThreadIds, debouncedRelatedThreadsQuery, draft, relatedThreadSearchResults, selectedRelatedThreadIds]);

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
  useEffect(() => {
    if (!draft || !draftCwdValue) {
      setDraftWorkspaceGit(null);
      return;
    }

    let cancelled = false;
    api
      .workspaceUncommittedDiff(draftCwdValue)
      .then((result) => {
        if (!cancelled) {
          setDraftWorkspaceGit({
            branch: result.branch,
            changeCount: result.changeCount,
            linesAdded: result.linesAdded,
            linesDeleted: result.linesDeleted,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDraftWorkspaceGit(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [draft, draftCwdValue]);

  const gitSummaryPresentation = useMemo(
    () => resolveConversationGitSummaryPresentation(draft ? draftWorkspaceGit : (liveSessionContext?.git ?? null)),
    [draft, draftWorkspaceGit, liveSessionContext?.git],
  );
  const hasGitSummary = gitSummaryPresentation.kind !== 'none';
  const showComposerMeta = draft
    ? Boolean(draftCwdValue)
    : Boolean(sessionTokens) ||
      Boolean(currentCwd || conversationCwdEditorOpen || conversationCwdError) ||
      Boolean(branchLabel) ||
      hasGitSummary;

  useEffect(() => {
    const nextSessions = replaceConversationMetaInSessionList(sessions, id, currentSessionMeta);
    if (nextSessions && nextSessions !== sessions) {
      setSessions(nextSessions);
    }
  }, [currentSessionMeta, id, sessions, setSessions]);

  useEffect(() => {
    if (!id) {
      setDeferredResumes([]);
      return;
    }

    if (currentSessionMeta?.id === id) {
      setDeferredResumes(currentSessionMeta.deferredResumes ?? []);
    }
  }, [currentSessionMeta, id]);

  const savedConversationSessionFile = currentSessionMeta?.file ?? visibleSessionDetail?.meta.file ?? null;
  const deferredResumePresentation = useMemo(
    () =>
      resolveDeferredResumePresentationState({
        resumes: deferredResumes,
        nowMs: deferredResumeNowMs,
        isLiveSession,
        sessionFile: savedConversationSessionFile,
      }),
    [deferredResumeNowMs, deferredResumes, isLiveSession, savedConversationSessionFile],
  );
  const orderedDeferredResumes = deferredResumePresentation.orderedResumes;
  const backgroundRunState = useMemo(
    () =>
      resolveConversationBackgroundRunState({
        conversationId: id,
        runs,
        lookups: runLookups,
        excludeConversationRunId: conversationRunId,
      }),
    [conversationRunId, id, runLookups, runs],
  );
  const activeConversationBackgroundRuns = backgroundRunState.activeRuns;
  const backgroundRunIndicatorText = backgroundRunState.indicatorText;
  const showActiveBackgroundRunDetails = showBackgroundRunDetails;
  const hasReadyDeferredResumes = deferredResumePresentation.hasReadyResumes;
  const deferredResumeAutoResumeKey = deferredResumePresentation.autoResumeKey;
  const deferredResumeIndicatorText = deferredResumePresentation.indicatorText;
  const lastConversationMessage = realMessages?.[realMessages.length - 1] ?? null;
  const conversationResumeState = useMemo(
    () =>
      getConversationResumeState({
        run: conversationRun,
        isLiveSession,
        lastMessage: lastConversationMessage,
      }),
    [conversationRun, isLiveSession, lastConversationMessage],
  );
  const draftMentionItems = useMemo(() => resolveMentionItems(input, mentionItems), [input, mentionItems]);
  const unattachedDraftMentionItems = useMemo(
    () => selectUnattachedMentionItems(draftMentionItems, attachedContextDocs),
    [attachedContextDocs, draftMentionItems],
  );
  const shouldLoadConversationRun =
    Boolean(conversationRunId) &&
    !draft &&
    !isLiveSession &&
    (didConversationStopMidTurn(lastConversationMessage) || didConversationStopWithError(lastConversationMessage));

  useEffect(() => {
    if (!conversationRunId || !shouldLoadConversationRun) {
      setConversationRun(null);
      return;
    }

    let cancelled = false;
    api
      .durableRun(conversationRunId)
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
  useInvalidateOnTopics(['sessions'], refetchDeferredResumes);
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
    if (
      !shouldAutoResumeDeferredResumes({
        autoResumeKey: deferredResumeAutoResumeKey,
        lastAttemptedKey: attemptedDeferredResumeAutoResumeKeyRef.current,
        draft,
        isLiveSession,
        deferredResumesBusy,
        resumeConversationBusy,
      })
    ) {
      return;
    }

    attemptedDeferredResumeAutoResumeKeyRef.current = deferredResumeAutoResumeKey;
    void resumeDeferredConversation().catch((error) => {
      console.error('Deferred resume auto-resume failed:', error);
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
      addNotification({
        type: 'error',
        message: 'Auto-resume failed',
        details: error instanceof Error ? error.message : String(error),
        source: 'core',
      });
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

    const previousScrollTop = el.scrollTop;
    const selectionEnd = el.selectionEnd ?? el.value.length;
    const shouldKeepCaretVisible = document.activeElement === el && selectionEnd >= el.value.length;

    el.style.height = 'auto';
    const nextHeight = Math.min(el.scrollHeight, 160);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > nextHeight ? 'auto' : 'hidden';

    // iOS Safari can leave the caret below the visible textarea after the
    // auto-height reset, making lines appear only after another character is
    // typed. Keep normal in-field scrolling stable, but pin typing-at-end to
    // the bottom so newly inserted lines are immediately editable.
    el.scrollTop = shouldKeepCaretVisible ? el.scrollHeight : previousScrollTop;
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

  const rememberComposerInput = useCallback(
    (value: string, scopeId: string | null = composerHistoryScopeId) => {
      const nextHistory = appendComposerHistory(scopeId, value);
      setComposerHistory(nextHistory);
      setComposerHistoryIndex(null);
      composerHistoryDraftRef.current = '';
    },
    [composerHistoryScopeId],
  );

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

  const insertTextIntoComposer = useCallback(
    (text: string) => {
      const insertion = insertTextAtComposerSelection({
        currentInput: textareaRef.current?.value ?? input,
        selection: composerSelectionRef.current,
        text,
      });
      if (!insertion) {
        return;
      }

      const el = textareaRef.current;
      if (el) {
        el.value = insertion.nextInput;
      }
      setInput(insertion.nextInput);
      window.requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) {
          return;
        }
        el.focus();
        el.setSelectionRange(insertion.nextCaret, insertion.nextCaret);
        composerSelectionRef.current = { start: insertion.nextCaret, end: insertion.nextCaret };
        scheduleComposerResize();
      });
    },
    [input, scheduleComposerResize, setInput],
  );

  useEffect(() => {
    if (!pendingAskUserQuestion || input.length > 0 || attachments.length > 0 || drawingAttachments.length > 0) {
      return;
    }

    moveComposerCaretToEnd();
  }, [attachments.length, drawingAttachments.length, input.length, moveComposerCaretToEnd, pendingAskUserQuestionKey]);

  const submitAskUserQuestion = useCallback(
    async (presentation: AskUserQuestionPresentation, answers: AskUserQuestionAnswers) => {
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
    },
    [
      allowQueuedPrompts,
      defaultComposerBehavior,
      id,
      isLiveSession,
      scrollToBottom,
      showNotice,
      streamReconnect,
      streamSend,
      visibleSessionDetail,
    ],
  );

  const composerQuestionAnsweredCount = countAnsweredAskUserQuestions(pendingAskUserQuestion?.presentation, composerQuestionAnswers);
  const composerQuestionCanSubmit = pendingAskUserQuestion
    ? isAskUserQuestionComplete(pendingAskUserQuestion.presentation, composerQuestionAnswers)
    : false;
  const composerQuestionRemainingCount = pendingAskUserQuestion
    ? Math.max(0, pendingAskUserQuestion.presentation.questions.length - composerQuestionAnsweredCount)
    : 0;

  const activateComposerQuestion = useCallback(
    (index: number) => {
      if (!pendingAskUserQuestion) {
        return;
      }

      const nextIndex = Math.max(0, Math.min(index, pendingAskUserQuestion.presentation.questions.length - 1));
      const nextQuestion = pendingAskUserQuestion.presentation.questions[nextIndex];
      const nextOptionIndex = resolveAskUserQuestionDefaultOptionIndex(nextQuestion, composerQuestionAnswers);
      setComposerQuestionIndex(nextIndex);
      setComposerQuestionOptionIndex(nextOptionIndex >= 0 ? nextOptionIndex : 0);
      moveComposerCaretToEnd();
    },
    [composerQuestionAnswers, moveComposerCaretToEnd, pendingAskUserQuestion],
  );

  const advanceComposerQuestionAfterAnswer = useCallback(
    (questionIndex: number, nextAnswers: AskUserQuestionAnswers) => {
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
    },
    [moveComposerCaretToEnd, pendingAskUserQuestion],
  );

  const handleComposerQuestionOptionSelect = useCallback(
    (questionIndex: number, optionIndex: number) => {
      if (!pendingAskUserQuestion || composerQuestionSubmitting) {
        return;
      }

      const question = pendingAskUserQuestion.presentation.questions[questionIndex];
      const option = question?.options[optionIndex];
      if (!question || !option) {
        return;
      }

      setComposerQuestionOptionIndex(optionIndex);

      const { nextAnswers, selectedValues } = resolveAskUserQuestionAnswerSelection({
        question,
        option,
        answers: composerQuestionAnswers,
      });
      setComposerQuestionAnswers(nextAnswers);
      if (shouldAdvanceAskUserQuestionAfterSelection(question, selectedValues)) {
        advanceComposerQuestionAfterAnswer(questionIndex, nextAnswers);
      }
    },
    [advanceComposerQuestionAfterAnswer, composerQuestionAnswers, composerQuestionSubmitting, pendingAskUserQuestion],
  );

  const submitComposerQuestionIfReady = useCallback(async () => {
    if (!pendingAskUserQuestion || !composerQuestionCanSubmit || composerQuestionSubmitting) {
      return false;
    }

    setComposerQuestionSubmitting(true);
    try {
      await submitAskUserQuestion(pendingAskUserQuestion.presentation, composerQuestionAnswers);
      clearComposerQuestionAnswers();
      return true;
    } finally {
      setComposerQuestionSubmitting(false);
    }
  }, [
    clearComposerQuestionAnswers,
    composerQuestionAnswers,
    composerQuestionCanSubmit,
    composerQuestionSubmitting,
    pendingAskUserQuestion,
    submitAskUserQuestion,
  ]);

  const navigateComposerHistory = useCallback(
    (direction: 'older' | 'newer') => {
      const next = resolveComposerHistoryNavigation({
        direction,
        history: composerHistory,
        currentIndex: composerHistoryIndex,
        currentInput: input,
        draftInput: composerHistoryDraftRef.current,
      });
      if (!next) {
        return false;
      }

      setComposerHistoryIndex(next.nextIndex);
      setInput(next.nextInput);
      composerHistoryDraftRef.current = next.nextDraftInput;
      moveComposerCaretToEnd();
      return true;
    },
    [composerHistory, composerHistoryIndex, input, moveComposerCaretToEnd, setInput],
  );

  useLayoutEffect(() => {
    scheduleComposerResize();
  }, [input, scheduleComposerResize]);

  useEffect(
    () => () => {
      if (composerResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(composerResizeFrameRef.current);
        composerResizeFrameRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    setSlashIdx(0);
  }, [slashQuery]);
  useEffect(() => {
    setModelIdx(0);
  }, [modelQuery]);

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
    if (
      !id ||
      sessionLoading ||
      !historicalHasOlderBlocks ||
      historicalTailBlocks >= Math.min(historicalTotalBlocks, MAX_AUTOMATIC_HISTORICAL_TAIL_BLOCKS)
    ) {
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
  }, [
    historicalHasOlderBlocks,
    historicalTailBlocks,
    historicalTotalBlocks,
    id,
    isLiveSession,
    loadOlderMessages,
    sessionLoading,
    stream.isStreaming,
  ]);

  useEscapeAbortStream({
    isStreaming: stream.isStreaming,
    abort: stopStreamAndRestoreQueuedPrompts,
    hasBlockingOverlay: hasBlockingOverlayOpen,
  });

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
  useEffect(() => {
    textareaRef.current?.focus();
  }, [id]);

  const focusComposerFromTranscriptBackground = useCallback(() => {
    const composer = textareaRef.current;
    if (!composer || composer.disabled) {
      return;
    }

    composer.focus();
  }, []);

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
  const jumpToMessage = useCallback(
    (index: number) => {
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
    },
    [historicalBlockOffset, loadOlderMessages],
  );

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

  const submitConversationCwdChange = useCallback(
    async (nextCwdOverride?: string) => {
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
          stream.reconnect();
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
    },
    [
      conversationCwdBusy,
      conversationCwdDraft,
      currentSurfaceId,
      draft,
      ensureConversationCanControl,
      id,
      navigate,
      refetchLiveSessionContext,
      showNotice,
      stream.isStreaming,
      stream.reconnect,
    ],
  );

  const pickConversationCwd = useCallback(async () => {
    if (draft || !id || conversationCwdPickBusy || conversationCwdBusy) {
      return;
    }

    if (!ensureConversationCanControl('change its working directory')) {
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
  }, [conversationCwdBusy, conversationCwdDraft, conversationCwdPickBusy, currentCwd, draft, ensureConversationCanControl, id]);

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

  useEffect(() => {
    if (
      !shouldAutoDispatchPendingInitialPrompt({
        draft,
        conversationId: id,
        hasPendingInitialPrompt: Boolean(pendingInitialPrompt),
        pendingInitialPromptDispatching,
        hasStreamSnapshot: stream.hasSnapshot,
        hasTranscriptMessages: (realMessages?.length ?? 0) > 0,
      })
    ) {
      return;
    }

    if (
      !shouldClaimPendingInitialPromptForSession({
        conversationId: id,
        prompt: pendingInitialPrompt,
        inFlightSessionId: pendingInitialPromptSessionIdRef.current,
        failedSessionId: pendingInitialPromptFailureSessionIdRef.current,
      })
    ) {
      return;
    }

    const conversationId = id;
    const promptToClaim = pendingInitialPrompt;
    if (!conversationId || !promptToClaim) {
      return;
    }

    const keepsStoredPromptDuringDispatch = shouldKeepStoredPendingInitialPromptDuringDispatch(promptToClaim);
    const claimedInitialPrompt = keepsStoredPromptDuringDispatch ? promptToClaim : consumePendingConversationPrompt(conversationId);
    if (!claimedInitialPrompt) {
      setPendingInitialPrompt(null);
      return;
    }

    pendingInitialPromptSessionIdRef.current = conversationId;
    pinnedInitialPromptScrollSessionIdRef.current = conversationId;
    pinnedInitialPromptTailKeyRef.current = null;

    if (keepsStoredPromptDuringDispatch) {
      setPendingConversationPromptDispatching(conversationId, true);
    } else {
      setPendingInitialPrompt(null);
    }

    void (async () => {
      const preparedInitialPrompt = claimedInitialPrompt;
      try {
        const sendResult = await stream.send(
          preparedInitialPrompt.text,
          normalizeConversationComposerBehavior(preparedInitialPrompt.behavior, allowQueuedPrompts),
          preparedInitialPrompt.images,
          preparedInitialPrompt.attachmentRefs,
          preparedInitialPrompt.contextMessages,
          normalizePendingRelatedConversationIds(preparedInitialPrompt),
        );
        for (const warning of sendResult?.relatedConversationPointerWarnings ?? []) {
          showNotice('danger', warning, 5000);
        }
        pendingInitialPromptSessionIdRef.current = null;
      } catch (error) {
        pendingInitialPromptSessionIdRef.current = null;
        pendingInitialPromptFailureSessionIdRef.current = conversationId;
        pinnedInitialPromptScrollSessionIdRef.current = null;
        pinnedInitialPromptTailKeyRef.current = null;
        persistPendingConversationPrompt(conversationId, preparedInitialPrompt);
        setPendingConversationPromptDispatching(conversationId, false);
        setPendingInitialPrompt(preparedInitialPrompt);
        persistForkPromptDraft(conversationId, preparedInitialPrompt.text);
        console.error('Initial prompt failed:', error);
        showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
        addNotification({
          type: 'error',
          message: 'Initial prompt failed',
          details: error instanceof Error ? error.message : String(error),
          source: 'core',
        });
      }
    })();
  }, [
    draft,
    id,
    pendingInitialPrompt,
    pendingInitialPromptDispatching,
    allowQueuedPrompts,
    realMessages?.length,
    stream.hasSnapshot,
    stream.send,
    showNotice,
  ]);

  const ensureConversationIsLive = useCallback(
    async (actionDescription = 'continue') => {
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
    },
    [id, isLiveSession, streamReconnect, streamTakeover],
  );

  const rewindConversationFromMessage = useCallback(
    async (messageIndex: number) => {
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
        const clickedBlock = realMessages[localMessageIndex];
        let target: { entryId: string; beforeEntry: boolean; promptDraft: string | null } | null = null;

        if (clickedBlock?.type === 'text' || clickedBlock?.type === 'user') {
          let entryId = resolveSessionEntryIdFromBlockId(clickedBlock.id);
          if (!entryId) {
            const detail = await api.sessionDetail(liveConversationId, {
              tailBlocks: Math.max(realMessages.length, 1),
            });
            entryId = resolveBranchEntryIdFromSessionDetailResult(clickedBlock, messageIndex, detail);
          }
          if (entryId) {
            target =
              clickedBlock.type === 'user'
                ? { entryId, beforeEntry: true, promptDraft: clickedBlock.text }
                : { entryId, beforeEntry: false, promptDraft: null };
          }
        }

        if (!target) {
          const entries = await api.forkEntries(liveConversationId);
          target = resolveRewindTargetForMessage(realMessages, localMessageIndex, entries);
        }
        if (!target) {
          throw new Error('No forkable message found for that point in the conversation.');
        }

        if (!ensureConversationCanControl('rewind from this message')) {
          return;
        }

        const { newSessionId } = await api.forkSession(
          liveConversationId,
          target.entryId,
          {
            preserveSource: true,
            beforeEntry: target.beforeEntry,
          },
          currentSurfaceId,
        );
        if (target.promptDraft) {
          persistForkPromptDraft(newSessionId, target.promptDraft);
        }
        ensureConversationTabOpen(newSessionId);
        navigate(`/conversations/${newSessionId}`);
      } catch (error) {
        showNotice('danger', `Rewind failed: ${(error as Error).message}`);
      }
    },
    [currentSurfaceId, ensureConversationCanControl, ensureConversationIsLive, id, messageIndexOffset, navigate, realMessages, showNotice],
  );

  const forkConversationFromMessage = useCallback(
    async (messageIndex: number) => {
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
          entryId = resolveBranchEntryIdFromSessionDetailResult(clickedBlock, messageIndex, detail);
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
    },
    [
      currentSurfaceId,
      ensureConversationCanControl,
      ensureConversationIsLive,
      id,
      messageIndexOffset,
      navigate,
      realMessages,
      rewindConversationFromMessage,
      showNotice,
    ],
  );

  async function saveModelPreference(modelId: string) {
    if (!modelId || modelId === currentModel || savingPreference !== null) {
      return;
    }

    setSavingPreference('model');
    try {
      if (draft) {
        const update = resolveDraftModelPreferenceUpdate({ modelId, defaultModel });
        if (update.storage.kind === 'clear') {
          clearDraftConversationModel();
        } else {
          persistDraftConversationModel(update.storage.value);
        }
        setCurrentModel(update.currentModel);
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
        const update = resolveDraftThinkingPreferenceUpdate({ thinkingLevel, defaultThinkingLevel });
        if (update.storage.kind === 'clear') {
          clearDraftConversationThinkingLevel();
        } else {
          persistDraftConversationThinkingLevel(update.storage.value);
        }
        setCurrentThinkingLevel(update.currentThinkingLevel);
        savedThinkingLevel = update.currentThinkingLevel;
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
        const update = resolveDraftServiceTierPreferenceUpdate({ enableFastMode, defaultServiceTier });
        if (update.storage.kind === 'clear') {
          clearDraftConversationServiceTier();
        } else {
          persistDraftConversationServiceTier(update.storage.value);
        }
        setCurrentServiceTier(update.currentServiceTier);
        setHasExplicitServiceTier(update.hasExplicitServiceTier);
        savedServiceTier = update.savedServiceTierLabel;
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
    if (showModelPicker) {
      setInput('');
    }
    setModelIdx(0);
    textareaRef.current?.focus();
    void saveModelPreference(modelId);
  }

  function addImageAttachments(imageAttachments: ComposerImageAttachment[]) {
    if (imageAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...imageAttachments]);
    }
  }

  async function addComposerFiles(files: File[]) {
    const {
      imageAttachments: nextImageAttachments,
      drawingAttachments: nextDrawingAttachments,
      rejectedFileNames,
      drawingParseFailures,
      imageReadFailures,
    } = await prepareComposerFiles(files);

    if (nextImageAttachments.length > 0) {
      addImageAttachments(nextImageAttachments);
    }

    if (nextDrawingAttachments.length > 0) {
      setDrawingAttachments((current) => [...current, ...nextDrawingAttachments]);
    }

    for (const notice of buildComposerFilePreparationNotices({
      drawingAttachments: nextDrawingAttachments,
      drawingParseFailures,
      imageReadFailures,
      rejectedFileNames,
    })) {
      showNotice(notice.tone, notice.text, notice.durationMs);
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function removeDrawingAttachment(localId: string) {
    setDrawingAttachments((current) => removeComposerDrawingAttachmentByLocalId(current, localId));
  }

  function upsertDrawingAttachment(payload: ExcalidrawEditorSavePayload, localId?: string) {
    setDrawingAttachments((current) => {
      if (localId) {
        return current.map((attachment) =>
          attachment.localId === localId
            ? {
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
              }
            : attachment,
        );
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
  }

  async function editDrawing(localId: string) {
    const drawing = drawingAttachments.find((attachment) => attachment.localId === localId);
    if (!drawing) return;

    const excalidrawExtension = extensionRegistry.extensions.find((e) => e.backendActions?.some((a) => a.id === 'image'));
    const excalidrawInputClient = createNativeExtensionClient(excalidrawExtension?.id ?? 'system-excalidraw-input');
    const result = await excalidrawInputClient.ui.openModal({
      component: 'ExcalidrawEditorModal',
      props: { initialTitle: drawing.title, initialScene: drawing.scene, saveLabel: 'Update drawing' },
      size: 'fullscreen',
    });

    if (result && typeof result === 'object') {
      upsertDrawingAttachment(result as ExcalidrawEditorSavePayload, localId);
      showNotice('accent', 'Drawing saved to composer.');
    }
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
      const revision = record.revisions.find((entry) => entry.revision === selection.revision) ?? record.latestRevision;

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
        const alreadyAttached = current.some(
          (attachment) =>
            attachment.attachmentId === nextAttachment.attachmentId && attachment.revision === nextAttachment.revision && !attachment.dirty,
        );

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

  const setDraftConversationCwd = useCallback((nextCwd: string) => {
    const normalizedCwd = nextCwd.trim();
    if (normalizedCwd) {
      persistDraftConversationCwd(normalizedCwd);
    } else {
      clearDraftConversationCwd();
    }

    setDraftCwdValue(normalizedCwd);
  }, []);

  const pickDraftConversationCwd = useCallback(async () => {
    if (!draft || draftCwdPickBusy) {
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
  }, [draft, draftCwdPickBusy, draftCwdValue, savedWorkspacePaths, setDraftConversationCwd, syncSavedWorkspacePaths]);

  const selectDraftConversationWorkspace = useCallback(
    (workspacePath: string) => {
      const normalizedWorkspacePath = workspacePath.trim();
      if (!normalizedWorkspacePath) {
        return;
      }

      setDraftConversationCwd(normalizedWorkspacePath);
      setDraftCwdError(null);
    },
    [setDraftConversationCwd],
  );

  const clearDraftConversationCwdSelection = useCallback(() => {
    clearDraftConversationCwd();
    setDraftCwdValue('');
    setDraftCwdError(null);
  }, []);

  useDesktopConversationShortcuts({
    draft,
    draftCwdPickBusy,
    textareaRef,
    beginTitleEdit,
    beginConversationCwdEdit,
    pickDraftConversationCwd,
  });

  function findExtensionSlashCommand(text: string): { command: ExtensionSlashCommandRegistration; argument: string } | null {
    const parsed = parseSlashInput(text.trim());
    if (!parsed) {
      return null;
    }

    const name = parsed.command.slice(1);
    const command = extensionSlashCommands.find((candidate) => candidate.name === name);
    return command ? { command, argument: parsed.argument } : null;
  }

  async function executeExtensionSlashCommand(
    command: ExtensionSlashCommandRegistration,
    inputSnapshot: string,
    argument: string,
  ): Promise<{ kind: 'handled' } | { kind: 'send'; text: string }> {
    try {
      const response = await api.invokeExtensionAction(command.extensionId, command.action, {
        commandName: command.name,
        argument,
        text: inputSnapshot,
        conversationId: id ?? null,
        cwd: currentCwd,
        draft,
      });
      const result = response.result;

      if (typeof result === 'string') {
        return { kind: 'send', text: result };
      }
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        setInput('');
        return { kind: 'handled' };
      }

      const payload = result as {
        text?: unknown;
        prompt?: unknown;
        replaceComposerText?: unknown;
        appendComposerText?: unknown;
        notice?: { tone?: unknown; text?: unknown };
      };
      if (typeof payload.notice?.text === 'string') {
        showNotice(payload.notice.tone === 'danger' ? 'danger' : 'accent', payload.notice.text);
      }
      if (typeof payload.replaceComposerText === 'string') {
        setInput(payload.replaceComposerText);
        return { kind: 'handled' };
      }
      if (typeof payload.appendComposerText === 'string') {
        setInput(`${inputSnapshot}${payload.appendComposerText}`);
        return { kind: 'handled' };
      }
      if (typeof payload.prompt === 'string') {
        return { kind: 'send', text: payload.prompt };
      }
      if (typeof payload.text === 'string') {
        return { kind: 'send', text: payload.text };
      }

      setInput('');
      return { kind: 'handled' };
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
      return { kind: 'handled' };
    }
  }

  async function executeConversationSlashCommand(
    command: ConversationSlashCommand,
  ): Promise<{ kind: 'handled' } | { kind: 'send'; text: string }> {
    switch (command.action) {
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
    }
  }

  const handleReplyToSelection = useCallback(
    (selection: { text: string }) => {
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
    },
    [input, setInput],
  );

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
        const created = await api.createLiveSession(draftCwdValue || undefined, undefined, createLiveSessionPreferenceInput);
        conversationId = created.id;
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
        clearDraftConversationModelPreferences();
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
    const pendingBrowserCommentsSnapshot = pendingBrowserComments;
    const browserCommentContextMessages = buildBrowserCommentContextMessages(pendingBrowserCommentsSnapshot);
    if (
      !text &&
      pendingImageAttachments.length === 0 &&
      pendingDrawingAttachments.length === 0 &&
      pendingBrowserCommentsSnapshot.length === 0
    ) {
      return;
    }

    let slashTextToSend: string | null = null;
    if (pendingImageAttachments.length === 0 && pendingDrawingAttachments.length === 0 && pendingBrowserCommentsSnapshot.length === 0) {
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
      } else {
        const extensionSlash = findExtensionSlashCommand(text);
        if (extensionSlash) {
          rememberComposerInput(inputSnapshot);
          const slashResult = await executeExtensionSlashCommand(extensionSlash.command, inputSnapshot, extensionSlash.argument);
          if (slashResult.kind === 'handled') {
            return;
          }

          slashTextToSend = slashResult.text;
        }
      }
    }

    try {
      const filePromptImages = buildPromptImages(pendingImageAttachments);
      const drawingPromptImages = pendingDrawingAttachments.map((drawing) => drawingAttachmentToPromptImage(drawing));
      const promptImages = [...filePromptImages, ...drawingPromptImages];
      const textToSend = slashTextToSend ?? text;
      const browserChangedContextMessage = await readBrowserChangedContextMessage(id ?? 'draft');
      const browserContextMessages = mergeContextMessages(
        browserCommentContextMessages,
        browserChangedContextMessage ? [browserChangedContextMessage] : undefined,
      );

      setInput('');
      setAttachments([]);
      setDrawingAttachments([]);
      setPendingBrowserComments([]);
      setDrawingsError(null);

      const requestedBehavior = behavior ?? (isLiveSession ? defaultComposerBehavior : undefined);
      const queuedBehavior = normalizeConversationComposerBehavior(requestedBehavior, allowQueuedPrompts);

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
            const created = await api.createLiveSession(draftCwdValue || undefined, undefined, createLiveSessionPreferenceInput);
            createdSessionId = created.id;
            primeCreatedConversationOpenCaches(created, {
              tailBlocks: INITIAL_HISTORICAL_TAIL_BLOCKS,
              bootstrapVersionKey: conversationVersionKey,
              sessionDetailVersion: conversationEventVersion,
            });

            const attachmentRefs = await persistPromptDrawings(created.id);
            await persistPromptContextDocs(created.id);

            const initialPrompt: PendingConversationPrompt = {
              text: textToSend,
              behavior: queuedBehavior,
              images: promptImages,
              attachmentRefs,
              contextMessages: browserContextMessages,
              relatedConversationIds: selectedRelatedThreadIdsSnapshot,
            };

            rememberComposerInput(inputSnapshot, created.id);
            persistPendingConversationPrompt(created.id, initialPrompt);
            setPendingConversationPromptDispatching(created.id, true);
            if (composerGoalPending && text) {
              await api.updateGoal(created.id, { objective: text }).catch(() => {});
              setComposerGoalPending(false);
            }

            const sendResult = await api.promptSession(
              created.id,
              initialPrompt.text,
              initialPrompt.behavior,
              initialPrompt.images,
              initialPrompt.attachmentRefs,
              undefined,
              initialPrompt.contextMessages,
              normalizePendingRelatedConversationIds(initialPrompt),
            );
            for (const warning of sendResult.relatedConversationPointerWarnings ?? []) {
              showNotice('danger', warning, 5000);
            }
            if (sendResult.accepted) {
              clearPendingConversationPrompt(created.id);
            }
            setPendingConversationPromptDispatching(created.id, false);

            clearDraftConversationAttachments();
            clearDraftConversationContextDocs();
            clearDraftConversationCwd();
            clearDraftConversationModelPreferences();
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
            if (createdSessionId) {
              setPendingConversationPromptDispatching(createdSessionId, false);
            }
            if (createdSessionId && !navigatedToCreatedConversation) {
              await api.destroySession(createdSessionId).catch(() => {});
            }
            showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
            await restoreComposerDraft(inputSnapshot, pendingImageAttachments, pendingDrawingAttachments);
            setPendingBrowserComments(pendingBrowserCommentsSnapshot);
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
          contextMessages: browserContextMessages,
        });
        setPendingAssistantStatusLabel(
          resolveConversationPendingStatusLabel({
            isLiveSession: false,
            hasVisibleSessionDetail: false,
          }),
        );
        let createdSessionId: string | null = null;
        let navigatedToCreatedConversation = false;
        try {
          const created = await api.createLiveSession(draftCwdValue || undefined, undefined, createLiveSessionPreferenceInput);
          createdSessionId = created.id;
          primeCreatedConversationOpenCaches(created, {
            tailBlocks: INITIAL_HISTORICAL_TAIL_BLOCKS,
            bootstrapVersionKey: conversationVersionKey,
            sessionDetailVersion: conversationEventVersion,
          });
          const newId = created.id;
          const attachmentRefs = await persistPromptDrawings(newId);
          await persistPromptContextDocs(newId);
          const initialPrompt = {
            text: textToSend,
            behavior: queuedBehavior,
            images: promptImages,
            attachmentRefs,
            contextMessages: browserContextMessages,
          };

          rememberComposerInput(inputSnapshot, newId);
          persistPendingConversationPrompt(newId, initialPrompt);
          setPendingConversationPromptDispatching(newId, true);
          if (composerGoalPending && text) {
            await api.updateGoal(newId, { objective: text }).catch(() => {});
            setComposerGoalPending(false);
          }

          const sendResult = await api.promptSession(
            newId,
            initialPrompt.text,
            initialPrompt.behavior,
            initialPrompt.images,
            initialPrompt.attachmentRefs,
            undefined,
            initialPrompt.contextMessages,
          );
          for (const warning of sendResult.relatedConversationPointerWarnings ?? []) {
            showNotice('danger', warning, 5000);
          }
          if (sendResult.accepted) {
            clearPendingConversationPrompt(newId);
          }
          setPendingConversationPromptDispatching(newId, false);

          clearDraftConversationAttachments();
          clearDraftConversationContextDocs();
          clearDraftConversationCwd();
          clearDraftConversationModelPreferences();

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
        } catch (error) {
          if (createdSessionId) {
            setPendingConversationPromptDispatching(createdSessionId, false);
          }
          if (createdSessionId && !navigatedToCreatedConversation) {
            await api.destroySession(createdSessionId).catch(() => {});
          }
          setPendingAssistantStatusLabel(null);
          setDraftPendingPrompt(null);
          showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
          await restoreComposerDraft(inputSnapshot, pendingImageAttachments, pendingDrawingAttachments);
          setPendingBrowserComments(pendingBrowserCommentsSnapshot);
        }
        return;
      }

      if (!id) {
        return;
      }

      if (!isLiveSession && !visibleSessionDetail) {
        showNotice('danger', 'Conversation is still loading. Try sending again in a moment.', 4000);
        await restoreComposerDraft(inputSnapshot, pendingImageAttachments, pendingDrawingAttachments);
        setPendingBrowserComments(pendingBrowserCommentsSnapshot);
        return;
      }

      const attachmentRefs = await persistPromptDrawings(id);

      if (isLiveSession) {
        rememberComposerInput(inputSnapshot);
        setPendingAssistantStatusLabel(
          resolveConversationPendingStatusLabel({
            isLiveSession,
            hasVisibleSessionDetail: Boolean(visibleSessionDetail),
          }),
        );

        try {
          if (composerGoalPending && text) {
            await api.updateGoal(id, { objective: text });
            setComposerGoalPending(false);
          }
          await stream.send(textToSend, queuedBehavior, promptImages, attachmentRefs, browserContextMessages);
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
          await stream.send(textToSend, queuedBehavior, promptImages, attachmentRefs, browserContextMessages);
        }

        await refetchConversationAttachments();

        window.setTimeout(() => {
          scrollToBottom();
        }, 50);
      } else if (visibleSessionDetail) {
        try {
          rememberComposerInput(inputSnapshot);
          setPendingAssistantStatusLabel(
            resolveConversationPendingStatusLabel({
              isLiveSession: false,
              hasVisibleSessionDetail: true,
            }),
          );
          const recovered = await api.recoverConversation(id);
          if (recovered.conversationId !== id) {
            ensureConversationTabOpen(recovered.conversationId);
            navigate(`/conversations/${recovered.conversationId}`);
            return;
          }
          setConfirmedLive(true);
          stream.reconnect();
          setPendingAssistantStatusLabel('Working…');
          if (composerGoalPending && text) {
            await api.updateGoal(id, { objective: text });
            setComposerGoalPending(false);
          }
          await stream.send(textToSend, queuedBehavior, promptImages, attachmentRefs, browserContextMessages);
          await refetchConversationAttachments();
          window.setTimeout(() => {
            scrollToBottom();
          }, 50);
        } catch (error) {
          console.error('Auto-resume failed:', error);
          setPendingAssistantStatusLabel(null);
          await restoreComposerDraft(inputSnapshot, pendingImageAttachments, pendingDrawingAttachments);
          setPendingBrowserComments(pendingBrowserCommentsSnapshot);
          showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
          addNotification({
            type: 'error',
            message: 'Auto-resume failed',
            details: error instanceof Error ? error.message : String(error),
            source: 'core',
          });
        }
      }
    } catch (error) {
      console.error('Failed to prepare attachments:', error);
      setPendingAssistantStatusLabel(null);
      await restoreComposerDraft(inputSnapshot, pendingImageAttachments, pendingDrawingAttachments);
      setPendingBrowserComments(pendingBrowserCommentsSnapshot);
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
      addNotification({
        type: 'warning',
        message: 'Failed to prepare attachments',
        details: error instanceof Error ? error.message : String(error),
        source: 'core',
      });
    }
  }

  async function submitParallelComposer() {
    if (draft || !id || !isLiveSession) {
      showNotice('danger', 'Parallel prompts require a live conversation.', 4000);
      return;
    }

    if (!allowQueuedPrompts) {
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
      const filePromptImages = buildPromptImages(pendingImageAttachments);
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

      await streamParallel(text, promptImages, attachmentRefs, browserContextMessages);
      await refetchConversationAttachments();
      showNotice('accent', 'Parallel prompt started.', 2500);
    } catch (error) {
      await restoreComposerDraft(inputSnapshot, pendingImageAttachments, pendingDrawingAttachments);
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  async function submitComposerActionForModifiers(altKeyHeld: boolean, parallelKeyHeld: boolean) {
    const nextSubmit = resolveConversationComposerSubmitState(
      composerRunState.streamControlsActive,
      altKeyHeld,
      liveSessionHasStaleTurnState,
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

  async function stopStreamAndRestoreQueuedPrompts() {
    const queuedPromptSnapshot = pendingQueue.filter((item) => item.restorable);
    await streamAbort();

    if (queuedPromptSnapshot.length === 0) {
      return;
    }

    for (const queuedPrompt of queuedPromptSnapshot) {
      await restoreQueuedPromptToComposer(queuedPrompt.type, queuedPrompt.queueIndex, queuedPrompt.id, { showSuccessNotice: false });
    }

    showNotice(
      'accent',
      queuedPromptSnapshot.length === 1
        ? 'Stopped agent and restored queued prompt to the composer.'
        : `Stopped agent and restored ${queuedPromptSnapshot.length} queued prompts to the composer.`,
    );
  }

  async function restoreQueuedPromptToComposer(
    behavior: 'steer' | 'followUp',
    queueIndex: number,
    previewId?: string,
    options: { showSuccessNotice?: boolean } = {},
  ) {
    if (!id || !isLiveSession) {
      showNotice('danger', 'Queued prompts can only be restored from a live session.', 4000);
      return;
    }

    try {
      if (!ensureConversationCanControl('restore queued prompts')) {
        return;
      }

      const restored = await api.restoreQueuedMessage(
        id,
        {
          behavior,
          index: queueIndex,
          ...(previewId ? { previewId } : {}),
        },
        currentSurfaceId,
      );
      const restoredText = typeof restored.text === 'string' ? restored.text : '';
      const restoredFiles = restoreQueuedImageFiles(restored.images, behavior, queueIndex);
      const restoredUpdate = resolveRestoredQueuedPromptComposerUpdate({
        restoredText,
        currentInput: textareaRef.current?.value ?? input,
        restoredFileCount: restoredFiles.length,
      });

      if (!restoredUpdate.hasContent) {
        showNotice('danger', 'Queued prompt had nothing to restore.', 4000);
        return;
      }

      if (restoredUpdate.nextInput !== null) {
        setInput(restoredUpdate.nextInput);
      }
      if (restoredFiles.length > 0) {
        setAttachments((current) => [...restoredFiles, ...current]);
      }

      moveComposerCaretToEnd();
      if (options.showSuccessNotice !== false) {
        showNotice('accent', restoredUpdate.noticeText);
      }
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = readComposerTransferFiles(e.clipboardData.files);
    if (files.length === 0) {
      return;
    }

    e.preventDefault();
    void addComposerFiles(files);
  }

  function canNavigateComposerHistory(textarea: HTMLTextAreaElement, key: 'ArrowUp' | 'ArrowDown'): boolean {
    return canNavigateComposerHistoryValue({
      value: textarea.value,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
      key,
    });
  }

  // Keyboard handling
  async function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const clearShortcut = resolveComposerClearShortcut({
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      isComposing: e.nativeEvent.isComposing,
      composerInput: input,
      attachmentCount: attachments.length,
      drawingAttachmentCount: drawingAttachments.length,
    });
    if (clearShortcut.shouldClear || clearShortcut.shouldRememberInput) {
      if (clearShortcut.shouldRememberInput) {
        rememberComposerInput(input);
      }
      if (clearShortcut.shouldClear) {
        e.preventDefault();
        setInput('');
        setAttachments([]);
        setDrawingAttachments([]);
      }
      return;
    }

    if (showModelPicker) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setInput('');
        return;
      }
      if (modelItems.length === 0) {
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setModelIdx((i) => (i + 1) % modelItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setModelIdx((i) => (i - 1 + modelItems.length) % modelItems.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const sel = modelItems[modelIdx % modelItems.length];
        if (sel) selectModel(sel.id);
        return;
      }
    }
    if (showSlash || showMention) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        showSlash ? setSlashIdx((i) => i + 1) : setMentionIdx((i) => i + 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        showSlash ? setSlashIdx((i) => Math.max(0, i - 1)) : setMentionIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setInput('');
        return;
      }
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
          if (sel) {
            setInput(input.replace(/@[\w./-]*$/, sel.id + ' '));
            setMentionIdx(0);
          }
        }
        return;
      }
    }

    const canUseComposerQuestionHotkeys =
      Boolean(pendingAskUserQuestion) &&
      !composerQuestionSubmitting &&
      input.length === 0 &&
      attachments.length === 0 &&
      drawingAttachments.length === 0 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.nativeEvent.isComposing;

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

      const questionDirection = e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
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
      const altKeyHeld = e.altKey || e.nativeEvent.getModifierState('Alt') || composerAltHeld;
      const parallelKeyHeld =
        e.ctrlKey ||
        e.metaKey ||
        e.nativeEvent.getModifierState('Control') ||
        e.nativeEvent.getModifierState('Meta') ||
        composerParallelHeld;
      await submitComposerActionForModifiers(altKeyHeld, parallelKeyHeld);
    }
  }

  // Drag-and-drop
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function handleDragLeave() {
    setDragOver(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);

    const files = readComposerTransferFiles(e.dataTransfer.files);
    if (files.length > 0) {
      void addComposerFiles(files);
    }
  }
  function removeAttachment(i: number) {
    setAttachments((prev) => removeComposerImageFileAtIndex(prev, i));
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
      await saveAttachedContextDocs(appendMentionedConversationContextDocs(attachedContextDocs, items));
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  async function removeAttachedContextDoc(path: string) {
    try {
      await saveAttachedContextDocs(removeConversationContextDocByPath(attachedContextDocs, path));
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  const composerHasContent =
    input.trim().length > 0 || attachments.length > 0 || drawingAttachments.length > 0 || pendingBrowserComments.length > 0;
  const composerShowsQuestionSubmit = shouldShowQuestionSubmitAsPrimaryComposerAction(
    Boolean(pendingAskUserQuestion),
    composerHasContent,
    composerRunState.streamControlsActive,
  );
  const composerSubmit = resolveConversationComposerSubmitState(
    composerRunState.streamControlsActive,
    composerAltHeld,
    liveSessionHasStaleTurnState,
    composerParallelHeld,
  );
  const showScrollToBottomControl = shouldShowScrollToBottomControl(messageCount, atBottom);
  const renameConversationDisabled = conversationNeedsTakeover || conversationCwdEditorOpen || conversationCwdBusy;
  const { composerShelves, conversationHeaderElements, newConversationPanels } = extensionRegistry;
  const composerShelvesTop = useMemo(() => composerShelves.filter((shelf) => shelf.placement === 'top'), [composerShelves]);
  const composerShelvesBottom = useMemo(() => composerShelves.filter((shelf) => shelf.placement === 'bottom'), [composerShelves]);
  const suggestedContextShelfState = useMemo(
    () => ({
      query: debouncedRelatedThreadsQuery,
      results: visibleRelatedThreadResults,
      selectedSessionIds: selectedRelatedThreadIds,
      autoSelectedSessionIds: autoSelectedRelatedThreadIds,
      loading: relatedThreadSearchLoading,
      busy: preparingRelatedThreadContext,
      error: relatedThreadSearchError,
      maxSelections: MAX_RELATED_THREAD_SELECTIONS,
      hotkeyLimit: MAX_RELATED_THREAD_HOTKEYS,
      onToggle: toggleRelatedThreadSelection,
    }),
    [
      autoSelectedRelatedThreadIds,
      debouncedRelatedThreadsQuery,
      preparingRelatedThreadContext,
      relatedThreadSearchError,
      relatedThreadSearchLoading,
      selectedRelatedThreadIds,
      toggleRelatedThreadSelection,
      visibleRelatedThreadResults,
    ],
  );
  const composerShelfContext = useMemo(
    () => ({
      conversationId: id ?? '',
      isStreaming: conversationRunningForPage,
      isLive: isLiveSession,
    }),
    [conversationRunningForPage, id, isLiveSession],
  );
  const newConversationPanelContext = useMemo(
    () => ({
      conversationId: id ?? '',
      suggestedContext: suggestedContextShelfState,
    }),
    [id, suggestedContextShelfState],
  );
  const hasComposerShelfContent =
    composerShelvesTop.length > 0 ||
    composerShelvesBottom.length > 0 ||
    attachedContextDocs.length > 0 ||
    draftMentionItems.length > 0 ||
    pendingQueue.length > 0 ||
    parallelJobs.length > 0 ||
    activeConversationBackgroundRuns.length > 0 ||
    (!draft && orderedDeferredResumes.length > 0) ||
    pendingBrowserComments.length > 0 ||
    Boolean(pendingAskUserQuestion && composerActiveQuestion);
  const hasComposerAttachmentShelfContent =
    attachments.length > 0 || drawingAttachments.length > 0 || drawingsBusy || Boolean(drawingsError);
  const keyboardOpen = keyboardInset > 120;
  const conversationPerformanceMode = resolveConversationPerformanceMode({
    messageCount: realMessages?.length ?? 0,
  });
  const visibleTranscriptState =
    hasRenderableMessages && realMessages
      ? {
          conversationId: id ?? 'draft-conversation',
          messages: realMessages,
          historicalBlockOffset,
          historicalTotalBlocks,
        }
      : showConversationLoadingState && !draft
        ? stableTranscriptState
        : null;
  const visibleTranscriptMessages = visibleTranscriptState?.messages;
  const visibleTranscriptMessageIndexOffset = visibleTranscriptState?.historicalBlockOffset ?? 0;
  const visibleTranscriptHasOlderBlocks =
    !showConversationLoadingState && !draft && Boolean(id) && visibleTranscriptState?.conversationId === id && showHistoricalLoadMore;
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
  }, [
    draft,
    hasRenderableMessages,
    id,
    isLiveSession,
    realMessages?.length,
    sessionError,
    sessionLoading,
    showConversationLoadingState,
    stream.hasSnapshot,
  ]);

  const transcriptPane = useMemo(
    () => (
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
                    className="-ml-3 flex max-w-4xl items-center gap-2 pr-4"
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
                      className="min-w-0 flex-1 rounded-2xl border border-transparent bg-transparent px-3 py-2 text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] text-primary outline-none transition-colors placeholder:text-dim/60 hover:border-border-subtle/70 hover:bg-base/25 focus:border-accent/45 focus:bg-base/35 sm:text-[34px]"
                      disabled={titleSaving}
                    />
                    <button
                      type="submit"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-accent transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={titleSaving}
                      title={titleSaving ? 'Saving…' : 'Save title'}
                      aria-label={titleSaving ? 'Saving title' : 'Save title'}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={cancelTitleEdit}
                      disabled={titleSaving}
                      title="Cancel title edit"
                      aria-label="Cancel title edit"
                    >
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="m18 6-12 12" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </form>
                ) : draft ? (
                  <h1 className="max-w-4xl break-words pr-4 text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] text-primary sm:text-[34px]">
                    {title}
                  </h1>
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
                    onSaveCwd={() => {
                      void submitConversationCwdChange();
                    }}
                  />
                )}
              </div>
              {conversationHeaderElements.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  {conversationHeaderElements.map((element) => (
                    <ConversationHeaderHost key={`${element.extensionId}:${element.id}`} registration={element} />
                  ))}
                </div>
              )}
              {visibleConversationBootstrap?.integrityWarning && (
                <div className="mt-1 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>Session file was modified outside the agent. Some context may be stale.</span>
                </div>
              )}
            </div>
          </div>
          {showBlockingConversationLoadingState ? (
            <LoadingState label="Loading messages…" className="justify-center h-full" />
          ) : visibleTranscriptMessages ? (
            <>
              <ChatView
                key={visibleTranscriptState?.conversationId ?? id ?? 'draft-conversation'}
                conversationId={visibleTranscriptState?.conversationId ?? id ?? null}
                messages={visibleTranscriptMessages}
                systemPrompt={isLiveSession ? stream.systemPrompt : null}
                messageIndexOffset={visibleTranscriptMessageIndexOffset}
                scrollContainerRef={scrollRef}
                focusMessageIndex={renderingStaleTranscript ? null : requestedFocusMessageIndex}
                isStreaming={renderingStaleTranscript ? false : conversationRunningForPage}
                isCompacting={renderingStaleTranscript ? false : stream.isCompacting}
                pendingStatusLabel={renderingStaleTranscript ? null : displayedPendingAssistantStatusLabel}
                performanceMode={conversationPerformanceMode}
                onForkMessage={
                  shouldEnableMessageForkControls({ renderingStaleTranscript, conversationId: id })
                    ? forkConversationFromMessage
                    : undefined
                }
                onRewindMessage={!renderingStaleTranscript && id && !conversationRunningForPage ? rewindConversationFromMessage : undefined}
                onReplyToSelection={renderingStaleTranscript ? undefined : handleReplyToSelection}
                onHydrateMessage={renderingStaleTranscript ? undefined : hydrateHistoricalBlock}
                hydratingMessageBlockIds={renderingStaleTranscript ? undefined : hydratingHistoricalBlockIdSet}
                onOpenArtifact={renderingStaleTranscript ? undefined : openArtifact}
                activeArtifactId={renderingStaleTranscript ? null : selectedArtifactId}
                onOpenCheckpoint={renderingStaleTranscript ? undefined : openCheckpoint}
                activeCheckpointId={renderingStaleTranscript ? null : selectedCheckpointId}
                onOpenBrowser={renderingStaleTranscript ? undefined : openWorkbenchBrowser}
                onOpenFilePath={renderingStaleTranscript ? undefined : openKnowledgeFilePath}
                onSubmitAskUserQuestion={renderingStaleTranscript ? undefined : submitAskUserQuestion}
                askUserQuestionDisplayMode="composer"
                onResumeConversation={renderingStaleTranscript || !conversationResumeState.canResume ? undefined : resumeConversation}
                onFocusComposerRequest={focusComposerFromTranscriptBackground}
                resumeConversationBusy={renderingStaleTranscript ? false : resumeConversationBusy}
                resumeConversationTitle={renderingStaleTranscript ? undefined : conversationResumeState.title}
                resumeConversationLabel={conversationResumeState.actionLabel ?? 'continue'}
                windowingHeaderContent={
                  visibleTranscriptHasOlderBlocks ? (
                    <div className="flex flex-wrap items-center gap-3 text-[11px]">
                      <div className="min-w-0 text-secondary/80">
                        Showing latest{' '}
                        <span className="font-medium text-primary/85">
                          {realMessages?.length ?? visibleTranscriptMessages?.length ?? 0}
                        </span>{' '}
                        of <span className="font-medium text-primary/85">{historicalTotalBlocks}</span> blocks.
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
                  ) : undefined
                }
                anchorWindowingToTail={atBottom}
                windowingBadgeTopOffset={conversationHeaderOffset + 12}
              />
            </>
          ) : (
            <AppPageEmptyState
              align={draft ? 'start' : 'center'}
              className={draft ? 'px-4 pt-12 sm:px-6' : undefined}
              contentClassName={draft ? `${DRAFT_EMPTY_STATE_CONTENT_WIDTH_CLASS} text-left` : undefined}
              icon={
                draft ? undefined : (
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center mx-auto">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-accent"
                    >
                      <path d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
                    </svg>
                  </div>
                )
              }
              title={
                draft ? (
                  <span className="sr-only">Choose a workspace</span>
                ) : isLiveSession ? (
                  'No messages yet'
                ) : (
                  'This conversation is empty'
                )
              }
              body={
                draft
                  ? undefined
                  : isLiveSession
                    ? 'This conversation is live but has no messages yet. Send a prompt to get started.'
                    : 'Start a Pi session to populate this conversation.'
              }
              action={
                draft ? (
                  <ConversationDraftEmptyAction
                    hasDraftCwd={hasDraftCwd}
                    draftCwdValue={draftCwdValue}
                    draftCwdError={draftCwdError}
                    draftCwdPickBusy={draftCwdPickBusy}
                    savedWorkspacePathsLoading={savedWorkspacePathsLoading}
                    availableDraftWorkspacePaths={availableDraftWorkspacePaths}
                    onClearDraftCwdSelection={clearDraftConversationCwdSelection}
                    onSelectDraftWorkspace={selectDraftConversationWorkspace}
                    onPickDraftCwd={() => {
                      void pickDraftConversationCwd();
                    }}
                    extensionPanels={newConversationPanels.map((panel) => (
                      <NewConversationPanelHost
                        key={`${panel.extensionId}:${panel.id}`}
                        registration={panel}
                        panelContext={newConversationPanelContext}
                      />
                    ))}
                  />
                ) : undefined
              }
            />
          )}
        </div>
        {!showConversationLoadingState && showScrollToBottomControl && (
          <button
            onClick={() => {
              scrollToBottom({ behavior: 'smooth', force: true });
            }}
            className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 ui-pill ui-pill-muted shadow-md"
          >
            ↓ scroll to bottom
          </button>
        )}
        {showInlineConversationLoadingState && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-base/85 px-6 py-4 backdrop-blur-sm">
            <LoadingState label={renderingStaleTranscript ? 'Loading new messages…' : 'Loading messages…'} className="justify-center" />
          </div>
        )}
      </div>
    ),
    [
      conversationResumeState.actionLabel,
      conversationResumeState.canResume,
      conversationResumeState.title,
      draft,
      draftCwdError,
      draftCwdPickBusy,
      draftCwdValue,
      forkConversationFromMessage,
      focusComposerFromTranscriptBackground,
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
      showConversationLoadingState,
      showInlineConversationLoadingState,
      showScrollToBottomControl,
      stream.isCompacting,
      conversationRunningForPage,
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
      newConversationPanelContext,
      newConversationPanels,
    ],
  );

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
          action={
            <Link to="/conversations/new" className="ui-action-button">
              Start a new conversation
            </Link>
          }
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
            {showSlash && (
              <SlashMenu
                items={slashItems}
                idx={slashIdx}
                onSelect={(item) => {
                  const c = item.displayCmd.trim();
                  const parsedConversationSlash = parseConversationSlashCommand(c);
                  if (parsedConversationSlash?.kind === 'command') {
                    setSlashIdx(0);
                    void executeConversationSlashCommand(parsedConversationSlash.command);
                    return;
                  }
                  setInput(item.insertText);
                  setSlashIdx(0);
                  textareaRef.current?.focus();
                }}
              />
            )}
            {showMention && (
              <MentionMenu
                items={mentionItems}
                query={mentionQuery}
                idx={mentionIdx}
                onSelect={(id) => {
                  setInput(input.replace(/@[\w./-]*$/, id + ' '));
                  setMentionIdx(0);
                  textareaRef.current?.focus();
                }}
              />
            )}
            {showModelPicker && (
              <ModelPicker
                models={modelItems}
                currentModel={currentModel}
                query={modelQuery}
                idx={modelIdx}
                onSelect={selectModel}
                onClose={() => {
                  setInput('');
                  textareaRef.current?.focus();
                }}
              />
            )}

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

            {showTextOnlyImageHint ? (
              <p className="mb-2 text-[12px] text-secondary">Set a vision model in Settings to inspect attached images.</p>
            ) : null}

            <div
              className={cx(
                'ui-input-shell',
                resolveConversationComposerShellStateClassName({
                  dragOver,
                  hasInteractiveOverlay: showModelPicker || showSlash || showMention,
                  streamIsStreaming: composerRunState.streamControlsActive,
                }),
              )}
              ref={composerShellRef}
            >
              {/* Drag overlay hint */}
              {dragOver && (
                <div className="px-4 py-3 text-center text-[12px] text-accent border-b border-accent/20">📎 Drop files to attach</div>
              )}

              <ConversationGoalPanel
                goal={
                  composerGoalPending && input.trim()
                    ? { objective: input.trim(), status: 'active', tasks: [], stopReason: null, updatedAt: null }
                    : stream.goalState
                }
                workingLabel={goalEnabled && conversationRunningForPage ? 'Working…' : null}
              />

              {hasComposerShelfContent && (
                <div className="max-h-[min(34vh,20rem)] overflow-y-auto overscroll-contain">
                  {composerShelvesTop.map((shelf) => (
                    <ComposerShelfHost key={`${shelf.extensionId}:${shelf.id}`} registration={shelf} shelfContext={composerShelfContext} />
                  ))}
                  {pendingBrowserComments.length > 0 ? (
                    <div className="border-b border-border-subtle/60 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dim">Browser comments</p>
                        <button
                          type="button"
                          className="ui-toolbar-button px-2 py-1 text-[11px]"
                          onClick={() => setPendingBrowserComments([])}
                        >
                          Clear
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {pendingBrowserComments.map((entry) => (
                          <div
                            key={entry.id}
                            className="group flex max-w-full items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-2 py-1 text-[11px] text-secondary"
                          >
                            <span className="max-w-[26rem] truncate text-primary">{formatBrowserCommentTargetLabel(entry.target)}</span>
                            <span className="max-w-[20rem] truncate">{entry.comment}</span>
                            <button
                              type="button"
                              className="ml-1 text-dim hover:text-primary"
                              aria-label="Remove browser comment"
                              onClick={() => setPendingBrowserComments((current) => current.filter((comment) => comment.id !== entry.id))}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <ConversationContextShelf
                    attachedContextDocs={attachedContextDocs}
                    draftMentionItems={draftMentionItems}
                    unattachedDraftMentionItems={unattachedDraftMentionItems}
                    contextDocsBusy={contextDocsBusy}
                    onRemoveAttachedContextDoc={(path) => {
                      void removeAttachedContextDoc(path);
                    }}
                    onAttachMentionedDocs={(items) => {
                      void attachMentionedDocsToConversation(items);
                    }}
                  />

                  <ConversationQueueShelf
                    pendingQueue={pendingQueue}
                    parallelJobs={parallelJobs}
                    conversationNeedsTakeover={conversationNeedsTakeover}
                    onRestoreQueuedPrompt={(behavior, queueIndex, previewId) => {
                      void restoreQueuedPromptToComposer(behavior, queueIndex, previewId);
                    }}
                    onManageParallelJob={(jobId, action) => {
                      void manageParallelJob(jobId, action);
                    }}
                    onOpenConversation={(conversationId) => {
                      ensureConversationTabOpen(conversationId);
                      navigate(`/conversations/${conversationId}`);
                    }}
                  />

                  {!draft && (
                    <ConversationActivityShelf
                      backgroundRuns={activeConversationBackgroundRuns}
                      backgroundRunIndicatorText={backgroundRunIndicatorText}
                      showBackgroundRunDetails={showActiveBackgroundRunDetails}
                      runLookups={runLookups}
                      cancellingBackgroundRunIds={cancellingBackgroundRunIds}
                      onToggleBackgroundRunDetails={() => {
                        setShowBackgroundRunDetails((open) => !open);
                      }}
                      onCancelBackgroundRun={cancelBackgroundRunFromShelf}
                      onOpenBackgroundRun={openRun}
                      deferredResumes={orderedDeferredResumes}
                      deferredResumeIndicatorText={deferredResumeIndicatorText}
                      deferredResumeNowMs={deferredResumeNowMs}
                      hasReadyDeferredResumes={hasReadyDeferredResumes}
                      isLiveSession={isLiveSession}
                      deferredResumesBusy={deferredResumesBusy}
                      showDeferredResumeDetails={showDeferredResumeDetails}
                      onContinueDeferredResumesNow={() => {
                        void continueDeferredResumesNow();
                      }}
                      onToggleDeferredResumeDetails={() => {
                        setShowDeferredResumeDetails((open) => !open);
                      }}
                      onFireDeferredResumeNow={(resumeId) => {
                        void fireDeferredResumeNow(resumeId);
                      }}
                      onCancelDeferredResume={(resumeId) => {
                        void cancelDeferredResume(resumeId);
                      }}
                    />
                  )}

                  {pendingAskUserQuestion && composerActiveQuestion && (
                    <ConversationQuestionShelf
                      presentation={pendingAskUserQuestion.presentation}
                      activeQuestion={composerActiveQuestion}
                      activeQuestionIndex={composerQuestionIndex}
                      activeOptionIndex={composerQuestionOptionIndex}
                      answers={composerQuestionAnswers}
                      submitting={composerQuestionSubmitting}
                      answeredCount={composerQuestionAnsweredCount}
                      onActivateQuestion={activateComposerQuestion}
                      onSelectOption={handleComposerQuestionOptionSelect}
                    />
                  )}
                  {composerShelvesBottom.map((shelf) => (
                    <ComposerShelfHost key={`${shelf.extensionId}:${shelf.id}`} registration={shelf} shelfContext={composerShelfContext} />
                  ))}
                </div>
              )}

              <ConversationComposerInputControls
                fileInputRef={fileInputRef}
                textareaRef={textareaRef}
                input={input}
                pendingAskUserQuestion={Boolean(pendingAskUserQuestion)}
                composerDisabled={composerDisabled}
                composerShellWidth={composerShellWidth}
                streamIsStreaming={composerRunState.streamControlsActive}
                models={models}
                currentModel={currentModel || model || defaultModel}
                currentThinkingLevel={currentThinkingLevel}
                currentServiceTier={currentServiceTier}
                savingPreference={savingPreference}
                goalEnabled={goalEnabled}
                conversationNeedsTakeover={conversationNeedsTakeover}
                composerHasContent={composerHasContent}
                composerShowsQuestionSubmit={composerShowsQuestionSubmit}
                composerQuestionCanSubmit={composerQuestionCanSubmit}
                composerQuestionRemainingCount={composerQuestionRemainingCount}
                composerQuestionSubmitting={composerQuestionSubmitting}
                composerSubmitLabel={composerSubmit.label}
                composerAltHeld={composerAltHeld}
                composerParallelHeld={composerParallelHeld}
                onFilesSelected={(files) => {
                  void addComposerFiles(files);
                }}
                onInputChange={(value, textarea) => {
                  setInput(value);
                  setSlashIdx(0);
                  setMentionIdx(0);
                  rememberComposerSelection(textarea);
                }}
                onRememberComposerSelection={rememberComposerSelection}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onOpenFilePicker={openFilePicker}
                onUpsertDrawingAttachment={(payload) => {
                  upsertDrawingAttachment(payload as ExcalidrawEditorSavePayload);
                }}
                onSelectModel={selectModel}
                onSelectThinkingLevel={(thinkingLevel) => {
                  void saveThinkingLevelPreference(thinkingLevel);
                }}
                onSelectServiceTier={(enableFastMode) => {
                  void saveServiceTierPreference(enableFastMode);
                }}
                onToggleGoal={() => {
                  void toggleGoalMode();
                }}
                onInsertComposerText={insertTextIntoComposer}
                onSubmitComposerQuestion={() => {
                  void submitComposerQuestionIfReady();
                }}
                onSubmitComposerActionForModifiers={(altKeyHeld, parallelKeyHeld) => {
                  void submitComposerActionForModifiers(altKeyHeld, parallelKeyHeld);
                }}
                onAbortStream={() => {
                  void stopStreamAndRestoreQueuedPrompts();
                }}
              />
            </div>

            {showComposerMeta ? (
              <ConversationComposerMeta
                draft={draft}
                hasDraftCwd={hasDraftCwd}
                draftCwdValue={draftCwdValue}
                draftCwdError={draftCwdError}
                draftCwdPickBusy={draftCwdPickBusy}
                availableDraftWorkspacePaths={availableDraftWorkspacePaths}
                onClearDraftCwdSelection={clearDraftConversationCwdSelection}
                onSelectDraftWorkspace={selectDraftConversationWorkspace}
                onPickDraftCwd={() => {
                  void pickDraftConversationCwd();
                }}
                conversationCwdEditorOpen={conversationCwdEditorOpen}
                currentCwd={currentCwd}
                currentCwdLabel={currentCwdLabel}
                conversationCwdDraft={conversationCwdDraft}
                conversationCwdError={conversationCwdError}
                conversationCwdBusy={conversationCwdBusy}
                conversationCwdPickBusy={conversationCwdPickBusy}
                onConversationCwdDraftChange={(value) => {
                  setConversationCwdDraft(value);
                  if (conversationCwdError) {
                    setConversationCwdError(null);
                  }
                }}
                onSubmitConversationCwdChange={() => {
                  void submitConversationCwdChange();
                }}
                onCancelConversationCwdEdit={cancelConversationCwdEdit}
                onPickConversationCwd={() => {
                  void pickConversationCwd();
                }}
                onBeginConversationCwdEdit={beginConversationCwdEdit}
                branchLabel={branchLabel}
                gitSummaryPresentation={gitSummaryPresentation}
                sessionTokens={sessionTokens}
              />
            ) : null}
          </div>
        </div>
      )}

      {selectedArtifactId && id && !artifactOpensInWorkbenchPane && (
        <Suspense fallback={null}>
          <ConversationArtifactModal conversationId={id} artifactId={selectedArtifactId} />
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
            onAttach={(selection) => {
              void attachSavedDrawing(selection);
            }}
            onClose={() => setDrawingsPickerOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
