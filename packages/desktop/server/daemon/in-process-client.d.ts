import type { DaemonConfig } from './config.js';
import type { PersonalAgentDaemon } from './server.js';
import type { CancelDurableRunResult, DaemonEvent, DaemonStatus, FollowUpDurableRunResult, GetDurableRunResult, ListDurableRunsResult, ListRecoverableWebLiveConversationRunsResult, ReplayDurableRunResult, StartBackgroundRunRequestInput, StartBackgroundRunResult, StartScheduledTaskRunResult, SyncWebLiveConversationRunRequestInput, SyncWebLiveConversationRunResult } from './types.js';
export interface DaemonClientTransport {
    ping(config?: DaemonConfig): Promise<boolean>;
    getStatus(config?: DaemonConfig): Promise<DaemonStatus>;
    getCompanionUrl?(config?: DaemonConfig): Promise<string | null>;
    stop(config?: DaemonConfig): Promise<void>;
    listDurableRuns(config?: DaemonConfig): Promise<ListDurableRunsResult>;
    getDurableRun(runId: string, config?: DaemonConfig): Promise<GetDurableRunResult>;
    startScheduledTaskRun(taskId: string, config?: DaemonConfig): Promise<StartScheduledTaskRunResult>;
    startBackgroundRun(input: StartBackgroundRunRequestInput, config?: DaemonConfig): Promise<StartBackgroundRunResult>;
    cancelDurableRun(runId: string, config?: DaemonConfig): Promise<CancelDurableRunResult>;
    rerunDurableRun(runId: string, config?: DaemonConfig): Promise<ReplayDurableRunResult>;
    followUpDurableRun(runId: string, prompt?: string, config?: DaemonConfig): Promise<FollowUpDurableRunResult>;
    syncWebLiveConversationRunState(input: SyncWebLiveConversationRunRequestInput, config?: DaemonConfig): Promise<SyncWebLiveConversationRunResult>;
    listRecoverableWebLiveConversationRuns(config?: DaemonConfig): Promise<ListRecoverableWebLiveConversationRunsResult>;
    emitEvent(event: DaemonEvent, config?: DaemonConfig): Promise<boolean>;
}
export declare function getDaemonClientTransportOverride(): DaemonClientTransport | undefined;
export declare function setDaemonClientTransportOverride(transport: DaemonClientTransport | undefined): void;
export declare function clearDaemonClientTransportOverride(): void;
export declare function bindInProcessDaemonClient(daemon: PersonalAgentDaemon): () => void;
export declare function createInProcessDaemonClient(daemon: PersonalAgentDaemon): DaemonClientTransport;
