import { existsSync, readFileSync, statSync } from 'node:fs';

type RunAgentExtensionFactory = (api: RegisterToolApi) => void;

interface NativeBackendContext {
  toolContext?: { conversationId?: string; cwd?: string; sessionFile?: string; sessionId?: string };
  ui: { invalidate(topics: string | string[]): void };
  shell: {
    exec(input: { command: string; args?: string[]; cwd?: string; timeoutMs?: number }): Promise<{
      stdout?: string;
      stderr?: string;
      executionWrappers?: Array<{ id: string; label?: string }>;
    }>;
  };
}

interface RegisteredTool {
  name?: string;
  execute?: (...args: unknown[]) => Promise<unknown> | unknown;
}

interface RegisterToolApi {
  registerTool(tool: RegisteredTool): void;
}

interface ToolExecutionResult {
  content?: Array<{ type?: string; text?: string }>;
  details?: Record<string, unknown>;
  isError?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readTimeoutSeconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readRequiredString(value: unknown, label: string): string {
  const normalized = readString(value);
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

async function loadDaemon() {
  return import('@personal-agent/daemon');
}

async function runForegroundBash(
  command: string,
  cwd: string | undefined,
  timeoutSeconds: number | undefined,
  ctx: NativeBackendContext,
): Promise<ToolExecutionResult> {
  try {
    const result = await ctx.shell.exec({
      command: 'sh',
      args: ['-lc', command],
      cwd,
      timeoutMs: timeoutSeconds ? timeoutSeconds * 1000 : undefined,
    });
    const output = [result.stdout?.trimEnd(), result.stderr?.trimEnd()].filter(Boolean).join('\n');
    return {
      content: [{ type: 'text', text: output || '(no output)' }],
      details: { executionWrappers: result.executionWrappers ?? [] },
    };
  } catch (error) {
    return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}

async function loadRunAgentExtensionFactory(): Promise<RunAgentExtensionFactory> {
  const module = await import('./runTool.js');
  return module.createRunAgentExtension({
    getCurrentProfile: () => 'shared',
    repoRoot: process.cwd(),
    profilesRoot: process.cwd(),
  }) as RunAgentExtensionFactory;
}

async function executeRegisteredTool(factory: RunAgentExtensionFactory, input: unknown, ctx: NativeBackendContext, toolName: string) {
  const registeredTools = new Map<string, RegisteredTool>();
  let fallbackTool: RegisteredTool | undefined;
  factory({
    registerTool(tool: RegisteredTool) {
      fallbackTool ??= tool;
      if (tool.name) {
        registeredTools.set(tool.name, tool);
      }
    },
  } as RegisterToolApi);

  const registeredTool = registeredTools.get(toolName) ?? fallbackTool;
  if (!registeredTool?.execute) {
    throw new Error(`Run tool backend did not register an executable ${toolName} tool.`);
  }

  return registeredTool.execute('extension-backend-run', input, undefined, undefined, {
    cwd: ctx.toolContext?.cwd,
    sessionManager: {
      getSessionId: () => ctx.toolContext?.conversationId ?? ctx.toolContext?.sessionId ?? '',
      getSessionFile: () => ctx.toolContext?.sessionFile,
      getCwd: () => ctx.toolContext?.cwd,
    },
  });
}

async function executeRunInput(input: unknown, ctx: NativeBackendContext, toolName: string) {
  const result = (await executeRegisteredTool(await loadRunAgentExtensionFactory(), input, ctx, toolName)) as ToolExecutionResult;
  ctx.ui.invalidate(['runs', 'tasks']);
  const text = Array.isArray(result?.content)
    ? result.content.map((item) => (item.type === 'text' ? (item.text ?? '') : JSON.stringify(item))).join('\n')
    : JSON.stringify(result, null, 2);
  return { text, ...(result?.details ? { details: result.details } : {}) };
}

function normalizeRunLogTail(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(1000, value) : 120;
}

function readTailText(filePath: string | undefined, maxLines = 120, maxBytes = 64 * 1024): string {
  if (!filePath || !existsSync(filePath)) {
    return '';
  }

  try {
    const size = statSync(filePath).size;
    const start = Math.max(0, size - maxBytes);
    return readFileSync(filePath, 'utf-8').slice(start).split(/\r?\n/).slice(-maxLines).join('\n').trim();
  } catch {
    return '';
  }
}

function formatBackgroundRunList(result: { runs?: Array<Record<string, unknown>>; summary?: { total?: number } }): string {
  const runs = Array.isArray(result.runs) ? result.runs : [];
  if (runs.length === 0) {
    return 'No durable runs found.';
  }

  return [
    `Durable runs (${result.summary?.total ?? runs.length}):`,
    ...runs.map((run) => {
      const status = isRecord(run.status) ? (readString(run.status.status) ?? 'unknown') : 'unknown';
      const manifest = isRecord(run.manifest) ? run.manifest : {};
      const source = isRecord(manifest.source) ? (readString(manifest.source.type) ?? 'unknown') : 'unknown';
      return `- ${String(run.runId ?? 'unknown')} [${status}] ${String(manifest.kind ?? 'unknown')} · source ${source}`;
    }),
  ].join('\n');
}

async function startBackgroundCommand(input: unknown, ctx: NativeBackendContext) {
  const params = isRecord(input) ? input : {};
  const command = readRequiredString(params.command, 'command');
  const cwd = readRequiredString(readString(params.cwd) ?? ctx.toolContext?.cwd, 'cwd');
  const taskSlug = readRequiredString(params.taskSlug, 'taskSlug');
  const conversationId = ctx.toolContext?.conversationId ?? ctx.toolContext?.sessionId ?? '';
  const conversationFile = ctx.toolContext?.sessionFile;
  const deliverResultToConversation = params.deliverResultToConversation === true;
  if (deliverResultToConversation && !conversationFile) {
    throw new Error('deliverResultToConversation requires an active persisted conversation.');
  }

  const daemon = await loadDaemon();
  if (!(await daemon.pingDaemon())) {
    throw new Error('Daemon is not responding. Ensure the desktop app is running.');
  }

  const result = await daemon.startBackgroundRun({
    taskSlug,
    cwd,
    shellCommand: command,
    source: {
      type: 'tool',
      id: conversationId,
      ...(conversationFile ? { filePath: conversationFile } : {}),
    },
    ...(deliverResultToConversation && conversationFile
      ? {
          callbackConversation: {
            conversationId,
            sessionFile: conversationFile,
            profile: 'shared',
            repoRoot: process.cwd(),
          },
          checkpointPayload: {
            resumeParentOnExit: true,
          },
        }
      : {}),
  });

  if (!result.accepted) {
    throw new Error(result.reason ?? `Could not start durable run for ${taskSlug}.`);
  }

  ctx.ui.invalidate(['runs', 'tasks']);
  return {
    text: `Started background command ${result.runId} for ${taskSlug}.`,
    details: {
      action: 'start',
      displayMode: 'terminal',
      command,
      runId: result.runId,
      taskSlug,
      cwd,
      logPath: result.logPath,
      deliverResultToConversation,
    },
  };
}

export async function run(input: unknown, ctx: NativeBackendContext) {
  return executeRunInput(input, ctx, 'run');
}

export async function bash(input: unknown, ctx: NativeBackendContext) {
  const params = isRecord(input) ? input : {};
  const command = readString(params.command);
  if (!command) {
    return { text: 'command is required', details: { isError: true } };
  }

  if (params.background === true) {
    const taskSlug =
      (readString(params.taskSlug) ??
        command
          .split(/\s+/)
          .slice(0, 2)
          .join('-')
          .replace(/[^a-zA-Z0-9_-]+/g, '-')
          .slice(0, 40)) ||
      'background-command';
    return startBackgroundCommand(
      {
        taskSlug,
        command,
        cwd: readString(params.cwd) ?? ctx.toolContext?.cwd,
        deliverResultToConversation: params.deliverResultToConversation === true,
      },
      ctx,
    );
  }

  const result = await runForegroundBash(command, readString(params.cwd) ?? ctx.toolContext?.cwd, readTimeoutSeconds(params.timeout), ctx);
  const text = Array.isArray(result.content) ? result.content.map((item) => item.text ?? '').join('\n') : '';
  return { text, ...(result.details ? { details: result.details } : {}), ...(result.isError ? { isError: true } : {}) };
}

export async function background_command(input: unknown, ctx: NativeBackendContext) {
  const params = isRecord(input) ? input : {};
  const action = readRequiredString(params.action, 'action');
  if (action === 'start') {
    return startBackgroundCommand(params, ctx);
  }

  const daemon = await loadDaemon();
  if (action === 'list') {
    const result = await daemon.listDurableRuns();
    return { text: formatBackgroundRunList(result), details: { action: 'list', runCount: result.runs.length } };
  }

  const runId = readRequiredString(params.runId, 'runId');
  if (action === 'get') {
    const result = await daemon.getDurableRun(runId);
    if (!result) throw new Error(`Run not found: ${runId}`);
    const run = result.run;
    return {
      text: [`Run ${run.runId}`, `status: ${run.status?.status ?? 'unknown'}`, `kind: ${run.manifest?.kind ?? 'unknown'}`].join('\n'),
      details: { action: 'get', runId, status: run.status?.status },
    };
  }

  if (action === 'logs') {
    const result = await daemon.getDurableRun(runId);
    if (!result) throw new Error(`Run not found: ${runId}`);
    const path = result.run.paths.outputLogPath;
    const tail = normalizeRunLogTail(params.tail);
    return {
      text: [`Run logs: ${runId}`, `path: ${path}`, '', readTailText(path, tail) || '(empty log)'].join('\n'),
      details: { action: 'logs', runId, tail, path },
    };
  }

  if (action === 'cancel') {
    const result = await daemon.cancelDurableRun(runId);
    ctx.ui.invalidate(['runs', 'tasks']);
    if (!result.cancelled) throw new Error(result.reason ?? `Could not cancel run ${runId}.`);
    return { text: `Cancelled background work ${runId}.`, details: { action: 'cancel', runId, cancelled: true } };
  }

  if (action === 'rerun') {
    const result = await daemon.rerunDurableRun(runId);
    ctx.ui.invalidate(['runs', 'tasks']);
    if (!result.accepted) throw new Error(result.reason ?? `Could not rerun ${runId}.`);
    return { text: `Rerun started ${result.runId} from ${runId}.`, details: { action: 'rerun', runId: result.runId, sourceRunId: runId } };
  }

  throw new Error(`Unsupported background command action: ${action}`);
}

export async function subagent(input: unknown, ctx: NativeBackendContext) {
  const params = typeof input === 'object' && input !== null && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
  if (params.action === 'start') {
    params.action = 'start_agent';
  }
  return executeRunInput(params, ctx, 'subagent');
}
