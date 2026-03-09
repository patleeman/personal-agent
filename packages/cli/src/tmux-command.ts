import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { resolveStatePaths, validateStatePathsOutsideRepo } from '@personal-agent/core';
import { getRepoRoot } from '@personal-agent/resources';
import { hasOption } from './args.js';
import { readTailLines } from './file-utils.js';
import {
  captureManagedTmuxPane,
  createSpawnSyncTmuxRunner,
  findManagedTmuxSessionByName,
  listManagedTmuxSessions,
  sendManagedTmuxCommand,
  startManagedTmuxSession,
  stopManagedTmuxSession,
} from './tmux.js';
import { bullet, dim, keyValue, section, statusChip, success, warning } from './ui.js';

interface TmuxRunOptions {
  taskSlug: string;
  commandArgs: string[];
  cwd: string;
  notifyOnComplete: boolean;
  notifyContext?: string;
}

interface TmuxCleanOptions {
  dryRun: boolean;
  jsonMode: boolean;
}

function tmuxUsageText(): string {
  return 'Usage: pa tmux [list|inspect|logs|stop|send|run|clean|help] [args...]';
}

function tmuxListUsageText(): string {
  return 'Usage: pa tmux list [--json]';
}

function tmuxInspectUsageText(): string {
  return 'Usage: pa tmux inspect <session> [--json]';
}

function tmuxLogsUsageText(): string {
  return 'Usage: pa tmux logs <session> [--tail <count>]';
}

function tmuxStopUsageText(): string {
  return 'Usage: pa tmux stop <session>';
}

function tmuxSendUsageText(): string {
  return 'Usage: pa tmux send <session> <command>';
}

function tmuxRunUsageText(): string {
  return 'Usage: pa tmux run <task-slug> [--cwd <path>] [--notify-on-complete] [--notify-context <value>] [--] <command...>';
}

function tmuxCleanUsageText(): string {
  return 'Usage: pa tmux clean [--dry-run] [--json]';
}

function parseTmuxTailCount(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(tmuxLogsUsageText());
  }

  const count = Number.parseInt(raw, 10);

  if (!Number.isFinite(count) || count <= 0) {
    throw new Error(tmuxLogsUsageText());
  }

  return Math.min(1000, count);
}

function sanitizeTmuxNamePart(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 32);

  return normalized.length > 0 ? normalized : fallback;
}

function formatTmuxSessionTimestamp(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function createManagedTmuxSessionName(cwd: string, taskSlug: string): string {
  const cwdParts = cwd.split('/').filter((part) => part.length > 0);
  const workspace = sanitizeTmuxNamePart(cwdParts[cwdParts.length - 1] ?? 'workspace', 'workspace');
  const task = sanitizeTmuxNamePart(taskSlug, 'task');
  const timestamp = formatTmuxSessionTimestamp();

  return `${workspace}-${task}-${timestamp}`;
}

function formatTmuxSessionAge(createdEpochSeconds: number | null): string {
  if (!createdEpochSeconds || !Number.isFinite(createdEpochSeconds)) {
    return 'unknown';
  }

  const elapsedSeconds = Math.max(0, Math.floor(Date.now() / 1000) - createdEpochSeconds);
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return `${hours}h${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m${seconds}s`;
  }

  return `${seconds}s`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatShellCommand(args: string[]): string {
  if (args.length === 0) {
    throw new Error('Command cannot be empty.');
  }

  return args.map((arg) => shellQuote(arg)).join(' ');
}

function resolveTmuxLogDirectory(): string {
  const repoRoot = getRepoRoot();
  const statePaths = resolveStatePaths();
  validateStatePathsOutsideRepo(statePaths, repoRoot);

  const logDirectory = join(statePaths.root, 'tmux', 'logs');
  mkdirSync(logDirectory, { recursive: true });

  return logDirectory;
}

function parseTmuxCleanOptions(args: string[]): TmuxCleanOptions {
  let dryRun = false;
  let jsonMode = false;

  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--json') {
      jsonMode = true;
      continue;
    }

    throw new Error(tmuxCleanUsageText());
  }

  return {
    dryRun,
    jsonMode,
  };
}

function listTmuxLogFiles(logDirectory: string): string[] {
  if (!existsSync(logDirectory)) {
    return [];
  }

  return readdirSync(logDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.log'))
    .map((entry) => join(logDirectory, entry.name))
    .sort();
}

function normalizePath(path: string): string {
  return resolve(path);
}

function removeFileQuietly(path: string): { ok: boolean; error?: string } {
  try {
    rmSync(path, { force: true });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: (error as Error).message,
    };
  }
}

function parseTmuxRunOptions(args: string[]): TmuxRunOptions {
  let cwd = process.cwd();
  let taskSlug: string | undefined;
  const commandTokens: string[] = [];
  let readingCommand = false;
  let notifyOnComplete = false;
  let notifyContext: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;

    if (!readingCommand && arg === '--') {
      readingCommand = true;
      continue;
    }

    if (!readingCommand && arg === '--cwd') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(tmuxRunUsageText());
      }

      cwd = resolve(value);
      index += 1;
      continue;
    }

    if (!readingCommand && arg.startsWith('--cwd=')) {
      const value = arg.slice('--cwd='.length);
      if (!value) {
        throw new Error(tmuxRunUsageText());
      }

      cwd = resolve(value);
      continue;
    }

    if (!readingCommand && arg === '--notify-on-complete') {
      notifyOnComplete = true;
      continue;
    }

    if (!readingCommand && arg === '--notify-context') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(tmuxRunUsageText());
      }

      notifyContext = value;
      index += 1;
      continue;
    }

    if (!readingCommand && arg.startsWith('--notify-context=')) {
      const value = arg.slice('--notify-context='.length);
      if (!value) {
        throw new Error(tmuxRunUsageText());
      }

      notifyContext = value;
      continue;
    }

    if (!readingCommand && arg.startsWith('--')) {
      throw new Error(tmuxRunUsageText());
    }

    if (!taskSlug) {
      taskSlug = arg;
      continue;
    }

    readingCommand = true;
    commandTokens.push(arg);
  }

  if (!taskSlug || commandTokens.length === 0) {
    throw new Error(tmuxRunUsageText());
  }

  return {
    taskSlug,
    commandArgs: commandTokens,
    cwd,
    notifyOnComplete,
    notifyContext,
  };
}

export async function tmuxCommand(args: string[]): Promise<number> {
  const [subcommandRaw, ...rest] = args;
  const subcommand = subcommandRaw ?? 'list';
  const runner = createSpawnSyncTmuxRunner();

  if (subcommand === 'help') {
    console.log(section('Tmux commands'));
    console.log('');
    console.log(`Usage: pa tmux [list|inspect|logs|stop|send|run|clean|help] [args...]\n\nCommands:\n  list [--json]                    List agent-managed tmux sessions\n  inspect <session> [--json]       Show details for one managed tmux session\n  logs <session> [--tail <count>]  Show session logs (or pane output fallback)\n  stop <session>                   Stop one managed tmux session\n  send <session> <command>         Send command to session (tmux send-keys + Enter)\n  run <task-slug> [--cwd <path>] [--notify-on-complete] [--notify-context <value>] [--] <command...>\n                                   Start a managed tmux session for a command\n  clean [--dry-run] [--json]       Remove stale managed tmux logs for completed sessions\n`);
    return 0;
  }

  if (subcommand === 'list') {
    const jsonMode = hasOption(rest, '--json');
    const unknownOptions = rest.filter((arg) => arg.startsWith('--') && arg !== '--json');
    const positional = rest.filter((arg) => !arg.startsWith('--'));

    if (unknownOptions.length > 0 || positional.length > 0) {
      throw new Error(tmuxListUsageText());
    }

    const sessions = listManagedTmuxSessions(runner);

    if (jsonMode) {
      console.log(JSON.stringify({
        count: sessions.length,
        sessions,
      }, null, 2));
      return 0;
    }

    console.log(section('Managed tmux sessions'));
    console.log(keyValue('Count', sessions.length));

    if (sessions.length === 0) {
      console.log(dim('No agent-managed tmux sessions are running.'));
      return 0;
    }

    for (const session of sessions) {
      console.log('');
      console.log(bullet(`${session.name}: ${statusChip('running')}`));
      console.log(keyValue('Task', session.task ?? dim('unknown'), 4));
      console.log(keyValue('Age', formatTmuxSessionAge(session.createdEpochSeconds), 4));
      console.log(keyValue('Started', session.createdAt ? new Date(session.createdAt).toLocaleString() : dim('unknown'), 4));
      console.log(keyValue('Log', session.logPath ?? dim('none'), 4));
      console.log(keyValue('Notify', session.notifyOnComplete ? 'on-complete' : dim('none'), 4));
    }

    return 0;
  }

  if (subcommand === 'inspect') {
    const jsonMode = hasOption(rest, '--json');
    const unknownOptions = rest.filter((arg) => arg.startsWith('--') && arg !== '--json');
    const positional = rest.filter((arg) => !arg.startsWith('--'));

    if (unknownOptions.length > 0 || positional.length !== 1) {
      throw new Error(tmuxInspectUsageText());
    }

    const sessionName = positional[0] as string;
    const session = findManagedTmuxSessionByName(sessionName, runner);

    if (!session) {
      throw new Error(`No managed tmux session found: ${sessionName}`);
    }

    if (jsonMode) {
      console.log(JSON.stringify(session, null, 2));
      return 0;
    }

    console.log(section(`Tmux session: ${session.name}`));
    console.log(keyValue('Task', session.task ?? dim('unknown')));
    console.log(keyValue('Windows', session.windows));
    console.log(keyValue('Attached clients', session.attachedClients));
    console.log(keyValue('Started', session.createdAt ? new Date(session.createdAt).toLocaleString() : dim('unknown')));
    console.log(keyValue('Age', formatTmuxSessionAge(session.createdEpochSeconds)));
    console.log(keyValue('Log path', session.logPath ?? dim('none')));
    console.log(keyValue('Command', session.command ?? dim('unknown')));
    console.log(keyValue('Notify on complete', session.notifyOnComplete ? 'yes' : 'no'));
    if (session.notifyContext) {
      console.log(keyValue('Notify context', session.notifyContext));
    }
    return 0;
  }

  if (subcommand === 'logs') {
    let tail = 80;
    const positional: string[] = [];

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;

      if (arg === '--tail') {
        const value = rest[index + 1];
        if (!value) {
          throw new Error(tmuxLogsUsageText());
        }

        tail = parseTmuxTailCount(value);
        index += 1;
        continue;
      }

      if (arg.startsWith('--')) {
        throw new Error(tmuxLogsUsageText());
      }

      positional.push(arg);
    }

    if (positional.length !== 1) {
      throw new Error(tmuxLogsUsageText());
    }

    const sessionName = positional[0] as string;
    const session = findManagedTmuxSessionByName(sessionName, runner);

    if (!session) {
      throw new Error(`No managed tmux session found: ${sessionName}`);
    }

    let sourceLabel = 'tmux pane';
    let output = '';

    if (session.logPath && existsSync(session.logPath)) {
      sourceLabel = session.logPath;
      output = readTailLines(session.logPath, tail);
    } else {
      output = captureManagedTmuxPane(session.name, tail, runner);
    }

    console.log(section(`Tmux logs: ${session.name}`));
    console.log(keyValue('Source', sourceLabel));
    console.log('');
    console.log(output.length > 0 ? output : dim('(empty output)'));
    return 0;
  }

  if (subcommand === 'stop') {
    const positional = rest.filter((arg) => !arg.startsWith('--'));
    if (rest.length !== positional.length || positional.length !== 1) {
      throw new Error(tmuxStopUsageText());
    }

    const sessionName = positional[0] as string;
    stopManagedTmuxSession(sessionName, runner);

    console.log(success(`Stopped tmux session ${sessionName}`));
    return 0;
  }

  if (subcommand === 'send') {
    if (rest.length < 2) {
      throw new Error(tmuxSendUsageText());
    }

    const sessionName = rest[0] as string;
    const command = rest.slice(1).join(' ').trim();

    if (sessionName.startsWith('--') || command.length === 0) {
      throw new Error(tmuxSendUsageText());
    }

    sendManagedTmuxCommand(sessionName, command, runner);
    console.log(success(`Sent command to ${sessionName}`));
    return 0;
  }

  if (subcommand === 'run') {
    const runOptions = parseTmuxRunOptions(rest);
    const sessionName = createManagedTmuxSessionName(runOptions.cwd, runOptions.taskSlug);
    const logDirectory = resolveTmuxLogDirectory();
    const logPath = join(logDirectory, `${sessionName}.log`);

    const displayCommand = runOptions.commandArgs.join(' ');
    const shellCommand = formatShellCommand(runOptions.commandArgs);
    const quotedLogPath = shellQuote(logPath);
    const wrappedCommand = `${shellCommand} > ${quotedLogPath} 2>&1; __pa_exit_code=$?; printf '\n__PA_TMUX_EXIT_CODE=%s\n' "$__pa_exit_code" >> ${quotedLogPath}; exit $__pa_exit_code`;

    startManagedTmuxSession({
      sessionName,
      cwd: runOptions.cwd,
      command: wrappedCommand,
      task: runOptions.taskSlug,
      logPath,
      sourceCommand: displayCommand,
      notifyOnComplete: runOptions.notifyOnComplete,
      notifyContext: runOptions.notifyContext,
    }, runner);

    const session = findManagedTmuxSessionByName(sessionName, runner);

    console.log(section('Managed tmux session started'));
    console.log(keyValue('Session', sessionName));
    console.log(keyValue('Task', runOptions.taskSlug));
    console.log(keyValue('CWD', runOptions.cwd));
    console.log(keyValue('Log', logPath));
    console.log(keyValue('Command', displayCommand));
    console.log(keyValue('Notify on complete', runOptions.notifyOnComplete ? 'yes' : 'no'));
    if (runOptions.notifyContext) {
      console.log(keyValue('Notify context', runOptions.notifyContext));
    }

    if (!session) {
      console.log(warning('Session exited before status check (command may have completed quickly).'));
    }

    return 0;
  }

  if (subcommand === 'clean') {
    const cleanOptions = parseTmuxCleanOptions(rest);
    const sessions = listManagedTmuxSessions(runner);
    const activeLogPaths = new Set(
      sessions
        .map((session) => session.logPath)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .map((value) => normalizePath(value)),
    );

    const logDirectory = resolveTmuxLogDirectory();
    const allLogFiles = listTmuxLogFiles(logDirectory);
    const staleLogFiles = allLogFiles.filter((logPath) => !activeLogPaths.has(normalizePath(logPath)));

    const removed: string[] = [];
    const errors: Array<{ path: string; error: string }> = [];

    if (!cleanOptions.dryRun) {
      for (const logPath of staleLogFiles) {
        const result = removeFileQuietly(logPath);
        if (result.ok) {
          removed.push(logPath);
        } else {
          errors.push({
            path: logPath,
            error: result.error ?? 'unknown error',
          });
        }
      }
    }

    const payload = {
      dryRun: cleanOptions.dryRun,
      logDirectory,
      activeSessionCount: sessions.length,
      totalLogFiles: allLogFiles.length,
      staleLogFiles,
      removed: cleanOptions.dryRun ? [] : removed,
      errors,
    };

    if (cleanOptions.jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return errors.length > 0 ? 1 : 0;
    }

    console.log(section('Managed tmux cleanup'));
    console.log(keyValue('Dry run', cleanOptions.dryRun ? 'yes' : 'no'));
    console.log(keyValue('Log directory', logDirectory));
    console.log(keyValue('Active managed sessions', sessions.length));
    console.log(keyValue('Total log files', allLogFiles.length));
    console.log(keyValue('Stale log files', staleLogFiles.length));
    console.log(keyValue('Removed', cleanOptions.dryRun ? 0 : removed.length));

    if (staleLogFiles.length === 0) {
      console.log(dim('No stale tmux logs found.'));
    } else if (cleanOptions.dryRun) {
      console.log('');
      console.log(section('Dry run candidates'));
      for (const path of staleLogFiles) {
        console.log(bullet(path));
      }
    }

    if (errors.length > 0) {
      console.log('');
      console.log(warning(`${errors.length} stale log file(s) failed to delete`));
      for (const issue of errors) {
        console.log(keyValue('Delete error', `${issue.path}: ${issue.error}`, 4));
      }
      return 1;
    }

    if (!cleanOptions.dryRun) {
      console.log('');
      console.log(success(`Removed ${removed.length} stale tmux log file(s)`));
    }

    return 0;
  }

  throw new Error(`${tmuxUsageText()}\nUnknown tmux subcommand: ${subcommand}`);
}
