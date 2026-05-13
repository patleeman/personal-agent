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

async function loadDaemon() {
  return import('@personal-agent/daemon');
}

export async function pingDaemon(...args: Parameters<(typeof import('@personal-agent/daemon'))['pingDaemon']>) {
  const daemon = await loadDaemon();
  return daemon.pingDaemon(...args);
}

export async function startScheduledTaskRun(...args: Parameters<(typeof import('@personal-agent/daemon'))['startScheduledTaskRun']>) {
  const daemon = await loadDaemon();
  return daemon.startScheduledTaskRun(...args);
}
