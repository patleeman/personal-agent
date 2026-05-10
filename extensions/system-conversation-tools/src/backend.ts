import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { ExtensionBackendContext } from '@personal-agent/extensions/backend';
import {
  buildLiveSessionExtensionFactoriesForRuntime,
  buildLiveSessionResourceOptionsForRuntime,
  requestConversationWorkingDirectoryChange,
} from '@personal-agent/extensions/backend';

import { createAskUserQuestionAgentExtension } from './askUserQuestionAgentExtension.js';
import { createChangeWorkingDirectoryAgentExtension } from './changeWorkingDirectoryAgentExtension.js';
import { createConversationInspectAgentExtension } from './conversationInspectAgentExtension.js';
import { createConversationTitleAgentExtension } from './conversationTitleAgentExtension.js';

type ConversationContextMenuInput = { conversationId?: string; sessionTitle?: string; cwd?: string };

export async function duplicateConversation(input: ConversationContextMenuInput, ctx: ExtensionBackendContext) {
  ctx.log.info('context menu: duplicate conversation', {
    conversationId: input.conversationId,
    title: input.sessionTitle,
  });
  return { ok: true, conversationId: input.conversationId };
}

export async function copyWorkingDirectory(input: ConversationContextMenuInput, ctx: ExtensionBackendContext) {
  ctx.log.info('context menu: copy working directory', {
    conversationId: input.conversationId,
    title: input.sessionTitle,
  });
  return { ok: true, cwd: input.cwd };
}

export async function copyConversationId(input: ConversationContextMenuInput, ctx: ExtensionBackendContext) {
  ctx.log.info('context menu: copy conversation id', {
    conversationId: input.conversationId,
    title: input.sessionTitle,
  });
  return { ok: true, conversationId: input.conversationId };
}

export async function copyDeeplink(input: ConversationContextMenuInput, ctx: ExtensionBackendContext) {
  ctx.log.info('context menu: copy deeplink', {
    conversationId: input.conversationId,
    title: input.sessionTitle,
  });
  return { ok: true, conversationId: input.conversationId };
}

export function createConversationToolsAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi) => {
    createAskUserQuestionAgentExtension()(pi);
    createConversationInspectAgentExtension()(pi);
    createConversationTitleAgentExtension()(pi);
    createChangeWorkingDirectoryAgentExtension({
      requestConversationWorkingDirectoryChange: (input) =>
        requestConversationWorkingDirectoryChange(input, {
          ...buildLiveSessionResourceOptionsForRuntime(),
          extensionFactories: buildLiveSessionExtensionFactoriesForRuntime(),
        }),
    })(pi);
  };
}
