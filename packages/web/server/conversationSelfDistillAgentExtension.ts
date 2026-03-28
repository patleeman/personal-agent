import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { publishAppEvent } from './appEvents.js';
import {
  DEFAULT_CONVERSATION_SELF_DISTILL_DELAY,
  scheduleConversationSelfDistillWakeup,
} from './conversationSelfDistill.js';

const SelfDistillToolParams = Type.Object({
  delay: Type.Optional(Type.String({
    description: `Optional delay until the wakeup becomes ready, for example 30m or 2h. Defaults to ${DEFAULT_CONVERSATION_SELF_DISTILL_DELAY}.`,
  })),
});

export function createConversationSelfDistillAgentExtension(options: {
  stateRoot?: string;
  getCurrentProfile: () => string;
}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'self_distill',
      label: 'Self Distill',
      description: 'Schedule a conservative durable follow-up wakeup for this same conversation. The later wakeup defaults to no-op and only writes a note or linked project update when the durable value is clear.',
      promptSnippet: 'Queue a later self-distill wakeup for this conversation when durable value may exist but should be reviewed conservatively.',
      promptGuidelines: [
        'Use this only when the conversation appears to contain durable value that should outlive the thread, but you want a later self-review instead of doing the durable edit right now.',
        'High bar: do not schedule it for routine coding chatter, ephemeral debugging, or information that is already captured elsewhere.',
        'The later wakeup should default to no-op, with note-node updates or already-linked project updates as the normal first-pass durable outcomes.',
        'Do not use it as a back door for AGENTS.md edits or skill mutation unless the user explicitly asked for those in this conversation.',
        'Repeated calls for the same conversation are deduped into one wakeup.',
      ],
      parameters: SelfDistillToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const sessionFile = ctx.sessionManager.getSessionFile();
        if (!sessionFile) {
          throw new Error('Self-distill wakeup requires a persisted session file.');
        }

        const conversationId = ctx.sessionManager.getSessionId?.();
        const scheduled = await scheduleConversationSelfDistillWakeup({
          stateRoot: options.stateRoot,
          profile: options.getCurrentProfile(),
          sessionFile,
          conversationId,
          delay: params.delay,
        });

        if (conversationId) {
          publishAppEvent({ type: 'session_meta_changed', sessionId: conversationId });
        }

        return {
          content: [{
            type: 'text' as const,
            text: scheduled.deduped
              ? `Self-distill wakeup ${scheduled.resume.id} is already ${scheduled.resume.status === 'ready' ? 'ready' : 'scheduled'} (due ${scheduled.resume.dueAt}).`
              : `Scheduled self-distill wakeup ${scheduled.resume.id} in ${params.delay?.trim() || DEFAULT_CONVERSATION_SELF_DISTILL_DELAY} (due ${scheduled.resume.dueAt}).`,
          }],
          details: {
            mode: 'web',
            id: scheduled.resume.id,
            sessionFile,
            dueAt: scheduled.resume.dueAt,
            status: scheduled.resume.status,
            deduped: scheduled.deduped,
            prompt: scheduled.resume.prompt,
            title: scheduled.resume.title,
          },
        };
      },
    });
  };
}
