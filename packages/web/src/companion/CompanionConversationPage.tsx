import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ChatView } from '../components/chat/ChatView';
import { Pill, cx } from '../components/ui';
import { shouldShowScrollToBottomControl } from '../conversationScroll';
import { useCompanionTopBarAction } from './CompanionLayout';
import { useApi } from '../hooks';
import { filterMentionItems, MAX_MENTION_MENU_ITEMS, type MentionItem } from '../conversationMentions';
import { useNodeMentionItems } from '../useNodeMentionItems';
import {
  readConversationLayout,
  setConversationArchivedState,
  syncConversationLayoutMerge,
  type ConversationLayout,
} from '../sessionTabs';
import { getConversationDisplayTitle } from '../conversationTitle';
import { buildDeferredResumeIndicatorText, compareDeferredResumes } from '../deferredResumeIndicator';
import { useAppData, useLiveTitles } from '../contexts';
import { useConversationScroll } from '../hooks/useConversationScroll';
import { useSessionDetail } from '../hooks/useSessions';
import { useConversationEventVersion } from '../hooks/useConversationEventVersion';
import { useSessionStream } from '../hooks/useSessionStream';
import { getConversationArtifactIdFromSearch, setConversationArtifactIdInSearch } from '../conversationArtifacts';
import { displayBlockToMessageBlock } from '../messageBlocks';
import { buildCompanionSkillMenuItems, parseSlashInput, type SlashMenuItem } from '../slashMenu';
import { formatContextWindowLabel, formatThinkingLevelLabel } from '../conversationHeader';
import { THINKING_LEVEL_OPTIONS, groupModelsByProvider } from '../modelPreferences';
import type {
  LiveSessionPresenceState,
  MemoryData,
  MessageBlock,
  ModelInfo,
  PromptImageInput,
  ScheduledTaskSummary,
  SessionDetail,
} from '../types';
import { CompanionConversationArtifacts } from './CompanionConversationArtifacts';
import { buildCompanionConversationPath, COMPANION_CONVERSATIONS_PATH, COMPANION_TASKS_PATH } from './routes';

interface CompanionLiveStateInput {
  streamBlockCount: number;
  isStreaming: boolean;
  confirmedLive: boolean | null;
}

interface CompanionControlStateInput {
  isLiveSession: boolean;
  surfaceId: string | null | undefined;
  presence: LiveSessionPresenceState;
}

export function resolveCompanionConversationLive({
  streamBlockCount,
  isStreaming,
  confirmedLive,
}: CompanionLiveStateInput): boolean {
  return streamBlockCount > 0 || isStreaming || confirmedLive === true;
}

export function resolveCompanionControlState({
  isLiveSession: _isLiveSession,
  surfaceId,
  presence,
}: CompanionControlStateInput) {
  const currentSurface = surfaceId
    ? presence.surfaces.find((surface) => surface.surfaceId === surfaceId) ?? null
    : null;
  const presenceKnownForThisSurface = Boolean(currentSurface);

  return {
    currentSurface,
    presenceKnownForThisSurface,
    needsTakeover: false,
  };
}

export function shouldShowCompanionConversationStatusBanner(input: {
  isLiveSession: boolean;
}): boolean {
  return !input.isLiveSession;
}

/**
 * Bidirectional sync: opening a conversation on the companion adds it to the
 * shared web workspace so the web UI reflects it as "In workspace".
 */
export async function syncCompanionConversationWorkspaceLayout(
  conversationId: string | null | undefined,
): Promise<ConversationLayout> {
  const mergedLayout = await syncConversationLayoutMerge();

  if (conversationId) {
    const normalized = conversationId.trim();
    if (!mergedLayout.pinnedSessionIds.includes(normalized) && !mergedLayout.sessionIds.includes(normalized)) {
      const next: ConversationLayout = {
        ...mergedLayout,
        sessionIds: [...mergedLayout.sessionIds, normalized],
      };

      // Write to server so web UI picks up the change.
      void api.setOpenConversationTabs(
        next.sessionIds,
        next.pinnedSessionIds,
        next.archivedSessionIds,
      ).catch(() => { /* best-effort */ });

      return next;
    }
  }

  return mergedLayout;
}

const COMPANION_TAP_HIGHLIGHT_COLOR = 'rgba(var(--color-accent) / 0.14)';
const COMPANION_TOUCH_BUTTON_STYLE = {
  WebkitTapHighlightColor: COMPANION_TAP_HIGHLIGHT_COLOR,
  touchAction: 'manipulation',
} as const;
const INITIAL_COMPANION_HISTORICAL_TAIL_BLOCKS = 400;
const COMPANION_HISTORICAL_TAIL_BLOCKS_STEP = 400;
const COMPANION_WINDOWING_BADGE_WITH_HISTORY_TOP_OFFSET_PX = 48;
const COMPANION_HISTORICAL_PREFETCH_SCROLL_THRESHOLD_PX = 900;

type CompanionTaskIndicatorTone = 'accent' | 'warning' | 'dim';

interface CompanionTaskSummaryState {
  actionText: string;
  indicatorText: string | null;
  tone: CompanionTaskIndicatorTone;
}

function buildCompanionScheduledTaskSummary(tasks: ScheduledTaskSummary[] | null | undefined): CompanionTaskSummaryState {
  if (tasks == null) {
    return {
      actionText: 'Loading scheduled tasks…',
      indicatorText: null,
      tone: 'dim',
    };
  }

  const allTasks = tasks;
  if (allTasks.length === 0) {
    return {
      actionText: 'No scheduled tasks configured.',
      indicatorText: null,
      tone: 'dim',
    };
  }

  const runningCount = allTasks.filter((task) => task.running).length;
  const failureCount = allTasks.filter((task) => task.lastStatus === 'failure').length;
  const actionParts = [`${allTasks.length} total`];
  const indicatorParts: string[] = [];

  if (runningCount > 0) {
    actionParts.push(`${runningCount} running`);
    indicatorParts.push(`${runningCount} running`);
  }

  if (failureCount > 0) {
    actionParts.push(`${failureCount} failed`);
    indicatorParts.push(`${failureCount} failed`);
  }

  return {
    actionText: actionParts.join(' · '),
    indicatorText: indicatorParts.length > 0 ? indicatorParts.join(' · ') : null,
    tone: failureCount > 0 ? 'warning' : runningCount > 0 ? 'accent' : 'dim',
  };
}

function readCompanionFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name || 'attachment'}.`));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error(`Failed to read ${file.name || 'attachment'}.`));
        return;
      }

      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

function filterCompanionImageFiles(files: File[]): File[] {
  return files.filter((file) => file.type.startsWith('image/'));
}

async function buildCompanionPromptImages(files: File[]): Promise<PromptImageInput[]> {
  const imageFiles = filterCompanionImageFiles(files);
  return Promise.all(imageFiles.map(async (file) => {
    const previewUrl = await readCompanionFileAsDataUrl(file);
    const commaIndex = previewUrl.indexOf(',');
    return {
      name: file.name,
      mimeType: file.type || 'image/png',
      data: commaIndex >= 0 ? previewUrl.slice(commaIndex + 1) : previewUrl,
      previewUrl,
    } satisfies PromptImageInput;
  }));
}

function buildBannerTitle(input: {
  isLiveSession: boolean;
}): string {
  return input.isLiveSession ? 'Live conversation' : 'Saved transcript';
}

function buildBannerDetail(input: {
  isLiveSession: boolean;
  mirroredViewerCount: number;
}): string {
  if (!input.isLiveSession) {
    return 'Resume this transcript to reply from this device, or start a new live conversation from the list.';
  }

  if (input.mirroredViewerCount > 0) {
    return `${input.mirroredViewerCount} other ${input.mirroredViewerCount === 1 ? 'surface is' : 'surfaces are'} viewing live.`;
  }

  return 'Reply from this device. Other surfaces stay in sync.';
}

type CompanionConversationPanel = 'actions' | 'runtime' | 'artifacts';

function getCompanionConversationPanel(search: string): CompanionConversationPanel | null {
  const value = new URLSearchParams(search).get('panel');
  return value === 'actions' || value === 'runtime' || value === 'artifacts' ? value : null;
}

function setCompanionConversationPanel(search: string, panel: CompanionConversationPanel | null): string {
  const params = new URLSearchParams(search);
  if (panel) {
    params.set('panel', panel);
  } else {
    params.delete('panel');
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

function CompanionMentionMenu({
  items,
  query,
  index,
  onSelect,
}: {
  items: MentionItem[];
  query: string;
  index: number;
  onSelect: (id: string) => void;
}) {
  const filtered = filterMentionItems(items, query, { limit: MAX_MENTION_MENU_ITEMS });
  if (filtered.length === 0) {
    return null;
  }

  return (
    <div className="ui-menu-shell absolute inset-x-0 bottom-full z-10 mb-2 max-h-[18rem] overflow-y-auto py-1.5">
      <div className="px-3 pt-1 pb-1">
        <p className="ui-section-label">Mention</p>
      </div>
      {filtered.map((item, itemIndex) => {
        const active = itemIndex === index % filtered.length;
        return (
          <button
            key={`${item.kind}:${item.id}`}
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              onSelect(item.id);
            }}
            className={cx(
              'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors',
              active ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50',
            )}
          >
            <Pill tone="muted">{item.kind}</Pill>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[12px] text-accent">{item.id}</p>
              {(item.summary || (item.title && item.title !== item.label)) && (
                <p className="mt-0.5 truncate text-[12px] text-dim/90">{item.summary || item.title}</p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function CompanionSlashMenu({
  items,
  index,
  loading,
  onSelect,
}: {
  items: SlashMenuItem[];
  index: number;
  loading?: boolean;
  onSelect: (item: SlashMenuItem) => void;
}) {
  if (items.length === 0 && !loading) {
    return null;
  }

  return (
    <div className="ui-menu-shell absolute inset-x-0 bottom-full z-10 mb-2 max-h-[18rem] overflow-y-auto py-1.5">
      {loading && items.length === 0 ? (
        <div className="px-3 py-3 text-[12px] text-dim">Loading skills…</div>
      ) : null}
      {items.map((item, itemIndex) => {
        const active = itemIndex === index % items.length;
        return (
          <button
            key={item.key}
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              onSelect(item);
            }}
            className={cx(
              'flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors',
              active ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50',
            )}
          >
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-subtle text-[10px] text-dim/80" aria-hidden="true">
              {item.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-[12px] text-accent">{item.displayCmd}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-dim/60">{item.section}</span>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-dim/90">{item.desc}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

const COMPANION_RUNTIME_SELECT_CLASS = 'w-full rounded-lg border border-border-default bg-surface px-3 py-2.5 text-[13px] text-primary outline-none transition-colors focus:border-accent/60 disabled:cursor-default disabled:opacity-50';

function CompanionConversationRuntimePanel({
  models,
  currentModel,
  currentThinkingLevel,
  loading,
  savingPreference,
  disabledReason,
  onSelectModel,
  onSelectThinkingLevel,
}: {
  models: ModelInfo[];
  currentModel: string;
  currentThinkingLevel: string;
  loading: boolean;
  savingPreference: 'model' | 'thinking' | null;
  disabledReason?: string | null;
  onSelectModel: (modelId: string) => void;
  onSelectThinkingLevel: (thinkingLevel: string) => void;
}) {
  const groupedModels = useMemo(() => groupModelsByProvider(models), [models]);
  const selectedModel = models.find((candidate) => candidate.id === currentModel) ?? null;
  const controlsDisabled = loading || savingPreference !== null || Boolean(disabledReason);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="ui-section-label" htmlFor="companion-conversation-model-preference">Model</label>
        <select
          id="companion-conversation-model-preference"
          value={currentModel}
          onChange={(event) => { onSelectModel(event.target.value); }}
          disabled={controlsDisabled || models.length === 0}
          className={COMPANION_RUNTIME_SELECT_CLASS}
        >
          {!currentModel ? <option value="">{loading ? 'Loading models…' : 'Choose a model'}</option> : null}
          {groupedModels.map(([provider, providerModels]) => (
            <optgroup key={provider} label={provider}>
              {providerModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} · {formatContextWindowLabel(model.context)} ctx
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="text-[12px] leading-relaxed text-secondary">
          {savingPreference === 'model'
            ? 'Saving model…'
            : selectedModel
              ? `${selectedModel.name} · ${selectedModel.provider} · ${formatContextWindowLabel(selectedModel.context)} ctx`
              : loading
                ? 'Loading available models…'
                : 'No model selected.'}
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="ui-section-label" htmlFor="companion-conversation-thinking-preference">Thinking</label>
        <select
          id="companion-conversation-thinking-preference"
          value={currentThinkingLevel}
          onChange={(event) => { onSelectThinkingLevel(event.target.value); }}
          disabled={controlsDisabled}
          className={COMPANION_RUNTIME_SELECT_CLASS}
        >
          {THINKING_LEVEL_OPTIONS.map((option) => (
            <option key={option.value || 'unset'} value={option.value}>{option.label}</option>
          ))}
        </select>
        <p className="text-[12px] leading-relaxed text-secondary">
          {savingPreference === 'thinking'
            ? 'Saving thinking level…'
            : `Current thinking level: ${formatThinkingLevelLabel(currentThinkingLevel)}`}
        </p>
      </div>

      <p className={cx(
        'text-[12px] leading-relaxed',
        disabledReason ? 'text-warning' : 'text-dim',
      )}>
        {disabledReason ?? 'Changes here only affect this conversation.'}
      </p>
    </div>
  );
}

export function CompanionConversationPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const selectedArtifactId = getConversationArtifactIdFromSearch(location.search);
  const { titles } = useLiveTitles();
  const { sessions, tasks } = useAppData();
  const { setTopBarTitle, setTopBarRightAction } = useCompanionTopBarAction();
  const [confirmedLive, setConfirmedLive] = useState<boolean | null>(null);
  const [historicalTailBlocks, setHistoricalTailBlocks] = useState(INITIAL_COMPANION_HISTORICAL_TAIL_BLOCKS);
  const [retainedSessionDetail, setRetainedSessionDetail] = useState<SessionDetail | null>(null);
  const [deferredResumeNowMs, setDeferredResumeNowMs] = useState(() => Date.now());
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [conversationAdminBusy, setConversationAdminBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runtimeModels, setRuntimeModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrentModel] = useState('');
  const [currentThinkingLevel, setCurrentThinkingLevel] = useState('');
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [savingRuntimePreference, setSavingRuntimePreference] = useState<'model' | 'thinking' | null>(null);
  const [slashIdx, setSlashIdx] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedPanel = getCompanionConversationPanel(location.search);
  const { data: openTabs, replaceData: replaceOpenTabs } = useApi(api.openConversationTabs, 'companion-conversation-open-tabs');
  const sessionSnapshot = useMemo(
    () => (id ? sessions?.find((session) => session.id === id) ?? null : null),
    [id, sessions],
  );
  const conversationEventVersion = useConversationEventVersion(id);

  const shouldSubscribeToLiveStream = Boolean(id) && confirmedLive !== false;
  const stream = useSessionStream(id ?? null, {
    enabled: shouldSubscribeToLiveStream,
    tailBlocks: historicalTailBlocks,
  });

  useEffect(() => {
    const pendingCwdChange = stream.cwdChange;
    if (!id || !pendingCwdChange || pendingCwdChange.newConversationId === id) {
      return;
    }

    navigate(buildCompanionConversationPath(pendingCwdChange.newConversationId));
  }, [id, navigate, stream.cwdChange]);

  const { detail: fetchedSessionDetail, loading: sessionLoading } = useSessionDetail(id, {
    tailBlocks: historicalTailBlocks,
    version: conversationEventVersion,
  });
  const sessionDetail = (retainedSessionDetail?.meta.id === id ? retainedSessionDetail : null)
    ?? (fetchedSessionDetail?.meta.id === id ? fetchedSessionDetail : null);
  const savedConversationSessionFile = sessionDetail?.meta.file ?? sessionSnapshot?.file ?? null;

  useEffect(() => {
    if (!id) {
      return;
    }

    void syncCompanionConversationWorkspaceLayout(id).then(replaceOpenTabs);
  }, [id, replaceOpenTabs]);

  useEffect(() => {
    setHistoricalTailBlocks(INITIAL_COMPANION_HISTORICAL_TAIL_BLOCKS);
  }, [id]);

  useEffect(() => {
    if (!id) {
      setRetainedSessionDetail(null);
      return;
    }

    if (fetchedSessionDetail?.meta.id === id) {
      setRetainedSessionDetail(fetchedSessionDetail);
      return;
    }

    if (!sessionLoading) {
      setRetainedSessionDetail(null);
    }
  }, [fetchedSessionDetail, id, sessionLoading]);

  useEffect(() => {
    if (!id) {
      setConfirmedLive(false);
      return;
    }

    setConfirmedLive(null);
    let cancelled = false;

    api.liveSession(id)
      .then((response) => {
        if (!cancelled) {
          setConfirmedLive(response.live);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConfirmedLive(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id) {
      setRuntimeModels([]);
      setCurrentModel('');
      setCurrentThinkingLevel('');
      setRuntimeLoading(false);
      return;
    }

    let cancelled = false;
    setRuntimeLoading(true);

    Promise.all([
      api.models(),
      api.conversationModelPreferences(id),
    ]).then(([modelState, preferenceState]) => {
      if (cancelled) {
        return;
      }

      setRuntimeModels(modelState.models);
      setCurrentModel(preferenceState.currentModel || modelState.currentModel || '');
      setCurrentThinkingLevel(preferenceState.currentThinkingLevel ?? modelState.currentThinkingLevel ?? '');
    }).catch((error) => {
      if (cancelled) {
        return;
      }

      setRuntimeModels([]);
      setCurrentModel(sessionSnapshot?.model ?? '');
      setCurrentThinkingLevel('');
      setActionError((current) => current ?? (error instanceof Error ? error.message : String(error)));
    }).finally(() => {
      if (!cancelled) {
        setRuntimeLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [conversationEventVersion, id, sessionSnapshot?.model]);

  const isLiveSession = resolveCompanionConversationLive({
    streamBlockCount: stream.blocks.length,
    isStreaming: stream.isStreaming,
    confirmedLive,
  });

  const controlState = resolveCompanionControlState({
    isLiveSession,
    surfaceId: stream.surfaceId,
    presence: stream.presence,
  });

  const mirroredViewerCount = Math.max(
    0,
    stream.presence.surfaces.length - (controlState.presenceKnownForThisSurface ? 1 : 0),
  );

  const storedMessages = useMemo<MessageBlock[]>(() => (
    sessionDetail?.blocks.map(displayBlockToMessageBlock) ?? []
  ), [sessionDetail]);
  const messages = stream.blocks.length > 0 ? stream.blocks : storedMessages;
  const messageIndexOffset = stream.blocks.length > 0 ? stream.blockOffset : sessionDetail?.blockOffset ?? 0;
  const historicalTotalBlocks = stream.blocks.length > 0 ? stream.totalBlocks : sessionDetail?.totalBlocks ?? messages.length;
  const historicalHasOlderBlocks = messageIndexOffset > 0;
  const initialScrollKey = useMemo(
    () => (id ? `${id}:${isLiveSession ? 'live' : 'saved'}` : null),
    [id, isLiveSession],
  );
  const { atBottom, syncScrollStateFromDom, scrollToBottom, capturePrependRestore } = useConversationScroll({
    conversationId: id ?? null,
    messages,
    scrollRef,
    sessionLoading,
    isStreaming: stream.isStreaming,
    initialScrollKey,
    prependRestoreKey: messageIndexOffset,
  });
  const orderedDeferredResumes = useMemo(
    () => [...(sessionSnapshot?.deferredResumes ?? [])].sort(compareDeferredResumes),
    [sessionSnapshot?.deferredResumes],
  );
  const pendingQueue = useMemo(() => ([
    ...stream.pendingQueue.steering.map((item, index) => ({
      id: item.id,
      text: item.text,
      imageCount: item.imageCount,
      pending: item.pending === true,
      type: 'steer' as const,
      queueIndex: index,
    })),
    ...stream.pendingQueue.followUp.map((item, index) => ({
      id: item.id,
      text: item.text,
      imageCount: item.imageCount,
      pending: item.pending === true,
      type: 'followUp' as const,
      queueIndex: index,
    })),
  ]), [stream.pendingQueue.followUp, stream.pendingQueue.steering]);
  const hasReadyDeferredResumes = orderedDeferredResumes.some((resume) => resume.status === 'ready');
  const deferredResumeIndicatorText = useMemo(
    () => buildDeferredResumeIndicatorText(orderedDeferredResumes, deferredResumeNowMs),
    [deferredResumeNowMs, orderedDeferredResumes],
  );
  const scheduledTaskSummary = useMemo(
    () => buildCompanionScheduledTaskSummary(tasks),
    [tasks],
  );
  const showStatusIndicators = orderedDeferredResumes.length > 0 || Boolean(scheduledTaskSummary.indicatorText);
  const canResumeConversation = !isLiveSession && Boolean(savedConversationSessionFile);
  const runtimeReadOnlyReason = null;
  const runtimeSummaryText = currentModel
    ? `${currentModel} · ${formatThinkingLevelLabel(currentThinkingLevel)} thinking`
    : runtimeLoading
      ? 'Loading runtime…'
      : 'Change model & thinking level';
  const canQueuePrompts = stream.isStreaming;
  const trimmedDraft = draft.trim();
  const composerHasContent = trimmedDraft.length > 0 || attachments.length > 0;
  const slashInput = useMemo(() => parseSlashInput(draft), [draft]);
  const mentionMatch = draft.match(/(^|.*\s)(@[\w./-]*)$/);
  const shouldLoadMemoryData = isLiveSession
    && !controlState.needsTakeover
    && draft.trimStart().startsWith('/');
  const { data: memoryData, loading: memoryLoading } = useApi<MemoryData | null>(
    () => (shouldLoadMemoryData ? api.memory() : Promise.resolve(null)),
    `companion-conversation-memory:${shouldLoadMemoryData ? 'on' : 'off'}`,
  );
  const slashItems = useMemo(
    () => buildCompanionSkillMenuItems(draft, memoryData?.skills ?? []),
    [draft, memoryData?.skills],
  );
  const { data: nodeMentionItems } = useNodeMentionItems();
  const companionMentionItems = Array.isArray(nodeMentionItems) ? nodeMentionItems : [];
  const showSlash = !controlState.needsTakeover
    && !stream.isStreaming
    && Boolean(slashInput)
    && draft === slashInput?.command
    && (memoryLoading || slashItems.length > 0);
  const showMention = !controlState.needsTakeover
    && !stream.isStreaming
    && Boolean(mentionMatch)
    && !showSlash;
  const mentionQuery = mentionMatch?.[2] ?? '';
  const workspaceSessionIds = useMemo(() => {
    if (!openTabs) {
      return null;
    }

    return new Set([...openTabs.sessionIds, ...openTabs.pinnedSessionIds]);
  }, [openTabs]);
  const conversationInWorkspace = id ? (workspaceSessionIds?.has(id) ?? false) : false;
  const title = getConversationDisplayTitle(
    stream.title,
    titles.get(id ?? ''),
    sessionDetail?.meta.title ?? sessionSnapshot?.title,
  );
  const composerDisabled = !isLiveSession || controlState.needsTakeover || submitting;
  const missingConversation = Boolean(id)
    && confirmedLive === false
    && !sessionLoading
    && !fetchedSessionDetail
    && !sessionSnapshot;
  const bannerTitle = buildBannerTitle({ isLiveSession });
  const bannerDetail = buildBannerDetail({
    isLiveSession,
    mirroredViewerCount,
  });
  const showStatusBanner = shouldShowCompanionConversationStatusBanner({ isLiveSession });
  const keyboardOpen = keyboardInset > 120;
  const composerFooterPaddingBottom = keyboardOpen
    ? '0.5rem'
    : 'calc(env(safe-area-inset-bottom) + 0.75rem)';
  const showJumpToLatestControl = shouldShowScrollToBottomControl(messages.length, atBottom);

  useEffect(() => {
    if (orderedDeferredResumes.length === 0) {
      return;
    }

    const intervalHandle = window.setInterval(() => {
      setDeferredResumeNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalHandle);
    };
  }, [orderedDeferredResumes.length]);

  const loadOlderMessages = useCallback(() => {
    if (!id || sessionLoading || historicalTotalBlocks <= 0) {
      return;
    }

    const nextTailBlocks = Math.min(
      historicalTotalBlocks,
      historicalTailBlocks + COMPANION_HISTORICAL_TAIL_BLOCKS_STEP,
    );
    if (nextTailBlocks <= historicalTailBlocks) {
      return;
    }

    capturePrependRestore();
    setHistoricalTailBlocks(nextTailBlocks);
  }, [capturePrependRestore, historicalTailBlocks, historicalTotalBlocks, id, sessionLoading]);

  const handleScroll = useCallback(() => {
    syncScrollStateFromDom();

    const el = scrollRef.current;
    if (!el || sessionLoading || !historicalHasOlderBlocks) {
      return;
    }

    if (el.scrollTop <= COMPANION_HISTORICAL_PREFETCH_SCROLL_THRESHOLD_PX) {
      loadOlderMessages();
    }
  }, [historicalHasOlderBlocks, loadOlderMessages, sessionLoading, syncScrollStateFromDom]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }

    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

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
    setAttachments([]);
    setDraft('');
    setSlashIdx(0);
    setActionError(null);
  }, [id]);

  useEffect(() => {
    if (!selectedPanel || typeof document === 'undefined') {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedPanel]);

  const openArtifact = useCallback((artifactId: string) => {
    if (selectedArtifactId === artifactId) {
      return;
    }

    navigate({
      pathname: location.pathname,
      search: setConversationArtifactIdInSearch(location.search, artifactId),
    });
  }, [location.pathname, location.search, navigate, selectedArtifactId]);

  const openPanel = useCallback((panel: CompanionConversationPanel) => {
    navigate({
      pathname: location.pathname,
      search: setCompanionConversationPanel(location.search, panel),
    });
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    setTopBarTitle(title);
    return () => setTopBarTitle(undefined);
  }, [title, setTopBarTitle]);

  useEffect(() => {
    setTopBarRightAction(
      <button
        type="button"
        onClick={() => openPanel('actions')}
        aria-label="Open conversation details"
        className="relative flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full border border-border-default bg-surface text-secondary transition-[transform,color,border-color,background-color] duration-150 hover:border-accent/40 hover:text-primary active:scale-[0.97] active:border-accent/45 active:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/45"
        style={COMPANION_TOUCH_BUTTON_STYLE}
      >
        {showStatusIndicators ? (
          <span
            aria-hidden="true"
            className={cx(
              'absolute right-1.5 top-1.5 h-2 w-2 rounded-full',
              hasReadyDeferredResumes || scheduledTaskSummary.tone === 'warning' ? 'bg-warning' : 'bg-accent',
            )}
          />
        ) : null}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>,
    );
    return () => setTopBarRightAction(undefined);
  }, [openPanel, showStatusIndicators, hasReadyDeferredResumes, scheduledTaskSummary.tone, setTopBarRightAction]);

  const closePanel = useCallback(() => {
    navigate({
      pathname: location.pathname,
      search: setCompanionConversationPanel(location.search, null),
    });
  }, [location.pathname, location.search, navigate]);

  const applySlashItem = useCallback((item: SlashMenuItem) => {
    setDraft(item.insertText);
    setSlashIdx(0);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const addImageAttachments = useCallback((files: File[]) => {
    const imageFiles = filterCompanionImageFiles(files);
    if (imageFiles.length === 0) {
      setActionError('Companion currently supports image attachments only.');
      return;
    }

    setActionError(null);
    setAttachments((current) => [...current, ...imageFiles]);
  }, []);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }, []);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files ?? []);
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    addImageAttachments(files);
  }, [addImageAttachments]);

  const handleConversationArchivedState = useCallback((archived: boolean) => {
    if (!id || conversationAdminBusy) {
      return;
    }

    setConversationAdminBusy(true);
    setActionError(null);
    try {
      const nextLayout = setConversationArchivedState(id, archived);
      replaceOpenTabs(nextLayout);
    } catch (error) {
      void syncConversationLayoutMerge().then(replaceOpenTabs).catch(() => {
        replaceOpenTabs(readConversationLayout());
      });
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setConversationAdminBusy(false);
    }
  }, [conversationAdminBusy, id, replaceOpenTabs]);

  const handleStop = useCallback(async () => {
    if (!isLiveSession || !stream.isStreaming || controlState.needsTakeover || submitting) {
      return;
    }

    setActionError(null);

    try {
      await stream.abort();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, [controlState.needsTakeover, isLiveSession, stream, submitting]);

  const handleResumeConversation = useCallback(async () => {
    if (!savedConversationSessionFile || resumeBusy) {
      if (!savedConversationSessionFile) {
        setActionError('This transcript cannot be resumed because its session file is unavailable.');
      }
      return;
    }

    setResumeBusy(true);
    setActionError(null);

    try {
      const resumed = await api.resumeSession(savedConversationSessionFile);
      setConfirmedLive(true);

      if (resumed.id && resumed.id !== id) {
        navigate(buildCompanionConversationPath(resumed.id));
        return;
      }

      if (selectedPanel) {
        closePanel();
      }
      stream.reconnect();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setResumeBusy(false);
    }
  }, [closePanel, id, navigate, resumeBusy, savedConversationSessionFile, selectedPanel, stream]);

  const handleSelectRuntimeModel = useCallback(async (modelId: string) => {
    if (!id || !modelId || savingRuntimePreference !== null) {
      return;
    }

    if (controlState.needsTakeover) {
      setActionError('Take over this conversation to change its model from this device.');
      return;
    }

    setSavingRuntimePreference('model');
    setActionError(null);

    try {
      const next = await api.updateConversationModelPreferences(id, { model: modelId }, stream.surfaceId);
      setCurrentModel(next.currentModel);
      setCurrentThinkingLevel(next.currentThinkingLevel);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingRuntimePreference(null);
    }
  }, [controlState.needsTakeover, id, savingRuntimePreference, stream.surfaceId]);

  const handleSelectRuntimeThinkingLevel = useCallback(async (thinkingLevel: string) => {
    if (!id || savingRuntimePreference !== null || thinkingLevel === currentThinkingLevel) {
      return;
    }

    if (controlState.needsTakeover) {
      setActionError('Take over this conversation to change its thinking level from this device.');
      return;
    }

    setSavingRuntimePreference('thinking');
    setActionError(null);

    try {
      const next = await api.updateConversationModelPreferences(id, { thinkingLevel }, stream.surfaceId);
      setCurrentModel(next.currentModel);
      setCurrentThinkingLevel(next.currentThinkingLevel);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingRuntimePreference(null);
    }
  }, [controlState.needsTakeover, currentThinkingLevel, id, savingRuntimePreference, stream.surfaceId]);

  const handleSend = useCallback(async (behavior?: 'steer' | 'followUp') => {
    const text = draft.trim();
    if (!id || (!text && attachments.length === 0) || composerDisabled) {
      if (controlState.needsTakeover) {
        setActionError('Take over this conversation to reply from this device.');
      }
      return;
    }

    const nextBehavior = canQueuePrompts ? behavior : undefined;
    setSubmitting(true);
    setActionError(null);

    try {
      const promptImages = await buildCompanionPromptImages(attachments);
      await stream.send(text, nextBehavior, promptImages);
      setDraft('');
      setAttachments([]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }, [attachments, canQueuePrompts, composerDisabled, controlState.needsTakeover, draft, id, stream]);

  if (!id) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-[14px] text-dim">
        Choose a conversation from the companion list.
      </div>
    );
  }

  if (missingConversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <h1 className="text-[24px] font-semibold tracking-tight text-primary">Conversation not found</h1>
        <p className="mt-3 max-w-md text-[14px] leading-relaxed text-secondary">
          This conversation is no longer available from the companion app.
        </p>
        <Link to={COMPANION_CONVERSATIONS_PATH} className="ui-action-button mt-5">
          Back to conversations
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {showStatusBanner || actionError || stream.error || showStatusIndicators ? (
        <div className="border-b border-border-subtle bg-base/95 px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-3 sm:px-4">
          {showStatusBanner ? (
            <div className="rounded-xl bg-surface px-3 py-2.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">{bannerTitle}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-secondary">{bannerDetail}</p>
            </div>
          ) : null}
          {actionError || stream.error ? (
            <p className="mt-2 text-[11px] text-danger">{actionError ?? stream.error}</p>
          ) : null}
          {showStatusIndicators ? (
            <div className="mt-3 overflow-hidden rounded-xl bg-surface">
              {orderedDeferredResumes.length > 0 ? (
                <div className="px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Wakeups</p>
                  <p className={cx(
                    'mt-1 text-[12px] leading-relaxed',
                    hasReadyDeferredResumes ? 'text-warning' : 'text-secondary',
                  )}>
                    {deferredResumeIndicatorText}
                  </p>
                </div>
              ) : null}
              {orderedDeferredResumes.length > 0 && scheduledTaskSummary.indicatorText ? (
                <div className="h-px bg-border-subtle" aria-hidden="true" />
              ) : null}
              {scheduledTaskSummary.indicatorText ? (
                <Link
                  to={COMPANION_TASKS_PATH}
                  className="flex items-start justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-elevated/40"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Tasks</p>
                    <p className={cx(
                      'mt-1 text-[12px] leading-relaxed',
                      scheduledTaskSummary.tone === 'warning' ? 'text-warning' : 'text-secondary',
                    )}>
                      {scheduledTaskSummary.indicatorText}
                    </p>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0 text-dim">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto py-3 sm:py-4">
        <div className="mx-auto w-full max-w-4xl">
          {historicalHasOlderBlocks && messages.length > 0 ? (
            <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border-subtle bg-base/95 px-3 py-2 backdrop-blur sm:px-4">
              <div className="min-w-0 text-[11px] text-secondary">
                Showing the latest <span className="font-medium text-primary">{messages.length}</span> of{' '}
                <span className="font-medium text-primary">{historicalTotalBlocks}</span> blocks.
              </div>
              <button
                type="button"
                onClick={() => loadOlderMessages()}
                disabled={sessionLoading}
                className="ui-action-button shrink-0 px-2 py-1 text-[10px]"
              >
                {sessionLoading ? 'Loading older…' : `Load ${Math.min(COMPANION_HISTORICAL_TAIL_BLOCKS_STEP, messageIndexOffset)} older`}
              </button>
            </div>
          ) : null}
          {messages.length === 0 && (sessionLoading || confirmedLive === null) ? (
            <p className="px-3 text-[13px] text-dim sm:px-4">Loading conversation…</p>
          ) : messages.length === 0 ? (
            <p className="px-3 text-[13px] text-dim sm:px-4">No messages yet.</p>
          ) : (
            <ChatView
              messages={messages}
              messageIndexOffset={messageIndexOffset}
              scrollContainerRef={scrollRef}
              isStreaming={stream.isStreaming}
              performanceMode="aggressive"
              layout="companion"
              askUserQuestionDisplayMode="composer"
              onOpenArtifact={openArtifact}
              activeArtifactId={selectedArtifactId}
              windowingBadgeTopOffset={historicalHasOlderBlocks ? COMPANION_WINDOWING_BADGE_WITH_HISTORY_TOP_OFFSET_PX : undefined}
            />
          )}
          {showJumpToLatestControl ? (
            <button
              type="button"
              onClick={() => scrollToBottom({ behavior: 'smooth' })}
              className="sticky bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border-default bg-base/95 px-3 py-2 text-[12px] font-medium text-primary shadow-[0_10px_30px_rgba(15,23,42,0.18)] backdrop-blur"
            >
              Jump to latest
            </button>
          ) : null}
        </div>
      </div>

      {selectedPanel ? (
        <div className="fixed inset-0 z-30">
          <button
            type="button"
            aria-label="Close side panel"
            onClick={closePanel}
            className="absolute inset-0 bg-black/35"
          />
          <aside className="absolute inset-y-0 right-0 flex w-[min(24rem,88vw)] max-w-full flex-col border-l border-border-subtle bg-base shadow-2xl" style={{ overscrollBehavior: 'contain' }}>
            <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
              <div className="flex min-w-0 items-center gap-2">
                {selectedPanel === 'actions' ? null : (
                  <button
                    type="button"
                    onClick={() => openPanel('actions')}
                    aria-label="Back to conversation actions"
                    className="inline-flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full border border-border-default bg-surface text-secondary transition-[transform,color,border-color,background-color] duration-150 hover:border-accent/30 hover:text-primary active:scale-[0.97] active:bg-elevated/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/45"
                    style={COMPANION_TOUCH_BUTTON_STYLE}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </button>
                )}
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-dim/70">Conversation</p>
                  <h2 className="truncate text-[15px] font-medium text-primary">
                    {selectedPanel === 'actions'
                      ? 'Actions'
                      : selectedPanel === 'runtime'
                        ? 'Conversation runtime'
                        : 'Artifacts'}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={closePanel}
                aria-label="Close side panel"
                className="flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-full border border-border-default bg-surface text-secondary transition-[transform,color,border-color,background-color] duration-150 hover:border-accent/30 hover:text-primary active:scale-[0.97] active:bg-elevated/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/45"
                style={COMPANION_TOUCH_BUTTON_STYLE}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+0.875rem)]">
              {selectedPanel === 'actions' ? (
                <div className="-mx-1 divide-y divide-border-subtle">
                  {canResumeConversation ? (
                    <button
                      type="button"
                      onClick={() => { void handleResumeConversation(); }}
                      disabled={resumeBusy}
                      className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-surface disabled:cursor-default disabled:opacity-45"
                    >
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-accent">
                          {resumeBusy ? 'Resuming…' : 'Resume conversation'}
                        </p>
                        <p className="mt-1 text-[12px] leading-relaxed text-secondary">
                          Bring this saved transcript back to life so you can reply from the companion.
                        </p>
                      </div>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0 text-dim">
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleConversationArchivedState(conversationInWorkspace)}
                    disabled={conversationAdminBusy}
                    className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-surface disabled:cursor-default disabled:opacity-45"
                  >
                    <div className="min-w-0">
                      <p className={cx(
                        'text-[14px] font-medium',
                        conversationInWorkspace ? 'text-warning' : 'text-success',
                      )}>
                        {conversationAdminBusy ? (conversationInWorkspace ? 'Archiving…' : 'Opening…') : (conversationInWorkspace ? 'Archive conversation' : 'Open conversation')}
                      </p>
                      <p className="mt-1 text-[12px] leading-relaxed text-secondary">
                        {conversationInWorkspace
                          ? 'Remove this chat from the active workspace without deleting the transcript.'
                          : 'Bring this chat back into the active workspace.'}
                      </p>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0 text-dim">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => openPanel('runtime')}
                    className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-surface"
                  >
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-primary">Conversation runtime</p>
                      <p className="mt-1 truncate text-[12px] leading-relaxed text-secondary">{runtimeSummaryText}</p>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0 text-dim">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => openPanel('artifacts')}
                    className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-surface"
                  >
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-primary">Artifacts</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-secondary">Open rendered reports, diagrams, and other generated outputs.</p>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0 text-dim">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                  <Link
                    to={COMPANION_TASKS_PATH}
                    onClick={closePanel}
                    className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-surface"
                  >
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-primary">Scheduled tasks</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-secondary">{scheduledTaskSummary.actionText}</p>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0 text-dim">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </Link>
                </div>
              ) : selectedPanel === 'runtime' ? (
                <CompanionConversationRuntimePanel
                  models={runtimeModels}
                  currentModel={currentModel}
                  currentThinkingLevel={currentThinkingLevel}
                  loading={runtimeLoading}
                  savingPreference={savingRuntimePreference}
                  disabledReason={runtimeReadOnlyReason}
                  onSelectModel={(modelId) => { void handleSelectRuntimeModel(modelId); }}
                  onSelectThinkingLevel={(thinkingLevel) => { void handleSelectRuntimeThinkingLevel(thinkingLevel); }}
                />
              ) : (
                <CompanionConversationArtifacts conversationId={id} />
              )}
            </div>
          </aside>
        </div>
      ) : null}

      <footer
        className="border-t border-border-subtle bg-base/95 px-3 pt-3 backdrop-blur sm:px-4"
        style={{ paddingBottom: composerFooterPaddingBottom }}
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2.5">
          {pendingQueue.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">Queued</p>
              <div className="space-y-2">
                {pendingQueue.map((item) => (
                  <div key={`${item.type}:${item.id}:${item.queueIndex}`} className="rounded-xl bg-surface px-3 py-2.5">
                    <div className="flex items-start gap-2.5">
                      <Pill tone={item.type === 'steer' ? 'warning' : 'teal'}>
                        {item.type === 'steer' ? 'Steer' : 'Follow up'}
                      </Pill>
                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-secondary">
                          {item.text || '(image only)'}
                        </p>
                        {item.imageCount > 0 ? (
                          <p className="mt-1 text-[11px] text-dim">{item.imageCount} image{item.imageCount === 1 ? '' : 's'} attached</p>
                        ) : null}
                        {item.pending ? (
                          <p className="mt-1 text-[11px] text-dim/80">Queueing…</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {attachments.map((file, index) => (
                <div key={`${file.name}-${index}`} className="inline-flex max-w-full items-center gap-2 rounded-full border border-border-default bg-surface px-3 py-1.5 text-[11px] text-secondary">
                  <span className="truncate">{file.name || `Image ${index + 1}`}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(index)}
                    aria-label={`Remove ${file.name || `image ${index + 1}`}`}
                    className="text-dim transition hover:text-primary"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {isLiveSession ? (
            <div className="relative">
              {showSlash ? (
                <CompanionSlashMenu items={slashItems} index={slashIdx} loading={memoryLoading} onSelect={applySlashItem} />
              ) : null}
              {showMention ? (
                <CompanionMentionMenu
                  items={companionMentionItems}
                  query={mentionQuery}
                  index={mentionIdx}
                  onSelect={(mentionId) => {
                    setDraft(draft.replace(/@[\w./-]*$/, `${mentionId} `));
                    setMentionIdx(0);
                    textareaRef.current?.focus();
                  }}
                />
              ) : null}
              <div className={cx(
                'ui-input-shell overflow-hidden',
                showSlash || showMention ? 'border-accent/40 ring-1 ring-accent/15' : 'border-border-subtle',
              )}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    if (files.length > 0) {
                      addImageAttachments(files);
                    }
                    event.target.value = '';
                  }}
                />
                <div className="flex items-center gap-2 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={openFilePicker}
                      disabled={composerDisabled}
                      aria-label="Attach image"
                      title="Attach image"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-default bg-surface text-secondary transition-[transform,color,border-color,background-color] duration-150 hover:border-accent/30 hover:text-primary active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/45 disabled:cursor-default disabled:opacity-45"
                      style={COMPANION_TOUCH_BUTTON_STYLE}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                    </button>
                    <textarea
                      ref={textareaRef}
                      value={draft}
                      onChange={(event) => {
                        setDraft(event.target.value);
                        setSlashIdx(0);
                        setMentionIdx(0);
                      }}
                      onPaste={handlePaste}
                      onKeyDown={(event) => {
                        if (showSlash && slashItems.length > 0) {
                          if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            setSlashIdx((current) => current + 1);
                            return;
                          }

                          if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            setSlashIdx((current) => Math.max(0, current - 1));
                            return;
                          }

                          if ((event.key === 'Tab' || event.key === 'Enter') && !event.shiftKey) {
                            const selected = slashItems[slashIdx % slashItems.length];
                            if (selected) {
                              event.preventDefault();
                              applySlashItem(selected);
                              return;
                            }
                          }
                        }

                        if (showMention) {
                          const filteredMentions = filterMentionItems(companionMentionItems, mentionQuery, { limit: MAX_MENTION_MENU_ITEMS });
                          if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            setMentionIdx((current) => current + 1);
                            return;
                          }

                          if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            setMentionIdx((current) => Math.max(0, current - 1));
                            return;
                          }

                          if ((event.key === 'Tab' || event.key === 'Enter') && !event.shiftKey) {
                            const selected = filteredMentions[mentionIdx % (filteredMentions.length || 1)];
                            if (selected) {
                              event.preventDefault();
                              setDraft(draft.replace(/@[\w./-]*$/, `${selected.id} `));
                              setMentionIdx(0);
                              return;
                            }
                          }
                        }

                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                          event.preventDefault();
                          void handleSend();
                        }
                      }}
                      placeholder={stream.isStreaming
                        ? 'Agent responding… steer it now or queue a follow up.'
                        : 'Use / for skills · attach images from your phone.'}
                      disabled={composerDisabled}
                      rows={1}
                      autoComplete="off"
                      enterKeyHint="enter"
                      spellCheck={false}
                      className="flex-1 bg-transparent text-[16px] leading-snug text-primary placeholder:text-dim outline-none resize-none disabled:cursor-default disabled:text-dim sm:text-sm"
                      style={{ minHeight: '24px', maxHeight: '160px' }}
                    />
                  </div>
                  {(stream.isStreaming || composerHasContent) && (
                  <div className="flex shrink-0 items-center justify-end gap-1.5 px-1 pb-1">
                    {stream.isStreaming ? (
                      <button
                        type="button"
                        onClick={() => { void handleStop(); }}
                        disabled={submitting}
                        className="ui-pill ui-pill-danger disabled:cursor-default disabled:opacity-60"
                      >
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                          <rect x="3.25" y="3.25" width="9.5" height="9.5" rx="1.2" />
                        </svg>
                        Stop
                      </button>
                    ) : null}
                    {composerHasContent && !stream.isStreaming ? (
                      <button
                        type="button"
                        onClick={() => { void handleSend(); }}
                        disabled={composerDisabled}
                        className="ui-pill ui-pill-solid-accent disabled:cursor-default disabled:opacity-60"
                      >
                        {submitting ? 'Sending…' : 'Send'}
                      </button>
                    ) : null}
                    {composerHasContent && stream.isStreaming ? (
                      <>
                        <button
                          type="button"
                          onClick={() => { void handleSend('steer'); }}
                          disabled={composerDisabled}
                          className="ui-pill ui-pill-warning disabled:cursor-default disabled:opacity-60"
                        >
                          {submitting ? 'Sending…' : 'Steer'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { void handleSend('followUp'); }}
                          disabled={composerDisabled}
                          className="ui-pill ui-pill-teal disabled:cursor-default disabled:opacity-60"
                        >
                          {submitting ? 'Sending…' : 'Follow up'}
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          ) : canResumeConversation ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => { void handleResumeConversation(); }}
                disabled={resumeBusy}
                className="ui-pill ui-pill-solid-accent flex w-full items-center justify-center gap-2 px-4 py-3 text-[13px] disabled:cursor-default disabled:opacity-60"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 8h10" />
                  <path d="m9 4 4 4-4 4" />
                </svg>
                {resumeBusy ? 'Resuming…' : 'Resume conversation'}
              </button>
              <p className="text-[12px] leading-relaxed text-secondary">
                Resume this transcript to reply from this device, or <Link to={COMPANION_CONVERSATIONS_PATH} className="text-accent">start a new live conversation</Link> from the companion list.
              </p>
            </div>
          ) : (
            <p className="text-[12px] leading-relaxed text-secondary">
              This transcript is read-only right now. <Link to={COMPANION_CONVERSATIONS_PATH} className="text-accent">Start a new live conversation</Link> from the companion list when you want to continue.
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
