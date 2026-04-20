import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  CONVERSATION_INSPECT_ACTION_VALUES,
  CONVERSATION_INSPECT_BLOCK_TYPE_VALUES,
  CONVERSATION_INSPECT_ORDER_VALUES,
  CONVERSATION_INSPECT_SCOPE_VALUES,
  diffConversationInspectBlocks,
  formatConversationInspectDiffResult,
  formatConversationInspectQueryResult,
  formatConversationInspectSessionList,
  listConversationInspectSessions,
  queryConversationInspectBlocks,
} from '../conversations/conversationInspectCapability.js';

const ConversationInspectToolParams = Type.Object({
  action: Type.Union(CONVERSATION_INSPECT_ACTION_VALUES.map((value) => Type.Literal(value))),
  conversationId: Type.Optional(Type.String({ description: 'Conversation id for query/diff actions.' })),
  scope: Type.Optional(Type.Union(CONVERSATION_INSPECT_SCOPE_VALUES.map((value) => Type.Literal(value)), {
    description: 'List scope: all, live, running, or archived conversations.',
  })),
  cwd: Type.Optional(Type.String({ description: 'Optional cwd filter for list actions.' })),
  query: Type.Optional(Type.String({ description: 'Optional metadata query for list actions. Matches conversation id, title, or cwd.' })),
  includeCurrent: Type.Optional(Type.Boolean({ description: 'Whether list should include the current conversation. Defaults to false.' })),
  types: Type.Optional(Type.Array(
    Type.Union(CONVERSATION_INSPECT_BLOCK_TYPE_VALUES.map((value) => Type.Literal(value))),
    { description: 'Optional transcript block types to include.', minItems: 1 },
  )),
  tools: Type.Optional(Type.Array(
    Type.String({ minLength: 1 }),
    { description: 'Optional tool names to match for tool_use/error blocks.', minItems: 1 },
  )),
  text: Type.Optional(Type.String({ description: 'Case-insensitive substring filter over transcript block text.' })),
  afterBlockId: Type.Optional(Type.String({ description: 'Only include transcript blocks after this block id.' })),
  beforeBlockId: Type.Optional(Type.String({ description: 'Only include transcript blocks before this block id.' })),
  aroundBlockId: Type.Optional(Type.String({ description: 'Restrict query results to a context window around this block id.' })),
  knownSignature: Type.Optional(Type.String({ description: 'Last seen conversation signature for diff checks.' })),
  order: Type.Optional(Type.Union(CONVERSATION_INSPECT_ORDER_VALUES.map((value) => Type.Literal(value)), {
    description: 'Block order for query results: asc or desc.',
  })),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 200, description: 'Maximum items to return.' })),
  window: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: 'Context window size for aroundBlockId queries.' })),
  maxCharactersPerBlock: Type.Optional(Type.Number({ minimum: 1, maximum: 20000, description: 'Character cap per returned block.' })),
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
        'Prefer list first to find the target conversation, then query or diff to inspect the transcript.',
        'This tool is read-only. It does not message, steer, or modify other conversations.',
        'Cross-thread hidden reasoning is intentionally unavailable; query visible transcript blocks instead.',
        'Use diff with afterBlockId or knownSignature when you need a cheap follow-up read on a live thread.',
      ],
      parameters: ConversationInspectToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        switch (params.action) {
          case 'list': {
            const result = listConversationInspectSessions({
              scope: params.scope,
              cwd: params.cwd,
              query: params.query,
              limit: params.limit,
              includeCurrent: params.includeCurrent,
              currentConversationId: ctx.sessionManager.getSessionId(),
            });

            return {
              content: [{ type: 'text' as const, text: formatConversationInspectSessionList(result) }],
              details: {
                action: 'list',
                ...result,
              },
            };
          }

          case 'query': {
            const result = queryConversationInspectBlocks({
              conversationId: params.conversationId,
              types: params.types,
              tools: params.tools,
              text: params.text,
              afterBlockId: params.afterBlockId,
              beforeBlockId: params.beforeBlockId,
              aroundBlockId: params.aroundBlockId,
              window: params.window,
              order: params.order,
              limit: params.limit,
              maxCharactersPerBlock: params.maxCharactersPerBlock,
            });

            return {
              content: [{ type: 'text' as const, text: formatConversationInspectQueryResult(result) }],
              details: {
                action: 'query',
                ...result,
              },
            };
          }

          case 'diff': {
            const result = diffConversationInspectBlocks({
              conversationId: params.conversationId,
              knownSignature: params.knownSignature,
              afterBlockId: params.afterBlockId,
              types: params.types,
              tools: params.tools,
              text: params.text,
              limit: params.limit,
              maxCharactersPerBlock: params.maxCharactersPerBlock,
            });

            return {
              content: [{ type: 'text' as const, text: formatConversationInspectDiffResult(result) }],
              details: {
                action: 'diff',
                ...result,
              },
            };
          }

          default:
            throw new Error(`Unsupported conversation_inspect action: ${String(params.action)}`);
        }
      },
    });
  };
}
