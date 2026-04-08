#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { runDaemonProcess } from './server.js';

export { PersonalAgentDaemon } from './server.js';
export { createDaemonEvent, isDaemonEvent, DAEMON_EVENT_VERSION } from './events.js';
export { loadDaemonConfig, getDefaultDaemonConfig, getDaemonConfigFilePath, type DaemonConfig } from './config.js';
export { resolveDaemonPaths } from './paths.js';
export {
  getDaemonStatus,
  pingDaemon,
  stopDaemon,
  listDurableRuns,
  getDurableRun,
  startScheduledTaskRun,
  startBackgroundRun,
  cancelDurableRun,
  rerunDurableRun,
  followUpDurableRun,
  syncWebLiveConversationRunState,
  listRecoverableWebLiveConversationRunsFromDaemon,
  emitDaemonEvent,
  emitDaemonEventNonFatal,
} from './client.js';
export { startDaemonDetached, stopDaemonGracefully, daemonStatusJson, readDaemonPid } from './manage.js';
export {
  resolveDurableRunsRoot,
  resolveDurableRunPaths,
  createDurableRunManifest,
  createInitialDurableRunStatus,
  saveDurableRunManifest,
  saveDurableRunStatus,
  saveDurableRunCheckpoint,
  appendDurableRunEvent,
  loadDurableRunManifest,
  loadDurableRunStatus,
  loadDurableRunCheckpoint,
  readDurableRunEvents,
  listDurableRunIds,
  scanDurableRun,
  scanDurableRunsForRecovery,
  summarizeScannedDurableRuns,
} from './runs/store.js';
export {
  createDeferredResumeConversationRunId,
  scheduleDeferredResumeConversationRun,
  markDeferredResumeConversationRunReady,
  markDeferredResumeConversationRunRetryScheduled,
  markDeferredResumeConversationRunSnoozed,
  completeDeferredResumeConversationRun,
  cancelDeferredResumeConversationRun,
} from './runs/deferred-resume-conversations.js';
export {
  createBackgroundRunId,
  createBackgroundRunRecord,
  markBackgroundRunStarted,
  finalizeBackgroundRun,
  markBackgroundRunInterrupted,
  type StartBackgroundRunInput,
  type StartBackgroundRunRecord,
} from './runs/background-runs.js';
export {
  listPendingBackgroundRunResults,
  markBackgroundRunResultsDelivered,
  surfaceBackgroundRunResultsIfReady,
  type BackgroundRunResultSummary,
} from './runs/background-run-deferred-resumes.js';
export {
  buildBackgroundAgentArgv,
  looksLikePersonalAgentCliEntryPath,
  type BackgroundRunAgentSpec,
} from './background-run-agent.js';
export {
  createWebLiveConversationRunId,
  saveWebLiveConversationRunState,
  listRecoverableWebLiveConversationRuns,
  parsePendingOperation,
} from './runs/web-live-conversations.js';
export type {
  RecoverableWebLiveConversationRun,
  WebLiveConversationPendingOperation,
  WebLiveConversationPreludeMessage,
  WebLiveConversationPromptImage,
  WebLiveConversationRunState,
} from './runs/web-live-conversations.js';
export type {
  DurableRunKind,
  DurableRunStatus,
  DurableRunResumePolicy,
  DurableRunRecoveryAction,
  DurableRunManifest,
  DurableRunStatusFile,
  DurableRunCheckpointFile,
  DurableRunEvent,
  DurableRunPaths,
  ScannedDurableRun,
  ScannedDurableRunsSummary,
} from './runs/store.js';
export {
  getAutomationDbPath,
  listStoredAutomations,
  getStoredAutomation,
  createStoredAutomation,
  updateStoredAutomation,
  deleteStoredAutomation,
  loadAutomationRuntimeStateMap,
  loadAutomationSchedulerState,
  saveAutomationRuntimeStateMap,
  saveAutomationSchedulerState,
  ensureLegacyTaskImports,
} from './automation-store.js';
export { parseTaskDefinition } from './modules/tasks-parser.js';
export {
  surfaceReadyDeferredResume,
  buildDeferredResumeActivityId,
  buildDeferredResumeAlertId,
} from './conversation-wakeups.js';
export type { StoredAutomation, LegacyAutomationImportIssue, AutomationMutationInput, AutomationSchedulerState } from './automation-store.js';
export type { ParsedTaskDefinition } from './modules/tasks-parser.js';
export type {
  DaemonEvent,
  DaemonEventInput,
  DaemonStatus,
  DaemonModuleStatus,
  ListDurableRunsResult,
  GetDurableRunResult,
  StartScheduledTaskRunResult,
  StartBackgroundRunRequestInput,
  StartBackgroundRunResult,
  CancelDurableRunResult,
  ReplayDurableRunResult,
  FollowUpDurableRunResult,
  SyncWebLiveConversationRunRequestInput,
  SyncWebLiveConversationRunResult,
  ListRecoverableWebLiveConversationRunsResult,
} from './types.js';

export async function runDaemonCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('personal-agentd\n\nRuns the personal-agent daemon in the foreground.');
    return 0;
  }

  await runDaemonProcess();
  return 0;
}

const entryFile = process.argv[1] ? resolve(process.argv[1]) : undefined;
const moduleFile = resolve(fileURLToPath(import.meta.url));

if (entryFile === moduleFile) {
  runDaemonCli().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
