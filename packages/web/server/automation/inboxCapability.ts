import { setActivityConversationLinks } from '@personal-agent/core';
import { resolveConversationCwd } from '../conversations/conversationCwd.js';
import {
  listConversationSessionsSnapshot,
  toggleConversationAttention,
} from '../conversations/conversationService.js';
import { createSession as createLiveSession, queuePromptContext } from '../conversations/liveSessions.js';
import { invalidateAppTopics } from '../shared/appEvents.js';
import type { SavedWebUiPreferences } from '../ui/webUiPreferences.js';
import {
  clearInboxForCurrentProfile,
  findActivityRecord,
  listActivityForCurrentProfile,
  markActivityReadState,
} from './inboxService.js';

type LiveSessionCreateOptions = Parameters<typeof createLiveSession>[1];
type LiveSessionCreateResourceOptions = Omit<NonNullable<LiveSessionCreateOptions>, 'extensionFactories'>;
type LiveSessionExtensionFactories = NonNullable<LiveSessionCreateOptions>['extensionFactories'];

export interface InboxCapabilityContext {
  getCurrentProfile: () => string;
  getRepoRoot: () => string;
  getDefaultWebCwd: () => string;
  buildLiveSessionResourceOptions: (profile?: string) => LiveSessionCreateResourceOptions;
  buildLiveSessionExtensionFactories: () => LiveSessionExtensionFactories;
  getSavedWebUiPreferences: () => SavedWebUiPreferences;
}

export class InboxCapabilityInputError extends Error {}

function normalizeId(value: string): string {
  return value.trim();
}

function buildInboxActivityConversationContext(entry: {
  id: string;
  kind: string;
  createdAt: string;
  summary: string;
  notificationState?: string;
  details?: string;
  relatedConversationIds?: string[];
}): string {
  const lines = [
    'Activity context for this conversation:',
    `- activity id: ${entry.id}`,
    `- kind: ${entry.kind}`,
    `- created at: ${entry.createdAt}`,
    `- summary: ${entry.summary}`,
  ];

  if (entry.notificationState) {
    lines.push(`- notification state: ${entry.notificationState}`);
  }

  if (entry.details && entry.details.trim().length > 0) {
    lines.push('', 'Details:', entry.details.trim());
  }

  lines.push('', 'Use this activity item as durable context for follow-up in this conversation.');
  return lines.join('\n');
}

export function readActivityEntriesCapability(profile: string) {
  return listActivityForCurrentProfile(profile);
}

export const listActivityCapability = readActivityEntriesCapability;

export function readActivityDetailCapability(profile: string, activityId: string) {
  const normalizedActivityId = normalizeId(activityId);
  if (!normalizedActivityId) {
    return undefined;
  }

  const match = findActivityRecord(profile, normalizedActivityId);
  return match ? { ...match.entry, read: match.read } : undefined;
}

export const readActivityCapability = readActivityDetailCapability;

export function markActivityReadCapability(profile: string, activityId: string, read = true) {
  const normalizedActivityId = normalizeId(activityId);
  if (!normalizedActivityId) {
    return false;
  }

  const changed = markActivityReadState(profile, normalizedActivityId, read);
  if (changed) {
    invalidateAppTopics('sessions');
  }

  return changed;
}

function resolveOpenConversationIds(input: {
  openConversationIds?: Iterable<string>;
  preferences?: SavedWebUiPreferences;
}): string[] {
  if (input.openConversationIds) {
    return [...input.openConversationIds];
  }

  const preferences = input.preferences;
  if (!preferences) {
    return [];
  }

  return [...preferences.openConversationIds, ...preferences.pinnedConversationIds];
}

export function clearInboxCapability(
  input: { profile: string; openConversationIds: Iterable<string> } | string,
  preferences?: SavedWebUiPreferences,
) {
  const profile = typeof input === 'string' ? input : input.profile;
  const openConversationIds = resolveOpenConversationIds({
    openConversationIds: typeof input === 'string' ? undefined : input.openConversationIds,
    preferences,
  });

  const result = clearInboxForCurrentProfile({
    profile,
    sessions: listConversationSessionsSnapshot(),
    openConversationIds,
  });

  if (result.deletedActivityIds.length > 0 || result.clearedConversationIds.length > 0) {
    invalidateAppTopics('sessions');
  }

  return result;
}

export async function startActivityConversationCapability(activityId: string, context: InboxCapabilityContext) {
  const profile = context.getCurrentProfile();
  const normalizedActivityId = normalizeId(activityId);
  if (!normalizedActivityId) {
    throw new InboxCapabilityInputError('activityId required');
  }

  const match = findActivityRecord(profile, normalizedActivityId);
  if (!match) {
    throw new Error('Not found');
  }

  const cwd = resolveConversationCwd({
    repoRoot: context.getRepoRoot(),
    profile,
    defaultCwd: context.getDefaultWebCwd(),
  });

  const result = await createLiveSession(cwd, {
    ...context.buildLiveSessionResourceOptions(profile),
    extensionFactories: context.buildLiveSessionExtensionFactories(),
  });

  const relatedConversationIds = [...new Set([...(match.entry.relatedConversationIds ?? []), result.id])];
  setActivityConversationLinks({
    stateRoot: match.stateRoot,
    profile,
    activityId: match.entry.id,
    relatedConversationIds,
  });

  await queuePromptContext(result.id, 'referenced_context', buildInboxActivityConversationContext({
    ...match.entry,
    relatedConversationIds,
  }));

  invalidateAppTopics('sessions');

  return {
    activityId: match.entry.id,
    id: result.id,
    sessionFile: result.sessionFile,
    cwd,
    relatedConversationIds,
  };
}

export function markConversationAttentionCapability(profile: string, conversationId: string, read = true) {
  const normalizedConversationId = normalizeId(conversationId);
  if (!normalizedConversationId) {
    return false;
  }

  const updated = toggleConversationAttention({
    profile,
    conversationId: normalizedConversationId,
    read,
  });
  if (updated) {
    invalidateAppTopics('sessions');
  }

  return updated;
}

export function readSavedWebUiPreferencesCapability(getSavedWebUiPreferences: () => SavedWebUiPreferences) {
  return getSavedWebUiPreferences();
}
