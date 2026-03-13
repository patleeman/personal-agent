import { spawn, type ChildProcess } from 'child_process';
import { createServer, type Server, type Socket } from 'net';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { EventBus } from './event-bus.js';
import { createDaemonEvent, isDaemonEvent } from './events.js';
import { parseRequest, serializeResponse, type DaemonRequest } from './ipc-protocol.js';
import { loadDaemonConfig, type DaemonConfig, type LogLevel } from './config.js';
import { createBuiltinModules, type DaemonModule, type DaemonModuleContext } from './modules/index.js';
import { ensureDaemonDirectories, resolveDaemonPaths } from './paths.js';
import {
  createBackgroundRunRecord,
  finalizeBackgroundRun,
  markBackgroundRunInterrupted,
  markBackgroundRunStarted,
  type StartBackgroundRunInput,
} from './runs/background-runs.js';
import {
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
  scanDurableRun,
  scanDurableRunsForRecovery,
  summarizeScannedDurableRuns,
} from './runs/store.js';
import {
  listRecoverableWebLiveConversationRuns,
  saveWebLiveConversationRunState,
} from './runs/web-live-conversations.js';
import type {
  DaemonModuleStatus,
  DaemonPaths,
  DaemonStatus,
  EventPayload,
  GatewayNotification,
  GatewayNotificationProvider,
  GetDurableRunResult,
  ListDurableRunsResult,
  StartScheduledTaskRunResult,
  StartBackgroundRunResult,
  CancelDurableRunResult,
  SyncWebLiveConversationRunResult,
  ListRecoverableWebLiveConversationRunsResult,
  SyncWebLiveConversationRunRequestInput,
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

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_NOTIFICATION_PULL_LIMIT = 20;
const MAX_NOTIFICATION_PULL_LIMIT = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isGatewayProvider(value: unknown): value is GatewayNotificationProvider {
  return value === 'telegram';
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toOptionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value <= 0) {
      return undefined;
    }

    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

function normalizeNotificationPullLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) {
    return DEFAULT_NOTIFICATION_PULL_LIMIT;
  }

  const normalized = Math.floor(limit);
  if (normalized <= 0) {
    return DEFAULT_NOTIFICATION_PULL_LIMIT;
  }

  return Math.min(normalized, MAX_NOTIFICATION_PULL_LIMIT);
}

function parseGatewayNotification(event: { id: string; source: string; timestamp: string; payload: EventPayload }): GatewayNotification | undefined {
  if (!isRecord(event.payload)) {
    return undefined;
  }

  const gateway = event.payload.gateway;
  if (!isGatewayProvider(gateway)) {
    return undefined;
  }

  const destinationId = toOptionalString(event.payload.destinationId);
  const message = toOptionalString(event.payload.message);

  if (!destinationId || !message) {
    return undefined;
  }

  const taskId = toOptionalString(event.payload.taskId);
  const statusRaw = toOptionalString(event.payload.status);
  const status = statusRaw === 'success' || statusRaw === 'failed' ? statusRaw : undefined;
  const createdAt = toOptionalString(event.payload.createdAt) ?? event.timestamp;
  const messageThreadId = gateway === 'telegram'
    ? toOptionalPositiveInteger(event.payload.messageThreadId)
    : undefined;

  return {
    id: event.id,
    createdAt,
    source: event.source,
    gateway,
    destinationId,
    ...(messageThreadId !== undefined ? { messageThreadId } : {}),
    message,
    taskId,
    status,
    logPath: toOptionalString(event.payload.logPath),
  };
}

export class PersonalAgentDaemon {
  private readonly config: DaemonConfig;
  private readonly paths: DaemonPaths;
  private readonly runsRoot: string;
  private readonly bus: EventBus;
  private readonly startedAt: string;
  private readonly pid: number;
  private readonly modules: ModuleRuntime[];
  private readonly pendingGatewayNotifications: GatewayNotification[] = [];
  private readonly activeBackgroundRuns = new Map<string, ActiveBackgroundRunHandle>();

  private server?: Server;
  private timerHandles: NodeJS.Timeout[] = [];
  private stopping = false;

  constructor(config: DaemonConfig = loadDaemonConfig()) {
    this.config = config;
    this.paths = resolveDaemonPaths(config.ipc.socketPath);
    this.runsRoot = resolveDurableRunsRoot(this.paths.root);
    this.startedAt = new Date().toISOString();
    this.pid = process.pid;

    this.bus = new EventBus({
      maxDepth: config.queue.maxDepth,
      onHandlerError: (event, error) => {
        this.log('error', `event handler failed type=${event.type} id=${event.id} error=${error.message}`);
      },
    });

    this.bus.subscribe('gateway.notification', (event) => {
      const notification = parseGatewayNotification(event);
      if (!notification) {
        this.log('warn', `invalid gateway.notification payload id=${event.id}`);
        return;
      }

      if (this.pendingGatewayNotifications.length >= this.config.queue.maxDepth) {
        this.pendingGatewayNotifications.shift();
      }

      this.pendingGatewayNotifications.push(notification);
    });

    this.modules = createBuiltinModules(config)
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

  async start(): Promise<void> {
    ensureDaemonDirectories(this.paths);
    mkdirSync(this.runsRoot, { recursive: true, mode: 0o700 });
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

    this.log('info', `personal-agentd started pid=${this.pid} socket=${this.paths.socketPath}`);
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

    for (const moduleRuntime of this.modules) {
      if (moduleRuntime.module.stop) {
        try {
          await moduleRuntime.module.stop(this.createModuleContext(moduleRuntime.module.name));
        } catch (error) {
          this.log('warn', `module stop failed: ${moduleRuntime.module.name}: ${(error as Error).message}`);
        }
      }
    }

    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => resolve());
    });

    if (existsSync(this.paths.socketPath)) {
      rmSync(this.paths.socketPath, { force: true });
    }

    if (existsSync(this.paths.pidFile)) {
      rmSync(this.paths.pidFile, { force: true });
    }
  }

  getStatus(): DaemonStatus {
    return {
      running: !this.stopping,
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
        debug: (message) => this.log('debug', `${logPrefix} ${message}`),
        info: (message) => this.log('info', `${logPrefix} ${message}`),
        warn: (message) => this.log('warn', `${logPrefix} ${message}`),
        error: (message) => this.log('error', `${logPrefix} ${message}`),
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

  private handleLine(socket: Socket, rawLine: string): void {
    try {
      const request = parseRequest(rawLine);
      void this.handleRequest(socket, request);
    } catch (error) {
      socket.write(serializeResponse({
        id: 'unknown',
        ok: false,
        error: (error as Error).message,
      }));
    }
  }

  private async handleRequest(socket: Socket, request: DaemonRequest): Promise<void> {
    if (request.type === 'ping') {
      socket.write(serializeResponse({ id: request.id, ok: true, result: { pong: true } }));
      return;
    }

    if (request.type === 'status') {
      socket.write(serializeResponse({ id: request.id, ok: true, result: this.getStatus() }));
      return;
    }

    if (request.type === 'notifications.pull') {
      socket.write(serializeResponse({
        id: request.id,
        ok: true,
        result: {
          notifications: this.pullGatewayNotifications(request.gateway, request.limit),
        },
      }));
      return;
    }

    if (request.type === 'runs.list') {
      socket.write(serializeResponse({
        id: request.id,
        ok: true,
        result: this.listDurableRuns(),
      }));
      return;
    }

    if (request.type === 'runs.get') {
      const result = this.getDurableRun(request.runId);
      if (!result) {
        socket.write(serializeResponse({
          id: request.id,
          ok: false,
          error: `Run not found: ${request.runId}`,
        }));
        return;
      }

      socket.write(serializeResponse({
        id: request.id,
        ok: true,
        result,
      }));
      return;
    }

    if (request.type === 'runs.startTask') {
      socket.write(serializeResponse({
        id: request.id,
        ok: true,
        result: await this.startScheduledTaskRun(request.filePath),
      }));
      return;
    }

    if (request.type === 'runs.startBackground') {
      socket.write(serializeResponse({
        id: request.id,
        ok: true,
        result: await this.startBackgroundRun(request.input),
      }));
      return;
    }

    if (request.type === 'runs.cancel') {
      socket.write(serializeResponse({
        id: request.id,
        ok: true,
        result: await this.cancelBackgroundRun(request.runId),
      }));
      return;
    }

    if (request.type === 'conversations.sync') {
      socket.write(serializeResponse({
        id: request.id,
        ok: true,
        result: await this.syncWebLiveConversationRun(request.input),
      }));
      return;
    }

    if (request.type === 'conversations.recoverable') {
      socket.write(serializeResponse({
        id: request.id,
        ok: true,
        result: this.listRecoverableWebLiveConversationRuns(),
      }));
      return;
    }

    if (request.type === 'stop') {
      socket.write(serializeResponse({ id: request.id, ok: true, result: { stopping: true } }));
      setTimeout(() => {
        void this.stop().then(() => process.exit(0));
      }, 10);
      return;
    }

    if (request.type === 'emit') {
      if (!isDaemonEvent(request.event)) {
        socket.write(serializeResponse({ id: request.id, ok: false, error: 'Invalid event envelope' }));
        return;
      }

      const accepted = this.bus.publish(request.event);
      socket.write(serializeResponse({
        id: request.id,
        ok: true,
        result: {
          accepted,
          reason: accepted ? undefined : 'event queue is full',
        },
      }));

      this.log('debug', `event accepted=${accepted} type=${request.event.type} source=${request.event.source}`);
    }
  }

  private listDurableRuns(): ListDurableRunsResult {
    const scannedAt = new Date().toISOString();
    const runs = scanDurableRunsForRecovery(this.runsRoot);

    return {
      scannedAt,
      runs,
      summary: summarizeScannedDurableRuns(runs),
    };
  }

  private getDurableRun(runId: string): GetDurableRunResult | undefined {
    const run = scanDurableRun(this.runsRoot, runId);
    if (!run) {
      return undefined;
    }

    return {
      scannedAt: new Date().toISOString(),
      run,
    };
  }

  private async startScheduledTaskRun(filePath: string): Promise<StartScheduledTaskRunResult> {
    const runId = `task-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const accepted = this.bus.publish(createDaemonEvent({
      type: 'tasks.run.requested',
      source: 'daemon:ipc',
      payload: {
        filePath,
        runId,
        requestedAt: new Date().toISOString(),
      },
    }));

    if (!accepted) {
      return {
        accepted: false,
        runId,
        reason: 'event queue is full',
      };
    }

    await this.bus.waitForIdle();

    if (!scanDurableRun(this.runsRoot, runId)) {
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

  private async startBackgroundRun(input: StartBackgroundRunInput): Promise<StartBackgroundRunResult> {
    const record = await createBackgroundRunRecord(this.runsRoot, input);
    const startedAt = new Date().toISOString();
    const outputStream = createWriteStream(record.paths.outputLogPath, { flags: 'a', encoding: 'utf-8' });

    const child = input.argv
      ? spawn(input.argv[0] as string, input.argv.slice(1), {
          cwd: input.cwd,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawn('sh', ['-lc', input.shellCommand as string], {
          cwd: input.cwd,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

    child.stdout.on('data', (chunk: Buffer | string) => {
      outputStream.write(chunk.toString());
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
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
      await finalizeBackgroundRun({
        runId: record.runId,
        runPaths: record.paths,
        taskSlug: input.taskSlug,
        cwd: input.cwd,
        startedAt,
        endedAt: new Date().toISOString(),
        exitCode: 1,
        signal: null,
        cancelled: false,
        error: startState.error,
      });
      return {
        accepted: false,
        runId: record.runId,
        logPath: record.paths.outputLogPath,
        reason: startState.error,
      };
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

    await markBackgroundRunStarted({
      runId: record.runId,
      runPaths: record.paths,
      startedAt,
      pid: child.pid ?? -1,
      taskSlug: input.taskSlug,
      cwd: input.cwd,
    });

    child.once('exit', (code, signal) => {
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
          : (typeof code === 'number' && code === 0 ? undefined : `Command exited with code ${String(code ?? signal ?? 1)}`),
      }).finally(() => {
        outputStream.end();
      });
    });

    this.log('info', `background run started id=${record.runId} pid=${String(child.pid ?? 'n/a')} cwd=${input.cwd}`);
    return {
      accepted: true,
      runId: record.runId,
      logPath: record.paths.outputLogPath,
    };
  }

  private async cancelBackgroundRun(runId: string, reason = 'Cancelled by user'): Promise<CancelDurableRunResult> {
    const active = this.activeBackgroundRuns.get(runId);
    if (active) {
      active.cancelling = true;
      active.cancelReason = reason;
      if (!active.child.killed) {
        active.child.kill('SIGTERM');
      }
      active.forceKillTimer = setTimeout(() => {
        if (!active.settled) {
          active.child.kill('SIGKILL');
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

    if (run.manifest?.kind !== 'background-run') {
      return {
        cancelled: false,
        runId,
        reason: 'only daemon background runs can be cancelled',
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

    this.log('info', `background run cancelled from durable state id=${runId}`);
    return {
      cancelled: true,
      runId,
    };
  }

  private async recoverInterruptedBackgroundRuns(): Promise<void> {
    const runs = scanDurableRunsForRecovery(this.runsRoot);

    await Promise.all(runs.map(async (run) => {
      if (run.manifest?.kind !== 'background-run') {
        return;
      }

      await markBackgroundRunInterrupted({
        runId: run.runId,
        runPaths: resolveDurableRunPaths(this.runsRoot, run.runId),
        reason: 'Daemon restarted before background run completion.',
      });
    }));
  }

  private async syncWebLiveConversationRun(
    input: SyncWebLiveConversationRunRequestInput,
  ): Promise<SyncWebLiveConversationRunResult> {
    return saveWebLiveConversationRunState(input);
  }

  private listRecoverableWebLiveConversationRuns(): ListRecoverableWebLiveConversationRunsResult {
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

  private pullGatewayNotifications(gateway: GatewayNotificationProvider, limit?: number): GatewayNotification[] {
    const maxItems = normalizeNotificationPullLimit(limit);
    const output: GatewayNotification[] = [];

    for (let index = 0; index < this.pendingGatewayNotifications.length && output.length < maxItems;) {
      const notification = this.pendingGatewayNotifications[index];
      if (!notification) {
        index += 1;
        continue;
      }

      if (notification.gateway !== gateway) {
        index += 1;
        continue;
      }

      output.push(notification);
      this.pendingGatewayNotifications.splice(index, 1);
    }

    return output;
  }

  private log(level: LogLevel, message: string): void {
    if (LEVELS[level] < LEVELS[this.config.logLevel]) {
      return;
    }

    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
  }
}

export async function runDaemonProcess(): Promise<void> {
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
