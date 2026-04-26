import { useEffect, useState } from 'react';
import { api } from '../../client/api';
import type { DurableRunDetailResult } from '../../shared/types';

export const INLINE_RUN_LOG_TAIL_LINES = 240;
export const INLINE_RUN_POLL_INTERVAL_MS = 2200;

export interface PolledRunSnapshotState {
  detail: DurableRunDetailResult | null;
  log: { path: string; log: string } | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

const EMPTY_POLLED_RUN_SNAPSHOT_STATE: PolledRunSnapshotState = {
  detail: null,
  log: null,
  loading: false,
  refreshing: false,
  error: null,
};

export function buildInlineRunExpansionKey(clusterStartIndex: number, runId: string): string {
  return `${clusterStartIndex}:${runId}`;
}

export function usePolledDurableRunSnapshot(
  runId: string | null,
  enabled: boolean,
  options?: {
    tail?: number;
    pollIntervalMs?: number;
  },
): PolledRunSnapshotState {
  const tail = options?.tail ?? INLINE_RUN_LOG_TAIL_LINES;
  const pollIntervalMs = options?.pollIntervalMs ?? INLINE_RUN_POLL_INTERVAL_MS;
  const [state, setState] = useState<PolledRunSnapshotState>(EMPTY_POLLED_RUN_SNAPSHOT_STATE);

  useEffect(() => {
    if (!runId) {
      setState(EMPTY_POLLED_RUN_SNAPSHOT_STATE);
      return;
    }

    setState((current) => (
      current.detail?.run.runId === runId
        ? current
        : {
            detail: null,
            log: null,
            loading: false,
            refreshing: false,
            error: null,
          }
    ));
  }, [runId]);

  useEffect(() => {
    if (!runId || !enabled) {
      setState((current) => ({ ...current, loading: false, refreshing: false }));
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const pollSnapshot = async (initial: boolean) => {
      if (cancelled || inFlight) {
        return;
      }

      inFlight = true;
      setState((current) => {
        const hasDetail = current.detail?.run.runId === runId;
        return {
          ...current,
          loading: initial && !hasDetail,
          refreshing: !initial && hasDetail,
          error: initial ? null : current.error,
        };
      });

      try {
        const [detail, log] = await Promise.all([
          api.durableRun(runId),
          api.durableRunLog(runId, tail),
        ]);

        if (cancelled) {
          return;
        }

        setState({
          detail,
          log,
          loading: false,
          refreshing: false,
          error: null,
        });
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Could not load run.';
          setState((current) => ({
            ...current,
            loading: false,
            refreshing: false,
            error: message,
          }));
        }
      } finally {
        inFlight = false;
      }
    };

    void pollSnapshot(true);
    const intervalId = window.setInterval(() => {
      void pollSnapshot(false);
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enabled, pollIntervalMs, runId, tail]);

  return state;
}
