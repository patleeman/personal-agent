import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  loadConversationAutomationState,
  setConversationAutomationWaitingForUser,
  writeConversationAutomationState,
} from './conversationAutomation.js';
import { notifyConversationAutomationChanged } from './conversationAutomationEvents.js';

const WaitForUserToolParams = Type.Object({
  reason: Type.String({
    description: 'Short reason describing what input, approval, or clarification is needed from the user.',
  }),
});

export function createWaitForUserAgentExtension(options: {
  stateRoot?: string;
  getCurrentProfile: () => string;
}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'wait_for_user',
      label: 'Wait for User',
      description: 'Pause checklist automation until the user replies. Use this instead of guessing, keyword heuristics, or forcing more work when you need user input, approval, or clarification.',
      promptSnippet: 'Pause checklist automation until the user replies.',
      promptGuidelines: [
        'Use this tool when you need input, approval, or clarification from the user before you can continue checklist work.',
        'Provide a short reason describing exactly what you are waiting on.',
        'Do not use this tool for background waiting; use deferred_resume for time-based retries.',
      ],
      parameters: WaitForUserToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const profile = options.getCurrentProfile();
        const conversationId = ctx.sessionManager.getSessionId();
        const updatedAt = new Date().toISOString();
        const loaded = loadConversationAutomationState({
          stateRoot: options.stateRoot,
          profile,
          conversationId,
        });

        const document = setConversationAutomationWaitingForUser(loaded.document, {
          now: updatedAt,
          reason: params.reason,
        });
        writeConversationAutomationState({ stateRoot: options.stateRoot, profile, document });
        notifyConversationAutomationChanged(conversationId);

        return {
          content: [{
            type: 'text' as const,
            text: `Marked the conversation as waiting for user input: ${params.reason.trim()}`,
          }],
          details: {
            action: 'wait_for_user',
            conversationId,
            reason: params.reason.trim(),
            activeItemId: document.activeItemId ?? null,
            waitingForUser: true,
          },
        };
      },
    });
  };
}
