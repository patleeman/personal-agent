import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { ChatView } from '../components/chat/ChatView';
import { getConversationDisplayTitle } from '../conversationTitle';
import { useAppData, useLiveTitles, useSseConnection } from '../contexts';
import { useSessionDetail } from '../hooks/useSessions';
import { useSessionStream } from '../hooks/useSessionStream';
import { displayBlockToMessageBlock } from '../messageBlocks';
import type {
  ConversationExecutionState,
  LiveSessionPresenceState,
  LiveSessionSurfaceType,
  MessageBlock,
  SseConnectionStatus,
} from '../types';
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
    return 'This conversation is not live right now. You can read the transcript here and start a new live conversation from the companion list.';
  }

  if (input.controllingThisSurface) {
    if (input.mirroredViewerCount > 0) {
      return `${input.mirroredViewerCount} other ${input.mirroredViewerCount === 1 ? 'surface is' : 'surfaces are'} mirroring live.`;
    }

    return 'Other surfaces will stay mirrored and read-only until they explicitly take over.';
  }

  if (input.needsTakeover || input.presence.controllerSurfaceId) {
    return 'Take over here to send messages or stop the current turn from this device.';
  }

  return 'Waiting for controller state…';
}

export function CompanionConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { sessions } = useAppData();
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
  const scrollRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      return;
    }

    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [id, messages, stream.isStreaming]);

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
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-4 pt-[calc(env(safe-area-inset-top)+0.875rem)]">
          <div className="flex items-center justify-between gap-3">
            <Link to={COMPANION_CONVERSATIONS_PATH} className="text-[13px] text-accent transition-colors hover:text-accent/80">
              ← Conversations
            </Link>
            <span className="text-[11px] uppercase tracking-[0.14em] text-dim/80">{formatConnectionStatus(status)}</span>
          </div>
          <div className="mt-4 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[24px] font-semibold tracking-tight text-primary">{title}</h1>
              <p className="mt-1 text-[12px] text-secondary">
                {executionLabel} · {isLiveSession ? 'live conversation' : 'saved transcript'}
              </p>
            </div>
            {isLiveSession && controlState.needsTakeover ? (
              <button
                type="button"
                onClick={() => { void handleTakeover(); }}
                disabled={takeoverBusy}
                className="ui-action-button shrink-0"
              >
                {takeoverBusy ? 'Taking over…' : 'Take over here'}
              </button>
            ) : null}
          </div>
          <div className="mt-4 rounded-2xl bg-surface px-4 py-3">
            <p className="text-[13px] font-medium text-primary">{bannerTitle}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-secondary">{bannerDetail}</p>
          </div>
          {actionError || stream.error ? (
            <p className="mt-3 text-[12px] text-danger">{actionError ?? stream.error}</p>
          ) : null}
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
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
            />
          )}
        </div>
      </div>

      <footer className="border-t border-border-subtle bg-base/95 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          {isLiveSession ? (
            <>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={controlState.needsTakeover
                  ? 'Take over to reply from this device.'
                  : stream.isStreaming
                    ? 'Stop the current turn or wait before sending.'
                    : 'Reply from the companion app…'}
                disabled={composerDisabled}
                rows={3}
                className="w-full resize-none rounded-2xl border border-border-default bg-surface px-4 py-3 text-[15px] leading-relaxed text-primary placeholder:text-dim focus:border-accent/60 focus:outline-none disabled:cursor-default disabled:text-dim"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-dim">
                  {controlState.needsTakeover
                    ? 'Take over to reply from this device.'
                    : stream.isStreaming
                      ? 'The agent is responding right now.'
                      : 'Send from here when you want this device to steer the conversation.'}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { void handleStop(); }}
                    disabled={!stream.isStreaming || controlState.needsTakeover || submitting}
                    className="ui-action-button"
                  >
                    Stop
                  </button>
                  <button
                    type="button"
                    onClick={() => { void handleSend(); }}
                    disabled={!draft.trim() || composerDisabled}
                    className="ui-action-button"
                  >
                    {submitting ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </div>
            </>
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
