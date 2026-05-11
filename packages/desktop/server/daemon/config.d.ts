export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface MaintenanceModuleConfig {
    enabled: boolean;
    cleanupIntervalMinutes: number;
}
export interface TasksModuleConfig {
    enabled: boolean;
    taskDir: string;
    tickIntervalSeconds: number;
    maxRetries: number;
    reapAfterDays: number;
    defaultTimeoutSeconds: number;
}
export interface DaemonConfig {
    logLevel: LogLevel;
    queue: {
        maxDepth: number;
    };
    ipc: {
        socketPath?: string;
    };
    companion?: {
        enabled?: boolean;
        host?: string;
        port?: number;
    };
    modules: {
        maintenance: MaintenanceModuleConfig;
        tasks: TasksModuleConfig;
    };
}
export declare function getDaemonConfigFilePath(): string;
export declare function getDefaultDaemonConfig(): DaemonConfig;
export declare function loadDaemonConfig(): DaemonConfig;
