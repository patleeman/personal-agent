import { existsSync, statSync } from 'node:fs';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { resolveRequestedCwd } from '@personal-agent/extensions/backend/conversations';
import { Type } from '@sinclair/typebox';

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
        'Switch to a target repo root before modifying it so its AGENTS.md loads; the change applies after this turn, so stop or use continuePrompt to resume there.',
      ],
      parameters: ChangeWorkingDirectoryToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const conversationId = readRequiredString(ctx.sessionManager.getSessionId?.(), 'conversationId');
        const nextCwd = await resolveRequestedCwd(readRequiredString(params.cwd, 'cwd'), ctx.cwd);
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
