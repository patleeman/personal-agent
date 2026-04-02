import { parseSlashInput } from './slashMenu';

export const PROJECT_SLASH_USAGE = 'Usage: /page new <title> | /page reference <id> | /page unreference <id>';

export type ProjectSlashCommand =
  | { action: 'new'; description: string }
  | { action: 'reference'; projectId: string }
  | { action: 'unreference'; projectId: string };

export type ProjectSlashParseResult =
  | { kind: 'command'; command: ProjectSlashCommand }
  | { kind: 'invalid'; message: string };

export function parseProjectSlashCommand(input: string): ProjectSlashParseResult | null {
  const parsed = parseSlashInput(input.trim());
  if (!parsed || (parsed.command !== '/page' && parsed.command !== '/project')) {
    return null;
  }

  const argument = parsed.argument.trim();
  if (argument.length === 0) {
    return { kind: 'invalid', message: PROJECT_SLASH_USAGE };
  }

  const [rawSubcommand, ...restTokens] = argument.split(/\s+/);
  const subcommand = rawSubcommand.toLowerCase();

  if (subcommand === 'new' || subcommand === 'create') {
    const description = restTokens.join(' ').trim();

    if (!description) {
      return {
        kind: 'invalid',
        message: 'Usage: /page new <title>',
      };
    }

    return {
      kind: 'command',
      command: {
        action: 'new',
        description,
      },
    };
  }

  if (subcommand === 'reference' || subcommand === 'ref') {
    const projectId = restTokens[0]?.trim() ?? '';
    if (!projectId) {
      return {
        kind: 'invalid',
        message: 'Usage: /page reference <id>',
      };
    }

    return {
      kind: 'command',
      command: {
        action: 'reference',
        projectId,
      },
    };
  }

  if (subcommand === 'unreference' || subcommand === 'unref' || subcommand === 'remove') {
    const projectId = restTokens[0]?.trim() ?? '';
    if (!projectId) {
      return {
        kind: 'invalid',
        message: 'Usage: /page unreference <id>',
      };
    }

    return {
      kind: 'command',
      command: {
        action: 'unreference',
        projectId,
      },
    };
  }

  return {
    kind: 'invalid',
    message: PROJECT_SLASH_USAGE,
  };
}
