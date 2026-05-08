import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { querySessionSuggestedPointerIds } from '@personal-agent/core';
import {
  CONVERSATION_INSPECT_ACTION_VALUES,
  CONVERSATION_INSPECT_BLOCK_TYPE_VALUES,
  CONVERSATION_INSPECT_ORDER_VALUES,
  CONVERSATION_INSPECT_ROLE_VALUES,
  CONVERSATION_INSPECT_SCOPE_VALUES,
  CONVERSATION_INSPECT_SEARCH_MODE_VALUES,
} from '@personal-agent/extensions/backend';
import { executeConversationInspect } from '@personal-agent/extensions/backend';
import { persistTraceContextPointerInspect } from '@personal-agent/extensions/backend';
import { Type } from '@sinclair/typebox';

const ConversationInspectToolParams = Type.Object({
  action: Type.String({ description: `Action to perform. Valid values: ${CONVERSATION_INSPECT_ACTION_VALUES.join(', ')}.` }),
  conversationId: Type.Optional(Type.String({ description: 'Conversation id for query/diff actions.' })),
  scope: Type.Optional(Type.String({ description: `List scope. Valid values: ${CONVERSATION_INSPECT_SCOPE_VALUES.join(', ')}.` })),
  cwd: Type.Optional(Type.String({ description: 'Optional cwd filter for list actions.' })),
  query: Type.Optional(
    Type.String({ description: 'Query string for list/search actions. List matches metadata; search matches visible transcript text.' }),
  ),
  includeCurrent: Type.Optional(Type.Boolean({ description: 'Whether list should include the current conversation. Defaults to false.' })),
  types: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      description: `Optional structural transcript block types to include. Valid values: ${CONVERSATION_INSPECT_BLOCK_TYPE_VALUES.join(
        ', ',
      )}. Use roles for user/assistant filtering.`,
      minItems: 1,
    }),
  ),
  roles: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      description: `Optional conversational roles to include. Valid values: ${CONVERSATION_INSPECT_ROLE_VALUES.join(
        ', ',
      )}. assistant maps to text blocks; tool maps to tool_use blocks.`,
      minItems: 1,
    }),
  ),
  tools: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), { description: 'Optional tool names to match for tool_use/error blocks.', minItems: 1 }),
  ),
  text: Type.Optional(Type.String({ description: 'Case-insensitive transcript text filter.' })),
  searchMode: Type.Optional(
    Type.String({
      description: `How query/text matching works. Valid values: ${CONVERSATION_INSPECT_SEARCH_MODE_VALUES.join(
        ', ',
      )}. Default phrase; allTerms/anyTerm split on whitespace.`,
    }),
  ),
  afterBlockId: Type.Optional(Type.String({ description: 'Only include transcript blocks after this block id.' })),
  beforeBlockId: Type.Optional(Type.String({ description: 'Only include transcript blocks before this block id.' })),
  aroundBlockId: Type.Optional(Type.String({ description: 'Restrict query results to a context window around this block id.' })),
  knownSignature: Type.Optional(Type.String({ description: 'Last seen conversation signature for diff checks.' })),
  order: Type.Optional(
    Type.String({ description: `Block order for query results. Valid values: ${CONVERSATION_INSPECT_ORDER_VALUES.join(', ')}.` }),
  ),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200, description: 'Maximum items to return.' })),
  window: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: 'Context window size for aroundBlockId queries.' })),
  includeAroundMatches: Type.Optional(
    Type.Boolean({
      description: 'When searching or querying with filters, include surrounding context blocks around each match using window.',
    }),
  ),
  maxCharactersPerBlock: Type.Optional(Type.Number({ minimum: 1, maximum: 20000, description: 'Character cap per returned block.' })),
  maxSnippetCharacters: Type.Optional(
    Type.Number({ minimum: 1, maximum: 2000, description: 'Character cap per returned search snippet.' }),
  ),
});

export function createConversationInspectAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'conversation_inspect',
      label: 'Conversation Inspect',
      description: 'List other conversations and query their visible transcript blocks.',
      promptSnippet: 'Inspect other conversations through read-only transcript queries.',
      promptGuidelines: [
        'Use this tool when you need visibility into other active conversations or saved threads.',
        'Prefer list first to find the target conversation, then use search, query, or diff to inspect the transcript.',
        'Use outline for a compact map of a pointed conversation, then read_window around relevant block ids.',
        'This tool is read-only. It does not message, steer, or modify other conversations.',
        'Cross-thread hidden reasoning is intentionally unavailable; query visible transcript blocks instead.',
        'Use diff with afterBlockId or knownSignature when you need a cheap follow-up read on a live thread.',
      ],
      parameters: ConversationInspectToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        // Build params that the worker will pass through to the capability functions.
        // The worker runs in a dedicated thread so synchronous file I/O doesn't
        // block the Electron main thread.
        const workerParams: Record<string, unknown> = { ...params };
        const currentSessionId = ctx.sessionManager.getSessionId();
        if (params.action === 'list' || params.action === 'search') {
          workerParams.currentConversationId = currentSessionId;
        }

        const { action, result, text } = await executeConversationInspect(params.action as string, workerParams);

        // Track whether this inspect targets a suggested pointer.
        // Looks up the DB instead of an in-memory registry so it survives server restarts.
        const targetConversationId = typeof params.conversationId === 'string' ? params.conversationId : null;
        if (targetConversationId && currentSessionId) {
          const suggestedIds = querySessionSuggestedPointerIds(currentSessionId);
          persistTraceContextPointerInspect({
            sessionId: currentSessionId,
            inspectedConversationId: targetConversationId,
            wasSuggested: suggestedIds.has(targetConversationId),
          });
        }

        return {
          content: [{ type: 'text' as const, text }],
          details: {
            action,
            ...(result as Record<string, unknown>),
          },
        };
      },
    });
  };
}
