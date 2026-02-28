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

export interface DaemonStatus {
  running: boolean;
  pid: number;
  startedAt: string;
  socketPath: string;
  queue: DaemonQueueStatus;
  modules: DaemonModuleStatus[];
}

export interface EmitResult {
  accepted: boolean;
  reason?: string;
}
