import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '../client/api';
import { DESKTOP_CONVERSATION_STATE_EVENT, getDesktopBridge, readDesktopEnvironment } from '../desktop/desktopBridge';
import type { DesktopConversationState, PromptAttachmentRefInput, PromptImageInput } from '../shared/types';
import { detectConversationSurfaceType, getOrCreateConversationSurfaceId } from './useSessionStream';

type DesktopConversationStateEnvelope = {
  subscriptionId: string;
  event: {
    type: 'open' | 'state' | 'error' | 'close';
    state?: DesktopConversationState;
    message?: string;
  };
};

const MAX_DESKTOP_CONVERSATION_STATE_TAIL_BLOCKS = 1000;

export function normalizeDesktopConversationStateTailBlocks(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(MAX_DESKTOP_CONVERSATION_STATE_TAIL_BLOCKS, value)
    : undefined;
}

function mergeDesktopConversationState(
  previous: DesktopConversationState | null,
  next: DesktopConversationState,
): DesktopConversationState {
  const previousCwdChange = previous?.conversationId === next.conversationId ? previous.stream.cwdChange : null;

  if (!previousCwdChange || next.stream.cwdChange) {
    return next;
  }

  return {
    ...next,
    stream: {
      ...next.stream,
      cwdChange: previousCwdChange,
    },
  };
}

export function useDesktopConversationState(conversationId: string | null, options?: { tailBlocks?: number; enabled?: boolean }) {
  const enabled = options?.enabled !== false && Boolean(conversationId);
  const bridge = getDesktopBridge();
  const surfaceId = useMemo(() => getOrCreateConversationSurfaceId(), []);
  const surfaceType = useMemo(() => detectConversationSurfaceType(), []);
  const [mode, setMode] = useState<'checking' | 'local' | 'inactive'>(enabled && bridge ? 'checking' : 'inactive');
  const [state, setState] = useState<DesktopConversationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectVersion, setConnectVersion] = useState(0);
  const [subscriptionVersion, setSubscriptionVersion] = useState(0);
  const matchedState = state?.conversationId === conversationId ? state : null;

  useEffect(() => {
    if (!enabled || !bridge) {
      setMode('inactive');
      setState(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setMode('checking');
    void readDesktopEnvironment()
      .then((environment) => {
        if (cancelled) {
          return;
        }

        setMode(environment?.activeHostKind === 'local' ? 'local' : 'inactive');
      })
      .catch(() => {
        if (!cancelled) {
          setMode('inactive');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [bridge, enabled, connectVersion]);

  useEffect(() => {
    if (!bridge || mode !== 'local' || !conversationId) {
      return;
    }

    let closed = false;
    let subscriptionId: string | null = null;
    const pendingEvents: DesktopConversationStateEnvelope[] = [];
    setState(null);
    setError(null);

    const handleEnvelope = (detail: DesktopConversationStateEnvelope) => {
      switch (detail.event.type) {
        case 'open':
          setError(null);
          return;
        case 'state':
          if (detail.event.state) {
            setState((previous) => mergeDesktopConversationState(previous, detail.event.state as DesktopConversationState));
            setError(null);
          }
          return;
        case 'error':
          setError(detail.event.message ?? 'Conversation state subscription failed.');
          return;
        case 'close':
          return;
      }
    };

    const replayPendingEvents = () => {
      if (!subscriptionId || pendingEvents.length === 0) {
        pendingEvents.length = 0;
        return;
      }

      const queued = pendingEvents.splice(0, pendingEvents.length);
      for (const detail of queued) {
        if (detail.subscriptionId === subscriptionId) {
          handleEnvelope(detail);
        }
      }
    };

    const handleStateEvent = (event: Event) => {
      const detail = (event as CustomEvent<DesktopConversationStateEnvelope>).detail;
      if (!detail || closed) {
        return;
      }

      if (!subscriptionId) {
        pendingEvents.push(detail);
        return;
      }

      if (detail.subscriptionId !== subscriptionId) {
        return;
      }

      handleEnvelope(detail);
    };

    window.addEventListener(DESKTOP_CONVERSATION_STATE_EVENT, handleStateEvent as EventListener);

    const tailBlocks = normalizeDesktopConversationStateTailBlocks(options?.tailBlocks);
    void bridge
      .subscribeConversationState({
        conversationId,
        ...(tailBlocks !== undefined ? { tailBlocks } : {}),
        surfaceId,
        surfaceType,
      })
      .then((result) => {
        if (closed) {
          void bridge.unsubscribeConversationState(result.subscriptionId).catch(() => {});
          return;
        }

        subscriptionId = result.subscriptionId;
        replayPendingEvents();
      })
      .catch((nextError) => {
        if (!closed) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      });

    return () => {
      closed = true;
      pendingEvents.length = 0;
      window.removeEventListener(DESKTOP_CONVERSATION_STATE_EVENT, handleStateEvent as EventListener);
      if (subscriptionId) {
        void bridge.unsubscribeConversationState(subscriptionId).catch(() => {});
      }
    };
  }, [bridge, conversationId, mode, options?.tailBlocks, subscriptionVersion, surfaceId, surfaceType]);

  const reconnect = useCallback(() => {
    if (mode === 'local') {
      setSubscriptionVersion((current) => current + 1);
      return;
    }

    setConnectVersion((current) => current + 1);
  }, [mode]);

  const send = useCallback(
    async (
      text: string,
      behavior?: 'steer' | 'followUp',
      images?: PromptImageInput[],
      attachmentRefs?: PromptAttachmentRefInput[],
      contextMessages?: Array<{ customType: string; content: string }>,
      relatedConversationIds?: string[],
    ) => {
      if (!conversationId) {
        return;
      }

      return await api.promptSession(
        conversationId,
        text,
        behavior,
        images,
        attachmentRefs,
        surfaceId,
        contextMessages,
        relatedConversationIds,
      );
    },
    [conversationId, surfaceId],
  );

  const parallel = useCallback(
    async (
      text: string,
      images?: PromptImageInput[],
      attachmentRefs?: PromptAttachmentRefInput[],
      contextMessages?: Array<{ customType: string; content: string }>,
      relatedConversationIds?: string[],
    ) => {
      if (!conversationId) {
        return;
      }

      return await api.parallelPromptSession(
        conversationId,
        text,
        images,
        attachmentRefs,
        surfaceId,
        contextMessages,
        relatedConversationIds,
      );
    },
    [conversationId, surfaceId],
  );

  const manageParallelJob = useCallback(
    async (jobId: string, action: 'importNow' | 'skip' | 'cancel') => {
      if (!conversationId) {
        return;
      }

      return api.manageParallelPromptJob(conversationId, jobId, action, surfaceId);
    },
    [conversationId, surfaceId],
  );

  const abort = useCallback(async () => {
    if (!conversationId) {
      return;
    }

    await api.abortSession(conversationId, surfaceId);
  }, [conversationId, surfaceId]);

  const takeover = useCallback(async () => {
    if (!conversationId) {
      return;
    }

    await api.takeoverLiveSession(conversationId, surfaceId);
  }, [conversationId, surfaceId]);

  return {
    mode,
    active: mode === 'local',
    loading: mode === 'checking' || (mode === 'local' && matchedState === null),
    state: matchedState,
    error,
    surfaceId,
    reconnect,
    send,
    parallel,
    manageParallelJob,
    abort,
    takeover,
  };
}
