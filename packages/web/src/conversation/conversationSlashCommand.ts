import { parseSlashInput } from '../commands/slashMenu';

export const CONVERSATION_MENU_SLASH_COMMANDS = [
  '/export',
  '/copy',
  '/name',
  '/session',
  '/fork',
  '/summarize-fork',
  '/new',
  '/compact',
  '/reload',
  '/draw',
  '/drawings',
] as const;

export const EXTERNAL_MENU_SLASH_COMMANDS = [
  '/model',
  '/page',
  '/resume',
] as const;

export type ConversationSlashCommand =
  | { action: 'clear' }
  | { action: 'compact'; customInstructions?: string }
  | { action: 'copy' }
  | { action: 'draw' }
  | { action: 'drawings' }
  | { action: 'export'; outputPath?: string }
  | { action: 'fork' }
  | { action: 'image' }
  | { action: 'summarizeFork' }
  | { action: 'name'; name?: string }
  | { action: 'new' }
  | { action: 'reload' }
  | { action: 'run'; command: string }
  | { action: 'search'; query: string }
  | { action: 'session' }
  | { action: 'summarize' }
  | { action: 'think'; topic?: string };

export type ConversationSlashParseResult =
  | { kind: 'command'; command: ConversationSlashCommand }
  | { kind: 'invalid'; message: string };

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
    case '/draw':
      return parseNoArgCommand('draw', argument, 'Usage: /draw');
    case '/drawings':
      return parseNoArgCommand('drawings', argument, 'Usage: /drawings');
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
    case '/summarize-fork':
      return parseNoArgCommand('summarizeFork', argument, 'Usage: /summarize-fork');
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
