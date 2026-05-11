type TaskRunStatus = 'running' | 'success' | 'failed' | 'skipped';
export interface TaskRuntimeState {
    id: string;
    filePath: string;
    scheduleType: 'cron' | 'at';
    running: boolean;
    runningStartedAt?: string;
    activeRunId?: string;
    lastRunId?: string;
    lastStatus?: TaskRunStatus;
    lastRunAt?: string;
    lastSuccessAt?: string;
    lastFailureAt?: string;
    lastError?: string;
    lastLogPath?: string;
    lastScheduledMinute?: string;
    lastAttemptCount?: number;
    oneTimeResolvedAt?: string;
    oneTimeResolvedStatus?: 'success' | 'failed' | 'skipped';
    oneTimeCompletedAt?: string;
}
export interface TaskStateFile {
    version: 1;
    lastEvaluatedAt?: string;
    tasks: Record<string, TaskRuntimeState>;
}
export declare function createEmptyTaskState(): TaskStateFile;
export declare function loadTaskState(path: string, logger?: {
    warn: (message: string) => void;
}): TaskStateFile;
export {};
