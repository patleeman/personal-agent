import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { ExtensionBackendContext } from '@personal-agent/extensions/backend';
import {
  buildLiveSessionExtensionFactoriesForRuntime,
  buildLiveSessionResourceOptionsForRuntime,
  renameSession,
  requestConversationWorkingDirectoryChange,
} from '@personal-agent/extensions/backend';

import { createAskUserQuestionAgentExtension } from './askUserQuestionAgentExtension.js';
import { createChangeWorkingDirectoryAgentExtension } from './changeWorkingDirectoryAgentExtension.js';
import { createConversationInspectAgentExtension } from './conversationInspectAgentExtension.js';
import { createConversationTitleAgentExtension } from './conversationTitleAgentExtension.js';

export async function logMessageAction(
  input: { messageText?: string; messageRole?: string; blockId?: string; conversationId?: string },
  ctx: ExtensionBackendContext,
) {
  ctx.log.info('message action invoked', {
    role: input.messageRole,
    blockId: input.blockId,
    conversationId: input.conversationId,
    textLength: input.messageText?.length,
  });
  return { ok: true };
}

export async function copyConversationId(
  input: { conversationId?: string; sessionTitle?: string; cwd?: string },
  ctx: ExtensionBackendContext,
) {
  ctx.log.info('context menu: copy conversation id', {
    conversationId: input.conversationId,
    title: input.sessionTitle,
  });
  return { ok: true, conversationId: input.conversationId };
}

export function createConversationToolsAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi) => {
    createAskUserQuestionAgentExtension()(pi);
    createConversationInspectAgentExtension()(pi);
    createConversationTitleAgentExtension({ setConversationTitle: renameSession })(pi);
    createChangeWorkingDirectoryAgentExtension({
      requestConversationWorkingDirectoryChange: (input) =>
        requestConversationWorkingDirectoryChange(input, {
          ...buildLiveSessionResourceOptionsForRuntime(),
          extensionFactories: buildLiveSessionExtensionFactoriesForRuntime(),
        }),
    })(pi);
  };
}
