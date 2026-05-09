import { parseSlashInput } from '../commands/slashMenu';

export type ConversationSlashCommand =
  | { action: 'compact'; customInstructions?: string }
  | { action: 'run'; command: string }
  | { action: 'search'; query: string }
  | { action: 'think'; topic?: string };

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
    case '/run':
      if (!argument) {
        return { kind: 'invalid', message: 'Usage: /run <command>' };
      }

      return {
        kind: 'command',
        command: {
          action: 'run',
          command: argument,
        },
      };
    case '/search':
      if (!argument) {
        return { kind: 'invalid', message: 'Usage: /search <query>' };
      }

      return {
        kind: 'command',
        command: {
          action: 'search',
          query: argument,
        },
      };
    case '/think':
      return {
        kind: 'command',
        command: {
          action: 'think',
          ...(argument ? { topic: argument } : {}),
        },
      };
    default:
      return null;
  }
}
