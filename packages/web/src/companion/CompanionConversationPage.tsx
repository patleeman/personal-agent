import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { ChatView } from '../components/chat/ChatView';
import { cx } from '../components/ui';
import { useApi } from '../hooks';
import { getConversationDisplayTitle } from '../conversationTitle';
import { useAppData, useLiveTitles, useSseConnection } from '../contexts';
import { useSessionDetail } from '../hooks/useSessions';
import { useSessionStream } from '../hooks/useSessionStream';
import { getConversationArtifactIdFromSearch, setConversationArtifactIdInSearch } from '../conversationArtifacts';
import { displayBlockToMessageBlock } from '../messageBlocks';
import { buildSlashMenuItems, parseSlashInput, type SlashMenuItem } from '../slashMenu';
import type {
  ConversationExecutionState,
  LiveSessionPresenceState,
  LiveSessionSurfaceType,
  MessageBlock,
  SseConnectionStatus,
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

function formatConnectionStatus(status: SseConnectionStatus): string {
  switch (status) {
    case 'open':
      return 'live';
    case 'reconnecting':
      return 'reconnecting';
    case 'offline':
      return 'offline';
    default:
      return 'connecting';
  }
}

function connectionStatusDotClass(status: SseConnectionStatus): string {
  switch (status) {
    case 'open':
      return 'bg-success';
    case 'reconnecting':
      return 'bg-warning';
    case 'offline':
      return 'bg-danger';
    default:
      return 'bg-dim/70';
  }
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

function buildExecutionLabel(execution: ConversationExecutionState | null): string {
  if (!execution) {
    return 'Local agent';
  }

  if (execution.location === 'remote') {
    return execution.target?.label ?? 'Remote workspace';
  }

  return 'Local agent';
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

type CompanionConversationPanel = 'todos' | 'artifacts';

function getCompanionConversationPanel(search: string): CompanionConversationPanel | null {
  const value = new URLSearchParams(search).get('panel');
  return value === 'todos' || value === 'artifacts' ? value : null;
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
  onSelect,
}: {
  items: SlashMenuItem[];
  index: number;
  onSelect: (item: SlashMenuItem) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="ui-menu-shell absolute inset-x-0 bottom-full z-10 mb-2 max-h-[18rem] overflow-y-auto py-1.5">
      {items.map((item, itemIndex) => {
        const active = itemIndex === index % items.length;
        return (
          <button
            key={item.key}
            type="button"
            onMouseDown={(event) => {
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
  const { sessions } = useAppData();
  const selectedArtifactId = getConversationArtifactIdFromSearch(location.search);
  const { titles } = useLiveTitles();
  const { status } = useSseConnection();
  const sessionSnapshot = useMemo(
    () => (id ? sessions?.find((session) => session.id === id) ?? null : null),
    [id, sessions],
  );
  const sessionsLoaded = sessions !== null;
  const [confirmedLive, setConfirmedLive] = useState<boolean | null>(null);
  const [execution, setExecution] = useState<ConversationExecutionState | null>(null);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [takeoverBusy, setTakeoverBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [slashIdx, setSlashIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectedPanel = getCompanionConversationPanel(location.search);
  const { data: memoryData } = useApi(api.memory, 'companion-conversation-memory');

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

    if (sessionSnapshot?.isLive === false) {
      setConfirmedLive(false);
      return;
    }

    setConfirmedLive(sessionSnapshot?.isLive === true ? true : null);
    let cancelled = false;

    api.liveSession(id)
      .then((response) => {
        if (!cancelled) {
          setConfirmedLive(response.live);
        }
      })
      .catch(() => {
        if (!cancelled && sessionsLoaded && sessionSnapshot?.isLive !== true) {
          setConfirmedLive(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, sessionSnapshot, sessionsLoaded]);

  useEffect(() => {
    if (!id) {
      setExecution(null);
      return;
    }

    let cancelled = false;
    api.conversationExecution(id)
      .then((nextExecution) => {
        if (!cancelled) {
          setExecution(nextExecution);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExecution(null);
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
  const slashInput = useMemo(() => parseSlashInput(draft), [draft]);
  const slashItems = useMemo(
    () => buildSlashMenuItems(draft, memoryData?.skills ?? [])
      .filter((item) => item.kind === 'skill'),
    [draft, memoryData?.skills],
  );
  const showSlash = !controlState.needsTakeover
    && !stream.isStreaming
    && Boolean(slashInput)
    && draft === slashInput?.command
    && slashItems.length > 0;
  const title = getConversationDisplayTitle(
    stream.title,
    titles.get(id ?? ''),
    sessionSnapshot?.title,
    sessionDetail?.meta.title,
  );
  const executionLabel = buildExecutionLabel(execution);
  const composerDisabled = !isLiveSession || controlState.needsTakeover || stream.isStreaming || submitting;
  const missingConversation = Boolean(id)
    && sessionsLoaded
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
    if (!id || !text || composerDisabled) {
      if (controlState.needsTakeover) {
        setActionError('Take over this conversation to reply from this device.');
      }
      return;
    }

    setSubmitting(true);
    setActionError(null);

    try {
      await stream.send(text);
      setDraft('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }, [composerDisabled, controlState.needsTakeover, draft, id, stream]);

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
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.625rem)]">
          <div className="flex items-center justify-between gap-3">
            <Link to={COMPANION_CONVERSATIONS_PATH} className="text-[12px] text-accent transition-colors hover:text-accent/80">
              ← Chats
            </Link>
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-dim/80">
              <span className={`h-1.5 w-1.5 rounded-full ${connectionStatusDotClass(status)}`} />
              {formatConnectionStatus(status)}
            </span>
          </div>
          <div className="mt-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-[20px] font-semibold leading-tight tracking-tight text-primary">{title}</h1>
              <p className="mt-1 text-[11px] text-secondary">
                {executionLabel} · {isLiveSession ? 'live conversation' : 'saved transcript'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => openPanel('todos')}
                aria-label="Open todo panel"
                title="Open todo panel"
                className={cx(
                  'flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
                  selectedPanel === 'todos' ? 'border-accent/30 bg-accent/10 text-accent' : 'border-border-default bg-surface text-secondary hover:text-primary',
                )}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6h11" />
                  <path d="M9 12h11" />
                  <path d="M9 18h11" />
                  <path d="m4 6 1.5 1.5L7.5 5" />
                  <path d="m4 12 1.5 1.5L7.5 11" />
                  <path d="m4 18 1.5 1.5L7.5 17" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => openPanel('artifacts')}
                aria-label="Open artifact panel"
                title="Open artifact panel"
                className={cx(
                  'flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
                  selectedPanel === 'artifacts' ? 'border-accent/30 bg-accent/10 text-accent' : 'border-border-default bg-surface text-secondary hover:text-primary',
                )}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3 4 7l8 4 8-4-8-4Z" />
                  <path d="m4 12 8 4 8-4" />
                  <path d="m4 17 8 4 8-4" />
                </svg>
              </button>
            </div>
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

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto w-full max-w-3xl">
          {messages.length === 0 && (sessionLoading || confirmedLive === null) ? (
            <p className="text-[13px] text-dim">Loading conversation…</p>
          ) : messages.length === 0 ? (
            <p className="text-[13px] text-dim">No messages yet.</p>
          ) : (
            <ChatView
              messages={messages}
              messageIndexOffset={messageIndexOffset}
              scrollContainerRef={scrollRef}
              isStreaming={stream.isStreaming}
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
          <aside className="absolute inset-y-0 right-0 flex w-[min(28rem,92vw)] max-w-full flex-col border-l border-border-subtle bg-base shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-[calc(env(safe-area-inset-top)+0.75rem)]">
              <div className="flex min-w-0 items-center gap-1 rounded-full bg-surface p-1">
                <button
                  type="button"
                  onClick={() => openPanel('todos')}
                  className={cx(
                    'rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors',
                    selectedPanel === 'todos' ? 'bg-accent text-white' : 'text-secondary hover:text-primary',
                  )}
                >
                  Todo
                </button>
                <button
                  type="button"
                  onClick={() => openPanel('artifacts')}
                  className={cx(
                    'rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors',
                    selectedPanel === 'artifacts' ? 'bg-accent text-white' : 'text-secondary hover:text-primary',
                  )}
                >
                  Artifacts
                </button>
              </div>
              <button
                type="button"
                onClick={closePanel}
                aria-label="Close side panel"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-default bg-surface text-secondary transition-colors hover:text-primary"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" style={{ overscrollBehavior: 'contain' }}>
              {selectedPanel === 'todos' ? (
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

      <footer className="border-t border-border-subtle bg-base/95 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl">
          {isLiveSession ? (
            <div className="relative">
              {showSlash ? (
                <CompanionSlashMenu items={slashItems} index={slashIdx} onSelect={applySlashItem} />
              ) : null}
              <div className={cx(
                'ui-input-shell overflow-hidden',
                showSlash ? 'border-accent/40 ring-1 ring-accent/15' : 'border-border-subtle',
              )}>
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
                    <textarea
                      ref={textareaRef}
                      value={draft}
                      onChange={(event) => {
                        setDraft(event.target.value);
                        setSlashIdx(0);
                      }}
                      onKeyDown={(event) => {
                        if (showSlash) {
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
                      className="flex-1 bg-transparent text-sm leading-relaxed text-primary placeholder:text-dim outline-none resize-none disabled:cursor-default disabled:text-dim"
                      style={{ minHeight: '24px', maxHeight: '160px' }}
                    />
                    {(stream.isStreaming || trimmedDraft.length > 0) && (
                      <div className="shrink-0 mb-0.5 flex items-center gap-1.5">
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
                        {trimmedDraft.length > 0 ? (
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
                <p className="mt-1.5 text-[11px] text-dim">
                  {stream.isStreaming ? 'Agent responding…' : 'Use / to insert a skill command.'}
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
