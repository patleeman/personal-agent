import type { OAuthClientInformationFull, OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { type McpTransportStrategy } from './mcp-oauth.js';
export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'remote';
  command?: string;
  args: string[];
  cwd?: string;
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  authorizeResource?: string;
  callbackHost?: string;
  callbackPort?: number;
  callbackPath?: string;
  transportStrategy?: McpTransportStrategy;
  ignoreTools?: string[];
  authTimeoutMs?: number;
  oauthClientMetadata?: OAuthClientMetadata;
  oauthClientInfo?: OAuthClientInformationFull;
  raw: Record<string, unknown>;
}
export interface McpConfigState {
  path: string;
  exists: boolean;
  searchedPaths: string[];
  servers: McpServerConfig[];
}
export interface McpServerToolSummary {
  name: string;
  description?: string;
}
export interface McpServerInfo {
  server?: string;
  transport?: string;
  commandLine?: string;
  toolCount?: number;
  tools: McpServerToolSummary[];
  rawOutput: string;
}
export interface McpToolInfo {
  server?: string;
  tool?: string;
  description?: string;
  schema?: Record<string, unknown>;
  rawOutput: string;
}
export interface McpToolCallResult {
  parsed: unknown;
  rawOutput: string;
}
export interface McpOperationResult<T> {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
  data?: T;
}
export interface McpCatalogServerResult {
  name: string;
  info?: McpServerInfo;
  error?: string;
}
export declare function resolveMcpConfig(options?: { cwd?: string; configPath?: string; env?: NodeJS.ProcessEnv }): {
  path: string;
  exists: boolean;
  searchedPaths: string[];
};
export declare function readMcpConfigDocument(options: {
  path: string;
  exists: boolean;
  searchedPaths: string[];
  document: unknown;
}): McpConfigState;
export declare function readMcpConfig(options?: { cwd?: string; configPath?: string; env?: NodeJS.ProcessEnv }): McpConfigState;
export declare function inspectMcpServer(
  serverName: string,
  options?: {
    cwd?: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    withDescriptions?: boolean;
    log?: (message: string) => void;
  },
): Promise<McpOperationResult<McpServerInfo>>;
export declare function inspectMcpTool(
  serverName: string,
  toolName: string,
  options?: {
    cwd?: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    log?: (message: string) => void;
  },
): Promise<McpOperationResult<McpToolInfo>>;
export interface McpClientConnection {
  callTool: (toolName: string, input: unknown, timeoutMs?: number) => Promise<unknown>;
  close: () => Promise<void>;
}
/**
 * Open a persistent MCP client connection to a server config directly.
 * The caller owns the lifecycle — call close() when done.
 */
export declare function connectMcpServerDirect(
  server: McpServerConfig,
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    log?: (message: string) => void;
  },
): Promise<McpClientConnection>;
export declare function callMcpToolDirect(
  server: McpServerConfig,
  toolName: string,
  input: unknown,
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    log?: (message: string) => void;
  },
): Promise<McpOperationResult<McpToolCallResult>>;
export declare function callMcpTool(
  serverName: string,
  toolName: string,
  input: unknown,
  options?: {
    cwd?: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    log?: (message: string) => void;
  },
): Promise<McpOperationResult<McpToolCallResult>>;
export declare function listMcpCatalog(options?: {
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  withDescriptions?: boolean;
  probe?: boolean;
  log?: (message: string) => void;
}): Promise<{
  config: McpConfigState;
  probed: boolean;
  servers: McpCatalogServerResult[];
}>;
export declare function grepMcpTools(
  pattern: string,
  options?: {
    cwd?: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    withDescriptions?: boolean;
    log?: (message: string) => void;
  },
): Promise<{
  config: McpConfigState;
  matches: Array<{
    server: string;
    tool: McpServerToolSummary;
  }>;
  errors: Array<{
    server: string;
    error: string;
  }>;
}>;
export declare function authenticateMcpServer(
  serverName: string,
  options?: {
    cwd?: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    log?: (message: string) => void;
  },
): Promise<McpOperationResult<McpServerInfo>>;
/**
 * Trigger OAuth auth for a server config directly (no config-file lookup).
 * Connects to the server which initiates the browser OAuth flow if not already authenticated.
 */
export declare function authenticateMcpServerDirect(
  server: McpServerConfig,
  options?: {
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    log?: (message: string) => void;
  },
): Promise<McpOperationResult<McpServerInfo>>;
export declare function clearMcpServerAuth(
  serverName: string,
  options?: {
    cwd?: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void>;
/**
 * Check whether tokens exist on disk for the given server config.
 * Does not make any network calls.
 */
export declare function hasStoredMcpServerTokens(server: McpServerConfig): boolean;
/**
 * Clear stored OAuth tokens for a server config directly (no config-file lookup).
 */
export declare function clearMcpServerAuthDirect(server: McpServerConfig): Promise<void>;
