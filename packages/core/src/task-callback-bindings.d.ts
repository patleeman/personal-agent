import type { AlertSeverity } from './alerts.js';
export interface TaskCallbackBinding {
    taskId: string;
    profile: string;
    conversationId: string;
    sessionFile: string;
    createdAt: string;
    updatedAt: string;
    deliverOnSuccess: boolean;
    deliverOnFailure: boolean;
    notifyOnSuccess: AlertSeverity | 'none';
    notifyOnFailure: AlertSeverity | 'none';
    requireAck: boolean;
    autoResumeIfOpen: boolean;
}
export declare function resolveTaskCallbackBindingsFile(options: {
    profile: string;
    stateRoot?: string;
}): string;
export declare function loadTaskCallbackBindings(options: {
    profile: string;
    stateRoot?: string;
}): Record<string, TaskCallbackBinding>;
export declare function saveTaskCallbackBindings(options: {
    profile: string;
    stateRoot?: string;
    bindings: Record<string, TaskCallbackBinding>;
}): string;
export declare function getTaskCallbackBinding(options: {
    profile: string;
    taskId: string;
    stateRoot?: string;
}): TaskCallbackBinding | undefined;
export declare function setTaskCallbackBinding(options: {
    profile: string;
    taskId: string;
    stateRoot?: string;
    conversationId: string;
    sessionFile: string;
    deliverOnSuccess?: boolean;
    deliverOnFailure?: boolean;
    notifyOnSuccess?: AlertSeverity | 'none';
    notifyOnFailure?: AlertSeverity | 'none';
    requireAck?: boolean;
    autoResumeIfOpen?: boolean;
    updatedAt?: string;
}): TaskCallbackBinding;
export declare function clearTaskCallbackBinding(options: {
    profile: string;
    taskId: string;
    stateRoot?: string;
}): boolean;
