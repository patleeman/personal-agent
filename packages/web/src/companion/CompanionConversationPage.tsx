import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ChatView } from '../components/chat/ChatView';
import { cx } from '../components/ui';
import { useApi } from '../hooks';
import { readConversationLayout, setConversationArchivedState } from '../sessionTabs';
import { getConversationDisplayTitle } from '../conversationTitle';
import { useLiveTitles } from '../contexts';
import { useSessionDetail } from '../hooks/useSessions';
import { useSessionStream } from '../hooks/useSessionStream';
import { getConversationArtifactIdFromSearch, setConversationArtifactIdInSearch } from '../conversationArtifacts';
import { displayBlockToMessageBlock } from '../messageBlocks';
import { buildSlashMenuItems, parseSlashInput, type SlashMenuItem } from '../slashMenu';
import type {
  LiveSessionPresenceState,
  LiveSessionSurfaceType,
  MemoryData,
  MessageBlock,
  PromptImageInput,
} from '../types';
import { CompanionConversationArtifacts } from './CompanionConversationArtifacts';
import { CompanionConversationTodos } from './CompanionConversationTodos';
import { COMPANION_CONVERSATIONS_PATH } from './routes';

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
  isLiveSession,
  surfaceId,
  presence,
}: CompanionControlStateInput) {
  const currentSurface = surfaceId
    ? presence.surfaces.find((surface) => surface.surfaceId === surfaceId) ?? null
    : null;
  const controllingThisSurface = isLiveSession
    && Boolean(surfaceId)
    && presence.controllerSurfaceId === surfaceId;
  const presenceKnownForThisSurface = Boolean(currentSurface);
  const needsTakeover = isLiveSession && presenceKnownForThisSurface && !controllingThisSurface;

  return {
    currentSurface,
    controllingThisSurface,
    presenceKnownForThisSurface,
    needsTakeover,
  };
}

export function shouldShowCompanionConversationStatusBanner(input: {
  isLiveSession: boolean;
}): boolean {
  return !input.isLiveSession;
}

const COMPANION_TAP_HIGHLIGHT_COLOR = 'rgba(var(--color-accent) / 0.14)';
const COMPANION_TOUCH_BUTTON_STYLE = {
  WebkitTapHighlightColor: COMPANION_TAP_HIGHLIGHT_COLOR,
  touchAction: 'manipulation',
} as const;

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

function formatSurfaceTypeLabel(surfaceType: LiveSessionSurfaceType | null | undefined): string {
  if (surfaceType === 'mobile_web') {
    return 'phone';
  }

  if (surfaceType === 'desktop_web') {
    return 'desktop';
  }

  return 'another surface';
}

function buildBannerTitle(input: {
  isLiveSession: boolean;
  controllingThisSurface: boolean;
  presence: LiveSessionPresenceState;
}): string {
  if (!input.isLiveSession) {
    return 'Saved transcript';
  }

  if (input.controllingThisSurface) {
    return 'You are controlling this conversation.';
  }

  if (input.presence.controllerSurfaceId) {
    return `Mirroring while ${formatSurfaceTypeLabel(input.presence.controllerSurfaceType)} controls.`;
  }

  return 'Connecting to live conversation…';
}

function buildBannerDetail(input: {
  isLiveSession: boolean;
  controllingThisSurface: boolean;
  needsTakeover: boolean;
  mirroredViewerCount: number;
  presence: LiveSessionPresenceState;
}): string {
  if (!input.isLiveSession) {
    return 'Read-only here. Start a new live conversation from the list when you want to continue.';
  }

  if (input.controllingThisSurface) {
    if (input.mirroredViewerCount > 0) {
      return `${input.mirroredViewerCount} other ${input.mirroredViewerCount === 1 ? 'surface is' : 'surfaces are'} mirroring live.`;
    }

    return 'Other surfaces stay mirrored until they explicitly take over.';
  }

  if (input.needsTakeover || input.presence.controllerSurfaceId) {
    return 'Take over to reply or stop the current turn from this device.';
  }

  return 'Waiting for controller state…';
}

type CompanionConversationPanel = 'actions' | 'todos' | 'artifacts';

function getCompanionConversationPanel(search: string): CompanionConversationPanel | null {
  const value = new URLSearchParams(search).get('panel');
  return value === 'actions' || value === 'todos' || value === 'artifacts' ? value : null;
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

export function CompanionConversationPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const selectedArtifactId = getConversationArtifactIdFromSearch(location.search);
  const { titles } = useLiveTitles();
  const [confirmedLive, setConfirmedLive] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [takeoverBusy, setTakeoverBusy] = useState(false);
  const [conversationAdminBusy, setConversationAdminBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [slashIdx, setSlashIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedPanel = getCompanionConversationPanel(location.search);
  const { data: openTabs, replaceData: replaceOpenTabs } = useApi(api.openConversationTabs, 'companion-conversation-open-tabs');

  const shouldSubscribeToLiveStream = Boolean(id) && confirmedLive !== false;
  const stream = useSessionStream(id ?? null, {
    enabled: shouldSubscribeToLiveStream,
    tailBlocks: 200,
  });

  const { detail: sessionDetail, loading: sessionLoading } = useSessionDetail(id, { tailBlocks: 200 });

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
  const todoReadOnlyReason = controlState.needsTakeover
    ? 'Take over to manage the todo list from this device.'
    : stream.isStreaming
      ? 'Wait for the current turn to finish before editing the todo list.'
      : null;
  const trimmedDraft = draft.trim();
  const composerHasContent = trimmedDraft.length > 0 || attachments.length > 0;
  const slashInput = useMemo(() => parseSlashInput(draft), [draft]);
  const shouldLoadMemoryData = isLiveSession
    && !controlState.needsTakeover
    && draft.trimStart().startsWith('/');
  const { data: memoryData, loading: memoryLoading } = useApi<MemoryData | null>(
    () => (shouldLoadMemoryData ? api.memory() : Promise.resolve(null)),
    `companion-conversation-memory:${shouldLoadMemoryData ? 'on' : 'off'}`,
  );
  const slashItems = useMemo(
    () => buildSlashMenuItems(draft, memoryData?.skills ?? [])
      .filter((item) => item.kind === 'skill'),
    [draft, memoryData?.skills],
  );
  const showSlash = !controlState.needsTakeover
    && !stream.isStreaming
    && Boolean(slashInput)
    && draft === slashInput?.command
    && (memoryLoading || slashItems.length > 0);
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
    sessionDetail?.meta.title,
  );
  const composerDisabled = !isLiveSession || controlState.needsTakeover || stream.isStreaming || submitting;
  const missingConversation = Boolean(id)
    && confirmedLive === false
    && !sessionLoading
    && !sessionDetail;
  const bannerTitle = buildBannerTitle({
    isLiveSession,
    controllingThisSurface: controlState.controllingThisSurface,
    presence: stream.presence,
  });
  const bannerDetail = buildBannerDetail({
    isLiveSession,
    controllingThisSurface: controlState.controllingThisSurface,
    needsTakeover: controlState.needsTakeover,
    mirroredViewerCount,
    presence: stream.presence,
  });
  const showStatusBanner = shouldShowCompanionConversationStatusBanner({ isLiveSession });

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      return;
    }

    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [id, messages, stream.isStreaming]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) {
      return;
    }

    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [draft]);

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
      replaceOpenTabs(readConversationLayout());
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setConversationAdminBusy(false);
    }
  }, [conversationAdminBusy, id, replaceOpenTabs]);

  const handleTakeover = useCallback(async () => {
    if (!id || takeoverBusy) {
      return;
    }

    const confirmed = typeof window === 'undefined'
      ? true
      : window.confirm('Take over this conversation? This device will become the active controller while other surfaces keep mirroring live.');
    if (!confirmed) {
      return;
    }

    setTakeoverBusy(true);
    setActionError(null);

    try {
      await stream.takeover();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setTakeoverBusy(false);
    }
  }, [id, stream, takeoverBusy]);

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

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!id || (!text && attachments.length === 0) || composerDisabled) {
      if (controlState.needsTakeover) {
        setActionError('Take over this conversation to reply from this device.');
      }
      return;
    }

    setSubmitting(true);
    setActionError(null);

    try {
      const promptImages = await buildCompanionPromptImages(attachments);
      await stream.send(text, undefined, promptImages);
      setDraft('');
      setAttachments([]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }, [attachments, composerDisabled, controlState.needsTakeover, draft, id, stream]);

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
      <header className="border-b border-border-subtle bg-base/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl flex-col px-3 pb-3 pt-[calc(env(safe-area-inset-top)+0.625rem)] sm:px-4">
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5">
            <Link
              to={COMPANION_CONVERSATIONS_PATH}
              aria-label="Back to conversations"
              className="inline-flex h-10 select-none items-center gap-2 rounded-full border border-border-default bg-surface px-3 text-[12px] font-medium text-secondary transition-[transform,color,border-color,background-color] duration-150 hover:border-accent/35 hover:text-primary active:scale-[0.97] active:bg-elevated/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/45"
              style={COMPANION_TOUCH_BUTTON_STYLE}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
              <span>Chats</span>
            </Link>
            <div className="min-w-0 px-1 text-center">
              <h1 className="truncate text-[16px] font-medium tracking-tight text-primary">{title}</h1>
            </div>
            <button
              type="button"
              onClick={() => openPanel('actions')}
              aria-label="Open conversation actions"
              className="inline-flex h-10 w-10 select-none items-center justify-center rounded-full border border-border-default bg-surface text-secondary transition-[transform,color,border-color,background-color] duration-150 hover:border-accent/35 hover:text-primary active:scale-[0.97] active:bg-elevated/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/45"
              style={COMPANION_TOUCH_BUTTON_STYLE}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7h16" />
                <path d="M4 12h16" />
                <path d="M4 17h16" />
              </svg>
            </button>
          </div>
          {showStatusBanner ? (
            <div className="mt-3 rounded-xl bg-surface px-3 py-2.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/80">{bannerTitle}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-secondary">{bannerDetail}</p>
            </div>
          ) : null}
          {actionError || stream.error ? (
            <p className="mt-2 text-[11px] text-danger">{actionError ?? stream.error}</p>
          ) : null}
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-3 sm:py-4">
        <div className="mx-auto w-full max-w-4xl">
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
            />
          )}
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
                    {selectedPanel === 'actions' ? 'Actions' : selectedPanel === 'todos' ? 'Todo list' : 'Artifacts'}
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
                    onClick={() => openPanel('todos')}
                    className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-surface"
                  >
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-primary">Todo list</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-secondary">Review, reorder, and complete the current conversation todo list.</p>
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
                </div>
              ) : selectedPanel === 'todos' ? (
                <CompanionConversationTodos
                  conversationId={id}
                  readOnly={Boolean(todoReadOnlyReason)}
                  readOnlyReason={todoReadOnlyReason}
                />
              ) : (
                <CompanionConversationArtifacts conversationId={id} />
              )}
            </div>
          </aside>
        </div>
      ) : null}

      <footer className="border-t border-border-subtle bg-base/95 px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 backdrop-blur sm:px-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2.5">
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
              <div className={cx(
                'ui-input-shell overflow-hidden',
                showSlash ? 'border-accent/40 ring-1 ring-accent/15' : 'border-border-subtle',
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
                {controlState.needsTakeover ? (
                  <div className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => { void handleTakeover(); }}
                      disabled={takeoverBusy}
                      className="ui-pill ui-pill-solid-accent flex w-full items-center justify-center gap-2 px-4 py-3 text-[13px] disabled:cursor-default disabled:opacity-60"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 8h10" />
                        <path d="m9 4 4 4-4 4" />
                      </svg>
                      {takeoverBusy ? 'Taking over…' : 'Take over to reply'}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-end gap-2 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={openFilePicker}
                      disabled={composerDisabled}
                      aria-label="Attach image"
                      title="Attach image"
                      className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-default bg-surface text-secondary transition-[transform,color,border-color,background-color] duration-150 hover:border-accent/30 hover:text-primary active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/45 disabled:cursor-default disabled:opacity-45"
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

                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                          event.preventDefault();
                          void handleSend();
                          return;
                        }

                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void handleSend();
                        }
                      }}
                      placeholder={stream.isStreaming
                        ? 'Stop the current turn or wait before sending.'
                        : 'Message… (/ for skills)'}
                      disabled={composerDisabled}
                      rows={1}
                      autoComplete="off"
                      spellCheck={false}
                      className="flex-1 bg-transparent text-[16px] leading-relaxed text-primary placeholder:text-dim outline-none resize-none disabled:cursor-default disabled:text-dim sm:text-sm"
                      style={{ minHeight: '24px', maxHeight: '160px' }}
                    />
                    {(stream.isStreaming || composerHasContent) && (
                      <div className="mb-0.5 flex shrink-0 items-center gap-1.5">
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
                        {composerHasContent ? (
                          <button
                            type="button"
                            onClick={() => { void handleSend(); }}
                            disabled={composerDisabled}
                            className="ui-pill ui-pill-solid-accent disabled:cursor-default disabled:opacity-60"
                          >
                            {submitting ? 'Sending…' : 'Send'}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {!controlState.needsTakeover ? (
                <p className="mt-1 text-[11px] text-dim">
                  {stream.isStreaming ? 'Agent responding…' : 'Use / for skills · attach images from your phone.'}
                </p>
              ) : null}
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
