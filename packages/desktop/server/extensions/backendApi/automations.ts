export {
  cancelDeferredResumeForSessionFile,
  DEFAULT_DEFERRED_RESUME_PROMPT,
  listDeferredResumesForSessionFile,
  scheduleDeferredResumeForSessionFile,
} from '../../automation/deferredResumes.js';
export { parseFutureHumanDateTime } from '../../automation/humanDateTime.js';
export {
  type LoadedScheduledTasksForProfile,
  loadScheduledTasksForProfile,
  resolveScheduledTaskForProfile,
  type TaskRuntimeEntry,
  toScheduledTaskMetadata,
  validateScheduledTaskDefinition,
} from '../../automation/scheduledTasks.js';
export {
  applyScheduledTaskThreadBinding,
  buildScheduledTaskThreadDetail,
  resolveScheduledTaskThreadBinding,
  type ScheduledTaskThreadInput,
} from '../../automation/scheduledTaskThreads.js';
export {
  createStoredAutomation,
  deleteStoredAutomation,
  listStoredAutomations,
  loadAutomationRuntimeStateMap,
  normalizeAutomationTargetTypeForSelection,
  type StoredAutomation,
  updateStoredAutomation,
} from '../../automation/store.js';
export { cancelQueuedPrompt, listQueuedPromptPreviews, promptSession, type QueuedPromptPreview } from '../../conversations/liveSessions.js';
export { invalidateAppTopics } from '../../shared/appEvents.js';
export {
  clearTaskCallbackBinding,
  getSessionDeferredResumeEntries,
  getTaskCallbackBinding,
  loadDeferredResumeState,
  parseDeferredResumeDelayMs,
  readSessionConversationId,
  setTaskCallbackBinding,
} from '@personal-agent/core';

import { callDaemonExport } from './daemonBridge.js';

export async function pingDaemon(): Promise<boolean> {
  try {
    return await callDaemonExport<boolean>('pingDaemon');
  } catch {
    return false;
  }
}

export async function startScheduledTaskRun(input: unknown) {
  return callDaemonExport<Record<string, unknown>>('startScheduledTaskRun', input);
}
