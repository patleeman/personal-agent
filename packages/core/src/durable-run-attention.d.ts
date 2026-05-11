export interface DurableRunAttentionStateOptions {
    stateRoot?: string;
}
export interface DurableRunAttentionRecord {
    runId: string;
    attentionSignature: string;
    readAt: string;
}
export interface DurableRunAttentionStateDocument {
    version: 1;
    runs: Record<string, DurableRunAttentionRecord>;
}
export declare function resolveDurableRunAttentionStatePath(options?: DurableRunAttentionStateOptions): string;
export declare function loadDurableRunAttentionState(options?: DurableRunAttentionStateOptions): DurableRunAttentionStateDocument;
export declare function saveDurableRunAttentionState(options: DurableRunAttentionStateOptions & {
    document: DurableRunAttentionStateDocument;
}): string;
export declare function markDurableRunAttentionRead(options: DurableRunAttentionStateOptions & {
    runId: string;
    attentionSignature: string;
    readAt?: string;
}): DurableRunAttentionStateDocument;
export declare function markDurableRunAttentionUnread(options: DurableRunAttentionStateOptions & {
    runId: string;
}): DurableRunAttentionStateDocument;
export declare function isDurableRunAttentionDismissed(options: DurableRunAttentionStateOptions & {
    runId: string;
    attentionSignature: string;
}): boolean;
