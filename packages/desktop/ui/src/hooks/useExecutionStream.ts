import { useCallback, useEffect, useState } from 'react';

import { api } from '../client/api';
import { addNotification } from '../components/notifications/notificationStore';
import { createDesktopAwareEventSource, type EventSourceLike } from '../desktop/desktopEventSource';
import type { ExecutionDetailResult } from '../shared/types';

interface ExecutionStreamState {
  detail: ExecutionDetailResult | null;
  log: { path: string; log: string } | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: ExecutionStreamState = {
  detail: null,
  log: null,
  loading: false,
  error: null,
};

type ExecutionSseEvent =
  | { type: 'snapshot'; detail: ExecutionDetailResult; log: { path: string; log: string } }
  | { type: 'detail'; detail: ExecutionDetailResult }
  | { type: 'log'; log: { path: string; log: string } }
  | { type: 'log_delta'; path: string; delta: string }
  | { type: 'deleted'; executionId: string }
  | { type: 'error'; message: string };

export function useExecutionStream(executionId: string | null, tail = 120) {
  const [state, setState] = useState<ExecutionStreamState>(INITIAL_STATE);
  const [connectVersion, setConnectVersion] = useState(0);

  const reconnect = useCallback(() => {
    if (executionId) setConnectVersion((current) => current + 1);
  }, [executionId]);

  useEffect(() => {
    if (!executionId) {
      setState(INITIAL_STATE);
      return;
    }

    setState((current) => ({
      detail: current.detail?.execution.id === executionId ? current.detail : null,
      log: current.detail?.execution.id === executionId ? current.log : null,
      loading: true,
      error: null,
    }));
  }, [executionId]);

  useEffect(() => {
    if (!executionId) return;

    let closed = false;
    let stream: EventSourceLike | null = null;

    const connect = async () => {
      try {
        const [detail, log] = await Promise.all([api.execution(executionId), api.executionLog(executionId, tail)]);
        if (closed) return;
        setState({ detail, log, loading: false, error: null });
      } catch (error) {
        if (!closed) {
          const msg = error instanceof Error ? error.message : 'Could not load execution.';
          setState({ detail: null, log: null, loading: false, error: msg });
          addNotification({
            type: 'error',
            message: `Failed to load execution: ${msg}`,
            details: error instanceof Error ? error.stack : undefined,
            source: 'core',
          });
        }
        return;
      }

      stream = createDesktopAwareEventSource(
        `/api/executions/${encodeURIComponent(executionId)}/events?tail=${encodeURIComponent(String(tail))}`,
      );
      stream.onmessage = (event: MessageEvent<string>) => {
        if (closed) return;

        let payload: ExecutionSseEvent;
        try {
          payload = JSON.parse(event.data) as ExecutionSseEvent;
        } catch {
          return;
        }

        if (payload.type === 'snapshot') {
          setState({ detail: payload.detail, log: payload.log, loading: false, error: null });
          return;
        }

        if (payload.type === 'detail') {
          setState((current) => ({ ...current, detail: payload.detail, loading: false, error: null }));
          return;
        }

        if (payload.type === 'log') {
          setState((current) => ({ ...current, log: payload.log, loading: false, error: null }));
          return;
        }

        if (payload.type === 'log_delta') {
          if (!payload.delta) return;
          setState((current) => ({
            ...current,
            log:
              current.log?.path === payload.path
                ? { path: current.log.path, log: `${current.log.log}${payload.delta}` }
                : { path: payload.path, log: payload.delta },
            loading: false,
            error: null,
          }));
          return;
        }

        if (payload.type === 'deleted') {
          setState({ detail: null, log: null, loading: false, error: `Execution no longer exists: ${payload.executionId}` });
          stream?.close();
          return;
        }

        if (payload.type === 'error') {
          setState((current) => ({ ...current, loading: false, error: payload.message }));
          addNotification({ type: 'warning', message: `Execution stream error: ${payload.message}`, source: 'core' });
        }
      };

      stream.onerror = () => {
        if (closed) return;
        if (stream?.readyState === EventSource.CLOSED) {
          setState((current) =>
            current.detail ? current : { ...current, loading: false, error: current.error ?? 'Live execution updates are offline.' },
          );
        }
      };
    };

    void connect();

    return () => {
      closed = true;
      stream?.close();
    };
  }, [connectVersion, executionId, tail]);

  return { ...state, reconnect };
}
