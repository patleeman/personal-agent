import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import {
  createSpawnSyncTmuxRunner,
  ensurePaTmuxConfig,
  PERSONAL_AGENT_TMUX_SESSION_ENV,
  PERSONAL_AGENT_TMUX_SOCKET_ENV,
  PERSONAL_AGENT_TMUX_WORKSPACE_ENV,
  PA_TMUX_CWD_OPTION,
  PA_TMUX_PROFILE_OPTION,
  PA_TMUX_WORKSPACE_OPTION,
  resolvePaTmuxSocketName,
  withPaTmuxCliArgs,
  type TmuxRunner,
} from './tmux.js';

export interface PiWorkspaceInvocation {
  command: string;
  argsPrefix: string[];
}

export interface LaunchPiWorkspaceOptions {
  cwd: string;
  profileName: string;
  piInvocation: PiWorkspaceInvocation;
  requestedPiArgs: string[];
  launchPiArgs: string[];
  piEnv: NodeJS.ProcessEnv;
}

const WORKSPACE_MAIN_WINDOW_NAME = 'main';
const WORKSPACE_MAIN_PANE_TITLE = 'main';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatShellCommand(args: string[]): string {
  if (args.length === 0) {
    throw new Error('Command cannot be empty.');
  }

  return args.map((arg) => shellQuote(arg)).join(' ');
}

function sanitizeTmuxNamePart(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 24);

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

function hashPath(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 8);
}

function createWorkspaceBaseSessionName(cwd: string, profileName: string): string {
  const cwdParts = cwd.split('/').filter((part) => part.length > 0);
  const workspace = sanitizeTmuxNamePart(cwdParts[cwdParts.length - 1] ?? 'workspace', 'workspace');
  const profile = sanitizeTmuxNamePart(profileName, 'profile');
  const hash = hashPath(cwd);

  return `pa-${workspace}-${profile}-${hash}`;
}

function createWorkspaceSessionName(cwd: string, profileName: string, piArgs: string[]): string {
  const base = createWorkspaceBaseSessionName(cwd, profileName);

  if (piArgs.length === 0) {
    return base;
  }

  return `${base}-${formatTmuxSessionTimestamp()}`;
}

function tmuxResultToMessage(stderr: string, stdout: string): string {
  const output = `${stderr}\n${stdout}`.trim();
  return output.length > 0 ? output : 'unknown tmux error';
}

function isTmuxMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT');
}

function isMissingSessionMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('can\'t find session')
    || normalized.includes('no server running')
    || normalized.includes('failed to connect to server')
    || normalized.includes('error connecting to');
}

function sessionExists(sessionName: string, runner: TmuxRunner): boolean {
  const result = runner(['has-session', '-t', sessionName]);

  if ((result.status ?? 1) === 0) {
    return true;
  }

  if (isTmuxMissing(result.error)) {
    throw new Error('tmux is not installed or not available on PATH.');
  }

  const message = tmuxResultToMessage(result.stderr, result.stdout);
  if (isMissingSessionMessage(message)) {
    return false;
  }

  throw new Error(`tmux has-session failed: ${message}`);
}

function setSessionOption(sessionName: string, option: string, value: string, runner: TmuxRunner): void {
  const result = runner(['set-option', '-t', sessionName, option, value]);

  if ((result.status ?? 1) !== 0) {
    throw new Error(`tmux set-option failed: ${tmuxResultToMessage(result.stderr, result.stdout)}`);
  }
}

function sourceWorkspaceConfigIfServerRunning(runner: TmuxRunner): void {
  const result = runner(['source-file', ensurePaTmuxConfig()]);

  if ((result.status ?? 1) === 0) {
    return;
  }

  if (isTmuxMissing(result.error)) {
    throw new Error('tmux is not installed or not available on PATH.');
  }

  const message = tmuxResultToMessage(result.stderr, result.stdout);
  if (isMissingSessionMessage(message)) {
    return;
  }

  throw new Error(`tmux source-file failed: ${message}`);
}

function trySetPaneTitle(target: string, title: string, runner: TmuxRunner): void {
  const result = runner(['select-pane', '-t', target, '-T', title]);
  if ((result.status ?? 1) !== 0) {
    return;
  }
}

function buildPiWorkspaceCommand(
  sessionName: string,
  piInvocation: PiWorkspaceInvocation,
  piArgs: string[],
  piEnv: NodeJS.ProcessEnv,
): string {
  const socketName = resolvePaTmuxSocketName();
  const envArgs = Object.entries({
    ...piEnv,
    [PERSONAL_AGENT_TMUX_WORKSPACE_ENV]: '1',
    [PERSONAL_AGENT_TMUX_SESSION_ENV]: sessionName,
    [PERSONAL_AGENT_TMUX_SOCKET_ENV]: socketName,
  })
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, value]) => `${key}=${value}`);

  return `exec ${formatShellCommand([
    'env',
    ...envArgs,
    piInvocation.command,
    ...piInvocation.argsPrefix,
    ...piArgs,
  ])}`;
}

export function isInteractivePiInvocation(piArgs: string[]): boolean {
  for (let index = 0; index < piArgs.length; index += 1) {
    const arg = piArgs[index] as string;

    if (arg === '-p' || arg === '--print' || arg === '--export' || arg === '--list-models') {
      return false;
    }

    if (arg === '--help' || arg === '-h' || arg === '--version' || arg === '-v') {
      return false;
    }

    if (arg === '--mode') {
      const value = (piArgs[index + 1] ?? '').trim().toLowerCase();
      if (value === 'json' || value === 'rpc') {
        return false;
      }
      continue;
    }

    if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length).trim().toLowerCase();
      if (value === 'json' || value === 'rpc') {
        return false;
      }
    }
  }

  return true;
}

export function assertInteractiveWorkspaceAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.TMUX) {
    throw new Error('pa tui must be launched from a normal terminal, not inside tmux. Exit tmux first, then run pa tui.');
  }
}

export function launchPiInWorkspace(options: LaunchPiWorkspaceOptions): number {
  assertInteractiveWorkspaceAllowed();

  const runner = createSpawnSyncTmuxRunner();
  sourceWorkspaceConfigIfServerRunning(runner);
  const canReuseExistingWorkspace = options.requestedPiArgs.length === 0;
  const sessionName = createWorkspaceSessionName(options.cwd, options.profileName, options.requestedPiArgs);
  const exists = canReuseExistingWorkspace ? sessionExists(sessionName, runner) : false;

  if (!exists) {
    const command = buildPiWorkspaceCommand(sessionName, options.piInvocation, options.launchPiArgs, options.piEnv);
    const createResult = runner([
      'new-session',
      '-d',
      '-s',
      sessionName,
      '-n',
      WORKSPACE_MAIN_WINDOW_NAME,
      '-c',
      options.cwd,
      command,
    ]);

    if ((createResult.status ?? 1) !== 0) {
      if (isTmuxMissing(createResult.error)) {
        throw new Error('tmux is not installed or not available on PATH.');
      }

      throw new Error(`tmux new-session failed: ${tmuxResultToMessage(createResult.stderr, createResult.stdout)}`);
    }

    setSessionOption(sessionName, PA_TMUX_WORKSPACE_OPTION, '1', runner);
    setSessionOption(sessionName, PA_TMUX_PROFILE_OPTION, options.profileName, runner);
    setSessionOption(sessionName, PA_TMUX_CWD_OPTION, options.cwd, runner);
    trySetPaneTitle(`${sessionName}:${WORKSPACE_MAIN_WINDOW_NAME}`, WORKSPACE_MAIN_PANE_TITLE, runner);
  }

  const attachResult = spawnSync('tmux', withPaTmuxCliArgs(['attach-session', '-t', sessionName]), {
    stdio: 'inherit',
  });

  if (attachResult.error) {
    if (isTmuxMissing(attachResult.error)) {
      throw new Error('tmux is not installed or not available on PATH.');
    }

    throw attachResult.error;
  }

  return attachResult.status ?? 1;
}
