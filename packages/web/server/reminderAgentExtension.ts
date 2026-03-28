import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { publishAppEvent } from './appEvents.js';
import { scheduleDeferredResumeForSessionFile } from './deferredResumes.js';

const ReminderToolParams = Type.Object({
  delay: Type.Optional(Type.String({
    description: 'Relative delay until the reminder, for example 30s, 10m, 2h, or 1d.',
  })),
  at: Type.Optional(Type.String({
    description: 'Absolute reminder time parseable by Date.parse, for example 2026-03-27T09:00:00-04:00.',
  })),
  prompt: Type.String({
    description: 'What the reminder should tell the agent/user when it fires.',
  }),
  title: Type.Optional(Type.String({
    description: 'Short reminder label shown in alerts and conversation UI.',
  })),
  notify: Type.Optional(Type.Union([
    Type.Literal('passive'),
    Type.Literal('disruptive'),
  ], {
    description: 'How strongly the reminder should interrupt in-app. Defaults to disruptive.',
  })),
  requireAck: Type.Optional(Type.Boolean({
    description: 'Whether the reminder alert should stay active until acknowledged.',
  })),
  autoResumeIfOpen: Type.Optional(Type.Boolean({
    description: 'Whether an open saved conversation should auto-resume when the reminder becomes ready.',
  })),
});

export function createReminderAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'reminder',
      label: 'Reminder',
      description: 'Schedule a conversation-bound reminder that later resumes this same conversation context and raises an in-app alert.',
      promptSnippet: 'Schedule a reminder for this same conversation and make sure it will visibly alert later.',
      promptGuidelines: [
        'Use this tool when the user explicitly wants a reminder, not just background waiting.',
        'Reminders are tied to the current conversation and should bring the conversation back later.',
        'Prefer reminders over scheduled_task when the intent is “tell me later” rather than “run unattended automation later.”',
        'Provide either delay or at, not both.',
        'Use a concise title when the reminder should be easy to scan in alerts.',
      ],
      parameters: ReminderToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const sessionFile = ctx.sessionManager.getSessionFile();
        if (!sessionFile) {
          throw new Error('Reminder requires a persisted session file.');
        }

        const reminder = await scheduleDeferredResumeForSessionFile({
          sessionFile,
          delay: params.delay,
          at: params.at,
          prompt: params.prompt,
          title: params.title,
          kind: 'reminder',
          notify: params.notify ?? 'disruptive',
          requireAck: params.requireAck ?? true,
          autoResumeIfOpen: params.autoResumeIfOpen ?? true,
          source: {
            kind: 'reminder-tool',
          },
        });

        const sessionId = ctx.sessionManager.getSessionId?.();
        if (sessionId) {
          publishAppEvent({ type: 'session_meta_changed', sessionId });
        }
        return {
          content: [{
            type: 'text' as const,
            text: `Scheduled reminder ${reminder.id}${params.delay ? ` in ${params.delay}` : ''} (due ${reminder.dueAt}).`,
          }],
          details: {
            id: reminder.id,
            sessionFile,
            dueAt: reminder.dueAt,
            prompt: reminder.prompt,
            title: reminder.title,
          },
        };
      },
    });
  };
}
