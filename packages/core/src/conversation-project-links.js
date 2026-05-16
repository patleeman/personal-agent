import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { validateProjectId } from './projects.js';
import { getStateRoot } from './runtime/paths.js';
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
function getConversationLinkStateRoot(stateRoot) {
  return resolve(stateRoot ?? getStateRoot());
}
function validateProfileName(profile) {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(`Invalid profile name "${profile}". Profile names may only include letters, numbers, dashes, and underscores.`);
  }
}
export function validateConversationId(conversationId) {
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) {
    throw new Error(
      `Invalid conversation id "${conversationId}". Conversation ids may only include letters, numbers, dots, colons, dashes, and underscores.`,
    );
  }
}
export function resolveProfileConversationLinksDir(options) {
  validateProfileName(options.profile);
  return join(getConversationLinkStateRoot(options.stateRoot), 'pi-agent', 'state', 'conversation-project-links', options.profile);
}
export function resolveConversationLinkPath(options) {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  return join(resolveProfileConversationLinksDir(options), `${options.conversationId}.json`);
}
function normalizeIsoTimestamp(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return new Date(parsed).toISOString();
}
function normalizeRelatedProjectIds(projectIds) {
  const unique = [];
  const seen = new Set();
  for (const projectId of projectIds) {
    validateProjectId(projectId);
    if (seen.has(projectId)) {
      continue;
    }
    seen.add(projectId);
    unique.push(projectId);
  }
  return unique;
}
export function readConversationProjectLink(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf-8'));
  const conversationId = typeof parsed.conversationId === 'string' ? parsed.conversationId.trim() : '';
  const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt.trim() : '';
  const relatedProjectIds = Array.isArray(parsed.relatedProjectIds)
    ? parsed.relatedProjectIds.filter((value) => typeof value === 'string' && value.trim().length > 0)
    : [];
  validateConversationId(conversationId);
  return {
    conversationId,
    updatedAt: normalizeIsoTimestamp(updatedAt, `conversation link updatedAt in ${path}`),
    relatedProjectIds: normalizeRelatedProjectIds(relatedProjectIds),
  };
}
export function listConversationProjectLinks(options) {
  const dir = resolveProfileConversationLinksDir(options);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      try {
        return readConversationProjectLink(join(dir, entry));
      } catch {
        return null;
      }
    })
    .filter((document) => document !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
export function listConversationIdsForProject(options) {
  validateProjectId(options.projectId);
  return listConversationProjectLinks(options)
    .filter((document) => document.relatedProjectIds.includes(options.projectId))
    .map((document) => document.conversationId);
}
export function getConversationProjectLink(options) {
  const path = resolveConversationLinkPath(options);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return readConversationProjectLink(path);
  } catch {
    return null;
  }
}
export function writeConversationProjectLink(options) {
  validateProfileName(options.profile);
  validateConversationId(options.document.conversationId);
  const path = resolveConversationLinkPath({
    stateRoot: options.stateRoot,
    profile: options.profile,
    conversationId: options.document.conversationId,
  });
  const normalized = {
    conversationId: options.document.conversationId,
    updatedAt: normalizeIsoTimestamp(options.document.updatedAt, 'conversation link updatedAt'),
    relatedProjectIds: normalizeRelatedProjectIds(options.document.relatedProjectIds),
  };
  const dir = resolveProfileConversationLinksDir({ stateRoot: options.stateRoot, profile: options.profile });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(tempPath, JSON.stringify(normalized, null, 2) + '\n');
    renameSync(tempPath, path);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore temp cleanup errors.
    }
    throw error;
  }
  return path;
}
export function setConversationProjectLinks(options) {
  const document = {
    conversationId: options.conversationId,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
    relatedProjectIds: normalizeRelatedProjectIds(options.relatedProjectIds),
  };
  writeConversationProjectLink({
    stateRoot: options.stateRoot,
    profile: options.profile,
    document,
  });
  return getConversationProjectLink({ stateRoot: options.stateRoot, profile: options.profile, conversationId: options.conversationId });
}
export function addConversationProjectLink(options) {
  const existing = getConversationProjectLink(options);
  return setConversationProjectLinks({
    stateRoot: options.stateRoot,
    profile: options.profile,
    conversationId: options.conversationId,
    relatedProjectIds: [...(existing?.relatedProjectIds ?? []), options.projectId],
    updatedAt: options.updatedAt,
  });
}
export function removeConversationProjectLink(options) {
  validateProjectId(options.projectId);
  const existing = getConversationProjectLink(options);
  return setConversationProjectLinks({
    stateRoot: options.stateRoot,
    profile: options.profile,
    conversationId: options.conversationId,
    relatedProjectIds: (existing?.relatedProjectIds ?? []).filter((id) => id !== options.projectId),
    updatedAt: options.updatedAt,
  });
}
