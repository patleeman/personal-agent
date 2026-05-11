import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { validateConversationId } from './conversation-project-links.js';
import { getDurableConversationAttentionDir, getStateRoot } from './runtime/paths.js';
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
function getConversationAttentionStateRoot(stateRoot) {
  return resolve(stateRoot ?? getStateRoot());
}
function resolveLegacyConversationAttentionStatePath(options) {
  return join(
    getConversationAttentionStateRoot(options.stateRoot),
    'pi-agent',
    'state',
    'conversation-attention',
    `${options.profile}.json`,
  );
}
function validateProfileName(profile) {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(`Invalid profile name "${profile}". Profile names may only include letters, numbers, dashes, and underscores.`);
  }
}
function normalizeIsoTimestamp(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return new Date(parsed).toISOString();
}
function normalizeMessageCount(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return Math.floor(value);
}
function emptyDocument(profile) {
  return {
    version: 1,
    profile,
    conversations: {},
  };
}
function normalizeRecord(value, fallbackConversationId) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value;
  const conversationId = typeof record.conversationId === 'string' ? record.conversationId.trim() : (fallbackConversationId?.trim() ?? '');
  if (conversationId.length === 0) {
    return null;
  }
  validateConversationId(conversationId);
  if (
    typeof record.acknowledgedMessageCount !== 'number' ||
    !Number.isFinite(record.acknowledgedMessageCount) ||
    record.acknowledgedMessageCount < 0
  ) {
    return null;
  }
  if (typeof record.readAt !== 'string' || typeof record.updatedAt !== 'string') {
    return null;
  }
  return {
    conversationId,
    acknowledgedMessageCount: Math.floor(record.acknowledgedMessageCount),
    readAt: normalizeIsoTimestamp(record.readAt, 'conversation attention readAt'),
    updatedAt: normalizeIsoTimestamp(record.updatedAt, 'conversation attention updatedAt'),
    ...(record.forcedUnread ? { forcedUnread: true } : {}),
  };
}
function normalizeDocument(value, fallbackProfile) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const document = value;
  const profile = typeof document.profile === 'string' ? document.profile.trim() : (fallbackProfile?.trim() ?? '');
  if (document.version !== 1 || profile.length === 0 || !document.conversations || typeof document.conversations !== 'object') {
    return null;
  }
  validateProfileName(profile);
  const conversations = {};
  for (const [conversationId, record] of Object.entries(document.conversations)) {
    const normalized = normalizeRecord(record, conversationId);
    if (!normalized) {
      continue;
    }
    conversations[normalized.conversationId] = normalized;
  }
  return {
    version: 1,
    profile,
    conversations: sortConversationIds(conversations),
  };
}
function readConversationAttentionStateFile(path, profile) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return normalizeDocument(JSON.parse(readFileSync(path, 'utf-8')), profile);
  } catch {
    return null;
  }
}
function mergeRecord(left, right) {
  if (left.conversationId !== right.conversationId) {
    throw new Error('Cannot merge conversation attention records with different conversation ids.');
  }
  const readAt = left.readAt >= right.readAt ? left.readAt : right.readAt;
  const newestUpdatedAt = left.updatedAt >= right.updatedAt ? left.updatedAt : right.updatedAt;
  const updatedAt = newestUpdatedAt >= readAt ? newestUpdatedAt : readAt;
  const latestForcedUnreadAt = [left, right]
    .filter((record) => record.forcedUnread)
    .map((record) => record.updatedAt)
    .sort((earlier, later) => later.localeCompare(earlier))[0];
  const forcedUnread = Boolean(latestForcedUnreadAt && latestForcedUnreadAt > readAt);
  return {
    conversationId: left.conversationId,
    acknowledgedMessageCount: Math.max(left.acknowledgedMessageCount, right.acknowledgedMessageCount),
    readAt,
    updatedAt,
    ...(forcedUnread ? { forcedUnread: true } : {}),
  };
}
function sortConversationIds(conversations) {
  return Object.fromEntries(Object.entries(conversations).sort(([left], [right]) => left.localeCompare(right)));
}
export function resolveConversationAttentionStatePath(options) {
  validateProfileName(options.profile);
  return join(getDurableConversationAttentionDir(options.stateRoot), `${options.profile}.json`);
}
export function loadConversationAttentionState(options) {
  validateProfileName(options.profile);
  const path = resolveConversationAttentionStatePath(options);
  const document = readConversationAttentionStateFile(path, options.profile);
  if (document) {
    return document;
  }
  const legacyPath = resolveLegacyConversationAttentionStatePath(options);
  if (legacyPath === path) {
    return emptyDocument(options.profile);
  }
  const legacyDocument = readConversationAttentionStateFile(legacyPath, options.profile);
  if (!legacyDocument) {
    return emptyDocument(options.profile);
  }
  saveConversationAttentionState({
    profile: options.profile,
    stateRoot: options.stateRoot,
    document: legacyDocument,
  });
  return legacyDocument;
}
export function saveConversationAttentionState(options) {
  validateProfileName(options.profile);
  if (options.document.version !== 1 || options.document.profile !== options.profile) {
    throw new Error(`Conversation attention document profile mismatch for ${options.profile}.`);
  }
  const conversations = {};
  for (const [conversationId, value] of Object.entries(options.document.conversations)) {
    const normalized = normalizeRecord(value, conversationId);
    if (!normalized) {
      continue;
    }
    conversations[normalized.conversationId] = normalized;
  }
  const path = resolveConversationAttentionStatePath(options);
  mkdirSync(getDurableConversationAttentionDir(options.stateRoot), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        version: 1,
        profile: options.profile,
        conversations: sortConversationIds(conversations),
      },
      null,
      2,
    ) + '\n',
  );
  return path;
}
export function mergeConversationAttentionStateDocuments(options) {
  const explicitProfile = options.profile?.trim();
  if (explicitProfile) {
    validateProfileName(explicitProfile);
  }
  const documents = options.documents
    .map((document) => normalizeDocument(document, explicitProfile))
    .filter((document) => document !== null);
  const profiles = new Set(documents.map((document) => document.profile));
  if (explicitProfile) {
    profiles.add(explicitProfile);
  }
  if (profiles.size === 0) {
    throw new Error('No valid conversation attention documents were provided to merge.');
  }
  if (profiles.size > 1) {
    throw new Error(`Cannot merge conversation attention documents with different profiles: ${Array.from(profiles).join(', ')}`);
  }
  const profile = Array.from(profiles)[0];
  const conversations = {};
  for (const document of documents) {
    for (const [conversationId, record] of Object.entries(document.conversations)) {
      const normalized = normalizeRecord(record, conversationId);
      if (!normalized) {
        continue;
      }
      const existing = conversations[normalized.conversationId];
      conversations[normalized.conversationId] = existing ? mergeRecord(existing, normalized) : normalized;
    }
  }
  return {
    version: 1,
    profile,
    conversations: sortConversationIds(conversations),
  };
}
export function ensureConversationAttentionBaselines(options) {
  const document = loadConversationAttentionState(options);
  const updatedAt = normalizeIsoTimestamp(options.updatedAt ?? new Date().toISOString(), 'conversation attention updatedAt');
  let changed = false;
  for (const conversation of options.conversations) {
    validateConversationId(conversation.conversationId);
    const messageCount = normalizeMessageCount(conversation.messageCount, `Conversation ${conversation.conversationId} messageCount`);
    if (document.conversations[conversation.conversationId]) {
      continue;
    }
    document.conversations[conversation.conversationId] = {
      conversationId: conversation.conversationId,
      acknowledgedMessageCount: messageCount,
      readAt: new Date(0).toISOString(),
      updatedAt,
    };
    changed = true;
  }
  if (changed) {
    saveConversationAttentionState({
      profile: options.profile,
      stateRoot: options.stateRoot,
      document,
    });
  }
  return document;
}
export function markConversationAttentionRead(options) {
  validateConversationId(options.conversationId);
  const document = loadConversationAttentionState(options);
  const updatedAt = normalizeIsoTimestamp(options.updatedAt ?? new Date().toISOString(), 'conversation attention updatedAt');
  document.conversations[options.conversationId] = {
    conversationId: options.conversationId,
    acknowledgedMessageCount: normalizeMessageCount(options.messageCount, `Conversation ${options.conversationId} messageCount`),
    readAt: updatedAt,
    updatedAt,
  };
  saveConversationAttentionState({
    profile: options.profile,
    stateRoot: options.stateRoot,
    document,
  });
  return document;
}
export function markConversationAttentionUnread(options) {
  validateConversationId(options.conversationId);
  const document = loadConversationAttentionState(options);
  const updatedAt = normalizeIsoTimestamp(options.updatedAt ?? new Date().toISOString(), 'conversation attention updatedAt');
  const existing = document.conversations[options.conversationId];
  document.conversations[options.conversationId] = {
    conversationId: options.conversationId,
    acknowledgedMessageCount: existing
      ? existing.acknowledgedMessageCount
      : normalizeMessageCount(options.messageCount ?? 0, `Conversation ${options.conversationId} messageCount`),
    readAt: existing?.readAt ?? updatedAt,
    updatedAt,
    forcedUnread: true,
  };
  saveConversationAttentionState({
    profile: options.profile,
    stateRoot: options.stateRoot,
    document,
  });
  return document;
}
export function summarizeConversationAttention(options) {
  const document = ensureConversationAttentionBaselines({
    profile: options.profile,
    stateRoot: options.stateRoot,
    conversations: options.conversations,
    updatedAt: options.updatedAt,
  });
  const unreadActivitiesByConversationId = new Map();
  for (const activity of options.unreadActivityEntries ?? []) {
    validateActivity(activity);
    for (const conversationId of activity.relatedConversationIds) {
      const existing = unreadActivitiesByConversationId.get(conversationId) ?? [];
      existing.push({ id: activity.id, createdAt: normalizeIsoTimestamp(activity.createdAt, `Activity ${activity.id} createdAt`) });
      unreadActivitiesByConversationId.set(conversationId, existing);
    }
  }
  return options.conversations.map((conversation) => {
    validateConversationId(conversation.conversationId);
    const messageCount = normalizeMessageCount(conversation.messageCount, `Conversation ${conversation.conversationId} messageCount`);
    const record = document.conversations[conversation.conversationId] ?? {
      conversationId: conversation.conversationId,
      acknowledgedMessageCount: messageCount,
      readAt: normalizeIsoTimestamp(options.updatedAt ?? new Date().toISOString(), 'conversation attention updatedAt'),
      updatedAt: normalizeIsoTimestamp(options.updatedAt ?? new Date().toISOString(), 'conversation attention updatedAt'),
    };
    const visibleActivities = (unreadActivitiesByConversationId.get(conversation.conversationId) ?? [])
      .filter((activity) => activity.createdAt > record.readAt)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const unreadMessageCount = Math.max(0, messageCount - record.acknowledgedMessageCount);
    const latestVisibleActivityAt = visibleActivities[0]?.createdAt;
    const lastActivityAt = conversation.lastActivityAt
      ? normalizeIsoTimestamp(conversation.lastActivityAt, `Conversation ${conversation.conversationId} lastActivityAt`)
      : undefined;
    const needsAttention = Boolean(record.forcedUnread) || unreadMessageCount > 0 || visibleActivities.length > 0;
    const attentionUpdatedAt = latestVisibleActivityAt ?? (unreadMessageCount > 0 ? lastActivityAt : undefined) ?? record.updatedAt;
    return {
      conversationId: conversation.conversationId,
      acknowledgedMessageCount: record.acknowledgedMessageCount,
      readAt: record.readAt,
      updatedAt: record.updatedAt,
      forcedUnread: Boolean(record.forcedUnread),
      unreadMessageCount,
      unreadActivityCount: visibleActivities.length,
      unreadActivityIds: visibleActivities.map((activity) => activity.id),
      needsAttention,
      attentionUpdatedAt,
    };
  });
}
function validateActivity(activity) {
  if (typeof activity.id !== 'string' || activity.id.trim().length === 0) {
    throw new Error('Conversation attention activity id must not be empty.');
  }
  if (!Array.isArray(activity.relatedConversationIds)) {
    throw new Error(`Conversation attention activity ${activity.id} must include related conversation ids.`);
  }
  for (const conversationId of activity.relatedConversationIds) {
    validateConversationId(conversationId);
  }
}
