import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChildProcess } from 'node:child_process';
import { getAvailableTcpPort } from './backend/ports.js';
import { applyRemoteMetadataToSessionContent, stripRemoteMetadataFromSessionContent } from './conversation-session-header.js';
import { ensurePiReleaseBinary } from './pi-release-cache.js';
import { parseRemotePlatform, type RemotePlatformInfo } from './remote-platform.js';
import { resolveRemoteHelperBinary } from './remote-helper-bundle.js';
import { downloadFileOverScp, runSshCommand, spawnSshTunnel, uploadFileOverScp } from './system-ssh.js';

export interface RemoteDirectoryEntry {
  name: string;
  path: string;
  isDir: boolean;
  isHidden: boolean;
}

export interface RemoteDirectoryListing {
  path: string;
  parent?: string;
  entries: RemoteDirectoryEntry[];
}

interface HelperRuntimeInfo {
  helperVersion: string;
  pid: number;
  port: number;
  cwd: string;
  sessionFile: string;
  piPath: string;
  piPid?: number;
  isStreaming: boolean;
  startedAt: string;
}

interface HelperResponseEnvelope {
  type: 'response';
  id?: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

interface HelperEventEnvelope {
  type: 'event';
  event: Record<string, unknown>;
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function renderRemotePathForShell(value: string): string {
  if (value.startsWith('~/')) {
    const suffix = value.slice(2).replace(/"/g, '\\"');
    return `"$HOME/${suffix}"`;
  }

  if (value === '~') {
    return '"$HOME"';
  }

  return quoteForShell(value);
}

function renderRemoteCommand(value: string): string {
  return value;
}

function buildRemoteBaseDir(): string {
  return '~/.cache/personal-agent/ssh-runtime';
}

function buildRemoteConversationRunDir(conversationId: string): string {
  return `${buildRemoteBaseDir()}/conversations/${conversationId}`;
}

function buildRemoteSessionFile(conversationId: string): string {
  return `${buildRemoteConversationRunDir(conversationId)}/session.jsonl`;
}

function buildRemotePiDir(version: string, platform: RemotePlatformInfo): string {
  return `${buildRemoteBaseDir()}/pi/${version}/${platform.key}`;
}

function buildRemoteHelperDir(version: string, platform: RemotePlatformInfo): string {
  return `${buildRemoteBaseDir()}/helper/${version}/${platform.key}`;
}

function buildRemotePiPath(version: string, platform: RemotePlatformInfo): string {
  return `${buildRemotePiDir(version, platform)}/pi`;
}

function buildRemoteHelperPath(version: string, platform: RemotePlatformInfo): string {
  return `${buildRemoteHelperDir(version, platform)}/pa-ssh-remote-helper`;
}

function parseHelperResponse(line: string): HelperResponseEnvelope | HelperEventEnvelope {
  return JSON.parse(line) as HelperResponseEnvelope | HelperEventEnvelope;
}

function isHelperRuntimeInfo(value: unknown): value is HelperRuntimeInfo {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.port === 'number'
    && typeof candidate.cwd === 'string'
    && typeof candidate.sessionFile === 'string'
    && typeof candidate.helperVersion === 'string'
    && typeof candidate.pid === 'number'
    && typeof candidate.startedAt === 'string';
}

export class SshRemoteConversationRuntime {
  private platformPromise: Promise<RemotePlatformInfo> | null = null;
  private helperRuntimeInfo: HelperRuntimeInfo | null = null;
  private tunnelProcess: ChildProcess | null = null;
  private socket: Socket | null = null;
  private connectingPromise: Promise<void> | null = null;
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private readonly eventSubscribers = new Set<(event: Record<string, unknown>) => void>();
  private buffer = '';

  constructor(
    private readonly sshTarget: string,
    private readonly hostId: string,
    private readonly hostLabel: string,
  ) {}

  async detectRemotePlatform(): Promise<RemotePlatformInfo> {
    if (!this.platformPromise) {
      this.platformPromise = (async () => {
        const output = runSshCommand(this.sshTarget, 'uname -s && uname -m');
        const [rawOs = '', rawArch = ''] = output.trim().split(/\r?\n/);
        return parseRemotePlatform({ os: rawOs, arch: rawArch });
      })();
    }

    return this.platformPromise;
  }

  async readDirectory(path: string | null | undefined): Promise<RemoteDirectoryListing> {
    const platform = await this.detectRemotePlatform();
    const helperBinary = resolveRemoteHelperBinary(platform);
    const remoteHelperPath = buildRemoteHelperPath(helperBinary.version, platform);
    await this.ensureRemoteHelperInstalled(platform, helperBinary.version, helperBinary.path);

    const normalizedPath = typeof path === 'string' ? path.trim() : '';
    const command = [
      `${renderRemotePathForShell(remoteHelperPath)}`,
      'list-dir',
      '--path',
      quoteForShell(normalizedPath),
    ].join(' ');
    const output = runSshCommand(this.sshTarget, renderRemoteCommand(command)).trim();
    return JSON.parse(output) as RemoteDirectoryListing;
  }

  async ensureRuntime(input: {
    conversationId: string;
    cwd: string;
    sessionContent?: string;
    fallbackSessionContent?: string;
  }): Promise<HelperRuntimeInfo> {
    const normalizedCwd = input.cwd.trim();
    if (!normalizedCwd) {
      throw new Error('Remote cwd is required.');
    }

    const platform = await this.detectRemotePlatform();
    const [piBinary, helperBinary] = await Promise.all([
      ensurePiReleaseBinary(platform),
      Promise.resolve(resolveRemoteHelperBinary(platform)),
    ]);

    await this.ensureRemotePiInstalled(platform, piBinary.version, piBinary.path);
    await this.ensureRemoteHelperInstalled(platform, helperBinary.version, helperBinary.path);

    const remoteRunDir = buildRemoteConversationRunDir(input.conversationId);
    const remoteSessionFile = buildRemoteSessionFile(input.conversationId);
    const remotePiPath = buildRemotePiPath(piBinary.version, platform);
    const remoteHelperPath = buildRemoteHelperPath(helperBinary.version, platform);

    runSshCommand(this.sshTarget, `mkdir -p ${renderRemotePathForShell(remoteRunDir)}`);
    if (typeof input.sessionContent === 'string') {
      this.uploadSessionContent(remoteSessionFile, input.sessionContent);
    } else if (typeof input.fallbackSessionContent === 'string') {
      const remoteSessionExists = this.remoteFileExists(remoteSessionFile);
      if (!remoteSessionExists) {
        this.uploadSessionContent(remoteSessionFile, input.fallbackSessionContent);
      }
    }

    const launchCommand = [
      `${renderRemotePathForShell(remoteHelperPath)}`,
      'launch',
      '--run-dir', renderRemotePathForShell(remoteRunDir),
      '--pi', renderRemotePathForShell(remotePiPath),
      '--session', renderRemotePathForShell(remoteSessionFile),
      '--cwd', quoteForShell(normalizedCwd),
    ].join(' ');
    const output = runSshCommand(this.sshTarget, renderRemoteCommand(launchCommand)).trim();
    const runtimeInfo = JSON.parse(output) as HelperRuntimeInfo;
    if (!isHelperRuntimeInfo(runtimeInfo)) {
      throw new Error(`Remote helper for ${this.hostLabel} returned malformed runtime info.`);
    }

    this.helperRuntimeInfo = runtimeInfo;
    await this.ensureHelperConnection();
    return runtimeInfo;
  }

  async requestHelper(input: { type: string; command?: Record<string, unknown>; cwd?: string }): Promise<unknown> {
    await this.ensureHelperConnection();
    const socket = this.socket;
    if (!socket) {
      throw new Error(`Remote runtime for ${this.hostLabel} is not connected.`);
    }

    const requestId = `${Date.now().toString(36)}-${this.nextRequestId++}`;
    const payload = {
      id: requestId,
      type: input.type,
      ...(input.command ? { command: input.command } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
      socket.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) {
          return;
        }

        const pending = this.pendingRequests.get(requestId);
        this.pendingRequests.delete(requestId);
        pending?.reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  subscribeEvents(listener: (event: Record<string, unknown>) => void): () => void {
    this.eventSubscribers.add(listener);
    return () => {
      this.eventSubscribers.delete(listener);
    };
  }

  async restartRuntime(cwd: string): Promise<HelperRuntimeInfo> {
    const response = await this.requestHelper({ type: 'restart', cwd }) as unknown;
    if (!isHelperRuntimeInfo(response)) {
      throw new Error(`Remote runtime for ${this.hostLabel} returned malformed restart info.`);
    }
    this.helperRuntimeInfo = response;
    return response;
  }

  async shutdownRuntime(conversationId: string, removeRunDir = true): Promise<void> {
    try {
      await this.requestHelper({ type: 'shutdown' });
    } catch {
      // Best effort only.
    } finally {
      this.disposeConnection();
    }

    if (removeRunDir) {
      const remoteRunDir = buildRemoteConversationRunDir(conversationId);
      runSshCommand(this.sshTarget, `rm -rf ${renderRemotePathForShell(remoteRunDir)}`);
    }
  }

  async syncRemoteSessionToLocal(input: {
    conversationId: string;
    localFilePath: string;
  }): Promise<void> {
    const remoteSessionFile = buildRemoteSessionFile(input.conversationId);
    const tempDir = mkdtempSync(join(tmpdir(), 'personal-agent-remote-session-'));
    const tempFile = join(tempDir, 'session.jsonl');

    try {
      downloadFileOverScp({
        target: this.sshTarget,
        remotePath: remoteSessionFile,
        localPath: tempFile,
      });
      if (!existsSync(tempFile)) {
        return;
      }

      const content = readFileSync(tempFile, 'utf-8');
      const nextContent = applyRemoteMetadataToSessionContent(content, {
        remoteHostId: this.hostId,
        remoteHostLabel: this.hostLabel,
        remoteConversationId: input.conversationId,
        overrideConversationId: input.conversationId,
        overrideCwd: this.helperRuntimeInfo?.cwd,
      });
      writeFileSync(input.localFilePath, nextContent, 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('No such file or directory')) {
        return;
      }
      throw error;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  dispose(): void {
    this.disposeConnection();
  }

  private uploadSessionContent(remoteSessionFile: string, content: string): void {
    const tempDir = mkdtempSync(join(tmpdir(), 'personal-agent-remote-upload-'));
    const tempFile = join(tempDir, 'session.jsonl');
    try {
      writeFileSync(tempFile, stripRemoteMetadataFromSessionContent(content), 'utf-8');
      uploadFileOverScp({
        target: this.sshTarget,
        localPath: tempFile,
        remotePath: remoteSessionFile,
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private remoteFileExists(remotePath: string): boolean {
    try {
      runSshCommand(this.sshTarget, `test -f ${renderRemotePathForShell(remotePath)}`);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureRemotePiInstalled(platform: RemotePlatformInfo, version: string, localPath: string): Promise<void> {
    const remoteDir = buildRemotePiDir(version, platform);
    const remoteBinary = buildRemotePiPath(version, platform);
    runSshCommand(this.sshTarget, `mkdir -p ${renderRemotePathForShell(remoteDir)} && test -x ${renderRemotePathForShell(remoteBinary)} || true`);
    try {
      runSshCommand(this.sshTarget, `test -x ${renderRemotePathForShell(remoteBinary)}`);
      return;
    } catch {
      uploadFileOverScp({ target: this.sshTarget, localPath, remotePath: remoteBinary });
      runSshCommand(this.sshTarget, `chmod +x ${renderRemotePathForShell(remoteBinary)}`);
    }
  }

  private async ensureRemoteHelperInstalled(platform: RemotePlatformInfo, version: string, localPath: string): Promise<void> {
    const remoteDir = buildRemoteHelperDir(version, platform);
    const remoteBinary = buildRemoteHelperPath(version, platform);
    runSshCommand(this.sshTarget, `mkdir -p ${renderRemotePathForShell(remoteDir)} && test -x ${renderRemotePathForShell(remoteBinary)} || true`);
    try {
      runSshCommand(this.sshTarget, `test -x ${renderRemotePathForShell(remoteBinary)}`);
      return;
    } catch {
      uploadFileOverScp({ target: this.sshTarget, localPath, remotePath: remoteBinary });
      runSshCommand(this.sshTarget, `chmod +x ${renderRemotePathForShell(remoteBinary)}`);
    }
  }

  private async ensureHelperConnection(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      return;
    }
    if (this.connectingPromise) {
      return this.connectingPromise;
    }
    if (!this.helperRuntimeInfo) {
      throw new Error(`Remote runtime for ${this.hostLabel} is not available.`);
    }

    this.connectingPromise = (async () => {
      const localPort = await getAvailableTcpPort();
      const tunnel = spawnSshTunnel({
        target: this.sshTarget,
        localPort,
        remotePort: this.helperRuntimeInfo?.port ?? 0,
      });
      let spawnError: Error | null = null;
      tunnel.once('error', (error) => {
        spawnError = error instanceof Error ? error : new Error(String(error));
      });
      tunnel.once('exit', () => {
        if (this.tunnelProcess === tunnel) {
          this.tunnelProcess = null;
        }
      });

      await delay(300);
      if (spawnError) {
        throw spawnError;
      }
      if (tunnel.exitCode !== null) {
        throw new Error(`SSH tunnel to ${this.hostLabel} exited immediately.`);
      }

      const socket = new Socket();
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          socket.removeAllListeners('error');
          socket.removeAllListeners('connect');
        };
        socket.once('error', (error) => {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
        socket.once('connect', () => {
          cleanup();
          resolve();
        });
        socket.connect(localPort, '127.0.0.1');
      });

      socket.on('data', (chunk: Buffer) => {
        this.handleSocketData(chunk.toString('utf-8'));
      });
      socket.once('close', () => {
        if (this.socket === socket) {
          this.socket = null;
        }
      });
      socket.on('error', () => {
        // The request promise path already receives specific socket write errors.
      });

      this.tunnelProcess = tunnel;
      this.socket = socket;
    })().finally(() => {
      this.connectingPromise = null;
    });

    return this.connectingPromise;
  }

  private handleSocketData(fragment: string): void {
    this.buffer += fragment;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {

      const rawLine = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!line.trim()) {
        continue;
      }

      const payload = parseHelperResponse(line);
      if (payload.type === 'response') {
        if (!payload.id) {
          continue;
        }
        const pending = this.pendingRequests.get(payload.id);
        if (!pending) {
          continue;
        }
        this.pendingRequests.delete(payload.id);
        if (!payload.ok) {
          pending.reject(new Error(payload.error?.trim() || `Remote helper request ${payload.id} failed.`));
          continue;
        }
        pending.resolve(payload.data);
        continue;
      }

      for (const subscriber of this.eventSubscribers) {
        subscriber(payload.event);
      }

      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private disposeConnection(): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error(`Remote runtime connection to ${this.hostLabel} closed.`));
    }
    this.pendingRequests.clear();

    this.buffer = '';
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    const tunnel = this.tunnelProcess;
    this.tunnelProcess = null;
    if (tunnel && tunnel.exitCode === null && !tunnel.killed) {
      tunnel.kill('SIGTERM');
    }
  }
}
