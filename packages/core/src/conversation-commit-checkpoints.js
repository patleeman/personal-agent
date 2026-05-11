import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { validateConversationId } from './conversation-project-links.js';
import { getStateRoot } from './runtime/paths.js';
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const CHECKPOINT_ID_PATTERN = /^[a-f0-9]{7,64}$/i;
const CHECKPOINT_FILE_STATUS_VALUES = ['added', 'modified', 'deleted', 'renamed', 'copied', 'typechange', 'unmerged', 'unknown'];
function getConversationCommitCheckpointStateRoot(stateRoot) {
    return resolve(stateRoot ?? getStateRoot());
}
function validateProfileName(profile) {
    if (!PROFILE_NAME_PATTERN.test(profile)) {
        throw new Error(`Invalid profile name "${profile}". Profile names may only include letters, numbers, dashes, and underscores.`);
    }
}
export function validateConversationCommitCheckpointId(checkpointId) {
    if (!CHECKPOINT_ID_PATTERN.test(checkpointId)) {
        throw new Error(`Invalid commit checkpoint id "${checkpointId}".`);
    }
}
function normalizeIsoTimestamp(value, label) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid ${label}: ${value}`);
    }
    return new Date(parsed).toISOString();
}
function normalizeRequiredText(value, label) {
    if (typeof value !== 'string') {
        throw new Error(`${label} is required.`);
    }
    const normalized = value.trim();
    if (!normalized) {
        throw new Error(`${label} is required.`);
    }
    return normalized;
}
function normalizeOptionalText(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}
function normalizeNonNegativeInteger(value, label) {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`Invalid ${label}: ${String(value)}.`);
    }
    return value;
}
function normalizeStatus(value) {
    if (CHECKPOINT_FILE_STATUS_VALUES.includes(value)) {
        return value;
    }
    return 'unknown';
}
function normalizeFilePath(value, label) {
    const normalized = normalizeRequiredText(value, label).replace(/\\/g, '/');
    if (normalized.startsWith('/')) {
        throw new Error(`${label} must be relative.`);
    }
    return normalized;
}
function normalizeCheckpointFile(value) {
    if (!value || typeof value !== 'object') {
        throw new Error('Commit checkpoint file is invalid.');
    }
    const file = value;
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
function normalizeCheckpointComment(value) {
    if (!value || typeof value !== 'object') {
        throw new Error('Commit checkpoint comment is invalid.');
    }
    const comment = value;
    return {
        id: normalizeRequiredText(typeof comment.id === 'string' ? comment.id : '', 'comment id'),
        authorName: normalizeRequiredText(typeof comment.authorName === 'string' ? comment.authorName : '', 'comment authorName'),
        ...(normalizeOptionalText(comment.authorProfile) ? { authorProfile: normalizeOptionalText(comment.authorProfile) } : {}),
        body: normalizeRequiredText(typeof comment.body === 'string' ? comment.body : '', 'comment body'),
        ...(normalizeOptionalText(comment.filePath) ? { filePath: normalizeFilePath(comment.filePath, 'comment filePath') } : {}),
        createdAt: normalizeIsoTimestamp(typeof comment.createdAt === 'string' ? comment.createdAt : '', 'comment createdAt'),
        updatedAt: normalizeIsoTimestamp(typeof comment.updatedAt === 'string' ? comment.updatedAt : '', 'comment updatedAt'),
    };
}
function normalizeCheckpointComments(value) {
    if (Array.isArray(value.comments)) {
        return value.comments.map((comment) => normalizeCheckpointComment(comment));
    }
    const legacyComment = normalizeOptionalText(value.comment);
    if (!legacyComment) {
        return [];
    }
    const updatedAt = normalizeIsoTimestamp(typeof value.commentUpdatedAt === 'string'
        ? value.commentUpdatedAt
        : typeof value.updatedAt === 'string'
            ? value.updatedAt
            : new Date().toISOString(), 'commentUpdatedAt');
    return [
        {
            id: `legacy-${randomUUID()}`,
            authorName: 'You',
            body: legacyComment,
            createdAt: updatedAt,
            updatedAt,
        },
    ];
}
function normalizeCheckpointRecord(value) {
    if (!value || typeof value !== 'object') {
        throw new Error('Commit checkpoint document is invalid.');
    }
    const record = value;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    validateConversationCommitCheckpointId(id);
    const files = Array.isArray(record.files) ? record.files.map((file) => normalizeCheckpointFile(file)) : [];
    const comments = normalizeCheckpointComments(record);
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
        commentCount: normalizeNonNegativeInteger(typeof record.commentCount === 'number' ? record.commentCount : comments.length, 'commentCount'),
        files,
        comments,
    };
}
function readCheckpoint(path) {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return normalizeCheckpointRecord(parsed);
}
function writeCheckpoint(path, record) {
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
    return record;
}
export function resolveProfileConversationCommitCheckpointsDir(options) {
    validateProfileName(options.profile);
    return join(getConversationCommitCheckpointStateRoot(options.stateRoot), 'pi-agent', 'state', 'conversation-commit-checkpoints', options.profile);
}
export function resolveConversationCommitCheckpointsDir(options) {
    validateProfileName(options.profile);
    validateConversationId(options.conversationId);
    return join(resolveProfileConversationCommitCheckpointsDir(options), options.conversationId);
}
export function resolveConversationCommitCheckpointPath(options) {
    validateProfileName(options.profile);
    validateConversationId(options.conversationId);
    validateConversationCommitCheckpointId(options.checkpointId);
    return join(resolveConversationCommitCheckpointsDir(options), `${options.checkpointId}.json`);
}
export function getConversationCommitCheckpoint(options) {
    const path = resolveConversationCommitCheckpointPath(options);
    if (!existsSync(path)) {
        return null;
    }
    return readCheckpoint(path);
}
export function listConversationCommitCheckpoints(options) {
    const dir = resolveConversationCommitCheckpointsDir(options);
    if (!existsSync(dir)) {
        return [];
    }
    return readdirSync(dir)
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => readCheckpoint(join(dir, entry)))
        .map(({ files: _files, comments: _comments, ...summary }) => summary)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id));
}
export function saveConversationCommitCheckpoint(options) {
    validateProfileName(options.profile);
    validateConversationId(options.conversationId);
    const checkpointId = normalizeOptionalText(options.checkpointId) ?? normalizeRequiredText(options.commitSha, 'commitSha');
    validateConversationCommitCheckpointId(checkpointId);
    const updatedAt = normalizeIsoTimestamp(options.updatedAt ?? new Date().toISOString(), 'updatedAt');
    const explicitComments = Array.isArray(options.comments) ? options.comments.map((comment) => normalizeCheckpointComment(comment)) : null;
    const legacyComment = normalizeOptionalText(options.comment);
    const comments = explicitComments ??
        (legacyComment
            ? [
                {
                    id: randomUUID(),
                    authorName: 'You',
                    body: legacyComment,
                    createdAt: normalizeIsoTimestamp(options.commentUpdatedAt ?? updatedAt, 'commentUpdatedAt'),
                    updatedAt: normalizeIsoTimestamp(options.commentUpdatedAt ?? updatedAt, 'commentUpdatedAt'),
                },
            ]
            : []);
    const record = {
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
        commentCount: normalizeNonNegativeInteger(comments.length, 'commentCount'),
        files: options.files.map((file) => normalizeCheckpointFile(file)),
        comments,
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
    return writeCheckpoint(path, record);
}
export function addConversationCommitCheckpointComment(options) {
    const existing = getConversationCommitCheckpoint(options);
    if (!existing) {
        return null;
    }
    const now = normalizeIsoTimestamp(options.updatedAt ?? options.createdAt ?? new Date().toISOString(), 'updatedAt');
    const nextComment = normalizeCheckpointComment({
        id: randomUUID(),
        authorName: options.authorName,
        authorProfile: options.authorProfile,
        body: options.body,
        filePath: options.filePath,
        createdAt: options.createdAt ?? now,
        updatedAt: options.updatedAt ?? now,
    });
    const updated = normalizeCheckpointRecord({
        ...existing,
        updatedAt: now,
        commentCount: existing.comments.length + 1,
        comments: [...existing.comments, nextComment],
    });
    return writeCheckpoint(resolveConversationCommitCheckpointPath(options), updated);
}
