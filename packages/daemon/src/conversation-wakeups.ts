import {
  createProjectActivityEntry,
  getAlert,
  getConversationProjectLink,
  readSessionConversationId,
  setActivityConversationLinks,
  upsertAlert,
  writeProfileActivityEntry,
  type DeferredResumeRecord,
} from '@personal-agent/core';

function sanitizeIdSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized.length > 0 ? sanitized : 'item';
}

function firstPromptLine(prompt: string): string {
  const line = prompt
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.length > 0);

  return line ?? prompt.trim();
}

function buildWakeupSummary(record: DeferredResumeRecord): string {
  switch (record.kind) {
    case 'reminder':
      return record.title?.trim().length
        ? `${record.title.trim()} is due.`
        : 'Reminder is due.';
    case 'task-callback':
      return record.title?.trim().length
        ? record.title.trim()
        : 'Scheduled task result is ready.';
    default:
      return 'Deferred resume fired. Open the conversation to continue.';
  }
}

function buildWakeupDetails(record: DeferredResumeRecord): string {
  const lines = [
    `Kind: ${record.kind}`,
    `Session file: ${record.sessionFile}`,
    `Due at: ${record.dueAt}`,
    ...(record.readyAt ? [`Ready at: ${record.readyAt}`] : []),
    ...(record.title ? [`Title: ${record.title}`] : []),
    `Prompt: ${record.prompt}`,
  ];

  return lines.join('\n');
}

function buildAlertTitle(record: DeferredResumeRecord): string {
  switch (record.kind) {
    case 'reminder':
      return record.title?.trim().length
        ? record.title.trim()
        : 'Reminder due';
    case 'task-callback':
      return record.title?.trim().length
        ? record.title.trim()
        : 'Scheduled task update';
    default:
      return record.title?.trim().length
        ? record.title.trim()
        : 'Conversation wakeup ready';
  }
}

function buildAlertBody(record: DeferredResumeRecord): string {
  if (record.kind === 'task-callback' || record.kind === 'reminder') {
    const line = firstPromptLine(record.prompt);
    return line.length > 0 ? line : buildWakeupSummary(record);
  }

  return record.prompt.trim().length > 0
    ? firstPromptLine(record.prompt)
    : 'Open the conversation to continue.';
}

export function buildDeferredResumeActivityId(record: DeferredResumeRecord): string {
  return `deferred-resume-fired-${sanitizeIdSegment(record.id)}`;
}

export function buildDeferredResumeAlertId(record: DeferredResumeRecord): string {
  return `wakeup-${sanitizeIdSegment(record.id)}`;
}

export function surfaceReadyDeferredResume(input: {
  entry: DeferredResumeRecord;
  repoRoot?: string;
  profile: string;
  stateRoot: string;
  conversationId?: string;
}): { activityId: string; alertId?: string } {
  const conversationId = input.conversationId ?? readSessionConversationId(input.entry.sessionFile);
  const relatedProjectIds = conversationId
    ? (getConversationProjectLink({
        stateRoot: input.stateRoot,
        profile: input.profile,
        conversationId,
      })?.relatedProjectIds ?? [])
    : [];
  const activityId = buildDeferredResumeActivityId(input.entry);

  writeProfileActivityEntry({
    stateRoot: input.stateRoot,
    repoRoot: input.repoRoot,
    profile: input.profile,
    entry: createProjectActivityEntry({
      id: activityId,
      createdAt: input.entry.readyAt ?? input.entry.dueAt,
      profile: input.profile,
      kind: input.entry.kind === 'reminder' ? 'reminder' : 'deferred-resume',
      summary: buildWakeupSummary(input.entry),
      details: buildWakeupDetails(input.entry),
      relatedProjectIds: relatedProjectIds.length > 0 ? relatedProjectIds : undefined,
      notificationState: 'none',
    }),
  });

  setActivityConversationLinks({
    stateRoot: input.stateRoot,
    profile: input.profile,
    activityId,
    relatedConversationIds: conversationId ? [conversationId] : [],
    updatedAt: input.entry.readyAt ?? input.entry.dueAt,
  });

  if (input.entry.delivery.alertLevel === 'none' || !conversationId) {
    return { activityId };
  }

  const alertId = buildDeferredResumeAlertId(input.entry);
  const existing = getAlert({ stateRoot: input.stateRoot, profile: input.profile, alertId });
  if (!existing) {
    upsertAlert({
      stateRoot: input.stateRoot,
      profile: input.profile,
      alert: {
        id: alertId,
        profile: input.profile,
        kind: input.entry.kind === 'task-callback' ? 'task-callback' : input.entry.kind === 'reminder' ? 'reminder' : 'deferred-resume',
        severity: input.entry.delivery.alertLevel === 'passive' ? 'passive' : 'disruptive',
        status: 'active',
        title: buildAlertTitle(input.entry),
        body: buildAlertBody(input.entry),
        createdAt: input.entry.readyAt ?? input.entry.dueAt,
        conversationId,
        activityId,
        sourceKind: input.entry.source?.kind ?? 'deferred-resume',
        sourceId: input.entry.source?.id ?? input.entry.id,
        requiresAck: input.entry.delivery.requireAck,
      },
    });
  }

  return { activityId, alertId };
}
