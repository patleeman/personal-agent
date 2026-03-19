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
  pullGatewayNotifications,
  listDurableRuns,
  getDurableRun,
  startScheduledTaskRun,
  startBackgroundRun,
  cancelDurableRun,
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
  completeDeferredResumeConversationRun,
  cancelDeferredResumeConversationRun,
} from './runs/deferred-resume-conversations.js';
export {
  createBackgroundRunId,
  createBackgroundRunRecord,
  markBackgroundRunStarted,
  finalizeBackgroundRun,
  markBackgroundRunInterrupted,
  type BackgroundRunNotificationMode,
  type BackgroundRunNotificationSpec,
  type StartBackgroundRunInput,
  type StartBackgroundRunRecord,
} from './runs/background-runs.js';
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
export { parseTaskDefinition } from './modules/tasks-parser.js';
export type { ParsedTaskDefinition } from './modules/tasks-parser.js';
export type {
  DaemonEvent,
  DaemonEventInput,
  DaemonStatus,
  DaemonModuleStatus,
  GatewayNotification,
  GatewayNotificationProvider,
  ListDurableRunsResult,
  GetDurableRunResult,
  StartScheduledTaskRunResult,
  StartBackgroundRunRequestInput,
  StartBackgroundRunResult,
  CancelDurableRunResult,
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
