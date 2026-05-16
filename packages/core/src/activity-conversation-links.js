import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { validateActivityId } from './activity.js';
import { validateConversationId } from './conversation-project-links.js';
import { getStateRoot } from './runtime/paths.js';
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
function getActivityConversationLinkStateRoot(stateRoot) {
  return resolve(stateRoot ?? getStateRoot());
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
function normalizeRelatedConversationIds(conversationIds) {
  const unique = [];
  const seen = new Set();
  for (const conversationId of conversationIds) {
    validateConversationId(conversationId);
    if (seen.has(conversationId)) {
      continue;
    }
    seen.add(conversationId);
    unique.push(conversationId);
  }
  return unique;
}
export function resolveProfileActivityConversationLinksDir(options) {
  validateProfileName(options.profile);
  return join(getActivityConversationLinkStateRoot(options.stateRoot), 'pi-agent', 'state', 'activity-conversation-links', options.profile);
}
export function resolveActivityConversationLinkPath(options) {
  validateProfileName(options.profile);
  validateActivityId(options.activityId);
  return join(resolveProfileActivityConversationLinksDir(options), `${options.activityId}.json`);
}
export function readActivityConversationLink(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf-8'));
  const activityId = typeof parsed.activityId === 'string' ? parsed.activityId.trim() : '';
  const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt.trim() : '';
  const relatedConversationIds = Array.isArray(parsed.relatedConversationIds)
    ? parsed.relatedConversationIds.filter((value) => typeof value === 'string' && value.trim().length > 0)
    : [];
  validateActivityId(activityId);
  return {
    activityId,
    updatedAt: normalizeIsoTimestamp(updatedAt, `activity conversation link updatedAt in ${path}`),
    relatedConversationIds: normalizeRelatedConversationIds(relatedConversationIds),
  };
}
export function getActivityConversationLink(options) {
  const path = resolveActivityConversationLinkPath(options);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return readActivityConversationLink(path);
  } catch {
    return null;
  }
}
export function writeActivityConversationLink(options) {
  validateProfileName(options.profile);
  validateActivityId(options.document.activityId);
  const path = resolveActivityConversationLinkPath({
    stateRoot: options.stateRoot,
    profile: options.profile,
    activityId: options.document.activityId,
  });
  const normalized = {
    activityId: options.document.activityId,
    updatedAt: normalizeIsoTimestamp(options.document.updatedAt, 'activity conversation link updatedAt'),
    relatedConversationIds: normalizeRelatedConversationIds(options.document.relatedConversationIds),
  };
  mkdirSync(resolveProfileActivityConversationLinksDir({ stateRoot: options.stateRoot, profile: options.profile }), {
    recursive: true,
  });
  writeFileSync(path, JSON.stringify(normalized, null, 2) + '\n');
  return path;
}
export function setActivityConversationLinks(options) {
  const normalizedRelatedConversationIds = normalizeRelatedConversationIds(options.relatedConversationIds);
  if (normalizedRelatedConversationIds.length === 0) {
    clearActivityConversationLinks(options);
    return null;
  }
  const document = {
    activityId: options.activityId,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
    relatedConversationIds: normalizedRelatedConversationIds,
  };
  writeActivityConversationLink({
    stateRoot: options.stateRoot,
    profile: options.profile,
    document,
  });
  return getActivityConversationLink({ stateRoot: options.stateRoot, profile: options.profile, activityId: options.activityId });
}
export function clearActivityConversationLinks(options) {
  const path = resolveActivityConversationLinkPath(options);
  rmSync(path, { force: true });
}
