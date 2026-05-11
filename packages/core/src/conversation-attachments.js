import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { validateConversationId } from './conversation-project-links.js';
import { getStateRoot } from './runtime/paths.js';
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const ATTACHMENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const ATTACHMENT_KIND_VALUES = ['excalidraw'];
const CONVERSATION_ATTACHMENT_VERSION = 1;
const SOURCE_FILE_NAME = 'source.excalidraw';
const PREVIEW_FILE_NAME = 'preview.png';
function getConversationAttachmentStateRoot(stateRoot) {
  return resolve(stateRoot ?? getStateRoot());
}
function validateProfileName(profile) {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(`Invalid profile name "${profile}". Profile names may only include letters, numbers, dashes, and underscores.`);
  }
}
export function validateConversationAttachmentId(attachmentId) {
  if (!ATTACHMENT_ID_PATTERN.test(attachmentId)) {
    throw new Error(
      `Invalid attachment id "${attachmentId}". Attachment ids may only include letters, numbers, dots, dashes, and underscores.`,
    );
  }
}
export function validateConversationAttachmentKind(kind) {
  if (!ATTACHMENT_KIND_VALUES.includes(kind)) {
    throw new Error(`Invalid attachment kind "${kind}". Expected one of: ${ATTACHMENT_KIND_VALUES.join(', ')}.`);
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
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
function normalizeTitle(title) {
  const normalized = normalizeOptionalText(title);
  if (!normalized) {
    throw new Error('Attachment title is required.');
  }
  return normalized;
}
function normalizeRevisionNumber(value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid attachment revision: ${String(value)}.`);
  }
  return value;
}
function decodeBase64(data, label) {
  const normalized = data.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  if (normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`${label} must be valid base64.`);
  }
  let decoded;
  try {
    decoded = Buffer.from(normalized, 'base64');
  } catch {
    throw new Error(`${label} must be valid base64.`);
  }
  if (decoded.length === 0) {
    throw new Error(`${label} must decode to non-empty content.`);
  }
  return decoded;
}
function slugifyAttachmentId(value) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'drawing';
}
function trimTrailingHyphens(value) {
  return value.replace(/-+$/g, '');
}
function buildDownloadPath(conversationId, attachmentId, asset, revision) {
  const basePath = `/api/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}/download/${asset}`;
  if (!revision) {
    return basePath;
  }
  return `${basePath}?revision=${encodeURIComponent(String(revision))}`;
}
function listAttachmentDirectories(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((entryPath) => statSync(entryPath).isDirectory())
    .sort((left, right) => left.localeCompare(right));
}
function normalizeStoredRevision(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Attachment revision is invalid.');
  }
  const parsed = value;
  const revision = normalizeRevisionNumber(parsed.revision);
  const sourceName = normalizeOptionalText(parsed.sourceName);
  const sourceMimeType = normalizeOptionalText(parsed.sourceMimeType);
  const previewName = normalizeOptionalText(parsed.previewName);
  const previewMimeType = normalizeOptionalText(parsed.previewMimeType);
  const note = normalizeOptionalText(parsed.note);
  if (!sourceName) {
    throw new Error('Attachment revision sourceName is required.');
  }
  if (!sourceMimeType) {
    throw new Error('Attachment revision sourceMimeType is required.');
  }
  if (!previewName) {
    throw new Error('Attachment revision previewName is required.');
  }
  if (!previewMimeType) {
    throw new Error('Attachment revision previewMimeType is required.');
  }
  return {
    revision,
    createdAt: normalizeIsoTimestamp(typeof parsed.createdAt === 'string' ? parsed.createdAt : '', 'attachment revision createdAt'),
    sourceName,
    sourceMimeType,
    previewName,
    previewMimeType,
    ...(note ? { note } : {}),
  };
}
function normalizeStoredDocument(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Attachment document is invalid.');
  }
  const parsed = value;
  const attachmentId = normalizeOptionalText(parsed.id);
  const conversationId = normalizeOptionalText(parsed.conversationId);
  const title = normalizeTitle(parsed.title);
  if (parsed.version !== CONVERSATION_ATTACHMENT_VERSION) {
    throw new Error(`Unsupported attachment version: ${String(parsed.version)}.`);
  }
  if (!attachmentId) {
    throw new Error('Attachment id is required.');
  }
  validateConversationAttachmentId(attachmentId);
  if (!conversationId) {
    throw new Error('Attachment conversationId is required.');
  }
  validateConversationId(conversationId);
  const kindCandidate = typeof parsed.kind === 'string' ? parsed.kind : '';
  validateConversationAttachmentKind(kindCandidate);
  const revisions = Array.isArray(parsed.revisions) ? parsed.revisions.map((revision) => normalizeStoredRevision(revision)) : [];
  if (revisions.length === 0) {
    throw new Error('Attachment must have at least one revision.');
  }
  const revisionNumbers = revisions.map((revision) => revision.revision);
  const expectedNumbers = revisions.map((_revision, index) => index + 1);
  if (revisionNumbers.some((value, index) => value !== expectedNumbers[index])) {
    throw new Error('Attachment revisions must be sequential starting at 1.');
  }
  return {
    version: CONVERSATION_ATTACHMENT_VERSION,
    id: attachmentId,
    conversationId,
    kind: kindCandidate,
    title,
    createdAt: normalizeIsoTimestamp(typeof parsed.createdAt === 'string' ? parsed.createdAt : '', 'attachment createdAt'),
    updatedAt: normalizeIsoTimestamp(typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '', 'attachment updatedAt'),
    revisions,
  };
}
function readAttachmentDocumentFromPath(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf-8'));
  return normalizeStoredDocument(parsed);
}
function mapRevision(document, revision) {
  return {
    revision: revision.revision,
    createdAt: revision.createdAt,
    sourceName: revision.sourceName,
    sourceMimeType: revision.sourceMimeType,
    sourceDownloadPath: buildDownloadPath(document.conversationId, document.id, 'source', revision.revision),
    previewName: revision.previewName,
    previewMimeType: revision.previewMimeType,
    previewDownloadPath: buildDownloadPath(document.conversationId, document.id, 'preview', revision.revision),
    ...(revision.note ? { note: revision.note } : {}),
  };
}
function mapSummary(document) {
  const latestRevision = document.revisions[document.revisions.length - 1];
  return {
    id: document.id,
    conversationId: document.conversationId,
    kind: document.kind,
    title: document.title,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    currentRevision: latestRevision.revision,
    latestRevision: mapRevision(document, latestRevision),
  };
}
function resolveAttachmentMetadataPath(options) {
  return join(resolveConversationAttachmentDir(options), 'metadata.json');
}
function createUniqueAttachmentId(options, baseTitle) {
  const baseId = trimTrailingHyphens(slugifyAttachmentId(baseTitle).slice(0, 48)) || 'drawing';
  let nextId = baseId;
  let suffix = 2;
  while (existsSync(resolveConversationAttachmentDir({ ...options, attachmentId: nextId }))) {
    const candidateSuffix = `-${suffix}`;
    const candidateBase = trimTrailingHyphens(baseId.slice(0, Math.max(1, 48 - candidateSuffix.length))) || 'drawing';
    nextId = `${candidateBase}${candidateSuffix}`;
    suffix += 1;
  }
  return nextId;
}
function normalizeAssetMimeType(asset, mimeType) {
  const normalized = normalizeOptionalText(mimeType);
  if (normalized) {
    return normalized;
  }
  return asset === 'source' ? 'application/vnd.excalidraw+json' : 'image/png';
}
function normalizeAssetName(asset, name, title) {
  const normalized = normalizeOptionalText(name);
  if (normalized) {
    return normalized;
  }
  const slug = slugifyAttachmentId(title).replace(/\./g, '-');
  return asset === 'source' ? `${slug || 'drawing'}.excalidraw` : `${slug || 'drawing'}.png`;
}
function resolveRevisionFiles(options) {
  const revisionDir = resolveConversationAttachmentRevisionDir(options);
  return {
    sourcePath: join(revisionDir, SOURCE_FILE_NAME),
    previewPath: join(revisionDir, PREVIEW_FILE_NAME),
  };
}
function readAttachmentDocument(options) {
  const metadataPath = resolveAttachmentMetadataPath(options);
  if (!existsSync(metadataPath)) {
    return null;
  }
  return readAttachmentDocumentFromPath(metadataPath);
}
function ensureAttachmentDocument(options) {
  const document = readAttachmentDocument(options);
  if (!document) {
    throw new Error(`Attachment not found: ${options.attachmentId}`);
  }
  return document;
}
export function resolveProfileConversationAttachmentsDir(options) {
  validateProfileName(options.profile);
  return join(getConversationAttachmentStateRoot(options.stateRoot), 'pi-agent', 'state', 'conversation-attachments', options.profile);
}
export function resolveConversationAttachmentsDir(options) {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  return join(resolveProfileConversationAttachmentsDir(options), options.conversationId);
}
export function resolveConversationAttachmentDir(options) {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  validateConversationAttachmentId(options.attachmentId);
  return join(resolveConversationAttachmentsDir(options), options.attachmentId);
}
export function resolveConversationAttachmentRevisionDir(options) {
  normalizeRevisionNumber(options.revision);
  return join(resolveConversationAttachmentDir(options), 'revisions', String(options.revision));
}
export function listConversationAttachments(options) {
  const attachmentDirs = listAttachmentDirectories(resolveConversationAttachmentsDir(options));
  const summaries = attachmentDirs.flatMap((attachmentDir) => {
    const metadataPath = join(attachmentDir, 'metadata.json');
    if (!existsSync(metadataPath)) {
      return [];
    }
    const document = readAttachmentDocumentFromPath(metadataPath);
    return [mapSummary(document)];
  });
  summaries.sort((left, right) => {
    const updatedDiff = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    return updatedDiff !== 0 ? updatedDiff : left.id.localeCompare(right.id);
  });
  return summaries;
}
export function getConversationAttachment(options) {
  const document = readAttachmentDocument(options);
  if (!document) {
    return null;
  }
  const summary = mapSummary(document);
  return {
    ...summary,
    revisions: document.revisions.map((revision) => mapRevision(document, revision)),
  };
}
export function saveConversationAttachment(options) {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  const kind = options.kind ?? 'excalidraw';
  validateConversationAttachmentKind(kind);
  const sourceBuffer = decodeBase64(options.sourceData, 'Attachment source data');
  const previewBuffer = decodeBase64(options.previewData, 'Attachment preview data');
  const attachmentId = options.attachmentId?.trim()
    ? options.attachmentId.trim()
    : createUniqueAttachmentId(options, options.title ?? 'drawing');
  validateConversationAttachmentId(attachmentId);
  const nowIso = new Date().toISOString();
  const documentOptions = {
    stateRoot: options.stateRoot,
    profile: options.profile,
    conversationId: options.conversationId,
    attachmentId,
  };
  const existing = readAttachmentDocument(documentOptions);
  if (existing && existing.kind !== kind) {
    throw new Error(`Attachment kind mismatch for ${attachmentId}: expected ${existing.kind}, received ${kind}.`);
  }
  const title =
    options.title !== undefined
      ? normalizeTitle(options.title)
      : existing?.title
        ? normalizeTitle(existing.title)
        : normalizeTitle('Drawing');
  const revision = (existing?.revisions.length ?? 0) + 1;
  const revisionCreatedAt = normalizeIsoTimestamp(options.updatedAt ?? nowIso, 'attachment revision createdAt');
  const revisionEntry = {
    revision,
    createdAt: revisionCreatedAt,
    sourceName: normalizeAssetName('source', options.sourceName, title),
    sourceMimeType: normalizeAssetMimeType('source', options.sourceMimeType),
    previewName: normalizeAssetName('preview', options.previewName, title),
    previewMimeType: normalizeAssetMimeType('preview', options.previewMimeType),
    ...(normalizeOptionalText(options.note) ? { note: normalizeOptionalText(options.note) } : {}),
  };
  const revisionDir = resolveConversationAttachmentRevisionDir({ ...documentOptions, revision });
  const files = resolveRevisionFiles({ ...documentOptions, revision });
  mkdirSync(revisionDir, { recursive: true });
  writeFileSync(files.sourcePath, sourceBuffer);
  writeFileSync(files.previewPath, previewBuffer);
  const createdAt = existing?.createdAt ?? normalizeIsoTimestamp(options.createdAt ?? revisionCreatedAt, 'attachment createdAt');
  const updatedAt = normalizeIsoTimestamp(options.updatedAt ?? revisionCreatedAt, 'attachment updatedAt');
  const nextDocument = {
    version: CONVERSATION_ATTACHMENT_VERSION,
    id: attachmentId,
    conversationId: options.conversationId,
    kind,
    title,
    createdAt,
    updatedAt,
    revisions: [...(existing?.revisions ?? []), revisionEntry],
  };
  const metadataPath = resolveAttachmentMetadataPath(documentOptions);
  mkdirSync(resolveConversationAttachmentDir(documentOptions), { recursive: true });
  writeFileSync(metadataPath, JSON.stringify(nextDocument, null, 2) + '\n');
  return getConversationAttachment(documentOptions);
}
export function deleteConversationAttachment(options) {
  const attachmentDir = resolveConversationAttachmentDir(options);
  if (!existsSync(attachmentDir)) {
    return false;
  }
  rmSync(attachmentDir, { recursive: true, force: true });
  return true;
}
export function readConversationAttachmentDownload(options) {
  const document = ensureAttachmentDocument(options);
  const targetRevisionNumber = options.revision ?? document.revisions.length;
  const normalizedRevisionNumber = normalizeRevisionNumber(targetRevisionNumber);
  const revision = document.revisions.find((entry) => entry.revision === normalizedRevisionNumber);
  if (!revision) {
    throw new Error(`Attachment revision not found: ${normalizedRevisionNumber}`);
  }
  const files = resolveRevisionFiles({ ...options, revision: normalizedRevisionNumber });
  const filePath = options.asset === 'source' ? files.sourcePath : files.previewPath;
  if (!existsSync(filePath)) {
    throw new Error(`Attachment file not found: ${options.asset} revision ${normalizedRevisionNumber}`);
  }
  const mappedRevision = mapRevision(document, revision);
  const attachment = mapSummary(document);
  return {
    attachment,
    revision: mappedRevision,
    filePath,
    fileName: options.asset === 'source' ? revision.sourceName : revision.previewName,
    mimeType: options.asset === 'source' ? revision.sourceMimeType : revision.previewMimeType,
  };
}
function normalizePromptRefs(refs) {
  const normalized = [];
  const seen = new Set();
  for (const ref of refs) {
    const attachmentId = normalizeOptionalText(ref.attachmentId);
    if (!attachmentId) {
      continue;
    }
    validateConversationAttachmentId(attachmentId);
    const revision = ref.revision === undefined ? undefined : normalizeRevisionNumber(ref.revision);
    const key = `${attachmentId}:${String(revision ?? 'latest')}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({ attachmentId, ...(revision ? { revision } : {}) });
  }
  return normalized;
}
export function resolveConversationAttachmentPromptFiles(options) {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  const refs = normalizePromptRefs(options.refs);
  const files = [];
  for (const ref of refs) {
    const sourceDownload = readConversationAttachmentDownload({
      stateRoot: options.stateRoot,
      profile: options.profile,
      conversationId: options.conversationId,
      attachmentId: ref.attachmentId,
      asset: 'source',
      ...(ref.revision ? { revision: ref.revision } : {}),
    });
    const previewDownload = readConversationAttachmentDownload({
      stateRoot: options.stateRoot,
      profile: options.profile,
      conversationId: options.conversationId,
      attachmentId: ref.attachmentId,
      asset: 'preview',
      ...(ref.revision ? { revision: ref.revision } : {}),
    });
    files.push({
      attachmentId: sourceDownload.attachment.id,
      title: sourceDownload.attachment.title,
      kind: sourceDownload.attachment.kind,
      revision: sourceDownload.revision.revision,
      sourceName: sourceDownload.revision.sourceName,
      sourceMimeType: sourceDownload.revision.sourceMimeType,
      sourcePath: sourceDownload.filePath,
      previewName: previewDownload.revision.previewName,
      previewMimeType: previewDownload.revision.previewMimeType,
      previewPath: previewDownload.filePath,
    });
  }
  return files;
}
