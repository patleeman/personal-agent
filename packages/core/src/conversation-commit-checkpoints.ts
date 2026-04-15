import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { validateConversationId } from './conversation-project-links.js';
import { getStateRoot } from './runtime/paths.js';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const CHECKPOINT_ID_PATTERN = /^[a-f0-9]{7,64}$/i;
const CHECKPOINT_FILE_STATUS_VALUES = ['added', 'modified', 'deleted', 'renamed', 'copied', 'typechange', 'unmerged', 'unknown'] as const;

export type ConversationCommitCheckpointFileStatus = (typeof CHECKPOINT_FILE_STATUS_VALUES)[number];

export interface ResolveConversationCommitCheckpointOptions {
  profile: string;
  conversationId: string;
  stateRoot?: string;
}

export interface ResolveConversationCommitCheckpointPathOptions extends ResolveConversationCommitCheckpointOptions {
  checkpointId: string;
}

export interface ConversationCommitCheckpointFile {
  path: string;
  previousPath?: string;
  status: ConversationCommitCheckpointFileStatus;
  additions: number;
  deletions: number;
  patch: string;
}

export interface ConversationCommitCheckpointSummary {
  id: string;
  conversationId: string;
  title: string;
  cwd: string;
  commitSha: string;
  shortSha: string;
  subject: string;
  body?: string;
  authorName: string;
  authorEmail?: string;
  committedAt: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
  linesAdded: number;
  linesDeleted: number;
  comment?: string;
  commentUpdatedAt?: string;
}

export interface ConversationCommitCheckpointRecord extends ConversationCommitCheckpointSummary {
  files: ConversationCommitCheckpointFile[];
}

function getConversationCommitCheckpointStateRoot(stateRoot?: string): string {
  return resolve(stateRoot ?? getStateRoot());
}

function validateProfileName(profile: string): void {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(
      `Invalid profile name "${profile}". Profile names may only include letters, numbers, dashes, and underscores.`,
    );
  }
}

export function validateConversationCommitCheckpointId(checkpointId: string): void {
  if (!CHECKPOINT_ID_PATTERN.test(checkpointId)) {
    throw new Error(`Invalid commit checkpoint id "${checkpointId}".`);
  }
}

function normalizeIsoTimestamp(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return new Date(parsed).toISOString();
}

function normalizeRequiredText(value: string, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} is required.`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}: ${String(value)}.`);
  }

  return value;
}

function normalizeStatus(value: string): ConversationCommitCheckpointFileStatus {
  if (CHECKPOINT_FILE_STATUS_VALUES.includes(value as ConversationCommitCheckpointFileStatus)) {
    return value as ConversationCommitCheckpointFileStatus;
  }

  return 'unknown';
}

function normalizeFilePath(value: string, label: string): string {
  const normalized = normalizeRequiredText(value, label).replace(/\\/g, '/');
  if (normalized.startsWith('/')) {
    throw new Error(`${label} must be relative.`);
  }

  return normalized;
}

function normalizeCheckpointFile(value: unknown): ConversationCommitCheckpointFile {
  if (!value || typeof value !== 'object') {
    throw new Error('Commit checkpoint file is invalid.');
  }

  const file = value as Partial<ConversationCommitCheckpointFile>;
  const previousPath = normalizeOptionalText(file.previousPath)?.replace(/\\/g, '/');
  const patch = typeof file.patch === 'string' ? file.patch : '';

  return {
    path: normalizeFilePath(typeof file.path === 'string' ? file.path : '', 'Commit checkpoint file path'),
    ...(previousPath ? { previousPath: normalizeFilePath(previousPath, 'Commit checkpoint previousPath') } : {}),
    status: normalizeStatus(typeof file.status === 'string' ? file.status : 'unknown'),
    additions: normalizeNonNegativeInteger(file.additions ?? Number.NaN, 'commit checkpoint file additions'),
    deletions: normalizeNonNegativeInteger(file.deletions ?? Number.NaN, 'commit checkpoint file deletions'),
    patch,
  };
}

function normalizeCheckpointRecord(value: unknown): ConversationCommitCheckpointRecord {
  if (!value || typeof value !== 'object') {
    throw new Error('Commit checkpoint document is invalid.');
  }

  const record = value as Partial<ConversationCommitCheckpointRecord>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  validateConversationCommitCheckpointId(id);

  const files = Array.isArray(record.files)
    ? record.files.map((file) => normalizeCheckpointFile(file))
    : [];

  const comment = normalizeOptionalText(record.comment);

  return {
    id,
    conversationId: normalizeRequiredText(typeof record.conversationId === 'string' ? record.conversationId : '', 'conversationId'),
    title: normalizeRequiredText(typeof record.title === 'string' ? record.title : '', 'title'),
    cwd: normalizeRequiredText(typeof record.cwd === 'string' ? record.cwd : '', 'cwd'),
    commitSha: normalizeRequiredText(typeof record.commitSha === 'string' ? record.commitSha : '', 'commitSha'),
    shortSha: normalizeRequiredText(typeof record.shortSha === 'string' ? record.shortSha : '', 'shortSha'),
    subject: normalizeRequiredText(typeof record.subject === 'string' ? record.subject : '', 'subject'),
    ...(normalizeOptionalText(record.body) ? { body: normalizeOptionalText(record.body) } : {}),
    authorName: normalizeRequiredText(typeof record.authorName === 'string' ? record.authorName : '', 'authorName'),
    ...(normalizeOptionalText(record.authorEmail) ? { authorEmail: normalizeOptionalText(record.authorEmail) } : {}),
    committedAt: normalizeIsoTimestamp(typeof record.committedAt === 'string' ? record.committedAt : '', 'committedAt'),
    createdAt: normalizeIsoTimestamp(typeof record.createdAt === 'string' ? record.createdAt : '', 'createdAt'),
    updatedAt: normalizeIsoTimestamp(typeof record.updatedAt === 'string' ? record.updatedAt : '', 'updatedAt'),
    fileCount: normalizeNonNegativeInteger(record.fileCount ?? Number.NaN, 'fileCount'),
    linesAdded: normalizeNonNegativeInteger(record.linesAdded ?? Number.NaN, 'linesAdded'),
    linesDeleted: normalizeNonNegativeInteger(record.linesDeleted ?? Number.NaN, 'linesDeleted'),
    ...(comment ? {
      comment,
      commentUpdatedAt: normalizeIsoTimestamp(
        typeof record.commentUpdatedAt === 'string'
          ? record.commentUpdatedAt
          : typeof record.updatedAt === 'string'
            ? record.updatedAt
            : '',
        'commentUpdatedAt',
      ),
    } : {}),
    files,
  };
}

function readCheckpoint(path: string): ConversationCommitCheckpointRecord {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  return normalizeCheckpointRecord(parsed);
}

export function resolveProfileConversationCommitCheckpointsDir(options: {
  profile: string;
  stateRoot?: string;
}): string {
  validateProfileName(options.profile);
  return join(
    getConversationCommitCheckpointStateRoot(options.stateRoot),
    'pi-agent',
    'state',
    'conversation-commit-checkpoints',
    options.profile,
  );
}

export function resolveConversationCommitCheckpointsDir(options: ResolveConversationCommitCheckpointOptions): string {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  return join(resolveProfileConversationCommitCheckpointsDir(options), options.conversationId);
}

export function resolveConversationCommitCheckpointPath(options: ResolveConversationCommitCheckpointPathOptions): string {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  validateConversationCommitCheckpointId(options.checkpointId);
  return join(resolveConversationCommitCheckpointsDir(options), `${options.checkpointId}.json`);
}

export function getConversationCommitCheckpoint(options: ResolveConversationCommitCheckpointPathOptions): ConversationCommitCheckpointRecord | null {
  const path = resolveConversationCommitCheckpointPath(options);
  if (!existsSync(path)) {
    return null;
  }

  return readCheckpoint(path);
}

export function listConversationCommitCheckpoints(options: ResolveConversationCommitCheckpointOptions): ConversationCommitCheckpointSummary[] {
  const dir = resolveConversationCommitCheckpointsDir(options);
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => readCheckpoint(join(dir, entry)))
    .map(({ files: _files, ...summary }) => summary)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id));
}

export function saveConversationCommitCheckpoint(options: {
  profile: string;
  conversationId: string;
  checkpointId?: string;
  title: string;
  cwd: string;
  commitSha: string;
  shortSha: string;
  subject: string;
  body?: string;
  authorName: string;
  authorEmail?: string;
  committedAt: string;
  createdAt?: string;
  updatedAt?: string;
  comment?: string;
  commentUpdatedAt?: string;
  files: ConversationCommitCheckpointFile[];
  linesAdded: number;
  linesDeleted: number;
  stateRoot?: string;
}): ConversationCommitCheckpointRecord {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);

  const checkpointId = normalizeOptionalText(options.checkpointId) ?? normalizeRequiredText(options.commitSha, 'commitSha');
  validateConversationCommitCheckpointId(checkpointId);

  const comment = normalizeOptionalText(options.comment);
  const updatedAt = normalizeIsoTimestamp(options.updatedAt ?? new Date().toISOString(), 'updatedAt');

  const record: ConversationCommitCheckpointRecord = {
    id: checkpointId,
    conversationId: options.conversationId,
    title: normalizeRequiredText(options.title, 'title'),
    cwd: normalizeRequiredText(options.cwd, 'cwd'),
    commitSha: normalizeRequiredText(options.commitSha, 'commitSha'),
    shortSha: normalizeRequiredText(options.shortSha, 'shortSha'),
    subject: normalizeRequiredText(options.subject, 'subject'),
    ...(normalizeOptionalText(options.body) ? { body: normalizeOptionalText(options.body) } : {}),
    authorName: normalizeRequiredText(options.authorName, 'authorName'),
    ...(normalizeOptionalText(options.authorEmail) ? { authorEmail: normalizeOptionalText(options.authorEmail) } : {}),
    committedAt: normalizeIsoTimestamp(options.committedAt, 'committedAt'),
    createdAt: normalizeIsoTimestamp(options.createdAt ?? new Date().toISOString(), 'createdAt'),
    updatedAt,
    fileCount: normalizeNonNegativeInteger(options.files.length, 'fileCount'),
    linesAdded: normalizeNonNegativeInteger(options.linesAdded, 'linesAdded'),
    linesDeleted: normalizeNonNegativeInteger(options.linesDeleted, 'linesDeleted'),
    ...(comment ? {
      comment,
      commentUpdatedAt: normalizeIsoTimestamp(options.commentUpdatedAt ?? updatedAt, 'commentUpdatedAt'),
    } : {}),
    files: options.files.map((file) => normalizeCheckpointFile(file)),
  };

  const dir = resolveConversationCommitCheckpointsDir({
    stateRoot: options.stateRoot,
    profile: options.profile,
    conversationId: options.conversationId,
  });
  const path = resolveConversationCommitCheckpointPath({
    stateRoot: options.stateRoot,
    profile: options.profile,
    conversationId: options.conversationId,
    checkpointId,
  });

  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export function updateConversationCommitCheckpointComment(options: {
  profile: string;
  conversationId: string;
  checkpointId: string;
  comment?: string | null;
  commentUpdatedAt?: string;
  stateRoot?: string;
}): ConversationCommitCheckpointRecord | null {
  const existing = getConversationCommitCheckpoint(options);
  if (!existing) {
    return null;
  }

  const comment = normalizeOptionalText(options.comment ?? undefined);
  const updated = normalizeCheckpointRecord({
    ...existing,
    ...(comment
      ? {
          comment,
          commentUpdatedAt: normalizeIsoTimestamp(options.commentUpdatedAt ?? new Date().toISOString(), 'commentUpdatedAt'),
        }
      : {
          comment: undefined,
          commentUpdatedAt: undefined,
        }),
    updatedAt: normalizeIsoTimestamp(new Date().toISOString(), 'updatedAt'),
  });

  writeFileSync(resolveConversationCommitCheckpointPath(options), `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}
