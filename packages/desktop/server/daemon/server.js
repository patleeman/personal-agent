import { hydrateProcessEnvFromShell, resolveChildProcessEnv } from '@personal-agent/core';
import { spawn } from 'child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { createServer } from 'net';
import { looksLikePersonalAgentCliEntryPath } from './background-run-agent.js';
import { loadDaemonConfig } from './config.js';
import { EventBus } from './event-bus.js';
import { createDaemonEvent, isDaemonEvent } from './events.js';
import { parseRequest, serializeResponse } from './ipc-protocol.js';
import { createBuiltinModules } from './modules/index.js';
import { ensureDaemonDirectories, resolveDaemonPaths } from './paths.js';
import { deliverBackgroundRunCallbackWakeup } from './runs/background-run-callbacks.js';
import { surfaceBackgroundRunResultsIfReady } from './runs/background-run-deferred-resumes.js';
import { buildFollowUpBackgroundRunInput, buildRerunBackgroundRunInput } from './runs/background-run-replays.js';
import { resolveBackgroundRunSessionDir } from './runs/background-run-sessions.js';
import { createBackgroundRunRecord, finalizeBackgroundRun, markBackgroundRunCancelling, markBackgroundRunInterrupted, markBackgroundRunStarted, } from './runs/background-runs.js';
import { resolveDurableRunPaths, resolveDurableRunsRoot, scanDurableRun, scanDurableRunsForRecovery, summarizeScannedDurableRuns, } from './runs/store.js';
import { listRecoverableWebLiveConversationRuns, saveWebLiveConversationRunState } from './runs/web-live-conversations.js';
const LEVELS = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
function looksLikePaCommand(binary) {
    const normalized = binary?.trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    return (normalized === 'pa' ||
        normalized.endsWith('/pa') ||
        normalized.endsWith('\\pa') ||
        normalized === 'pa.cmd' ||
        normalized.endsWith('/pa.cmd') ||
        normalized.endsWith('\\pa.cmd'));
}
function hasExplicitSessionOverride(argv) {
    if (!argv) {
        return false;
    }
    return argv.some((arg) => arg === '--no-session' ||
        arg === '--session' ||
        arg.startsWith('--session=') ||
        arg === '--session-dir' ||
        arg.startsWith('--session-dir=') ||
        arg === '--resume' ||
        arg === '--continue');
}
function quoteShellArg(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
function appendBackgroundRunSessionDir(input, runId) {
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
            argv: [...argv, '--session-dir', sessionDir, ...(input.continueSession ? ['--continue'] : [])],
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
        shellCommand: `${shellCommand} --session-dir ${quoteShellArg(sessionDir)}${input.continueSession ? ' --continue' : ''}`,
    };
}
function isDaemonConfig(value) {
    return 'modules' in value && 'queue' in value && 'ipc' in value;
}
export class PersonalAgentDaemon {
    config;
    paths;
    runsRoot;
    bus;
    startedAt;
    pid;
    modules;
    stopRequestBehavior;
    logSink;
    activeBackgroundRuns = new Map();
    socketTraces = new WeakMap();
    server;
    timerHandles = [];
    running = false;
    stopping = false;
    constructor(input = loadDaemonConfig()) {
        const options = isDaemonConfig(input) ? { config: input } : input;
        this.config = options.config ?? loadDaemonConfig();
        this.stopRequestBehavior = options.stopRequestBehavior ?? 'exit-process';
        this.logSink = options.logSink;
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
    getSocketPath() {
        return this.paths.socketPath;
    }
    async start() {
        if (this.running) {
            return;
        }
        this.stopping = false;
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
        await new Promise((resolve, reject) => {
            this.server?.once('error', reject);
            this.server?.listen(this.paths.socketPath, () => {
                resolve();
            });
        });
        this.running = true;
        this.log('info', `personal-agentd started pid=${this.pid} socket=${this.paths.socketPath}`);
    }
    async stop() {
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
                }
                catch (error) {
                    this.log('warn', `module stop failed: ${moduleRuntime.module.name}: ${error.message}`);
                }
            }
        }
        await new Promise((resolve) => {
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
        this.server = undefined;
        this.running = false;
        this.stopping = false;
    }
    isRunning() {
        return this.running && !this.stopping;
    }
    getStatus() {
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
    prepareSocket() {
        if (existsSync(this.paths.socketPath)) {
            rmSync(this.paths.socketPath, { force: true });
        }
    }
    createModuleContext(moduleName) {
        const logPrefix = `[module:${moduleName}]`;
        return {
            config: this.config,
            paths: this.paths,
            publish: (type, payload) => {
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
    registerModuleSubscriptions(moduleRuntime) {
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
    registerModuleTimers(module) {
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
    attachConnection(socket) {
        let buffer = '';
        this.socketTraces.set(socket, {});
        socket.on('close', () => {
            this.socketTraces.delete(socket);
        });
        socket.on('error', (error) => {
            this.handleSocketError(socket, error);
        });
        socket.on('data', (chunk) => {
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
    getSocketTrace(socket) {
        const existing = this.socketTraces.get(socket);
        if (existing) {
            return existing;
        }
        const trace = {};
        this.socketTraces.set(socket, trace);
        return trace;
    }
    formatSocketTrace(trace) {
        const parts = [];
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
    handleSocketError(socket, error) {
        const socketError = error;
        const trace = this.getSocketTrace(socket);
        const traceSuffix = this.formatSocketTrace(trace);
        if (socketError.code === 'EPIPE' || socketError.code === 'ECONNRESET') {
            const level = trace.lastRequestType || trace.lastResponseId ? 'info' : 'debug';
            this.log(level, `ipc client disconnected code=${socketError.code}${traceSuffix}`);
            return;
        }
        this.log('warn', `ipc socket error code=${socketError.code ?? 'UNKNOWN'} message=${error.message}${traceSuffix}`);
    }
    respond(socket, response) {
        const trace = this.getSocketTrace(socket);
        trace.lastResponseId = response.id;
        const traceSuffix = this.formatSocketTrace(trace);
        if (socket.destroyed || !socket.writable) {
            this.log('debug', `ipc response dropped id=${response.id} reason=socket-not-writable${traceSuffix}`);
            return;
        }
        socket.write(serializeResponse(response));
    }
    handleLine(socket, rawLine) {
        try {
            const request = parseRequest(rawLine);
            const trace = this.getSocketTrace(socket);
            trace.lastRequestId = request.id;
            trace.lastRequestType = request.type;
            void this.handleRequest(socket, request).catch((error) => {
                this.respond(socket, {
                    id: request.id,
                    ok: false,
                    error: error.message,
                });
            });
        }
        catch (error) {
            this.respond(socket, {
                id: 'unknown',
                ok: false,
                error: error.message,
            });
        }
    }
    async handleRequest(socket, request) {
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
    async requestStop() {
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
                this.log('error', `daemon stop request failed: ${error.message}`);
            });
        }, 10);
        return { stopping: true };
    }
    publishEvent(event) {
        const accepted = this.bus.publish(event);
        this.log('debug', `event accepted=${accepted} type=${event.type} source=${event.source}`);
        return accepted;
    }
    listDurableRuns() {
        const scannedAt = new Date().toISOString();
        const runs = scanDurableRunsForRecovery(this.runsRoot);
        return {
            scannedAt,
            runs,
            summary: summarizeScannedDurableRuns(runs),
        };
    }
    getDurableRun(runId) {
        const run = scanDurableRun(this.runsRoot, runId);
        if (!run) {
            return undefined;
        }
        return {
            scannedAt: new Date().toISOString(),
            run,
        };
    }
    async waitForScheduledRunRecord(runId) {
        const deadlineMs = Date.now() + 1500;
        while (Date.now() < deadlineMs) {
            if (scanDurableRun(this.runsRoot, runId)) {
                return true;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return Boolean(scanDurableRun(this.runsRoot, runId));
    }
    async startScheduledTaskRun(taskId) {
        const runId = `task-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
        const accepted = this.bus.publish(createDaemonEvent({
            type: 'tasks.run.requested',
            source: 'daemon:ipc',
            payload: {
                taskId,
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
    async surfaceBackgroundRunResults(triggerRunId) {
        try {
            const result = await surfaceBackgroundRunResultsIfReady({
                runsRoot: this.runsRoot,
                triggerRunId,
            });
            if (!result.resultId) {
                return;
            }
            this.log('info', `background run results surfaced run=${triggerRunId} result=${result.resultId} surfaced=${result.surfacedRunIds.join(',')}`);
        }
        catch (error) {
            this.log('warn', `background run result surfacing failed run=${triggerRunId} error=${error.message}`);
        }
    }
    async surfaceBackgroundRunOutcome(triggerRunId) {
        try {
            const callback = await deliverBackgroundRunCallbackWakeup({
                daemonRoot: this.paths.root,
                stateRoot: this.paths.stateRoot,
                runsRoot: this.runsRoot,
                runId: triggerRunId,
            });
            if (callback.delivered) {
                this.log('info', `background run callback delivered run=${triggerRunId} wakeup=${callback.wakeupId ?? 'n/a'} conversation=${callback.conversationId ?? 'n/a'}`);
                return;
            }
        }
        catch (error) {
            this.log('warn', `background run callback delivery failed run=${triggerRunId} error=${error.message}`);
        }
        await this.surfaceBackgroundRunResults(triggerRunId);
    }
    async finalizeBackgroundRunStartFailure(input) {
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
    async spawnBackgroundRun(input) {
        const record = await createBackgroundRunRecord(this.runsRoot, input);
        const startedAt = new Date().toISOString();
        if (input.bootstrapSessionDir) {
            try {
                cpSync(input.bootstrapSessionDir, resolveBackgroundRunSessionDir(record.runId), { recursive: true, force: true });
            }
            catch (error) {
                return this.finalizeBackgroundRunStartFailure({
                    runId: record.runId,
                    runPaths: record.paths,
                    taskSlug: input.taskSlug,
                    cwd: input.cwd,
                    startedAt,
                    error: `Could not prepare follow-up session: ${error.message}`,
                });
            }
        }
        const outputStream = createWriteStream(record.paths.outputLogPath, { flags: 'a', encoding: 'utf-8' });
        const spawnInput = appendBackgroundRunSessionDir({
            argv: record.argv,
            shellCommand: record.shellCommand,
            continueSession: input.continueSession,
        }, record.runId);
        const childEnv = resolveChildProcessEnv({
            PERSONAL_AGENT_RUN_ID: record.runId,
            PERSONAL_AGENT_RUN_ROOT: record.paths.root,
            PERSONAL_AGENT_RUN_MANIFEST_PATH: record.paths.manifestPath,
            PERSONAL_AGENT_RUN_STATUS_PATH: record.paths.statusPath,
            PERSONAL_AGENT_RUN_CHECKPOINT_PATH: record.paths.checkpointPath,
            PERSONAL_AGENT_RUN_EVENTS_PATH: record.paths.eventsPath,
            PERSONAL_AGENT_RUN_OUTPUT_LOG_PATH: record.paths.outputLogPath,
            PERSONAL_AGENT_RUN_RESULT_PATH: record.paths.resultPath,
        });
        const child = spawnInput.argv
            ? spawn(spawnInput.argv[0], spawnInput.argv.slice(1), {
                cwd: input.cwd,
                env: childEnv,
                stdio: ['ignore', 'pipe', 'pipe'],
            })
            : spawn('sh', ['-lc', spawnInput.shellCommand], {
                cwd: input.cwd,
                env: childEnv,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        child.stdout.on('data', (chunk) => {
            outputStream.write(chunk.toString());
        });
        child.stderr.on('data', (chunk) => {
            outputStream.write(chunk.toString());
        });
        const startState = await new Promise((resolve) => {
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
        const handle = {
            runId: record.runId,
            taskSlug: input.taskSlug,
            cwd: input.cwd,
            startedAt,
            child,
            cancelling: false,
            settled: false,
        };
        this.activeBackgroundRuns.set(record.runId, handle);
        const finalizeExitedRun = (code, signal) => {
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
        let exitBeforeStartMarked = null;
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
            const exitInfo = exitBeforeStartMarked;
            finalizeExitedRun(exitInfo.code, exitInfo.signal);
        }
        this.log('info', `background run started id=${record.runId} pid=${String(child.pid ?? 'n/a')} cwd=${input.cwd}`);
        return {
            accepted: true,
            runId: record.runId,
            logPath: record.paths.outputLogPath,
        };
    }
    async startBackgroundRun(input) {
        return this.spawnBackgroundRun(input);
    }
    getReplayableBackgroundRun(runId) {
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
    async rerunBackgroundRun(runId) {
        const run = this.getReplayableBackgroundRun(runId);
        const result = await this.spawnBackgroundRun(buildRerunBackgroundRunInput(run));
        return {
            ...result,
            sourceRunId: runId,
        };
    }
    async followUpBackgroundRun(runId, prompt) {
        const run = this.getReplayableBackgroundRun(runId);
        const result = await this.spawnBackgroundRun(buildFollowUpBackgroundRunInput(run, prompt?.trim() || 'Continue from where you left off.'));
        return {
            ...result,
            sourceRunId: runId,
        };
    }
    async cancelBackgroundRun(runId, reason = 'Cancelled by user') {
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
    async recoverInterruptedBackgroundRuns() {
        const runs = scanDurableRunsForRecovery(this.runsRoot);
        await Promise.all(runs.map(async (run) => {
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
        }));
    }
    async syncWebLiveConversationRun(input) {
        return saveWebLiveConversationRunState(input);
    }
    listRecoverableWebLiveConversationRuns() {
        return {
            runs: listRecoverableWebLiveConversationRuns(),
        };
    }
    logDurableRunRecoverySummary(reason) {
        const runs = scanDurableRunsForRecovery(this.runsRoot);
        const summary = summarizeScannedDurableRuns(runs);
        if (summary.total === 0) {
            this.log('debug', `durable run scan reason=${reason} total=0`);
            return;
        }
        this.log('info', [
            `durable run scan reason=${reason}`,
            `total=${summary.total}`,
            `resume=${summary.recoveryActions.resume}`,
            `rerun=${summary.recoveryActions.rerun}`,
            `attention=${summary.recoveryActions.attention}`,
            `invalid=${summary.recoveryActions.invalid}`,
        ].join(' '));
    }
    log(level, message) {
        if (LEVELS[level] < LEVELS[this.config.logLevel]) {
            return;
        }
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] [${level}] ${message}`;
        if (this.logSink) {
            this.logSink(line);
            return;
        }
        console.log(line);
    }
}
export async function runDaemonProcess() {
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
