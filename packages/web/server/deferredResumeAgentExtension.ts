import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { publishAppEvent } from './appEvents.js';
import { scheduleDeferredResumeForSessionFile } from './deferredResumes.js';

const DeferredResumeToolParams = Type.Object({
  delay: Type.String({
    description: 'Delay until resume, for example 30s, 10m, 2h, or 1d.',
  }),
  prompt: Type.Optional(Type.String({
    description: 'Optional prompt to inject when the deferred resume triggers. Defaults to continuing from the current point.',
  })),
  title: Type.Optional(Type.String({
    description: 'Optional short label for the wakeup.',
  })),
  notify: Type.Optional(Type.Union([
    Type.Literal('none'),
    Type.Literal('passive'),
    Type.Literal('disruptive'),
  ], {
    description: 'Whether the wakeup should create an in-app alert.',
  })),
  requireAck: Type.Optional(Type.Boolean({
    description: 'Whether the resulting alert should require acknowledgement.',
  })),
  autoResumeIfOpen: Type.Optional(Type.Boolean({
    description: 'Whether an open saved conversation should auto-resume when this wakeup becomes ready.',
  })),
});

export function createDeferredResumeAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'deferred_resume',
      label: 'Deferred Resume',
      description: 'Schedule this web conversation to continue later. Due prompts resume the same conversation when it is live; an open saved conversation in the web UI auto-resumes when the deferred work becomes ready; otherwise the deferred resume surfaces through durable state until reopened.',
      promptSnippet: 'Schedule this same conversation to resume later.',
      promptGuidelines: [
        'Use this tool when you should pause now and continue later after waiting for time to pass or for background work to make progress.',
        'Prefer this over asking the user to check back later or remind you when no user input is actually required.',
        'Good uses: waiting before checking logs, monitoring an external system again later, retrying later, or staging unattended multi-step work.',
        'You may schedule it proactively for lightweight follow-up or monitoring; you do not need user confirmation just because time needs to pass.',
        'Use delays like 30s, 10m, 2h, or 1d.',
        'Provide a concise future prompt describing exactly what to continue or check next.',
      ],
      parameters: DeferredResumeToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        try {
          const sessionFile = ctx.sessionManager.getSessionFile();
          if (!sessionFile) {
            throw new Error('Deferred resume requires a persisted session file.');
          }

          const resume = await scheduleDeferredResumeForSessionFile({
            sessionFile,
            delay: params.delay,
            prompt: params.prompt,
            title: params.title,
            notify: params.notify,
            requireAck: params.requireAck,
            autoResumeIfOpen: params.autoResumeIfOpen,
          });

          const sessionId = ctx.sessionManager.getSessionId?.();
          if (sessionId) {
            publishAppEvent({ type: 'session_meta_changed', sessionId });
          }
          return {
            content: [{
              type: 'text' as const,
              text: `Scheduled deferred resume ${resume.id} in ${params.delay} (due ${resume.dueAt}).`,
            }],
            details: {
              mode: 'web',
              id: resume.id,
              sessionFile,
              prompt: resume.prompt,
              dueAt: resume.dueAt,
            },
          };
        } catch (error) {
          throw error instanceof Error ? error : new Error(String(error));
        }
      },
    });
  };
}
