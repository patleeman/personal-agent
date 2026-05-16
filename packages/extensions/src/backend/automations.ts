import type { ExtensionBackendContext } from '../index';

export type { ExtensionBackendContext };

function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/automations must be resolved by the Personal Agent host runtime.');
}

export const DEFAULT_DEFERRED_RESUME_PROMPT = '';
export type LoadedScheduledTasksForProfile = unknown;
export type TaskRuntimeEntry = unknown;
export type ScheduledTaskThreadInput = unknown;
export type QueuedPromptPreview = unknown;
export type StoredAutomation = unknown;
export type DeferredResumeSummary = unknown;

export const cancelDeferredResumeForSessionFile = (..._args: unknown[]): unknown => hostResolved();
export const listDeferredResumesForSessionFile = (..._args: unknown[]): unknown => hostResolved();
export const scheduleDeferredResumeForSessionFile = (..._args: unknown[]): unknown => hostResolved();
export const parseFutureHumanDateTime = (..._args: unknown[]): unknown => hostResolved();
export const loadScheduledTasksForProfile = (..._args: unknown[]): unknown => hostResolved();
export const resolveScheduledTaskForProfile = (..._args: unknown[]): unknown => hostResolved();
export const toScheduledTaskMetadata = (..._args: unknown[]): unknown => hostResolved();
export const validateScheduledTaskDefinition = (..._args: unknown[]): unknown => hostResolved();
export const applyScheduledTaskThreadBinding = (..._args: unknown[]): unknown => hostResolved();
export const buildScheduledTaskThreadDetail = (..._args: unknown[]): unknown => hostResolved();
export const resolveScheduledTaskThreadBinding = (..._args: unknown[]): unknown => hostResolved();
export const cancelQueuedPrompt = (..._args: unknown[]): unknown => hostResolved();
export const listQueuedPromptPreviews = (..._args: unknown[]): unknown => hostResolved();
export const promptSession = (..._args: unknown[]): unknown => hostResolved();
export const invalidateAppTopics = (..._args: unknown[]): unknown => hostResolved();
export const clearTaskCallbackBinding = (..._args: unknown[]): unknown => hostResolved();
export const getSessionDeferredResumeEntries = (..._args: unknown[]): unknown => hostResolved();
export const getTaskCallbackBinding = (..._args: unknown[]): unknown => hostResolved();
export const loadDeferredResumeState = (..._args: unknown[]): unknown => hostResolved();
export const parseDeferredResumeDelayMs = (..._args: unknown[]): unknown => hostResolved();
export const readSessionConversationId = (..._args: unknown[]): unknown => hostResolved();
export const setTaskCallbackBinding = (..._args: unknown[]): unknown => hostResolved();
export const createStoredAutomation = (..._args: unknown[]): unknown => hostResolved();
export const deleteStoredAutomation = (..._args: unknown[]): unknown => hostResolved();
export const listStoredAutomations = (..._args: unknown[]): unknown => hostResolved();
export const loadAutomationRuntimeStateMap = (..._args: unknown[]): unknown => hostResolved();
export const normalizeAutomationTargetTypeForSelection = (..._args: unknown[]): unknown => hostResolved();
export const pingDaemon = (..._args: unknown[]): unknown => hostResolved();
export const startScheduledTaskRun = (..._args: unknown[]): unknown => hostResolved();
export const updateStoredAutomation = (..._args: unknown[]): unknown => hostResolved();
