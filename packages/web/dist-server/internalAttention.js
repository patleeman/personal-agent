import { createProjectActivityEntry, writeProfileActivityEntry, } from '@personal-agent/core';
import { logWarn } from './logging.js';
const DEFAULT_MONITOR_INTERVAL_MS = 10_000;
const DEFAULT_SUPPRESSION_MS = 20_000;
const suppressedServiceAttentionUntilMs = {
    daemon: 0,
    gateway: 0,
};
function sanitizeActivityIdSegment(value) {
    const normalized = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
    return normalized.length > 0 ? normalized : 'item';
}
function buildInternalActivityId(prefix, createdAt, summary) {
    const timestampKey = createdAt.replace(/[:.]/g, '-');
    return [
        prefix,
        sanitizeActivityIdSegment(timestampKey),
        sanitizeActivityIdSegment(summary).slice(0, 48),
    ].join('-');
}
function buildDetails(lines) {
    const filtered = lines
        .map((line) => (typeof line === 'string' ? line.trim() : undefined))
        .filter((line) => Boolean(line) && line.length > 0);
    return filtered.length > 0 ? filtered.join('\n') : undefined;
}
function isIssueState(state) {
    return state.key.startsWith('issue:');
}
function isSuppressed(service, nowMs) {
    return suppressedServiceAttentionUntilMs[service] > nowMs;
}
function summarizeDaemonIssue(state) {
    if (state.key === 'issue:offline') {
        return 'Daemon is offline.';
    }
    if (state.key === 'issue:inspection') {
        return 'Daemon status is degraded.';
    }
    return 'Daemon needs attention.';
}
function summarizeGatewayIssue(state) {
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
function summarizeIssue(service, state) {
    return service === 'daemon'
        ? summarizeDaemonIssue(state)
        : summarizeGatewayIssue(state);
}
function summarizeRecovery(service) {
    return service === 'daemon'
        ? 'Daemon recovered.'
        : 'Gateway recovered.';
}
function supportHint(service) {
    return service === 'daemon'
        ? 'Open the Daemon page for status, logs, and service controls.'
        : 'Open the Gateway page for status, logs, and configuration.';
}
function buildIssueDetails(service, state, detectedAt) {
    return buildDetails([
        `Detected: ${detectedAt}`,
        `State: ${state.label}`,
        state.details,
        supportHint(service),
    ]);
}
function buildRecoveryDetails(service, previousState, recoveredAt) {
    return buildDetails([
        `Recovered: ${recoveredAt}`,
        `Previous state: ${previousState.label}`,
        supportHint(service),
    ]);
}
function gatewayTokenMissing(snapshot) {
    return snapshot.warnings.some((warning) => warning.includes('Telegram bot token is not configured'));
}
export function writeInternalAttentionEntry(input) {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const idPrefix = input.idPrefix ?? input.kind;
    return writeProfileActivityEntry({
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
export function suppressMonitoredServiceAttention(service, durationMs = DEFAULT_SUPPRESSION_MS) {
    suppressedServiceAttentionUntilMs[service] = Math.max(suppressedServiceAttentionUntilMs[service], Date.now() + Math.max(0, durationMs));
}
export function clearMonitoredServiceAttentionSuppression() {
    suppressedServiceAttentionUntilMs.daemon = 0;
    suppressedServiceAttentionUntilMs.gateway = 0;
}
export function classifyDaemonAttentionState(snapshot) {
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
export function classifyGatewayAttentionState(snapshot) {
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
export function createServiceAttentionMonitor(options) {
    const now = options.now ?? (() => new Date());
    const logger = options.logger ?? { warn: (message, fields) => logWarn(message, fields) };
    const writeEntry = options.writeEntry ?? ((input) => {
        writeInternalAttentionEntry(input);
    });
    const previousStates = new Map();
    let intervalHandle;
    const handleTransition = (service, nextState, profile) => {
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
                profile,
                kind: 'service',
                summary: summarizeRecovery(service),
                details: buildRecoveryDetails(service, previousState, createdAt),
                createdAt,
                idPrefix: `${service}-recovery`,
            });
        }
    };
    const tick = async () => {
        const profile = options.getCurrentProfile();
        try {
            const daemonState = await options.readDaemonState();
            handleTransition('daemon', classifyDaemonAttentionState(daemonState), profile);
        }
        catch (error) {
            logger.warn('internal attention daemon poll failed', {
                message: error instanceof Error ? error.message : String(error),
            });
        }
        try {
            const gatewayState = options.readGatewayState(profile);
            handleTransition('gateway', classifyGatewayAttentionState(gatewayState), profile);
        }
        catch (error) {
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
