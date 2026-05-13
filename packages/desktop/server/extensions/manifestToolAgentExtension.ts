import type { AgentToolUpdateCallback, ExtensionAPI } from '@earendil-works/pi-coding-agent';

import type { ServerRouteContext } from '../routes/context.js';
import { invokeExtensionAction } from './extensionBackend.js';
import { listExtensionToolRegistrations } from './extensionRegistry.js';

export interface ManifestToolFactoryOptions {
  getCurrentProfile: () => string;
  getPreferredVisionModel?: () => string;
  hasOpenAiImageProvider?: () => boolean;
  repoRoot: string;
  profilesRoot: string;
  stateRoot: string;
  serverContext?: Pick<ServerRouteContext, 'getCurrentProfile'>;
}

/**
 * Built-in tool names that user extensions are allowed to override via `replaces`.
 * This list prevents accidental or malicious replacement of critical infrastructure
 * while still allowing well-intentioned overrides of the primary coding tools.
 */
const OVERRIDABLE_TOOLS = new Set(['bash', 'read', 'write', 'edit', 'grep', 'find', 'ls', 'notify', 'web_fetch', 'web_search']);

function isOverridableTool(toolName: string): boolean {
  return OVERRIDABLE_TOOLS.has(toolName);
}

export function createManifestToolAgentExtensions(options: ManifestToolFactoryOptions): Array<(pi: ExtensionAPI) => void> {
  return listExtensionToolRegistrations().map((tool) => {
    // When `replaces` is set and the target tool is overridable, use that name
    // so pi.registerTool() replaces the built-in tool.
    const registerName = tool.replaces && isOverridableTool(tool.replaces) ? tool.replaces : tool.name;
    const isOverride = registerName !== tool.name;

    return (pi: ExtensionAPI) => {
      pi.registerTool({
        name: registerName,
        label: tool.label ?? tool.title ?? tool.id,
        description: tool.description,
        promptSnippet: tool.promptSnippet ?? tool.description,
        promptGuidelines: tool.promptGuidelines ?? [
          isOverride
            ? `This tool replaces the built-in "${registerName}" tool.`
            : `Use this extension-provided tool when the task needs ${tool.extensionId}/${tool.id}.`,
        ],
        parameters: tool.inputSchema,
        async execute(_toolCallId, params, _signal, onUpdate: any, ctx: any) {
          const invokeResult = await invokeExtensionAction(
            tool.extensionId,
            tool.action,
            params,
            options.serverContext,
            {
              conversationId: ctx.sessionManager.getSessionId(),
              sessionId: ctx.sessionManager.getSessionId(),
              cwd: ctx.sessionManager.getCwd?.(),
              sessionFile: ctx.sessionManager.getSessionFile?.(),
              preferredVisionModel: options.getPreferredVisionModel?.(),
              // Forward the streaming update callback so backend handlers can
              // send progress updates during long-running tool execution.
              onUpdate: (update) => {
                onUpdate?.({
                  content: update.content ?? [],
                });
              },
            },
            // Forward the streaming callback so backend handlers can
            // send progress updates during tool execution.
            { onUpdate } satisfies { onUpdate?: AgentToolUpdateCallback },
            ctx,
          );

          // Handle backend invocation error (build failure, not found, etc.)
          if (!invokeResult.ok) {
            return {
              content: [{ type: 'text' as const, text: invokeResult.error }],
              details: {
                extensionId: tool.extensionId,
                toolId: tool.id,
                action: tool.action,
                error: invokeResult.error,
              },
              isError: true,
            } as any;
          }

          const extensionResult = invokeResult.result as
            | { content?: unknown; text?: unknown; details?: unknown; isError?: unknown }
            | null
            | undefined;
          const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> =
            extensionResult &&
            typeof extensionResult === 'object' &&
            Array.isArray(extensionResult.content) &&
            extensionResult.content.every((item) => item && typeof item === 'object' && 'type' in item)
              ? (extensionResult.content as Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>)
              : [
                  {
                    type: 'text' as const,
                    text:
                      extensionResult && typeof extensionResult === 'object' && typeof extensionResult.text === 'string'
                        ? extensionResult.text
                        : JSON.stringify(invokeResult.result, null, 2),
                  },
                ];
          return {
            content,
            details: {
              extensionId: tool.extensionId,
              toolId: tool.id,
              action: tool.action,
              result: extensionResult?.details ?? invokeResult.result,
            },
            ...(extensionResult?.isError === true ? ({ isError: true } as const) : {}),
          } as any;
        },
      });
    };
  });
}
