import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent';

import type { ServerRouteContext } from '../routes/context.js';
import { invokeExtensionAction } from './extensionBackend.js';
import { type ExtensionToolRegistration, listExtensionToolRegistrations } from './extensionRegistry.js';
import { createImageAgentExtension } from './imageAgentExtension.js';
import { createImageProbeAgentExtension } from './imageProbeAgentExtension.js';

export interface ManifestToolFactoryOptions {
  getCurrentProfile: () => string;
  getPreferredVisionModel?: () => string;
  hasOpenAiImageProvider?: () => boolean;
  repoRoot: string;
  profilesRoot: string;
  stateRoot: string;
  serverContext?: Pick<ServerRouteContext, 'getCurrentProfile'>;
}

function createSystemFactory(factoryId: string, options: ManifestToolFactoryOptions): ExtensionFactory | null {
  switch (factoryId) {
    case 'image':
      return options.hasOpenAiImageProvider?.() ? createImageAgentExtension() : null;
    case 'image-probe': {
      const preferredVisionModel = options.getPreferredVisionModel?.();
      return preferredVisionModel ? createImageProbeAgentExtension({ getPreferredVisionModel: () => preferredVisionModel }) : null;
    }
    default:
      return null;
  }
}

function registerSingleToolFromSystemFactory(pi: ExtensionAPI, tool: ExtensionToolRegistration, factory: ExtensionFactory): void {
  const filteredApi = new Proxy(pi, {
    get(target, prop, receiver) {
      if (prop !== 'registerTool') {
        return Reflect.get(target, prop, receiver);
      }
      return (registeredTool: Parameters<ExtensionAPI['registerTool']>[0]) => {
        if (registeredTool.name !== tool.name) {
          return;
        }
        return target.registerTool({
          ...registeredTool,
          label: tool.label ?? tool.title ?? registeredTool.label,
          description: tool.description || registeredTool.description,
          promptSnippet: tool.promptSnippet ?? registeredTool.promptSnippet,
          promptGuidelines: tool.promptGuidelines ?? registeredTool.promptGuidelines,
        });
      };
    },
  }) as ExtensionAPI;

  factory(filteredApi);
}

export function createManifestToolAgentExtensions(options: ManifestToolFactoryOptions): Array<(pi: ExtensionAPI) => void> {
  return listExtensionToolRegistrations().map((tool) => {
    return (pi: ExtensionAPI) => {
      if (tool.systemFactory) {
        const factory = createSystemFactory(tool.systemFactory, options);
        if (factory) {
          registerSingleToolFromSystemFactory(pi, tool, factory);
        }
        return;
      }

      pi.registerTool({
        name: tool.name,
        label: tool.label ?? tool.title ?? tool.id,
        description: tool.description,
        promptSnippet: tool.promptSnippet ?? tool.description,
        promptGuidelines: tool.promptGuidelines ?? [`Use this extension-provided tool when the task needs ${tool.extensionId}/${tool.id}.`],
        parameters: tool.inputSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const result = await invokeExtensionAction(tool.extensionId, tool.action, params, options.serverContext, {
            conversationId: ctx.sessionManager.getSessionId(),
            sessionId: ctx.sessionManager.getSessionId(),
            cwd: ctx.sessionManager.getCwd?.(),
            sessionFile: ctx.sessionManager.getSessionFile?.(),
          });
          const text =
            result.result && typeof result.result === 'object' && 'text' in result.result && typeof result.result.text === 'string'
              ? result.result.text
              : JSON.stringify(result.result, null, 2);
          return {
            content: [{ type: 'text' as const, text }],
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
