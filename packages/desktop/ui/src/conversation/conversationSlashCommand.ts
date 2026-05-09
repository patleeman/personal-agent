import { parseSlashInput } from '../commands/slashMenu';

export type ConversationSlashCommand =
  | { action: 'clear' }
  | { action: 'compact'; customInstructions?: string }
  | { action: 'copy' }
  | { action: 'export'; outputPath?: string }
  | { action: 'fork' }
  | { action: 'image' }
  | { action: 'name'; name?: string }
  | { action: 'new' }
  | { action: 'reload' }
  | { action: 'run'; command: string }
  | { action: 'search'; query: string }
  | { action: 'session' }
  | { action: 'summarize' }
  | { action: 'think'; topic?: string };

type ConversationSlashParseResult = { kind: 'command'; command: ConversationSlashCommand } | { kind: 'invalid'; message: string };

function parseNoArgCommand(command: ConversationSlashCommand['action'], argument: string, usage: string): ConversationSlashParseResult {
  if (argument.length > 0) {
    return { kind: 'invalid', message: usage };
  }

  return { kind: 'command', command: { action: command } };
}

export function parseConversationSlashCommand(input: string): ConversationSlashParseResult | null {
  const parsed = parseSlashInput(input.trim());
  if (!parsed) {
    return null;
  }

  const argument = parsed.argument.trim();

  switch (parsed.command) {
    case '/clear':
      return parseNoArgCommand('clear', argument, 'Usage: /clear');
    case '/compact':
      return {
        kind: 'command',
        command: {
          action: 'compact',
          ...(argument ? { customInstructions: argument } : {}),
        },
      };
    case '/copy':
      return parseNoArgCommand('copy', argument, 'Usage: /copy');
    case '/export':
      return {
        kind: 'command',
        command: {
          action: 'export',
          ...(argument ? { outputPath: argument } : {}),
        },
      };
    case '/fork':
      return parseNoArgCommand('fork', argument, 'Usage: /fork');
    case '/image':
      return parseNoArgCommand('image', argument, 'Usage: /image');
    case '/name':
      return {
        kind: 'command',
        command: {
          action: 'name',
          ...(argument ? { name: argument } : {}),
        },
      };
    case '/new':
      return parseNoArgCommand('new', argument, 'Usage: /new');
    case '/reload':
      return parseNoArgCommand('reload', argument, 'Usage: /reload');
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
    case '/session':
      return parseNoArgCommand('session', argument, 'Usage: /session');
    case '/summarize':
      return parseNoArgCommand('summarize', argument, 'Usage: /summarize');
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
