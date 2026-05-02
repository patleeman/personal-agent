import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { validateConversationId } from './conversation-project-links.js';
import { getStateRoot } from './runtime/paths.js';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const ARTIFACT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const ARTIFACT_KINDS = ['html', 'mermaid', 'latex'] as const;

export type ConversationArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface ResolveConversationArtifactOptions {
  profile: string;
  conversationId: string;
  stateRoot?: string;
}

export interface ResolveConversationArtifactPathOptions extends ResolveConversationArtifactOptions {
  artifactId: string;
}

export interface ConversationArtifactSummary {
  id: string;
  conversationId: string;
  title: string;
  kind: ConversationArtifactKind;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface ConversationArtifactRecord extends ConversationArtifactSummary {
  content: string;
}

function getConversationArtifactStateRoot(stateRoot?: string): string {
  return resolve(stateRoot ?? getStateRoot());
}

function validateProfileName(profile: string): void {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(`Invalid profile name "${profile}". Profile names may only include letters, numbers, dashes, and underscores.`);
  }
}

export function validateConversationArtifactId(artifactId: string): void {
  if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
    throw new Error(`Invalid artifact id "${artifactId}". Artifact ids may only include letters, numbers, dots, dashes, and underscores.`);
  }
}

export function validateConversationArtifactKind(kind: string): asserts kind is ConversationArtifactKind {
  if (!ARTIFACT_KINDS.includes(kind as ConversationArtifactKind)) {
    throw new Error(`Invalid artifact kind "${kind}". Expected one of: ${ARTIFACT_KINDS.join(', ')}.`);
  }
}

function normalizeIsoTimestamp(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return new Date(parsed).toISOString();
}

function normalizeTitle(title: string): string {
  const normalized = title.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    throw new Error('Artifact title is required.');
  }
  return normalized;
}

function normalizeContent(content: string): string {
  if (typeof content !== 'string') {
    throw new Error('Artifact content must be a string.');
  }

  return content;
}

function slugifyArtifactId(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return slug || 'artifact';
}

function createUniqueArtifactId(options: ResolveConversationArtifactOptions & { baseTitle: string }): string {
  const baseId = slugifyArtifactId(options.baseTitle);
  let nextId = baseId;
  let suffix = 2;

  while (
    existsSync(
      resolveConversationArtifactPath({
        stateRoot: options.stateRoot,
        profile: options.profile,
        conversationId: options.conversationId,
        artifactId: nextId,
      }),
    )
  ) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return nextId;
}

export function resolveProfileConversationArtifactsDir(options: { profile: string; stateRoot?: string }): string {
  validateProfileName(options.profile);
  return join(getConversationArtifactStateRoot(options.stateRoot), 'pi-agent', 'state', 'conversation-artifacts', options.profile);
}

export function resolveConversationArtifactsDir(options: ResolveConversationArtifactOptions): string {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  return join(resolveProfileConversationArtifactsDir(options), options.conversationId);
}

export function resolveConversationArtifactPath(options: ResolveConversationArtifactPathOptions): string {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  validateConversationArtifactId(options.artifactId);
  return join(resolveConversationArtifactsDir(options), `${options.artifactId}.json`);
}

export function readConversationArtifact(path: string): ConversationArtifactRecord {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ConversationArtifactRecord>;
  const id = typeof parsed.id === 'string' ? parsed.id.trim() : '';
  const conversationId = typeof parsed.conversationId === 'string' ? parsed.conversationId.trim() : '';
  const title = typeof parsed.title === 'string' ? parsed.title : '';
  const kind = typeof parsed.kind === 'string' ? parsed.kind : '';
  const createdAt = typeof parsed.createdAt === 'string' ? parsed.createdAt : '';
  const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '';
  const revision = typeof parsed.revision === 'number' ? parsed.revision : Number.NaN;
  const content = typeof parsed.content === 'string' ? parsed.content : '';

  validateConversationArtifactId(id);
  validateConversationId(conversationId);
  validateConversationArtifactKind(kind);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error(`Invalid artifact revision in ${path}`);
  }

  return {
    id,
    conversationId,
    title: normalizeTitle(title),
    kind,
    createdAt: normalizeIsoTimestamp(createdAt, 'artifact createdAt'),
    updatedAt: normalizeIsoTimestamp(updatedAt, 'artifact updatedAt'),
    revision,
    content,
  };
}

export function getConversationArtifact(options: ResolveConversationArtifactPathOptions): ConversationArtifactRecord | null {
  const path = resolveConversationArtifactPath(options);
  if (!existsSync(path)) {
    return null;
  }

  return readConversationArtifact(path);
}

export function listConversationArtifacts(options: ResolveConversationArtifactOptions): ConversationArtifactSummary[] {
  const dir = resolveConversationArtifactsDir(options);
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => readConversationArtifact(join(dir, entry)))
    .map(({ content: _content, ...summary }) => summary)
    .sort((left, right) => {
      const updatedDiff = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      return updatedDiff !== 0 ? updatedDiff : left.id.localeCompare(right.id);
    });
}

export function saveConversationArtifact(options: {
  profile: string;
  conversationId: string;
  artifactId?: string;
  title: string;
  kind: ConversationArtifactKind;
  content: string;
  stateRoot?: string;
  createdAt?: string;
  updatedAt?: string;
}): ConversationArtifactRecord {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  validateConversationArtifactKind(options.kind);

  const title = normalizeTitle(options.title);
  const content = normalizeContent(options.content);
  const artifactId = options.artifactId?.trim()
    ? options.artifactId.trim()
    : createUniqueArtifactId({
        stateRoot: options.stateRoot,
        profile: options.profile,
        conversationId: options.conversationId,
        baseTitle: title,
      });

  validateConversationArtifactId(artifactId);

  const existing = getConversationArtifact({
    stateRoot: options.stateRoot,
    profile: options.profile,
    conversationId: options.conversationId,
    artifactId,
  });

  const createdAt = existing?.createdAt ?? normalizeIsoTimestamp(options.createdAt ?? new Date().toISOString(), 'artifact createdAt');
  const updatedAt = normalizeIsoTimestamp(options.updatedAt ?? new Date().toISOString(), 'artifact updatedAt');
  const revision = (existing?.revision ?? 0) + 1;

  const record: ConversationArtifactRecord = {
    id: artifactId,
    conversationId: options.conversationId,
    title,
    kind: options.kind,
    content,
    createdAt,
    updatedAt,
    revision,
  };

  const path = resolveConversationArtifactPath({
    stateRoot: options.stateRoot,
    profile: options.profile,
    conversationId: options.conversationId,
    artifactId,
  });

  mkdirSync(
    resolveConversationArtifactsDir({
      stateRoot: options.stateRoot,
      profile: options.profile,
      conversationId: options.conversationId,
    }),
    { recursive: true },
  );
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n');

  return record;
}

export function deleteConversationArtifact(options: ResolveConversationArtifactPathOptions): boolean {
  const path = resolveConversationArtifactPath(options);
  if (!existsSync(path)) {
    return false;
  }

  rmSync(path, { force: true });
  return true;
}
