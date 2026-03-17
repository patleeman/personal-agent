import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export type TelegramRunForkMode = 'none' | 'auto' | 'new-topic' | 'reuse-topic';
export type TelegramRunNotifyMode = 'none' | 'message' | 'resume';

export interface TelegramRunRequest {
  taskSlug: string;
  commandText: string;
  cwd?: string;
  forkMode: TelegramRunForkMode;
  notifyMode: TelegramRunNotifyMode;
  group: string;
  topic: string;
}

export function gatewayRunUsageText(): string {
  return [
    'Usage: /run <task-slug> [cwd=<path>] [fork=<none|auto|new-topic|reuse-topic>] [notify=<none|message|resume>] [group=<id|auto>] [topic=<name|auto>] -- <command>',
    '',
    'Inspection commands:',
    '- /run list',
    '- /run show <id>',
    '- /run logs <id> [tail=<n>]',
    '- /run cancel <id>',
  ].join('\n');
}

export function parseTelegramRunRequest(rawArgs: string):
  | { kind: 'pass' }
  | { kind: 'invalid'; message: string }
  | { kind: 'run'; value: TelegramRunRequest } {
  const trimmed = rawArgs.trim();
  if (trimmed.length === 0) {
    return { kind: 'pass' };
  }

  const delimiterMatch = trimmed.match(/^(.*?)(?:\s+--\s+)([\s\S]+)$/);
  const headText = delimiterMatch?.[1]?.trim() ?? trimmed;
  const commandText = delimiterMatch?.[2]?.trim();
  const tokens = headText.split(/\s+/).filter((token) => token.length > 0);
  const firstToken = (tokens[0] ?? '').toLowerCase();

  if (firstToken === 'list' || firstToken === 'show' || firstToken === 'inspect' || firstToken === 'logs' || firstToken === 'cancel' || firstToken === 'help') {
    return { kind: 'pass' };
  }

  if (!commandText) {
    return {
      kind: 'invalid',
      message: `Usage: /run <task-slug> [cwd=<path>] [fork=<none|auto|new-topic|reuse-topic>] [notify=<none|message|resume>] [group=<id|auto>] [topic=<name|auto>] -- <command>\n\n${gatewayRunUsageText()}`,
    };
  }

  const taskSlug = tokens[0];
  if (!taskSlug) {
    return {
      kind: 'invalid',
      message: `Usage: /run <task-slug> [cwd=<path>] [fork=<none|auto|new-topic|reuse-topic>] [notify=<none|message|resume>] [group=<id|auto>] [topic=<name|auto>] -- <command>\n\n${gatewayRunUsageText()}`,
    };
  }

  let cwd: string | undefined;
  let forkMode: TelegramRunForkMode = 'none';
  let notifyMode: TelegramRunNotifyMode = 'message';
  let group = 'auto';
  let topic = 'auto';

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] as string;

    if (token === '--cwd') {
      const next = tokens[index + 1];
      if (!next) {
        return {
          kind: 'invalid',
          message: `Usage: /run <task-slug> [cwd=<path>] [fork=<none|auto|new-topic|reuse-topic>] [notify=<none|message|resume>] [group=<id|auto>] [topic=<name|auto>] -- <command>\n\n${gatewayRunUsageText()}`,
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
          message: `CWD cannot be empty.\n\n${gatewayRunUsageText()}`,
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
        message: `Invalid fork mode: ${value}. Use one of none, auto, new-topic, reuse-topic.\n\n${gatewayRunUsageText()}`,
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
        message: `Invalid notify mode: ${value}. Use one of none, message, resume.\n\n${gatewayRunUsageText()}`,
      };
    }

    if (token.startsWith('group=')) {
      const value = token.slice('group='.length).trim();
      if (value.length === 0) {
        return {
          kind: 'invalid',
          message: `Group cannot be empty.\n\n${gatewayRunUsageText()}`,
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
          message: `Topic cannot be empty.\n\n${gatewayRunUsageText()}`,
        };
      }

      topic = value;
      continue;
    }

    return {
      kind: 'invalid',
      message: `Unknown /run option: ${token}.\n\n${gatewayRunUsageText()}`,
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

export function buildTelegramRunCliArgs(run: TelegramRunRequest): string[] {
  const cliArgs = ['start', run.taskSlug];

  if (run.cwd && run.cwd.length > 0) {
    cliArgs.push('--cwd', run.cwd);
  }

  cliArgs.push('--', 'sh', '-lc', run.commandText);
  return cliArgs;
}

export function parseRunCliOutput(output: string): { runId?: string; logPath?: string } {
  const runMatch = output.match(/^\s*Run(?:\s*:\s*|\s+[·.:-]+\s+)(.+)$/m);
  const logMatch = output.match(/^\s*Log(?:\s*:\s*|\s+[·.:-]+\s+)(.+)$/m);

  return {
    runId: runMatch?.[1]?.trim(),
    logPath: logMatch?.[1]?.trim(),
  };
}

function parseGatewayRunCommand(rawArgs: string): { cliArgs?: string[]; message?: string } {
  const trimmed = rawArgs.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === 'help') {
    return { message: gatewayRunUsageText() };
  }

  const tokens = trimmed.split(/\s+/).filter((token) => token.length > 0);
  const subcommand = (tokens[0] ?? '').toLowerCase();

  const invalidArgs = (detail: string): { message: string } => ({
    message: `${detail}\n\n${gatewayRunUsageText()}`,
  });

  if (subcommand === 'list') {
    if (tokens.length !== 1) {
      return invalidArgs('Usage: /run list');
    }

    return { cliArgs: ['list'] };
  }

  if (subcommand === 'show' || subcommand === 'inspect') {
    if (tokens.length !== 2) {
      return invalidArgs('Usage: /run show <id>');
    }

    return { cliArgs: ['show', tokens[1] as string] };
  }

  if (subcommand === 'logs') {
    if (tokens.length < 2 || tokens.length > 3) {
      return invalidArgs('Usage: /run logs <id> [tail=<n>]');
    }

    const runId = tokens[1] as string;
    const cliArgs = ['logs', runId];

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

  if (subcommand === 'cancel' || subcommand === 'stop') {
    if (tokens.length !== 2) {
      return invalidArgs('Usage: /run cancel <id>');
    }

    return { cliArgs: ['cancel', tokens[1] as string] };
  }

  return invalidArgs(`Unknown /run subcommand: ${subcommand}`);
}

const ANSI_ESCAPE_SEQUENCE_REGEX = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const GATEWAY_RUN_CLI_MAX_BUFFER_BYTES = 20 * 1024 * 1024;

function normalizeGatewayTerminalOutput(value: string): string {
  return value
    .replace(ANSI_ESCAPE_SEQUENCE_REGEX, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

export function resolveGatewayCliEntryPath(): string | undefined {
  const gatewayModulePath = fileURLToPath(import.meta.url);
  const candidate = resolve(dirname(gatewayModulePath), '../../cli/dist/index.js');
  return existsSync(candidate) ? candidate : undefined;
}

export function runGatewayRunCli(runArgs: string[], workingDirectory: string): { ok: boolean; output: string } {
  const cliEntryPath = resolveGatewayCliEntryPath();
  const command = cliEntryPath ? process.execPath : 'pa';
  const args = cliEntryPath
    ? [cliEntryPath, 'runs', ...runArgs]
    : ['runs', ...runArgs];

  const result = spawnSync(command, args, {
    cwd: workingDirectory,
    encoding: 'utf-8',
    maxBuffer: GATEWAY_RUN_CLI_MAX_BUFFER_BYTES,
  });

  const stdout = normalizeGatewayTerminalOutput(result.stdout ?? '');
  const stderr = normalizeGatewayTerminalOutput(result.stderr ?? '');
  const output = [stdout, stderr].filter((value) => value.length > 0).join('\n');

  if (result.error) {
    const error = result.error as NodeJS.ErrnoException;

    if (error.code === 'ENOBUFS') {
      const maxBufferMb = Math.floor(GATEWAY_RUN_CLI_MAX_BUFFER_BYTES / (1024 * 1024));
      const bufferMessage = `Gateway /run output exceeded ${maxBufferMb}MB. Try narrowing the command output.`;

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
      output: output.length > 0 ? output : `run command failed with exit code ${String(result.status ?? 1)}.`,
    };
  }

  return {
    ok: true,
    output: output.length > 0 ? output : 'Done.',
  };
}

export async function runTelegramRunCommand(input: {
  args: string;
  workingDirectory: string;
}): Promise<string> {
  const parsed = parseGatewayRunCommand(input.args);
  if (!parsed.cliArgs) {
    return parsed.message ?? gatewayRunUsageText();
  }

  const result = runGatewayRunCli(parsed.cliArgs, input.workingDirectory);
  if (!result.ok) {
    return `Unable to run /run command: ${result.output}`;
  }

  return result.output;
}
