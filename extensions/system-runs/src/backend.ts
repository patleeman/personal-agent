type RunAgentExtensionFactory = (api: RegisterToolApi) => void;

interface NativeBackendContext {
  toolContext?: { conversationId?: string; cwd?: string; sessionFile?: string; sessionId?: string };
  ui: { invalidate(topics: string | string[]): void };
  shell: {
    exec(input: { command: string; cwd?: string; timeoutMs?: number }): Promise<{
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
    const result = await ctx.shell.exec({ command, cwd, timeoutMs: timeoutSeconds ? timeoutSeconds * 1000 : undefined });
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
  if (params.action === 'start') {
    return startBackgroundCommand(params, ctx);
  }

  return executeRunInput(input, ctx, 'background_command');
}

export async function subagent(input: unknown, ctx: NativeBackendContext) {
  const params = typeof input === 'object' && input !== null && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
  if (params.action === 'start') {
    params.action = 'start_agent';
  }
  return executeRunInput(params, ctx, 'subagent');
}
