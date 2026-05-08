import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import {
  buildLiveSessionExtensionFactoriesForRuntime,
  buildLiveSessionResourceOptionsForRuntime,
  renameSession,
  requestConversationWorkingDirectoryChange,
} from '../../../packages/desktop/server/extensions/backendApi.js';
import { createAskUserQuestionAgentExtension } from './askUserQuestionAgentExtension.js';
import { createChangeWorkingDirectoryAgentExtension } from './changeWorkingDirectoryAgentExtension.js';
import { createConversationInspectAgentExtension } from './conversationInspectAgentExtension.js';
import { createConversationTitleAgentExtension } from './conversationTitleAgentExtension.js';

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
