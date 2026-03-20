import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  appendConversationAutomationItems,
  loadConversationAutomationState,
  resetConversationAutomationFromItem,
  updateConversationAutomationItemStatus,
  writeConversationAutomationState,
} from './conversationAutomation.js';
import { invalidateAppTopics } from './appEvents.js';

const TODO_LIST_ACTION_VALUES = ['get', 'add', 'complete', 'block', 'fail', 'reopen'] as const;

type TodoListAction = (typeof TODO_LIST_ACTION_VALUES)[number];

const TodoListToolParams = Type.Object({
  action: Type.Union(TODO_LIST_ACTION_VALUES.map((value) => Type.Literal(value))),
  itemId: Type.Optional(Type.String({ description: 'Todo item id. Defaults to the active item for complete/block/fail.' })),
  label: Type.Optional(Type.String({ description: 'Optional todo item label for add.' })),
  kind: Type.Optional(Type.Union([Type.Literal('skill'), Type.Literal('instruction')], { description: 'Todo item kind for add.' })),
  skillName: Type.Optional(Type.String({ description: 'Skill name for add when kind=skill.' })),
  skillArgs: Type.Optional(Type.String({ description: 'Optional skill args for add when kind=skill.' })),
  text: Type.Optional(Type.String({ description: 'Instruction text for add when kind=instruction.' })),
  reason: Type.Optional(Type.String({ description: 'Short reason for block or fail.' })),
  resume: Type.Optional(Type.Boolean({ description: 'When reopening, whether to re-enable automation immediately.' })),
});

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function readOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveTargetItemId(params: { itemId?: string }, activeItemId: string | undefined): string {
  const explicit = readOptionalString(params.itemId);
  if (explicit) {
    return explicit;
  }

  if (activeItemId) {
    return activeItemId;
  }

  throw new Error('itemId is required when there is no active todo item.');
}

function formatTodoList(document: ReturnType<typeof loadConversationAutomationState>['document']): string {
  if (document.items.length === 0) {
    return `Todo list for conversation ${document.conversationId}:\n- (empty)`;
  }

  return [
    `Todo list for conversation ${document.conversationId}:`,
    ...document.items.map((item, index) => {
      const active = document.activeItemId === item.id ? ' [active]' : '';
      const reason = item.resultReason ? ` · ${item.resultReason}` : '';
      const detail = item.kind === 'instruction'
        ? item.text.replace(/\s+/g, ' ').trim()
        : `/skill:${item.skillName}${item.skillArgs ? ` ${item.skillArgs}` : ''}`;
      return `- ${index + 1}. @${item.id} · ${item.status}${active} · ${item.label} · ${detail}${reason}`;
    }),
  ].join('\n');
}

export function createConversationTodoAgentExtension(options: {
  stateRoot?: string;
  getCurrentProfile: () => string;
}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'todo_list',
      label: 'Todo List',
      description: 'Inspect and update the current conversation automation todo list.',
      promptSnippet: 'Use todo_list to inspect or mutate the current conversation automation todo list.',
      promptGuidelines: [
        'Use this tool when conversation automation is active and you need to add follow-up items or explicitly resolve the current item.',
        'Mark the active item completed only when the step actually finished.',
        'If you cannot complete the step, mark it blocked or failed with a short reason instead of implying completion in plain text.',
      ],
      parameters: TodoListToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        try {
          const profile = options.getCurrentProfile();
          const conversationId = ctx.sessionManager.getSessionId();
          const loaded = loadConversationAutomationState({
            stateRoot: options.stateRoot,
            profile,
            conversationId,
          });
          const updatedAt = new Date().toISOString();
          let document = loaded.document;

          switch (params.action as TodoListAction) {
            case 'get': {
              return {
                content: [{ type: 'text' as const, text: formatTodoList(document) }],
                details: {
                  action: 'get',
                  conversationId,
                  itemCount: document.items.length,
                  activeItemId: document.activeItemId ?? null,
                },
              };
            }

            case 'add': {
              const explicitKind = params.kind === 'instruction' || params.kind === 'skill' ? params.kind : undefined;
              const instructionText = readOptionalString(params.text);
              const skillName = readOptionalString(params.skillName);
              const kind = explicitKind ?? (instructionText && !skillName ? 'instruction' : 'skill');

              const nextItem = kind === 'instruction'
                ? {
                  id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  kind: 'instruction' as const,
                  label: readOptionalString(params.label) ?? readRequiredString(params.text, 'text'),
                  text: readRequiredString(params.text, 'text'),
                }
                : {
                  id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  kind: 'skill' as const,
                  label: readOptionalString(params.label) ?? readRequiredString(params.skillName, 'skillName'),
                  skillName: readRequiredString(params.skillName, 'skillName'),
                  ...(readOptionalString(params.skillArgs) ? { skillArgs: readOptionalString(params.skillArgs) } : {}),
                };

              document = appendConversationAutomationItems(document, [nextItem], updatedAt);
              writeConversationAutomationState({ stateRoot: options.stateRoot, profile, document });
              invalidateAppTopics('automation');

              const addedItem = document.items.at(-1);
              const addedDetail = addedItem
                ? addedItem.kind === 'instruction'
                  ? addedItem.text.replace(/\s+/g, ' ').trim()
                  : `/skill:${addedItem.skillName}${addedItem.skillArgs ? ` ${addedItem.skillArgs}` : ''}`
                : '(unknown)';
              return {
                content: [{ type: 'text' as const, text: `Added todo item ${addedItem?.id ?? '(unknown)'}: ${addedDetail}` }],
                details: {
                  action: 'add',
                  conversationId,
                  itemId: addedItem?.id ?? null,
                  activeItemId: document.activeItemId ?? null,
                },
              };
            }

            case 'complete': {
              const itemId = resolveTargetItemId(params, document.activeItemId);
              document = updateConversationAutomationItemStatus(document, itemId, 'completed', {
                now: updatedAt,
                resultReason: readOptionalString(params.reason) ?? 'Completed.',
              });
              writeConversationAutomationState({ stateRoot: options.stateRoot, profile, document });
              invalidateAppTopics('automation');

              return {
                content: [{ type: 'text' as const, text: `Marked todo item ${itemId} completed.` }],
                details: {
                  action: 'complete',
                  conversationId,
                  itemId,
                  activeItemId: document.activeItemId ?? null,
                },
              };
            }

            case 'block': {
              const itemId = resolveTargetItemId(params, document.activeItemId);
              document = updateConversationAutomationItemStatus(document, itemId, 'blocked', {
                now: updatedAt,
                resultReason: readRequiredString(params.reason, 'reason'),
                enabled: false,
              });
              writeConversationAutomationState({ stateRoot: options.stateRoot, profile, document });
              invalidateAppTopics('automation');

              return {
                content: [{ type: 'text' as const, text: `Marked todo item ${itemId} blocked.` }],
                details: {
                  action: 'block',
                  conversationId,
                  itemId,
                  activeItemId: document.activeItemId ?? null,
                },
              };
            }

            case 'fail': {
              const itemId = resolveTargetItemId(params, document.activeItemId);
              document = updateConversationAutomationItemStatus(document, itemId, 'failed', {
                now: updatedAt,
                resultReason: readRequiredString(params.reason, 'reason'),
                enabled: false,
              });
              writeConversationAutomationState({ stateRoot: options.stateRoot, profile, document });
              invalidateAppTopics('automation');

              return {
                content: [{ type: 'text' as const, text: `Marked todo item ${itemId} failed.` }],
                details: {
                  action: 'fail',
                  conversationId,
                  itemId,
                  activeItemId: document.activeItemId ?? null,
                },
              };
            }

            case 'reopen': {
              const itemId = readRequiredString(params.itemId, 'itemId');
              document = resetConversationAutomationFromItem(document, itemId, {
                now: updatedAt,
                enabled: params.resume === true ? true : document.enabled,
              });
              writeConversationAutomationState({ stateRoot: options.stateRoot, profile, document });
              invalidateAppTopics('automation');

              return {
                content: [{ type: 'text' as const, text: `Reopened todo item ${itemId} and later items.` }],
                details: {
                  action: 'reopen',
                  conversationId,
                  itemId,
                  activeItemId: document.activeItemId ?? null,
                  enabled: document.enabled,
                },
              };
            }

            default:
              throw new Error(`Unsupported todo_list action: ${String(params.action)}`);
          }
        } catch (error) {
          throw error;
        }
      },
    });
  };
}
