import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { buildConversationAutomationPromptContext, loadConversationAutomationState } from './conversationAutomation.js';

interface SessionEntryLike {
  type?: string;
  message?: {
    role?: string;
  };
}

interface SessionManagerLike {
  getSessionId: () => string;
  getEntries?: () => SessionEntryLike[];
}

function isFirstUserTurn(sessionManager: SessionManagerLike): boolean {
  const entries = typeof sessionManager.getEntries === 'function'
    ? sessionManager.getEntries()
    : [];

  return !entries.some((entry) => entry.type === 'message' && entry.message?.role === 'user');
}

export function createConversationAutomationPromptExtension(options: {
  stateRoot?: string;
  getCurrentProfile: () => string;
}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.on('before_agent_start', (event, ctx) => {
      const profile = options.getCurrentProfile();
      const sessionManager = ctx.sessionManager as SessionManagerLike;
      const conversationId = sessionManager.getSessionId();
      const document = loadConversationAutomationState({
        stateRoot: options.stateRoot,
        profile,
        conversationId,
      }).document;

      if (document.waitingForUser) {
        return undefined;
      }

      const promptContext = buildConversationAutomationPromptContext(document);
      if (!promptContext) {
        return undefined;
      }

      if (isFirstUserTurn(sessionManager)) {
        const systemPrompt = event.systemPrompt?.trim();
        if (!systemPrompt) {
          return undefined;
        }

        return {
          systemPrompt: `${event.systemPrompt}\n\n${promptContext}`,
        };
      }

      return {
        message: {
          customType: 'conversation_automation_reminder',
          content: promptContext,
          display: false,
        },
      };
    });
  };
}
