export type AlertKind = 'reminder' | 'approval-needed' | 'blocked' | 'task-completed' | 'task-failed' | 'deferred-resume' | 'task-callback';
export type AlertSeverity = 'passive' | 'disruptive';
export type AlertStatus = 'active' | 'acknowledged' | 'dismissed';
export interface AlertRecord {
    id: string;
    profile: string;
    kind: AlertKind;
    severity: AlertSeverity;
    status: AlertStatus;
    title: string;
    body: string;
    createdAt: string;
    updatedAt: string;
    conversationId?: string;
    activityId?: string;
    wakeupId?: string;
    sourceKind: string;
    sourceId: string;
    requiresAck: boolean;
    acknowledgedAt?: string;
    dismissedAt?: string;
}
export interface AlertStateFile {
    version: 1;
    alerts: Record<string, AlertRecord>;
}
export interface ResolveAlertOptions {
    profile: string;
    stateRoot?: string;
}
export declare function createEmptyAlertState(): AlertStateFile;
export declare function resolveProfileAlertsStateFile(options: ResolveAlertOptions): string;
export declare function loadAlertState(options: ResolveAlertOptions): AlertStateFile;
export declare function saveAlertState(options: ResolveAlertOptions & {
    state: AlertStateFile;
}): string;
export declare function listAlerts(options?: ResolveAlertOptions & {
    includeDismissed?: boolean;
    includeAcknowledged?: boolean;
}): AlertRecord[];
export declare function getAlert(options: ResolveAlertOptions & {
    alertId: string;
}): AlertRecord | undefined;
export declare function upsertAlert(options: ResolveAlertOptions & {
    alert: Omit<AlertRecord, 'updatedAt'> & {
        updatedAt?: string;
    };
}): AlertRecord;
export declare function acknowledgeAlert(options: ResolveAlertOptions & {
    alertId: string;
    at?: string;
}): AlertRecord | undefined;
export declare function dismissAlert(options: ResolveAlertOptions & {
    alertId: string;
    at?: string;
}): AlertRecord | undefined;
export declare function countActiveAlerts(options: ResolveAlertOptions): number;
