import { spawnSync } from 'child_process';

export const PA_TMUX_MANAGED_OPTION = '@pa_agent_session';
export const PA_TMUX_TASK_OPTION = '@pa_agent_task';
export const PA_TMUX_LOG_OPTION = '@pa_agent_log';
export const PA_TMUX_COMMAND_OPTION = '@pa_agent_cmd';

const LIST_SESSIONS_FORMAT = [
  '#{session_name}',
  '#{session_id}',
  '#{session_windows}',
  '#{session_attached}',
  '#{session_created}',
  `#{${PA_TMUX_MANAGED_OPTION}}`,
  `#{${PA_TMUX_TASK_OPTION}}`,
  `#{${PA_TMUX_LOG_OPTION}}`,
  `#{${PA_TMUX_COMMAND_OPTION}}`,
].join('\t');

interface TmuxCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type TmuxRunner = (args: string[]) => TmuxCommandResult;

export interface ManagedTmuxSession {
  name: string;
  id: string;
  windows: number;
  attachedClients: number;
  createdEpochSeconds: number | null;
  createdAt: string | null;
  task: string | null;
  logPath: string | null;
  command: string | null;
}

export interface StartManagedTmuxSessionOptions {
  sessionName: string;
  cwd: string;
  command: string;
  task?: string;
  logPath?: string;
  sourceCommand?: string;
}

export function createSpawnSyncTmuxRunner(): TmuxRunner {
  return (args) => {
    const result = spawnSync('tmux', args, {
      encoding: 'utf-8',
    });

    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      error: result.error,
    };
  };
}

function normalizeOutput(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function tmuxMissingError(result: TmuxCommandResult): boolean {
  if (!result.error) {
    return false;
  }

  const code = (result.error as NodeJS.ErrnoException).code;
  return code === 'ENOENT';
}

function noServerRunning(result: TmuxCommandResult): boolean {
  const combined = `${result.stderr}\n${result.stdout}`.toLowerCase();

  return combined.includes('no server running')
    || combined.includes('failed to connect to server')
    || combined.includes('error connecting to');
}

function throwTmuxFailure(args: string[], result: TmuxCommandResult): never {
  if (tmuxMissingError(result)) {
    throw new Error('tmux is not installed or not available on PATH.');
  }

  const detail = normalizeOutput(result.stderr || result.stdout) || `exit code ${String(result.status ?? '?')}`;
  throw new Error(`tmux ${args.join(' ')} failed: ${detail}`);
}

function parseNumeric(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableString(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseManagedSessionLine(line: string): ManagedTmuxSession | null {
  if (line.trim().length === 0) {
    return null;
  }

  const parts = line.split('\t');

  const name = parts[0]?.trim() ?? '';
  const id = parts[1]?.trim() ?? '';
  const windowsRaw = parts[2]?.trim() ?? '0';
  const attachedRaw = parts[3]?.trim() ?? '0';
  const createdRaw = parts[4]?.trim() ?? '';
  const managedRaw = parts[5]?.trim() ?? '';
  const taskRaw = parts[6] ?? '';
  const logPathRaw = parts[7] ?? '';
  const commandRaw = parts[8] ?? '';

  if (managedRaw !== '1' || name.length === 0) {
    return null;
  }

  const createdEpochSeconds = Number.parseInt(createdRaw, 10);
  const hasCreated = Number.isFinite(createdEpochSeconds);

  return {
    name,
    id,
    windows: parseNumeric(windowsRaw),
    attachedClients: parseNumeric(attachedRaw),
    createdEpochSeconds: hasCreated ? createdEpochSeconds : null,
    createdAt: hasCreated ? new Date(createdEpochSeconds * 1000).toISOString() : null,
    task: toNullableString(taskRaw),
    logPath: toNullableString(logPathRaw),
    command: toNullableString(commandRaw),
  };
}

export function listManagedTmuxSessions(runner: TmuxRunner = createSpawnSyncTmuxRunner()): ManagedTmuxSession[] {
  const args = ['list-sessions', '-F', LIST_SESSIONS_FORMAT];
  const result = runner(args);

  if ((result.status ?? 1) !== 0) {
    if (noServerRunning(result)) {
      return [];
    }

    throwTmuxFailure(args, result);
  }

  const lines = normalizeOutput(result.stdout)
    .split('\n')
    .filter((line) => line.trim().length > 0);

  const sessions = lines
    .map((line) => parseManagedSessionLine(line))
    .filter((session): session is ManagedTmuxSession => session !== null);

  sessions.sort((left, right) => {
    const leftCreated = left.createdEpochSeconds ?? 0;
    const rightCreated = right.createdEpochSeconds ?? 0;

    if (leftCreated !== rightCreated) {
      return rightCreated - leftCreated;
    }

    return left.name.localeCompare(right.name);
  });

  return sessions;
}

export function findManagedTmuxSessionByName(
  sessionName: string,
  runner: TmuxRunner = createSpawnSyncTmuxRunner(),
): ManagedTmuxSession | undefined {
  const normalizedName = sessionName.trim();
  if (normalizedName.length === 0) {
    return undefined;
  }

  const sessions = listManagedTmuxSessions(runner);
  return sessions.find((session) => session.name === normalizedName);
}

function ensureManagedSession(
  sessionName: string,
  runner: TmuxRunner,
): ManagedTmuxSession {
  const session = findManagedTmuxSessionByName(sessionName, runner);

  if (!session) {
    throw new Error(`No managed tmux session found: ${sessionName}`);
  }

  return session;
}

export function stopManagedTmuxSession(
  sessionName: string,
  runner: TmuxRunner = createSpawnSyncTmuxRunner(),
): void {
  ensureManagedSession(sessionName, runner);

  const args = ['kill-session', '-t', sessionName];
  const result = runner(args);

  if ((result.status ?? 1) !== 0) {
    throwTmuxFailure(args, result);
  }
}

export function sendManagedTmuxCommand(
  sessionName: string,
  command: string,
  runner: TmuxRunner = createSpawnSyncTmuxRunner(),
): void {
  const trimmedCommand = command.trim();
  if (trimmedCommand.length === 0) {
    throw new Error('Command cannot be empty.');
  }

  ensureManagedSession(sessionName, runner);

  const args = ['send-keys', '-t', sessionName, trimmedCommand, 'C-m'];
  const result = runner(args);

  if ((result.status ?? 1) !== 0) {
    throwTmuxFailure(args, result);
  }
}

export function captureManagedTmuxPane(
  sessionName: string,
  lineCount: number,
  runner: TmuxRunner = createSpawnSyncTmuxRunner(),
): string {
  ensureManagedSession(sessionName, runner);

  const safeLineCount = Math.max(1, Math.min(1000, Math.floor(lineCount)));
  const start = `-${safeLineCount}`;
  const args = ['capture-pane', '-pt', sessionName, '-S', start];
  const result = runner(args);

  if ((result.status ?? 1) !== 0) {
    throwTmuxFailure(args, result);
  }

  return normalizeOutput(result.stdout);
}

function setManagedSessionOption(
  sessionName: string,
  option: string,
  value: string,
  runner: TmuxRunner,
): void {
  const args = ['set-option', '-t', sessionName, option, value];
  const result = runner(args);

  if ((result.status ?? 1) !== 0) {
    throwTmuxFailure(args, result);
  }
}

export function tagManagedTmuxSession(
  sessionName: string,
  metadata: {
    task?: string;
    logPath?: string;
    command?: string;
  },
  runner: TmuxRunner = createSpawnSyncTmuxRunner(),
): void {
  setManagedSessionOption(sessionName, PA_TMUX_MANAGED_OPTION, '1', runner);

  if (metadata.task) {
    setManagedSessionOption(sessionName, PA_TMUX_TASK_OPTION, metadata.task, runner);
  }

  if (metadata.logPath) {
    setManagedSessionOption(sessionName, PA_TMUX_LOG_OPTION, metadata.logPath, runner);
  }

  if (metadata.command) {
    setManagedSessionOption(sessionName, PA_TMUX_COMMAND_OPTION, metadata.command, runner);
  }
}

export function startManagedTmuxSession(
  options: StartManagedTmuxSessionOptions,
  runner: TmuxRunner = createSpawnSyncTmuxRunner(),
): void {
  const args = ['new-session', '-d', '-s', options.sessionName, '-c', options.cwd, options.command];
  const result = runner(args);

  if ((result.status ?? 1) !== 0) {
    throwTmuxFailure(args, result);
  }

  tagManagedTmuxSession(
    options.sessionName,
    {
      task: options.task,
      logPath: options.logPath,
      command: options.sourceCommand,
    },
    runner,
  );
}
