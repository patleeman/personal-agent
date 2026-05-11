import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { OAuthClientInformationFull, type OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
export type McpTransportStrategy = 'sse-only' | 'http-only' | 'sse-first' | 'http-first';
export interface McpRemoteOAuthOptions {
    serverName: string;
    serverUrl: string;
    callbackHost: string;
    callbackPort: number;
    callbackPath: string;
    transportStrategy: McpTransportStrategy;
    headers: Record<string, string>;
    authorizeResource?: string;
    staticClientMetadata?: OAuthClientMetadata;
    staticClientInfo?: OAuthClientInformationFull;
    authTimeoutMs: number;
    serverUrlHash: string;
    log?: (message: string) => void;
}
export interface McpRemoteClientConnection {
    client: Client;
    transport: Transport;
    transportName: string;
    close: () => Promise<void>;
}
export declare function getMcpServerUrlHash(serverUrl: string, authorizeResource?: string, headers?: Record<string, string>): string;
export declare function resolveCallbackPort(serverUrlHash: string, preferredPort?: number): Promise<number>;
export declare function openRemoteMcpClient(options: McpRemoteOAuthOptions): Promise<McpRemoteClientConnection>;
