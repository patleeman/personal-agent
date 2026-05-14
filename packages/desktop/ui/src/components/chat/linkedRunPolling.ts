import { useEffect, useState } from 'react';

import { api } from '../../client/api';
import type { DurableRunDetailResult } from '../../shared/types';

export const INLINE_RUN_LOG_TAIL_LINES = 240;
export const INLINE_RUN_POLL_INTERVAL_MS = 2200;
const MAX_INLINE_RUN_LOG_TAIL_LINES = 1000;
const MAX_INLINE_RUN_POLL_INTERVAL_MS = 10_000;

export interface PolledRunSnapshotState {
  detail: DurableRunDetailResult | null;
  log: { path: string; log: string } | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  unavailable: boolean;
}

const EMPTY_POLLED_RUN_SNAPSHOT_STATE: PolledRunSnapshotState = {
  detail: null,
  log: null,
  loading: false,
  refreshing: false,
  error: null,
  unavailable: false,
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

function isDurableRunUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /run not found/i.test(message);
}

function describeDurableRunPollingError(error: unknown): { message: string; unavailable: boolean } {
  if (isDurableRunUnavailableError(error)) {
    return {
      message: 'Run record unavailable. This linked task may have been cleaned up or belongs to an older dev session.',
      unavailable: true,
    };
  }

  return {
    message: error instanceof Error ? error.message : 'Could not load run.',
    unavailable: false,
  };
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
            unavailable: false,
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
    let intervalId: number | null = null;

    const stopPolling = () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

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
          unavailable: false,
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
          unavailable: false,
        });
      } catch (error) {
        if (!cancelled) {
          const pollingError = describeDurableRunPollingError(error);
          setState((current) => ({
            ...current,
            loading: false,
            refreshing: false,
            error: pollingError.message,
            unavailable: pollingError.unavailable,
          }));

          if (pollingError.unavailable) {
            stopPolling();
          }
        }
      } finally {
        inFlight = false;
      }
    };

    void pollSnapshot(true);
    intervalId = window.setInterval(() => {
      void pollSnapshot(false);
    }, pollIntervalMs);

    return () => {
      stopPolling();
    };
  }, [enabled, pollIntervalMs, runId, tail]);

  return state;
}
