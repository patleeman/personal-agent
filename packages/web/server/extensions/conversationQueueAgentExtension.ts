import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { loadAutomationRuntimeStateMap, createStoredAutomation, deleteStoredAutomation, listStoredAutomations } from '@personal-agent/daemon';
import { getSessionDeferredResumeEntries, loadDeferredResumeState, parseDeferredResumeDelayMs } from '@personal-agent/core';
import {
  cancelDeferredResumeForSessionFile,
  DEFAULT_DEFERRED_RESUME_PROMPT,
  type DeferredResumeSummary,
} from '../automation/deferredResumes.js';
import { applyScheduledTaskThreadBinding } from '../automation/scheduledTaskThreads.js';
import {
  cancelQueuedPrompt,
  listQueuedPromptPreviews,
  promptSession,
  type QueuedPromptPreview,
} from '../conversations/liveSessions.js';
import { invalidateAppTopics, publishAppEvent } from '../shared/appEvents.js';

const CONVERSATION_QUEUE_ACTION_VALUES = ['add', 'list', 'cancel'] as const;
const CONVERSATION_QUEUE_TRIGGER_VALUES = ['after_turn', 'delay', 'at'] as const;
const CONVERSATION_QUEUE_DELIVER_AS_VALUES = ['steer', 'followUp'] as const;

type ConversationQueueAction = (typeof CONVERSATION_QUEUE_ACTION_VALUES)[number];
type ConversationQueueTrigger = (typeof CONVERSATION_QUEUE_TRIGGER_VALUES)[number];
type ConversationQueueDeliverAs = (typeof CONVERSATION_QUEUE_DELIVER_AS_VALUES)[number];

const ConversationQueueToolParams = Type.Object({
  action: Type.Union(CONVERSATION_QUEUE_ACTION_VALUES.map((value) => Type.Literal(value))),
  id: Type.Optional(Type.String({ description: 'Queue item id for cancel.' })),
  prompt: Type.Optional(Type.String({ description: 'Prompt to run when the queued continuation becomes active.' })),
  trigger: Type.Optional(Type.Union(CONVERSATION_QUEUE_TRIGGER_VALUES.map((value) => Type.Literal(value)), {
    description: 'Trigger for add: after_turn queues behind the current turn; delay/at schedule later continuation.',
  })),
  delay: Type.Optional(Type.String({ description: 'Delay for trigger="delay", for example 30s, 10m, 2h, or 1d.' })),
  at: Type.Optional(Type.String({ description: 'Timestamp for trigger="at", parseable by Date.parse.' })),
  deliverAs: Type.Optional(Type.Union(CONVERSATION_QUEUE_DELIVER_AS_VALUES.map((value) => Type.Literal(value)), {
    description: 'How to enqueue the continuation when it runs.' ,
  })),
  title: Type.Optional(Type.String({ description: 'Optional short label for scheduled queue entries.' })),
});

interface ConversationQueueItem {
  id: string;
  source: 'live-queue' | 'automation' | 'deferred-resume';
  status: 'queued' | 'scheduled' | 'ready';
  trigger: 'after_turn' | 'time';
  prompt: string;
  title?: string;
  deliverAs?: ConversationQueueDeliverAs;
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
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function buildLiveQueueItem(
  behavior: ConversationQueueDeliverAs,
  preview: QueuedPromptPreview,
): ConversationQueueItem {
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

function collectConversationQueueItems(input: {
  sessionId?: string;
  sessionFile?: string;
}): ConversationQueueItem[] {
  const items: ConversationQueueItem[] = [];

  const sessionId = readOptionalString(input.sessionId);
  if (sessionId) {
    try {
      const queued = listQueuedPromptPreviews(sessionId);
      items.push(
        ...queued.steering.map((preview) => buildLiveQueueItem('steer', preview)),
        ...queued.followUp.map((preview) => buildLiveQueueItem('followUp', preview)),
      );
    } catch {
      // Ignore non-live sessions; deferred queue items can still be listed.
    }
  }

  const sessionFile = readOptionalString(input.sessionFile);
  if (sessionFile) {
    const runtimeState = loadAutomationRuntimeStateMap();
    const automations = listStoredAutomations()
      .filter((task) => task.targetType === 'conversation' && task.threadSessionFile === sessionFile)
      .filter((task) => {
        const runtime = runtimeState[task.id];
        return task.schedule.type === 'cron' || !runtime?.oneTimeResolvedAt;
      });
    items.push(...automations.map(buildAutomationQueueItem));

    const resumes = getSessionDeferredResumeEntries(loadDeferredResumeState(), sessionFile)
      .map((resume) => ({
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
      } satisfies DeferredResumeSummary));
    items.push(...resumes.map(buildDeferredResumeQueueItem));
  }

  return items.sort((left, right) => {
    const rank = (item: ConversationQueueItem) => {
      if (item.source === 'live-queue') {
        return 0;
      }
      return item.status === 'ready' ? 1 : 2;
    };

    const rankCompare = rank(left) - rank(right);
    if (rankCompare !== 0) {
      return rankCompare;
    }

    const leftTime = left.readyAt ?? left.dueAt ?? '';
    const rightTime = right.readyAt ?? right.dueAt ?? '';
    const timeCompare = leftTime.localeCompare(rightTime);
    if (timeCompare !== 0) {
      return timeCompare;
    }

    return left.id.localeCompare(right.id);
  });
}

function formatQueueItem(item: ConversationQueueItem): string {
  const label = item.title?.trim() || item.prompt.trim() || '(empty prompt)';
  const parts = [
    `- ${item.id}`,
    `[${item.status}]`,
    item.trigger,
  ];

  if (item.deliverAs) {
    parts.push(`deliverAs=${item.deliverAs}`);
  }
  if (item.kind && item.kind !== 'continue') {
    parts.push(`kind=${item.kind}`);
  }
  if (item.readyAt) {
    parts.push(`ready=${item.readyAt}`);
  } else if (item.dueAt) {
    parts.push(`due=${item.dueAt}`);
  }

  return `${parts.join(' ')} · ${label}`;
}

function formatQueueList(items: ConversationQueueItem[]): string {
  if (items.length === 0) {
    return 'Conversation queue is empty.';
  }

  return [
    `Conversation queue (${items.length}):`,
    ...items.map(formatQueueItem),
  ].join('\n');
}

function parseLiveQueueId(id: string): { behavior: ConversationQueueDeliverAs; previewId: string } | null {
  const match = id.match(/^live:(steer|followUp):(.+)$/);
  if (!match) {
    return null;
  }

  const behavior = match[1];
  const previewId = match[2]?.trim();
  if ((behavior !== 'steer' && behavior !== 'followUp') || !previewId) {
    return null;
  }

  return {
    behavior,
    previewId,
  };
}

function publishSessionMetaChanged(sessionId: string | undefined): void {
  const normalizedSessionId = readOptionalString(sessionId);
  if (!normalizedSessionId) {
    return;
  }

  publishAppEvent({ type: 'session_meta_changed', sessionId: normalizedSessionId });
}

function summarizeAutomationTitle(prompt: string, title?: string): string {
  const normalizedTitle = readOptionalString(title);
  if (normalizedTitle) {
    return normalizedTitle;
  }

  const summary = prompt.split('\n')[0]?.trim() ?? '';
  return summary.slice(0, 80) || 'Queued continuation';
}

function resolveScheduledAt(input: { delay?: string; at?: string }): string {
  if (input.delay && input.at) {
    throw new Error('Specify only one of delay or at.');
  }

  if (!input.delay && !input.at) {
    throw new Error('One of delay or at is required.');
  }

  if (input.delay) {
    const delayMs = parseDeferredResumeDelayMs(input.delay);
    if (!delayMs) {
      throw new Error('Invalid delay. Use forms like 30s, 10m, 2h, or 1d.');
    }

    return new Date(Date.now() + delayMs).toISOString();
  }

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.at as string)) {
    throw new Error('Invalid at timestamp. Use an ISO-8601 timestamp or another Date.parse-compatible string.');
  }

  const atMs = Date.parse(input.at as string);
  if (!Number.isFinite(atMs)) {
    throw new Error('Invalid at timestamp. Use an ISO-8601 timestamp or another Date.parse-compatible string.');
  }

  const dueAt = new Date(atMs);
  if (dueAt.getTime() <= Date.now()) {
    throw new Error('Queue time must be in the future.');
  }

  return dueAt.toISOString();
}

function findConversationAutomation(id: string, sessionFile: string) {
  return listStoredAutomations().find((task) => task.id === id && task.targetType === 'conversation' && task.threadSessionFile === sessionFile);
}

function readAddTrigger(value: ConversationQueueTrigger | undefined): ConversationQueueTrigger {
  if (value === 'after_turn' || value === 'delay' || value === 'at') {
    return value;
  }

  throw new Error('trigger is required for add. Use after_turn, delay, or at.');
}

export function createConversationQueueAgentExtension(options: { getCurrentProfile: () => string }): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'conversation_queue',
      label: 'Conversation queue',
      description: 'Queue future continuation work for the current conversation.',
      promptSnippet: 'Queue future continuation work for this same conversation.',
      promptGuidelines: [
        'Use this tool when the current conversation should keep going later instead of inventing a standalone task.',
        'Use trigger="after_turn" to queue work behind the current turn while the agent is still working.',
        'Use trigger="delay" or trigger="at" for time-based follow-up in the same conversation; those become saved automations.',
        'Keep queued prompts short and concrete about the exact next step.',
        'Use action="list" or action="cancel" to inspect or clean up queued continuation work.',
      ],
      parameters: ConversationQueueToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const action = params.action as ConversationQueueAction;
        const sessionId = readOptionalString(ctx.sessionManager.getSessionId?.());
        const sessionFile = readOptionalString(ctx.sessionManager.getSessionFile?.());

        switch (action) {
          case 'list': {
            const items = collectConversationQueueItems({ sessionId, sessionFile });
            return {
              content: [{ type: 'text' as const, text: formatQueueList(items) }],
              details: {
                action: 'list',
                sessionId,
                sessionFile,
                items,
              },
            };
          }

          case 'add': {
            const trigger = readAddTrigger(params.trigger as ConversationQueueTrigger | undefined);
            const prompt = readOptionalString(params.prompt) ?? DEFAULT_DEFERRED_RESUME_PROMPT;
            const deliverAs = params.deliverAs === 'steer' || params.deliverAs === 'followUp'
              ? params.deliverAs
              : undefined;

            if (trigger === 'after_turn') {
              if (!sessionId) {
                throw new Error('trigger="after_turn" requires a live conversation.');
              }

              await promptSession(sessionId, prompt, deliverAs ?? 'followUp');
              return {
                content: [{ type: 'text' as const, text: `Queued conversation continuation after the current turn (${deliverAs ?? 'followUp'}).` }],
                details: {
                  action: 'add',
                  trigger,
                  sessionId,
                  prompt,
                  deliverAs: deliverAs ?? 'followUp',
                },
              };
            }

            if (!sessionFile || !sessionId) {
              throw new Error('Time-based queue entries require a persisted conversation.');
            }

            const scheduledAt = resolveScheduledAt({
              delay: trigger === 'delay' ? readRequiredString(params.delay, 'delay') : undefined,
              at: trigger === 'at' ? readRequiredString(params.at, 'at') : undefined,
            });
            const automation = createStoredAutomation({
              profile: options.getCurrentProfile(),
              title: summarizeAutomationTitle(prompt, params.title),
              enabled: true,
              at: scheduledAt,
              prompt,
              cwd: ctx.cwd,
              targetType: 'conversation',
              conversationBehavior: deliverAs,
            });
            const task = applyScheduledTaskThreadBinding(automation.id, {
              threadMode: 'existing',
              threadConversationId: sessionId,
              threadSessionFile: sessionFile,
              cwd: ctx.cwd,
            });

            invalidateAppTopics('tasks');
            publishSessionMetaChanged(sessionId);
            return {
              content: [{
                type: 'text' as const,
                text: `Queued conversation continuation ${task.id} (${trigger === 'delay' ? `in ${params.delay}` : `for ${scheduledAt}`}).`,
              }],
              details: {
                action: 'add',
                trigger,
                sessionId,
                sessionFile,
                id: task.id,
                prompt: task.prompt,
                dueAt: scheduledAt,
                ...(deliverAs ? { deliverAs } : {}),
              },
            };
          }

          case 'cancel': {
            const id = readRequiredString(params.id, 'id');
            const liveQueueId = parseLiveQueueId(id);

            if (liveQueueId) {
              if (!sessionId) {
                throw new Error('Live queue cancellation requires a live conversation.');
              }

              const cancelled = await cancelQueuedPrompt(sessionId, liveQueueId.behavior, liveQueueId.previewId);
              return {
                content: [{ type: 'text' as const, text: `Cancelled queued ${liveQueueId.behavior} continuation.` }],
                details: {
                  action: 'cancel',
                  sessionId,
                  id,
                  cancelled,
                },
              };
            }

            if (!sessionFile) {
              throw new Error('Deferred queue cancellation requires a persisted session file.');
            }

            const automation = findConversationAutomation(id, sessionFile);
            if (automation) {
              deleteStoredAutomation(automation.id);
              invalidateAppTopics('tasks');
              publishSessionMetaChanged(sessionId);
              return {
                content: [{ type: 'text' as const, text: `Cancelled queued continuation ${automation.id}.` }],
                details: {
                  action: 'cancel',
                  sessionId,
                  sessionFile,
                  id: automation.id,
                  prompt: automation.prompt,
                },
              };
            }

            const cancelled = await cancelDeferredResumeForSessionFile({
              sessionFile,
              id,
            });
            publishSessionMetaChanged(sessionId);
            return {
              content: [{ type: 'text' as const, text: `Cancelled queued continuation ${cancelled.id}.` }],
              details: {
                action: 'cancel',
                sessionId,
                sessionFile,
                id: cancelled.id,
                prompt: cancelled.prompt,
              },
            };
          }

          default:
            throw new Error(`Unsupported conversation queue action: ${String(action)}`);
        }
      },
    });
  };
}
