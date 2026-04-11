import {
  type ProjectActivityNotificationState,
} from '@personal-agent/core';
import type { DaemonStateSnapshot } from '../automation/daemon.js';
import { logWarn } from './logging.js';

export type InternalAttentionKind = 'deployment' | 'service';
export type MonitoredInternalService = 'daemon';

interface ClassifiedInternalServiceState {
  key: 'healthy' | 'inactive' | `issue:${string}`;
  label: string;
  details?: string;
}

export interface WriteInternalAttentionEntryInput {
  repoRoot: string;
  stateRoot?: string;
  profile: string;
  kind: InternalAttentionKind;
  summary: string;
  details?: string;
  createdAt?: string;
  notificationState?: ProjectActivityNotificationState;
  idPrefix?: string;
}

export interface ServiceAttentionMonitorOptions {
  repoRoot: string;
  stateRoot?: string;
  getCurrentProfile: () => string;
  readDaemonState: () => Promise<DaemonStateSnapshot>;
  writeEntry?: (input: WriteInternalAttentionEntryInput) => void;
  logger?: {
    warn: (message: string, fields?: Record<string, unknown>) => void;
  };
  now?: () => Date;
  intervalMs?: number;
  issueGraceMs?: number;
}

export interface ServiceAttentionMonitor {
  tick: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

const DEFAULT_MONITOR_INTERVAL_MS = 10_000;
const DEFAULT_SUPPRESSION_MS = 20_000;
const DEFAULT_ISSUE_GRACE_MS = 60_000;

const suppressedServiceAttentionUntilMs: Record<MonitoredInternalService, number> = {
  daemon: 0,
};

function buildDetails(lines: Array<string | undefined>): string | undefined {
  const filtered = lines
    .map((line) => (typeof line === 'string' ? line.trim() : undefined))
    .filter((line): line is string => typeof line === 'string' && line.length > 0);

  return filtered.length > 0 ? filtered.join('\n') : undefined;
}

function isIssueState(state: ClassifiedInternalServiceState): boolean {
  return state.key.startsWith('issue:');
}

function isSuppressed(service: MonitoredInternalService, nowMs: number): boolean {
  return suppressedServiceAttentionUntilMs[service] > nowMs;
}

function summarizeDaemonIssue(state: ClassifiedInternalServiceState): string {
  if (state.key === 'issue:offline') {
    return 'Daemon is offline.';
  }

  if (state.key === 'issue:inspection') {
    return 'Daemon status is degraded.';
  }

  return 'Daemon needs attention.';
}

function summarizeIssue(_service: MonitoredInternalService, state: ClassifiedInternalServiceState): string {
  return summarizeDaemonIssue(state);
}

function summarizeRecovery(_service: MonitoredInternalService): string {
  return 'Daemon recovered.';
}

function supportHint(_service: MonitoredInternalService): string {
  return 'Open the Daemon page for status, logs, and service controls.';
}

function buildIssueDetails(
  service: MonitoredInternalService,
  state: ClassifiedInternalServiceState,
  detectedAt: string,
): string | undefined {
  return buildDetails([
    `Detected: ${detectedAt}`,
    `State: ${state.label}`,
    state.details,
    supportHint(service),
  ]);
}

function buildRecoveryDetails(
  service: MonitoredInternalService,
  previousState: ClassifiedInternalServiceState,
  recoveredAt: string,
): string | undefined {
  return buildDetails([
    `Recovered: ${recoveredAt}`,
    `Previous state: ${previousState.label}`,
    supportHint(service),
  ]);
}

export function writeInternalAttentionEntry(_input: WriteInternalAttentionEntryInput): string {
  return '';
}

export function suppressMonitoredServiceAttention(service: MonitoredInternalService, durationMs = DEFAULT_SUPPRESSION_MS): void {
  suppressedServiceAttentionUntilMs[service] = Math.max(
    suppressedServiceAttentionUntilMs[service],
    Date.now() + Math.max(0, durationMs),
  );
}

export function clearMonitoredServiceAttentionSuppression(): void {
  suppressedServiceAttentionUntilMs.daemon = 0;
}

export function classifyDaemonAttentionState(snapshot: DaemonStateSnapshot): ClassifiedInternalServiceState {
  if (snapshot.runtime.running) {
    return {
      key: 'healthy',
      label: 'healthy',
    };
  }

  if (snapshot.service.error || snapshot.warnings.some((warning) => warning.includes('Could not inspect daemon runtime'))) {
    return {
      key: 'issue:inspection',
      label: 'inspection error',
      details: buildDetails(snapshot.warnings),
    };
  }

  if (snapshot.service.installed) {
    return {
      key: 'issue:offline',
      label: 'offline',
      details: buildDetails(snapshot.warnings),
    };
  }

  return {
    key: 'inactive',
    label: 'inactive',
  };
}

interface ServiceAttentionStateRecord {
  state: ClassifiedInternalServiceState;
  sinceMs: number;
  issueSurfaced: boolean;
}

export function createServiceAttentionMonitor(options: ServiceAttentionMonitorOptions): ServiceAttentionMonitor {
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? { warn: (message: string, fields?: Record<string, unknown>) => logWarn(message, fields) };
  const writeEntry = options.writeEntry ?? ((input: WriteInternalAttentionEntryInput) => {
    logger.warn('suppressed ownerless internal attention event', {
      profile: input.profile,
      kind: input.kind,
      summary: input.summary,
      details: input.details,
      idPrefix: input.idPrefix,
    });
  });
  const stateRecords = new Map<MonitoredInternalService, ServiceAttentionStateRecord>();
  const issueGraceMs = Math.max(0, options.issueGraceMs ?? DEFAULT_ISSUE_GRACE_MS);
  let intervalHandle: ReturnType<typeof setInterval> | undefined;

  const handleTransition = (
    service: MonitoredInternalService,
    nextState: ClassifiedInternalServiceState,
    profile: string,
  ): void => {
    const timestamp = now();
    const timestampMs = timestamp.getTime();
    const createdAt = timestamp.toISOString();
    const record = stateRecords.get(service);

    if (!record) {
      stateRecords.set(service, {
        state: nextState,
        sinceMs: timestampMs,
        issueSurfaced: false,
      });
      return;
    }

    if (record.state.key !== nextState.key) {
      if (!isSuppressed(service, timestampMs) && record.issueSurfaced && nextState.key === 'healthy') {
        writeEntry({
          repoRoot: options.repoRoot,
          stateRoot: options.stateRoot,
          profile,
          kind: 'service',
          summary: summarizeRecovery(service),
          details: buildRecoveryDetails(service, record.state, createdAt),
          createdAt,
          idPrefix: `${service}-recovery`,
        });
      }

      stateRecords.set(service, {
        state: nextState,
        sinceMs: timestampMs,
        issueSurfaced: false,
      });
      return;
    }

    if (
      isIssueState(nextState)
      && !record.issueSurfaced
      && !isSuppressed(service, timestampMs)
      && (timestampMs - record.sinceMs) >= issueGraceMs
    ) {
      writeEntry({
        repoRoot: options.repoRoot,
        stateRoot: options.stateRoot,
        profile,
        kind: 'service',
        summary: summarizeIssue(service, nextState),
        details: buildIssueDetails(service, nextState, createdAt),
        createdAt,
        idPrefix: `${service}-issue`,
      });
      record.issueSurfaced = true;
    }
  };

  const tick = async (): Promise<void> => {
    const profile = options.getCurrentProfile();

    try {
      const daemonState = await options.readDaemonState();
      handleTransition('daemon', classifyDaemonAttentionState(daemonState), profile);
    } catch (error) {
      logger.warn('internal attention daemon poll failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }

  };

  return {
    tick,
    start() {
      if (intervalHandle) {
        return;
      }

      void tick();
      intervalHandle = setInterval(() => {
        void tick();
      }, options.intervalMs ?? DEFAULT_MONITOR_INTERVAL_MS);
    },
    stop() {
      if (!intervalHandle) {
        return;
      }

      clearInterval(intervalHandle);
      intervalHandle = undefined;
    },
  };
}
