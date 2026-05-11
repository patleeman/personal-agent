#!/usr/bin/env node
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { runDaemonProcess } from './server.js';
export { appendAutomationActivityEntry, closeAutomationDbs, createStoredAutomation, deleteStoredAutomation, ensureLegacyTaskImports, getAutomationDbPath, getStoredAutomation, listAutomationActivityEntries, listStoredAutomations, loadAutomationRuntimeStateMap, loadAutomationSchedulerState, saveAutomationRuntimeStateMap, saveAutomationSchedulerState, setStoredAutomationThreadBinding, updateStoredAutomation, } from './automation-store.js';
export { normalizeAutomationTargetTypeForSelection } from './automation-store.js';
export { ensureAutomationThread, normalizeAutomationThreadModeForSelection, resolveAutomationThreadTitle } from './automation-threads.js';
export { buildBackgroundAgentArgv, looksLikePersonalAgentCliEntryPath } from './background-run-agent.js';
export { cancelDurableRun, emitDaemonEvent, emitDaemonEventNonFatal, followUpDurableRun, getDaemonStatus, getDurableRun, listDurableRuns, listRecoverableWebLiveConversationRunsFromDaemon, pingDaemon, rerunDurableRun, startBackgroundRun, startScheduledTaskRun, stopDaemon, syncWebLiveConversationRunState, } from './client.js';
export { getCompanionRuntimeProvider, resolveCompanionRuntime, setCompanionRuntimeProvider } from './companion/runtime.js';
export { getDaemonConfigFilePath, getDefaultDaemonConfig, loadDaemonConfig } from './config.js';
export { buildDeferredResumeActivityId, buildDeferredResumeAlertId, surfaceReadyDeferredResume } from './conversation-wakeups.js';
export { createDaemonEvent, DAEMON_EVENT_VERSION, isDaemonEvent } from './events.js';
export { bindInProcessDaemonClient, clearDaemonClientTransportOverride, createInProcessDaemonClient, getDaemonClientTransportOverride, setDaemonClientTransportOverride, } from './in-process-client.js';
export { parseTaskDefinition } from './modules/tasks-parser.js';
export { resolveDaemonPaths } from './paths.js';
export { listPendingBackgroundRunResults, markBackgroundRunResultsDelivered, surfaceBackgroundRunResultsIfReady, } from './runs/background-run-deferred-resumes.js';
export { createBackgroundRunId, createBackgroundRunRecord, finalizeBackgroundRun, markBackgroundRunInterrupted, markBackgroundRunStarted, } from './runs/background-runs.js';
export { cancelDeferredResumeConversationRun, completeDeferredResumeConversationRun, createDeferredResumeConversationRunId, markDeferredResumeConversationRunReady, markDeferredResumeConversationRunRetryScheduled, markDeferredResumeConversationRunSnoozed, scheduleDeferredResumeConversationRun, } from './runs/deferred-resume-conversations.js';
export { appendDurableRunEvent, createDurableRunManifest, createInitialDurableRunStatus, listDurableRunIds, loadDurableRunCheckpoint, loadDurableRunManifest, loadDurableRunStatus, readDurableRunEvents, resolveDurableRunPaths, resolveDurableRunsRoot, saveDurableRunCheckpoint, saveDurableRunManifest, saveDurableRunStatus, scanDurableRun, scanDurableRunsForRecovery, summarizeScannedDurableRuns, } from './runs/store.js';
export { createWebLiveConversationRunId, listRecoverableWebLiveConversationRuns, parsePendingOperation, saveWebLiveConversationRunState, } from './runs/web-live-conversations.js';
export { PersonalAgentDaemon } from './server.js';
export { readTailscaleServeProxyState, resolveTailscaleServeBaseUrl, syncTailscaleServeProxy, } from './tailscale-serve.js';
export async function runDaemonCli(argv = process.argv.slice(2)) {
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
        console.error(error.message);
        process.exit(1);
    });
}
