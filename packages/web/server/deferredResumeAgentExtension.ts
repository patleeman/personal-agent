import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { invalidateAppTopics } from './appEvents.js';
import { scheduleDeferredResumeForSessionFile } from './deferredResumes.js';

const DeferredResumeToolParams = Type.Object({
  delay: Type.String({
    description: 'Delay until resume, for example 30s, 10m, 2h, or 1d.',
  }),
  prompt: Type.Optional(Type.String({
    description: 'Optional prompt to inject when the deferred resume triggers. Defaults to continuing from the current point.',
  })),
});

export function createDeferredResumeAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'deferred_resume',
      label: 'Deferred Resume',
      description: 'Schedule this web conversation to continue later. Due prompts resume the same conversation when it is live, and otherwise surface through durable state until reopened.',
      promptSnippet: 'Schedule this same conversation to resume later.',
      promptGuidelines: [
        'Use this tool when you should pause now and continue later after waiting for time to pass or for background work to make progress.',
        'Good uses: waiting before checking logs, retrying later, or staging unattended multi-step work.',
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
          });

          invalidateAppTopics('sessions');
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
