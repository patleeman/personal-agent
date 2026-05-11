import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';
import { validateConversationId } from './conversation-project-links.js';
import { getStateRoot } from './runtime/paths.js';
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const CHECKPOINT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const CHECKPOINT_VERSION = 1;
function getConversationCheckpointStateRoot(stateRoot) {
    return resolve(stateRoot ?? getStateRoot());
}
function validateProfileName(profile) {
    if (!PROFILE_NAME_PATTERN.test(profile)) {
        throw new Error(`Invalid profile name "${profile}". Profile names may only include letters, numbers, dashes, and underscores.`);
    }
}
export function validateConversationCheckpointId(checkpointId) {
    if (!CHECKPOINT_ID_PATTERN.test(checkpointId)) {
        throw new Error(`Invalid checkpoint id "${checkpointId}". Checkpoint ids may only include letters, numbers, dots, dashes, and underscores.`);
    }
}
function normalizeIsoTimestamp(value, label) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid ${label}: ${value}`);
    }
    return new Date(parsed).toISOString();
}
function normalizeOptionalText(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized.length > 0 ? normalized : undefined;
}
function normalizeTitle(title) {
    const normalized = normalizeOptionalText(title);
    if (!normalized) {
        throw new Error('Checkpoint title is required.');
    }
    return normalized;
}
function normalizeCheckpointSource(source) {
    validateConversationId(source.conversationId);
    const conversationTitle = normalizeOptionalText(source.conversationTitle);
    const cwd = normalizeOptionalText(source.cwd);
    const relatedProjectIds = Array.isArray(source.relatedProjectIds)
        ? source.relatedProjectIds
            .map((projectId) => (typeof projectId === 'string' ? projectId.trim() : ''))
            .filter((projectId) => projectId.length > 0)
        : [];
    return {
        conversationId: source.conversationId,
        ...(conversationTitle ? { conversationTitle } : {}),
        ...(cwd ? { cwd } : {}),
        relatedProjectIds: [...new Set(relatedProjectIds)],
    };
}
function normalizeCheckpointAnchor(anchor) {
    const messageId = normalizeOptionalText(anchor.messageId);
    if (!messageId) {
        throw new Error('Checkpoint anchor messageId is required.');
    }
    const role = normalizeOptionalText(anchor.role) ?? 'unknown';
    const preview = normalizeOptionalText(anchor.preview) ?? '';
    return {
        messageId,
        role,
        timestamp: normalizeIsoTimestamp(anchor.timestamp, 'checkpoint anchor timestamp'),
        preview,
    };
}
function normalizeNonNegativeInteger(value, label) {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`Invalid ${label}: ${String(value)}.`);
    }
    return value;
}
function normalizeSnapshotContent(content) {
    if (typeof content !== 'string') {
        throw new Error('Checkpoint snapshot content must be a string.');
    }
    if (content.length === 0) {
        throw new Error('Checkpoint snapshot content must not be empty.');
    }
    return content.endsWith('\n') ? content : `${content}\n`;
}
function countSnapshotLines(content) {
    const normalized = content.endsWith('\n') ? content.slice(0, -1) : content;
    if (!normalized) {
        return 0;
    }
    return normalized.split('\n').length;
}
function isSubPath(parentPath, childPath) {
    const parent = resolve(parentPath);
    const child = resolve(childPath);
    if (child === parent) {
        return true;
    }
    const suffix = process.platform === 'win32' ? '\\' : '/';
    return child.startsWith(`${parent}${suffix}`);
}
function writeFileAtomic(path, content) {
    const tempPath = `${path}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    writeFileSync(tempPath, content);
    try {
        renameSync(tempPath, path);
    }
    catch {
        rmSync(path, { force: true });
        renameSync(tempPath, path);
    }
}
function createUniqueCheckpointId(options) {
    const timestamp = new Date()
        .toISOString()
        .replace(/[T:.Z-]/g, '')
        .slice(0, 14);
    let attempts = 0;
    while (attempts < 20) {
        attempts += 1;
        const candidate = `ckpt-${timestamp}-${Math.random().toString(36).slice(2, 6)}`;
        validateConversationCheckpointId(candidate);
        const candidateMetaPath = resolveConversationCheckpointMetaPath({
            stateRoot: options.stateRoot,
            profile: options.profile,
            checkpointId: candidate,
        });
        if (!existsSync(candidateMetaPath)) {
            return candidate;
        }
    }
    throw new Error('Unable to allocate a unique checkpoint id.');
}
function normalizeCheckpointSnapshot(value) {
    if (!value || typeof value !== 'object') {
        throw new Error('Checkpoint snapshot metadata is required.');
    }
    const snapshot = value;
    const file = typeof snapshot.file === 'string' ? snapshot.file.trim() : '';
    if (!file) {
        throw new Error('Checkpoint snapshot file is required.');
    }
    return {
        file,
        messageCount: normalizeNonNegativeInteger(snapshot.messageCount ?? Number.NaN, 'checkpoint snapshot messageCount'),
        lineCount: normalizeNonNegativeInteger(snapshot.lineCount ?? Number.NaN, 'checkpoint snapshot lineCount'),
        bytes: normalizeNonNegativeInteger(snapshot.bytes ?? Number.NaN, 'checkpoint snapshot bytes'),
    };
}
function normalizeCheckpointRecord(value) {
    if (!value || typeof value !== 'object') {
        throw new Error('Checkpoint document is invalid.');
    }
    const parsed = value;
    const checkpointId = typeof parsed.id === 'string' ? parsed.id.trim() : '';
    if (parsed.version !== CHECKPOINT_VERSION) {
        throw new Error(`Unsupported checkpoint version: ${String(parsed.version)}.`);
    }
    validateConversationCheckpointId(checkpointId);
    const note = normalizeOptionalText(parsed.note);
    const summary = normalizeOptionalText(parsed.summary);
    return {
        version: CHECKPOINT_VERSION,
        id: checkpointId,
        title: normalizeTitle(typeof parsed.title === 'string' ? parsed.title : ''),
        ...(note ? { note } : {}),
        ...(summary ? { summary } : {}),
        createdAt: normalizeIsoTimestamp(typeof parsed.createdAt === 'string' ? parsed.createdAt : '', 'checkpoint createdAt'),
        updatedAt: normalizeIsoTimestamp(typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '', 'checkpoint updatedAt'),
        source: normalizeCheckpointSource(parsed.source),
        anchor: normalizeCheckpointAnchor(parsed.anchor),
        snapshot: normalizeCheckpointSnapshot(parsed.snapshot),
    };
}
function readCheckpointRecordFromPath(path) {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return normalizeCheckpointRecord(parsed);
}
export function resolveProfileConversationCheckpointsDir(options) {
    validateProfileName(options.profile);
    return join(getConversationCheckpointStateRoot(options.stateRoot), 'pi-agent', 'state', 'conversation-checkpoints', options.profile);
}
export function resolveConversationCheckpointMetaDir(options) {
    return join(resolveProfileConversationCheckpointsDir(options), 'meta');
}
export function resolveConversationCheckpointSnapshotsDir(options) {
    return join(resolveProfileConversationCheckpointsDir(options), 'snapshots');
}
export function resolveConversationCheckpointMetaPath(options) {
    validateConversationCheckpointId(options.checkpointId);
    return join(resolveConversationCheckpointMetaDir(options), `${options.checkpointId}.json`);
}
export function resolveConversationCheckpointSnapshotPath(options) {
    validateConversationCheckpointId(options.checkpointId);
    return join(resolveConversationCheckpointSnapshotsDir(options), `${options.checkpointId}.jsonl`);
}
export function resolveConversationCheckpointSnapshotFile(options) {
    validateConversationCheckpointId(options.checkpoint.id);
    const checkpointsDir = resolveProfileConversationCheckpointsDir(options);
    const snapshotFile = options.checkpoint.snapshot.file.trim();
    const absolutePath = isAbsolute(snapshotFile) ? resolve(snapshotFile) : resolve(checkpointsDir, snapshotFile);
    if (!isSubPath(checkpointsDir, absolutePath)) {
        throw new Error(`Checkpoint snapshot path escapes checkpoint directory: ${snapshotFile}`);
    }
    return absolutePath;
}
export function getConversationCheckpoint(options) {
    const path = resolveConversationCheckpointMetaPath(options);
    if (!existsSync(path)) {
        return null;
    }
    const record = readCheckpointRecordFromPath(path);
    const snapshotPath = resolveConversationCheckpointSnapshotFile({
        stateRoot: options.stateRoot,
        profile: options.profile,
        checkpoint: record,
    });
    return {
        ...record,
        snapshotMissing: !existsSync(snapshotPath),
    };
}
export function listConversationCheckpoints(options) {
    if (options.conversationId) {
        validateConversationId(options.conversationId);
    }
    const metaDir = resolveConversationCheckpointMetaDir(options);
    if (!existsSync(metaDir)) {
        return [];
    }
    return readdirSync(metaDir)
        .filter((entry) => entry.endsWith('.json'))
        .flatMap((entry) => {
        try {
            const record = readCheckpointRecordFromPath(join(metaDir, entry));
            const snapshotPath = resolveConversationCheckpointSnapshotFile({
                stateRoot: options.stateRoot,
                profile: options.profile,
                checkpoint: record,
            });
            return [
                {
                    ...record,
                    snapshotMissing: !existsSync(snapshotPath),
                },
            ];
        }
        catch {
            return [];
        }
    })
        .filter((record) => !options.conversationId || record.source.conversationId === options.conversationId)
        .sort((left, right) => {
        const updatedDiff = right.updatedAt.localeCompare(left.updatedAt);
        return updatedDiff !== 0 ? updatedDiff : right.createdAt.localeCompare(left.createdAt);
    });
}
export function saveConversationCheckpoint(options) {
    validateProfileName(options.profile);
    const checkpointId = options.checkpointId?.trim()
        ? options.checkpointId.trim()
        : createUniqueCheckpointId({ stateRoot: options.stateRoot, profile: options.profile });
    validateConversationCheckpointId(checkpointId);
    const existing = getConversationCheckpoint({
        stateRoot: options.stateRoot,
        profile: options.profile,
        checkpointId,
    });
    const snapshotContent = normalizeSnapshotContent(options.snapshotContent);
    const title = normalizeTitle(options.title);
    const note = normalizeOptionalText(options.note);
    const summary = normalizeOptionalText(options.summary);
    const source = normalizeCheckpointSource(options.source);
    const anchor = normalizeCheckpointAnchor(options.anchor);
    const createdAt = existing?.createdAt ?? normalizeIsoTimestamp(options.createdAt ?? new Date().toISOString(), 'checkpoint createdAt');
    const updatedAt = normalizeIsoTimestamp(options.updatedAt ?? new Date().toISOString(), 'checkpoint updatedAt');
    const snapshotLineCount = options.snapshotLineCount ?? countSnapshotLines(snapshotContent);
    const snapshotBytes = options.snapshotBytes ?? Buffer.byteLength(snapshotContent, 'utf-8');
    const record = {
        version: CHECKPOINT_VERSION,
        id: checkpointId,
        title,
        ...(note ? { note } : {}),
        ...(summary ? { summary } : {}),
        createdAt,
        updatedAt,
        source,
        anchor,
        snapshot: {
            file: `snapshots/${checkpointId}.jsonl`,
            messageCount: normalizeNonNegativeInteger(options.snapshotMessageCount, 'checkpoint snapshot messageCount'),
            lineCount: normalizeNonNegativeInteger(snapshotLineCount, 'checkpoint snapshot lineCount'),
            bytes: normalizeNonNegativeInteger(snapshotBytes, 'checkpoint snapshot bytes'),
        },
    };
    const snapshotPath = resolveConversationCheckpointSnapshotPath({
        stateRoot: options.stateRoot,
        profile: options.profile,
        checkpointId,
    });
    const metaPath = resolveConversationCheckpointMetaPath({
        stateRoot: options.stateRoot,
        profile: options.profile,
        checkpointId,
    });
    mkdirSync(resolveConversationCheckpointSnapshotsDir({ stateRoot: options.stateRoot, profile: options.profile }), { recursive: true });
    mkdirSync(resolveConversationCheckpointMetaDir({ stateRoot: options.stateRoot, profile: options.profile }), { recursive: true });
    writeFileAtomic(snapshotPath, snapshotContent);
    writeFileAtomic(metaPath, `${JSON.stringify(record, null, 2)}\n`);
    return {
        ...record,
        snapshotMissing: false,
    };
}
export function deleteConversationCheckpoint(options) {
    validateProfileName(options.profile);
    validateConversationCheckpointId(options.checkpointId);
    const existing = getConversationCheckpoint(options);
    const snapshotPath = existing
        ? resolveConversationCheckpointSnapshotFile({
            stateRoot: options.stateRoot,
            profile: options.profile,
            checkpoint: existing,
        })
        : resolveConversationCheckpointSnapshotPath(options);
    const metaPath = resolveConversationCheckpointMetaPath(options);
    let deleted = false;
    if (existsSync(snapshotPath)) {
        rmSync(snapshotPath, { force: true });
        deleted = true;
    }
    if (existsSync(metaPath)) {
        rmSync(metaPath, { force: true });
        deleted = true;
    }
    return deleted;
}
