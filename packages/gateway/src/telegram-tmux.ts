import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export type TelegramTmuxForkMode = 'none' | 'auto' | 'new-topic' | 'reuse-topic';
export type TelegramTmuxNotifyMode = 'none' | 'message' | 'resume';

export interface TelegramTmuxRunRequest {
  taskSlug: string;
  commandText: string;
  cwd?: string;
  forkMode: TelegramTmuxForkMode;
  notifyMode: TelegramTmuxNotifyMode;
  group: string;
  topic: string;
}

export function gatewayTmuxUsageText(): string {
  return [
    'Usage: /tmux <subcommand>',
    '',
    'Subcommands:',
    '- /tmux list',
    '- /tmux inspect <session>',
    '- /tmux logs <session> [tail=<n>]',
    '- /tmux stop <session>',
    '- /tmux send <session> -- <command>',
    '- /tmux run <task-slug> [cwd=<path>] [fork=<none|auto|new-topic|reuse-topic>] [notify=<none|message|resume>] [group=<id|auto>] [topic=<name|auto>] -- <command>',
    '- /tmux clean [dry-run]',
  ].join('\n');
}

export function parseTelegramTmuxRunRequest(rawArgs: string):
  | { kind: 'pass' }
  | { kind: 'invalid'; message: string }
  | { kind: 'run'; value: TelegramTmuxRunRequest } {
  const trimmed = rawArgs.trim();
  if (trimmed.length === 0) {
    return { kind: 'pass' };
  }

  const delimiterMatch = trimmed.match(/^(.*?)(?:\s+--\s+)([\s\S]+)$/);
  const headText = delimiterMatch?.[1]?.trim() ?? trimmed;
  const commandText = delimiterMatch?.[2]?.trim();
  const tokens = headText.split(/\s+/).filter((token) => token.length > 0);
  const subcommand = (tokens[0] ?? '').toLowerCase();

  if (subcommand !== 'run') {
    return { kind: 'pass' };
  }

  if (!commandText) {
    return {
      kind: 'invalid',
      message: `Usage: /tmux run <task-slug> [cwd=<path>] [fork=<none|auto|new-topic|reuse-topic>] [notify=<none|message|resume>] [group=<id|auto>] [topic=<name|auto>] -- <command>\n\n${gatewayTmuxUsageText()}`,
    };
  }

  const taskSlug = tokens[1];
  if (!taskSlug) {
    return {
      kind: 'invalid',
      message: `Usage: /tmux run <task-slug> [cwd=<path>] [fork=<none|auto|new-topic|reuse-topic>] [notify=<none|message|resume>] [group=<id|auto>] [topic=<name|auto>] -- <command>\n\n${gatewayTmuxUsageText()}`,
    };
  }

  let cwd: string | undefined;
  let forkMode: TelegramTmuxForkMode = 'none';
  let notifyMode: TelegramTmuxNotifyMode = 'message';
  let group = 'auto';
  let topic = 'auto';

  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index] as string;

    if (token === '--cwd') {
      const next = tokens[index + 1];
      if (!next) {
        return {
          kind: 'invalid',
          message: `Usage: /tmux run <task-slug> [cwd=<path>] [fork=<none|auto|new-topic|reuse-topic>] [notify=<none|message|resume>] [group=<id|auto>] [topic=<name|auto>] -- <command>\n\n${gatewayTmuxUsageText()}`,
        };
      }

      cwd = next;
      index += 1;
      continue;
    }

    if (token.startsWith('cwd=')) {
      const value = token.slice('cwd='.length).trim();
      if (value.length === 0) {
        return {
          kind: 'invalid',
          message: `CWD cannot be empty.\n\n${gatewayTmuxUsageText()}`,
        };
      }

      cwd = value;
      continue;
    }

    if (token.startsWith('fork=')) {
      const value = token.slice('fork='.length).trim().toLowerCase();
      if (value === 'none' || value === 'auto' || value === 'new-topic' || value === 'reuse-topic') {
        forkMode = value;
        continue;
      }

      return {
        kind: 'invalid',
        message: `Invalid fork mode: ${value}. Use one of none, auto, new-topic, reuse-topic.\n\n${gatewayTmuxUsageText()}`,
      };
    }

    if (token.startsWith('notify=')) {
      const value = token.slice('notify='.length).trim().toLowerCase();
      if (value === 'none' || value === 'message' || value === 'resume') {
        notifyMode = value;
        continue;
      }

      return {
        kind: 'invalid',
        message: `Invalid notify mode: ${value}. Use one of none, message, resume.\n\n${gatewayTmuxUsageText()}`,
      };
    }

    if (token.startsWith('group=')) {
      const value = token.slice('group='.length).trim();
      if (value.length === 0) {
        return {
          kind: 'invalid',
          message: `Group cannot be empty.\n\n${gatewayTmuxUsageText()}`,
        };
      }

      group = value;
      continue;
    }

    if (token.startsWith('topic=')) {
      const value = token.slice('topic='.length).trim();
      if (value.length === 0) {
        return {
          kind: 'invalid',
          message: `Topic cannot be empty.\n\n${gatewayTmuxUsageText()}`,
        };
      }

      topic = value;
      continue;
    }

    return {
      kind: 'invalid',
      message: `Unknown /tmux run option: ${token}.\n\n${gatewayTmuxUsageText()}`,
    };
  }

  return {
    kind: 'run',
    value: {
      taskSlug,
      commandText,
      cwd,
      forkMode,
      notifyMode,
      group,
      topic,
    },
  };
}

export function buildTelegramTmuxRunCliArgs(run: TelegramTmuxRunRequest): string[] {
  const cliArgs = ['run', run.taskSlug];

  if (run.cwd && run.cwd.length > 0) {
    cliArgs.push('--cwd', run.cwd);
  }

  if (run.notifyMode !== 'none') {
    cliArgs.push('--notify-on-complete');
  }

  cliArgs.push('--', 'sh', '-lc', run.commandText);
  return cliArgs;
}

export function parseTmuxRunCliOutput(output: string): { sessionName?: string; logPath?: string } {
  const sessionMatch = output.match(/^\s*Session(?:\s*:\s*|\s+[·.:-]+\s+)(.+)$/m);
  const logMatch = output.match(/^\s*Log(?:\s*:\s*|\s+[·.:-]+\s+)(.+)$/m);

  return {
    sessionName: sessionMatch?.[1]?.trim(),
    logPath: logMatch?.[1]?.trim(),
  };
}

function parseGatewayTmuxCommand(rawArgs: string): { cliArgs?: string[]; message?: string } {
  const trimmed = rawArgs.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === 'help') {
    return { message: gatewayTmuxUsageText() };
  }

  const delimiterMatch = trimmed.match(/^(.*?)(?:\s+--\s+)([\s\S]+)$/);
  const headText = delimiterMatch?.[1]?.trim() ?? trimmed;
  const commandText = delimiterMatch?.[2]?.trim();
  const tokens = headText.split(/\s+/).filter((token) => token.length > 0);
  const subcommand = (tokens[0] ?? '').toLowerCase();

  const invalidArgs = (detail: string): { message: string } => ({
    message: `${detail}\n\n${gatewayTmuxUsageText()}`,
  });

  if (subcommand === 'list') {
    if (tokens.length !== 1) {
      return invalidArgs('Usage: /tmux list');
    }

    return { cliArgs: ['list'] };
  }

  if (subcommand === 'inspect') {
    if (tokens.length !== 2) {
      return invalidArgs('Usage: /tmux inspect <session>');
    }

    return { cliArgs: ['inspect', tokens[1] as string] };
  }

  if (subcommand === 'logs') {
    if (tokens.length < 2 || tokens.length > 3) {
      return invalidArgs('Usage: /tmux logs <session> [tail=<n>]');
    }

    const sessionName = tokens[1] as string;
    const cliArgs = ['logs', sessionName];

    if (tokens.length === 3) {
      const tailToken = tokens[2] as string;
      const rawTail = tailToken.startsWith('tail=')
        ? tailToken.slice('tail='.length)
        : tailToken;
      const tail = Number.parseInt(rawTail, 10);

      if (!Number.isFinite(tail) || tail <= 0) {
        return invalidArgs('Tail must be a positive integer.');
      }

      cliArgs.push('--tail', String(tail));
    }

    return { cliArgs };
  }

  if (subcommand === 'stop') {
    if (tokens.length !== 2) {
      return invalidArgs('Usage: /tmux stop <session>');
    }

    return { cliArgs: ['stop', tokens[1] as string] };
  }

  if (subcommand === 'send') {
    if (tokens.length !== 2 || !commandText) {
      return invalidArgs('Usage: /tmux send <session> -- <command>');
    }

    return {
      cliArgs: ['send', tokens[1] as string, commandText],
    };
  }

  if (subcommand === 'run') {
    if (tokens.length < 2 || !commandText) {
      return invalidArgs('Usage: /tmux run <task-slug> [cwd=<path>] -- <command>');
    }

    const taskSlug = tokens[1] as string;
    const cliArgs = ['run', taskSlug];

    if (tokens.length > 2) {
      let cwdArg: string | undefined;

      if (tokens.length === 3 && (tokens[2] as string).startsWith('cwd=')) {
        cwdArg = (tokens[2] as string).slice('cwd='.length);
      } else if (tokens.length === 4 && tokens[2] === '--cwd') {
        cwdArg = tokens[3] as string;
      } else {
        return invalidArgs('Usage: /tmux run <task-slug> [cwd=<path>] -- <command>');
      }

      if (!cwdArg || cwdArg.length === 0) {
        return invalidArgs('CWD cannot be empty.');
      }

      cliArgs.push('--cwd', cwdArg);
    }

    cliArgs.push('--', 'sh', '-lc', commandText);
    return { cliArgs };
  }

  if (subcommand === 'clean') {
    if (tokens.length === 1) {
      return { cliArgs: ['clean'] };
    }

    if (tokens.length === 2 && (tokens[1] === 'dry-run' || tokens[1] === '--dry-run')) {
      return { cliArgs: ['clean', '--dry-run'] };
    }

    return invalidArgs('Usage: /tmux clean [dry-run]');
  }

  return invalidArgs(`Unknown /tmux subcommand: ${subcommand}`);
}

const ANSI_ESCAPE_SEQUENCE_REGEX = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const GATEWAY_TMUX_CLI_MAX_BUFFER_BYTES = 20 * 1024 * 1024;

function normalizeGatewayTerminalOutput(value: string): string {
  return value
    .replace(ANSI_ESCAPE_SEQUENCE_REGEX, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function resolveGatewayCliEntryPath(): string | undefined {
  const gatewayModulePath = fileURLToPath(import.meta.url);
  const candidate = resolve(dirname(gatewayModulePath), '../../cli/dist/index.js');
  return existsSync(candidate) ? candidate : undefined;
}

export function runGatewayTmuxCli(tmuxArgs: string[], workingDirectory: string): { ok: boolean; output: string } {
  const cliEntryPath = resolveGatewayCliEntryPath();
  const command = cliEntryPath ? process.execPath : 'pa';
  const args = cliEntryPath
    ? [cliEntryPath, 'tmux', ...tmuxArgs]
    : ['tmux', ...tmuxArgs];

  const result = spawnSync(command, args, {
    cwd: workingDirectory,
    encoding: 'utf-8',
    maxBuffer: GATEWAY_TMUX_CLI_MAX_BUFFER_BYTES,
  });

  const stdout = normalizeGatewayTerminalOutput(result.stdout ?? '');
  const stderr = normalizeGatewayTerminalOutput(result.stderr ?? '');
  const output = [stdout, stderr].filter((value) => value.length > 0).join('\n');

  if (result.error) {
    const error = result.error as NodeJS.ErrnoException;

    if (error.code === 'ENOBUFS') {
      const maxBufferMb = Math.floor(GATEWAY_TMUX_CLI_MAX_BUFFER_BYTES / (1024 * 1024));
      const bufferMessage = `Gateway /tmux output exceeded ${maxBufferMb}MB. Try narrowing the command output.`;

      return {
        ok: false,
        output: output.length > 0 ? `${output}\n\n${bufferMessage}` : bufferMessage,
      };
    }

    return {
      ok: false,
      output: output.length > 0 ? output : error.message,
    };
  }

  if ((result.status ?? 1) !== 0) {
    return {
      ok: false,
      output: output.length > 0 ? output : `tmux command failed with exit code ${String(result.status ?? 1)}.`,
    };
  }

  return {
    ok: true,
    output: output.length > 0 ? output : 'Done.',
  };
}

export async function runTelegramTmuxCommand(input: {
  args: string;
  workingDirectory: string;
}): Promise<string> {
  const parsed = parseGatewayTmuxCommand(input.args);
  if (!parsed.cliArgs) {
    return parsed.message ?? gatewayTmuxUsageText();
  }

  const result = runGatewayTmuxCli(parsed.cliArgs, input.workingDirectory);
  if (!result.ok) {
    return `Unable to run /tmux command: ${result.output}`;
  }

  return result.output;
}
