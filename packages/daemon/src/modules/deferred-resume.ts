import { join, resolve, sep } from 'path';
import {
  activateDueDeferredResumes,
  createWorkstreamActivityEntry,
  getConversationWorkstreamLink,
  loadDeferredResumeState,
  readSessionConversationId,
  saveDeferredResumeState,
  writeProfileActivityEntry,
  type DeferredResumeRecord,
} from '@personal-agent/core';
import type { DaemonModule } from './types.js';

const DEFERRED_RESUME_TICK_MS = 10_000;
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;

interface DeferredResumeModuleState {
  knownResumes: number;
  readyResumes: number;
  activatedResumes: number;
  lastTickAt?: string;
  lastActivatedAt?: string;
  lastError?: string;
}

export interface DeferredResumeModuleDependencies {
  now?: () => Date;
}

function sanitizeProfileName(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  const normalized = raw.trim();
  return PROFILE_NAME_PATTERN.test(normalized) ? normalized : undefined;
}

function inferProfileFromTaskDir(taskDir: string): string | undefined {
  const normalized = resolve(taskDir);
  const segments = normalized.split(sep).filter((segment) => segment.length > 0);
  const profilesIndex = segments.lastIndexOf('profiles');
  if (profilesIndex < 0) {
    return undefined;
  }

  return sanitizeProfileName(segments[profilesIndex + 1]);
}

function inferRepoRootFromTaskDir(taskDir: string, profile: string): string | undefined {
  const normalized = resolve(taskDir);
  const suffix = join('profiles', profile, 'agent', 'tasks');
  if (!normalized.endsWith(suffix)) {
    return undefined;
  }

  const repoRoot = normalized.slice(0, normalized.length - suffix.length).replace(/[\\/]+$/, '');
  return repoRoot.length > 0 ? repoRoot : undefined;
}

function sanitizeActivityIdSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized.length > 0 ? sanitized : 'activity';
}

function resolveProfileContext(taskDir: string): { profile: string; repoRoot?: string } {
  const profile = inferProfileFromTaskDir(taskDir)
    ?? sanitizeProfileName(process.env.PERSONAL_AGENT_ACTIVE_PROFILE)
    ?? sanitizeProfileName(process.env.PERSONAL_AGENT_PROFILE)
    ?? 'shared';

  return {
    profile,
    repoRoot: inferRepoRootFromTaskDir(taskDir, profile),
  };
}

function writeDeferredResumeFiredActivity(input: {
  entry: DeferredResumeRecord;
  repoRoot: string;
  profile: string;
}): void {
  const conversationId = readSessionConversationId(input.entry.sessionFile);
  const relatedWorkstreamIds = conversationId
    ? (getConversationWorkstreamLink({
        repoRoot: input.repoRoot,
        profile: input.profile,
        conversationId,
      })?.relatedWorkstreamIds ?? [])
    : [];

  writeProfileActivityEntry({
    repoRoot: input.repoRoot,
    profile: input.profile,
    entry: createWorkstreamActivityEntry({
      id: `deferred-resume-fired-${sanitizeActivityIdSegment(input.entry.id)}`,
      createdAt: input.entry.readyAt ?? input.entry.dueAt,
      profile: input.profile,
      kind: 'deferred-resume',
      summary: 'Deferred resume fired. Open the conversation to continue.',
      details: [
        `Session file: ${input.entry.sessionFile}`,
        `Due at: ${input.entry.dueAt}`,
        ...(input.entry.readyAt ? [`Ready at: ${input.entry.readyAt}`] : []),
        `Prompt: ${input.entry.prompt}`,
      ].join('\n'),
      relatedConversationIds: conversationId ? [conversationId] : undefined,
      relatedWorkstreamIds: relatedWorkstreamIds.length > 0 ? relatedWorkstreamIds : undefined,
      notificationState: 'none',
    }),
  });
}

export function createDeferredResumeModule(
  dependencies: DeferredResumeModuleDependencies = {},
): DaemonModule {
  const now = dependencies.now ?? (() => new Date());
  const state: DeferredResumeModuleState = {
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
    async start() {
      updateCounts();
    },
    async handleEvent(event, context) {
      if (event.type !== 'timer.deferred-resume.tick') {
        return;
      }

      state.lastTickAt = now().toISOString();

      try {
        const deferredState = loadDeferredResumeState();
        const activated = activateDueDeferredResumes(deferredState, { at: now() });

        if (activated.length > 0) {
          saveDeferredResumeState(deferredState);

          const profileContext = resolveProfileContext(context.config.modules.tasks.taskDir);
          if (!profileContext.repoRoot) {
            context.logger.warn(`unable to infer repo root for deferred resume activity from ${context.config.modules.tasks.taskDir}`);
          } else {
            for (const entry of activated) {
              writeDeferredResumeFiredActivity({
                entry,
                repoRoot: profileContext.repoRoot,
                profile: profileContext.profile,
              });
            }
          }

          state.activatedResumes += activated.length;
          state.lastActivatedAt = activated[activated.length - 1]?.readyAt ?? state.lastTickAt;
          context.publish('deferred-resume.tick.completed', {
            activated: activated.length,
          });
        }

        updateCounts();
        state.lastError = undefined;
      } catch (error) {
        state.lastError = (error as Error).message;
        context.logger.warn(`deferred resume tick failed: ${(error as Error).message}`);
      }
    },
    getStatus() {
      return { ...state };
    },
  };
}
