import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { Buffer } from 'node:buffer';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import type { DaemonConfig } from '../config.js';
import { readCompanionDeviceByToken, readCompanionDeviceAdminState, createCompanionPairingCode, pairCompanionDevice, revokeCompanionDevice, updateCompanionDeviceLabel } from './auth-store.js';
import { readCompanionHostState } from './host-state.js';
import { resolveCompanionRuntime } from './runtime.js';
import { buildCompanionSetupState } from './setup-links.js';
import {
  COMPANION_API_ROOT,
  COMPANION_PROTOCOL_VERSION,
  COMPANION_SOCKET_PATH,
  type CompanionAttachmentAssetInput,
  type CompanionAttachmentCreateInput,
  type CompanionAttachmentUpdateInput,
  type CompanionClientSocketMessage,
  type CompanionCommandMessage,
  type CompanionConversationAbortInput,
  type CompanionConversationBootstrapInput,
  type CompanionConversationCheckpointCreateInput,
  type CompanionConversationCreateInput,
  type CompanionConversationCwdChangeInput,
  type CompanionConversationDuplicateInput,
  type CompanionConversationExecutionTargetChangeInput,
  type CompanionConversationModelPreferencesUpdateInput,
  type CompanionConversationParallelJobInput,
  type CompanionConversationPromptInput,
  type CompanionConversationQueueRestoreInput,
  type CompanionConversationRenameInput,
  type CompanionConversationResumeInput,
  type CompanionConversationSubscriptionInput,
  type CompanionConversationTabsUpdateInput,
  type CompanionConversationTakeoverInput,
  type CompanionDurableRunLogInput,
  type CompanionRemoteDirectoryInput,
  type CompanionHostHello,
  type CompanionKnowledgeImportInput,
  type CompanionKnowledgeRenameInput,
  type CompanionPairedDeviceSummary,
  type CompanionRuntime,
  type CompanionRuntimeProvider,
  type CompanionScheduledTaskInput,
  type CompanionScheduledTaskUpdateInput,
  type CompanionSshTargetSaveInput,
  type CompanionSshTargetTestInput,
  type CompanionServerSocketMessage,
  type CompanionSetupState,
  type CompanionSocketErrorResponse,
  type CompanionSubscribeMessage,
  type CompanionSurfaceType,
  type CompanionUnsubscribeMessage,
} from './types.js';

const DEFAULT_DAEMON_VERSION = '0.0.0';
const JSON_LIMIT_BYTES = 12 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeHeaderValue(input: string | string[] | undefined): string {
  if (Array.isArray(input)) {
    return input[0] ?? '';
  }

  return typeof input === 'string' ? input : '';
}

function readBearerToken(request: IncomingMessage): string {
  const authorization = normalizeHeaderValue(request.headers.authorization).trim();
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return '';
  }

  return authorization.slice(7).trim();
}

function isLoopbackAddress(value: string | undefined): boolean {
  const normalized = value?.trim() || '';
  return normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '::ffff:127.0.0.1';
}

function parseJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > JSON_LIMIT_BYTES) {
        reject(new Error('Request body too large.'));
        request.destroy();
        return;
      }

      chunks.push(buffer);
    });

    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as unknown);
      } catch (error) {
        reject(error);
      }
    });

    request.on('error', reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, value: unknown): void {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf-8');
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendError(res: ServerResponse, statusCode: number, message: string): void {
  sendJson(res, statusCode, { error: message });
}

function readRequiredString(input: unknown, field: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }

  return input.trim();
}

function readOptionalString(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim().length > 0 ? input.trim() : undefined;
}

function readOptionalStringArray(input: unknown, field: string): string[] | undefined {
  if (input === undefined) {
    return undefined;
  }

  if (!Array.isArray(input)) {
    throw new Error(`${field} must be an array of strings when provided.`);
  }

  return input.map((value) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${field} must only contain non-empty strings.`);
    }
    return value.trim();
  });
}

function readOptionalPositiveInteger(input: unknown, field: string): number | undefined {
  if (input === undefined) {
    return undefined;
  }

  const value = typeof input === 'string'
    ? Number.parseInt(input, 10)
    : typeof input === 'number'
      ? input
      : Number.NaN;

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer when provided.`);
  }

  return value;
}

function readOptionalNonNegativeInteger(input: unknown, field: string): number | undefined {
  if (input === undefined) {
    return undefined;
  }

  const value = typeof input === 'string'
    ? Number.parseInt(input, 10)
    : typeof input === 'number'
      ? input
      : Number.NaN;

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer when provided.`);
  }

  return value;
}

function normalizeSurfaceType(input: unknown): CompanionSurfaceType | undefined {
  return input === 'desktop_ui' || input === 'ios_native'
    ? input
    : undefined;
}

function buildHello(stateRoot: string): CompanionHostHello {
  const host = readCompanionHostState(stateRoot);
  return {
    hostInstanceId: host.hostInstanceId,
    hostLabel: host.hostLabel,
    daemonVersion: process.env.npm_package_version?.trim() || DEFAULT_DAEMON_VERSION,
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    transport: {
      websocket: true,
      singleSocket: true,
      httpAvailable: true,
    },
    auth: {
      pairingRequired: true,
      bearerTokens: true,
    },
    capabilities: {
      fullConversationLifecycle: true,
      executionTargets: true,
      executionTargetSwitching: true,
      attachments: true,
      attachmentWrite: true,
      knowledge: true,
      knowledgeWrite: true,
      knowledgeImport: true,
      deviceAdmin: true,
    },
  };
}

function normalizeCompanionRequestPathname(pathname: string): string {
  if (pathname === '/v1' || pathname.startsWith('/v1/')) {
    return `/companion${pathname}`;
  }

  return pathname;
}

function buildSetupState(
  stateRoot: string,
  config: DaemonConfig,
  pairing = createCompanionPairingCode(stateRoot),
  portOverride?: number,
): CompanionSetupState {
  const host = readCompanionHostState(stateRoot);
  const effectiveConfig: DaemonConfig = {
    ...config,
    companion: {
      ...config.companion,
      enabled: config.companion?.enabled ?? true,
      host: config.companion?.host ?? '127.0.0.1',
      port: portOverride ?? config.companion?.port ?? 3843,
    },
  };
  return buildCompanionSetupState({
    config: effectiveConfig,
    pairing,
    hostLabel: host.hostLabel,
    hostInstanceId: host.hostInstanceId,
  });
}

async function resolveRuntimeOrThrow(
  config: DaemonConfig,
  providerOverride?: CompanionRuntimeProvider,
): Promise<CompanionRuntime> {
  const runtime = providerOverride
    ? await providerOverride(config)
    : await resolveCompanionRuntime(config);
  if (!runtime) {
    throw new Error('Companion runtime unavailable.');
  }

  return runtime;
}

function parseSocketMessage(raw: string): CompanionClientSocketMessage {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Socket message must be an object.');
  }

  const id = readRequiredString(parsed.id, 'id');
  const type = readRequiredString(parsed.type, 'type');
  if (type === 'command') {
    return {
      id,
      type: 'command',
      name: readRequiredString(parsed.name, 'name'),
      payload: parsed.payload,
    } satisfies CompanionCommandMessage;
  }

  if (type === 'subscribe') {
    const topic = readRequiredString(parsed.topic, 'topic');
    if (topic !== 'app' && topic !== 'conversation') {
      throw new Error('Unsupported subscription topic.');
    }

    return {
      id,
      type: 'subscribe',
      topic,
      ...(typeof parsed.key === 'string' ? { key: parsed.key } : {}),
      payload: parsed.payload,
    } satisfies CompanionSubscribeMessage;
  }

  if (type === 'unsubscribe') {
    const topic = readRequiredString(parsed.topic, 'topic');
    if (topic !== 'app' && topic !== 'conversation') {
      throw new Error('Unsupported unsubscription topic.');
    }

    return {
      id,
      type: 'unsubscribe',
      topic,
      ...(typeof parsed.key === 'string' ? { key: parsed.key } : {}),
    } satisfies CompanionUnsubscribeMessage;
  }

  throw new Error('Unsupported socket message type.');
}

function buildSocketErrorResponse(id: string, error: unknown): CompanionSocketErrorResponse {
  return {
    id,
    type: 'response',
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

function writeSocketMessage(socket: WebSocket, message: CompanionServerSocketMessage): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
}

export class DaemonCompanionServer {
  private httpServer?: HttpServer;
  private websocketServer?: WebSocketServer;
  private listeningAddress: { host: string; port: number } | null = null;

  constructor(
    private readonly config: DaemonConfig,
    private readonly stateRoot: string,
    private readonly runtimeProvider?: CompanionRuntimeProvider,
  ) {}

  async start(): Promise<void> {
    if (this.config.companion?.enabled === false || this.httpServer) {
      return;
    }

    this.websocketServer = new WebSocketServer({ noServer: true });
    this.httpServer = createServer((request, response) => {
      void this.handleHttpRequest(request, response).catch((error) => {
        sendError(response, 500, error instanceof Error ? error.message : String(error));
      });
    });

    this.httpServer.on('upgrade', (request, socket, head) => {
      void this.handleUpgrade(request, socket, head).catch(() => {
        socket.destroy();
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer?.once('error', reject);
      this.httpServer?.listen(this.config.companion?.port ?? 3843, this.config.companion?.host ?? '127.0.0.1', () => resolve());
    });

    const address = this.httpServer.address();
    if (address && typeof address === 'object') {
      const info = address as AddressInfo;
      this.listeningAddress = {
        host: info.address,
        port: info.port,
      };
    }
  }

  async stop(): Promise<void> {
    this.websocketServer?.clients.forEach((client) => {
      try {
        client.close();
      } catch {
        // Ignore best-effort close failures.
      }
    });
    this.websocketServer?.close();
    this.websocketServer = undefined;

    await new Promise<void>((resolve) => {
      if (!this.httpServer) {
        resolve();
        return;
      }

      this.httpServer.close(() => resolve());
    });

    this.httpServer = undefined;
    this.listeningAddress = null;
  }

  getUrl(): string | null {
    if (!this.listeningAddress) {
      return null;
    }

    const host = this.listeningAddress.host.includes(':') ? `[${this.listeningAddress.host}]` : this.listeningAddress.host;
    return `http://${host}:${this.listeningAddress.port}`;
  }

  private async authenticateBearer(request: IncomingMessage) {
    const token = readBearerToken(request);
    if (!token) {
      return null;
    }

    return readCompanionDeviceByToken(this.stateRoot, token);
  }

  private async requireBearer(request: IncomingMessage, response: ServerResponse) {
    const device = await this.authenticateBearer(request);
    if (!device) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      sendError(response, 401, 'Companion authentication required.');
      return null;
    }

    return device;
  }

  private async requireAdminAccess(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (isLoopbackAddress(request.socket.remoteAddress)) {
      return true;
    }

    const device = await this.authenticateBearer(request);
    if (device) {
      return true;
    }

    response.setHeader('WWW-Authenticate', 'Bearer');
    sendError(response, 401, 'Companion admin access requires loopback or a paired device token.');
    return false;
  }

  private async handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    const pathname = normalizeCompanionRequestPathname(requestUrl.pathname);

    if (request.method === 'GET' && pathname === `${COMPANION_API_ROOT}/hello`) {
      sendJson(response, 200, buildHello(this.stateRoot));
      return;
    }

    if (request.method === 'POST' && pathname === `${COMPANION_API_ROOT}/auth/pair`) {
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const code = readRequiredString(payload.code, 'code');
      const deviceLabel = readOptionalString(payload.deviceLabel);
      const paired = pairCompanionDevice(this.stateRoot, code, { deviceLabel });
      sendJson(response, 201, {
        bearerToken: paired.bearerToken,
        device: paired.device,
        hello: buildHello(this.stateRoot),
      });
      return;
    }

    if (request.method === 'POST' && pathname === `${COMPANION_API_ROOT}/admin/pairing-codes`) {
      if (!await this.requireAdminAccess(request, response)) {
        return;
      }

      sendJson(response, 201, createCompanionPairingCode(this.stateRoot));
      return;
    }

    if (request.method === 'POST' && pathname === `${COMPANION_API_ROOT}/admin/setup`) {
      if (!await this.requireAdminAccess(request, response)) {
        return;
      }

      sendJson(response, 201, buildSetupState(this.stateRoot, this.config, undefined, this.listeningAddress?.port));
      return;
    }

    if (request.method === 'GET' && pathname === `${COMPANION_API_ROOT}/admin/devices`) {
      if (!await this.requireAdminAccess(request, response)) {
        return;
      }

      sendJson(response, 200, readCompanionDeviceAdminState(this.stateRoot));
      return;
    }

    const patchDeviceMatch = /^\/companion\/v1\/admin\/devices\/([^/]+)$/.exec(pathname);
    if (patchDeviceMatch && request.method === 'PATCH') {
      if (!await this.requireAdminAccess(request, response)) {
        return;
      }

      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const deviceId = decodeURIComponent(patchDeviceMatch[1] || '');
      const deviceLabel = readRequiredString(payload.deviceLabel, 'deviceLabel');
      const updated = updateCompanionDeviceLabel(this.stateRoot, deviceId, deviceLabel);
      if (!updated) {
        sendError(response, 404, 'Device not found.');
        return;
      }

      sendJson(response, 200, { device: updated, devices: readCompanionDeviceAdminState(this.stateRoot).devices });
      return;
    }

    const deleteDeviceMatch = /^\/companion\/v1\/admin\/devices\/([^/]+)$/.exec(pathname);
    if (deleteDeviceMatch && request.method === 'DELETE') {
      if (!await this.requireAdminAccess(request, response)) {
        return;
      }

      const deviceId = decodeURIComponent(deleteDeviceMatch[1] || '');
      const revoked = revokeCompanionDevice(this.stateRoot, deviceId);
      if (!revoked) {
        sendError(response, 404, 'Device not found.');
        return;
      }

      sendJson(response, 200, { ok: true, deleted: true, devices: readCompanionDeviceAdminState(this.stateRoot).devices });
      return;
    }

    if (request.method === 'GET' && pathname === `${COMPANION_API_ROOT}/models`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.readModels());
      return;
    }

    if (request.method === 'GET' && pathname === `${COMPANION_API_ROOT}/ssh-targets`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.listSshTargets());
      return;
    }

    if (request.method === 'POST' && pathname === `${COMPANION_API_ROOT}/ssh-targets`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const input: CompanionSshTargetSaveInput = {
        ...(readOptionalString(payload.id) ? { id: readOptionalString(payload.id) } : {}),
        label: readRequiredString(payload.label, 'label'),
        sshTarget: readRequiredString(payload.sshTarget, 'sshTarget'),
      };
      sendJson(response, 200, await runtime.saveSshTarget(input));
      return;
    }

    const sshTargetMatch = /^\/companion\/v1\/ssh-targets\/([^/]+)$/.exec(pathname);
    if (sshTargetMatch && request.method === 'PATCH') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const input: CompanionSshTargetSaveInput = {
        id: decodeURIComponent(sshTargetMatch[1] || ''),
        label: readRequiredString(payload.label, 'label'),
        sshTarget: readRequiredString(payload.sshTarget, 'sshTarget'),
      };
      sendJson(response, 200, await runtime.saveSshTarget(input));
      return;
    }

    if (sshTargetMatch && request.method === 'DELETE') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.deleteSshTarget(decodeURIComponent(sshTargetMatch[1] || '')));
      return;
    }

    const executionTargetDirectoryMatch = /^\/companion\/v1\/(?:execution-targets|ssh-targets)\/([^/]+)\/directories$/.exec(pathname);
    if (executionTargetDirectoryMatch && request.method === 'GET') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const input: CompanionRemoteDirectoryInput = {
        executionTargetId: decodeURIComponent(executionTargetDirectoryMatch[1] || ''),
        ...(requestUrl.searchParams.has('path') ? { path: requestUrl.searchParams.get('path') } : {}),
      };
      sendJson(response, 200, await runtime.readRemoteDirectory(input));
      return;
    }

    if (request.method === 'POST' && pathname === `${COMPANION_API_ROOT}/ssh-targets/test`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const input: CompanionSshTargetTestInput = {
        sshTarget: readRequiredString(payload.sshTarget, 'sshTarget'),
      };
      sendJson(response, 200, await runtime.testSshTarget(input));
      return;
    }

    if (request.method === 'GET' && pathname === `${COMPANION_API_ROOT}/knowledge/tree`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.listKnowledgeEntries(requestUrl.searchParams.get('dir')));
      return;
    }

    if (request.method === 'GET' && pathname === `${COMPANION_API_ROOT}/knowledge/file`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.readKnowledgeFile(readRequiredString(requestUrl.searchParams.get('id'), 'id')));
      return;
    }

    if (request.method === 'PUT' && pathname === `${COMPANION_API_ROOT}/knowledge/file`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      if (typeof payload.content !== 'string') {
        throw new Error('content must be a string.');
      }
      sendJson(response, 200, await runtime.writeKnowledgeFile({
        fileId: readRequiredString(payload.id, 'id'),
        content: payload.content,
      }));
      return;
    }

    if (request.method === 'POST' && pathname === `${COMPANION_API_ROOT}/knowledge/folder`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      sendJson(response, 201, await runtime.createKnowledgeFolder(readRequiredString(payload.id, 'id')));
      return;
    }

    if (request.method === 'POST' && pathname === `${COMPANION_API_ROOT}/knowledge/rename`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const input: CompanionKnowledgeRenameInput = {
        id: readRequiredString(payload.id, 'id'),
        newName: readRequiredString(payload.newName, 'newName'),
      };
      sendJson(response, 200, await runtime.renameKnowledgeEntry(input));
      return;
    }

    if (request.method === 'DELETE' && pathname === `${COMPANION_API_ROOT}/knowledge/entry`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      await runtime.deleteKnowledgeEntry(readRequiredString(requestUrl.searchParams.get('id'), 'id'));
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'POST' && pathname === `${COMPANION_API_ROOT}/knowledge/import`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const kind = readRequiredString(payload.kind, 'kind');
      if (kind !== 'text' && kind !== 'url' && kind !== 'image') {
        throw new Error('kind must be text, url, or image.');
      }
      const input: CompanionKnowledgeImportInput = {
        kind,
        ...(payload.directoryId !== undefined ? { directoryId: payload.directoryId === null ? null : readOptionalString(payload.directoryId) } : {}),
        ...(payload.title !== undefined ? { title: payload.title === null ? null : readOptionalString(payload.title) } : {}),
        ...(payload.text !== undefined ? { text: payload.text === null ? null : readOptionalString(payload.text) } : {}),
        ...(payload.url !== undefined ? { url: payload.url === null ? null : readOptionalString(payload.url) } : {}),
        ...(payload.mimeType !== undefined ? { mimeType: payload.mimeType === null ? null : readOptionalString(payload.mimeType) } : {}),
        ...(payload.fileName !== undefined ? { fileName: payload.fileName === null ? null : readOptionalString(payload.fileName) } : {}),
        ...(payload.dataBase64 !== undefined ? { dataBase64: payload.dataBase64 === null ? null : readOptionalString(payload.dataBase64) } : {}),
        ...(payload.sourceApp !== undefined ? { sourceApp: payload.sourceApp === null ? null : readOptionalString(payload.sourceApp) } : {}),
        ...(payload.createdAt !== undefined ? { createdAt: payload.createdAt === null ? null : readOptionalString(payload.createdAt) } : {}),
      };
      sendJson(response, 201, await runtime.importKnowledge(input));
      return;
    }

    if (request.method === 'GET' && pathname === `${COMPANION_API_ROOT}/conversations`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.listConversations());
      return;
    }

    if (request.method === 'PATCH' && pathname === `${COMPANION_API_ROOT}/conversations/layout`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const input: CompanionConversationTabsUpdateInput = {
        ...(payload.sessionIds !== undefined ? { sessionIds: readOptionalStringArray(payload.sessionIds, 'sessionIds') } : {}),
        ...(payload.pinnedSessionIds !== undefined ? { pinnedSessionIds: readOptionalStringArray(payload.pinnedSessionIds, 'pinnedSessionIds') } : {}),
        ...(payload.archivedSessionIds !== undefined ? { archivedSessionIds: readOptionalStringArray(payload.archivedSessionIds, 'archivedSessionIds') } : {}),
        ...(payload.workspacePaths !== undefined ? { workspacePaths: readOptionalStringArray(payload.workspacePaths, 'workspacePaths') } : {}),
      };
      sendJson(response, 200, await runtime.updateConversationTabs(input));
      return;
    }

    const duplicateConversationMatch = /^\/companion\/v1\/conversations\/([^/]+)\/duplicate$/.exec(pathname);
    if (duplicateConversationMatch && request.method === 'POST') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const input: CompanionConversationDuplicateInput = {
        conversationId: decodeURIComponent(duplicateConversationMatch[1] || ''),
      };
      sendJson(response, 200, await runtime.duplicateConversation(input));
      return;
    }

    const conversationQueueRestoreMatch = /^\/companion\/v1\/conversations\/([^/]+)\/dequeue$/.exec(pathname);
    if (conversationQueueRestoreMatch && request.method === 'POST') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const input: CompanionConversationQueueRestoreInput = {
        conversationId: decodeURIComponent(conversationQueueRestoreMatch[1] || ''),
        behavior: payload.behavior === 'followUp' ? 'followUp' : 'steer',
        index: readOptionalNonNegativeInteger(payload.index, 'index') ?? 0,
        ...(readOptionalString(payload.previewId) ? { previewId: readOptionalString(payload.previewId) } : {}),
        ...(readOptionalString(payload.surfaceId) ? { surfaceId: readOptionalString(payload.surfaceId) } : {}),
      };
      sendJson(response, 200, await runtime.restoreConversationQueuePrompt(input));
      return;
    }

    const conversationParallelJobMatch = /^\/companion\/v1\/conversations\/([^/]+)\/parallel-jobs\/([^/]+)$/.exec(pathname);
    if (conversationParallelJobMatch && request.method === 'POST') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const action = readRequiredString(payload.action, 'action');
      if (action !== 'importNow' && action !== 'skip' && action !== 'cancel') {
        throw new Error('action must be importNow, skip, or cancel.');
      }
      const input: CompanionConversationParallelJobInput = {
        conversationId: decodeURIComponent(conversationParallelJobMatch[1] || ''),
        jobId: decodeURIComponent(conversationParallelJobMatch[2] || ''),
        action,
        ...(readOptionalString(payload.surfaceId) ? { surfaceId: readOptionalString(payload.surfaceId) } : {}),
      };
      sendJson(response, 200, await runtime.manageConversationParallelJob(input));
      return;
    }

    const conversationCwdMatch = /^\/companion\/v1\/conversations\/([^/]+)\/cwd$/.exec(pathname);
    if (conversationCwdMatch && request.method === 'POST') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const input: CompanionConversationCwdChangeInput = {
        conversationId: decodeURIComponent(conversationCwdMatch[1] || ''),
        cwd: readRequiredString(payload.cwd, 'cwd'),
        ...(readOptionalString(payload.surfaceId) ? { surfaceId: readOptionalString(payload.surfaceId) } : {}),
      };
      sendJson(response, 200, await runtime.changeConversationCwd(input));
      return;
    }

    const modelPreferencesMatch = /^\/companion\/v1\/conversations\/([^/]+)\/model-preferences$/.exec(pathname);
    if (modelPreferencesMatch && request.method === 'GET') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.readConversationModelPreferences(decodeURIComponent(modelPreferencesMatch[1] || '')));
      return;
    }

    if (modelPreferencesMatch && request.method === 'PATCH') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const input: CompanionConversationModelPreferencesUpdateInput = {
        conversationId: decodeURIComponent(modelPreferencesMatch[1] || ''),
        ...(payload.model !== undefined ? { model: payload.model === null ? null : readOptionalString(payload.model) } : {}),
        ...(payload.thinkingLevel !== undefined ? { thinkingLevel: payload.thinkingLevel === null ? null : readOptionalString(payload.thinkingLevel) } : {}),
        ...(payload.serviceTier !== undefined ? { serviceTier: payload.serviceTier === null ? null : readOptionalString(payload.serviceTier) } : {}),
        ...(readOptionalString(payload.surfaceId) ? { surfaceId: readOptionalString(payload.surfaceId) } : {}),
      };
      sendJson(response, 200, await runtime.updateConversationModelPreferences(input));
      return;
    }

    const artifactsMatch = /^\/companion\/v1\/conversations\/([^/]+)\/artifacts$/.exec(pathname);
    if (artifactsMatch && request.method === 'GET') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const conversationId = decodeURIComponent(artifactsMatch[1] || '');
      sendJson(response, 200, await runtime.listConversationArtifacts(conversationId));
      return;
    }

    const artifactMatch = /^\/companion\/v1\/conversations\/([^/]+)\/artifacts\/([^/]+)$/.exec(pathname);
    if (artifactMatch && request.method === 'GET') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.readConversationArtifact({
        conversationId: decodeURIComponent(artifactMatch[1] || ''),
        artifactId: decodeURIComponent(artifactMatch[2] || ''),
      }));
      return;
    }

    const checkpointsMatch = /^\/companion\/v1\/conversations\/([^/]+)\/checkpoints$/.exec(pathname);
    if (checkpointsMatch && request.method === 'GET') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const conversationId = decodeURIComponent(checkpointsMatch[1] || '');
      sendJson(response, 200, await runtime.listConversationCheckpoints(conversationId));
      return;
    }

    if (checkpointsMatch && request.method === 'POST') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const input: CompanionConversationCheckpointCreateInput = {
        conversationId: decodeURIComponent(checkpointsMatch[1] || ''),
        message: readRequiredString(payload.message, 'message'),
        paths: readOptionalStringArray(payload.paths, 'paths') ?? [],
      };
      sendJson(response, 201, await runtime.createConversationCheckpoint(input));
      return;
    }

    const checkpointMatch = /^\/companion\/v1\/conversations\/([^/]+)\/checkpoints\/([^/]+)$/.exec(pathname);
    if (checkpointMatch && request.method === 'GET') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.readConversationCheckpoint({
        conversationId: decodeURIComponent(checkpointMatch[1] || ''),
        checkpointId: decodeURIComponent(checkpointMatch[2] || ''),
      }));
      return;
    }

    const attachmentsMatch = /^\/companion\/v1\/conversations\/([^/]+)\/attachments$/.exec(pathname);
    if (attachmentsMatch && request.method === 'GET') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const conversationId = decodeURIComponent(attachmentsMatch[1] || '');
      sendJson(response, 200, await runtime.listConversationAttachments(conversationId));
      return;
    }

    if (attachmentsMatch && request.method === 'POST') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const input: CompanionAttachmentCreateInput = {
        conversationId: decodeURIComponent(attachmentsMatch[1] || ''),
        kind: payload.kind === 'excalidraw' ? 'excalidraw' : undefined,
        title: readOptionalString(payload.title),
        sourceData: readOptionalString(payload.sourceData),
        sourceName: readOptionalString(payload.sourceName),
        sourceMimeType: readOptionalString(payload.sourceMimeType),
        previewData: readOptionalString(payload.previewData),
        previewName: readOptionalString(payload.previewName),
        previewMimeType: readOptionalString(payload.previewMimeType),
        note: readOptionalString(payload.note),
      };
      sendJson(response, 200, await runtime.createConversationAttachment(input));
      return;
    }

    const attachmentMatch = /^\/companion\/v1\/conversations\/([^/]+)\/attachments\/([^/]+)$/.exec(pathname);
    if (attachmentMatch && request.method === 'GET') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.readConversationAttachment({
        conversationId: decodeURIComponent(attachmentMatch[1] || ''),
        attachmentId: decodeURIComponent(attachmentMatch[2] || ''),
      }));
      return;
    }

    if (attachmentMatch && request.method === 'PATCH') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const input: CompanionAttachmentUpdateInput = {
        conversationId: decodeURIComponent(attachmentMatch[1] || ''),
        attachmentId: decodeURIComponent(attachmentMatch[2] || ''),
        kind: payload.kind === 'excalidraw' ? 'excalidraw' : undefined,
        title: readOptionalString(payload.title),
        sourceData: readOptionalString(payload.sourceData),
        sourceName: readOptionalString(payload.sourceName),
        sourceMimeType: readOptionalString(payload.sourceMimeType),
        previewData: readOptionalString(payload.previewData),
        previewName: readOptionalString(payload.previewName),
        previewMimeType: readOptionalString(payload.previewMimeType),
        note: readOptionalString(payload.note),
      };
      sendJson(response, 200, await runtime.updateConversationAttachment(input));
      return;
    }

    const assetMatch = /^\/companion\/v1\/conversations\/([^/]+)\/attachments\/([^/]+)\/assets\/(source|preview)$/.exec(pathname);
    if (assetMatch && request.method === 'GET') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const input: CompanionAttachmentAssetInput = {
        conversationId: decodeURIComponent(assetMatch[1] || ''),
        attachmentId: decodeURIComponent(assetMatch[2] || ''),
        asset: assetMatch[3] === 'source' ? 'source' : 'preview',
        ...(requestUrl.searchParams.has('revision')
          ? { revision: readOptionalPositiveInteger(requestUrl.searchParams.get('revision'), 'revision') }
          : {}),
      };
      const asset = await runtime.readConversationAttachmentAsset(input);
      response.writeHead(200, {
        'Content-Type': asset.mimeType,
        'Content-Length': String(asset.data.byteLength),
        'Cache-Control': 'no-store',
        ...(asset.fileName
          ? { 'Content-Disposition': `${asset.disposition ?? (input.asset === 'preview' ? 'inline' : 'attachment')}; filename="${asset.fileName.replace(/"/g, '')}"` }
          : {}),
      });
      response.end(Buffer.from(asset.data));
      return;
    }

    if (request.method === 'GET' && pathname === `${COMPANION_API_ROOT}/tasks`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.listScheduledTasks());
      return;
    }

    if (request.method === 'POST' && pathname === `${COMPANION_API_ROOT}/tasks`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const input: CompanionScheduledTaskInput = {
        ...(payload.title !== undefined ? { title: readOptionalString(payload.title) } : {}),
        ...(payload.enabled !== undefined ? { enabled: Boolean(payload.enabled) } : {}),
        ...(payload.cron !== undefined ? { cron: payload.cron === null ? null : readOptionalString(payload.cron) } : {}),
        ...(payload.at !== undefined ? { at: payload.at === null ? null : readOptionalString(payload.at) } : {}),
        ...(payload.model !== undefined ? { model: payload.model === null ? null : readOptionalString(payload.model) } : {}),
        ...(payload.thinkingLevel !== undefined ? { thinkingLevel: payload.thinkingLevel === null ? null : readOptionalString(payload.thinkingLevel) } : {}),
        ...(payload.cwd !== undefined ? { cwd: payload.cwd === null ? null : readOptionalString(payload.cwd) } : {}),
        ...(payload.timeoutSeconds !== undefined ? { timeoutSeconds: payload.timeoutSeconds === null ? null : readOptionalPositiveInteger(payload.timeoutSeconds, 'timeoutSeconds') } : {}),
        ...(payload.prompt !== undefined ? { prompt: readOptionalString(payload.prompt) } : {}),
        ...(payload.targetType !== undefined ? { targetType: payload.targetType === null ? null : readOptionalString(payload.targetType) } : {}),
        ...(payload.conversationBehavior !== undefined ? { conversationBehavior: payload.conversationBehavior === null ? null : readOptionalString(payload.conversationBehavior) } : {}),
        ...(payload.callbackConversationId !== undefined ? { callbackConversationId: payload.callbackConversationId === null ? null : readOptionalString(payload.callbackConversationId) } : {}),
        ...(payload.deliverOnSuccess !== undefined ? { deliverOnSuccess: payload.deliverOnSuccess === null ? null : Boolean(payload.deliverOnSuccess) } : {}),
        ...(payload.deliverOnFailure !== undefined ? { deliverOnFailure: payload.deliverOnFailure === null ? null : Boolean(payload.deliverOnFailure) } : {}),
        ...(payload.notifyOnSuccess !== undefined ? { notifyOnSuccess: payload.notifyOnSuccess === null ? null : readOptionalString(payload.notifyOnSuccess) } : {}),
        ...(payload.notifyOnFailure !== undefined ? { notifyOnFailure: payload.notifyOnFailure === null ? null : readOptionalString(payload.notifyOnFailure) } : {}),
        ...(payload.requireAck !== undefined ? { requireAck: payload.requireAck === null ? null : Boolean(payload.requireAck) } : {}),
        ...(payload.autoResumeIfOpen !== undefined ? { autoResumeIfOpen: payload.autoResumeIfOpen === null ? null : Boolean(payload.autoResumeIfOpen) } : {}),
        ...(payload.threadMode !== undefined ? { threadMode: payload.threadMode === null ? null : readOptionalString(payload.threadMode) } : {}),
        ...(payload.threadConversationId !== undefined ? { threadConversationId: payload.threadConversationId === null ? null : readOptionalString(payload.threadConversationId) } : {}),
      };
      sendJson(response, 201, await runtime.createScheduledTask(input));
      return;
    }

    const taskMatch = /^\/companion\/v1\/tasks\/([^/]+)$/.exec(pathname);
    if (taskMatch && request.method === 'GET') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.readScheduledTask(decodeURIComponent(taskMatch[1] || '')));
      return;
    }

    if (taskMatch && request.method === 'PATCH') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const body = await parseJsonBody(request);
      const payload = isRecord(body) ? body : {};
      const input: CompanionScheduledTaskUpdateInput = {
        taskId: decodeURIComponent(taskMatch[1] || ''),
        ...(payload.title !== undefined ? { title: readOptionalString(payload.title) } : {}),
        ...(payload.enabled !== undefined ? { enabled: Boolean(payload.enabled) } : {}),
        ...(payload.cron !== undefined ? { cron: payload.cron === null ? null : readOptionalString(payload.cron) } : {}),
        ...(payload.at !== undefined ? { at: payload.at === null ? null : readOptionalString(payload.at) } : {}),
        ...(payload.model !== undefined ? { model: payload.model === null ? null : readOptionalString(payload.model) } : {}),
        ...(payload.thinkingLevel !== undefined ? { thinkingLevel: payload.thinkingLevel === null ? null : readOptionalString(payload.thinkingLevel) } : {}),
        ...(payload.cwd !== undefined ? { cwd: payload.cwd === null ? null : readOptionalString(payload.cwd) } : {}),
        ...(payload.timeoutSeconds !== undefined ? { timeoutSeconds: payload.timeoutSeconds === null ? null : readOptionalPositiveInteger(payload.timeoutSeconds, 'timeoutSeconds') } : {}),
        ...(payload.prompt !== undefined ? { prompt: readOptionalString(payload.prompt) } : {}),
        ...(payload.targetType !== undefined ? { targetType: payload.targetType === null ? null : readOptionalString(payload.targetType) } : {}),
        ...(payload.conversationBehavior !== undefined ? { conversationBehavior: payload.conversationBehavior === null ? null : readOptionalString(payload.conversationBehavior) } : {}),
        ...(payload.callbackConversationId !== undefined ? { callbackConversationId: payload.callbackConversationId === null ? null : readOptionalString(payload.callbackConversationId) } : {}),
        ...(payload.deliverOnSuccess !== undefined ? { deliverOnSuccess: payload.deliverOnSuccess === null ? null : Boolean(payload.deliverOnSuccess) } : {}),
        ...(payload.deliverOnFailure !== undefined ? { deliverOnFailure: payload.deliverOnFailure === null ? null : Boolean(payload.deliverOnFailure) } : {}),
        ...(payload.notifyOnSuccess !== undefined ? { notifyOnSuccess: payload.notifyOnSuccess === null ? null : readOptionalString(payload.notifyOnSuccess) } : {}),
        ...(payload.notifyOnFailure !== undefined ? { notifyOnFailure: payload.notifyOnFailure === null ? null : readOptionalString(payload.notifyOnFailure) } : {}),
        ...(payload.requireAck !== undefined ? { requireAck: payload.requireAck === null ? null : Boolean(payload.requireAck) } : {}),
        ...(payload.autoResumeIfOpen !== undefined ? { autoResumeIfOpen: payload.autoResumeIfOpen === null ? null : Boolean(payload.autoResumeIfOpen) } : {}),
        ...(payload.threadMode !== undefined ? { threadMode: payload.threadMode === null ? null : readOptionalString(payload.threadMode) } : {}),
        ...(payload.threadConversationId !== undefined ? { threadConversationId: payload.threadConversationId === null ? null : readOptionalString(payload.threadConversationId) } : {}),
      };
      sendJson(response, 200, await runtime.updateScheduledTask(input));
      return;
    }

    if (taskMatch && request.method === 'DELETE') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.deleteScheduledTask(decodeURIComponent(taskMatch[1] || '')));
      return;
    }

    const taskLogMatch = /^\/companion\/v1\/tasks\/([^/]+)\/log$/.exec(pathname);
    if (taskLogMatch && request.method === 'GET') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.readScheduledTaskLog(decodeURIComponent(taskLogMatch[1] || '')));
      return;
    }

    const taskRunMatch = /^\/companion\/v1\/tasks\/([^/]+)\/run$/.exec(pathname);
    if (taskRunMatch && request.method === 'POST') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.runScheduledTask(decodeURIComponent(taskRunMatch[1] || '')));
      return;
    }

    if (request.method === 'GET' && pathname === `${COMPANION_API_ROOT}/runs`) {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.listDurableRuns());
      return;
    }

    const runMatch = /^\/companion\/v1\/runs\/([^/]+)$/.exec(pathname);
    if (runMatch && request.method === 'GET') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.readDurableRun(decodeURIComponent(runMatch[1] || '')));
      return;
    }

    const runLogMatch = /^\/companion\/v1\/runs\/([^/]+)\/log$/.exec(pathname);
    if (runLogMatch && request.method === 'GET') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      const input: CompanionDurableRunLogInput = {
        runId: decodeURIComponent(runLogMatch[1] || ''),
        ...(requestUrl.searchParams.has('tail') ? { tail: readOptionalPositiveInteger(requestUrl.searchParams.get('tail'), 'tail') } : {}),
      };
      sendJson(response, 200, await runtime.readDurableRunLog(input));
      return;
    }

    const runCancelMatch = /^\/companion\/v1\/runs\/([^/]+)\/cancel$/.exec(pathname);
    if (runCancelMatch && request.method === 'POST') {
      if (!await this.requireBearer(request, response)) {
        return;
      }

      const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
      sendJson(response, 200, await runtime.cancelDurableRun(decodeURIComponent(runCancelMatch[1] || '')));
      return;
    }

    sendError(response, 404, 'Not found.');
  }

  private async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const requestUrl = new URL(request.url || '/', 'http://localhost');
    if (normalizeCompanionRequestPathname(requestUrl.pathname) !== COMPANION_SOCKET_PATH) {
      socket.destroy();
      return;
    }

    const device = await this.authenticateBearer(request);
    if (!device) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    this.websocketServer?.handleUpgrade(request, socket, head, (websocket) => {
      void this.handleSocketConnection(websocket, device);
    });
  }

  private async handleSocketConnection(websocket: WebSocket, device: CompanionPairedDeviceSummary): Promise<void> {
    const subscriptions = new Map<string, () => void>();
    const hello = buildHello(this.stateRoot);
    writeSocketMessage(websocket, {
      type: 'ready',
      hello,
      device,
    });

    const closeAllSubscriptions = () => {
      for (const unsubscribe of subscriptions.values()) {
        try {
          unsubscribe();
        } catch {
          // Ignore best-effort cleanup failures.
        }
      }
      subscriptions.clear();
    };

    websocket.on('message', (data) => {
      void (async () => {
        try {
          const message = parseSocketMessage(typeof data === 'string' ? data : data.toString('utf-8'));
          if (message.type === 'command') {
            const result = await this.handleSocketCommand(message);
            writeSocketMessage(websocket, {
              id: message.id,
              type: 'response',
              ok: true,
              result,
            });
            return;
          }

          if (message.type === 'subscribe') {
            const subscriptionKey = `${message.topic}:${message.key ?? 'app'}`;
            subscriptions.get(subscriptionKey)?.();
            const unsubscribe = await this.handleSocketSubscribe(message, (event) => {
              writeSocketMessage(websocket, event);
            });
            subscriptions.set(subscriptionKey, unsubscribe);
            writeSocketMessage(websocket, {
              id: message.id,
              type: 'response',
              ok: true,
              result: { subscribed: true, topic: message.topic, key: message.key ?? 'app' },
            });
            return;
          }

          const subscriptionKey = `${message.topic}:${message.key ?? 'app'}`;
          subscriptions.get(subscriptionKey)?.();
          subscriptions.delete(subscriptionKey);
          writeSocketMessage(websocket, {
            id: message.id,
            type: 'response',
            ok: true,
            result: { unsubscribed: true, topic: message.topic, key: message.key ?? 'app' },
          });
        } catch (error) {
          const parsed = (() => {
            try {
              return JSON.parse(typeof data === 'string' ? data : data.toString('utf-8')) as { id?: unknown };
            } catch {
              return null;
            }
          })();
          const id = parsed && typeof parsed.id === 'string' ? parsed.id : 'unknown';
          writeSocketMessage(websocket, buildSocketErrorResponse(id, error));
        }
      })();
    });

    websocket.on('close', () => {
      closeAllSubscriptions();
    });
    websocket.on('error', () => {
      closeAllSubscriptions();
    });
  }

  private async handleSocketCommand(message: CompanionCommandMessage): Promise<unknown> {
    const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);
    const payload = isRecord(message.payload) ? message.payload : {};

    switch (message.name) {
      case 'conversations.list':
        return runtime.listConversations();
      case 'executionTargets.list':
        return runtime.listExecutionTargets();
      case 'conversation.bootstrap': {
        const input: CompanionConversationBootstrapInput = {
          conversationId: readRequiredString(payload.conversationId, 'conversationId'),
          tailBlocks: readOptionalPositiveInteger(payload.tailBlocks, 'tailBlocks'),
          knownSessionSignature: readOptionalString(payload.knownSessionSignature),
          knownBlockOffset: readOptionalNonNegativeInteger(payload.knownBlockOffset, 'knownBlockOffset'),
          knownTotalBlocks: readOptionalNonNegativeInteger(payload.knownTotalBlocks, 'knownTotalBlocks'),
          knownLastBlockId: readOptionalString(payload.knownLastBlockId),
        };
        return runtime.readConversationBootstrap(input);
      }
      case 'conversation.create': {
        const promptPayload = isRecord(payload.prompt) ? payload.prompt : null;
        const input: CompanionConversationCreateInput = {
          cwd: readOptionalString(payload.cwd),
          model: payload.model === null ? null : readOptionalString(payload.model),
          thinkingLevel: payload.thinkingLevel === null ? null : readOptionalString(payload.thinkingLevel),
          serviceTier: payload.serviceTier === null ? null : readOptionalString(payload.serviceTier),
          executionTargetId: payload.executionTargetId === null ? null : readOptionalString(payload.executionTargetId),
          ...(promptPayload
            ? {
                prompt: {
                  text: readOptionalString(promptPayload.text),
                  behavior: promptPayload.behavior === 'steer' || promptPayload.behavior === 'followUp'
                    ? promptPayload.behavior
                    : undefined,
                  images: Array.isArray(promptPayload.images) ? promptPayload.images as CompanionConversationPromptInput['images'] : undefined,
                  attachmentRefs: Array.isArray(promptPayload.attachmentRefs) ? promptPayload.attachmentRefs as CompanionConversationPromptInput['attachmentRefs'] : undefined,
                  contextMessages: Array.isArray(promptPayload.contextMessages) ? promptPayload.contextMessages as CompanionConversationPromptInput['contextMessages'] : undefined,
                  surfaceId: readOptionalString(promptPayload.surfaceId),
                },
              }
            : {}),
        };
        return runtime.createConversation(input);
      }
      case 'conversation.resume': {
        const input: CompanionConversationResumeInput = {
          sessionFile: readRequiredString(payload.sessionFile, 'sessionFile'),
          cwd: readOptionalString(payload.cwd),
          executionTargetId: payload.executionTargetId === null ? null : readOptionalString(payload.executionTargetId),
        };
        return runtime.resumeConversation(input);
      }
      case 'conversation.prompt':
      case 'conversation.parallel_prompt': {
        const input: CompanionConversationPromptInput = {
          conversationId: readRequiredString(payload.conversationId, 'conversationId'),
          text: readOptionalString(payload.text),
          behavior: payload.behavior === 'steer' || payload.behavior === 'followUp'
            ? payload.behavior
            : undefined,
          images: Array.isArray(payload.images) ? payload.images as CompanionConversationPromptInput['images'] : undefined,
          attachmentRefs: Array.isArray(payload.attachmentRefs) ? payload.attachmentRefs as CompanionConversationPromptInput['attachmentRefs'] : undefined,
          contextMessages: Array.isArray(payload.contextMessages) ? payload.contextMessages as CompanionConversationPromptInput['contextMessages'] : undefined,
          surfaceId: readOptionalString(payload.surfaceId),
        };
        if (message.name === 'conversation.parallel_prompt') {
          return runtime.parallelPromptConversation(input);
        }
        return runtime.promptConversation(input);
      }
      case 'conversation.abort': {
        const input: CompanionConversationAbortInput = {
          conversationId: readRequiredString(payload.conversationId, 'conversationId'),
        };
        return runtime.abortConversation(input);
      }
      case 'conversation.takeover': {
        const input: CompanionConversationTakeoverInput = {
          conversationId: readRequiredString(payload.conversationId, 'conversationId'),
          surfaceId: readRequiredString(payload.surfaceId, 'surfaceId'),
        };
        return runtime.takeOverConversation(input);
      }
      case 'conversation.rename': {
        const input: CompanionConversationRenameInput = {
          conversationId: readRequiredString(payload.conversationId, 'conversationId'),
          name: readRequiredString(payload.name, 'name'),
          surfaceId: readOptionalString(payload.surfaceId),
        };
        return runtime.renameConversation(input);
      }
      case 'conversation.change_execution_target': {
        const input: CompanionConversationExecutionTargetChangeInput = {
          conversationId: readRequiredString(payload.conversationId, 'conversationId'),
          executionTargetId: readRequiredString(payload.executionTargetId, 'executionTargetId'),
          ...(payload.cwd === null ? { cwd: null } : {}),
          ...(readOptionalString(payload.cwd) ? { cwd: readOptionalString(payload.cwd) } : {}),
        };
        return runtime.changeConversationExecutionTarget(input);
      }
      default:
        throw new Error(`Unsupported companion command: ${message.name}`);
    }
  }

  private async handleSocketSubscribe(
    message: CompanionSubscribeMessage,
    emit: (event: CompanionServerSocketMessage) => void,
  ): Promise<() => void> {
    const runtime = await resolveRuntimeOrThrow(this.config, this.runtimeProvider);

    if (message.topic === 'app') {
      return runtime.subscribeApp((event) => {
        emit({
          type: 'event',
          topic: 'app',
          key: 'app',
          event,
        });
      });
    }

    const payload = isRecord(message.payload) ? message.payload : {};
    const conversationId = message.key?.trim() || readRequiredString(payload.conversationId, 'conversationId');
    const input: CompanionConversationSubscriptionInput = {
      conversationId,
      surfaceId: readOptionalString(payload.surfaceId),
      surfaceType: normalizeSurfaceType(payload.surfaceType),
      tailBlocks: readOptionalPositiveInteger(payload.tailBlocks, 'tailBlocks'),
    };

    return runtime.subscribeConversation(input, (event) => {
      emit({
        type: 'event',
        topic: 'conversation',
        key: conversationId,
        event,
      });
    });
  }
}
