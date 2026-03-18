import {
  createProjectActivityEntry,
  writeProfileActivityEntry,
  type ProjectActivityNotificationState,
} from '@personal-agent/core';
import type { DaemonStateSnapshot } from './daemon.js';
import type { GatewayStateSnapshot } from './gateway.js';
import { logWarn } from './logging.js';

export type InternalAttentionKind = 'deployment' | 'service';
export type MonitoredInternalService = 'daemon' | 'gateway';

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
  readGatewayState: (profile: string) => GatewayStateSnapshot;
  writeEntry?: (input: WriteInternalAttentionEntryInput) => void;
  logger?: {
    warn: (message: string, fields?: Record<string, unknown>) => void;
  };
  now?: () => Date;
  intervalMs?: number;
}

export interface ServiceAttentionMonitor {
  tick: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

const DEFAULT_MONITOR_INTERVAL_MS = 10_000;
const DEFAULT_SUPPRESSION_MS = 20_000;

const suppressedServiceAttentionUntilMs: Record<MonitoredInternalService, number> = {
  daemon: 0,
  gateway: 0,
};

function sanitizeActivityIdSegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return normalized.length > 0 ? normalized : 'item';
}

function buildInternalActivityId(prefix: string, createdAt: string, summary: string): string {
  const timestampKey = createdAt.replace(/[:.]/g, '-');
  return [
    prefix,
    sanitizeActivityIdSegment(timestampKey),
    sanitizeActivityIdSegment(summary).slice(0, 48),
  ].join('-');
}

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

function summarizeGatewayIssue(state: ClassifiedInternalServiceState): string {
  if (state.key === 'issue:offline') {
    return 'Gateway is offline.';
  }

  if (state.key === 'issue:misconfigured') {
    return 'Gateway is not configured.';
  }

  if (state.key === 'issue:inspection') {
    return 'Gateway status is degraded.';
  }

  return 'Gateway needs attention.';
}

function summarizeIssue(service: MonitoredInternalService, state: ClassifiedInternalServiceState): string {
  return service === 'daemon'
    ? summarizeDaemonIssue(state)
    : summarizeGatewayIssue(state);
}

function summarizeRecovery(service: MonitoredInternalService): string {
  return service === 'daemon'
    ? 'Daemon recovered.'
    : 'Gateway recovered.';
}

function supportHint(service: MonitoredInternalService): string {
  return service === 'daemon'
    ? 'Open the Daemon page for status, logs, and service controls.'
    : 'Open the Gateway page for status, logs, and configuration.';
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

function gatewayTokenMissing(snapshot: GatewayStateSnapshot): boolean {
  return snapshot.warnings.some((warning) => warning.includes('Telegram bot token is not configured'));
}

export function writeInternalAttentionEntry(input: WriteInternalAttentionEntryInput): string {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const idPrefix = input.idPrefix ?? input.kind;

  return writeProfileActivityEntry({
    stateRoot: input.stateRoot,
    repoRoot: input.repoRoot,
    profile: input.profile,
    entry: createProjectActivityEntry({
      id: buildInternalActivityId(idPrefix, createdAt, input.summary),
      createdAt,
      profile: input.profile,
      kind: input.kind,
      summary: input.summary,
      details: input.details,
      notificationState: input.notificationState ?? 'none',
    }),
  });
}

export function suppressMonitoredServiceAttention(service: MonitoredInternalService, durationMs = DEFAULT_SUPPRESSION_MS): void {
  suppressedServiceAttentionUntilMs[service] = Math.max(
    suppressedServiceAttentionUntilMs[service],
    Date.now() + Math.max(0, durationMs),
  );
}

export function clearMonitoredServiceAttentionSuppression(): void {
  suppressedServiceAttentionUntilMs.daemon = 0;
  suppressedServiceAttentionUntilMs.gateway = 0;
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

export function classifyGatewayAttentionState(snapshot: GatewayStateSnapshot): ClassifiedInternalServiceState {
  if (snapshot.service.error) {
    return {
      key: 'issue:inspection',
      label: 'inspection error',
      details: buildDetails(snapshot.warnings),
    };
  }

  if (!snapshot.service.installed) {
    return {
      key: 'inactive',
      label: 'inactive',
    };
  }

  if (!snapshot.service.running) {
    return {
      key: 'issue:offline',
      label: 'offline',
      details: buildDetails(snapshot.warnings),
    };
  }

  if (gatewayTokenMissing(snapshot)) {
    return {
      key: 'issue:misconfigured',
      label: 'token missing',
      details: buildDetails(snapshot.warnings),
    };
  }

  return {
    key: 'healthy',
    label: 'healthy',
  };
}

export function createServiceAttentionMonitor(options: ServiceAttentionMonitorOptions): ServiceAttentionMonitor {
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? { warn: (message: string, fields?: Record<string, unknown>) => logWarn(message, fields) };
  const writeEntry = options.writeEntry ?? ((input: WriteInternalAttentionEntryInput) => {
    writeInternalAttentionEntry(input);
  });
  const previousStates = new Map<MonitoredInternalService, ClassifiedInternalServiceState>();
  let intervalHandle: ReturnType<typeof setInterval> | undefined;

  const handleTransition = (
    service: MonitoredInternalService,
    nextState: ClassifiedInternalServiceState,
    profile: string,
  ): void => {
    const previousState = previousStates.get(service);
    previousStates.set(service, nextState);

    if (!previousState || previousState.key === nextState.key) {
      return;
    }

    const timestamp = now();
    const createdAt = timestamp.toISOString();

    if (isSuppressed(service, timestamp.getTime())) {
      return;
    }

    const previousWasIssue = isIssueState(previousState);
    const nextIsIssue = isIssueState(nextState);

    if (nextIsIssue) {
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
      return;
    }

    if (previousWasIssue && nextState.key === 'healthy') {
      writeEntry({
        repoRoot: options.repoRoot,
        stateRoot: options.stateRoot,
        profile,
        kind: 'service',
        summary: summarizeRecovery(service),
        details: buildRecoveryDetails(service, previousState, createdAt),
        createdAt,
        idPrefix: `${service}-recovery`,
      });
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

    try {
      const gatewayState = options.readGatewayState(profile);
      handleTransition('gateway', classifyGatewayAttentionState(gatewayState), profile);
    } catch (error) {
      logger.warn('internal attention gateway poll failed', {
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
