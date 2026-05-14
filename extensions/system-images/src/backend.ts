import { createImageAgentExtension } from './imageTool.js';
import { createImageProbeAgentExtension } from './probeImageTool.js';

interface ImageBackendContext {
  agentToolContext?: unknown;
  toolContext?: { preferredVisionModel?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveAgentToolContext(agentToolContext: unknown): unknown {
  if (isRecord(agentToolContext) && 'toolContext' in agentToolContext) {
    return agentToolContext.toolContext;
  }
  return agentToolContext;
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

function extractToolText(result: ToolExecutionResult): string {
  if (!Array.isArray(result.content)) {
    return JSON.stringify(result, null, 2);
  }
  return result.content.map((item) => (item.type === 'text' ? (item.text ?? '') : `[${item.type ?? 'content'}]`)).join('\n');
}

async function executeRegisteredTool(factory: (pi: RegisterToolApi) => void, input: unknown, ctx: ImageBackendContext) {
  let registeredTool: RegisteredTool | undefined;
  factory({
    registerTool(tool: RegisteredTool) {
      registeredTool = tool;
    },
  });

  if (!registeredTool?.execute) {
    throw new Error('Image backend did not register an executable tool.');
  }
  if (!ctx.agentToolContext) {
    throw new Error('Image tools require an active agent tool context.');
  }

  return registeredTool.execute('extension-backend-image', input, undefined, undefined, resolveAgentToolContext(ctx.agentToolContext));
}

export async function image(input: unknown, ctx: ImageBackendContext) {
  const result = (await executeRegisteredTool(createImageAgentExtension(), input, ctx)) as ToolExecutionResult;
  return {
    text: extractToolText(result),
    ...(result.content ? { content: result.content } : {}),
    ...(result.details ? { details: result.details } : {}),
    ...(result.isError ? { isError: result.isError } : {}),
  };
}

export async function probeImage(input: unknown, ctx: ImageBackendContext) {
  const preferredVisionModel = ctx.toolContext?.preferredVisionModel?.trim();
  if (!preferredVisionModel) {
    throw new Error('Probe image requires a configured preferred vision model.');
  }
  const result = (await executeRegisteredTool(
    createImageProbeAgentExtension({ getPreferredVisionModel: () => preferredVisionModel }),
    input,
    ctx,
  )) as ToolExecutionResult;
  return {
    text: extractToolText(result),
    ...(result.content ? { content: result.content } : {}),
    ...(result.details ? { details: result.details } : {}),
    ...(result.isError ? { isError: result.isError } : {}),
  };
}
