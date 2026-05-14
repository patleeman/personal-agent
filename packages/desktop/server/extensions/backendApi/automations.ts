export const DEFAULT_DEFERRED_RESUME_PROMPT = 'Continue when ready.';

export type LoadedScheduledTasksForProfile = { tasks: Array<Record<string, any>>; parseErrors: Array<Record<string, any>> };
export type TaskRuntimeEntry = Record<string, any>;
export type ScheduledTaskThreadInput = Record<string, any>;
export type StoredAutomation = Record<string, any>;
export type QueuedPromptPreview = Record<string, any>;

import { callDaemonExport } from './daemonBridge.js';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, any>>;

async function callModuleExport<T>(specifier: string, name: string, ...args: unknown[]): Promise<T> {
  const module = await dynamicImport(specifier);
  const fn = module[name];
  if (typeof fn !== 'function') throw new Error(`Backend API export ${name} is unavailable.`);
  return (fn as (...callArgs: unknown[]) => Promise<T> | T)(...args);
}

export async function parseFutureHumanDateTime(input: string) {
  return callModuleExport<Record<string, any>>('../../automation/humanDateTime.js', 'parseFutureHumanDateTime', input);
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

export async function scheduleDeferredResumeForSessionFile(input: unknown) {
  return callModuleExport<Record<string, any>>('../../automation/deferredResumes.js', 'scheduleDeferredResumeForSessionFile', input);
}
export async function cancelDeferredResumeForSessionFile(input: unknown) {
  return callModuleExport<Record<string, any>>('../../automation/deferredResumes.js', 'cancelDeferredResumeForSessionFile', input);
}
export async function listDeferredResumesForSessionFile(input: unknown) {
  return callModuleExport<Array<Record<string, any>>>('../../automation/deferredResumes.js', 'listDeferredResumesForSessionFile', input);
}
export async function loadScheduledTasksForProfile(profile: string): Promise<LoadedScheduledTasksForProfile> {
  return callModuleExport<LoadedScheduledTasksForProfile>('../../automation/scheduledTasks.js', 'loadScheduledTasksForProfile', profile);
}
export async function resolveScheduledTaskForProfile(profile: string, taskId: string) {
  return callModuleExport<{ task: Record<string, any>; runtime?: Record<string, any> }>(
    '../../automation/scheduledTasks.js',
    'resolveScheduledTaskForProfile',
    profile,
    taskId,
  );
}
export async function validateScheduledTaskDefinition(input: unknown) {
  return callModuleExport<Record<string, any>>('../../automation/scheduledTasks.js', 'validateScheduledTaskDefinition', input);
}
export function toScheduledTaskMetadata(input: unknown) {
  return input;
}
export async function resolveScheduledTaskThreadBinding(input: unknown) {
  return callModuleExport<Record<string, any>>('../../automation/scheduledTaskThreads.js', 'resolveScheduledTaskThreadBinding', input);
}
export async function applyScheduledTaskThreadBinding(taskId: string, input: unknown) {
  return callModuleExport<Record<string, any>>(
    '../../automation/scheduledTaskThreads.js',
    'applyScheduledTaskThreadBinding',
    taskId,
    input,
  );
}
export async function buildScheduledTaskThreadDetail(task: unknown) {
  return callModuleExport<Record<string, any>>('../../automation/scheduledTaskThreads.js', 'buildScheduledTaskThreadDetail', task);
}
export async function createStoredAutomation(input: unknown) {
  return callModuleExport<Record<string, any>>('../../automation/store.js', 'createStoredAutomation', input);
}
export async function updateStoredAutomation(taskId: string, input: unknown) {
  return callModuleExport<Record<string, any>>('../../automation/store.js', 'updateStoredAutomation', taskId, input);
}
export async function deleteStoredAutomation(taskId: string, input?: unknown) {
  return callModuleExport<void>('../../automation/store.js', 'deleteStoredAutomation', taskId, input);
}
export async function listStoredAutomations() {
  return callModuleExport<Array<Record<string, any>>>('../../automation/store.js', 'listStoredAutomations');
}
export async function loadAutomationRuntimeStateMap() {
  return callModuleExport<Map<string, any>>('../../automation/store.js', 'loadAutomationRuntimeStateMap');
}
export function normalizeAutomationTargetTypeForSelection(value: unknown) {
  return value === 'conversation' ? 'conversation' : 'background-agent';
}
export async function listQueuedPromptPreviews(sessionId: string) {
  return callModuleExport<Array<Record<string, any>>>('../../conversations/liveSessions.js', 'listQueuedPromptPreviews', sessionId);
}
export async function cancelQueuedPrompt(sessionId: string, behavior: string, previewId: string) {
  return callModuleExport<boolean>('../../conversations/liveSessions.js', 'cancelQueuedPrompt', sessionId, behavior, previewId);
}
export async function promptSession(sessionId: string, prompt: string, behavior: string) {
  return callModuleExport<void>('../../conversations/liveSessions.js', 'promptSession', sessionId, prompt, behavior);
}
export async function invalidateAppTopics(topics: string | string[]): Promise<void> {
  try {
    await callModuleExport<void>('../../shared/appEvents.js', 'invalidateAppTopics', topics);
  } catch {
    // Invalidation is best-effort for extension backend bundles.
  }
}
export async function getSessionDeferredResumeEntries(state: unknown, sessionFile: string) {
  return callModuleExport<Array<Record<string, any>>>('@personal-agent/core', 'getSessionDeferredResumeEntries', state, sessionFile);
}
export async function loadDeferredResumeState() {
  return callModuleExport<Record<string, any>>('@personal-agent/core', 'loadDeferredResumeState');
}
export async function readSessionConversationId(sessionFile: string) {
  return callModuleExport<string | undefined>('@personal-agent/core', 'readSessionConversationId', sessionFile);
}
export async function getTaskCallbackBinding(input: unknown) {
  return callModuleExport<Record<string, any> | undefined>('@personal-agent/core', 'getTaskCallbackBinding', input);
}
export async function setTaskCallbackBinding(input: unknown) {
  return callModuleExport<void>('@personal-agent/core', 'setTaskCallbackBinding', input);
}
export async function clearTaskCallbackBinding(input: unknown) {
  return callModuleExport<void>('@personal-agent/core', 'clearTaskCallbackBinding', input);
}
export async function pingDaemon(): Promise<boolean> {
  try {
    return await callDaemonExport<boolean>('pingDaemon');
  } catch {
    return false;
  }
}
export async function startScheduledTaskRun(input: unknown) {
  return callDaemonExport<Record<string, any>>('startScheduledTaskRun', input);
}
