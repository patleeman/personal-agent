import { existsSync, readFileSync, statSync } from 'node:fs';

import {
  cancelDurableRun,
  followUpDurableRun,
  getDurableRun,
  getDurableRunLog,
  listDurableRuns,
  pingDaemon,
  rerunDurableRun,
  startBackgroundRun,
} from '@personal-agent/extensions/backend/runs';

type RunAgentExtensionFactory = (api: RegisterToolApi) => void;

interface NativeBackendContext {
  toolContext?: { conversationId?: string; cwd?: string; sessionFile?: string; sessionId?: string };
  agentToolContext?: { signal?: AbortSignal };
  ui?: { invalidate?(topics: string | string[]): void };
  shell: {
    exec(input: { command: string; args?: string[]; cwd?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<{
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
      signal: ctx.agentToolContext?.signal,
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
  ctx.ui?.invalidate?.(['executions', 'runs', 'tasks']);
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

function readRunId(run: Record<string, unknown>): string {
  return readString(run.runId) ?? 'unknown';
}

function readRunStatus(run: Record<string, unknown>): string {
  const status = isRecord(run.status) ? readString(run.status.status) : undefined;
  return status ?? 'unknown';
}

function readManifestKind(run: Record<string, unknown>): string | undefined {
  const manifest = isRecord(run.manifest) ? run.manifest : undefined;
  return readString(manifest?.kind);
}

function readRunSpec(run: Record<string, unknown>): Record<string, unknown> {
  const manifest = isRecord(run.manifest) ? run.manifest : undefined;
  return isRecord(manifest?.spec) ? manifest.spec : {};
}

function readRunTitle(run: Record<string, unknown>): string {
  const spec = readRunSpec(run);
  const metadata = isRecord(spec.metadata) ? spec.metadata : isRecord(spec.manifestMetadata) ? spec.manifestMetadata : {};
  const agent = isRecord(spec.agent) ? spec.agent : {};
  const prompt = readString(spec.prompt) ?? readString(agent.prompt);
  return (
    readString(metadata.title) ??
    readString(metadata.taskSlug) ??
    readString(spec.taskSlug) ??
    readString(spec.shellCommand) ??
    (prompt ? prompt.split(/\s+/).slice(0, 8).join(' ') : undefined) ??
    readRunId(run)
  );
}

function isBackgroundCommandRun(run: Record<string, unknown>): boolean {
  return readManifestKind(run) === 'raw-shell' || Boolean(readString(readRunSpec(run).shellCommand));
}

function isSubagentRun(run: Record<string, unknown>): boolean {
  return readManifestKind(run) === 'background-run';
}

function describeRunKind(run: Record<string, unknown>): string {
  if (isSubagentRun(run)) return 'subagent';
  if (isBackgroundCommandRun(run)) return 'background command';
  return readManifestKind(run) ?? 'unknown execution';
}

function assertRunKind(run: Record<string, unknown>, expected: 'background command' | 'subagent'): void {
  const matches = expected === 'background command' ? isBackgroundCommandRun(run) : isSubagentRun(run);
  if (matches) return;

  const actual = describeRunKind(run);
  const alternateTool = expected === 'background command' ? 'subagent' : 'background_command';
  throw new Error(`Run ${readRunId(run)} is a ${actual}, not a ${expected}. Use ${alternateTool} for this execution.`);
}

function formatScopedRunList(label: string, runs: Array<Record<string, unknown>>): string {
  if (runs.length === 0) {
    return `No ${label.toLowerCase()} found.`;
  }

  return [`${label} (${runs.length}):`, ...runs.map((run) => `- ${readRunId(run)} [${readRunStatus(run)}] ${readRunTitle(run)}`)].join(
    '\n',
  );
}

function formatRunSummary(label: string, run: Record<string, unknown>): string {
  return [`${label} ${readRunId(run)}`, `status: ${readRunStatus(run)}`, `title: ${readRunTitle(run)}`].join('\n');
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

  if (!(await pingDaemon())) {
    throw new Error('Daemon is not responding. Ensure the desktop app is running.');
  }

  const result = await startBackgroundRun({
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

  ctx.ui?.invalidate?.(['executions', 'runs', 'tasks']);
  return {
    text: `Started background command ${result.runId} for ${taskSlug}.`,
    details: {
      action: 'start',
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

  if (action === 'list') {
    const result = await listDurableRuns();
    const runs = (Array.isArray(result.runs) ? result.runs : []).filter(isBackgroundCommandRun);
    return {
      text: formatScopedRunList('Background commands', runs),
      details: { action: 'list', runCount: runs.length, runIds: runs.map(readRunId) },
    };
  }

  const runId = readRequiredString(params.runId, 'runId');
  const existing = await getDurableRun(runId);
  if (!existing) throw new Error(`Run not found: ${runId}`);
  const run = existing.run as Record<string, unknown>;
  assertRunKind(run, 'background command');

  if (action === 'get') {
    return {
      text: formatRunSummary('Background command', run),
      details: { action: 'get', runId, status: readRunStatus(run) },
    };
  }

  if (action === 'logs') {
    const path = isRecord(run.paths) ? readString(run.paths.outputLogPath) : undefined;
    const tail = normalizeRunLogTail(params.tail);
    return {
      text: [`Background command logs: ${runId}`, `path: ${path ?? ''}`, '', readTailText(path, tail) || '(empty log)'].join('\n'),
      details: { action: 'logs', runId, tail, path },
    };
  }

  if (action === 'cancel') {
    const result = await cancelDurableRun(runId);
    ctx.ui?.invalidate?.(['executions', 'runs', 'tasks']);
    if (!result.cancelled) throw new Error(result.reason ?? `Could not cancel background command ${runId}.`);
    return { text: `Cancelled background command ${runId}.`, details: { action: 'cancel', runId, cancelled: true } };
  }

  if (action === 'rerun') {
    const result = await rerunDurableRun(runId);
    ctx.ui?.invalidate?.(['executions', 'runs', 'tasks']);
    if (!result.accepted) throw new Error(result.reason ?? `Could not rerun background command ${runId}.`);
    return { text: `Rerun started ${result.runId} from ${runId}.`, details: { action: 'rerun', runId: result.runId, sourceRunId: runId } };
  }

  throw new Error(`Unsupported background command action: ${action}`);
}

export async function subagent(input: unknown, ctx: NativeBackendContext) {
  const params = typeof input === 'object' && input !== null && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
  if (params.action === 'start') {
    params.action = 'start_agent';
    return executeRunInput(params, ctx, 'subagent');
  }

  const action = readRequiredString(params.action, 'action');
  if (action === 'list') {
    const result = await listDurableRuns();
    const runs = (Array.isArray(result.runs) ? result.runs : []).filter(isSubagentRun);
    return {
      text: formatScopedRunList('Subagents', runs),
      details: { action: 'list', runCount: runs.length, runIds: runs.map(readRunId) },
    };
  }

  const runId = readRequiredString(params.runId, 'runId');
  const existing = await getDurableRun(runId);
  if (!existing) throw new Error(`Subagent not found: ${runId}`);
  const run = existing.run as Record<string, unknown>;
  assertRunKind(run, 'subagent');

  if (action === 'get') {
    return {
      text: formatRunSummary('Subagent', run),
      details: { action: 'get', runId, status: readRunStatus(run) },
    };
  }

  if (action === 'logs') {
    const tail = normalizeRunLogTail(params.tail);
    const result = await getDurableRunLog(runId, tail);
    if (!result) throw new Error(`Subagent not found: ${runId}`);
    return {
      text: [`Subagent logs: ${runId}`, `path: ${result.path}`, '', result.log || '(empty log)'].join('\n'),
      details: { action: 'logs', runId, tail, path: result.path },
    };
  }

  if (action === 'cancel') {
    const result = await cancelDurableRun(runId);
    ctx.ui?.invalidate?.(['executions', 'runs', 'tasks']);
    if (!result.cancelled) throw new Error(result.reason ?? `Could not cancel subagent ${runId}.`);
    return { text: `Cancelled subagent ${runId}.`, details: { action: 'cancel', runId, cancelled: true } };
  }

  if (action === 'rerun') {
    const result = await rerunDurableRun(runId);
    ctx.ui?.invalidate?.(['executions', 'runs', 'tasks']);
    if (!result.accepted) throw new Error(result.reason ?? `Could not rerun subagent ${runId}.`);
    return {
      text: `Subagent rerun started ${result.runId} from ${runId}.`,
      details: { action: 'rerun', runId: result.runId, sourceRunId: runId },
    };
  }

  if (action === 'follow_up') {
    const prompt = readString(params.prompt) ?? 'Continue from where you left off.';
    const result = await followUpDurableRun(runId, prompt);
    ctx.ui?.invalidate?.(['executions', 'runs', 'tasks']);
    if (!result.accepted) throw new Error(result.reason ?? `Could not continue subagent ${runId}.`);
    return {
      text: `Subagent follow-up started ${result.runId} from ${runId}.`,
      details: { action: 'follow_up', runId: result.runId, sourceRunId: runId, prompt },
    };
  }

  throw new Error(`Unsupported subagent action: ${action}`);
}
