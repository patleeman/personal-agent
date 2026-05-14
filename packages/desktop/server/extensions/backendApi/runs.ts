import { existsSync, readFileSync, statSync } from 'node:fs';

import { invalidateAppTopics } from '../../shared/appEvents.js';
import { callDaemonExport } from './daemonBridge.js';

export { invalidateAppTopics };

export interface ScheduledTaskThreadInput {
  threadMode?: string | null;
  threadConversationId?: string | null;
  threadSessionFile?: string | null;
}

export async function pingDaemon(): Promise<boolean> {
  try {
    return await callDaemonExport<boolean>('pingDaemon');
  } catch {
    return false;
  }
}

export async function startBackgroundRun(input: unknown) {
  return callDaemonExport<Record<string, unknown>>('startBackgroundRun', input);
}

export async function listDurableRuns() {
  return callDaemonExport<{ runs: Array<Record<string, unknown>>; summary: { total: number } }>('listDurableRuns');
}

export async function getDurableRun(runId: string) {
  try {
    return await callDaemonExport<{ run: Record<string, unknown> }>('getDurableRun', runId);
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('run not found')) return undefined;
    throw error;
  }
}

export async function cancelDurableRun(runId: string) {
  return callDaemonExport<Record<string, unknown>>('cancelDurableRun', runId);
}

export async function rerunDurableRun(runId: string) {
  return callDaemonExport<Record<string, unknown>>('rerunDurableRun', runId);
}

export async function followUpDurableRun(runId: string, prompt?: string) {
  return callDaemonExport<Record<string, unknown>>('followUpDurableRun', runId, prompt);
}

function readTailText(filePath: string | undefined, maxLines = 120, maxBytes = 64 * 1024): string {
  if (!filePath || !existsSync(filePath)) return '';
  try {
    const size = statSync(filePath).size;
    const start = Math.max(0, size - maxBytes);
    return readFileSync(filePath, 'utf-8').slice(start).split(/\r?\n/).slice(-maxLines).join('\n').trim();
  } catch {
    return '';
  }
}

export async function getDurableRunLog(runId: string, tail = 120): Promise<{ path: string; log: string } | undefined> {
  const detail = await getDurableRun(runId);
  const run = detail?.run as { paths?: { outputLogPath?: string } } | undefined;
  const path = run?.paths?.outputLogPath;
  if (!path) return undefined;
  return { path, log: readTailText(path, tail) };
}

export function parseDeferredResumeDelayMs(value: string): number | undefined {
  const input = value.trim().toLowerCase();
  const match = input.match(
    /^(?:now\s*\+\s*)?(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/,
  );
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const unit = match[2];
  if (unit.startsWith('s')) return amount * 1000;
  if (unit.startsWith('m')) return amount * 60 * 1000;
  if (unit.startsWith('h')) return amount * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}

export async function createStoredAutomation(input: unknown) {
  return callDaemonExport<Record<string, unknown>>('createStoredAutomation', input);
}

export async function applyScheduledTaskThreadBinding(
  taskId: string,
  input: ScheduledTaskThreadInput & { cwd?: string | null; dbPath?: string },
) {
  const mode = input.threadMode === 'existing' || input.threadMode === 'none' ? input.threadMode : 'dedicated';
  const updated = await callDaemonExport<Record<string, unknown>>('setStoredAutomationThreadBinding', taskId, {
    dbPath: input.dbPath,
    mode,
    conversationId: mode === 'existing' ? input.threadConversationId : undefined,
    sessionFile: mode === 'existing' ? input.threadSessionFile : undefined,
  });
  if (mode === 'none') return updated;
  return callDaemonExport<Record<string, unknown>>('ensureAutomationThread', taskId, { dbPath: input.dbPath });
}

export async function setTaskCallbackBinding(input: unknown) {
  return callDaemonExport<void>('setTaskCallbackBinding', input);
}
