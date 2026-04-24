import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getStateRoot } from '@personal-agent/core';

const RESTART_LOCK_MAX_AGE_MS = 30 * 60 * 1000;

type ApplicationCommand = 'restart' | 'update';

interface ApplicationCommandLock {
  action?: ApplicationCommand;
  pid?: number;
  requestedAt?: string;
  repoRoot?: string;
  profile?: string;
  port?: number;
  command?: string[];
}

export interface ApplicationCommandRequestResult {
  accepted: true;
  action: ApplicationCommand;
  message: string;
  requestedAt: string;
  logFile: string;
}

export type ApplicationRestartRequestResult = ApplicationCommandRequestResult;

function resolveApplicationCommandLockFile(): string {
  return join(getStateRoot(), 'web', 'app-restart.lock.json');
}

function resolveApplicationCommandLogFile(): string {
  return join(getStateRoot(), 'desktop', 'logs', 'application-command.log');
}

function resolveCliEntryFile(repoRoot: string): string {
  return join(resolve(repoRoot), 'packages', 'cli', 'dist', 'index.js');
}

function readApplicationCommandLock(filePath: string): ApplicationCommandLock | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as ApplicationCommandLock;
  } catch {
    return undefined;
  }
}

function isProcessRunning(pid: number | undefined): boolean {
  if (!Number.isInteger(pid) || (pid as number) <= 0) {
    return false;
  }

  try {
    process.kill(pid as number, 0);
    return true;
  } catch {
    return false;
  }
}

function commandLabel(action: ApplicationCommand): string {
  if (action === 'update') {
    return 'update';
  }

  return 'restart';
}

function buildCliCommand(action: ApplicationCommand, cliEntryFile: string): string[] {
  if (action === 'update') {
    return [process.execPath, cliEntryFile, 'update'];
  }

  return [process.execPath, cliEntryFile, 'restart', '--rebuild'];
}

function buildRequestMessage(action: ApplicationCommand): string {
  if (action === 'update') {
    return 'Application update requested. Pulling latest changes, rebuilding packages, and restarting background services.';
  }

  return 'Application restart requested. Rebuilding packages and restarting background services.';
}

function buildNotificationEnv(input: {
  action: ApplicationCommand;
  profile?: string;
  requestedAt: string;
}): Record<string, string> {
  const shared = {
    PERSONAL_AGENT_OPERATIONAL_ACTIVITY_STATE_ROOT: join(getStateRoot(), 'daemon'),
  };

  if (input.action === 'update') {
    return {
      ...shared,
      PERSONAL_AGENT_UPDATE_NOTIFY_INBOX: '1',
      PERSONAL_AGENT_UPDATE_NOTIFY_PROFILE: input.profile ?? '',
      PERSONAL_AGENT_UPDATE_REQUESTED_AT: input.requestedAt,
    };
  }

  if (input.action === 'restart') {
    return {
      ...shared,
      PERSONAL_AGENT_RESTART_NOTIFY_SUCCESS_INBOX: '1',
      PERSONAL_AGENT_RESTART_NOTIFY_FAILURE_INBOX: '1',
      PERSONAL_AGENT_RESTART_NOTIFY_PROFILE: input.profile ?? '',
      PERSONAL_AGENT_RESTART_REQUESTED_AT: input.requestedAt,
    };
  }

  return {};
}

function buildAlreadyRunningMessage(action: ApplicationCommand, requestedAt?: string): string {
  const suffix = requestedAt ? ` (${requestedAt})` : '';

  return `Application ${commandLabel(action)} already in progress${suffix}.`;
}

function ensureApplicationCommandNotRunning(lockFile: string): void {
  const current = readApplicationCommandLock(lockFile);
  if (!current) {
    if (existsSync(lockFile)) {
      rmSync(lockFile, { force: true });
    }
    return;
  }

  const requestedAtMs = typeof current.requestedAt === 'string'
    ? Date.parse(current.requestedAt)
    : Number.NaN;
  const staleByAge = Number.isFinite(requestedAtMs)
    ? (Date.now() - requestedAtMs) > RESTART_LOCK_MAX_AGE_MS
    : true;

  if (isProcessRunning(current.pid) && !staleByAge) {
    const currentAction = current.action ?? 'restart';
    throw new Error(buildAlreadyRunningMessage(currentAction, current.requestedAt));
  }

  rmSync(lockFile, { force: true });
}

function requestApplicationCommand(input: {
  repoRoot: string;
  profile?: string;
  action: ApplicationCommand;
}): ApplicationCommandRequestResult {
  const repoRoot = resolve(input.repoRoot);
  const profile = input.profile?.trim() ?? '';
  if (profile.length === 0) {
    throw new Error(`Application ${commandLabel(input.action)} requires a profile.`);
  }

  const cliEntryFile = resolveCliEntryFile(repoRoot);
  if (!existsSync(cliEntryFile)) {
    throw new Error(`CLI entrypoint is not built: ${cliEntryFile}`);
  }

  const lockFile = resolveApplicationCommandLockFile();
  mkdirSync(dirname(lockFile), { recursive: true });
  ensureApplicationCommandNotRunning(lockFile);

  const logFile = resolveApplicationCommandLogFile();
  mkdirSync(dirname(logFile), { recursive: true });

  const requestedAt = new Date().toISOString();
  const command = buildCliCommand(input.action, cliEntryFile);

  writeFileSync(lockFile, `${JSON.stringify({
    action: input.action,
    requestedAt,
    repoRoot,
    profile,
    port: 0,
    command,
  }, null, 2)}\n`, {
    flag: 'wx',
  });

  let logFd: number | undefined;

  try {
    logFd = openSync(logFile, 'a');
    const child = spawn(process.execPath, command.slice(1), {
      cwd: repoRoot,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        PERSONAL_AGENT_REPO_ROOT: repoRoot,
        ...buildNotificationEnv({
          action: input.action,
          profile,
          requestedAt,
        }),
      },
    });

    if (!Number.isInteger(child.pid) || (child.pid as number) <= 0) {
      throw new Error(`Detached ${commandLabel(input.action)} process did not return a valid pid.`);
    }

    child.unref();

    writeFileSync(lockFile, `${JSON.stringify({
      action: input.action,
      pid: child.pid,
      requestedAt,
      repoRoot,
      profile,
      port: 0,
      command,
    }, null, 2)}\n`);
  } catch (error) {
    rmSync(lockFile, { force: true });
    throw error;
  } finally {
    if (logFd !== undefined) {
      closeSync(logFd);
    }
  }

  return {
    accepted: true,
    action: input.action,
    message: buildRequestMessage(input.action),
    requestedAt,
    logFile,
  };
}

export function requestApplicationRestart(input: {
  repoRoot: string;
  profile: string;
}): ApplicationCommandRequestResult {
  return requestApplicationCommand({
    ...input,
    action: 'restart',
  });
}

export function requestApplicationUpdate(input: {
  repoRoot: string;
  profile: string;
}): ApplicationCommandRequestResult {
  return requestApplicationCommand({
    ...input,
    action: 'update',
  });
}
