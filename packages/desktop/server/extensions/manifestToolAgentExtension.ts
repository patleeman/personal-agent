import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import type { ServerRouteContext } from '../routes/context.js';
import { invokeExtensionAction } from './extensionBackend.js';
import { listExtensionToolRegistrations } from './extensionRegistry.js';

export function createManifestToolAgentExtensions(
  serverContext?: Pick<ServerRouteContext, 'getCurrentProfile'>,
): Array<(pi: ExtensionAPI) => void> {
  return listExtensionToolRegistrations().map((tool) => {
    return (pi: ExtensionAPI) => {
      pi.registerTool({
        name: tool.name,
        label: tool.label ?? tool.title ?? tool.id,
        description: tool.description,
        promptSnippet: tool.promptSnippet ?? tool.description,
        promptGuidelines: tool.promptGuidelines ?? [`Use this extension-provided tool when the task needs ${tool.extensionId}/${tool.id}.`],
        parameters: tool.inputSchema,
        async execute(_toolCallId, params) {
          const result = await invokeExtensionAction(tool.extensionId, tool.action, params, serverContext);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result.result, null, 2) }],
            details: {
              extensionId: tool.extensionId,
              toolId: tool.id,
              action: tool.action,
              result: result.result,
            },
          };
        },
      });
    };
  });
}
