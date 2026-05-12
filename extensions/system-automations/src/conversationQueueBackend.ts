import {
  cancelDeferredResumeForSessionFile,
  cancelQueuedPrompt,
  DEFAULT_DEFERRED_RESUME_PROMPT,
  type DeferredResumeSummary,
  deleteStoredAutomation,
  getSessionDeferredResumeEntries,
  listQueuedPromptPreviews,
  listStoredAutomations,
  loadAutomationRuntimeStateMap,
  loadDeferredResumeState,
  parseDeferredResumeDelayMs,
  parseFutureHumanDateTime,
  promptSession,
  type QueuedPromptPreview,
  scheduleDeferredResumeForSessionFile,
} from '@personal-agent/extensions/backend';

const DELIVER_AS_VALUES = ['steer', 'followUp'] as const;
type DeliverAs = (typeof DELIVER_AS_VALUES)[number];

type ConversationQueueAction = 'add' | 'list' | 'cancel';
type ConversationQueueTrigger = 'after_turn' | 'delay' | 'at';

export interface ConversationQueueInput {
  action: ConversationQueueAction;
  id?: string;
  prompt?: string;
  trigger?: ConversationQueueTrigger;
  delay?: string;
  at?: string;
  deliverAs?: DeliverAs;
  title?: string;
}

export interface ConversationQueueContext {
  profile: string;
  toolContext?: { sessionId?: string; sessionFile?: string; cwd?: string };
  ui: { invalidate(topics: string | string[]): void };
}

interface ConversationQueueItem {
  id: string;
  source: 'live-queue' | 'automation' | 'deferred-resume';
  status: 'queued' | 'scheduled' | 'ready';
  trigger: 'after_turn' | 'time';
  prompt: string;
  title?: string;
  deliverAs?: DeliverAs;
  kind?: DeferredResumeSummary['kind'];
  dueAt?: string;
  readyAt?: string;
}

function readOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = readOptionalString(value);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function buildLiveQueueItem(behavior: DeliverAs, preview: QueuedPromptPreview): ConversationQueueItem {
  return {
    id: `live:${behavior}:${preview.id}`,
    source: 'live-queue',
    status: 'queued',
    trigger: 'after_turn',
    prompt: preview.text,
    deliverAs: behavior,
  };
}

function buildAutomationQueueItem(task: {
  id: string;
  title: string;
  prompt: string;
  schedule: { type: 'cron' | 'at'; at?: string };
  conversationBehavior?: 'steer' | 'followUp';
}): ConversationQueueItem {
  return {
    id: task.id,
    source: 'automation',
    status: 'scheduled',
    trigger: 'time',
    prompt: task.prompt,
    title: task.title,
    deliverAs: task.conversationBehavior,
    dueAt: task.schedule.type === 'at' ? task.schedule.at : undefined,
  };
}

function buildDeferredResumeQueueItem(resume: DeferredResumeSummary): ConversationQueueItem {
  return {
    id: resume.id,
    source: 'deferred-resume',
    status: resume.status,
    trigger: 'time',
    prompt: resume.prompt,
    title: resume.title,
    deliverAs: resume.behavior,
    kind: resume.kind,
    dueAt: resume.dueAt,
    readyAt: resume.readyAt,
  };
}

function collectConversationQueueItems(input: { sessionId?: string; sessionFile?: string }): ConversationQueueItem[] {
  const items: ConversationQueueItem[] = [];
  if (input.sessionId) {
    try {
      const queued = listQueuedPromptPreviews(input.sessionId);
      items.push(
        ...queued.steering.map((preview) => buildLiveQueueItem('steer', preview)),
        ...queued.followUp.map((preview) => buildLiveQueueItem('followUp', preview)),
      );
    } catch {
      // Non-live session.
    }
  }
  if (input.sessionFile) {
    const runtimeState = loadAutomationRuntimeStateMap();
    const automations = listStoredAutomations()
      .filter((task) => task.targetType === 'conversation' && task.threadSessionFile === input.sessionFile)
      .filter((task) => task.schedule.type === 'cron' || !runtimeState[task.id]?.oneTimeResolvedAt);
    items.push(...automations.map(buildAutomationQueueItem));
    const resumes = getSessionDeferredResumeEntries(loadDeferredResumeState(), input.sessionFile).map(
      (resume) =>
        ({
          id: resume.id,
          sessionFile: resume.sessionFile,
          prompt: resume.prompt,
          dueAt: resume.dueAt,
          createdAt: resume.createdAt,
          attempts: resume.attempts,
          status: resume.status,
          readyAt: resume.readyAt,
          kind: resume.kind,
          title: resume.title,
          behavior: resume.behavior,
          delivery: resume.delivery,
        }) satisfies DeferredResumeSummary,
    );
    items.push(...resumes.map(buildDeferredResumeQueueItem));
  }
  return items.sort(
    (left, right) =>
      (left.readyAt ?? left.dueAt ?? '').localeCompare(right.readyAt ?? right.dueAt ?? '') || left.id.localeCompare(right.id),
  );
}

function formatQueueItem(item: ConversationQueueItem): string {
  const label = item.title?.trim() || item.prompt.trim() || '(empty prompt)';
  const parts = [`- ${item.id}`, `[${item.status}]`, item.trigger];
  if (item.deliverAs) parts.push(`deliverAs=${item.deliverAs}`);
  if (item.kind && item.kind !== 'continue') parts.push(`kind=${item.kind}`);
  if (item.readyAt) parts.push(`ready=${item.readyAt}`);
  else if (item.dueAt) parts.push(`due=${item.dueAt}`);
  return `${parts.join(' ')} · ${label}`;
}

function formatQueueList(items: ConversationQueueItem[]): string {
  return items.length === 0
    ? 'Conversation queue is empty.'
    : [`Conversation queue (${items.length}):`, ...items.map(formatQueueItem)].join('\n');
}

function parseLiveQueueId(id: string): { behavior: DeliverAs; previewId: string } | null {
  const match = id.match(/^live:(steer|followUp):(.+)$/);
  const behavior = match?.[1];
  const previewId = match?.[2]?.trim();
  return (behavior === 'steer' || behavior === 'followUp') && previewId ? { behavior, previewId } : null;
}

function summarizeAutomationTitle(prompt: string, title?: string): string {
  return readOptionalString(title) ?? prompt.split('\n')[0]?.trim().slice(0, 80) ?? 'Queued continuation';
}

function resolveScheduledAt(input: { delay?: string; at?: string }): { dueAt: string; interpretation?: string; timeExpression?: string } {
  if (input.delay && input.at) throw new Error('Specify only one of delay or at.');
  if (!input.delay && !input.at) throw new Error('One of delay or at is required.');
  if (input.delay) {
    const delayMs = parseDeferredResumeDelayMs(input.delay);
    if (!delayMs) throw new Error('Invalid delay. Use forms like 30s, 10m, 2h, or 1d.');
    return { dueAt: new Date(Date.now() + delayMs).toISOString() };
  }
  const parsed = parseFutureHumanDateTime(input.at as string);
  return { dueAt: parsed.dueAt, interpretation: parsed.interpretation, timeExpression: parsed.input };
}

function findConversationAutomation(id: string, sessionFile: string) {
  return listStoredAutomations().find(
    (task) => task.id === id && task.targetType === 'conversation' && task.threadSessionFile === sessionFile,
  );
}

export async function conversationQueue(input: ConversationQueueInput, ctx: ConversationQueueContext) {
  const sessionId = readOptionalString(ctx.toolContext?.sessionId);
  const sessionFile = readOptionalString(ctx.toolContext?.sessionFile);

  switch (input.action) {
    case 'list': {
      const items = collectConversationQueueItems({ sessionId, sessionFile });
      return { text: formatQueueList(items), action: 'list', sessionId, sessionFile, items };
    }
    case 'add': {
      const trigger = input.trigger;
      if (trigger !== 'after_turn' && trigger !== 'delay' && trigger !== 'at')
        throw new Error('trigger is required for add. Use after_turn, delay, or at.');
      const prompt = readOptionalString(input.prompt) ?? DEFAULT_DEFERRED_RESUME_PROMPT;
      const deliverAs = input.deliverAs === 'steer' || input.deliverAs === 'followUp' ? input.deliverAs : undefined;
      if (trigger === 'after_turn') {
        if (!sessionId) throw new Error('trigger="after_turn" requires a live conversation.');
        await promptSession(sessionId, prompt, deliverAs ?? 'followUp');
        return {
          text: `Queued conversation continuation after the current turn (${deliverAs ?? 'followUp'}).`,
          action: 'add',
          trigger,
          sessionId,
          prompt,
          deliverAs: deliverAs ?? 'followUp',
        };
      }
      if (!sessionFile || !sessionId) throw new Error('Time-based queue entries require a persisted conversation.');
      const delay = trigger === 'delay' ? readRequiredString(input.delay, 'delay') : undefined;
      const at = trigger === 'at' ? readRequiredString(input.at, 'at') : undefined;
      const scheduled = resolveScheduledAt({ delay, at });
      const resume = await scheduleDeferredResumeForSessionFile({
        sessionFile,
        conversationId: sessionId,
        delay,
        at: trigger === 'at' ? scheduled.dueAt : undefined,
        prompt,
        title: summarizeAutomationTitle(prompt, input.title),
        kind: 'continue',
        behavior: deliverAs,
        notify: 'passive',
        requireAck: false,
        autoResumeIfOpen: true,
        source: { kind: 'conversation-queue-tool' },
      });
      ctx.ui.invalidate(['sessions', 'runs']);
      return {
        text: `Queued conversation continuation ${resume.id} (${trigger === 'delay' ? `in ${delay}` : `for ${scheduled.interpretation ?? resume.dueAt}`}).`,
        action: 'add',
        trigger,
        sessionId,
        sessionFile,
        id: resume.id,
        prompt: resume.prompt,
        dueAt: resume.dueAt,
        ...(scheduled.interpretation ? { localDueAt: scheduled.interpretation } : {}),
        ...(scheduled.timeExpression ? { timeExpression: scheduled.timeExpression } : {}),
        ...(deliverAs ? { deliverAs } : {}),
      };
    }
    case 'cancel': {
      const id = readRequiredString(input.id, 'id');
      const liveQueueId = parseLiveQueueId(id);
      if (liveQueueId) {
        if (!sessionId) throw new Error('Live queue cancellation requires a live conversation.');
        const cancelled = await cancelQueuedPrompt(sessionId, liveQueueId.behavior, liveQueueId.previewId);
        return { text: `Cancelled queued ${liveQueueId.behavior} continuation.`, action: 'cancel', sessionId, id, cancelled };
      }
      if (!sessionFile) throw new Error('Deferred queue cancellation requires a persisted session file.');
      const automation = findConversationAutomation(id, sessionFile);
      if (automation) {
        deleteStoredAutomation(automation.id);
        ctx.ui.invalidate(['tasks', 'sessions']);
        return {
          text: `Cancelled queued continuation ${automation.id}.`,
          action: 'cancel',
          sessionId,
          sessionFile,
          id: automation.id,
          prompt: automation.prompt,
        };
      }
      const cancelled = await cancelDeferredResumeForSessionFile({ sessionFile, id });
      ctx.ui.invalidate('sessions');
      return {
        text: `Cancelled queued continuation ${cancelled.id}.`,
        action: 'cancel',
        sessionId,
        sessionFile,
        id: cancelled.id,
        prompt: cancelled.prompt,
      };
    }
    default:
      throw new Error(`Unsupported conversation queue action: ${String(input.action)}`);
  }
}
