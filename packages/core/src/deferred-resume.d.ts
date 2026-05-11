export declare const DEFERRED_RESUME_STATE_FILE_NAME = "deferred-resumes-state.json";
export type DeferredResumeStatus = 'scheduled' | 'ready';
export type DeferredResumeKind = 'continue' | 'reminder' | 'task-callback';
export type DeferredResumeAlertLevel = 'none' | 'passive' | 'disruptive';
export type DeferredResumeBehavior = 'steer' | 'followUp';
export interface DeferredResumeDelivery {
    alertLevel: DeferredResumeAlertLevel;
    autoResumeIfOpen: boolean;
    requireAck: boolean;
}
export interface DeferredResumeSource {
    kind: string;
    id?: string;
}
export interface DeferredResumeRecord {
    id: string;
    sessionFile: string;
    prompt: string;
    dueAt: string;
    createdAt: string;
    attempts: number;
    status: DeferredResumeStatus;
    kind: DeferredResumeKind;
    title?: string;
    behavior?: DeferredResumeBehavior;
    delivery: DeferredResumeDelivery;
    source?: DeferredResumeSource;
    readyAt?: string;
}
export interface DeferredResumeStateFile {
    version: 3;
    resumes: Record<string, DeferredResumeRecord>;
}
export declare function parseDeferredResumeDelayMs(raw: string): number | undefined;
export declare function mergeDeferredResumeStateDocuments(options: {
    documents: unknown[];
}): DeferredResumeStateFile;
export declare function createEmptyDeferredResumeState(): DeferredResumeStateFile;
export declare function resolveDeferredResumeStateFile(stateRoot?: string): string;
export declare function loadDeferredResumeState(path?: string): DeferredResumeStateFile;
export declare function saveDeferredResumeState(state: DeferredResumeStateFile, path?: string): void;
export declare function loadDeferredResumeEntries(stateFile?: string): Array<{
    sessionFile: string;
}>;
export declare function listDeferredResumeRecords(state: DeferredResumeStateFile): DeferredResumeRecord[];
export declare function getSessionDeferredResumeEntries(state: DeferredResumeStateFile, sessionFile: string): DeferredResumeRecord[];
export declare function getReadySessionDeferredResumeEntries(state: DeferredResumeStateFile, sessionFile: string): DeferredResumeRecord[];
export declare function getDueScheduledSessionDeferredResumeEntries(state: DeferredResumeStateFile, sessionFile: string, at?: Date): DeferredResumeRecord[];
export declare function activateDeferredResume(state: DeferredResumeStateFile, input: {
    id: string;
    at?: Date;
}): DeferredResumeRecord | undefined;
export declare function activateDueDeferredResumes(state: DeferredResumeStateFile, input?: {
    at?: Date;
    sessionFile?: string;
}): DeferredResumeRecord[];
export declare function scheduleDeferredResume(state: DeferredResumeStateFile, entry: Omit<DeferredResumeRecord, 'status' | 'readyAt' | 'kind' | 'delivery'> & {
    kind?: DeferredResumeKind;
    delivery?: Partial<DeferredResumeDelivery>;
}): DeferredResumeRecord;
export declare function createReadyDeferredResume(state: DeferredResumeStateFile, entry: Omit<DeferredResumeRecord, 'status' | 'readyAt' | 'kind' | 'delivery'> & {
    readyAt?: string;
    kind?: DeferredResumeKind;
    delivery?: Partial<DeferredResumeDelivery>;
}): DeferredResumeRecord;
export declare function removeDeferredResume(state: DeferredResumeStateFile, id: string): boolean;
export declare function retryDeferredResume(state: DeferredResumeStateFile, input: {
    id: string;
    dueAt: string;
}): DeferredResumeRecord | undefined;
export declare function readSessionConversationId(sessionFile: string): string | undefined;
