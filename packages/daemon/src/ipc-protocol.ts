import type {
  DaemonEvent,
  DaemonStatus,
  EmitResult,
  GatewayNotificationProvider,
  PullGatewayNotificationsResult,
  ListDurableRunsResult,
  GetDurableRunResult,
  StartScheduledTaskRunResult,
  StartBackgroundRunRequestInput,
  StartBackgroundRunResult,
  CancelDurableRunResult,
  SyncWebLiveConversationRunResult,
  SyncWebLiveConversationRunRequestInput,
  ListRecoverableWebLiveConversationRunsResult,
} from './types.js';

export interface EmitRequest {
  id: string;
  type: 'emit';
  event: DaemonEvent;
}

export interface StatusRequest {
  id: string;
  type: 'status';
}

export interface StopRequest {
  id: string;
  type: 'stop';
}

export interface PingRequest {
  id: string;
  type: 'ping';
}

export interface PullGatewayNotificationsRequest {
  id: string;
  type: 'notifications.pull';
  gateway: GatewayNotificationProvider;
  limit?: number;
}

export interface ListDurableRunsRequest {
  id: string;
  type: 'runs.list';
}

export interface GetDurableRunRequest {
  id: string;
  type: 'runs.get';
  runId: string;
}

export interface StartScheduledTaskRunRequest {
  id: string;
  type: 'runs.startTask';
  filePath: string;
}

export interface StartBackgroundRunRequest {
  id: string;
  type: 'runs.startBackground';
  input: StartBackgroundRunRequestInput;
}

export interface CancelDurableRunRequest {
  id: string;
  type: 'runs.cancel';
  runId: string;
}

export interface SyncWebLiveConversationRunRequest {
  id: string;
  type: 'conversations.sync';
  input: SyncWebLiveConversationRunRequestInput;
}

export interface ListRecoverableWebLiveConversationRunsRequest {
  id: string;
  type: 'conversations.recoverable';
}

export type DaemonRequest =
  | EmitRequest
  | StatusRequest
  | StopRequest
  | PingRequest
  | PullGatewayNotificationsRequest
  | ListDurableRunsRequest
  | GetDurableRunRequest
  | StartScheduledTaskRunRequest
  | StartBackgroundRunRequest
  | CancelDurableRunRequest
  | SyncWebLiveConversationRunRequest
  | ListRecoverableWebLiveConversationRunsRequest;

export interface DaemonSuccessResponse {
  id: string;
  ok: true;
  result:
    | EmitResult
    | DaemonStatus
    | { stopping: boolean }
    | { pong: true }
    | PullGatewayNotificationsResult
    | ListDurableRunsResult
    | GetDurableRunResult
    | StartScheduledTaskRunResult
    | StartBackgroundRunResult
    | CancelDurableRunResult
    | SyncWebLiveConversationRunResult
    | ListRecoverableWebLiveConversationRunsResult;
}

export interface DaemonErrorResponse {
  id: string;
  ok: false;
  error: string;
}

export type DaemonResponse = DaemonSuccessResponse | DaemonErrorResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasId(value: Record<string, unknown>): value is Record<string, unknown> & { id: string } {
  return typeof value.id === 'string' && value.id.length > 0;
}

function isGatewayNotificationProvider(value: unknown): value is GatewayNotificationProvider {
  return value === 'telegram';
}

function readOptionalLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error('notifications.pull limit must be a positive integer');
  }

  return value;
}

function readOptionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return value;
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return value.trim();
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readBackgroundRunNotification(value: unknown): StartBackgroundRunRequestInput['notification'] {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error('runs.startBackground notification must be an object when provided');
  }

  const gateway = readRequiredString(value.gateway, 'runs.startBackground notification.gateway');
  if (gateway !== 'telegram') {
    throw new Error('runs.startBackground notification.gateway must be telegram');
  }

  const destinationId = readRequiredString(value.destinationId, 'runs.startBackground notification.destinationId');
  const mode = readRequiredString(value.mode, 'runs.startBackground notification.mode');
  if (mode !== 'none' && mode !== 'message' && mode !== 'resume') {
    throw new Error('runs.startBackground notification.mode must be none, message, or resume');
  }

  const messageThreadId = readOptionalPositiveInteger(
    value.messageThreadId,
    'runs.startBackground notification.messageThreadId',
  );
  const resumeConversationId = readOptionalString(value.resumeConversationId);

  return {
    gateway: 'telegram',
    destinationId,
    ...(messageThreadId !== undefined ? { messageThreadId } : {}),
    mode,
    ...(resumeConversationId ? { resumeConversationId } : {}),
  };
}

function readBackgroundRunInput(value: unknown): StartBackgroundRunRequestInput {
  if (!isRecord(value)) {
    throw new Error('runs.startBackground input must be an object');
  }

  const rawArgv = value.argv;
  if (rawArgv !== undefined && !Array.isArray(rawArgv)) {
    throw new Error('runs.startBackground argv must be an array when provided');
  }

  const manifestMetadata = value.manifestMetadata;
  if (manifestMetadata !== undefined && !isRecord(manifestMetadata)) {
    throw new Error('runs.startBackground manifestMetadata must be an object when provided');
  }

  const checkpointPayload = value.checkpointPayload;
  if (checkpointPayload !== undefined && !isRecord(checkpointPayload)) {
    throw new Error('runs.startBackground checkpointPayload must be an object when provided');
  }

  const argv = Array.isArray(rawArgv)
    ? rawArgv.map((entry, index) => readRequiredString(entry, `runs.startBackground argv[${index}]`))
    : undefined;
  const shellCommand = readOptionalString(value.shellCommand);
  const notification = readBackgroundRunNotification(value.notification);

  return {
    taskSlug: readRequiredString(value.taskSlug, 'runs.startBackground taskSlug'),
    cwd: readRequiredString(value.cwd, 'runs.startBackground cwd'),
    ...(argv ? { argv } : {}),
    ...(shellCommand ? { shellCommand } : {}),
    ...(isRecord(value.source)
      ? {
          source: {
            type: readRequiredString(value.source.type, 'runs.startBackground source.type'),
            ...(readOptionalString(value.source.id) ? { id: readOptionalString(value.source.id) } : {}),
            ...(readOptionalString(value.source.filePath) ? { filePath: readOptionalString(value.source.filePath) } : {}),
          },
        }
      : {}),
    ...(notification ? { notification } : {}),
    ...(manifestMetadata ? { manifestMetadata } : {}),
    ...(checkpointPayload ? { checkpointPayload } : {}),
  };
}

function readConversationRunState(value: unknown): SyncWebLiveConversationRunRequestInput['state'] {
  if (value === 'waiting' || value === 'running' || value === 'interrupted' || value === 'failed') {
    return value;
  }

  throw new Error('conversations.sync state must be waiting, running, interrupted, or failed');
}

function readConversationRunInput(value: unknown): SyncWebLiveConversationRunRequestInput {
  if (!isRecord(value)) {
    throw new Error('conversations.sync input must be an object');
  }

  const pendingOperation = value.pendingOperation;
  if (pendingOperation !== undefined && pendingOperation !== null && !isRecord(pendingOperation)) {
    throw new Error('conversations.sync pendingOperation must be an object when provided');
  }

  return {
    conversationId: readRequiredString(value.conversationId, 'conversations.sync conversationId'),
    sessionFile: readRequiredString(value.sessionFile, 'conversations.sync sessionFile'),
    cwd: readRequiredString(value.cwd, 'conversations.sync cwd'),
    state: readConversationRunState(value.state),
    title: readOptionalString(value.title),
    profile: readOptionalString(value.profile),
    updatedAt: readOptionalString(value.updatedAt),
    lastError: readOptionalString(value.lastError),
    ...(pendingOperation !== undefined ? { pendingOperation: pendingOperation as SyncWebLiveConversationRunRequestInput['pendingOperation'] } : {}),
  };
}

export function parseRequest(raw: string): DaemonRequest {
  const parsed = JSON.parse(raw) as unknown;

  if (!isRecord(parsed) || !hasId(parsed)) {
    throw new Error('Invalid request envelope');
  }

  if (parsed.type === 'emit') {
    if (!('event' in parsed)) {
      throw new Error('emit request must include event');
    }

    return {
      id: parsed.id,
      type: 'emit',
      event: parsed.event as DaemonEvent,
    };
  }

  if (parsed.type === 'notifications.pull') {
    if (!isGatewayNotificationProvider(parsed.gateway)) {
      throw new Error('notifications.pull gateway must be telegram');
    }

    return {
      id: parsed.id,
      type: 'notifications.pull',
      gateway: parsed.gateway,
      limit: readOptionalLimit(parsed.limit),
    };
  }

  if (parsed.type === 'runs.list') {
    return {
      id: parsed.id,
      type: 'runs.list',
    };
  }

  if (parsed.type === 'runs.get') {
    return {
      id: parsed.id,
      type: 'runs.get',
      runId: readRequiredString(parsed.runId, 'runs.get runId'),
    };
  }

  if (parsed.type === 'runs.startTask') {
    return {
      id: parsed.id,
      type: 'runs.startTask',
      filePath: readRequiredString(parsed.filePath, 'runs.startTask filePath'),
    };
  }

  if (parsed.type === 'runs.startBackground') {
    return {
      id: parsed.id,
      type: 'runs.startBackground',
      input: readBackgroundRunInput(parsed.input),
    };
  }

  if (parsed.type === 'runs.cancel') {
    return {
      id: parsed.id,
      type: 'runs.cancel',
      runId: readRequiredString(parsed.runId, 'runs.cancel runId'),
    };
  }

  if (parsed.type === 'conversations.sync') {
    return {
      id: parsed.id,
      type: 'conversations.sync',
      input: readConversationRunInput(parsed.input),
    };
  }

  if (parsed.type === 'conversations.recoverable') {
    return {
      id: parsed.id,
      type: 'conversations.recoverable',
    };
  }

  if (parsed.type === 'status' || parsed.type === 'stop' || parsed.type === 'ping') {
    return {
      id: parsed.id,
      type: parsed.type,
    };
  }

  throw new Error(`Unknown request type: ${String(parsed.type)}`);
}

export function serializeResponse(response: DaemonResponse): string {
  return `${JSON.stringify(response)}\n`;
}
