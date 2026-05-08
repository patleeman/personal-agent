import { createRunAgentExtension } from './runTool.js';

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
}

async function executeRegisteredTool(factory: ReturnType<typeof createRunAgentExtension>, input: unknown, ctx: NativeBackendContext) {
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

export async function run(input: unknown, ctx: NativeBackendContext) {
  const result = (await executeRegisteredTool(
    createRunAgentExtension({
      getCurrentProfile: () => 'shared',
      repoRoot: process.cwd(),
      profilesRoot: process.cwd(),
    }),
    input,
    ctx,
  )) as ToolExecutionResult;
  ctx.ui.invalidate(['runs', 'tasks']);
  const text = Array.isArray(result?.content)
    ? result.content.map((item) => (item.type === 'text' ? (item.text ?? '') : JSON.stringify(item))).join('\n')
    : JSON.stringify(result, null, 2);
  return { text, ...(result?.details ? { details: result.details } : {}) };
}
