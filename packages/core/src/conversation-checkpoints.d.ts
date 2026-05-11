export interface ConversationCheckpointSource {
    conversationId: string;
    conversationTitle?: string;
    cwd?: string;
    relatedProjectIds: string[];
}
export interface ConversationCheckpointAnchor {
    messageId: string;
    role: string;
    timestamp: string;
    preview: string;
}
export interface ConversationCheckpointSnapshot {
    file: string;
    messageCount: number;
    lineCount: number;
    bytes: number;
}
export interface ConversationCheckpointRecord {
    version: 1;
    id: string;
    title: string;
    note?: string;
    summary?: string;
    createdAt: string;
    updatedAt: string;
    source: ConversationCheckpointSource;
    anchor: ConversationCheckpointAnchor;
    snapshot: ConversationCheckpointSnapshot;
    snapshotMissing?: boolean;
}
interface ResolveConversationCheckpointOptions {
    profile: string;
    stateRoot?: string;
}
interface ResolveConversationCheckpointPathOptions extends ResolveConversationCheckpointOptions {
    checkpointId: string;
}
interface ResolveConversationCheckpointSnapshotFileOptions extends ResolveConversationCheckpointOptions {
    checkpoint: Pick<ConversationCheckpointRecord, 'id' | 'snapshot'>;
}
export interface SaveConversationCheckpointOptions extends ResolveConversationCheckpointOptions {
    checkpointId?: string;
    title: string;
    note?: string;
    summary?: string;
    source: ConversationCheckpointSource;
    anchor: ConversationCheckpointAnchor;
    snapshotContent: string;
    snapshotMessageCount: number;
    snapshotLineCount?: number;
    snapshotBytes?: number;
    createdAt?: string;
    updatedAt?: string;
}
export declare function validateConversationCheckpointId(checkpointId: string): void;
export declare function resolveProfileConversationCheckpointsDir(options: ResolveConversationCheckpointOptions): string;
export declare function resolveConversationCheckpointMetaDir(options: ResolveConversationCheckpointOptions): string;
export declare function resolveConversationCheckpointSnapshotsDir(options: ResolveConversationCheckpointOptions): string;
export declare function resolveConversationCheckpointMetaPath(options: ResolveConversationCheckpointPathOptions): string;
export declare function resolveConversationCheckpointSnapshotPath(options: ResolveConversationCheckpointPathOptions): string;
export declare function resolveConversationCheckpointSnapshotFile(options: ResolveConversationCheckpointSnapshotFileOptions): string;
export declare function getConversationCheckpoint(options: ResolveConversationCheckpointPathOptions): ConversationCheckpointRecord | null;
export declare function listConversationCheckpoints(options: ResolveConversationCheckpointOptions & {
    conversationId?: string;
}): ConversationCheckpointRecord[];
export declare function saveConversationCheckpoint(options: SaveConversationCheckpointOptions): ConversationCheckpointRecord;
export declare function deleteConversationCheckpoint(options: ResolveConversationCheckpointPathOptions): boolean;
export {};
