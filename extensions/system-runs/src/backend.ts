import { spawn } from 'node:child_process';

type RunAgentExtensionFactory = (api: RegisterToolApi) => void;

interface NativeBackendContext {
  toolContext?: { conversationId?: string; cwd?: string; sessionFile?: string; sessionId?: string };
  ui: { invalidate(topics: string | string[]): void };
}

interface RegisteredTool {
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

function runForegroundBash(command: string, cwd: string | undefined, timeoutSeconds: number | undefined): Promise<ToolExecutionResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let timedOut = false;
    const timeout = timeoutSeconds
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, timeoutSeconds * 1000)
      : undefined;

    child.stdout?.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      if (timeout) clearTimeout(timeout);
      resolve({ content: [{ type: 'text', text: error.message }], isError: true });
    });
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      const output = Buffer.concat(chunks).toString('utf8');
      const status = timedOut
        ? `Command timed out after ${timeoutSeconds} seconds`
        : code && code !== 0
          ? `Command exited with code ${code}`
          : '';
      const text = [output.trimEnd(), status].filter(Boolean).join('\n\n') || '(no output)';
      resolve({ content: [{ type: 'text', text }], ...(status ? { isError: true } : {}) });
    });
  });
}

async function loadRunAgentExtensionFactory(): Promise<RunAgentExtensionFactory> {
  const module = await import('./runTool.js');
  return module.createRunAgentExtension({
    getCurrentProfile: () => 'shared',
    repoRoot: process.cwd(),
    profilesRoot: process.cwd(),
  }) as RunAgentExtensionFactory;
}

async function executeRegisteredTool(factory: RunAgentExtensionFactory, input: unknown, ctx: NativeBackendContext) {
  let registeredTool: RegisteredTool | undefined;
  factory({
    registerTool(tool: RegisteredTool) {
      registeredTool = tool;
    },
  } as RegisterToolApi);

  if (!registeredTool?.execute) {
    throw new Error('Run tool backend did not register an executable tool.');
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

async function executeRunInput(input: unknown, ctx: NativeBackendContext) {
  const result = (await executeRegisteredTool(await loadRunAgentExtensionFactory(), input, ctx)) as ToolExecutionResult;
  ctx.ui.invalidate(['runs', 'tasks']);
  const text = Array.isArray(result?.content)
    ? result.content.map((item) => (item.type === 'text' ? (item.text ?? '') : JSON.stringify(item))).join('\n')
    : JSON.stringify(result, null, 2);
  return { text, ...(result?.details ? { details: result.details } : {}) };
}

export async function run(input: unknown, ctx: NativeBackendContext) {
  return executeRunInput(input, ctx);
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
    return executeRunInput(
      {
        action: 'start',
        taskSlug,
        command,
        cwd: readString(params.cwd) ?? ctx.toolContext?.cwd,
        deliverResultToConversation: params.deliverResultToConversation === true,
      },
      ctx,
    );
  }

  const result = await runForegroundBash(command, readString(params.cwd) ?? ctx.toolContext?.cwd, readTimeoutSeconds(params.timeout));
  const text = Array.isArray(result.content) ? result.content.map((item) => item.text ?? '').join('\n') : '';
  return { text, ...(result.details ? { details: result.details } : {}), ...(result.isError ? { isError: true } : {}) };
}

export async function background_command(input: unknown, ctx: NativeBackendContext) {
  return executeRunInput(input, ctx);
}

export async function subagent(input: unknown, ctx: NativeBackendContext) {
  const params = typeof input === 'object' && input !== null && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
  if (params.action === 'start') {
    params.action = 'start_agent';
  }
  return executeRunInput(params, ctx);
}
