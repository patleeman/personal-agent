import { parseSlashInput } from '../commands/slashMenu';

export type ConversationSlashCommand =
  | { action: 'auto'; enabled: boolean; mode: 'normal' | 'tenacious' | 'forced'; mission?: string; budget?: { maxTurns?: number } }
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

type ConversationSlashParseResult = { kind: 'command'; command: ConversationSlashCommand } | { kind: 'invalid'; message: string };

function parseNoArgCommand(
  command: Exclude<ConversationSlashCommand['action'], 'auto'>,
  argument: string,
  usage: string,
): ConversationSlashParseResult {
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
    case '/auto': {
      if (argument === 'off' || argument === 'stop') {
        return { kind: 'command', command: { action: 'auto', enabled: false, mode: 'normal' } };
      }

      const modeMatch = argument.match(/^(normal|tenacious|forced)\b\s*/i);
      const mode = modeMatch ? (modeMatch[1].toLowerCase() as 'normal' | 'tenacious' | 'forced') : 'tenacious';
      let rest = modeMatch ? argument.slice(modeMatch[0].length).trim() : argument;
      let budget: { maxTurns?: number } | undefined;
      const turnsMatch = rest.match(/^(?:for\s+)?(\d+)\s+turns?\b\s*/i);
      if (turnsMatch) {
        budget = { maxTurns: Number(turnsMatch[1]) };
        rest = rest.slice(turnsMatch[0].length).trim();
      }
      const mission = rest.replace(/^[:-]\s*/, '').trim();
      return {
        kind: 'command',
        command: {
          action: 'auto',
          enabled: true,
          mode,
          ...(mission ? { mission } : {}),
          ...(budget ? { budget } : {}),
        },
      };
    }
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
