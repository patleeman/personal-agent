import { existsSync, statSync } from 'node:fs';
import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { resolveRequestedCwd } from '../conversations/conversationCwd.js';

const ChangeWorkingDirectoryToolParams = Type.Object({
  cwd: Type.String({
    description: 'Target working directory. Relative paths resolve from the current conversation cwd.',
  }),
  continuePrompt: Type.Optional(Type.String({
    description: 'Optional prompt to continue automatically in the new working directory after the switch completes.',
  })),
});

export interface RequestConversationWorkingDirectoryChangeInput {
  conversationId: string;
  cwd: string;
  continuePrompt?: string;
}

export interface RequestConversationWorkingDirectoryChangeResult {
  conversationId: string;
  cwd: string;
  queued: boolean;
  unchanged?: boolean;
}

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

export function createChangeWorkingDirectoryAgentExtension(options: {
  requestConversationWorkingDirectoryChange: (
    input: RequestConversationWorkingDirectoryChangeInput,
  ) => Promise<RequestConversationWorkingDirectoryChangeResult>;
}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'change_working_directory',
      label: 'Change Working Directory',
      description: 'Change the current conversation working directory. The switch happens after the current turn by opening a new live conversation rooted at the requested directory.',
      promptSnippet: 'Switch this conversation into a different working directory when the task clearly needs another repo or folder.',
      promptGuidelines: [
        'Use this tool when the user asks to switch repos/folders, or when the task cannot continue in the current working directory.',
        'The switch happens after the current turn in a new live conversation. Do not claim you already inspected the new directory until that new conversation is active.',
        'If you need to keep working immediately after the switch, provide continuePrompt and then stop so the new conversation can continue there.',
        'If no automatic continuation is needed, call the tool and end the turn after telling the user the conversation moved.',
      ],
      parameters: ChangeWorkingDirectoryToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const conversationId = readRequiredString(ctx.sessionManager.getSessionId?.(), 'conversationId');
        const nextCwd = resolveRequestedCwd(readRequiredString(params.cwd, 'cwd'), ctx.cwd);
        if (!nextCwd) {
          throw new Error('cwd is required.');
        }

        if (!existsSync(nextCwd)) {
          throw new Error(`Directory does not exist: ${nextCwd}`);
        }

        if (!statSync(nextCwd).isDirectory()) {
          throw new Error(`Not a directory: ${nextCwd}`);
        }

        const continuePrompt = typeof params.continuePrompt === 'string' && params.continuePrompt.trim().length > 0
          ? params.continuePrompt.trim()
          : undefined;

        const result = await options.requestConversationWorkingDirectoryChange({
          conversationId,
          cwd: nextCwd,
          ...(continuePrompt ? { continuePrompt } : {}),
        });

        if (result.unchanged) {
          return {
            content: [{
              type: 'text' as const,
              text: `Already using working directory ${result.cwd}.`,
            }],
            details: {
              action: 'noop',
              conversationId,
              cwd: result.cwd,
              queued: false,
              unchanged: true,
            },
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: continuePrompt
              ? `Queued working directory change to ${result.cwd}. A new conversation will open there after this turn and continue automatically.`
              : `Queued working directory change to ${result.cwd}. A new conversation will open there after this turn.`,
          }],
          details: {
            action: 'queue',
            conversationId,
            cwd: result.cwd,
            queued: result.queued,
            continuePrompt: Boolean(continuePrompt),
          },
        };
      },
    });
  };
}
