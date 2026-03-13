import { createWebLiveConversationRunId, listRecoverableWebLiveConversationRuns as listRecoverableWebLiveConversationRunsLocal, listRecoverableWebLiveConversationRunsFromDaemon, pingDaemon, saveWebLiveConversationRunState, syncWebLiveConversationRunState, } from '@personal-agent/daemon';
function isDaemonUnavailable(error) {
    if (!(error instanceof Error)) {
        return false;
    }
    const message = error.message.toLowerCase();
    return message.includes('enoent')
        || message.includes('econnrefused')
        || message.includes('timed out')
        || message.includes('closed without response')
        || message.includes('unknown request type');
}
export { createWebLiveConversationRunId };
export async function syncWebLiveConversationRun(input) {
    const normalizedInput = {
        conversationId: input.conversationId,
        sessionFile: input.sessionFile,
        cwd: input.cwd,
        state: input.state,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.profile !== undefined ? { profile: input.profile } : {}),
        ...(input.updatedAt ? { updatedAt: new Date(input.updatedAt).toISOString() } : {}),
        ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
        ...(input.pendingOperation !== undefined ? { pendingOperation: input.pendingOperation } : {}),
    };
    try {
        if (await pingDaemon()) {
            return await syncWebLiveConversationRunState(normalizedInput);
        }
    }
    catch (error) {
        if (!isDaemonUnavailable(error)) {
            throw error;
        }
    }
    return saveWebLiveConversationRunState(normalizedInput);
}
export async function listRecoverableWebLiveConversationRuns() {
    try {
        if (await pingDaemon()) {
            const result = await listRecoverableWebLiveConversationRunsFromDaemon();
            return result.runs;
        }
    }
    catch (error) {
        if (!isDaemonUnavailable(error)) {
            throw error;
        }
    }
    return listRecoverableWebLiveConversationRunsLocal();
}
