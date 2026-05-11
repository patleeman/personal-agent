export type KnowledgeBaseSyncStatus = 'disabled' | 'idle' | 'syncing' | 'error';
export interface KnowledgeBaseGitStatus {
    localChangeCount: number;
    aheadCount: number;
    behindCount: number;
}
export interface KnowledgeBaseState {
    repoUrl: string;
    branch: string;
    configured: boolean;
    effectiveRoot: string;
    managedRoot: string;
    usesManagedRoot: boolean;
    syncStatus: KnowledgeBaseSyncStatus;
    lastSyncAt?: string;
    lastError?: string;
    gitStatus?: KnowledgeBaseGitStatus | null;
    recoveredEntryCount: number;
    recoveryDir: string;
}
export interface UpdateKnowledgeBaseInput {
    repoUrl?: string | null;
    branch?: string | null;
}
export interface KnowledgeBaseManagerOptions {
    stateRoot?: string;
    configRoot?: string;
}
type KnowledgeBaseStateListener = (state: KnowledgeBaseState) => void;
export declare class KnowledgeBaseManager {
    private readonly stateRoot;
    private readonly configRoot;
    private readonly localStateFilePath;
    private readonly recoveryDir;
    private readonly recoveryIndexPath;
    private readonly syncLockDir;
    private readonly syncLockMetadataPath;
    private readonly listeners;
    private runtimeState;
    private interval;
    private syncInProgress;
    private activeSyncLockTimestamp;
    private syncBackupDir;
    constructor(options?: KnowledgeBaseManagerOptions);
    private machineConfigOptions;
    private readConfig;
    private readStoredStateForConfig;
    private archiveManagedRoot;
    private ensureRepoCheckout;
    private checkoutRemoteBase;
    private readState;
    private notifyListeners;
    subscribe(listener: KnowledgeBaseStateListener): () => void;
    readKnowledgeBaseState(): KnowledgeBaseState;
    updateKnowledgeBase(input: UpdateKnowledgeBaseInput): KnowledgeBaseState;
    private writeRecoveryCopy;
    private backupWorkingTree;
    private restoreWorkingTree;
    private cleanupSyncBackup;
    private validateSyncResult;
    private tryAcquireSyncLock;
    private releaseSyncLock;
    private stageAndCommitIfNeeded;
    private resolveChangedPaths;
    syncNow(previousStateInput?: KnowledgeBaseState): KnowledgeBaseState;
    startSyncLoop(intervalMs?: number): void;
    stopSyncLoop(): void;
}
export declare function getKnowledgeBaseManager(options?: KnowledgeBaseManagerOptions): KnowledgeBaseManager;
export declare function readKnowledgeBaseState(options?: KnowledgeBaseManagerOptions): KnowledgeBaseState;
export declare function updateKnowledgeBase(input: UpdateKnowledgeBaseInput, options?: KnowledgeBaseManagerOptions): KnowledgeBaseState;
export declare function syncKnowledgeBaseNow(options?: KnowledgeBaseManagerOptions): KnowledgeBaseState;
export declare function subscribeKnowledgeBaseState(listener: KnowledgeBaseStateListener, options?: KnowledgeBaseManagerOptions): () => void;
export declare function startKnowledgeBaseSyncLoop(options?: KnowledgeBaseManagerOptions & {
    intervalMs?: number;
}): void;
export declare function stopKnowledgeBaseSyncLoop(options?: KnowledgeBaseManagerOptions): void;
export {};
