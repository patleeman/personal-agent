import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { validateConversationId } from './conversation-project-links.js';
import { getStateRoot } from './runtime/paths.js';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const ATTACHMENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const ATTACHMENT_KIND_VALUES = ['excalidraw'] as const;
const CONVERSATION_ATTACHMENT_VERSION = 1 as const;

const SOURCE_FILE_NAME = 'source.excalidraw';
const PREVIEW_FILE_NAME = 'preview.png';

export type ConversationAttachmentKind = (typeof ATTACHMENT_KIND_VALUES)[number];
export type ConversationAttachmentAsset = 'source' | 'preview';

interface ResolveConversationAttachmentOptions {
  profile: string;
  conversationId: string;
  stateRoot?: string;
}

interface ResolveConversationAttachmentPathOptions extends ResolveConversationAttachmentOptions {
  attachmentId: string;
}

interface StoredConversationAttachmentRevision {
  revision: number;
  createdAt: string;
  sourceName: string;
  sourceMimeType: string;
  previewName: string;
  previewMimeType: string;
  note?: string;
}

interface StoredConversationAttachmentDocument {
  version: 1;
  id: string;
  conversationId: string;
  kind: ConversationAttachmentKind;
  title: string;
  createdAt: string;
  updatedAt: string;
  revisions: StoredConversationAttachmentRevision[];
}

export interface ConversationAttachmentRevision {
  revision: number;
  createdAt: string;
  sourceName: string;
  sourceMimeType: string;
  sourceDownloadPath: string;
  previewName: string;
  previewMimeType: string;
  previewDownloadPath: string;
  note?: string;
}

export interface ConversationAttachmentSummary {
  id: string;
  conversationId: string;
  kind: ConversationAttachmentKind;
  title: string;
  createdAt: string;
  updatedAt: string;
  currentRevision: number;
  latestRevision: ConversationAttachmentRevision;
}

export interface ConversationAttachmentRecord extends ConversationAttachmentSummary {
  revisions: ConversationAttachmentRevision[];
}

export interface ConversationAttachmentPromptRef {
  attachmentId: string;
  revision?: number;
}

export interface ConversationAttachmentPromptFile {
  attachmentId: string;
  title: string;
  kind: ConversationAttachmentKind;
  revision: number;
  sourceName: string;
  sourceMimeType: string;
  sourcePath: string;
  previewName: string;
  previewMimeType: string;
  previewPath: string;
}

function getConversationAttachmentStateRoot(stateRoot?: string): string {
  return resolve(stateRoot ?? getStateRoot());
}

function validateProfileName(profile: string): void {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(`Invalid profile name "${profile}". Profile names may only include letters, numbers, dashes, and underscores.`);
  }
}

export function validateConversationAttachmentId(attachmentId: string): void {
  if (!ATTACHMENT_ID_PATTERN.test(attachmentId)) {
    throw new Error(
      `Invalid attachment id "${attachmentId}". Attachment ids may only include letters, numbers, dots, dashes, and underscores.`,
    );
  }
}

export function validateConversationAttachmentKind(kind: string): asserts kind is ConversationAttachmentKind {
  if (!ATTACHMENT_KIND_VALUES.includes(kind as ConversationAttachmentKind)) {
    throw new Error(`Invalid attachment kind "${kind}". Expected one of: ${ATTACHMENT_KIND_VALUES.join(', ')}.`);
  }
}

function normalizeIsoTimestamp(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return new Date(parsed).toISOString();
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTitle(title: string | undefined): string {
  const normalized = normalizeOptionalText(title);
  if (!normalized) {
    throw new Error('Attachment title is required.');
  }

  return normalized;
}

function normalizeRevisionNumber(value: number | undefined): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`Invalid attachment revision: ${String(value)}.`);
  }

  return value as number;
}

function decodeBase64(data: string, label: string): Buffer {
  const normalized = data.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }

  if (normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`${label} must be valid base64.`);
  }

  let decoded: Buffer;
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

function slugifyAttachmentId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return slug || 'drawing';
}

function trimTrailingHyphens(value: string): string {
  return value.replace(/-+$/g, '');
}

function buildDownloadPath(conversationId: string, attachmentId: string, asset: ConversationAttachmentAsset, revision?: number): string {
  const basePath = `/api/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(
    attachmentId,
  )}/download/${asset}`;
  if (!revision) {
    return basePath;
  }

  return `${basePath}?revision=${encodeURIComponent(String(revision))}`;
}

function listAttachmentDirectories(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((entryPath) => statSync(entryPath).isDirectory())
    .sort((left, right) => left.localeCompare(right));
}

function normalizeStoredRevision(value: unknown): StoredConversationAttachmentRevision {
  if (!value || typeof value !== 'object') {
    throw new Error('Attachment revision is invalid.');
  }

  const parsed = value as Partial<StoredConversationAttachmentRevision>;
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

function normalizeStoredDocument(value: unknown): StoredConversationAttachmentDocument {
  if (!value || typeof value !== 'object') {
    throw new Error('Attachment document is invalid.');
  }

  const parsed = value as Partial<StoredConversationAttachmentDocument>;
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

function readAttachmentDocumentFromPath(path: string): StoredConversationAttachmentDocument {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  return normalizeStoredDocument(parsed);
}

function mapRevision(
  document: StoredConversationAttachmentDocument,
  revision: StoredConversationAttachmentRevision,
): ConversationAttachmentRevision {
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

function mapSummary(document: StoredConversationAttachmentDocument): ConversationAttachmentSummary {
  const latestRevision = document.revisions[document.revisions.length - 1] as StoredConversationAttachmentRevision;

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

function resolveAttachmentMetadataPath(options: ResolveConversationAttachmentPathOptions): string {
  return join(resolveConversationAttachmentDir(options), 'metadata.json');
}

function createUniqueAttachmentId(options: ResolveConversationAttachmentOptions, baseTitle: string): string {
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

function normalizeAssetMimeType(asset: ConversationAttachmentAsset, mimeType: string | undefined): string {
  const normalized = normalizeOptionalText(mimeType);
  if (normalized) {
    return normalized;
  }

  return asset === 'source' ? 'application/vnd.excalidraw+json' : 'image/png';
}

function normalizeAssetName(asset: ConversationAttachmentAsset, name: string | undefined, title: string): string {
  const normalized = normalizeOptionalText(name);
  if (normalized) {
    return normalized;
  }

  const slug = slugifyAttachmentId(title).replace(/\./g, '-');
  return asset === 'source' ? `${slug || 'drawing'}.excalidraw` : `${slug || 'drawing'}.png`;
}

function resolveRevisionFiles(options: ResolveConversationAttachmentPathOptions & { revision: number }): {
  sourcePath: string;
  previewPath: string;
} {
  const revisionDir = resolveConversationAttachmentRevisionDir(options);

  return {
    sourcePath: join(revisionDir, SOURCE_FILE_NAME),
    previewPath: join(revisionDir, PREVIEW_FILE_NAME),
  };
}

function readAttachmentDocument(options: ResolveConversationAttachmentPathOptions): StoredConversationAttachmentDocument | null {
  const metadataPath = resolveAttachmentMetadataPath(options);
  if (!existsSync(metadataPath)) {
    return null;
  }

  return readAttachmentDocumentFromPath(metadataPath);
}

function ensureAttachmentDocument(options: ResolveConversationAttachmentPathOptions): StoredConversationAttachmentDocument {
  const document = readAttachmentDocument(options);
  if (!document) {
    throw new Error(`Attachment not found: ${options.attachmentId}`);
  }

  return document;
}

export function resolveProfileConversationAttachmentsDir(options: { profile: string; stateRoot?: string }): string {
  validateProfileName(options.profile);
  return join(getConversationAttachmentStateRoot(options.stateRoot), 'pi-agent', 'state', 'conversation-attachments', options.profile);
}

export function resolveConversationAttachmentsDir(options: ResolveConversationAttachmentOptions): string {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  return join(resolveProfileConversationAttachmentsDir(options), options.conversationId);
}

export function resolveConversationAttachmentDir(options: ResolveConversationAttachmentPathOptions): string {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);
  validateConversationAttachmentId(options.attachmentId);
  return join(resolveConversationAttachmentsDir(options), options.attachmentId);
}

export function resolveConversationAttachmentRevisionDir(options: ResolveConversationAttachmentPathOptions & { revision: number }): string {
  normalizeRevisionNumber(options.revision);
  return join(resolveConversationAttachmentDir(options), 'revisions', String(options.revision));
}

export function listConversationAttachments(options: ResolveConversationAttachmentOptions): ConversationAttachmentSummary[] {
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

export function getConversationAttachment(options: ResolveConversationAttachmentPathOptions): ConversationAttachmentRecord | null {
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

export function saveConversationAttachment(
  options: ResolveConversationAttachmentOptions & {
    attachmentId?: string;
    kind?: ConversationAttachmentKind;
    title?: string;
    sourceData: string;
    sourceName?: string;
    sourceMimeType?: string;
    previewData: string;
    previewName?: string;
    previewMimeType?: string;
    note?: string;
    createdAt?: string;
    updatedAt?: string;
  },
): ConversationAttachmentRecord {
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
  const documentOptions: ResolveConversationAttachmentPathOptions = {
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

  const revisionEntry: StoredConversationAttachmentRevision = {
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

  const nextDocument: StoredConversationAttachmentDocument = {
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

  return getConversationAttachment(documentOptions) as ConversationAttachmentRecord;
}

export function deleteConversationAttachment(options: ResolveConversationAttachmentPathOptions): boolean {
  const attachmentDir = resolveConversationAttachmentDir(options);
  if (!existsSync(attachmentDir)) {
    return false;
  }

  rmSync(attachmentDir, { recursive: true, force: true });
  return true;
}

export function readConversationAttachmentDownload(
  options: ResolveConversationAttachmentPathOptions & {
    asset: ConversationAttachmentAsset;
    revision?: number;
  },
): {
  attachment: ConversationAttachmentSummary;
  revision: ConversationAttachmentRevision;
  filePath: string;
  fileName: string;
  mimeType: string;
} {
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

function normalizePromptRefs(refs: ConversationAttachmentPromptRef[]): ConversationAttachmentPromptRef[] {
  const normalized: ConversationAttachmentPromptRef[] = [];
  const seen = new Set<string>();

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

export function resolveConversationAttachmentPromptFiles(
  options: ResolveConversationAttachmentOptions & {
    refs: ConversationAttachmentPromptRef[];
  },
): ConversationAttachmentPromptFile[] {
  validateProfileName(options.profile);
  validateConversationId(options.conversationId);

  const refs = normalizePromptRefs(options.refs);
  const files: ConversationAttachmentPromptFile[] = [];

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
