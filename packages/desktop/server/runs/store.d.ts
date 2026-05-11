export type DurableRunKind = 'scheduled-task' | 'conversation' | 'workflow' | 'raw-shell' | 'background-run';
export type DurableRunStatus = 'queued' | 'running' | 'recovering' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type DurableRunResumePolicy = 'rerun' | 'continue' | 'manual';
export type DurableRunRecoveryAction = 'none' | 'resume' | 'rerun' | 'attention' | 'invalid';
export interface DurableRunManifest {
    version: 1;
    id: string;
    kind: DurableRunKind;
    resumePolicy: DurableRunResumePolicy;
    createdAt: string;
    spec: Record<string, unknown>;
    parentId?: string;
    rootId?: string;
    source?: {
        type: string;
        id?: string;
        filePath?: string;
    };
}
export interface DurableRunStatusFile {
    version: 1;
    runId: string;
    status: DurableRunStatus;
    createdAt: string;
    updatedAt: string;
    activeAttempt: number;
    startedAt?: string;
    completedAt?: string;
    checkpointKey?: string;
    lastError?: string;
}
export interface DurableRunCheckpointFile {
    version: 1;
    runId: string;
    updatedAt: string;
    step?: string;
    cursor?: string;
    payload?: Record<string, unknown>;
}
export interface DurableRunEvent {
    version: 1;
    runId: string;
    timestamp: string;
    type: string;
    attempt?: number;
    payload?: Record<string, unknown>;
}
export interface DurableRunPaths {
    root: string;
    manifestPath: string;
    statusPath: string;
    checkpointPath: string;
    eventsPath: string;
    outputLogPath: string;
    resultPath: string;
}
export interface ScannedDurableRun {
    runId: string;
    paths: DurableRunPaths;
    manifest?: DurableRunManifest;
    status?: DurableRunStatusFile;
    checkpoint?: DurableRunCheckpointFile;
    result?: Record<string, unknown>;
    problems: string[];
    recoveryAction: DurableRunRecoveryAction;
}
export interface ScannedDurableRunsSummary {
    total: number;
    recoveryActions: Record<DurableRunRecoveryAction, number>;
    statuses: Partial<Record<DurableRunStatus, number>>;
}
export declare function resolveDurableRunsRoot(daemonRoot: string): string;
export declare function resolveRuntimeDbPath(daemonRoot: string): string;
export declare function resolveDurableRunPaths(runsRoot: string, runId: string): DurableRunPaths;
export declare function createDurableRunManifest(input: {
    id: string;
    kind: DurableRunKind;
    resumePolicy: DurableRunResumePolicy;
    createdAt?: string;
    spec?: Record<string, unknown>;
    parentId?: string;
    rootId?: string;
    source?: DurableRunManifest['source'];
}): DurableRunManifest;
export declare function createInitialDurableRunStatus(input: {
    runId: string;
    status?: DurableRunStatus;
    createdAt?: string;
    updatedAt?: string;
    activeAttempt?: number;
    startedAt?: string;
    completedAt?: string;
    checkpointKey?: string;
    lastError?: string;
}): DurableRunStatusFile;
export declare function saveDurableRunManifest(path: string, manifest: DurableRunManifest): void;
export declare function loadDurableRunManifest(path: string): DurableRunManifest | undefined;
export declare function saveDurableRunStatus(path: string, status: DurableRunStatusFile): void;
export declare function loadDurableRunStatus(path: string): DurableRunStatusFile | undefined;
export declare function saveDurableRunCheckpoint(path: string, checkpoint: DurableRunCheckpointFile): void;
export declare function loadDurableRunCheckpoint(path: string): DurableRunCheckpointFile | undefined;
export declare function appendDurableRunEvent(path: string, event: DurableRunEvent): Promise<void>;
export declare function readDurableRunEvents(path: string): DurableRunEvent[];
export declare function listDurableRunIds(runsRoot: string): string[];
export declare function scanDurableRun(runsRoot: string, runId: string): ScannedDurableRun | undefined;
export declare function scanDurableRunsForRecovery(runsRoot: string): ScannedDurableRun[];
export declare function summarizeScannedDurableRuns(runs: ScannedDurableRun[]): ScannedDurableRunsSummary;
