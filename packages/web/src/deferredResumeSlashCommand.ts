import { parseSlashInput } from './slashMenu';

export const DEFERRED_RESUME_SLASH_USAGE = 'Usage: /resume <delay> [prompt]';
const DEFERRED_RESUME_SLASH_COMMANDS = new Set(['/resume', '/defer']);

export interface DeferredResumeSlashCommand {
  action: 'schedule';
  delay: string;
  prompt?: string;
}

export type DeferredResumeSlashParseResult =
  | { kind: 'command'; command: DeferredResumeSlashCommand }
  | { kind: 'invalid'; message: string };

export function parseDeferredResumeSlashCommand(input: string): DeferredResumeSlashParseResult | null {
  const parsed = parseSlashInput(input.trim());
  if (!parsed || !DEFERRED_RESUME_SLASH_COMMANDS.has(parsed.command)) {
    return null;
  }

  const argument = parsed.argument.trim();
  if (argument.length === 0) {
    return { kind: 'invalid', message: DEFERRED_RESUME_SLASH_USAGE };
  }

  const [delayToken, ...promptTokens] = argument.split(/\s+/);
  const delay = delayToken?.trim() ?? '';
  if (!delay) {
    return { kind: 'invalid', message: DEFERRED_RESUME_SLASH_USAGE };
  }

  const prompt = promptTokens.join(' ').trim();
  return {
    kind: 'command',
    command: {
      action: 'schedule',
      delay,
      ...(prompt ? { prompt } : {}),
    },
  };
}
