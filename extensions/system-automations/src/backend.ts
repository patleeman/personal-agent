import { scheduleDeferredResumeForSessionFile } from '../../../packages/desktop/server/automation/deferredResumes.js';
export { conversationQueue } from './conversationQueueBackend.js';
export { scheduledTask } from './scheduledTaskBackend.js';
import { parseFutureHumanDateTime } from '../../../packages/desktop/server/automation/humanDateTime.js';

interface AutomationBackendContext {
  toolContext?: { sessionFile?: string; sessionId?: string };
  ui: { invalidate(topics: string | string[]): void };
}

interface ReminderInput {
  delay?: string;
  at?: string;
  prompt: string;
  title?: string;
  notify?: 'passive' | 'disruptive';
  requireAck?: boolean;
  autoResumeIfOpen?: boolean;
}

export async function reminder(input: ReminderInput, ctx: AutomationBackendContext) {
  const sessionFile = ctx.toolContext?.sessionFile;
  if (!sessionFile) throw new Error('Reminder requires a persisted session file.');

  const parsedAt = input.at ? parseFutureHumanDateTime(input.at) : undefined;
  const reminderRecord = await scheduleDeferredResumeForSessionFile({
    sessionFile,
    delay: input.delay,
    at: parsedAt?.dueAt,
    prompt: input.prompt,
    title: input.title,
    kind: 'reminder',
    notify: input.notify ?? 'disruptive',
    requireAck: input.requireAck ?? true,
    autoResumeIfOpen: input.autoResumeIfOpen ?? true,
    source: { kind: 'reminder-tool' },
  });

  ctx.ui.invalidate(['sessions', 'runs']);
  return {
    text: `Scheduled reminder ${reminderRecord.id}${input.delay ? ` in ${input.delay}` : ''} (due ${
      parsedAt?.interpretation ?? reminderRecord.dueAt
    }).`,
    id: reminderRecord.id,
    sessionFile,
    dueAt: reminderRecord.dueAt,
    ...(parsedAt ? { localDueAt: parsedAt.interpretation, timeExpression: parsedAt.input } : {}),
    prompt: reminderRecord.prompt,
    title: reminderRecord.title,
  };
}
