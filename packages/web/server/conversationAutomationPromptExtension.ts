import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { buildConversationAutomationSystemPromptPolicy, loadConversationAutomationState } from './conversationAutomation.js';

interface SessionManagerLike {
  getSessionId: () => string;
}

function hasRelevantAutomationState(document: ReturnType<typeof loadConversationAutomationState>['document']): boolean {
  const hasOpenItems = document.items.some((item) => item.status === 'pending' || item.status === 'running' || item.status === 'waiting');
  const reviewActive = document.review?.status === 'pending' || document.review?.status === 'running';
  return hasOpenItems || reviewActive || Boolean(document.waitingForUser);
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

      if (!hasRelevantAutomationState(document)) {
        return undefined;
      }

      const systemPrompt = event.systemPrompt?.trim();
      if (!systemPrompt) {
        return undefined;
      }

      return {
        systemPrompt: `${event.systemPrompt}\n\n${buildConversationAutomationSystemPromptPolicy()}`,
      };
    });
  };
}
