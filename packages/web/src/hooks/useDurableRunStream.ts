import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { DurableRunDetailResult, DurableRunSseEvent } from '../types';

interface DurableRunStreamState {
  detail: DurableRunDetailResult | null;
  log: { path: string; log: string } | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: DurableRunStreamState = {
  detail: null,
  log: null,
  loading: false,
  error: null,
};

export function useDurableRunStream(runId: string | null, tail = 120) {
  const [state, setState] = useState<DurableRunStreamState>(INITIAL_STATE);
  const [connectVersion, setConnectVersion] = useState(0);

  const reconnect = useCallback(() => {
    if (!runId) {
      return;
    }

    setConnectVersion((current) => current + 1);
  }, [runId]);

  useEffect(() => {
    if (!runId) {
      setState(INITIAL_STATE);
      return;
    }

    setState((current) => ({
      detail: current.detail?.run.runId === runId ? current.detail : null,
      log: current.detail?.run.runId === runId ? current.log : null,
      loading: true,
      error: null,
    }));
  }, [runId]);

  useEffect(() => {
    if (!runId) {
      return;
    }

    let closed = false;
    let stream: EventSource | null = null;

    const connect = async () => {
      try {
        const [detail, log] = await Promise.all([
          api.durableRun(runId),
          api.durableRunLog(runId, tail),
        ]);

        if (closed) {
          return;
        }

        setState({ detail, log, loading: false, error: null });
      } catch (error) {
        if (!closed) {
          setState({
            detail: null,
            log: null,
            loading: false,
            error: error instanceof Error ? error.message : 'Could not load execution.',
          });
        }
        return;
      }

      stream = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events?tail=${encodeURIComponent(String(tail))}`);
      stream.onmessage = (event: MessageEvent<string>) => {
        if (closed) {
          return;
        }

        let payload: DurableRunSseEvent;
        try {
          payload = JSON.parse(event.data) as DurableRunSseEvent;
        } catch {
          return;
        }

        if (payload.type === 'snapshot') {
          setState({ detail: payload.detail, log: payload.log, loading: false, error: null });
          return;
        }

        if (payload.type === 'deleted') {
          setState({ detail: null, log: null, loading: false, error: `Execution no longer exists: ${payload.runId}` });
          stream?.close();
          return;
        }

        if (payload.type === 'error') {
          setState((current) => ({ ...current, loading: false, error: payload.message }));
        }
      };

      stream.onerror = () => {
        if (closed) {
          return;
        }

        if (stream?.readyState === EventSource.CLOSED) {
          setState((current) => current.detail
            ? current
            : { ...current, loading: false, error: current.error ?? 'Live execution updates are offline.' });
        }
      };
    };

    void connect();

    return () => {
      closed = true;
      stream?.close();
    };
  }, [connectVersion, runId, tail]);

  return { ...state, reconnect };
}
