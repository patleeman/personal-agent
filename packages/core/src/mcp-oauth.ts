import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import net, { type AddressInfo } from 'node:net';
import { EventEmitter } from 'node:events';
import open from 'open';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { OAuthClientProvider, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  OAuthClientInformationFull,
  OAuthClientInformationFullSchema,
  OAuthProtectedResourceMetadataSchema,
  OAuthTokens,
  OAuthTokensSchema,
  type AuthorizationServerMetadata,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import { deleteConfigFile, readJsonFile, readTextFile, writeJsonFile, writeTextFile, checkLockfile, createLockfile, deleteLockfile } from './mcp-auth-storage.js';

export type McpTransportStrategy = 'sse-only' | 'http-only' | 'sse-first' | 'http-first';

export interface McpRemoteDiscoveryResult {
  authorizationServerUrl: string;
  authorizationServerMetadata?: AuthorizationServerMetadata;
  protectedResourceMetadata?: OAuthProtectedResourceMetadata;
  wwwAuthenticateScope?: string;
}

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

function emitLog(log: ((message: string) => void) | undefined, message: string): void {
  log?.(message);
}

function parseJsonResponse<T>(value: unknown): T | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as T;
}

async function fetchAuthorizationServerMetadata(serverUrl: string): Promise<AuthorizationServerMetadata | undefined> {
  const url = new URL(serverUrl);
  const metadataUrl = `${url.origin}/.well-known/oauth-authorization-server`;

  try {
    const response = await fetch(metadataUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return undefined;
    }

    return parseJsonResponse<AuthorizationServerMetadata>(await response.json());
  } catch {
    return undefined;
  }
}

function parseWwwAuthenticateHeader(header: string | null): {
  resourceMetadataUrl?: string;
  scope?: string;
} {
  if (!header) {
    return {};
  }

  const params: { resourceMetadataUrl?: string; scope?: string } = {};
  const paramString = header.replace(/^Bearer\s+/i, '');
  const pattern = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(paramString)) !== null) {
    const key = match[1];
    const value = match[2] ?? match[3] ?? '';

    if (key === 'resource_metadata') {
      params.resourceMetadataUrl = value;
    }

    if (key === 'scope') {
      params.scope = value;
    }
  }

  return params;
}

function buildProtectedResourceMetadataUrls(serverUrl: string): string[] {
  const url = new URL(serverUrl);
  const path = url.pathname.replace(/\/$/, '');
  const urls: string[] = [];

  if (path && path !== '/') {
    urls.push(`${url.origin}/.well-known/oauth-protected-resource${path}`);
  }

  urls.push(`${url.origin}/.well-known/oauth-protected-resource`);
  return urls;
}

async function fetchProtectedResourceMetadata(metadataUrl: string): Promise<OAuthProtectedResourceMetadata | undefined> {
  try {
    const response = await fetch(metadataUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return undefined;
    }

    return await OAuthProtectedResourceMetadataSchema.parseAsync(await response.json());
  } catch {
    return undefined;
  }
}

async function discoverProtectedResourceMetadata(
  serverUrl: string,
  wwwAuthenticateHeader?: string,
): Promise<OAuthProtectedResourceMetadata | undefined> {
  const parsedHeader = parseWwwAuthenticateHeader(wwwAuthenticateHeader ?? null);
  if (parsedHeader.resourceMetadataUrl) {
    const fromHeader = await fetchProtectedResourceMetadata(parsedHeader.resourceMetadataUrl);
    if (fromHeader) {
      return fromHeader;
    }
  }

  for (const metadataUrl of buildProtectedResourceMetadataUrls(serverUrl)) {
    const metadata = await fetchProtectedResourceMetadata(metadataUrl);
    if (metadata) {
      return metadata;
    }
  }

  return undefined;
}

export async function discoverOAuthServerInfo(
  serverUrl: string,
  headers: Record<string, string> = {},
): Promise<McpRemoteDiscoveryResult> {
  let wwwAuthenticateHeader: string | undefined;
  let wwwAuthenticateScope: string | undefined;

  try {
    const response = await fetch(serverUrl, {
      method: 'GET',
      headers: {
        ...headers,
        Accept: 'application/json, text/event-stream',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      return {
        authorizationServerUrl: serverUrl,
        authorizationServerMetadata: await fetchAuthorizationServerMetadata(serverUrl),
      };
    }

    if (response.status === 401) {
      wwwAuthenticateHeader = response.headers.get('WWW-Authenticate') ?? undefined;
      wwwAuthenticateScope = parseWwwAuthenticateHeader(wwwAuthenticateHeader ?? null).scope;
    }
  } catch {
    // Fall through to well-known discovery.
  }

  const protectedResourceMetadata = await discoverProtectedResourceMetadata(serverUrl, wwwAuthenticateHeader);
  const authorizationServerUrl = protectedResourceMetadata?.authorization_servers?.[0] ?? serverUrl;

  return {
    authorizationServerUrl,
    authorizationServerMetadata: await fetchAuthorizationServerMetadata(authorizationServerUrl),
    protectedResourceMetadata,
    wwwAuthenticateScope,
  };
}

interface OAuthCallbackServerState {
  server: Server;
  waitForAuthCode: () => Promise<string>;
  authCompletedPromise: Promise<string>;
}

function writeText(res: ServerResponse, statusCode: number, body: string, contentType = 'text/plain; charset=utf-8'): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', contentType);
  res.end(body);
}

function handleWaitForAuth(
  req: IncomingMessage,
  res: ServerResponse,
  state: {
    getAuthCode: () => string | null;
    authCompletedPromise: Promise<string>;
    authTimeoutMs: number;
    log?: (message: string) => void;
  },
): void {
  if (state.getAuthCode()) {
    writeText(res, 200, 'Authentication completed');
    return;
  }

  const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (requestUrl.searchParams.get('poll') === 'false') {
    writeText(res, 202, 'Authentication in progress');
    return;
  }

  const timeout = setTimeout(() => {
    writeText(res, 202, 'Authentication in progress');
  }, state.authTimeoutMs);

  void state.authCompletedPromise.then(() => {
    clearTimeout(timeout);
    if (!res.writableEnded) {
      writeText(res, 200, 'Authentication completed');
    }
  }).catch(() => {
    clearTimeout(timeout);
    if (!res.writableEnded) {
      writeText(res, 500, 'Authentication failed');
    }
  });
}

function setupOAuthCallbackServer(options: {
  port: number;
  path: string;
  events: EventEmitter;
  authTimeoutMs: number;
  log?: (message: string) => void;
}): OAuthCallbackServerState {
  let authCode: string | null = null;
  let authCompletedResolve: ((value: string) => void) | null = null;
  let authCompletedReject: ((reason?: unknown) => void) | null = null;
  const authCompletedPromise = new Promise<string>((resolve, reject) => {
    authCompletedResolve = resolve;
    authCompletedReject = reject;
  });

  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${options.port}`);

    if (req.method !== 'GET') {
      writeText(res, 405, 'Method not allowed');
      return;
    }

    if (requestUrl.pathname === '/wait-for-auth') {
      handleWaitForAuth(req, res, {
        getAuthCode: () => authCode,
        authCompletedPromise,
        authTimeoutMs: options.authTimeoutMs,
        log: options.log,
      });
      return;
    }

    if (requestUrl.pathname !== options.path) {
      writeText(res, 404, 'Not found');
      return;
    }

    const code = requestUrl.searchParams.get('code');
    const error = requestUrl.searchParams.get('error');

    if (error) {
      authCompletedReject?.(new Error(error));
      writeText(res, 400, `Authorization failed: ${error}`);
      return;
    }

    if (!code) {
      writeText(res, 400, 'No authorization code received');
      return;
    }

    authCode = code;
    authCompletedResolve?.(code);
    options.events.emit('auth-code-received', code);

    writeText(
      res,
      200,
      '<html><body><h1>Authorization successful</h1><p>You may close this window and return to the CLI.</p><script>window.close()</script></body></html>',
      'text/html; charset=utf-8',
    );
  });

  server.listen(options.port, '127.0.0.1');

  return {
    server,
    authCompletedPromise,
    waitForAuthCode: async () => {
      if (authCode) {
        return authCode;
      }

      return new Promise<string>((resolve) => {
        options.events.once('auth-code-received', (value) => {
          resolve(String(value));
        });
      });
    },
  };
}

async function isPidRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isLockValid(lockData: { pid: number; port: number; timestamp: number }): Promise<boolean> {
  const maxLockAgeMs = 30 * 60_000;
  if (Date.now() - lockData.timestamp > maxLockAgeMs) {
    return false;
  }

  if (!(await isPidRunning(lockData.pid))) {
    return false;
  }

  try {
    const response = await fetch(`http://127.0.0.1:${lockData.port}/wait-for-auth?poll=false`, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.status === 200 || response.status === 202;
  } catch {
    return false;
  }
}

async function waitForAuthentication(port: number): Promise<boolean> {
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/wait-for-auth`, {
        signal: AbortSignal.timeout(35_000),
      });

      if (response.status === 200) {
        return true;
      }

      if (response.status !== 202) {
        return false;
      }
    } catch {
      return false;
    }
  }
}

async function findExistingClientPort(serverUrlHash: string): Promise<number | undefined> {
  const clientInfo = await readJsonFile<OAuthClientInformationFull>(serverUrlHash, 'client_info.json', OAuthClientInformationFullSchema);
  if (!clientInfo) {
    return undefined;
  }

  for (const uri of clientInfo.redirect_uris) {
    try {
      const parsed = new URL(uri);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        const port = Number.parseInt(parsed.port, 10);
        if (Number.isFinite(port) && port > 0) {
          return port;
        }
      }
    } catch {
      // Ignore malformed redirect URIs.
    }
  }

  return undefined;
}

function calculateDefaultPort(serverUrlHash: string): number {
  const offset = Number.parseInt(serverUrlHash.slice(0, 4), 16);
  return 3335 + (offset % 45_816);
}

async function findAvailablePort(preferredPort?: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && preferredPort) {
        server.listen(0);
        return;
      }

      reject(error);
    });

    server.once('listening', () => {
      const address = server.address() as AddressInfo;
      server.close(() => resolve(address.port));
    });

    server.listen(preferredPort ?? 0);
  });
}

interface AuthInitializationState {
  server: Server;
  waitForAuthCode: () => Promise<string>;
  skipBrowserAuth: boolean;
}

function createLazyAuthCoordinator(options: {
  serverUrlHash: string;
  callbackPort: number;
  callbackPath: string;
  authTimeoutMs: number;
  log?: (message: string) => void;
}): {
  initializeAuth: () => Promise<AuthInitializationState>;
} {
  let state: AuthInitializationState | null = null;
  const events = new EventEmitter();

  return {
    initializeAuth: async () => {
      if (state) {
        return state;
      }

      const lockData = process.platform === 'win32' ? null : await checkLockfile(options.serverUrlHash);
      if (lockData && (await isLockValid(lockData))) {
        emitLog(options.log, `Another instance is handling authentication on port ${lockData.port}. Waiting for completion…`);
        if (await waitForAuthentication(lockData.port)) {
          const dummyServer = createServer((_req, res) => {
            writeText(res, 200, 'Shared authentication');
          }).listen(0, '127.0.0.1');

          state = {
            server: dummyServer,
            waitForAuthCode: () => new Promise<string>(() => {}),
            skipBrowserAuth: true,
          };
          return state;
        }

        await deleteLockfile(options.serverUrlHash);
      } else if (lockData) {
        await deleteLockfile(options.serverUrlHash);
      }

      const callbackServer = setupOAuthCallbackServer({
        port: options.callbackPort,
        path: options.callbackPath,
        events,
        authTimeoutMs: options.authTimeoutMs,
        log: options.log,
      });

      if (!callbackServer.server.listening) {
        await new Promise<void>((resolve) => {
          callbackServer.server.once('listening', () => resolve());
        });
      }

      const address = callbackServer.server.address() as AddressInfo | null;
      if (!address) {
        throw new Error('Failed to start OAuth callback server');
      }

      await createLockfile(options.serverUrlHash, process.pid, address.port);
      state = {
        server: callbackServer.server,
        waitForAuthCode: callbackServer.waitForAuthCode,
        skipBrowserAuth: false,
      };
      return state;
    },
  };
}

function shouldFallbackTransport(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error instanceof StreamableHTTPError) {
    return error.code === 404 || error.code === 405;
  }

  return error.message.includes('404') || error.message.includes('405') || error.message.includes('Not Found') || error.message.includes('Method Not Allowed');
}

async function connectToRemoteServer(options: {
  client: Client;
  serverUrl: string;
  authProvider: OAuthClientProvider;
  headers: Record<string, string>;
  authInitializer: () => Promise<{ waitForAuthCode: () => Promise<string>; skipBrowserAuth: boolean }>;
  transportStrategy: McpTransportStrategy;
  log?: (message: string) => void;
  recursionReasons?: Set<string>;
}): Promise<Transport> {
  const recursionReasons = options.recursionReasons ?? new Set<string>();
  const url = new URL(options.serverUrl);
  const preferSse = options.transportStrategy === 'sse-only' || options.transportStrategy === 'sse-first';
  const transport = preferSse
    ? new SSEClientTransport(url, {
        authProvider: options.authProvider,
        requestInit: { headers: options.headers },
      })
    : new StreamableHTTPClientTransport(url, {
        authProvider: options.authProvider,
        requestInit: { headers: options.headers },
      });

  try {
    await options.client.connect(transport);
    return transport;
  } catch (error) {
    if ((options.transportStrategy === 'http-first' || options.transportStrategy === 'sse-first')
      && shouldFallbackTransport(error)
      && !recursionReasons.has('transport-fallback')) {
      recursionReasons.add('transport-fallback');
      return connectToRemoteServer({
        ...options,
        transportStrategy: preferSse ? 'http-only' : 'sse-only',
        recursionReasons,
      });
    }

    if (!(error instanceof UnauthorizedError)) {
      throw error;
    }

    const authState = await options.authInitializer();
    if (authState.skipBrowserAuth) {
      emitLog(options.log, 'Authentication completed by another instance. Reconnecting with stored tokens…');
    } else {
      emitLog(options.log, 'Authentication required. Waiting for browser authorization…');
    }

    const code = await authState.waitForAuthCode();
    await transport.finishAuth(code);

    if (recursionReasons.has('authentication-needed')) {
      throw new Error('Authentication did not complete successfully.');
    }

    recursionReasons.add('authentication-needed');
    return connectToRemoteServer({
      ...options,
      recursionReasons,
    });
  }
}

export class PersonalAgentOAuthClientProvider implements OAuthClientProvider {
  private readonly stateId = randomUUID();
  private cachedClientInfo: OAuthClientInformationMixed | undefined;

  public constructor(private readonly input: {
    serverUrlHash: string;
    serverUrl: string;
    callbackHost: string;
    callbackPort: number;
    callbackPath: string;
    authorizeResource?: string;
    staticClientMetadata?: OAuthClientMetadata;
    staticClientInfo?: OAuthClientInformationFull;
    authorizationServerMetadata?: AuthorizationServerMetadata;
    protectedResourceMetadata?: OAuthProtectedResourceMetadata;
    wwwAuthenticateScope?: string;
    log?: (message: string) => void;
  }) {}

  public get redirectUrl(): string {
    return `http://${this.input.callbackHost}:${this.input.callbackPort}${this.input.callbackPath}`;
  }

  public get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_name: 'Personal Agent MCP Client',
      client_uri: 'https://github.com/patrickc/pa',
      software_id: 'personal-agent-mcp',
      software_version: '1',
      ...this.input.staticClientMetadata,
      scope: this.getEffectiveScope(),
    };
  }

  public state(): string {
    return this.stateId;
  }

  public async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this.input.staticClientInfo) {
      this.cachedClientInfo = this.input.staticClientInfo;
      return this.input.staticClientInfo;
    }

    const clientInfo = await readJsonFile<OAuthClientInformationFull>(
      this.input.serverUrlHash,
      'client_info.json',
      OAuthClientInformationFullSchema,
    );
    this.cachedClientInfo = clientInfo;
    return clientInfo;
  }

  public async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    this.cachedClientInfo = clientInformation;
    await writeJsonFile(this.input.serverUrlHash, 'client_info.json', clientInformation);
  }

  public async tokens(): Promise<OAuthTokens | undefined> {
    return readJsonFile<OAuthTokens>(this.input.serverUrlHash, 'tokens.json', OAuthTokensSchema);
  }

  public async saveTokens(tokens: OAuthTokens): Promise<void> {
    await writeJsonFile(this.input.serverUrlHash, 'tokens.json', tokens);
  }

  public async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.clientInformation();

    if (this.input.authorizeResource) {
      authorizationUrl.searchParams.set('resource', this.input.authorizeResource);
    }

    const scope = this.getEffectiveScope();
    if (scope) {
      authorizationUrl.searchParams.set('scope', scope);
    }

    emitLog(this.input.log, `Open this URL to authorize ${authorizationUrl.toString()}`);
    await open(authorizationUrl.toString());
  }

  public async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await writeTextFile(this.input.serverUrlHash, 'code_verifier.txt', codeVerifier);
  }

  public async codeVerifier(): Promise<string> {
    const verifier = await readTextFile(this.input.serverUrlHash, 'code_verifier.txt');
    if (!verifier) {
      throw new Error('Missing OAuth code verifier');
    }

    return verifier;
  }

  public async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    const deletions: string[] = [];

    if (scope === 'all' || scope === 'client') {
      deletions.push('client_info.json');
    }

    if (scope === 'all' || scope === 'tokens') {
      deletions.push('tokens.json');
    }

    if (scope === 'all' || scope === 'verifier') {
      deletions.push('code_verifier.txt');
    }

    if (scope === 'all' || scope === 'discovery') {
      deletions.push('discovery.json');
    }

    await Promise.all(deletions.map((filename) => deleteConfigFile(this.input.serverUrlHash, filename)));
  }

  public async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await writeJsonFile(this.input.serverUrlHash, 'discovery.json', state);
  }

  public async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return readJsonFile<OAuthDiscoveryState>(this.input.serverUrlHash, 'discovery.json', {
      async parseAsync(value: unknown): Promise<OAuthDiscoveryState> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Invalid discovery state');
        }

        return value as OAuthDiscoveryState;
      },
    });
  }

  private getEffectiveScope(): string {
    const metadataScope = this.input.staticClientMetadata?.scope;
    if (typeof metadataScope === 'string' && metadataScope.trim().length > 0) {
      return metadataScope;
    }

    if (typeof this.input.wwwAuthenticateScope === 'string' && this.input.wwwAuthenticateScope.trim().length > 0) {
      return this.input.wwwAuthenticateScope;
    }

    const protectedScopes = this.input.protectedResourceMetadata?.scopes_supported;
    if (Array.isArray(protectedScopes) && protectedScopes.length > 0) {
      return protectedScopes.join(' ');
    }

    const cachedScope = this.cachedClientInfo && 'scope' in this.cachedClientInfo && typeof this.cachedClientInfo.scope === 'string'
      ? this.cachedClientInfo.scope
      : undefined;
    if (cachedScope && cachedScope.trim().length > 0) {
      return cachedScope;
    }

    const serverScopes = this.input.authorizationServerMetadata?.scopes_supported;
    if (Array.isArray(serverScopes) && serverScopes.length > 0) {
      return serverScopes.join(' ');
    }

    return 'openid email profile';
  }
}

export function getMcpServerUrlHash(
  serverUrl: string,
  authorizeResource?: string,
  headers?: Record<string, string>,
): string {
  const parts = [serverUrl];
  if (authorizeResource) {
    parts.push(authorizeResource);
  }

  if (headers && Object.keys(headers).length > 0) {
    const keys = Object.keys(headers).sort();
    parts.push(JSON.stringify(headers, keys));
  }

  return createHash('md5').update(parts.join('|')).digest('hex');
}

export async function resolveCallbackPort(serverUrlHash: string, preferredPort?: number): Promise<number> {
  if (preferredPort && preferredPort > 0) {
    return preferredPort;
  }

  const existingClientPort = await findExistingClientPort(serverUrlHash);
  if (existingClientPort) {
    return existingClientPort;
  }

  return findAvailablePort(calculateDefaultPort(serverUrlHash));
}

export async function openRemoteMcpClient(options: McpRemoteOAuthOptions): Promise<McpRemoteClientConnection> {
  const client = new Client({
    name: 'personal-agent',
    version: '1.0.0',
  }, {
    capabilities: {},
  });

  emitLog(options.log, `Discovering OAuth server configuration for ${options.serverName}…`);
  const discovery = await discoverOAuthServerInfo(options.serverUrl, options.headers);
  const authProvider = new PersonalAgentOAuthClientProvider({
    serverUrlHash: options.serverUrlHash,
    serverUrl: discovery.authorizationServerUrl,
    callbackHost: options.callbackHost,
    callbackPort: options.callbackPort,
    callbackPath: options.callbackPath,
    authorizeResource: options.authorizeResource,
    staticClientMetadata: options.staticClientMetadata,
    staticClientInfo: options.staticClientInfo,
    authorizationServerMetadata: discovery.authorizationServerMetadata,
    protectedResourceMetadata: discovery.protectedResourceMetadata,
    wwwAuthenticateScope: discovery.wwwAuthenticateScope,
    log: options.log,
  });

  const authCoordinator = createLazyAuthCoordinator({
    serverUrlHash: options.serverUrlHash,
    callbackPort: options.callbackPort,
    callbackPath: options.callbackPath,
    authTimeoutMs: options.authTimeoutMs,
    log: options.log,
  });

  let callbackServer: Server | null = null;
  const transport = await connectToRemoteServer({
    client,
    serverUrl: options.serverUrl,
    authProvider,
    headers: options.headers,
    transportStrategy: options.transportStrategy,
    log: options.log,
    authInitializer: async () => {
      const initialized = await authCoordinator.initializeAuth();
      callbackServer = initialized.server;
      return initialized;
    },
  });

  return {
    client,
    transport,
    transportName: transport.constructor.name,
    close: async () => {
      try {
        await client.close();
      } finally {
        if (callbackServer) {
          await new Promise<void>((resolve) => callbackServer?.close(() => resolve()));
          callbackServer = null;
        }

        await deleteLockfile(options.serverUrlHash).catch(() => undefined);
      }
    },
  };
}
