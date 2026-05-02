import { useEffect, useState } from 'react';

import { api } from '../../client/api';
import type { DurableRunDetailResult } from '../../shared/types';

export const INLINE_RUN_LOG_TAIL_LINES = 240;
const INLINE_RUN_POLL_INTERVAL_MS = 2200;
const MAX_INLINE_RUN_LOG_TAIL_LINES = 1000;
const MAX_INLINE_RUN_POLL_INTERVAL_MS = 10_000;

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

export function normalizeInlineRunPollingOptions(options?: { tail?: number; pollIntervalMs?: number }): {
  tail: number;
  pollIntervalMs: number;
} {
  const tail =
    Number.isSafeInteger(options?.tail) && (options?.tail as number) > 0
      ? Math.min(MAX_INLINE_RUN_LOG_TAIL_LINES, options?.tail as number)
      : INLINE_RUN_LOG_TAIL_LINES;
  const pollIntervalMs =
    Number.isSafeInteger(options?.pollIntervalMs) && (options?.pollIntervalMs as number) > 0
      ? Math.min(MAX_INLINE_RUN_POLL_INTERVAL_MS, options?.pollIntervalMs as number)
      : INLINE_RUN_POLL_INTERVAL_MS;
  return { tail, pollIntervalMs };
}

export function usePolledDurableRunSnapshot(
  runId: string | null,
  enabled: boolean,
  options?: {
    tail?: number;
    pollIntervalMs?: number;
  },
): PolledRunSnapshotState {
  const { tail, pollIntervalMs } = normalizeInlineRunPollingOptions(options);
  const [state, setState] = useState<PolledRunSnapshotState>(EMPTY_POLLED_RUN_SNAPSHOT_STATE);

  useEffect(() => {
    if (!runId) {
      setState(EMPTY_POLLED_RUN_SNAPSHOT_STATE);
      return;
    }

    setState((current) =>
      current.detail?.run.runId === runId
        ? current
        : {
            detail: null,
            log: null,
            loading: false,
            refreshing: false,
            error: null,
          },
    );
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
        const [detail, log] = await Promise.all([api.durableRun(runId), api.durableRunLog(runId, tail)]);

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
