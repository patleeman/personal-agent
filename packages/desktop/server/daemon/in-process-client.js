let daemonClientTransportOverride;
export function getDaemonClientTransportOverride() {
    return daemonClientTransportOverride;
}
export function setDaemonClientTransportOverride(transport) {
    daemonClientTransportOverride = transport;
}
export function clearDaemonClientTransportOverride() {
    daemonClientTransportOverride = undefined;
}
export function bindInProcessDaemonClient(daemon) {
    const transport = createInProcessDaemonClient(daemon);
    setDaemonClientTransportOverride(transport);
    return () => {
        if (getDaemonClientTransportOverride() === transport) {
            clearDaemonClientTransportOverride();
        }
    };
}
export function createInProcessDaemonClient(daemon) {
    return {
        ping: async () => daemon.isRunning(),
        getStatus: async () => daemon.getStatus(),
        stop: async () => {
            await daemon.requestStop();
        },
        listDurableRuns: async () => daemon.listDurableRuns(),
        getDurableRun: async (runId) => {
            const result = daemon.getDurableRun(runId);
            if (!result) {
                throw new Error(`Run not found: ${runId}`);
            }
            return result;
        },
        startScheduledTaskRun: async (taskId) => daemon.startScheduledTaskRun(taskId),
        startBackgroundRun: async (input) => daemon.startBackgroundRun(input),
        cancelDurableRun: async (runId) => daemon.cancelBackgroundRun(runId),
        rerunDurableRun: async (runId) => daemon.rerunBackgroundRun(runId),
        followUpDurableRun: async (runId, prompt) => daemon.followUpBackgroundRun(runId, prompt),
        syncWebLiveConversationRunState: async (input) => daemon.syncWebLiveConversationRun(input),
        listRecoverableWebLiveConversationRuns: async () => daemon.listRecoverableWebLiveConversationRuns(),
        emitEvent: async (event) => daemon.publishEvent(event),
    };
}
