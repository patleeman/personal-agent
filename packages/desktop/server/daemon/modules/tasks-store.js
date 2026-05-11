import { existsSync, readFileSync } from 'fs';
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function toString(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function toTimestampString(value) {
    const raw = toString(value);
    if (!raw) {
        return undefined;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw)) {
        return undefined;
    }
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }
    const normalized = new Date(parsed).toISOString();
    return normalized === raw || normalized === raw.replace('Z', '.000Z') ? normalized : undefined;
}
function toBoolean(value) {
    return typeof value === 'boolean' ? value : undefined;
}
function toTaskRunStatus(value) {
    if (value === 'running' || value === 'success' || value === 'failed' || value === 'skipped') {
        return value;
    }
    return undefined;
}
function toOneTimeStatus(value) {
    if (value === 'success' || value === 'failed' || value === 'skipped') {
        return value;
    }
    return undefined;
}
function toScheduleType(value) {
    if (value === 'cron' || value === 'at') {
        return value;
    }
    return 'cron';
}
function toNonNegativeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
function parseTaskRecord(_key, value) {
    if (!isRecord(value)) {
        return undefined;
    }
    const id = toString(value.id);
    const filePath = toString(value.filePath);
    if (!id || !filePath) {
        return undefined;
    }
    return {
        id,
        filePath,
        scheduleType: toScheduleType(value.scheduleType),
        running: toBoolean(value.running) ?? false,
        runningStartedAt: toTimestampString(value.runningStartedAt),
        activeRunId: toString(value.activeRunId),
        lastRunId: toString(value.lastRunId),
        lastStatus: toTaskRunStatus(value.lastStatus),
        lastRunAt: toTimestampString(value.lastRunAt),
        lastSuccessAt: toTimestampString(value.lastSuccessAt),
        lastFailureAt: toTimestampString(value.lastFailureAt),
        lastError: toString(value.lastError),
        lastLogPath: toString(value.lastLogPath),
        lastScheduledMinute: toString(value.lastScheduledMinute),
        lastAttemptCount: toNonNegativeInteger(value.lastAttemptCount),
        oneTimeResolvedAt: toTimestampString(value.oneTimeResolvedAt),
        oneTimeResolvedStatus: toOneTimeStatus(value.oneTimeResolvedStatus),
        oneTimeCompletedAt: toTimestampString(value.oneTimeCompletedAt),
    };
}
export function createEmptyTaskState() {
    return {
        version: 1,
        tasks: {},
    };
}
export function loadTaskState(path, logger) {
    if (!existsSync(path)) {
        return createEmptyTaskState();
    }
    try {
        const raw = readFileSync(path, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed) || !isRecord(parsed.tasks)) {
            return createEmptyTaskState();
        }
        const tasks = {};
        for (const [key, value] of Object.entries(parsed.tasks)) {
            const record = parseTaskRecord(key, value);
            if (!record) {
                continue;
            }
            // Reset stale running flags after daemon restart.
            record.running = false;
            record.runningStartedAt = undefined;
            tasks[key] = record;
        }
        return {
            version: 1,
            lastEvaluatedAt: toTimestampString(parsed.lastEvaluatedAt),
            tasks,
        };
    }
    catch (error) {
        logger?.warn(`tasks state load failed at ${path}: ${error.message}`);
        return createEmptyTaskState();
    }
}
