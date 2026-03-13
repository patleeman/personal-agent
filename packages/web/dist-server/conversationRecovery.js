import { listRecoverableWebLiveConversationRuns, syncWebLiveConversationRun, } from './conversationRuns.js';
export async function recoverDurableLiveConversations(dependencies) {
    const recovered = [];
    const runs = await listRecoverableWebLiveConversationRuns();
    for (const run of runs) {
        if (dependencies.isLive(run.conversationId)) {
            continue;
        }
        try {
            const resumed = await dependencies.resumeSession(run.sessionFile, dependencies.loaderOptions);
            if (run.pendingOperation) {
                await syncWebLiveConversationRun({
                    conversationId: resumed.id,
                    sessionFile: run.sessionFile,
                    cwd: run.cwd,
                    title: run.title,
                    profile: run.profile,
                    state: 'running',
                    pendingOperation: run.pendingOperation,
                });
                for (const message of run.pendingOperation.contextMessages ?? []) {
                    await dependencies.queuePromptContext(resumed.id, message.customType, message.content);
                }
                await dependencies.promptSession(resumed.id, run.pendingOperation.text, run.pendingOperation.behavior, run.pendingOperation.images);
            }
            recovered.push({
                runId: run.runId,
                conversationId: resumed.id,
                replayedPendingOperation: Boolean(run.pendingOperation),
            });
            dependencies.logger?.info(`recovered conversation run=${run.runId} conversation=${resumed.id} replayed=${String(Boolean(run.pendingOperation))}`);
        }
        catch (error) {
            dependencies.logger?.warn(`failed to recover conversation run=${run.runId}: ${error.message}`);
        }
    }
    return { recovered };
}
