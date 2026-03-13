import { getSessionDeferredResumeEntries, loadDeferredResumeState, parseDeferredResumeDelayMs, readSessionConversationId, removeDeferredResume, saveDeferredResumeState, scheduleDeferredResume, } from '@personal-agent/core';
import { cancelDeferredResumeConversationRun, loadDaemonConfig, resolveDaemonPaths, scheduleDeferredResumeConversationRun, } from '@personal-agent/daemon';
export const DEFAULT_DEFERRED_RESUME_PROMPT = 'Continue from where you left off and keep going.';
function resolveDaemonRoot() {
    return resolveDaemonPaths(loadDaemonConfig().ipc.socketPath).root;
}
function createDeferredResumeId(now) {
    return `resume_${now.getTime()}_${Math.random().toString(36).slice(2, 10)}`;
}
function toSummary(record) {
    return {
        id: record.id,
        sessionFile: record.sessionFile,
        prompt: record.prompt,
        dueAt: record.dueAt,
        createdAt: record.createdAt,
        attempts: record.attempts,
        status: record.status,
        readyAt: record.readyAt,
    };
}
export function listDeferredResumesForSessionFile(sessionFile) {
    const state = loadDeferredResumeState();
    return getSessionDeferredResumeEntries(state, sessionFile).map(toSummary);
}
export async function scheduleDeferredResumeForSessionFile(input) {
    const delayMs = parseDeferredResumeDelayMs(input.delay);
    if (!delayMs) {
        throw new Error('Invalid delay. Use forms like 30s, 10m, 2h, or 1d.');
    }
    const now = input.now ?? new Date();
    const state = loadDeferredResumeState();
    const record = scheduleDeferredResume(state, {
        id: createDeferredResumeId(now),
        sessionFile: input.sessionFile,
        prompt: input.prompt?.trim() || DEFAULT_DEFERRED_RESUME_PROMPT,
        dueAt: new Date(now.getTime() + delayMs).toISOString(),
        createdAt: now.toISOString(),
        attempts: 0,
    });
    saveDeferredResumeState(state);
    await scheduleDeferredResumeConversationRun({
        daemonRoot: resolveDaemonRoot(),
        deferredResumeId: record.id,
        sessionFile: record.sessionFile,
        prompt: record.prompt,
        dueAt: record.dueAt,
        createdAt: record.createdAt,
        conversationId: readSessionConversationId(record.sessionFile),
    });
    return toSummary(record);
}
export async function cancelDeferredResumeForSessionFile(input) {
    const state = loadDeferredResumeState();
    const record = state.resumes[input.id];
    if (!record || record.sessionFile !== input.sessionFile) {
        throw new Error(`No deferred resume found for this conversation: ${input.id}`);
    }
    removeDeferredResume(state, input.id);
    saveDeferredResumeState(state);
    await cancelDeferredResumeConversationRun({
        daemonRoot: resolveDaemonRoot(),
        deferredResumeId: record.id,
        sessionFile: record.sessionFile,
        prompt: record.prompt,
        dueAt: record.dueAt,
        createdAt: record.createdAt,
        readyAt: record.readyAt,
        cancelledAt: new Date().toISOString(),
        conversationId: readSessionConversationId(record.sessionFile),
        reason: 'Deferred resume cancelled by user.',
    });
    return toSummary(record);
}
