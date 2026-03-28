import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  appendConversationAutomationItems,
  loadConversationAutomationState,
  resetConversationAutomationFromItem,
  updateConversationAutomationItemStatus,
  writeConversationAutomationState,
} from './conversationAutomation.js';
import { notifyConversationAutomationChanged } from './conversationAutomationEvents.js';

const TODO_LIST_ACTION_VALUES = ['list', 'add', 'complete', 'block', 'fail', 'reopen'] as const;

type TodoListAction = (typeof TODO_LIST_ACTION_VALUES)[number];

const TodoListToolParams = Type.Object({
  action: Type.Union(TODO_LIST_ACTION_VALUES.map((value) => Type.Literal(value)), {
    description: 'Use "list" to inspect todo items. Use "complete", "block", "fail", or "reopen" only with an exact itemId returned by list.',
  }),
  itemId: Type.Optional(Type.String({ description: 'Exact todo item id from todo_list {"action":"list"}. Required for complete, block, fail, and reopen.' })),
  label: Type.Optional(Type.String({ description: 'Optional short label for add.' })),
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

function buildTodoListPayload(document: ReturnType<typeof loadConversationAutomationState>['document']) {
  return {
    conversationId: document.conversationId,
    activeItemId: document.activeItemId ?? null,
    review: document.review
      ? {
        status: document.review.status,
        round: document.review.round,
      }
      : null,
    waitingForUser: document.waitingForUser
      ? {
        reason: document.waitingForUser.reason ?? null,
      }
      : null,
    items: document.items.map((item) => ({
      id: item.id,
      status: item.status,
      active: document.activeItemId === item.id,
      label: item.label,
      detail: item.kind === 'instruction'
        ? item.text.replace(/\s+/g, ' ').trim()
        : `/skill:${item.skillName}${item.skillArgs ? ` ${item.skillArgs}` : ''}`,
      resultReason: item.resultReason ?? null,
    })),
    usage: {
      inspect: { action: 'list' },
      resolve: 'Use complete, block, fail, or reopen with an exact itemId from items[].id.',
    },
  };
}

function buildItemIdHelp(document: ReturnType<typeof loadConversationAutomationState>['document']): string {
  if (document.items.length === 0) {
    return 'No todo items exist. Use {"action":"add",...} to create one.';
  }

  return `Call todo_list with {"action":"list"} first. Valid itemIds: ${document.items.map((item) => item.id).join(', ')}.`;
}

function readExistingItemId(
  document: ReturnType<typeof loadConversationAutomationState>['document'],
  action: Exclude<TodoListAction, 'list' | 'add'>,
  value: string | undefined,
): string {
  const itemId = readOptionalString(value);
  if (!itemId) {
    throw new Error(`itemId is required for action "${action}". ${buildItemIdHelp(document)}`);
  }

  if (!document.items.some((item) => item.id === itemId)) {
    throw new Error(`Unknown itemId "${itemId}". ${buildItemIdHelp(document)}`);
  }

  return itemId;
}

export function createConversationTodoAgentExtension(options: {
  stateRoot?: string;
  getCurrentProfile: () => string;
}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'todo_list',
      label: 'Todo List',
      description: 'Manage the current conversation automation todo list. Start with action="list". For complete, block, fail, or reopen, always pass the exact itemId returned by list.',
      promptSnippet: 'Use todo_list to manage the current conversation automation todo list. Start with action="list", then use exact itemIds from the returned items[].id values.',
      promptGuidelines: [
        'Start with action="list" when you need to inspect the current todo items.',
        'For complete, block, fail, and reopen, always pass itemId exactly as returned by list.',
        'Use block or fail with a short reason instead of implying completion in plain text.',
      ],
      parameters: TodoListToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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
          case 'list': {
            const payload = buildTodoListPayload(document);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
              details: {
                action: 'list',
                ...payload,
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
            notifyConversationAutomationChanged(conversationId);

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
            const itemId = readExistingItemId(document, 'complete', params.itemId);
            document = updateConversationAutomationItemStatus(document, itemId, 'completed', {
              now: updatedAt,
              resultReason: readOptionalString(params.reason) ?? 'Completed.',
            });
            writeConversationAutomationState({ stateRoot: options.stateRoot, profile, document });
            notifyConversationAutomationChanged(conversationId);

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
            const itemId = readExistingItemId(document, 'block', params.itemId);
            document = updateConversationAutomationItemStatus(document, itemId, 'blocked', {
              now: updatedAt,
              resultReason: readRequiredString(params.reason, 'reason'),
              enabled: false,
            });
            writeConversationAutomationState({ stateRoot: options.stateRoot, profile, document });
            notifyConversationAutomationChanged(conversationId);

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
            const itemId = readExistingItemId(document, 'fail', params.itemId);
            document = updateConversationAutomationItemStatus(document, itemId, 'failed', {
              now: updatedAt,
              resultReason: readRequiredString(params.reason, 'reason'),
              enabled: false,
            });
            writeConversationAutomationState({ stateRoot: options.stateRoot, profile, document });
            notifyConversationAutomationChanged(conversationId);

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
            const itemId = readExistingItemId(document, 'reopen', params.itemId);
            document = resetConversationAutomationFromItem(document, itemId, {
              now: updatedAt,
              enabled: params.resume === true ? true : document.enabled,
            });
            writeConversationAutomationState({ stateRoot: options.stateRoot, profile, document });
            notifyConversationAutomationChanged(conversationId);

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
        }
      },
    });
  };
}
