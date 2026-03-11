import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { validateWorkstreamId } from './workstreams.js';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

export interface ResolveConversationLinkOptions {
  repoRoot?: string;
  profile: string;
}

export interface ResolveConversationLinkPathOptions extends ResolveConversationLinkOptions {
  conversationId: string;
}

export interface ConversationWorkstreamLinkDocument {
  conversationId: string;
  updatedAt: string;
  relatedWorkstreamIds: string[];
}

function getRepoRoot(repoRoot?: string): string {
  return resolve(repoRoot ?? process.env.PERSONAL_AGENT_REPO_ROOT ?? process.cwd());
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
  return join(getRepoRoot(options.repoRoot), 'profiles', options.profile, 'agent', 'conversations');
}

export function resolveConversationLinkPath(options: ResolveConversationLinkPathOptions): string {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  return join(resolveProfileConversationLinksDir(options), `${options.conversationId}.json`);
}

function normalizeRelatedWorkstreamIds(workstreamIds: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const workstreamId of workstreamIds) {
    validateWorkstreamId(workstreamId);
    if (seen.has(workstreamId)) {
      continue;
    }

    seen.add(workstreamId);
    unique.push(workstreamId);
  }

  return unique;
}

export function readConversationWorkstreamLink(path: string): ConversationWorkstreamLinkDocument {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ConversationWorkstreamLinkDocument>;
  const conversationId = typeof parsed.conversationId === 'string' ? parsed.conversationId.trim() : '';
  const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt.trim() : '';
  const relatedWorkstreamIds = Array.isArray(parsed.relatedWorkstreamIds)
    ? parsed.relatedWorkstreamIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];

  validateConversationId(conversationId);
  if (updatedAt.length === 0 || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error(`Invalid conversation link updatedAt in ${path}`);
  }

  return {
    conversationId,
    updatedAt: new Date(Date.parse(updatedAt)).toISOString(),
    relatedWorkstreamIds: normalizeRelatedWorkstreamIds(relatedWorkstreamIds),
  };
}

export function getConversationWorkstreamLink(options: ResolveConversationLinkPathOptions): ConversationWorkstreamLinkDocument | null {
  const path = resolveConversationLinkPath(options);
  if (!existsSync(path)) {
    return null;
  }

  return readConversationWorkstreamLink(path);
}

export function writeConversationWorkstreamLink(options: {
  repoRoot?: string;
  profile: string;
  document: ConversationWorkstreamLinkDocument;
}): string {
  validateProfileName(options.profile);
  validateConversationId(options.document.conversationId);

  const path = resolveConversationLinkPath({
    repoRoot: options.repoRoot,
    profile: options.profile,
    conversationId: options.document.conversationId,
  });

  const normalized: ConversationWorkstreamLinkDocument = {
    conversationId: options.document.conversationId,
    updatedAt: new Date(Date.parse(options.document.updatedAt)).toISOString(),
    relatedWorkstreamIds: normalizeRelatedWorkstreamIds(options.document.relatedWorkstreamIds),
  };

  mkdirSync(resolveProfileConversationLinksDir({ repoRoot: options.repoRoot, profile: options.profile }), { recursive: true });
  writeFileSync(path, JSON.stringify(normalized, null, 2) + '\n');
  return path;
}

export function setConversationWorkstreamLinks(options: {
  repoRoot?: string;
  profile: string;
  conversationId: string;
  relatedWorkstreamIds: string[];
  updatedAt?: string;
}): ConversationWorkstreamLinkDocument {
  const document: ConversationWorkstreamLinkDocument = {
    conversationId: options.conversationId,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
    relatedWorkstreamIds: normalizeRelatedWorkstreamIds(options.relatedWorkstreamIds),
  };

  writeConversationWorkstreamLink({
    repoRoot: options.repoRoot,
    profile: options.profile,
    document,
  });

  return document;
}

export function addConversationWorkstreamLink(options: {
  repoRoot?: string;
  profile: string;
  conversationId: string;
  workstreamId: string;
  updatedAt?: string;
}): ConversationWorkstreamLinkDocument {
  const existing = getConversationWorkstreamLink(options);
  return setConversationWorkstreamLinks({
    repoRoot: options.repoRoot,
    profile: options.profile,
    conversationId: options.conversationId,
    relatedWorkstreamIds: [
      ...(existing?.relatedWorkstreamIds ?? []),
      options.workstreamId,
    ],
    updatedAt: options.updatedAt,
  });
}

export function removeConversationWorkstreamLink(options: {
  repoRoot?: string;
  profile: string;
  conversationId: string;
  workstreamId: string;
  updatedAt?: string;
}): ConversationWorkstreamLinkDocument {
  validateWorkstreamId(options.workstreamId);
  const existing = getConversationWorkstreamLink(options);
  return setConversationWorkstreamLinks({
    repoRoot: options.repoRoot,
    profile: options.profile,
    conversationId: options.conversationId,
    relatedWorkstreamIds: (existing?.relatedWorkstreamIds ?? []).filter((id) => id !== options.workstreamId),
    updatedAt: options.updatedAt,
  });
}
