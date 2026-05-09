import type { DaemonConfig } from './config.js';
import type { PersonalAgentDaemon } from './server.js';
import type {
  CancelDurableRunResult,
  DaemonEvent,
  DaemonStatus,
  FollowUpDurableRunResult,
  GetDurableRunResult,
  ListDurableRunsResult,
  ListRecoverableWebLiveConversationRunsResult,
  ReplayDurableRunResult,
  StartBackgroundRunRequestInput,
  StartBackgroundRunResult,
  StartScheduledTaskRunResult,
  SyncWebLiveConversationRunRequestInput,
  SyncWebLiveConversationRunResult,
} from './types.js';

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
  syncWebLiveConversationRunState(
    input: SyncWebLiveConversationRunRequestInput,
    config?: DaemonConfig,
  ): Promise<SyncWebLiveConversationRunResult>;
  listRecoverableWebLiveConversationRuns(config?: DaemonConfig): Promise<ListRecoverableWebLiveConversationRunsResult>;
  emitEvent(event: DaemonEvent, config?: DaemonConfig): Promise<boolean>;
}

let daemonClientTransportOverride: DaemonClientTransport | undefined;

export function getDaemonClientTransportOverride(): DaemonClientTransport | undefined {
  return daemonClientTransportOverride;
}

export function setDaemonClientTransportOverride(transport: DaemonClientTransport | undefined): void {
  daemonClientTransportOverride = transport;
}

export function clearDaemonClientTransportOverride(): void {
  daemonClientTransportOverride = undefined;
}

export function bindInProcessDaemonClient(daemon: PersonalAgentDaemon): () => void {
  const transport = createInProcessDaemonClient(daemon);
  setDaemonClientTransportOverride(transport);
  return () => {
    if (getDaemonClientTransportOverride() === transport) {
      clearDaemonClientTransportOverride();
    }
  };
}

export function createInProcessDaemonClient(daemon: PersonalAgentDaemon): DaemonClientTransport {
  return {
    ping: async () => daemon.isRunning(),
    getStatus: async () => daemon.getStatus(),
    getCompanionUrl: async () => daemon.getCompanionUrl(),
    stop: async () => {
      await daemon.requestStop();
    },
    listDurableRuns: async () => daemon.listDurableRuns(),
    getDurableRun: async (runId) => {
      const result = daemon.getDurableRun(runId);
      if (!result) {
        throw new Error(`Run not found: ${runId}`);
      }

      return result;
    },
    startScheduledTaskRun: async (taskId) => daemon.startScheduledTaskRun(taskId),
    startBackgroundRun: async (input) => daemon.startBackgroundRun(input),
    cancelDurableRun: async (runId) => daemon.cancelBackgroundRun(runId),
    rerunDurableRun: async (runId) => daemon.rerunBackgroundRun(runId),
    followUpDurableRun: async (runId, prompt) => daemon.followUpBackgroundRun(runId, prompt),
    syncWebLiveConversationRunState: async (input) => daemon.syncWebLiveConversationRun(input),
    listRecoverableWebLiveConversationRuns: async () => daemon.listRecoverableWebLiveConversationRuns(),
    emitEvent: async (event) => daemon.publishEvent(event),
  };
}
