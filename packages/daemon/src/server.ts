import { spawn, type ChildProcess } from 'child_process';
import { createServer, type Server, type Socket } from 'net';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDurableSessionsDir } from '@personal-agent/core';
import { looksLikePersonalAgentCliEntryPath } from './background-run-agent.js';
import { EventBus } from './event-bus.js';
import { createDaemonEvent, isDaemonEvent } from './events.js';
import { parseRequest, serializeResponse, type DaemonRequest, type DaemonResponse } from './ipc-protocol.js';
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
import { surfaceBackgroundRunResultsIfReady } from './runs/background-run-deferred-resumes.js';
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

const BACKGROUND_RUN_SESSIONS_DIR_NAME = '__runs';

function looksLikePaCommand(binary: string | undefined): boolean {
  const normalized = binary?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized === 'pa'
    || normalized.endsWith('/pa')
    || normalized.endsWith('\\pa')
    || normalized === 'pa.cmd'
    || normalized.endsWith('/pa.cmd')
    || normalized.endsWith('\\pa.cmd');
}

function hasExplicitSessionOverride(argv: string[] | undefined): boolean {
  if (!argv) {
    return false;
  }

  return argv.some((arg) => (
    arg === '--no-session'
    || arg === '--session'
    || arg.startsWith('--session=')
    || arg === '--session-dir'
    || arg.startsWith('--session-dir=')
    || arg === '--resume'
    || arg === '--continue'
  ));
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveBackgroundRunSessionDir(runId: string): string {
  return join(getDurableSessionsDir(), BACKGROUND_RUN_SESSIONS_DIR_NAME, runId);
}

function appendBackgroundRunSessionDir(input: {
  argv?: string[];
  shellCommand?: string;
}, runId: string): {
  argv?: string[];
  shellCommand?: string;
} {
  const sessionDir = resolveBackgroundRunSessionDir(runId);

  if (input.argv && input.argv.length > 0) {
    const argv = input.argv;
    const directPa = looksLikePaCommand(argv[0]);
    const nodeCliEntry = looksLikePersonalAgentCliEntryPath(argv[1]);
    const firstPiArgIndex = nodeCliEntry ? 2 : 1;

    if ((!directPa && !nodeCliEntry) || hasExplicitSessionOverride(argv.slice(firstPiArgIndex))) {
      return { argv };
    }

    return {
      argv: [...argv, '--session-dir', sessionDir],
    };
  }

  const shellCommand = input.shellCommand;
  if (!shellCommand) {
    return {};
  }

  const trimmedCommand = shellCommand.trim();
  if (!/^pa(?:\s|$)/.test(trimmedCommand)) {
    return { shellCommand };
  }

  if (/--no-session\b|--resume\b|--continue\b|--session(?:=|\s)|--session-dir(?:=|\s)/.test(trimmedCommand)) {
    return { shellCommand };
  }

  return {
    shellCommand: `${shellCommand} --session-dir ${quoteShellArg(sessionDir)}`,
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
  private readonly activeBackgroundRuns = new Map<string, ActiveBackgroundRunHandle>();
  private readonly socketTraces = new WeakMap<Socket, IpcSocketTrace>();

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
    this.socketTraces.set(socket, {});

    socket.on('close', () => {
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
        result: await this.startScheduledTaskRun(request.filePath),
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
      this.respond(socket, { id: request.id, ok: true, result: { stopping: true } });
      setTimeout(() => {
        void this.stop().then(() => process.exit(0));
      }, 10);
      return;
    }

    if (request.type === 'emit') {
      if (!isDaemonEvent(request.event)) {
        this.respond(socket, { id: request.id, ok: false, error: 'Invalid event envelope' });
        return;
      }

      const accepted = this.bus.publish(request.event);
      this.respond(socket, {
        id: request.id,
        ok: true,
        result: {
          accepted,
          reason: accepted ? undefined : 'event queue is full',
        },
      });

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

  private async startBackgroundRun(input: StartBackgroundRunInput): Promise<StartBackgroundRunResult> {
    const record = await createBackgroundRunRecord(this.runsRoot, input);
    const startedAt = new Date().toISOString();
    const outputStream = createWriteStream(record.paths.outputLogPath, { flags: 'a', encoding: 'utf-8' });
    const spawnInput = appendBackgroundRunSessionDir({
      argv: record.argv,
      shellCommand: record.shellCommand,
    }, record.runId);

    const childEnv = {
      ...process.env,
      PERSONAL_AGENT_RUN_ID: record.runId,
      PERSONAL_AGENT_RUN_ROOT: record.paths.root,
      PERSONAL_AGENT_RUN_MANIFEST_PATH: record.paths.manifestPath,
      PERSONAL_AGENT_RUN_STATUS_PATH: record.paths.statusPath,
      PERSONAL_AGENT_RUN_CHECKPOINT_PATH: record.paths.checkpointPath,
      PERSONAL_AGENT_RUN_EVENTS_PATH: record.paths.eventsPath,
      PERSONAL_AGENT_RUN_OUTPUT_LOG_PATH: record.paths.outputLogPath,
      PERSONAL_AGENT_RUN_RESULT_PATH: record.paths.resultPath,
    };

    const child = spawnInput.argv
      ? spawn(spawnInput.argv[0] as string, spawnInput.argv.slice(1), {
          cwd: input.cwd,
          env: childEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawn('sh', ['-lc', spawnInput.shellCommand as string], {
          cwd: input.cwd,
          env: childEnv,
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
      })
        .then(async () => {
          await this.surfaceBackgroundRunResults(record.runId);
        })
        .finally(() => {
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
    await this.surfaceBackgroundRunResults(runId);

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

      const interrupted = await markBackgroundRunInterrupted({
        runId: run.runId,
        runPaths: resolveDurableRunPaths(this.runsRoot, run.runId),
        reason: 'Daemon restarted before background run completion.',
      });
      if (interrupted) {
        await this.surfaceBackgroundRunResults(run.runId);
      }
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
