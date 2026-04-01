import { existsSync, rmSync } from 'node:fs';
import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  clearActivityConversationLinks,
  createProjectActivityEntry,
  getActivityConversationLink,
  listProfileActivityEntries,
  loadProfileActivityReadState,
  resolveActivityEntryPath,
  saveProfileActivityReadState,
  setActivityConversationLinks,
  validateActivityId,
  writeProfileActivityEntry,
} from '@personal-agent/core';
import { invalidateAppTopics } from '../shared/appEvents.js';

const ACTIVITY_ACTION_VALUES = [
  'list',
  'get',
  'create',
  'mark_read',
  'mark_unread',
  'delete',
] as const;

const ACTIVITY_NOTIFICATION_STATE_VALUES = ['none', 'queued', 'sent', 'failed'] as const;

type ActivityAction = (typeof ACTIVITY_ACTION_VALUES)[number];
type ActivityNotificationState = (typeof ACTIVITY_NOTIFICATION_STATE_VALUES)[number];

const ActivityToolParams = Type.Object({
  action: Type.Union(ACTIVITY_ACTION_VALUES.map((value) => Type.Literal(value))),
  activityId: Type.Optional(Type.String({ description: 'Activity id for get/read/unread/delete actions.' })),
  activityIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'Optional list of activity ids for bulk mark_read/mark_unread/delete.' })),
  summary: Type.Optional(Type.String({ description: 'Activity summary for create.' })),
  details: Type.Optional(Type.String({ description: 'Optional detailed body for create.' })),
  kind: Type.Optional(Type.String({ description: 'Activity kind for create. Defaults to note.' })),
  relatedProjectIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'Optional related project ids for create.' })),
  relatedConversationIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'Optional related conversation ids for create.' })),
  notificationState: Type.Optional(Type.Union(ACTIVITY_NOTIFICATION_STATE_VALUES.map((value) => Type.Literal(value)))),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
});

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function readOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function sanitizeActivityIdSegment(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized.length > 0 ? sanitized : 'item';
}

function buildDefaultActivityId(kind: string, summary: string, createdAt: string): string {
  const kindSegment = sanitizeActivityIdSegment(kind);
  const createdAtSegment = sanitizeActivityIdSegment(createdAt.replace(/[.:]/g, '-'));
  const summarySegment = sanitizeActivityIdSegment(summary).slice(0, 48);
  return [kindSegment, createdAtSegment, summarySegment || 'item'].join('-');
}

function resolveUniqueActivityId(options: {
  profile: string;
  stateRoot?: string;
  desiredId: string;
}): string {
  const baseId = options.desiredId;
  validateActivityId(baseId);

  const exists = (candidate: string): boolean => existsSync(resolveActivityEntryPath({
    stateRoot: options.stateRoot,
    profile: options.profile,
    activityId: candidate,
  }));

  if (!exists(baseId)) {
    return baseId;
  }

  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const candidate = `${baseId}-${suffix}`;
    if (!exists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to allocate a unique activity id based on: ${baseId}`);
}

function readActivityIds(params: { activityId?: string; activityIds?: string[] }, label: string): string[] {
  const values = [
    ...(params.activityId ? [params.activityId] : []),
    ...(params.activityIds ?? []),
  ]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (values.length === 0) {
    throw new Error(`${label} is required.`);
  }

  const unique: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    validateActivityId(value);
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    unique.push(value);
  }

  return unique;
}

function formatActivitySummary(entry: ReturnType<typeof listProfileActivityEntries>[number]['entry'], read: boolean, relatedConversationIds: string[]): string {
  const lines = [
    `@${entry.id}`,
    `kind: ${entry.kind}`,
    `read: ${read ? 'yes' : 'no'}`,
    `created: ${entry.createdAt}`,
    `summary: ${entry.summary}`,
  ];

  if (entry.details) {
    lines.push(`details: ${entry.details}`);
  }

  if (entry.relatedProjectIds && entry.relatedProjectIds.length > 0) {
    lines.push(`projects: ${entry.relatedProjectIds.join(', ')}`);
  }

  if (relatedConversationIds.length > 0) {
    lines.push(`conversations: ${relatedConversationIds.join(', ')}`);
  }

  if (entry.notificationState) {
    lines.push(`notification: ${entry.notificationState}`);
  }

  return lines.join('\n');
}

function formatActivityList(lines: string[]): string {
  if (lines.length === 0) {
    return 'No activity items found.';
  }

  return ['Activity items:', ...lines.map((line) => `- ${line}`)].join('\n');
}

export function createActivityAgentExtension(options: {
  stateRoot?: string;
  getCurrentProfile: () => string;
}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'activity',
      label: 'Activity',
      description: 'Inspect and manage durable inbox/activity items for the active profile.',
      promptSnippet: 'Use the activity tool for durable inbox items and explicit attention management.',
      promptGuidelines: [
        'Use this tool when you need to create, inspect, or manage durable inbox/activity items for the active profile.',
        'Prefer activity for explicit asynchronous outcomes or reminders, not as a second transcript.',
        'Use create for high-signal durable attention items; use mark_read/mark_unread when triaging inbox state.',
      ],
      parameters: ActivityToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        try {
          const profile = options.getCurrentProfile();

          switch (params.action as ActivityAction) {
            case 'list': {
              const readState = loadProfileActivityReadState({ stateRoot: options.stateRoot, profile });
              const limit = Math.max(1, Math.min(100, Math.floor(params.limit ?? 20)));
              const entries = listProfileActivityEntries({ stateRoot: options.stateRoot, profile })
                .slice(0, limit)
                .map(({ entry }) => {
                  const relatedConversationIds = getActivityConversationLink({
                    stateRoot: options.stateRoot,
                    profile,
                    activityId: entry.id,
                  })?.relatedConversationIds ?? [];
                  return {
                    entry,
                    read: readState.has(entry.id),
                    relatedConversationIds,
                  };
                });

              return {
                content: [{
                  type: 'text' as const,
                  text: formatActivityList(entries.map(({ entry, read, relatedConversationIds }) => {
                    const unreadMarker = read ? '' : ' [unread]';
                    const projectSuffix = entry.relatedProjectIds && entry.relatedProjectIds.length > 0
                      ? ` · projects ${entry.relatedProjectIds.join(', ')}`
                      : '';
                    const conversationSuffix = relatedConversationIds.length > 0
                      ? ` · conversations ${relatedConversationIds.join(', ')}`
                      : '';
                    return `@${entry.id}${unreadMarker} · ${entry.kind} · ${entry.summary}${projectSuffix}${conversationSuffix}`;
                  })),
                }],
                details: {
                  action: 'list',
                  profile,
                  count: entries.length,
                  activityIds: entries.map(({ entry }) => entry.id),
                },
              };
            }

            case 'get': {
              const activityId = readRequiredString(params.activityId, 'activityId');
              const readState = loadProfileActivityReadState({ stateRoot: options.stateRoot, profile });
              const record = listProfileActivityEntries({ stateRoot: options.stateRoot, profile })
                .find(({ entry }) => entry.id === activityId);
              if (!record) {
                throw new Error(`Activity not found: ${activityId}`);
              }

              const relatedConversationIds = getActivityConversationLink({
                stateRoot: options.stateRoot,
                profile,
                activityId,
              })?.relatedConversationIds ?? [];

              return {
                content: [{
                  type: 'text' as const,
                  text: formatActivitySummary(record.entry, readState.has(activityId), relatedConversationIds),
                }],
                details: {
                  action: 'get',
                  profile,
                  activityId,
                },
              };
            }

            case 'create': {
              const createdAt = new Date().toISOString();
              const kind = readOptionalString(params.kind) ?? 'note';
              const summary = readRequiredString(params.summary, 'summary');
              const relatedProjectIds = (params.relatedProjectIds ?? []).map((value) => readRequiredString(value, 'relatedProjectIds'));
              const relatedConversationIds = (params.relatedConversationIds ?? []).map((value) => readRequiredString(value, 'relatedConversationIds'));
              const desiredId = readOptionalString(params.activityId)
                ?? buildDefaultActivityId(kind, summary, createdAt);
              const activityId = resolveUniqueActivityId({
                profile,
                stateRoot: options.stateRoot,
                desiredId,
              });
              const notificationState = (params.notificationState ?? 'none') as ActivityNotificationState;
              const entry = createProjectActivityEntry({
                id: activityId,
                createdAt,
                profile,
                kind,
                summary,
                details: readOptionalString(params.details),
                relatedProjectIds,
                notificationState,
              });

              writeProfileActivityEntry({
                stateRoot: options.stateRoot,
                profile,
                entry,
              });

              if (relatedConversationIds.length > 0) {
                setActivityConversationLinks({
                  stateRoot: options.stateRoot,
                  profile,
                  activityId,
                  relatedConversationIds,
                });
              }

              invalidateAppTopics('activity');
              return {
                content: [{ type: 'text' as const, text: `Created activity @${activityId}.` }],
                details: {
                  action: 'create',
                  profile,
                  activityId,
                  relatedProjectIds,
                  relatedConversationIds,
                },
              };
            }

            case 'mark_read':
            case 'mark_unread': {
              const activityIds = readActivityIds(params, 'activityId or activityIds');
              const readState = loadProfileActivityReadState({ stateRoot: options.stateRoot, profile });

              for (const activityId of activityIds) {
                if (params.action === 'mark_read') {
                  readState.add(activityId);
                } else {
                  readState.delete(activityId);
                }
              }

              saveProfileActivityReadState({
                stateRoot: options.stateRoot,
                profile,
                ids: readState,
              });

              invalidateAppTopics('activity');
              return {
                content: [{
                  type: 'text' as const,
                  text: `${params.action === 'mark_read' ? 'Marked read' : 'Marked unread'}: ${activityIds.map((id) => `@${id}`).join(', ')}`,
                }],
                details: {
                  action: params.action,
                  profile,
                  activityIds,
                },
              };
            }

            case 'delete': {
              const activityIds = readActivityIds(params, 'activityId or activityIds');

              for (const activityId of activityIds) {
                rmSync(resolveActivityEntryPath({
                  stateRoot: options.stateRoot,
                  profile,
                  activityId,
                }), { force: true });
                clearActivityConversationLinks({
                  stateRoot: options.stateRoot,
                  profile,
                  activityId,
                });
              }

              const readState = loadProfileActivityReadState({ stateRoot: options.stateRoot, profile });
              for (const activityId of activityIds) {
                readState.delete(activityId);
              }
              saveProfileActivityReadState({
                stateRoot: options.stateRoot,
                profile,
                ids: readState,
              });

              invalidateAppTopics('activity');
              return {
                content: [{
                  type: 'text' as const,
                  text: `Deleted activity item${activityIds.length === 1 ? '' : 's'}: ${activityIds.map((id) => `@${id}`).join(', ')}`,
                }],
                details: {
                  action: 'delete',
                  profile,
                  activityIds,
                },
              };
            }

            default:
              throw new Error(`Unsupported activity action: ${String(params.action)}`);
          }
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
            isError: true,
            details: {
              action: params.action,
            },
          };
        }
      },
    });
  };
}
