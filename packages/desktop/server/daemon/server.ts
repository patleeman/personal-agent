import { hydrateProcessEnvFromShell, resolveChildProcessEnv } from '@personal-agent/core';
import { resolvePersonalAgentRuntimeChannelConfig } from '@personal-agent/core';
import { type ChildProcess } from 'child_process';
import { closeSync, cpSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createServer, type Server, type Socket } from 'net';

import { createBuiltinModules, type DaemonModule, type DaemonModuleContext } from '../automation/tasks/index.js';
import { type DaemonConfig, loadDaemonConfig, type LogLevel } from '../config.js';
import { ensureDaemonDirectories, resolveDaemonPaths } from '../paths.js';
import { deliverBackgroundRunCallbackWakeup } from '../runs/background-run-callbacks.js';
import { surfaceBackgroundRunResultsIfReady } from '../runs/background-run-deferred-resumes.js';
import { buildFollowUpBackgroundRunInput, buildRerunBackgroundRunInput } from '../runs/background-run-replays.js';
import { resolveBackgroundRunSessionDir } from '../runs/background-run-sessions.js';
import {
  createBackgroundRunRecord,
  finalizeBackgroundRun,
  markBackgroundRunCancelling,
  markBackgroundRunInterrupted,
  markBackgroundRunStarted,
  type StartBackgroundRunInput,
} from '../runs/background-runs.js';
import {
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
  scanDurableRun,
  scanDurableRunsForRecovery,
  summarizeScannedDurableRuns,
} from '../runs/store.js';
import { listRecoverableWebLiveConversationRuns, saveWebLiveConversationRunState } from '../runs/web-live-conversations.js';
import { spawnProcess, terminateProcessGroup } from '../shared/processLauncher.js';
import {
  closeAllDbs,
  pruneStaleRecoveryFiles,
  registerProcessExitSafetyNet,
  startPeriodicWalCheckpoint,
  stopPeriodicWalCheckpoint,
} from '../shared/sqliteDbLifecycle.js';
import { looksLikeBackgroundAgentRunnerEntryPath } from './background-run-agent.js';
import { DaemonCompanionServer } from './companion/server.js';
import { type CompanionRuntimeProvider, DEFAULT_COMPANION_HOST } from './companion/types.js';
import { EventBus } from './event-bus.js';
import { createDaemonEvent, isDaemonEvent } from './events.js';
import { type DaemonRequest, type DaemonResponse, parseRequest, serializeResponse } from './ipc-protocol.js';
import type {
  CancelDurableRunResult,
  DaemonEvent,
  DaemonModuleStatus,
  DaemonPaths,
  DaemonStatus,
  EventPayload,
  FollowUpDurableRunResult,
  GetDurableRunResult,
  ListDurableRunsResult,
  ListRecoverableWebLiveConversationRunsResult,
  ReplayDurableRunResult,
  StartBackgroundRunResult,
  StartScheduledTaskRunResult,
  SyncWebLiveConversationRunRequestInput,
  SyncWebLiveConversationRunResult,
} from './types.js';

interface ModuleRuntime {
  module: DaemonModule;
  status: DaemonModuleStatus;
}

interface ActiveBackgroundRunHandle {
  runId: string;
  taskSlug: string;
  cwd: string;
  startedAt: string;
  child: ChildProcess;
  cancelling: boolean;
  cancelReason?: string;
  settled: boolean;
  forceKillTimer?: NodeJS.Timeout;
}

interface IpcSocketTrace {
  lastRequestId?: string;
  lastRequestType?: string;
  lastResponseId?: string;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function hasExplicitSessionOverride(argv: string[] | undefined): boolean {
  if (!argv) {
    return false;
  }

  return argv.some(
    (arg) =>
      arg === '--no-session' ||
      arg === '--session' ||
      arg.startsWith('--session=') ||
      arg === '--session-dir' ||
      arg.startsWith('--session-dir=') ||
      arg === '--resume' ||
      arg === '--continue',
  );
}

function appendBackgroundRunSessionDir(
  input: {
    argv?: string[];
    shellCommand?: string;
    continueSession?: boolean;
  },
  runId: string,
): {
  argv?: string[];
  shellCommand?: string;
} {
  const sessionDir = resolveBackgroundRunSessionDir(runId);

  if (input.argv && input.argv.length > 0) {
    const argv = input.argv;
    const backgroundAgentRunner = looksLikeBackgroundAgentRunnerEntryPath(argv[1]);
    const firstRunnerArgIndex = backgroundAgentRunner ? 2 : 1;

    if (!backgroundAgentRunner || hasExplicitSessionOverride(argv.slice(firstRunnerArgIndex))) {
      return { argv };
    }

    return {
      argv: [...argv, '--session-dir', sessionDir, ...(input.continueSession ? ['--continue'] : [])],
    };
  }

  const shellCommand = input.shellCommand;
  if (!shellCommand) {
    return {};
  }

  return { shellCommand };
}

export type DaemonStopRequestBehavior = 'exit-process' | 'reject' | 'stop-only';

export interface PersonalAgentDaemonOptions {
  config?: DaemonConfig;
  stopRequestBehavior?: DaemonStopRequestBehavior;
  logSink?: (line: string) => void;
  companionRuntimeProvider?: CompanionRuntimeProvider;
}

function isDaemonConfig(value: DaemonConfig | PersonalAgentDaemonOptions): value is DaemonConfig {
  return 'modules' in value && 'queue' in value && 'ipc' in value;
}

function readExistingDaemonLockPid(lockPath: string): number | undefined {
  try {
    const firstLine = readFileSync(lockPath, 'utf-8').split('\n')[0]?.trim();
    if (!firstLine) {
      return undefined;
    }

    const pid = Number(firstLine);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export class PersonalAgentDaemon {
  private readonly config: DaemonConfig;
  private readonly paths: DaemonPaths;
  private readonly runsRoot: string;
  private readonly bus: EventBus;
  private readonly startedAt: string;
  private readonly pid: number;
  private readonly modules: ModuleRuntime[];
  private readonly stopRequestBehavior: DaemonStopRequestBehavior;
  private readonly logSink?: (line: string) => void;
  private readonly companionRuntimeProvider?: CompanionRuntimeProvider;
  private readonly activeBackgroundRuns = new Map<string, ActiveBackgroundRunHandle>();
  private readonly activeSockets = new Set<Socket>();
  private readonly socketTraces = new WeakMap<Socket, IpcSocketTrace>();

  private lockFd?: number;
  private server?: Server;
  private companionServer?: DaemonCompanionServer;
  private timerHandles: NodeJS.Timeout[] = [];
  private running = false;
  private stopping = false;

  constructor(input: DaemonConfig | PersonalAgentDaemonOptions = loadDaemonConfig()) {
    const options = isDaemonConfig(input) ? { config: input } : input;
    this.config = options.config ?? loadDaemonConfig();
    this.stopRequestBehavior = options.stopRequestBehavior ?? 'exit-process';
    this.logSink = options.logSink;
    this.companionRuntimeProvider = options.companionRuntimeProvider;
    this.paths = resolveDaemonPaths(this.config.ipc.socketPath);
    this.runsRoot = resolveDurableRunsRoot(this.paths.root);
    this.startedAt = new Date().toISOString();
    this.pid = process.pid;

    this.bus = new EventBus({
      maxDepth: this.config.queue.maxDepth,
      onHandlerError: (event, error) => {
        this.log('error', `event handler failed type=${event.type} id=${event.id} error=${error.message}`);
      },
    });

    this.modules = createBuiltinModules(this.config)
      .filter((module) => module.enabled)
      .map((module) => ({
        module,
        status: {
          name: module.name,
          enabled: true,
          subscriptions: module.subscriptions,
          handledEvents: 0,
        },
      }));
  }

  getSocketPath(): string {
    return this.paths.socketPath;
  }

  private acquireProcessLock(): void {
    if (this.lockFd !== undefined) {
      return;
    }

    const lockPath = `${this.paths.pidFile}.lock`;
    try {
      this.lockFd = openSync(lockPath, 'wx');
      writeFileSync(this.lockFd, `${String(this.pid)}\n${new Date().toISOString()}\n`);
      return;
    } catch {
      const existingPid = readExistingDaemonLockPid(lockPath);
      if (existingPid && isProcessAlive(existingPid)) {
        throw new Error(`personal-agentd is already running with pid=${String(existingPid)}; refusing to start a second daemon`);
      }

      rmSync(lockPath, { force: true });
      this.lockFd = openSync(lockPath, 'wx');
      writeFileSync(this.lockFd, `${String(this.pid)}\n${new Date().toISOString()}\n`);
    }
  }

  private releaseProcessLock(): void {
    if (this.lockFd !== undefined) {
      try {
        closeSync(this.lockFd);
      } catch {
        // Best-effort cleanup during shutdown.
      }
      this.lockFd = undefined;
    }

    rmSync(`${this.paths.pidFile}.lock`, { force: true });
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.stopping = false;
    ensureDaemonDirectories(this.paths);
    mkdirSync(this.runsRoot, { recursive: true, mode: 0o700 });
    this.acquireProcessLock();

    try {
      this.prepareSocket();
      writeFileSync(this.paths.pidFile, String(this.pid));

      await this.recoverInterruptedBackgroundRuns();
      this.logDurableRunRecoverySummary('startup');

      for (const moduleRuntime of this.modules) {
        await moduleRuntime.module.start(this.createModuleContext(moduleRuntime.module.name));
        this.registerModuleSubscriptions(moduleRuntime);
        this.registerModuleTimers(moduleRuntime.module);
      }

      this.server = createServer((socket) => {
        this.attachConnection(socket);
      });

      await new Promise<void>((resolve, reject) => {
        this.server?.once('error', reject);
        this.server?.listen(this.paths.socketPath, () => {
          resolve();
        });
      });

      this.companionServer = new DaemonCompanionServer(this.config, this.paths.root, this.companionRuntimeProvider);
      await this.companionServer.start();
      const fallbackPort = this.companionServer.getPortFallbackFrom();
      if (fallbackPort) {
        this.log(
          'warn',
          `companion port ${String(fallbackPort)} unavailable; fell back to ${this.companionServer.getUrl() ?? 'an available port'}`,
        );
      }

      this.running = true;

      // Register a process.on('exit') safety net so databases are checkpointed
      // even if the process is terminated without a graceful stop().
      registerProcessExitSafetyNet();

      // Periodically flush WAL data to reduce the corruption window on
      // ungraceful kills and keep WAL files from growing unbounded.
      startPeriodicWalCheckpoint((level, msg) => this.log(level as LogLevel, msg));

      // Clean up old quarantine / backup files from previous recovery events.
      pruneStaleRecoveryFiles(this.paths.root, (level, msg) => this.log(level as LogLevel, msg));

      this.log('info', `personal-agentd started pid=${this.pid} socket=${this.paths.socketPath}`);
    } catch (error) {
      this.releaseProcessLock();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) {
      return;
    }

    this.stopping = true;
    this.log('info', 'stopping personal-agentd');

    for (const handle of this.timerHandles) {
      clearInterval(handle);
    }
    this.timerHandles = [];

    await Promise.all([...this.activeBackgroundRuns.keys()].map((runId) => this.cancelBackgroundRun(runId, 'Daemon stopping')));
    await this.bus.waitForIdle();

    await this.companionServer?.stop();
    this.companionServer = undefined;

    for (const moduleRuntime of this.modules) {
      if (moduleRuntime.module.stop) {
        try {
          await moduleRuntime.module.stop(this.createModuleContext(moduleRuntime.module.name));
        } catch (error) {
          this.log('warn', `module stop failed: ${moduleRuntime.module.name}: ${(error as Error).message}`);
        }
      }
    }

    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();

    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => resolve());
    });

    stopPeriodicWalCheckpoint();

    // Checkpoint and close all cached SQLite databases so WAL data is
    // flushed to the main DB file before we release the process lock.
    closeAllDbs((level, msg) => this.log(level as LogLevel, msg));

    if (existsSync(this.paths.socketPath)) {
      rmSync(this.paths.socketPath, { force: true });
    }

    if (existsSync(this.paths.pidFile)) {
      rmSync(this.paths.pidFile, { force: true });
    }

    this.releaseProcessLock();

    this.server = undefined;
    this.running = false;
    this.stopping = false;
  }

  isRunning(): boolean {
    return this.running && !this.stopping;
  }

  getCompanionUrl(): string | null {
    return this.companionServer?.getUrl() ?? null;
  }

  async updateCompanionConfig(input: { enabled?: boolean; host?: string; port?: number }): Promise<{ url: string | null }> {
    const previous = {
      enabled: this.config.companion?.enabled !== false,
      host: this.config.companion?.host ?? DEFAULT_COMPANION_HOST,
      port: this.config.companion?.port ?? resolvePersonalAgentRuntimeChannelConfig().companionPort,
    };
    const next = {
      enabled: input.enabled ?? previous.enabled,
      host: input.host ?? previous.host,
      port: input.port ?? previous.port,
    };

    this.config.companion = next;

    if (!this.isRunning()) {
      return { url: null };
    }

    await this.companionServer?.stop();
    this.companionServer = undefined;

    try {
      this.companionServer = new DaemonCompanionServer(this.config, this.paths.root, this.companionRuntimeProvider);
      await this.companionServer.start();
      const fallbackPort = this.companionServer.getPortFallbackFrom();
      if (fallbackPort) {
        this.log(
          'warn',
          `companion port ${String(fallbackPort)} unavailable; fell back to ${this.companionServer.getUrl() ?? 'an available port'}`,
        );
      }
      return { url: this.companionServer.getUrl() };
    } catch (error) {
      this.config.companion = previous;
      this.companionServer = new DaemonCompanionServer(this.config, this.paths.root, this.companionRuntimeProvider);
      await this.companionServer.start().catch(() => undefined);
      throw error;
    }
  }

  getStatus(): DaemonStatus {
    return {
      running: this.isRunning(),
      pid: this.pid,
      startedAt: this.startedAt,
      socketPath: this.paths.socketPath,
      queue: this.bus.getStatus(),
      modules: this.modules.map((moduleRuntime) => ({
        ...moduleRuntime.status,
        detail: moduleRuntime.module.getStatus?.(),
      })),
    };
  }

  private prepareSocket(): void {
    if (existsSync(this.paths.socketPath)) {
      rmSync(this.paths.socketPath, { force: true });
    }
  }

  private createModuleContext(moduleName: string): DaemonModuleContext {
    const logPrefix = `[module:${moduleName}]`;

    return {
      config: this.config,
      paths: this.paths,
      publish: (type: string, payload?: EventPayload): boolean => {
        const event = createDaemonEvent({
          type,
          source: `module:${moduleName}`,
          payload,
        });

        return this.bus.publish(event);
      },
      logger: {
        debug: (message: string) => this.log('debug', `${logPrefix} ${message}`),
        info: (message: string) => this.log('info', `${logPrefix} ${message}`),
        warn: (message: string) => this.log('warn', `${logPrefix} ${message}`),
        error: (message: string) => this.log('error', `${logPrefix} ${message}`),
      },
    };
  }

  private registerModuleSubscriptions(moduleRuntime: ModuleRuntime): void {
    const context = this.createModuleContext(moduleRuntime.module.name);

    for (const type of moduleRuntime.module.subscriptions) {
      this.bus.subscribe(type, async (event) => {
        await moduleRuntime.module.handleEvent(event, context);
        moduleRuntime.status.handledEvents += 1;
        moduleRuntime.status.lastEventAt = new Date().toISOString();
        moduleRuntime.status.lastError = undefined;
      });
    }
  }

  private registerModuleTimers(module: DaemonModule): void {
    const context = this.createModuleContext(module.name);

    for (const timer of module.timers) {
      const handle = setInterval(() => {
        const published = context.publish(timer.eventType, {
          timer: timer.name,
          ...(timer.payload ?? {}),
        });

        if (!published) {
          this.log('warn', `timer dropped event type=${timer.eventType} module=${module.name}`);
        }
      }, timer.intervalMs);

      this.timerHandles.push(handle);
    }
  }

  private attachConnection(socket: Socket): void {
    let buffer = '';
    this.activeSockets.add(socket);
    this.socketTraces.set(socket, {});

    socket.on('close', () => {
      this.activeSockets.delete(socket);
      this.socketTraces.delete(socket);
    });

    socket.on('error', (error) => {
      this.handleSocketError(socket, error);
    });

    socket.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      while (buffer.includes('\n')) {
        const newline = buffer.indexOf('\n');
        const rawLine = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);

        if (!rawLine) {
          continue;
        }

        this.handleLine(socket, rawLine);
      }
    });
  }

  private getSocketTrace(socket: Socket): IpcSocketTrace {
    const existing = this.socketTraces.get(socket);
    if (existing) {
      return existing;
    }

    const trace: IpcSocketTrace = {};
    this.socketTraces.set(socket, trace);
    return trace;
  }

  private formatSocketTrace(trace: IpcSocketTrace): string {
    const parts: string[] = [];

    if (trace.lastRequestId) {
      parts.push(`requestId=${trace.lastRequestId}`);
    }

    if (trace.lastRequestType) {
      parts.push(`requestType=${trace.lastRequestType}`);
    }

    if (trace.lastResponseId) {
      parts.push(`responseId=${trace.lastResponseId}`);
    }

    return parts.length > 0 ? ` ${parts.join(' ')}` : '';
  }

  private handleSocketError(socket: Socket, error: Error): void {
    const socketError = error as NodeJS.ErrnoException;
    const trace = this.getSocketTrace(socket);
    const traceSuffix = this.formatSocketTrace(trace);

    if (socketError.code === 'EPIPE' || socketError.code === 'ECONNRESET') {
      const level: LogLevel = trace.lastRequestType || trace.lastResponseId ? 'info' : 'debug';
      this.log(level, `ipc client disconnected code=${socketError.code}${traceSuffix}`);
      return;
    }

    this.log('warn', `ipc socket error code=${socketError.code ?? 'UNKNOWN'} message=${error.message}${traceSuffix}`);
  }

  private respond(socket: Socket, response: DaemonResponse): void {
    const trace = this.getSocketTrace(socket);
    trace.lastResponseId = response.id;
    const traceSuffix = this.formatSocketTrace(trace);

    if (socket.destroyed || !socket.writable) {
      this.log('debug', `ipc response dropped id=${response.id} reason=socket-not-writable${traceSuffix}`);
      return;
    }

    socket.write(serializeResponse(response));
  }

  private handleLine(socket: Socket, rawLine: string): void {
    try {
      const request = parseRequest(rawLine);
      const trace = this.getSocketTrace(socket);
      trace.lastRequestId = request.id;
      trace.lastRequestType = request.type;
      void this.handleRequest(socket, request).catch((error) => {
        this.respond(socket, {
          id: request.id,
          ok: false,
          error: (error as Error).message,
        });
      });
    } catch (error) {
      this.respond(socket, {
        id: 'unknown',
        ok: false,
        error: (error as Error).message,
      });
    }
  }

  private async handleRequest(socket: Socket, request: DaemonRequest): Promise<void> {
    if (request.type === 'ping') {
      this.respond(socket, { id: request.id, ok: true, result: { pong: true } });
      return;
    }

    if (request.type === 'status') {
      this.respond(socket, { id: request.id, ok: true, result: this.getStatus() });
      return;
    }

    if (request.type === 'companion.updateConfig') {
      this.respond(socket, {
        id: request.id,
        ok: true,
        result: await this.updateCompanionConfig(request.input),
      });
      return;
    }

    if (request.type === 'runs.list') {
      this.respond(socket, {
        id: request.id,
        ok: true,
        result: this.listDurableRuns(),
      });
      return;
    }

    if (request.type === 'runs.get') {
      const result = this.getDurableRun(request.runId);
      if (!result) {
        this.respond(socket, {
          id: request.id,
          ok: false,
          error: `Run not found: ${request.runId}`,
        });
        return;
      }

      this.respond(socket, {
        id: request.id,
        ok: true,
        result,
      });
      return;
    }

    if (request.type === 'runs.startTask') {
      this.respond(socket, {
        id: request.id,
        ok: true,
        result: await this.startScheduledTaskRun(request.taskId),
      });
      return;
    }

    if (request.type === 'runs.startBackground') {
      this.respond(socket, {
        id: request.id,
        ok: true,
        result: await this.startBackgroundRun(request.input),
      });
      return;
    }

    if (request.type === 'runs.cancel') {
      this.respond(socket, {
        id: request.id,
        ok: true,
        result: await this.cancelBackgroundRun(request.runId),
      });
      return;
    }

    if (request.type === 'runs.rerun') {
      this.respond(socket, {
        id: request.id,
        ok: true,
        result: await this.rerunBackgroundRun(request.runId),
      });
      return;
    }

    if (request.type === 'runs.followUp') {
      this.respond(socket, {
        id: request.id,
        ok: true,
        result: await this.followUpBackgroundRun(request.runId, request.prompt),
      });
      return;
    }

    if (request.type === 'conversations.sync') {
      this.respond(socket, {
        id: request.id,
        ok: true,
        result: await this.syncWebLiveConversationRun(request.input),
      });
      return;
    }

    if (request.type === 'conversations.recoverable') {
      this.respond(socket, {
        id: request.id,
        ok: true,
        result: this.listRecoverableWebLiveConversationRuns(),
      });
      return;
    }

    if (request.type === 'stop') {
      this.respond(socket, {
        id: request.id,
        ok: true,
        result: await this.requestStop(),
      });
      return;
    }

    if (request.type === 'emit') {
      if (!isDaemonEvent(request.event)) {
        this.respond(socket, { id: request.id, ok: false, error: 'Invalid event envelope' });
        return;
      }

      const accepted = this.publishEvent(request.event);
      this.respond(socket, {
        id: request.id,
        ok: true,
        result: {
          accepted,
          reason: accepted ? undefined : 'event queue is full',
        },
      });
      return;
    }
  }

  async requestStop(): Promise<{ stopping: boolean }> {
    if (this.stopRequestBehavior === 'reject') {
      throw new Error('Daemon lifecycle is managed by the embedding application.');
    }

    setTimeout(() => {
      void this.stop()
        .then(() => {
          if (this.stopRequestBehavior === 'exit-process') {
            process.exit(0);
          }
        })
        .catch((error) => {
          this.log('error', `daemon stop request failed: ${(error as Error).message}`);
        });
    }, 10);

    return { stopping: true };
  }

  publishEvent(event: DaemonEvent): boolean {
    const accepted = this.bus.publish(event);
    this.log('debug', `event accepted=${accepted} type=${event.type} source=${event.source}`);
    return accepted;
  }

  listDurableRuns(): ListDurableRunsResult {
    const scannedAt = new Date().toISOString();
    const runs = scanDurableRunsForRecovery(this.runsRoot);

    return {
      scannedAt,
      runs,
      summary: summarizeScannedDurableRuns(runs),
    };
  }

  getDurableRun(runId: string): GetDurableRunResult | undefined {
    const run = scanDurableRun(this.runsRoot, runId);
    if (!run) {
      return undefined;
    }

    return {
      scannedAt: new Date().toISOString(),
      run,
    };
  }

  private async waitForScheduledRunRecord(runId: string): Promise<boolean> {
    const deadlineMs = Date.now() + 1500;

    while (Date.now() < deadlineMs) {
      if (scanDurableRun(this.runsRoot, runId)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return Boolean(scanDurableRun(this.runsRoot, runId));
  }

  async startScheduledTaskRun(taskId: string): Promise<StartScheduledTaskRunResult> {
    const runId = `task-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const accepted = this.bus.publish(
      createDaemonEvent({
        type: 'tasks.run.requested',
        source: 'daemon:ipc',
        payload: {
          taskId,
          runId,
          requestedAt: new Date().toISOString(),
        },
      }),
    );

    if (!accepted) {
      return {
        accepted: false,
        runId,
        reason: 'event queue is full',
      };
    }

    // Fire-and-forget: do not block the IPC handler on full event processing.
    // `waitForIdle` would hold the socket open until every queued event
    // handler finishes — easily exceeding the client-side 5 s socket
    // timeout when handlers are slow or the queue is deep. Instead, wait only
    // for the durable run record to appear. The task runner creates that record
    // before doing the expensive work, but a fixed 50ms grace period was too
    // racy on normal desktop launches.
    const runStarted = await this.waitForScheduledRunRecord(runId);

    if (!runStarted) {
      return {
        accepted: false,
        runId,
        reason: 'task run was not started',
      };
    }

    return {
      accepted: true,
      runId,
    };
  }

  private async surfaceBackgroundRunResults(triggerRunId: string): Promise<void> {
    try {
      const result = await surfaceBackgroundRunResultsIfReady({
        runsRoot: this.runsRoot,
        triggerRunId,
      });

      if (!result.resultId) {
        return;
      }

      this.log(
        'info',
        `background run results surfaced run=${triggerRunId} result=${result.resultId} surfaced=${result.surfacedRunIds.join(',')}`,
      );
    } catch (error) {
      this.log('warn', `background run result surfacing failed run=${triggerRunId} error=${(error as Error).message}`);
    }
  }

  private async surfaceBackgroundRunOutcome(triggerRunId: string): Promise<void> {
    try {
      const callback = await deliverBackgroundRunCallbackWakeup({
        daemonRoot: this.paths.root,
        stateRoot: this.paths.stateRoot,
        runsRoot: this.runsRoot,
        runId: triggerRunId,
      });

      if (callback.delivered) {
        this.log(
          'info',
          `background run callback delivered run=${triggerRunId} wakeup=${callback.wakeupId ?? 'n/a'} conversation=${
            callback.conversationId ?? 'n/a'
          }`,
        );
        return;
      }
    } catch (error) {
      this.log('warn', `background run callback delivery failed run=${triggerRunId} error=${(error as Error).message}`);
    }

    await this.surfaceBackgroundRunResults(triggerRunId);
  }

  private async finalizeBackgroundRunStartFailure(input: {
    runId: string;
    runPaths: ReturnType<typeof resolveDurableRunPaths>;
    taskSlug: string;
    cwd: string;
    startedAt: string;
    error: string;
  }): Promise<StartBackgroundRunResult> {
    await finalizeBackgroundRun({
      runId: input.runId,
      runPaths: input.runPaths,
      taskSlug: input.taskSlug,
      cwd: input.cwd,
      startedAt: input.startedAt,
      endedAt: new Date().toISOString(),
      exitCode: 1,
      signal: null,
      cancelled: false,
      error: input.error,
    });

    return {
      accepted: false,
      runId: input.runId,
      logPath: input.runPaths.outputLogPath,
      reason: input.error,
    };
  }

  private async spawnBackgroundRun(input: StartBackgroundRunInput): Promise<StartBackgroundRunResult> {
    const record = await createBackgroundRunRecord(this.runsRoot, input);
    const startedAt = new Date().toISOString();

    if (input.bootstrapSessionDir) {
      try {
        cpSync(input.bootstrapSessionDir, resolveBackgroundRunSessionDir(record.runId), { recursive: true, force: true });
      } catch (error) {
        return this.finalizeBackgroundRunStartFailure({
          runId: record.runId,
          runPaths: record.paths,
          taskSlug: input.taskSlug,
          cwd: input.cwd,
          startedAt,
          error: `Could not prepare follow-up session: ${(error as Error).message}`,
        });
      }
    }

    const outputStream = createWriteStream(record.paths.outputLogPath, { flags: 'a', encoding: 'utf-8' });
    const spawnInput = appendBackgroundRunSessionDir(
      {
        argv: record.argv,
        shellCommand: record.shellCommand,
        continueSession: input.continueSession,
      },
      record.runId,
    );

    const isBackgroundAgentRunner = spawnInput.argv ? looksLikeBackgroundAgentRunnerEntryPath(spawnInput.argv[1]) : false;
    const childEnv = resolveChildProcessEnv({
      PERSONAL_AGENT_RUN_ID: record.runId,
      PERSONAL_AGENT_RUN_ROOT: record.paths.root,
      PERSONAL_AGENT_RUN_MANIFEST_PATH: record.paths.manifestPath,
      PERSONAL_AGENT_RUN_STATUS_PATH: record.paths.statusPath,
      PERSONAL_AGENT_RUN_CHECKPOINT_PATH: record.paths.checkpointPath,
      PERSONAL_AGENT_RUN_EVENTS_PATH: record.paths.eventsPath,
      PERSONAL_AGENT_RUN_OUTPUT_LOG_PATH: record.paths.outputLogPath,
      PERSONAL_AGENT_RUN_RESULT_PATH: record.paths.resultPath,
      ...(isBackgroundAgentRunner
        ? {
            ELECTRON_RUN_AS_NODE: '1',
            ...(input.source?.filePath ? { PERSONAL_AGENT_PARENT_SESSION_FILE: input.source.filePath } : {}),
          }
        : {}),
    });

    const { child } = spawnInput.argv
      ? spawnProcess({
          command: spawnInput.argv[0] as string,
          args: spawnInput.argv.slice(1),
          cwd: input.cwd,
          env: childEnv,
          options: { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
        })
      : spawnProcess({
          command: 'sh',
          args: ['-lc', spawnInput.shellCommand as string],
          cwd: input.cwd,
          env: childEnv,
          options: { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
        });

    child.stdout?.on('data', (chunk: Buffer | string) => {
      outputStream.write(chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      outputStream.write(chunk.toString());
    });

    const startState = await new Promise<{ started: true } | { started: false; error: string }>((resolve) => {
      let settled = false;

      child.once('spawn', () => {
        if (settled) {
          return;
        }

        settled = true;
        resolve({ started: true });
      });

      child.once('error', (error) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve({ started: false, error: error.message });
      });
    });

    if (!startState.started) {
      outputStream.end();
      return this.finalizeBackgroundRunStartFailure({
        runId: record.runId,
        runPaths: record.paths,
        taskSlug: input.taskSlug,
        cwd: input.cwd,
        startedAt,
        error: startState.error,
      });
    }

    const handle: ActiveBackgroundRunHandle = {
      runId: record.runId,
      taskSlug: input.taskSlug,
      cwd: input.cwd,
      startedAt,
      child,
      cancelling: false,
      settled: false,
    };
    this.activeBackgroundRuns.set(record.runId, handle);

    const finalizeExitedRun = (code: number | null, signal: NodeJS.Signals | null) => {
      handle.settled = true;
      if (handle.forceKillTimer) {
        clearTimeout(handle.forceKillTimer);
      }
      this.activeBackgroundRuns.delete(record.runId);

      const endedAt = new Date().toISOString();
      void finalizeBackgroundRun({
        runId: record.runId,
        runPaths: record.paths,
        taskSlug: input.taskSlug,
        cwd: input.cwd,
        startedAt,
        endedAt,
        exitCode: typeof code === 'number' ? code : 1,
        signal,
        cancelled: handle.cancelling,
        error: handle.cancelling
          ? (handle.cancelReason ?? 'Cancelled by user')
          : typeof code === 'number' && code === 0
            ? undefined
            : `Command exited with code ${String(code ?? signal ?? 1)}`,
      })
        .then(async () => {
          await this.surfaceBackgroundRunOutcome(record.runId);
        })
        .finally(() => {
          outputStream.end();
        });
    };

    let exitBeforeStartMarked: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    let startMarked = false;
    child.once('exit', (code, signal) => {
      if (!startMarked) {
        exitBeforeStartMarked = { code, signal };
        return;
      }

      finalizeExitedRun(code, signal);
    });

    await markBackgroundRunStarted({
      runId: record.runId,
      runPaths: record.paths,
      startedAt,
      pid: child.pid ?? -1,
      taskSlug: input.taskSlug,
      cwd: input.cwd,
    });

    startMarked = true;
    if (exitBeforeStartMarked) {
      const exitInfo: { code: number | null; signal: NodeJS.Signals | null } = exitBeforeStartMarked;
      finalizeExitedRun(exitInfo.code, exitInfo.signal);
    }

    this.log('info', `background run started id=${record.runId} pid=${String(child.pid ?? 'n/a')} cwd=${input.cwd}`);
    return {
      accepted: true,
      runId: record.runId,
      logPath: record.paths.outputLogPath,
    };
  }

  async startBackgroundRun(input: StartBackgroundRunInput): Promise<StartBackgroundRunResult> {
    return this.spawnBackgroundRun(input);
  }

  private getReplayableBackgroundRun(runId: string) {
    const run = scanDurableRun(this.runsRoot, runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const status = run.status?.status;
    if (status === 'queued' || status === 'waiting' || status === 'running' || status === 'recovering') {
      throw new Error(`Run ${runId} is still active.`);
    }

    return run;
  }

  async rerunBackgroundRun(runId: string): Promise<ReplayDurableRunResult> {
    const run = this.getReplayableBackgroundRun(runId);
    const result = await this.spawnBackgroundRun(buildRerunBackgroundRunInput(run));
    return {
      ...result,
      sourceRunId: runId,
    };
  }

  async followUpBackgroundRun(runId: string, prompt?: string): Promise<FollowUpDurableRunResult> {
    const run = this.getReplayableBackgroundRun(runId);
    const result = await this.spawnBackgroundRun(
      buildFollowUpBackgroundRunInput(run, prompt?.trim() || 'Continue from where you left off.'),
    );
    return {
      ...result,
      sourceRunId: runId,
    };
  }

  async cancelBackgroundRun(runId: string, reason = 'Cancelled by user'): Promise<CancelDurableRunResult> {
    const active = this.activeBackgroundRuns.get(runId);
    if (active) {
      active.cancelling = true;
      active.cancelReason = reason;
      await markBackgroundRunCancelling({
        runId,
        runPaths: resolveDurableRunPaths(this.runsRoot, runId),
        reason,
      });
      if (!active.child.killed) {
        terminateProcessGroup(active.child);
      }
      active.forceKillTimer = setTimeout(() => {
        if (!active.settled) {
          terminateProcessGroup(active.child);
        }
      }, 5000);
      active.forceKillTimer.unref();

      this.log('info', `background run cancelling id=${runId}`);
      return {
        cancelled: true,
        runId,
      };
    }

    const run = scanDurableRun(this.runsRoot, runId);
    if (!run) {
      return {
        cancelled: false,
        runId,
        reason: 'run not found',
      };
    }

    if (run.manifest?.kind !== 'background-run' && run.manifest?.kind !== 'raw-shell') {
      return {
        cancelled: false,
        runId,
        reason: 'only daemon background work can be cancelled',
      };
    }

    const status = run.status?.status;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      return {
        cancelled: false,
        runId,
        reason: `run is already ${status}`,
      };
    }

    await finalizeBackgroundRun({
      runId,
      runPaths: run.paths,
      taskSlug: typeof run.manifest?.spec.taskSlug === 'string' ? run.manifest.spec.taskSlug : (run.manifest?.source?.id ?? runId),
      cwd: typeof run.manifest?.spec.cwd === 'string' ? run.manifest.spec.cwd : process.cwd(),
      startedAt: run.status?.startedAt ?? run.manifest?.createdAt ?? new Date().toISOString(),
      endedAt: new Date().toISOString(),
      exitCode: 1,
      signal: null,
      cancelled: true,
      error: reason,
    });
    await this.surfaceBackgroundRunOutcome(runId);

    this.log('info', `background run cancelled from durable state id=${runId}`);
    return {
      cancelled: true,
      runId,
    };
  }

  private async recoverInterruptedBackgroundRuns(): Promise<void> {
    const runs = scanDurableRunsForRecovery(this.runsRoot);

    await Promise.all(
      runs.map(async (run) => {
        if (run.manifest?.kind !== 'background-run' && run.manifest?.kind !== 'raw-shell') {
          return;
        }

        const interrupted = await markBackgroundRunInterrupted({
          runId: run.runId,
          runPaths: resolveDurableRunPaths(this.runsRoot, run.runId),
          reason: 'Daemon restarted before background run completion.',
        });
        if (interrupted) {
          await this.surfaceBackgroundRunOutcome(run.runId);
        }
      }),
    );
  }

  async syncWebLiveConversationRun(input: SyncWebLiveConversationRunRequestInput): Promise<SyncWebLiveConversationRunResult> {
    return saveWebLiveConversationRunState(input);
  }

  listRecoverableWebLiveConversationRuns(): ListRecoverableWebLiveConversationRunsResult {
    return {
      runs: listRecoverableWebLiveConversationRuns(),
    };
  }

  private logDurableRunRecoverySummary(reason: string): void {
    const runs = scanDurableRunsForRecovery(this.runsRoot);
    const summary = summarizeScannedDurableRuns(runs);

    if (summary.total === 0) {
      this.log('debug', `durable run scan reason=${reason} total=0`);
      return;
    }

    this.log(
      'info',
      [
        `durable run scan reason=${reason}`,
        `total=${summary.total}`,
        `resume=${summary.recoveryActions.resume}`,
        `rerun=${summary.recoveryActions.rerun}`,
        `attention=${summary.recoveryActions.attention}`,
        `invalid=${summary.recoveryActions.invalid}`,
      ].join(' '),
    );
  }

  private log(level: LogLevel, message: string): void {
    if (LEVELS[level] < LEVELS[this.config.logLevel]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${message}`;
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }

    this.logSink?.(line);
  }
}

export async function runDaemonProcess(): Promise<void> {
  hydrateProcessEnvFromShell();

  const daemon = new PersonalAgentDaemon();

  const shutdown = async () => {
    await daemon.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });

  process.on('SIGTERM', () => {
    void shutdown();
  });

  await daemon.start();
}
