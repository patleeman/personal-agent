import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

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

export function createManifestToolAgentExtensions(options: ManifestToolFactoryOptions): Array<(pi: ExtensionAPI) => void> {
  return listExtensionToolRegistrations().map((tool) => {
    return (pi: ExtensionAPI) => {
      pi.registerTool({
        name: tool.name,
        label: tool.label ?? tool.title ?? tool.id,
        description: tool.description,
        promptSnippet: tool.promptSnippet ?? tool.description,
        promptGuidelines: tool.promptGuidelines ?? [`Use this extension-provided tool when the task needs ${tool.extensionId}/${tool.id}.`],
        parameters: tool.inputSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const result = await invokeExtensionAction(
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
            },
            ctx,
          );
          const extensionResult = result.result as { content?: unknown; text?: unknown; details?: unknown; isError?: unknown } | null;
          const content =
            extensionResult &&
            typeof extensionResult === 'object' &&
            Array.isArray(extensionResult.content) &&
            extensionResult.content.every((item) => item && typeof item === 'object' && 'type' in item)
              ? (extensionResult.content as Array<{ type: string }>)
              : [
                  {
                    type: 'text' as const,
                    text:
                      extensionResult && typeof extensionResult === 'object' && typeof extensionResult.text === 'string'
                        ? extensionResult.text
                        : JSON.stringify(result.result, null, 2),
                  },
                ];
          return {
            content,
            details: {
              extensionId: tool.extensionId,
              toolId: tool.id,
              action: tool.action,
              result: extensionResult?.details ?? result.result,
            },
            ...(extensionResult?.isError === true ? { isError: true } : {}),
          };
        },
      });
    };
  });
}
