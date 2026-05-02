import type { BackgroundRunAgentSpec } from './background-run-agent.js';
import type { ScannedDurableRun, ScannedDurableRunsSummary } from './runs/store.js';
import type {
  RecoverableWebLiveConversationRun,
  WebLiveConversationPendingOperation,
  WebLiveConversationRunState,
} from './runs/web-live-conversations.js';

export type EventPayload = Record<string, unknown>;

export interface DaemonEvent {
  id: string;
  version: number;
  type: string;
  source: string;
  timestamp: string;
  payload: EventPayload;
}

export interface DaemonEventInput {
  type: string;
  source: string;
  payload?: EventPayload;
  id?: string;
  timestamp?: string;
}

export interface DaemonPaths {
  stateRoot: string;
  root: string;
  socketPath: string;
  pidFile: string;
  logDir: string;
  logFile: string;
}

export interface TimerDefinition {
  name: string;
  eventType: string;
  intervalMs: number;
  payload?: EventPayload;
}

export interface DaemonQueueStatus {
  maxDepth: number;
  currentDepth: number;
  droppedEvents: number;
  processedEvents: number;
  lastEventAt?: string;
}

export interface DaemonModuleStatus {
  name: string;
  enabled: boolean;
  subscriptions: string[];
  handledEvents: number;
  lastEventAt?: string;
  lastError?: string;
  detail?: Record<string, unknown>;
}

export interface DaemonPowerStatus {
  keepAwake: boolean;
  supported: boolean;
  active: boolean;
  error?: string;
}

export interface DaemonStatus {
  running: boolean;
  pid: number;
  startedAt: string;
  socketPath: string;
  power: DaemonPowerStatus;
  queue: DaemonQueueStatus;
  modules: DaemonModuleStatus[];
}

export interface EmitResult {
  accepted: boolean;
  reason?: string;
}

export interface ListDurableRunsResult {
  scannedAt: string;
  runs: ScannedDurableRun[];
  summary: ScannedDurableRunsSummary;
}

export interface GetDurableRunResult {
  scannedAt: string;
  run: ScannedDurableRun;
}

export interface StartScheduledTaskRunResult {
  accepted: boolean;
  runId: string;
  reason?: string;
}

export interface StartBackgroundRunRequestInput {
  taskSlug: string;
  cwd: string;
  argv?: string[];
  shellCommand?: string;
  agent?: BackgroundRunAgentSpec;
  source?: {
    type: string;
    id?: string;
    filePath?: string;
  };
  callbackConversation?: {
    conversationId: string;
    sessionFile: string;
    profile: string;
    repoRoot?: string;
  };
  manifestMetadata?: Record<string, unknown>;
  checkpointPayload?: Record<string, unknown>;
}

export interface StartBackgroundRunResult {
  accepted: boolean;
  runId: string;
  logPath?: string;
  reason?: string;
}

export interface CancelDurableRunResult {
  cancelled: boolean;
  runId: string;
  reason?: string;
}

export interface ReplayDurableRunResult {
  accepted: boolean;
  runId: string;
  sourceRunId: string;
  logPath?: string;
  reason?: string;
}

export interface FollowUpDurableRunResult {
  accepted: boolean;
  runId: string;
  sourceRunId: string;
  logPath?: string;
  reason?: string;
}

export interface SyncWebLiveConversationRunRequestInput {
  conversationId: string;
  sessionFile: string;
  cwd: string;
  title?: string;
  profile?: string;
  state: WebLiveConversationRunState;
  updatedAt?: string;
  lastError?: string;
  pendingOperation?: WebLiveConversationPendingOperation | null;
}

export interface SyncWebLiveConversationRunResult {
  runId: string;
}

export interface ListRecoverableWebLiveConversationRunsResult {
  runs: RecoverableWebLiveConversationRun[];
}
