import { spawn } from 'child_process';
import { closeSync, mkdirSync, openSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SessionDeferredResumesModuleConfig } from '../config.js';
import type { DaemonModule } from './types.js';
import {
  createEmptySessionDeferredResumeState,
  loadSessionDeferredResumeState,
  saveSessionDeferredResumeState,
  type SessionDeferredResumeRecord,
  type SessionDeferredResumeStateFile,
} from './session-deferred-resumes-store.js';

const DEFAULT_TICK_INTERVAL_SECONDS = 5;
const DEFAULT_RETRY_DELAY_SECONDS = 30;
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CLI_ENTRY = join(PACKAGE_ROOT, 'packages', 'cli', 'dist', 'index.js');

interface SessionDeferredResumesModuleState {
  scheduledCount: number;
  runningCount: number;
  launchedCount: number;
  completedCount: number;
  failedCount: number;
  lastTickAt?: string;
  lastError?: string;
}

export interface LaunchSessionDeferredResumeRequest {
  id: string;
  sessionFile: string;
  cwd: string;
  profile?: string;
  prompt: string;
  logPath: string;
}

export interface SessionDeferredResumesModuleDependencies {
  now?: () => Date;
  createId?: () => string;
  launchSessionDeferredResume?: (request: LaunchSessionDeferredResumeRequest) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeIsoTimestamp(value: string): string | undefined {
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) {
    return undefined;
  }

  return new Date(parsedMs).toISOString();
}

function parseScheduleEventPayload(
  payload: Record<string, unknown>,
  createId: () => string,
  nowIso: string,
): SessionDeferredResumeRecord | undefined {
  const sessionFile = toString(payload.sessionFile);
  const cwd = toString(payload.cwd);
  const prompt = toString(payload.prompt);
  const dueAtRaw = toString(payload.dueAt);

  if (!sessionFile || !cwd || !prompt || !dueAtRaw) {
    return undefined;
  }

  const dueAt = normalizeIsoTimestamp(dueAtRaw);
  if (!dueAt) {
    return undefined;
  }

  const id = toString(payload.id) ?? createId();
  const createdAt = normalizeIsoTimestamp(toString(payload.createdAt) ?? nowIso) ?? nowIso;

  return {
    id,
    sessionFile,
    cwd,
    profile: toString(payload.profile),
    prompt,
    dueAt,
    createdAt,
    status: 'scheduled',
    attempts: 0,
  };
}

async function defaultLaunchSessionDeferredResume(request: LaunchSessionDeferredResumeRequest): Promise<void> {
  mkdirSync(dirname(request.logPath), { recursive: true, mode: 0o700 });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const outputFd = openSync(request.logPath, 'a');
    const args = [CLI_ENTRY];

    if (request.profile) {
      args.push('--profile', request.profile);
    }

    args.push('--session', request.sessionFile, '-p', request.prompt);

    const finalize = (fn: () => void): void => {
      try {
        closeSync(outputFd);
      } catch {
        // Ignore close failures.
      }
      fn();
    };

    const child = spawn(process.execPath, args, {
      cwd: request.cwd,
      detached: true,
      stdio: ['ignore', outputFd, outputFd],
      env: {
        ...process.env,
        PERSONAL_AGENT_DEFERRED_RESUME_ID: request.id,
      },
    });

    child.once('error', (error) => {
      finalize(() => rejectPromise(error));
    });

    child.once('spawn', () => {
      child.unref();
      finalize(() => resolvePromise());
    });
  });
}

export function createSessionDeferredResumesModule(
  config: SessionDeferredResumesModuleConfig = {
    enabled: true,
    tickIntervalSeconds: DEFAULT_TICK_INTERVAL_SECONDS,
    retryDelaySeconds: DEFAULT_RETRY_DELAY_SECONDS,
  },
  dependencies: SessionDeferredResumesModuleDependencies = {},
): DaemonModule {
  const now = dependencies.now ?? (() => new Date());
  const createId = dependencies.createId ?? (() => `session_resume_${Math.random().toString(36).slice(2)}`);
  const launchSessionDeferredResume = dependencies.launchSessionDeferredResume ?? defaultLaunchSessionDeferredResume;

  const tickIntervalSeconds = Math.max(1, Math.floor(config.tickIntervalSeconds));
  const retryDelaySeconds = Math.max(1, Math.floor(config.retryDelaySeconds));

  const state: SessionDeferredResumesModuleState = {
    scheduledCount: 0,
    runningCount: 0,
    launchedCount: 0,
    completedCount: 0,
    failedCount: 0,
  };

  let stateFile = '';
  let store: SessionDeferredResumeStateFile = createEmptySessionDeferredResumeState();
  let stopping = false;
  let tickInProgress = false;

  const persistState = (logger: { warn: (message: string) => void }): void => {
    if (!stateFile) {
      return;
    }

    try {
      saveSessionDeferredResumeState(stateFile, store);
    } catch (error) {
      const message = (error as Error).message;
      state.lastError = message;
      logger.warn(`session deferred resume state save failed: ${message}`);
    }
  };

  const syncCounts = (): void => {
    let scheduledCount = 0;
    let runningCount = 0;

    for (const record of Object.values(store.resumes)) {
      if (record.status === 'running') {
        runningCount += 1;
      } else {
        scheduledCount += 1;
      }
    }

    state.scheduledCount = scheduledCount;
    state.runningCount = runningCount;
  };

  const runTick = async (
    context: {
      logger: { warn: (message: string) => void };
      paths: { root: string };
    },
  ): Promise<void> => {
    if (stopping || tickInProgress) {
      return;
    }

    tickInProgress = true;

    try {
      const tickTime = now();
      const tickMs = tickTime.getTime();
      const tickIso = tickTime.toISOString();

      state.lastTickAt = tickIso;
      state.lastError = undefined;

      const dueRecords = Object.values(store.resumes)
        .filter((record) => record.status === 'scheduled' && Date.parse(record.dueAt) <= tickMs)
        .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt));

      let changed = false;

      for (const record of dueRecords) {
        const logPath = join(context.paths.root, 'session-deferred-resume-runs', `${record.id}.log`);

        try {
          await launchSessionDeferredResume({
            id: record.id,
            sessionFile: record.sessionFile,
            cwd: record.cwd,
            profile: record.profile,
            prompt: record.prompt,
            logPath,
          });

          record.status = 'running';
          record.startedAt = tickIso;
          record.logPath = logPath;
          record.attempts += 1;
          state.launchedCount += 1;
          changed = true;
        } catch (error) {
          const message = (error as Error).message;
          state.lastError = message;
          record.dueAt = new Date(now().getTime() + retryDelaySeconds * 1000).toISOString();
          context.logger.warn(`failed to launch deferred session resume id=${record.id}: ${message}`);
          changed = true;
          break;
        }
      }

      if (changed) {
        syncCounts();
        persistState(context.logger);
      }
    } catch (error) {
      const message = (error as Error).message;
      state.lastError = message;
      context.logger.warn(`session deferred resume tick failed: ${message}`);
    } finally {
      tickInProgress = false;
    }
  };

  return {
    name: 'session-deferred-resumes',
    enabled: config.enabled,
    subscriptions: [
      'timer.session-deferred-resumes.tick',
      'session.deferred-resume.schedule',
      'session.closed',
      'pi.run.failed',
    ],
    timers: [
      {
        name: 'session-deferred-resumes-tick',
        eventType: 'timer.session-deferred-resumes.tick',
        intervalMs: tickIntervalSeconds * 1000,
      },
    ],

    async start(context): Promise<void> {
      stopping = false;
      stateFile = join(context.paths.root, 'session-deferred-resumes-state.json');
      store = loadSessionDeferredResumeState(stateFile, context.logger);
      syncCounts();
      persistState(context.logger);
      await runTick(context);
    },

    async handleEvent(event, context): Promise<void> {
      if (event.type === 'timer.session-deferred-resumes.tick') {
        await runTick(context);
        return;
      }

      if (!isRecord(event.payload)) {
        return;
      }

      if (event.type === 'session.deferred-resume.schedule') {
        const record = parseScheduleEventPayload(event.payload, createId, now().toISOString());
        if (!record) {
          context.logger.warn('ignored invalid session.deferred-resume.schedule payload');
          return;
        }

        store.resumes[record.id] = record;
        syncCounts();
        persistState(context.logger);
        return;
      }

      const deferredResumeId = toString(event.payload.deferredResumeId);
      if (!deferredResumeId) {
        return;
      }

      if (!(deferredResumeId in store.resumes)) {
        return;
      }

      delete store.resumes[deferredResumeId];

      if (event.type === 'session.closed') {
        state.completedCount += 1;
      } else if (event.type === 'pi.run.failed') {
        state.failedCount += 1;
      }

      syncCounts();
      persistState(context.logger);
    },

    async stop(context): Promise<void> {
      stopping = true;
      persistState(context.logger);
    },

    getStatus(): Record<string, unknown> {
      return {
        stateFile,
        tickIntervalSeconds,
        retryDelaySeconds,
        scheduledCount: state.scheduledCount,
        runningCount: state.runningCount,
        launchedCount: state.launchedCount,
        completedCount: state.completedCount,
        failedCount: state.failedCount,
        lastTickAt: state.lastTickAt,
        lastError: state.lastError,
      };
    },
  };
}
