import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { normalizeGeneratedConversationTitle } from '@personal-agent/extensions/backend/conversations';
import { Type } from '@sinclair/typebox';

const ConversationTitleToolParams = Type.Object({
  title: Type.String({ description: 'Short, specific conversation title. Aim for 3-7 words and keep it under 80 characters.' }),
});

export function createConversationTitleAgentExtension(_options?: {
  setConversationTitle?: (conversationId: string, title: string) => void;
}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'set_conversation_title',
      label: 'Set conversation title',
      description: 'Set or update the current conversation title shown in the app sidebar and conversation header.',
      promptSnippet: 'Set a short, specific conversation title once the user intent is clear.',
      promptGuidelines: ['Set one short, concrete 3-7 word title early when intent is clear; do not mention the title update in chat.'],
      parameters: ConversationTitleToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const title = await normalizeGeneratedConversationTitle(params.title, 80);
        if (!title) {
          throw new Error('Conversation title must not be empty.');
        }

        const conversationId = ctx.sessionManager.getSessionId();
        pi.setSessionName(title);

        return {
          content: [{ type: 'text' as const, text: `Conversation title set to "${title}".` }],
          details: {
            conversationId,
            title,
          },
        };
      },
    });
  };
}
