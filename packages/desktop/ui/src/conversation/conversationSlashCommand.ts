import { parseSlashInput } from '../commands/slashMenu';

export type ConversationSlashCommand = { action: 'compact'; customInstructions?: string };

type ConversationSlashParseResult = { kind: 'command'; command: ConversationSlashCommand } | { kind: 'invalid'; message: string };

export function parseConversationSlashCommand(input: string): ConversationSlashParseResult | null {
  const parsed = parseSlashInput(input.trim());
  if (!parsed) {
    return null;
  }

  const argument = parsed.argument.trim();

  switch (parsed.command) {
    case '/compact':
      return {
        kind: 'command',
        command: {
          action: 'compact',
          ...(argument ? { customInstructions: argument } : {}),
        },
      };
    default:
      return null;
  }
}
