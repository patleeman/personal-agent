import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { OAuthClientInformationFull, OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { getMcpServerUrlHash, openRemoteMcpClient, resolveCallbackPort, type McpTransportStrategy } from './mcp-oauth.js';
import { deleteConfigFile } from './mcp-auth-storage.js';

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

interface ParsedRemoteConfig {
  transport: 'remote';
  url: string;
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
}

export interface McpCatalogServerResult {
  name: string;
  info?: McpServerInfo;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeConfigPath(input: string, cwd: string): string {
  const trimmed = input.trim();
  if (trimmed === '~') {
    return homedir();
  }

  if (trimmed.startsWith('~/')) {
    return join(homedir(), trimmed.slice(2));
  }

  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd, trimmed);
}

function normalizeEnvMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function mergeStringEnv(...sources: Array<NodeJS.ProcessEnv | Record<string, string> | undefined>): Record<string, string> {
  const merged: Record<string, string> = {};

  for (const source of sources) {
    if (!source) {
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'string') {
        merged[key] = value;
      }
    }
  }

  return merged;
}

function looksLikeMcpRemotePackage(arg: string): boolean {
  return arg === 'mcp-remote' || arg.startsWith('mcp-remote@');
}

function looksLikeMcpRemoteCommand(command: string): boolean {
  const base = command.split('/').pop() ?? command;
  return base === 'mcp-remote';
}

function parseJsonArg<T>(input: string | undefined, baseDir: string): T | undefined {
  if (!input) {
    return undefined;
  }

  if (input.startsWith('@')) {
    const filePath = normalizeConfigPath(input.slice(1), baseDir);
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  }

  return JSON.parse(input) as T;
}

function synthesizeStaticClientInfo(input: {
  clientId?: string;
  clientSecret?: string;
  clientInfo?: OAuthClientInformationFull;
  clientMetadata?: OAuthClientMetadata;
  callbackHost?: string;
  callbackPort?: number;
  callbackPath?: string;
}): OAuthClientInformationFull | undefined {
  if (input.clientInfo) {
    return input.clientInfo;
  }

  if (!input.clientId) {
    return undefined;
  }

  const callbackHost = input.callbackHost ?? 'localhost';
  const callbackPort = input.callbackPort ?? 3334;
  const callbackPath = input.callbackPath ?? '/oauth/callback';
  const redirectUrl = `http://${callbackHost}:${callbackPort}${callbackPath}`;

  return {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uris: [redirectUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: input.clientSecret ? 'client_secret_post' : 'none',
    client_name: typeof input.clientMetadata?.client_name === 'string' ? input.clientMetadata.client_name : 'Personal Agent MCP Client',
    client_uri: typeof input.clientMetadata?.client_uri === 'string' ? input.clientMetadata.client_uri : 'https://github.com/patrickc/pa',
    scope: typeof input.clientMetadata?.scope === 'string' ? input.clientMetadata.scope : undefined,
    software_id: typeof input.clientMetadata?.software_id === 'string' ? input.clientMetadata.software_id : undefined,
    software_version: typeof input.clientMetadata?.software_version === 'string' ? input.clientMetadata.software_version : undefined,
  };
}

function parseMcpRemoteArgs(
  command: string | undefined,
  args: string[],
  baseDir: string,
): ParsedRemoteConfig | null {
  const commandIsRemote = command ? looksLikeMcpRemoteCommand(command) : false;
  const packageIndex = commandIsRemote ? -1 : args.findIndex(looksLikeMcpRemotePackage);

  if (!commandIsRemote && packageIndex < 0) {
    return null;
  }

  const remoteArgs = commandIsRemote ? [...args] : args.slice(packageIndex + 1);
  let url: string | undefined;
  let callbackPort: number | undefined;
  const headers: Record<string, string> = {};
  const ignoreTools: string[] = [];
  let authorizeResource: string | undefined;
  let callbackHost: string | undefined;
  let transportStrategy: McpTransportStrategy | undefined;
  let authTimeoutMs: number | undefined;
  let oauthClientMetadata: OAuthClientMetadata | undefined;
  let oauthClientInfo: OAuthClientInformationFull | undefined;

  for (let index = 0; index < remoteArgs.length; index += 1) {
    const arg = remoteArgs[index] as string;

    if (!url && /^https?:\/\//.test(arg)) {
      url = arg;
      const next = remoteArgs[index + 1];
      if (next && /^\d+$/.test(next)) {
        callbackPort = Number.parseInt(next, 10);
        index += 1;
      }
      continue;
    }

    if (arg === '--header') {
      const header = remoteArgs[index + 1];
      if (header) {
        const match = header.match(/^([^:]+):\s*(.*)$/);
        if (match) {
          headers[match[1] as string] = match[2] as string;
        }
        index += 1;
      }
      continue;
    }

    if (arg === '--resource') {
      authorizeResource = remoteArgs[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--host') {
      callbackHost = remoteArgs[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--transport') {
      const value = remoteArgs[index + 1];
      if (value === 'sse-only' || value === 'http-only' || value === 'sse-first' || value === 'http-first') {
        transportStrategy = value;
      }
      index += 1;
      continue;
    }

    if (arg === '--auth-timeout') {
      const value = remoteArgs[index + 1];
      if (value && /^\d+$/.test(value)) {
        authTimeoutMs = Number.parseInt(value, 10) * 1000;
      }
      index += 1;
      continue;
    }

    if (arg === '--ignore-tool') {
      const value = remoteArgs[index + 1];
      if (value) {
        ignoreTools.push(value);
      }
      index += 1;
      continue;
    }

    if (arg === '--static-oauth-client-metadata') {
      oauthClientMetadata = parseJsonArg<OAuthClientMetadata>(remoteArgs[index + 1], baseDir);
      index += 1;
      continue;
    }

    if (arg === '--static-oauth-client-info') {
      oauthClientInfo = parseJsonArg<OAuthClientInformationFull>(remoteArgs[index + 1], baseDir);
      index += 1;
      continue;
    }
  }

  if (!url) {
    return null;
  }

  return {
    transport: 'remote',
    url,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    authorizeResource,
    callbackHost,
    callbackPort,
    callbackPath: '/oauth/callback',
    transportStrategy,
    ignoreTools: ignoreTools.length > 0 ? ignoreTools : undefined,
    authTimeoutMs,
    oauthClientMetadata,
    oauthClientInfo,
  };
}

function parseRemoteServerConfig(
  name: string,
  value: Record<string, unknown>,
  baseDir: string,
): McpServerConfig | null {
  const url = typeof value.url === 'string' ? value.url : undefined;
  if (!url) {
    return null;
  }

  const callback = isRecord(value.callback) ? value.callback : undefined;
  const oauth = isRecord(value.oauth) ? value.oauth : undefined;
  const callbackHost = typeof callback?.host === 'string'
    ? callback.host
    : typeof value.callbackHost === 'string'
      ? value.callbackHost
      : undefined;
  const callbackPath = typeof callback?.path === 'string'
    ? callback.path
    : typeof value.callbackPath === 'string'
      ? value.callbackPath
      : undefined;
  const callbackPort = typeof callback?.port === 'number'
    ? callback.port
    : typeof value.callbackPort === 'number'
      ? value.callbackPort
      : undefined;
  const oauthClientMetadata = parseJsonArg<OAuthClientMetadata>(
    typeof oauth?.clientMetadataPath === 'string'
      ? `@${oauth.clientMetadataPath}`
      : undefined,
    baseDir,
  ) ?? (isRecord(oauth?.clientMetadata) ? oauth.clientMetadata as OAuthClientMetadata : undefined);
  const explicitClientInfo = parseJsonArg<OAuthClientInformationFull>(
    typeof oauth?.clientInfoPath === 'string'
      ? `@${oauth.clientInfoPath}`
      : undefined,
    baseDir,
  ) ?? (isRecord(oauth?.clientInfo) ? oauth.clientInfo as OAuthClientInformationFull : undefined);
  const oauthClientInfo = synthesizeStaticClientInfo({
    clientId: typeof oauth?.clientId === 'string' ? oauth.clientId : undefined,
    clientSecret: typeof oauth?.clientSecret === 'string' ? oauth.clientSecret : undefined,
    clientInfo: explicitClientInfo,
    clientMetadata: oauthClientMetadata,
    callbackHost,
    callbackPort,
    callbackPath,
  });

  const headers = normalizeEnvMap(value.headers);
  const ignoreTools = Array.isArray(value.ignoreTools)
    ? value.ignoreTools.filter((entry): entry is string => typeof entry === 'string')
    : undefined;

  return {
    name,
    transport: 'remote',
    args: [],
    url,
    env: normalizeEnvMap(value.env) ?? normalizeEnvMap(value.environment),
    headers,
    authorizeResource: typeof value.authorizeResource === 'string'
      ? value.authorizeResource
      : typeof oauth?.resource === 'string'
        ? oauth.resource
        : undefined,
    callbackHost,
    callbackPort,
    callbackPath,
    transportStrategy: value.transport === 'sse-only' || value.transport === 'http-only' || value.transport === 'sse-first' || value.transport === 'http-first'
      ? value.transport
      : undefined,
    ignoreTools,
    authTimeoutMs: typeof value.authTimeoutMs === 'number'
      ? value.authTimeoutMs
      : typeof value.authTimeoutSeconds === 'number'
        ? value.authTimeoutSeconds * 1000
        : undefined,
    oauthClientMetadata,
    oauthClientInfo,
    raw: value,
  };
}

function parseServerConfig(name: string, value: unknown, baseDir: string): McpServerConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.type === 'remote') {
    return parseRemoteServerConfig(name, value, baseDir);
  }

  const command = typeof value.command === 'string' ? value.command : undefined;
  const args = Array.isArray(value.args)
    ? value.args.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const cwd = typeof value.cwd === 'string' ? value.cwd : undefined;
  const env = normalizeEnvMap(value.env) ?? normalizeEnvMap(value.environment);
  const remoteConfig = parseMcpRemoteArgs(command, args, baseDir);

  if (remoteConfig) {
    return {
      name,
      command,
      args,
      cwd,
      env,
      raw: value,
      ...remoteConfig,
    };
  }

  return {
    name,
    transport: 'stdio',
    command,
    args,
    cwd,
    env,
    url: typeof value.url === 'string' ? value.url : undefined,
    raw: value,
  };
}

export function resolveMcpConfig(options: {
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): {
  path: string;
  exists: boolean;
  searchedPaths: string[];
} {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const env = options.env ?? process.env;
  const explicitPath = options.configPath ?? env.MCP_CONFIG_PATH;

  if (typeof explicitPath === 'string' && explicitPath.trim().length > 0) {
    const path = normalizeConfigPath(explicitPath, cwd);
    let exists = true;

    try {
      readFileSync(path, 'utf-8');
    } catch {
      exists = false;
    }

    return {
      path,
      exists,
      searchedPaths: [path],
    };
  }

  const searchedPaths = [
    resolve(cwd, 'mcp_servers.json'),
    join(homedir(), '.mcp_servers.json'),
    join(homedir(), '.config', 'mcp', 'mcp_servers.json'),
  ];

  const existingPath = searchedPaths.find((candidate) => {
    try {
      readFileSync(candidate, 'utf-8');
      return true;
    } catch {
      return false;
    }
  });

  return {
    path: existingPath ?? searchedPaths[searchedPaths.length - 1]!,
    exists: existingPath !== undefined,
    searchedPaths,
  };
}

export function readMcpConfig(options: {
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): McpConfigState {
  const resolved = resolveMcpConfig(options);
  if (!resolved.exists) {
    return {
      path: resolved.path,
      exists: false,
      searchedPaths: resolved.searchedPaths,
      servers: [],
    };
  }

  const parsed = JSON.parse(readFileSync(resolved.path, 'utf-8')) as unknown;
  const serversRecord = isRecord(parsed) && isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
  const configDir = dirname(resolved.path);
  const servers = Object.entries(serversRecord)
    .map(([name, value]) => parseServerConfig(name, value, configDir))
    .filter((entry): entry is McpServerConfig => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    path: resolved.path,
    exists: true,
    searchedPaths: resolved.searchedPaths,
    servers,
  };
}

function describeSchemaType(schema: unknown): string {
  if (!isRecord(schema)) {
    return 'unknown';
  }

  if (typeof schema.type === 'string') {
    return schema.type;
  }

  if (Array.isArray(schema.type)) {
    return schema.type.filter((entry): entry is string => typeof entry === 'string').join('|') || 'unknown';
  }

  if (Array.isArray(schema.anyOf)) {
    return 'anyOf';
  }

  if (Array.isArray(schema.oneOf)) {
    return 'oneOf';
  }

  return 'unknown';
}

function formatMcpServerOutput(input: {
  server: string;
  transport: string;
  commandLine?: string;
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  withDescriptions?: boolean;
}): string {
  const lines = [
    `Server: ${input.server}`,
    `Transport: ${input.transport}`,
  ];

  if (input.commandLine) {
    lines.push(`Command: ${input.commandLine}`);
  }

  lines.push('');
  lines.push(`Tools (${input.tools.length}):`);

  for (const tool of input.tools) {
    lines.push(`  ${tool.name}`);

    if (input.withDescriptions && tool.description) {
      lines.push(`    Description: ${tool.description}`);
    }

    const schema = isRecord(tool.inputSchema) ? tool.inputSchema : undefined;
    const properties = isRecord(schema?.properties) ? schema.properties : {};
    const required = Array.isArray(schema?.required)
      ? schema.required.filter((entry): entry is string => typeof entry === 'string')
      : [];

    if (Object.keys(properties).length > 0) {
      lines.push('    Parameters:');
      for (const [name, propertySchema] of Object.entries(properties)) {
        const requiredSuffix = required.includes(name) ? ', required' : '';
        lines.push(`      • ${name} (${describeSchemaType(propertySchema)}${requiredSuffix})`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

function formatMcpToolOutput(input: {
  server: string;
  tool: string;
  description?: string;
  schema?: Record<string, unknown>;
}): string {
  const lines = [
    `Tool: ${input.tool}`,
    `Server: ${input.server}`,
    '',
    'Description:',
    input.description ? `  ${input.description}` : '  ',
    '',
    'Input Schema:',
    JSON.stringify(input.schema ?? {}, null, 2),
  ];

  return `${lines.join('\n')}\n`;
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${escaped}$`, 'i');
}

function includeTool(ignorePatterns: string[] | undefined, toolName: string): boolean {
  if (!ignorePatterns || ignorePatterns.length === 0) {
    return true;
  }

  return ignorePatterns.every((pattern) => !patternToRegex(pattern).test(toolName));
}

function substituteEnvVars(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, name) => env[name] ?? '');
}

function resolveServerCommandLine(server: McpServerConfig): string | undefined {
  if (server.command) {
    return [server.command, ...server.args].join(' ');
  }

  return server.url;
}

function createClient(): Client {
  return new Client({
    name: 'personal-agent',
    version: '1.0.0',
  }, {
    capabilities: {},
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    void promise.then((value) => {
      clearTimeout(timeout);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function openMcpClient(server: McpServerConfig, options: {
  configPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  log?: (message: string) => void;
}): Promise<{
  client: Client;
  close: () => Promise<void>;
  transportName: string;
  stderr: () => string;
}> {
  const stderrChunks: string[] = [];

  if (server.transport === 'stdio') {
    if (!server.command) {
      throw new Error(`MCP server ${server.name} is missing a command`);
    }

    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      cwd: server.cwd ? normalizeConfigPath(server.cwd, dirname(options.configPath)) : options.cwd,
      env: mergeStringEnv(options.env, server.env),
      stderr: 'pipe',
    });

    transport.stderr?.on('data', (chunk) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
    });

    const client = createClient();
    await withTimeout(client.connect(transport), options.timeoutMs, `Connecting to ${server.name}`);

    return {
      client,
      transportName: 'stdio',
      stderr: () => stderrChunks.join('').trim(),
      close: async () => {
        await client.close();
      },
    };
  }

  if (!server.url) {
    throw new Error(`MCP server ${server.name} is missing a remote URL`);
  }

  const mergedEnv = mergeStringEnv(options.env, server.env);
  const resolvedHeaders = Object.fromEntries(
    Object.entries(server.headers ?? {}).map(([key, value]) => [key, substituteEnvVars(value, mergedEnv)]),
  );
  const callbackPort = await resolveCallbackPort(
    getMcpServerUrlHash(server.url, server.authorizeResource, resolvedHeaders),
    server.callbackPort,
  );
  const serverUrlHash = getMcpServerUrlHash(server.url, server.authorizeResource, resolvedHeaders);
  const connection = await withTimeout(openRemoteMcpClient({
    serverName: server.name,
    serverUrl: server.url,
    callbackHost: server.callbackHost ?? 'localhost',
    callbackPort,
    callbackPath: server.callbackPath ?? '/oauth/callback',
    transportStrategy: server.transportStrategy ?? 'http-first',
    headers: resolvedHeaders,
    authorizeResource: server.authorizeResource,
    staticClientMetadata: server.oauthClientMetadata,
    staticClientInfo: server.oauthClientInfo,
    authTimeoutMs: server.authTimeoutMs ?? options.timeoutMs,
    serverUrlHash,
    log: options.log,
  }), options.timeoutMs, `Connecting to ${server.name}`);

  return {
    client: connection.client,
    transportName: connection.transportName,
    stderr: () => '',
    close: connection.close,
  };
}

function findServer(config: McpConfigState, serverName: string): McpServerConfig {
  const server = config.servers.find((candidate) => candidate.name === serverName);
  if (!server) {
    throw new Error(`MCP server not found: ${serverName}`);
  }

  return server;
}

export async function inspectMcpServer(
  serverName: string,
  options: {
    cwd?: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    withDescriptions?: boolean;
    log?: (message: string) => void;
  } = {},
): Promise<McpOperationResult<McpServerInfo>> {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const env = options.env ?? process.env;
  const config = readMcpConfig({ cwd, configPath: options.configPath, env });
  const server = findServer(config, serverName);
  const stderrLogs: string[] = [];

  try {
    const connection = await openMcpClient(server, {
      configPath: config.path,
      cwd,
      env,
      timeoutMs,
      log: (message) => {
        stderrLogs.push(message);
        options.log?.(message);
      },
    });

    try {
      const toolsResult = await withTimeout(connection.client.listTools(), timeoutMs, `Listing tools for ${server.name}`);
      const tools = toolsResult.tools
        .filter((tool) => includeTool(server.ignoreTools, tool.name))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }));
      const commandLine = resolveServerCommandLine(server);
      const transport = server.transport === 'remote' ? connection.transportName : 'stdio';
      const info: McpServerInfo = {
        server: server.name,
        transport,
        commandLine,
        toolCount: tools.length,
        tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
        rawOutput: formatMcpServerOutput({
          server: server.name,
          transport,
          commandLine,
          tools,
          withDescriptions: options.withDescriptions,
        }),
      };

      const stderr = [connection.stderr(), ...stderrLogs].filter(Boolean).join('\n').trim();
      return {
        stdout: info.rawOutput,
        stderr,
        exitCode: 0,
        data: info,
      };
    } finally {
      await connection.close();
    }
  } catch (error) {
    return {
      stdout: '',
      stderr: stderrLogs.join('\n'),
      exitCode: 1,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function inspectMcpTool(
  serverName: string,
  toolName: string,
  options: {
    cwd?: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    log?: (message: string) => void;
  } = {},
): Promise<McpOperationResult<McpToolInfo>> {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const env = options.env ?? process.env;
  const config = readMcpConfig({ cwd, configPath: options.configPath, env });
  const server = findServer(config, serverName);
  const stderrLogs: string[] = [];

  try {
    const connection = await openMcpClient(server, {
      configPath: config.path,
      cwd,
      env,
      timeoutMs,
      log: (message) => {
        stderrLogs.push(message);
        options.log?.(message);
      },
    });

    try {
      const toolsResult = await withTimeout(connection.client.listTools(), timeoutMs, `Listing tools for ${server.name}`);
      const tool = toolsResult.tools.find((candidate) => candidate.name === toolName && includeTool(server.ignoreTools, candidate.name));
      if (!tool) {
        throw new Error(`Tool not found: ${serverName}/${toolName}`);
      }

      const schema = isRecord(tool.inputSchema) ? tool.inputSchema : {};
      const info: McpToolInfo = {
        server: serverName,
        tool: toolName,
        description: tool.description,
        schema,
        rawOutput: formatMcpToolOutput({
          server: serverName,
          tool: toolName,
          description: tool.description,
          schema,
        }),
      };

      const stderr = [connection.stderr(), ...stderrLogs].filter(Boolean).join('\n').trim();
      return {
        stdout: info.rawOutput,
        stderr,
        exitCode: 0,
        data: info,
      };
    } finally {
      await connection.close();
    }
  } catch (error) {
    return {
      stdout: '',
      stderr: stderrLogs.join('\n'),
      exitCode: 1,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function callMcpTool(
  serverName: string,
  toolName: string,
  input: unknown,
  options: {
    cwd?: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    log?: (message: string) => void;
  } = {},
): Promise<McpOperationResult<McpToolCallResult>> {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const env = options.env ?? process.env;
  const config = readMcpConfig({ cwd, configPath: options.configPath, env });
  const server = findServer(config, serverName);
  const stderrLogs: string[] = [];

  try {
    const connection = await openMcpClient(server, {
      configPath: config.path,
      cwd,
      env,
      timeoutMs,
      log: (message) => {
        stderrLogs.push(message);
        options.log?.(message);
      },
    });

    try {
      const result = await withTimeout(connection.client.callTool({
        name: toolName,
        arguments: isRecord(input) ? input : {},
      }), timeoutMs, `Calling ${server.name}/${toolName}`);
      const rawOutput = `${JSON.stringify(result, null, 2)}\n`;
      const stderr = [connection.stderr(), ...stderrLogs].filter(Boolean).join('\n').trim();

      return {
        stdout: rawOutput,
        stderr,
        exitCode: 0,
        data: {
          parsed: result,
          rawOutput,
        },
      };
    } finally {
      await connection.close();
    }
  } catch (error) {
    return {
      stdout: '',
      stderr: stderrLogs.join('\n'),
      exitCode: 1,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listMcpCatalog(options: {
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  withDescriptions?: boolean;
  log?: (message: string) => void;
} = {}): Promise<{
  config: McpConfigState;
  servers: McpCatalogServerResult[];
}> {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const env = options.env ?? process.env;
  const config = readMcpConfig({ cwd, configPath: options.configPath, env });
  const servers: McpCatalogServerResult[] = [];

  for (const server of config.servers) {
    const inspected = await inspectMcpServer(server.name, options);
    servers.push(inspected.data
      ? { name: server.name, info: inspected.data }
      : { name: server.name, error: (inspected.error ?? inspected.stderr) || 'Unknown MCP error' });
  }

  return { config, servers };
}

export async function grepMcpTools(
  pattern: string,
  options: {
    cwd?: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    withDescriptions?: boolean;
    log?: (message: string) => void;
  } = {},
): Promise<{
  config: McpConfigState;
  matches: Array<{ server: string; tool: McpServerToolSummary }>;
  errors: Array<{ server: string; error: string }>;
}> {
  const regex = patternToRegex(pattern);
  const catalog = await listMcpCatalog(options);
  const matches: Array<{ server: string; tool: McpServerToolSummary }> = [];
  const errors: Array<{ server: string; error: string }> = [];

  for (const server of catalog.servers) {
    if (server.info) {
      for (const tool of server.info.tools) {
        if (regex.test(tool.name) || regex.test(`${server.name}/${tool.name}`)) {
          matches.push({ server: server.name, tool });
        }
      }
      continue;
    }

    if (server.error) {
      errors.push({ server: server.name, error: server.error });
    }
  }

  return {
    config: catalog.config,
    matches,
    errors,
  };
}

export async function authenticateMcpServer(
  serverName: string,
  options: {
    cwd?: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    log?: (message: string) => void;
  } = {},
): Promise<McpOperationResult<McpServerInfo>> {
  return inspectMcpServer(serverName, {
    ...options,
    withDescriptions: false,
  });
}

export async function clearMcpServerAuth(
  serverName: string,
  options: {
    cwd?: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<void> {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const env = options.env ?? process.env;
  const config = readMcpConfig({ cwd, configPath: options.configPath, env });
  const server = findServer(config, serverName);

  if (server.transport !== 'remote' || !server.url) {
    throw new Error(`MCP server ${server.name} does not use remote OAuth auth state`);
  }

  const resolvedHeaders = Object.fromEntries(
    Object.entries(server.headers ?? {}).map(([key, value]) => [key, substituteEnvVars(value, env)]),
  );
  const serverUrlHash = getMcpServerUrlHash(server.url, server.authorizeResource, resolvedHeaders);
  await Promise.all([
    deleteConfigFile(serverUrlHash, 'tokens.json'),
    deleteConfigFile(serverUrlHash, 'client_info.json'),
    deleteConfigFile(serverUrlHash, 'code_verifier.txt'),
    deleteConfigFile(serverUrlHash, 'discovery.json'),
  ]);
}
