// Barrel file for @personal-agent/daemon
// Source files have been moved to their natural homes within the desktop server.
// The tsconfig path mapping (@personal-agent/daemon → ./packages/desktop/server/daemon)
// means consumers can keep importing from '@personal-agent/daemon' and this barrel
// re-exports from the new locations.

// Config / paths — now at packages/desktop/server/
export { type DaemonConfig, getDaemonConfigFilePath, getDefaultDaemonConfig, loadDaemonConfig } from '../config.js';
export { resolveDaemonPaths } from '../paths.js';

// Automation — now at packages/desktop/server/automation/
export type {
  AutomationActivityEntry,
  AutomationActivityKind,
  AutomationActivityOutcome,
  AutomationConversationBehavior,
  AutomationMutationInput,
  AutomationSchedulerState,
  AutomationTargetType,
  AutomationThreadMode,
  LegacyAutomationImportIssue,
  StoredAutomation,
} from '../automation/store.js';
export {
  appendAutomationActivityEntry,
  closeAutomationDbs,
  createStoredAutomation,
  deleteStoredAutomation,
  ensureLegacyTaskImports,
  getAutomationDbPath,
  getStoredAutomation,
  listAutomationActivityEntries,
  listStoredAutomations,
  loadAutomationRuntimeStateMap,
  loadAutomationSchedulerState,
  normalizeAutomationTargetTypeForSelection,
  saveAutomationRuntimeStateMap,
  saveAutomationSchedulerState,
  setStoredAutomationThreadBinding,
  updateStoredAutomation,
} from '../automation/store.js';
export { ensureAutomationThread, normalizeAutomationThreadModeForSelection, resolveAutomationThreadTitle } from '../automation/threads.js';

// Tasks (previously daemon/modules/) — now at packages/desktop/server/automation/tasks/
export type { ParsedTaskDefinition } from '../automation/tasks/tasks-parser.js';
export { parseTaskDefinition } from '../automation/tasks/tasks-parser.js';

// Runs — now at packages/desktop/server/runs/
export {
  type BackgroundRunResultSummary,
  listPendingBackgroundRunResults,
  markBackgroundRunResultsDelivered,
  surfaceBackgroundRunResultsIfReady,
} from '../runs/background-run-deferred-resumes.js';
export {
  createBackgroundRunId,
  createBackgroundRunRecord,
  finalizeBackgroundRun,
  markBackgroundRunInterrupted,
  markBackgroundRunStarted,
  type StartBackgroundRunInput,
  type StartBackgroundRunRecord,
} from '../runs/background-runs.js';
export {
  cancelDeferredResumeConversationRun,
  completeDeferredResumeConversationRun,
  createDeferredResumeConversationRunId,
  markDeferredResumeConversationRunReady,
  markDeferredResumeConversationRunRetryScheduled,
  markDeferredResumeConversationRunSnoozed,
  scheduleDeferredResumeConversationRun,
} from '../runs/deferred-resume-conversations.js';
export type {
  DurableRunCheckpointFile,
  DurableRunEvent,
  DurableRunKind,
  DurableRunManifest,
  DurableRunPaths,
  DurableRunRecoveryAction,
  DurableRunResumePolicy,
  DurableRunStatus,
  DurableRunStatusFile,
  ScannedDurableRun,
  ScannedDurableRunsSummary,
} from '../runs/store.js';
export {
  appendDurableRunEvent,
  closeRuntimeDbs,
  createDurableRunManifest,
  createInitialDurableRunStatus,
  listDurableRunIds,
  loadDurableRunCheckpoint,
  loadDurableRunManifest,
  loadDurableRunStatus,
  readDurableRunEvents,
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
  saveDurableRunCheckpoint,
  saveDurableRunManifest,
  saveDurableRunStatus,
  scanDurableRun,
  scanDurableRunsForRecovery,
  summarizeScannedDurableRuns,
} from '../runs/store.js';
export type {
  RecoverableWebLiveConversationRun,
  WebLiveConversationPendingOperation,
  WebLiveConversationPreludeMessage,
  WebLiveConversationPromptImage,
  WebLiveConversationRunState,
} from '../runs/web-live-conversations.js';
export {
  createWebLiveConversationRunId,
  listRecoverableWebLiveConversationRuns,
  parsePendingOperation,
  saveWebLiveConversationRunState,
} from '../runs/web-live-conversations.js';

// Still in daemon/ (process infrastructure that hasn't been moved)
export {
  type BackgroundRunAgentSpec,
  buildBackgroundAgentArgv,
  looksLikePersonalAgentCliEntryPath,
} from '../daemon/background-run-agent.js';
export {
  cancelDurableRun,
  emitDaemonEvent,
  emitDaemonEventNonFatal,
  followUpDurableRun,
  getDaemonStatus,
  getDurableRun,
  listDurableRuns,
  listRecoverableWebLiveConversationRunsFromDaemon,
  pingDaemon,
  rerunDurableRun,
  startBackgroundRun,
  startScheduledTaskRun,
  stopDaemon,
  syncWebLiveConversationRunState,
} from '../daemon/client.js';
export { getCompanionRuntimeProvider, resolveCompanionRuntime, setCompanionRuntimeProvider } from '../daemon/companion/runtime.js';
export * from '../daemon/companion/types.js';
export { surfaceReadyDeferredResume } from '../daemon/conversation-wakeups.js';
export {
  bindInProcessDaemonClient,
  clearDaemonClientTransportOverride,
  createInProcessDaemonClient,
  type DaemonClientTransport,
  getDaemonClientTransportOverride,
  setDaemonClientTransportOverride,
} from '../daemon/in-process-client.js';
export { type DaemonStopRequestBehavior, PersonalAgentDaemon, type PersonalAgentDaemonOptions } from '../daemon/server.js';
export type {
  CancelDurableRunResult,
  DaemonEvent,
  DaemonEventInput,
  DaemonModuleStatus,
  DaemonStatus,
  FollowUpDurableRunResult,
  GetDurableRunResult,
  ListDurableRunsResult,
  ListRecoverableWebLiveConversationRunsResult,
  ReplayDurableRunResult,
  StartBackgroundRunRequestInput,
  StartBackgroundRunResult,
  StartScheduledTaskRunResult,
  SyncWebLiveConversationRunRequestInput,
  SyncWebLiveConversationRunResult,
} from '../daemon/types.js';
