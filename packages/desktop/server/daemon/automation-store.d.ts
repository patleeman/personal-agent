import { type ParsedTaskDefinition } from './modules/tasks-parser.js';
import { type TaskRuntimeState } from './modules/tasks-store.js';
export type AutomationThreadMode = 'dedicated' | 'existing' | 'none';
export type AutomationTargetType = 'background-agent' | 'conversation';
export type AutomationConversationBehavior = 'steer' | 'followUp';
export declare const DEFAULT_CRON_CATCH_UP_WINDOW_SECONDS: number;
export interface StoredAutomation extends ParsedTaskDefinition {
    runtimeScope: string;
    title: string;
    targetType: AutomationTargetType;
    conversationBehavior?: AutomationConversationBehavior;
    catchUpWindowSeconds?: number;
    createdAt: string;
    updatedAt: string;
    legacyFilePath?: string;
    threadMode: AutomationThreadMode;
    threadSessionFile?: string;
    threadConversationId?: string;
}
export interface LegacyAutomationImportIssue {
    filePath: string;
    error: string;
}
export interface AutomationMutationInput {
    id?: string;
    runtimeScope?: string;
    /** @deprecated Legacy input accepted during migration; ignored and normalized to shared. */
    profile?: string;
    title: string;
    enabled?: boolean;
    cron?: string | null;
    at?: string | null;
    modelRef?: string | null;
    thinkingLevel?: string | null;
    cwd?: string | null;
    timeoutSeconds?: number | null;
    catchUpWindowSeconds?: number | null;
    prompt: string;
    targetType?: AutomationTargetType | null;
    conversationBehavior?: AutomationConversationBehavior | null;
}
export interface AutomationSchedulerState {
    lastEvaluatedAt?: string;
}
export type AutomationActivityKind = 'missed' | 'run-failed';
export type AutomationActivityOutcome = 'skipped' | 'catch-up-started';
interface AutomationMissedActivityEntry {
    id: string;
    automationId: string;
    kind: 'missed';
    createdAt: string;
    count: number;
    firstScheduledAt: string;
    lastScheduledAt: string;
    exampleScheduledAt: string[];
    outcome: AutomationActivityOutcome;
}
interface AutomationRunFailedActivityEntry {
    id: string;
    automationId: string;
    kind: 'run-failed';
    createdAt: string;
    message: string;
}
export type AutomationActivityEntry = AutomationMissedActivityEntry | AutomationRunFailedActivityEntry;
export type AutomationActivityEntryInput = Omit<AutomationMissedActivityEntry, 'id' | 'automationId'> | Omit<AutomationRunFailedActivityEntry, 'id' | 'automationId'>;
export declare function closeAutomationDbs(): void;
export declare function normalizeAutomationTargetTypeForSelection(value: string | null | undefined): AutomationTargetType;
export declare function getAutomationDbPath(config?: import("./config.js").DaemonConfig): string;
export declare function listStoredAutomations(options?: {
    runtimeScope?: string;
    profile?: string;
    dbPath?: string;
}): StoredAutomation[];
export declare function getStoredAutomation(id: string, options?: {
    runtimeScope?: string;
    profile?: string;
    dbPath?: string;
}): StoredAutomation | undefined;
export declare function createStoredAutomation(input: AutomationMutationInput & {
    dbPath?: string;
}): StoredAutomation;
export declare function updateStoredAutomation(id: string, input: Partial<Omit<AutomationMutationInput, 'id' | 'profile' | 'runtimeScope'>> & {
    runtimeScope?: string;
    profile?: string;
    dbPath?: string;
}): StoredAutomation;
export declare function setStoredAutomationThreadBinding(id: string, input: {
    mode: AutomationThreadMode;
    conversationId?: string | null;
    sessionFile?: string | null;
    dbPath?: string;
}): StoredAutomation;
export declare function deleteStoredAutomation(id: string, options?: {
    runtimeScope?: string;
    profile?: string;
    dbPath?: string;
}): boolean;
export declare function loadAutomationRuntimeStateMap(options?: {
    dbPath?: string;
}): Record<string, TaskRuntimeState>;
export declare function loadAutomationSchedulerState(options?: {
    dbPath?: string;
}): AutomationSchedulerState;
export declare function saveAutomationSchedulerState(state: AutomationSchedulerState, options?: {
    dbPath?: string;
}): void;
export declare function saveAutomationRuntimeStateMap(state: Record<string, TaskRuntimeState>, options?: {
    dbPath?: string;
}): void;
export declare function listAutomationActivityEntries(automationId: string, options?: {
    limit?: number;
    dbPath?: string;
}): AutomationActivityEntry[];
export declare function appendAutomationActivityEntry(automationId: string, input: AutomationActivityEntryInput, options?: {
    dbPath?: string;
}): AutomationActivityEntry;
export declare function ensureLegacyTaskImports(options: {
    taskDir: string;
    defaultTimeoutSeconds: number;
    dbPath?: string;
    legacyStateFile?: string;
}): {
    importedCount: number;
    parseErrors: LegacyAutomationImportIssue[];
};
export {};
