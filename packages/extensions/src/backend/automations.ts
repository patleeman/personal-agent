import type { ExtensionBackendContext } from '../index';

export type { ExtensionBackendContext };

function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/automations must be resolved by the Personal Agent host runtime.');
}

export const DEFAULT_DEFERRED_RESUME_PROMPT = '';
export type LoadedScheduledTasksForProfile = any;
export type TaskRuntimeEntry = any;
export type ScheduledTaskThreadInput = any;
export type QueuedPromptPreview = any;
export type StoredAutomation = any;
export type DeferredResumeSummary = any;

export const cancelDeferredResumeForSessionFile = (..._args: any[]): any => hostResolved();
export const listDeferredResumesForSessionFile = (..._args: any[]): any => hostResolved();
export const scheduleDeferredResumeForSessionFile = (..._args: any[]): any => hostResolved();
export const parseFutureHumanDateTime = (..._args: any[]): any => hostResolved();
export const loadScheduledTasksForProfile = (..._args: any[]): any => hostResolved();
export const resolveScheduledTaskForProfile = (..._args: any[]): any => hostResolved();
export const toScheduledTaskMetadata = (..._args: any[]): any => hostResolved();
export const validateScheduledTaskDefinition = (..._args: any[]): any => hostResolved();
export const applyScheduledTaskThreadBinding = (..._args: any[]): any => hostResolved();
export const buildScheduledTaskThreadDetail = (..._args: any[]): any => hostResolved();
export const resolveScheduledTaskThreadBinding = (..._args: any[]): any => hostResolved();
export const cancelQueuedPrompt = (..._args: any[]): any => hostResolved();
export const listQueuedPromptPreviews = (..._args: any[]): any => hostResolved();
export const promptSession = (..._args: any[]): any => hostResolved();
export const invalidateAppTopics = (..._args: any[]): any => hostResolved();
export const persistAppTelemetryEvent = (..._args: any[]): any => hostResolved();
export const clearTaskCallbackBinding = (..._args: any[]): any => hostResolved();
export const getSessionDeferredResumeEntries = (..._args: any[]): any => hostResolved();
export const getTaskCallbackBinding = (..._args: any[]): any => hostResolved();
export const loadDeferredResumeState = (..._args: any[]): any => hostResolved();
export const parseDeferredResumeDelayMs = (..._args: any[]): any => hostResolved();
export const readSessionConversationId = (..._args: any[]): any => hostResolved();
export const setTaskCallbackBinding = (..._args: any[]): any => hostResolved();
export const createStoredAutomation = (..._args: any[]): any => hostResolved();
export const deleteStoredAutomation = (..._args: any[]): any => hostResolved();
export const listStoredAutomations = (..._args: any[]): any => hostResolved();
export const loadAutomationRuntimeStateMap = (..._args: any[]): any => hostResolved();
export const normalizeAutomationTargetTypeForSelection = (..._args: any[]): any => hostResolved();
export const pingDaemon = (..._args: any[]): any => hostResolved();
export const startScheduledTaskRun = (..._args: any[]): any => hostResolved();
export const updateStoredAutomation = (..._args: any[]): any => hostResolved();
