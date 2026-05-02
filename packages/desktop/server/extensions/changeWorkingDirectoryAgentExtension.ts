import { existsSync, statSync } from 'node:fs';

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

import { resolveRequestedCwd } from '../conversations/conversationCwd.js';

const ChangeWorkingDirectoryToolParams = Type.Object({
  cwd: Type.String({
    description: 'Target working directory. Relative paths resolve from the current conversation cwd.',
  }),
  continuePrompt: Type.Optional(
    Type.String({
      description: 'Optional prompt to continue automatically in the new working directory after the switch completes.',
    }),
  ),
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
      description:
        'Change the current conversation working directory. The switch happens after the current turn and keeps the same conversation attached to the requested directory.',
      promptSnippet: 'Change the current conversation working directory to target a different repo or folder.',
      promptGuidelines: [
        "change_working_directory: Before modifying code in a repo, switch CWD to that repo's root so its AGENTS.md rules are loaded.",
        'change_working_directory: When a task targets a specific project or repo, switch CWD to it before starting work.',
        "change_working_directory: If the task spans multiple repos or you're uncertain, stay in the current directory.",
        'change_working_directory: The switch happens after the current turn. Do not claim you already inspected the new directory until the switch is active.',
        'change_working_directory: To continue working automatically after the switch, provide continuePrompt and then stop so the conversation can continue there.',
        'change_working_directory: If no automatic continuation is needed, end the turn after telling the user the conversation moved.',
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

        const continuePrompt =
          typeof params.continuePrompt === 'string' && params.continuePrompt.trim().length > 0 ? params.continuePrompt.trim() : undefined;

        const result = await options.requestConversationWorkingDirectoryChange({
          conversationId,
          cwd: nextCwd,
          ...(continuePrompt ? { continuePrompt } : {}),
        });

        if (result.unchanged) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Already using working directory ${result.cwd}.`,
              },
            ],
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
          content: [
            {
              type: 'text' as const,
              text: continuePrompt
                ? `Queued working directory change to ${result.cwd}. This conversation will move there after this turn and continue automatically.`
                : `Queued working directory change to ${result.cwd}. This conversation will move there after this turn.`,
            },
          ],
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
