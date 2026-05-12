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
      promptGuidelines: [
        'Use this tool when the conversation’s concrete task or topic is clear. Pick a short, specific title that helps the user recognize the thread later.',
        'Good titles are 3-7 words, sentence case, and name the actual work. Prefer concrete nouns and verbs. Do not use quotes, emojis, prefixes, dates, or generic labels.',
        'Set the title once early in the conversation, usually after the user’s first real request. Update it only if the conversation clearly pivots to a different task.',
        'Examples: "Fix diff screen layout", "Debug browser screenshot tools", "Design title-setting tool", "Backfill question submit tests", "Investigate GitLab CI failure".',
        'Bad titles: "Conversation about UI", "Help with coding", "Potential feature idea", "Fix issue", "User asks about titles".',
        'Do not mention that you set the title. It is ambient UI state, not conversation content.',
      ],
      parameters: ConversationTitleToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const title = normalizeGeneratedConversationTitle(params.title, 80);
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
