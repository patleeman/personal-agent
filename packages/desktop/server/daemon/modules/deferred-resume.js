import { activateDueDeferredResumes, loadDeferredResumeState, readSessionConversationId, resolveDeferredResumeStateFile, saveDeferredResumeState, } from '@personal-agent/core';
import { join, resolve, sep } from 'path';
import { surfaceReadyDeferredResume } from '../conversation-wakeups.js';
import { markDeferredResumeConversationRunReady } from '../runs/deferred-resume-conversations.js';
const DEFERRED_RESUME_TICK_MS = 10_000;
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
function sanitizeProfileName(raw) {
    if (!raw) {
        return undefined;
    }
    const normalized = raw.trim();
    return PROFILE_NAME_PATTERN.test(normalized) ? normalized : undefined;
}
function inferProfileFromTaskDir(taskDir) {
    const normalized = resolve(taskDir);
    const segments = normalized.split(sep).filter((segment) => segment.length > 0);
    const profilesIndex = segments.lastIndexOf('profiles');
    if (profilesIndex < 0) {
        return undefined;
    }
    return sanitizeProfileName(segments[profilesIndex + 1]);
}
function inferRepoRootFromTaskDir(taskDir, profile) {
    const normalized = resolve(taskDir);
    const suffix = join('profiles', profile, 'agent', 'tasks');
    if (!normalized.endsWith(suffix)) {
        return undefined;
    }
    const repoRoot = normalized.slice(0, normalized.length - suffix.length).replace(/[\\/]+$/, '');
    return repoRoot.length > 0 ? repoRoot : undefined;
}
function resolveProfileContext(taskDir) {
    const profile = inferProfileFromTaskDir(taskDir) ??
        sanitizeProfileName(process.env.PERSONAL_AGENT_ACTIVE_PROFILE) ??
        sanitizeProfileName(process.env.PERSONAL_AGENT_PROFILE) ??
        'shared';
    return {
        profile,
        repoRoot: inferRepoRootFromTaskDir(taskDir, profile),
    };
}
export function createDeferredResumeModule(dependencies = {}) {
    const now = dependencies.now ?? (() => new Date());
    const state = {
        knownResumes: 0,
        readyResumes: 0,
        activatedResumes: 0,
    };
    function updateCounts() {
        const loaded = loadDeferredResumeState();
        const resumes = Object.values(loaded.resumes);
        state.knownResumes = resumes.length;
        state.readyResumes = resumes.filter((entry) => entry.status === 'ready').length;
    }
    return {
        name: 'deferred-resume',
        enabled: true,
        subscriptions: ['timer.deferred-resume.tick'],
        timers: [
            {
                name: 'deferred-resume-tick',
                eventType: 'timer.deferred-resume.tick',
                intervalMs: DEFERRED_RESUME_TICK_MS,
            },
        ],
        async start(context) {
            updateCounts();
            const profileContext = resolveProfileContext(context.config.modules.tasks.taskDir);
            const deferredResumeStateFile = resolveDeferredResumeStateFile(context.paths.stateRoot);
            const deferredState = loadDeferredResumeState(deferredResumeStateFile);
            const readyEntries = Object.values(deferredState.resumes).filter((entry) => entry.status === 'ready');
            for (const entry of readyEntries) {
                const conversationId = readSessionConversationId(entry.sessionFile);
                await markDeferredResumeConversationRunReady({
                    daemonRoot: context.paths.root,
                    deferredResumeId: entry.id,
                    sessionFile: entry.sessionFile,
                    prompt: entry.prompt,
                    dueAt: entry.dueAt,
                    createdAt: entry.createdAt,
                    readyAt: entry.readyAt ?? now().toISOString(),
                    profile: profileContext.profile,
                    conversationId,
                });
                if (profileContext.repoRoot) {
                    surfaceReadyDeferredResume({
                        entry,
                        repoRoot: profileContext.repoRoot,
                        profile: profileContext.profile,
                        stateRoot: context.paths.stateRoot,
                        conversationId,
                    });
                }
            }
        },
        async handleEvent(event, context) {
            if (event.type !== 'timer.deferred-resume.tick') {
                return;
            }
            state.lastTickAt = now().toISOString();
            try {
                const deferredResumeStateFile = resolveDeferredResumeStateFile(context.paths.stateRoot);
                const deferredState = loadDeferredResumeState(deferredResumeStateFile);
                const activated = activateDueDeferredResumes(deferredState, { at: now() });
                if (activated.length > 0) {
                    saveDeferredResumeState(deferredState, deferredResumeStateFile);
                    const profileContext = resolveProfileContext(context.config.modules.tasks.taskDir);
                    for (const entry of activated) {
                        const conversationId = readSessionConversationId(entry.sessionFile);
                        await markDeferredResumeConversationRunReady({
                            daemonRoot: context.paths.root,
                            deferredResumeId: entry.id,
                            sessionFile: entry.sessionFile,
                            prompt: entry.prompt,
                            dueAt: entry.dueAt,
                            createdAt: entry.createdAt,
                            readyAt: entry.readyAt ?? state.lastTickAt ?? now().toISOString(),
                            profile: profileContext.profile,
                            conversationId,
                        });
                        if (!profileContext.repoRoot) {
                            context.logger.warn(`unable to infer repo root for deferred resume activity from ${context.config.modules.tasks.taskDir}`);
                            continue;
                        }
                        surfaceReadyDeferredResume({
                            entry,
                            repoRoot: profileContext.repoRoot,
                            profile: profileContext.profile,
                            stateRoot: context.paths.stateRoot,
                            conversationId,
                        });
                    }
                    state.activatedResumes += activated.length;
                    state.lastActivatedAt = activated[activated.length - 1]?.readyAt ?? state.lastTickAt;
                    context.publish('deferred-resume.tick.completed', {
                        activated: activated.length,
                    });
                }
                updateCounts();
                state.lastError = undefined;
            }
            catch (error) {
                state.lastError = error.message;
                context.logger.warn(`deferred resume tick failed: ${error.message}`);
            }
        },
        getStatus() {
            return { ...state };
        },
    };
}
