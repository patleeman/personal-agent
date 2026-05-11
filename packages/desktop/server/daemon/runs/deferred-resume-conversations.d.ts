import { type DurableRunPaths } from './store.js';
interface DeferredResumeConversationRunInput {
    daemonRoot: string;
    deferredResumeId: string;
    sessionFile: string;
    prompt: string;
    dueAt: string;
    createdAt?: string;
    readyAt?: string;
    profile?: string;
    cwd?: string;
    conversationId?: string;
}
interface DeferredResumeConversationRunResult {
    runId: string;
    paths: DurableRunPaths;
}
export declare function createDeferredResumeConversationRunId(deferredResumeId: string): string;
export declare function scheduleDeferredResumeConversationRun(input: DeferredResumeConversationRunInput): Promise<DeferredResumeConversationRunResult>;
export declare function markDeferredResumeConversationRunReady(input: DeferredResumeConversationRunInput & {
    readyAt: string;
}): Promise<DeferredResumeConversationRunResult>;
export declare function markDeferredResumeConversationRunRetryScheduled(input: DeferredResumeConversationRunInput & {
    retryAt: string;
    lastError: string;
}): Promise<DeferredResumeConversationRunResult>;
export declare function markDeferredResumeConversationRunSnoozed(input: DeferredResumeConversationRunInput & {
    snoozedUntil: string;
}): Promise<DeferredResumeConversationRunResult>;
export declare function completeDeferredResumeConversationRun(input: DeferredResumeConversationRunInput & {
    completedAt: string;
}): Promise<DeferredResumeConversationRunResult>;
export declare function cancelDeferredResumeConversationRun(input: DeferredResumeConversationRunInput & {
    cancelledAt: string;
    reason?: string;
}): Promise<DeferredResumeConversationRunResult>;
export {};
