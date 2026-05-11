export interface SyncTailscaleServeProxyInput {
    enabled: boolean;
    port: number;
    path?: string;
}
export interface SyncCompanionTailscaleServeInput {
    enabled: boolean;
    port: number;
}
export type TailscaleServeProxyStatus = 'disabled' | 'published' | 'missing' | 'mismatch' | 'unavailable';
export interface TailscaleServeProxyState {
    status: TailscaleServeProxyStatus;
    path: string;
    expectedProxyTarget: string;
    actualProxyTarget?: string;
    message?: string;
}
export declare function readTailscaleServeProxyState(input: SyncTailscaleServeProxyInput): TailscaleServeProxyState;
export declare function syncTailscaleServeProxy(input: SyncTailscaleServeProxyInput): void;
export declare function syncCompanionTailscaleServe(input: SyncCompanionTailscaleServeInput): void;
export declare function resolveTailscaleServeBaseUrl(): string | undefined;
