#!/usr/bin/env node

import { resolve } from 'path';
import { fileURLToPath } from 'url';

import { runDaemonProcess } from './server.js';

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
} from './automation-store.js';
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
  saveAutomationRuntimeStateMap,
  saveAutomationSchedulerState,
  setStoredAutomationThreadBinding,
  updateStoredAutomation,
} from './automation-store.js';
export { normalizeAutomationTargetTypeForSelection } from './automation-store.js';
export { ensureAutomationThread, normalizeAutomationThreadModeForSelection, resolveAutomationThreadTitle } from './automation-threads.js';
export { type BackgroundRunAgentSpec, buildBackgroundAgentArgv, looksLikePersonalAgentCliEntryPath } from './background-run-agent.js';
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
  setDaemonPowerKeepAwake,
  startBackgroundRun,
  startScheduledTaskRun,
  stopDaemon,
  syncWebLiveConversationRunState,
} from './client.js';
export {
  type CompanionDeviceAdminState,
  createCompanionPairingCode,
  pairCompanionDevice,
  readCompanionDeviceAdminState,
  readCompanionDeviceByToken,
  resolveCompanionAuthStateFile,
  revokeCompanionDevice,
  updateCompanionDeviceLabel,
} from './companion/auth-store.js';
export {
  readCompanionHostState,
  resolveCompanionHostStateFile,
  updateCompanionHostLabel,
  writeCompanionHostState,
} from './companion/host-state.js';
export { getCompanionRuntimeProvider, resolveCompanionRuntime, setCompanionRuntimeProvider } from './companion/runtime.js';
export { DaemonCompanionServer } from './companion/server.js';
export type {
  CompanionAttachmentAssetInput,
  CompanionAttachmentCreateInput,
  CompanionAttachmentUpdateInput,
  CompanionBinaryAsset,
  CompanionClientSocketMessage,
  CompanionCommandMessage,
  CompanionConversationAbortInput,
  CompanionConversationBlockImageInput,
  CompanionConversationBootstrapInput,
  CompanionConversationCheckpointCreateInput,
  CompanionConversationCreateInput,
  CompanionConversationCwdChangeInput,
  CompanionConversationDuplicateInput,
  CompanionConversationExecutionTargetChangeInput,
  CompanionConversationModelPreferencesUpdateInput,
  CompanionConversationParallelJobInput,
  CompanionConversationPromptInput,
  CompanionConversationQueueRestoreInput,
  CompanionConversationRenameInput,
  CompanionConversationResumeInput,
  CompanionConversationSubscriptionInput,
  CompanionConversationTabsUpdateInput,
  CompanionConversationTakeoverInput,
  CompanionDeviceTokenResult,
  CompanionDurableRunLogInput,
  CompanionHostHello,
  CompanionKnowledgeImageAssetInput,
  CompanionKnowledgeImportInput,
  CompanionKnowledgeRenameInput,
  CompanionKnowledgeSearchInput,
  CompanionPairedDeviceSummary,
  CompanionPairingCode,
  CompanionReadyEvent,
  CompanionRemoteDirectoryInput,
  CompanionRuntime,
  CompanionRuntimeProvider,
  CompanionScheduledTaskInput,
  CompanionScheduledTaskUpdateInput,
  CompanionServerSocketMessage,
  CompanionSocketErrorResponse,
  CompanionSocketEventEnvelope,
  CompanionSocketSuccessResponse,
  CompanionSshTargetSaveInput,
  CompanionSshTargetTestInput,
  CompanionSubscribeMessage,
  CompanionSurfaceType,
  CompanionUnsubscribeMessage,
} from './companion/types.js';
export { COMPANION_API_ROOT, COMPANION_PROTOCOL_VERSION, COMPANION_SOCKET_PATH } from './companion/types.js';
export { type DaemonConfig, getDaemonConfigFilePath, getDefaultDaemonConfig, loadDaemonConfig, writeDaemonPowerConfig } from './config.js';
export { buildDeferredResumeActivityId, buildDeferredResumeAlertId, surfaceReadyDeferredResume } from './conversation-wakeups.js';
export { createDaemonEvent, DAEMON_EVENT_VERSION, isDaemonEvent } from './events.js';
export {
  bindInProcessDaemonClient,
  clearDaemonClientTransportOverride,
  createInProcessDaemonClient,
  type DaemonClientTransport,
  getDaemonClientTransportOverride,
  setDaemonClientTransportOverride,
} from './in-process-client.js';
export type { ParsedTaskDefinition } from './modules/tasks-parser.js';
export { parseTaskDefinition } from './modules/tasks-parser.js';
export { resolveDaemonPaths } from './paths.js';
export { DaemonPowerController } from './power.js';
export {
  type BackgroundRunResultSummary,
  listPendingBackgroundRunResults,
  markBackgroundRunResultsDelivered,
  surfaceBackgroundRunResultsIfReady,
} from './runs/background-run-deferred-resumes.js';
export {
  createBackgroundRunId,
  createBackgroundRunRecord,
  finalizeBackgroundRun,
  markBackgroundRunInterrupted,
  markBackgroundRunStarted,
  type StartBackgroundRunInput,
  type StartBackgroundRunRecord,
} from './runs/background-runs.js';
export {
  cancelDeferredResumeConversationRun,
  completeDeferredResumeConversationRun,
  createDeferredResumeConversationRunId,
  markDeferredResumeConversationRunReady,
  markDeferredResumeConversationRunRetryScheduled,
  markDeferredResumeConversationRunSnoozed,
  scheduleDeferredResumeConversationRun,
} from './runs/deferred-resume-conversations.js';
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
} from './runs/store.js';
export {
  appendDurableRunEvent,
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
} from './runs/store.js';
export type {
  RecoverableWebLiveConversationRun,
  WebLiveConversationPendingOperation,
  WebLiveConversationPreludeMessage,
  WebLiveConversationPromptImage,
  WebLiveConversationRunState,
} from './runs/web-live-conversations.js';
export {
  createWebLiveConversationRunId,
  listRecoverableWebLiveConversationRuns,
  parsePendingOperation,
  saveWebLiveConversationRunState,
} from './runs/web-live-conversations.js';
export { type DaemonStopRequestBehavior, PersonalAgentDaemon, type PersonalAgentDaemonOptions } from './server.js';
export {
  readTailscaleServeProxyState,
  resolveCompanionTailscaleUrl,
  resolveTailscaleServeBaseUrl,
  syncCompanionTailscaleServe,
  type SyncCompanionTailscaleServeInput,
  syncTailscaleServeProxy,
  type SyncTailscaleServeProxyInput,
  type TailscaleServeProxyState,
  type TailscaleServeProxyStatus,
} from './tailscale-serve.js';
export type {
  CancelDurableRunResult,
  DaemonEvent,
  DaemonEventInput,
  DaemonModuleStatus,
  DaemonPowerStatus,
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
