import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { validateProjectId } from './projects.js';
import { getStateRoot } from './runtime/paths.js';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

export interface ResolveConversationLinkOptions {
  profile: string;
  stateRoot?: string;
}

export interface ResolveConversationLinkPathOptions extends ResolveConversationLinkOptions {
  conversationId: string;
}

export interface ConversationProjectLinkDocument {
  conversationId: string;
  updatedAt: string;
  relatedProjectIds: string[];
}

function getConversationLinkStateRoot(stateRoot?: string): string {
  return resolve(stateRoot ?? getStateRoot());
}

function validateProfileName(profile: string): void {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(
      `Invalid profile name "${profile}". Profile names may only include letters, numbers, dashes, and underscores.`,
    );
  }
}

export function validateConversationId(conversationId: string): void {
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) {
    throw new Error(
      `Invalid conversation id "${conversationId}". Conversation ids may only include letters, numbers, dots, colons, dashes, and underscores.`,
    );
  }
}

export function resolveProfileConversationLinksDir(options: ResolveConversationLinkOptions): string {
  validateProfileName(options.profile);
  return join(
    getConversationLinkStateRoot(options.stateRoot),
    'pi-agent',
    'state',
    'conversation-project-links',
    options.profile,
  );
}

export function resolveConversationLinkPath(options: ResolveConversationLinkPathOptions): string {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  return join(resolveProfileConversationLinksDir(options), `${options.conversationId}.json`);
}

function normalizeRelatedProjectIds(projectIds: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

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

export function readConversationProjectLink(path: string): ConversationProjectLinkDocument {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ConversationProjectLinkDocument>;
  const conversationId = typeof parsed.conversationId === 'string' ? parsed.conversationId.trim() : '';
  const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt.trim() : '';
  const relatedProjectIds = Array.isArray(parsed.relatedProjectIds)
    ? parsed.relatedProjectIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];

  validateConversationId(conversationId);
  if (updatedAt.length === 0 || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error(`Invalid conversation link updatedAt in ${path}`);
  }

  return {
    conversationId,
    updatedAt: new Date(Date.parse(updatedAt)).toISOString(),
    relatedProjectIds: normalizeRelatedProjectIds(relatedProjectIds),
  };
}

export function listConversationProjectLinks(options: ResolveConversationLinkOptions): ConversationProjectLinkDocument[] {
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
    .filter((document): document is ConversationProjectLinkDocument => document !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function listConversationIdsForProject(options: ResolveConversationLinkOptions & { projectId: string }): string[] {
  validateProjectId(options.projectId);

  return listConversationProjectLinks(options)
    .filter((document) => document.relatedProjectIds.includes(options.projectId))
    .map((document) => document.conversationId);
}

export function getConversationProjectLink(options: ResolveConversationLinkPathOptions): ConversationProjectLinkDocument | null {
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

export function writeConversationProjectLink(options: {
  stateRoot?: string;
  profile: string;
  document: ConversationProjectLinkDocument;
}): string {
  validateProfileName(options.profile);
  validateConversationId(options.document.conversationId);

  const path = resolveConversationLinkPath({
    stateRoot: options.stateRoot,
    profile: options.profile,
    conversationId: options.document.conversationId,
  });

  const normalized: ConversationProjectLinkDocument = {
    conversationId: options.document.conversationId,
    updatedAt: new Date(Date.parse(options.document.updatedAt)).toISOString(),
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

export function setConversationProjectLinks(options: {
  stateRoot?: string;
  profile: string;
  conversationId: string;
  relatedProjectIds: string[];
  updatedAt?: string;
}): ConversationProjectLinkDocument {
  const document: ConversationProjectLinkDocument = {
    conversationId: options.conversationId,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
    relatedProjectIds: normalizeRelatedProjectIds(options.relatedProjectIds),
  };

  writeConversationProjectLink({
    stateRoot: options.stateRoot,
    profile: options.profile,
    document,
  });

  return document;
}

export function addConversationProjectLink(options: {
  stateRoot?: string;
  profile: string;
  conversationId: string;
  projectId: string;
  updatedAt?: string;
}): ConversationProjectLinkDocument {
  const existing = getConversationProjectLink(options);
  return setConversationProjectLinks({
    stateRoot: options.stateRoot,
    profile: options.profile,
    conversationId: options.conversationId,
    relatedProjectIds: [
      ...(existing?.relatedProjectIds ?? []),
      options.projectId,
    ],
    updatedAt: options.updatedAt,
  });
}

export function removeConversationProjectLink(options: {
  stateRoot?: string;
  profile: string;
  conversationId: string;
  projectId: string;
  updatedAt?: string;
}): ConversationProjectLinkDocument {
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
