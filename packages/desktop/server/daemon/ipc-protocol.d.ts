import type { CancelDurableRunResult, DaemonEvent, DaemonStatus, EmitResult, FollowUpDurableRunResult, GetDurableRunResult, ListDurableRunsResult, ListRecoverableWebLiveConversationRunsResult, ReplayDurableRunResult, StartBackgroundRunRequestInput, StartBackgroundRunResult, StartScheduledTaskRunResult, SyncWebLiveConversationRunRequestInput, SyncWebLiveConversationRunResult } from './types.js';
interface EmitRequest {
    id: string;
    type: 'emit';
    event: DaemonEvent;
}
interface StatusRequest {
    id: string;
    type: 'status';
}
interface StopRequest {
    id: string;
    type: 'stop';
}
interface PingRequest {
    id: string;
    type: 'ping';
}
interface ListDurableRunsRequest {
    id: string;
    type: 'runs.list';
}
interface GetDurableRunRequest {
    id: string;
    type: 'runs.get';
    runId: string;
}
interface StartScheduledTaskRunRequest {
    id: string;
    type: 'runs.startTask';
    taskId: string;
}
interface StartBackgroundRunRequest {
    id: string;
    type: 'runs.startBackground';
    input: StartBackgroundRunRequestInput;
}
interface CancelDurableRunRequest {
    id: string;
    type: 'runs.cancel';
    runId: string;
}
interface RerunDurableRunRequest {
    id: string;
    type: 'runs.rerun';
    runId: string;
}
interface FollowUpDurableRunRequest {
    id: string;
    type: 'runs.followUp';
    runId: string;
    prompt?: string;
}
interface SyncWebLiveConversationRunRequest {
    id: string;
    type: 'conversations.sync';
    input: SyncWebLiveConversationRunRequestInput;
}
interface ListRecoverableWebLiveConversationRunsRequest {
    id: string;
    type: 'conversations.recoverable';
}
export type DaemonRequest = EmitRequest | StatusRequest | StopRequest | PingRequest | ListDurableRunsRequest | GetDurableRunRequest | StartScheduledTaskRunRequest | StartBackgroundRunRequest | CancelDurableRunRequest | RerunDurableRunRequest | FollowUpDurableRunRequest | SyncWebLiveConversationRunRequest | ListRecoverableWebLiveConversationRunsRequest;
interface DaemonSuccessResponse {
    id: string;
    ok: true;
    result: EmitResult | DaemonStatus | {
        stopping: boolean;
    } | {
        pong: true;
    } | ListDurableRunsResult | GetDurableRunResult | StartScheduledTaskRunResult | StartBackgroundRunResult | CancelDurableRunResult | ReplayDurableRunResult | FollowUpDurableRunResult | SyncWebLiveConversationRunResult | ListRecoverableWebLiveConversationRunsResult;
}
interface DaemonErrorResponse {
    id: string;
    ok: false;
    error: string;
}
export type DaemonResponse = DaemonSuccessResponse | DaemonErrorResponse;
export declare function parseRequest(raw: string): DaemonRequest;
export declare function serializeResponse(response: DaemonResponse): string;
export {};
