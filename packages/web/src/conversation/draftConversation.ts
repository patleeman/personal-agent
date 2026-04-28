import type { ExcalidrawSceneData } from '../content/excalidrawUtils';
import { clearStoredState, getSessionStorage, persistStoredState, readStoredState, type StorageLike } from '../local/reloadState';
import type { ConversationContextDocRef, PromptImageInput } from '../shared/types';

export const DRAFT_CONVERSATION_ID = 'new';
export const DRAFT_CONVERSATION_ROUTE = '/conversations/new';
export const DRAFT_CONVERSATION_STATE_CHANGED_EVENT = 'pa:draft-conversation-state-changed';

const DRAFT_CONVERSATION_COMPOSER_STORAGE_KEY = 'pa:reload:conversation:draft:composer';
const DRAFT_CONVERSATION_CWD_STORAGE_KEY = 'pa:reload:conversation:draft:cwd';
const DRAFT_CONVERSATION_ATTACHMENTS_STORAGE_KEY = 'pa:reload:conversation:draft:attachments';
const DRAFT_CONVERSATION_MODEL_STORAGE_KEY = 'pa:reload:conversation:draft:model';
const DRAFT_CONVERSATION_THINKING_LEVEL_STORAGE_KEY = 'pa:reload:conversation:draft:thinking-level';
const DRAFT_CONVERSATION_SERVICE_TIER_STORAGE_KEY = 'pa:reload:conversation:draft:service-tier';
const DRAFT_CONVERSATION_CONTEXT_DOCS_STORAGE_KEY = 'pa:reload:conversation:draft:context-docs';

let draftConversationAttachmentsMutationVersion = 0;

export interface DraftConversationDrawingAttachment {
  localId: string;
  title: string;
  attachmentId?: string;
  revision?: number;
  sourceData: string;
  sourceMimeType: string;
  sourceName: string;
  previewData: string;
  previewMimeType: string;
  previewName: string;
  previewUrl: string;
  scene: ExcalidrawSceneData;
  dirty: boolean;
}

interface DraftConversationAttachments {
  images: PromptImageInput[];
  drawings: DraftConversationDrawingAttachment[];
}

export function buildDraftConversationComposerStorageKey(): string {
  return DRAFT_CONVERSATION_COMPOSER_STORAGE_KEY;
}

export function buildDraftConversationCwdStorageKey(): string {
  return DRAFT_CONVERSATION_CWD_STORAGE_KEY;
}

function buildDraftConversationAttachmentsStorageKey(): string {
  return DRAFT_CONVERSATION_ATTACHMENTS_STORAGE_KEY;
}

function buildConversationAttachmentsStorageKey(sessionId: string): string {
  return `pa:reload:conversation:${sessionId}:attachments`;
}

function buildDraftConversationModelStorageKey(): string {
  return DRAFT_CONVERSATION_MODEL_STORAGE_KEY;
}

function buildDraftConversationThinkingLevelStorageKey(): string {
  return DRAFT_CONVERSATION_THINKING_LEVEL_STORAGE_KEY;
}

function buildDraftConversationServiceTierStorageKey(): string {
  return DRAFT_CONVERSATION_SERVICE_TIER_STORAGE_KEY;
}

function buildDraftConversationContextDocsStorageKey(): string {
  return DRAFT_CONVERSATION_CONTEXT_DOCS_STORAGE_KEY;
}

function normalizeDraftConversationComposer(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeDraftConversationCwd(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeDraftConversationModel(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDraftConversationThinkingLevel(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDraftConversationServiceTier(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDraftConversationImageData(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const data = value.trim();
  if (!data || data.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return null;
  }

  return data;
}

function normalizeDraftConversationImagePreviewUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const previewUrl = value.trim();
  if (!previewUrl) {
    return null;
  }

  return previewUrl.startsWith('blob:') || previewUrl.toLowerCase().startsWith('data:image/')
    ? previewUrl
    : null;
}

function normalizeDraftConversationImage(value: unknown): PromptImageInput | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const image = value as Partial<PromptImageInput>;
  if (typeof image.mimeType !== 'string' || typeof image.data !== 'string') {
    return null;
  }

  const mimeType = image.mimeType.trim();
  const data = normalizeDraftConversationImageData(image.data);
  const previewUrl = normalizeDraftConversationImagePreviewUrl(image.previewUrl);
  if (!mimeType.toLowerCase().startsWith('image/') || !data) {
    return null;
  }

  return {
    mimeType,
    data,
    ...(typeof image.name === 'string' && image.name.trim() ? { name: image.name.trim() } : {}),
    ...(previewUrl ? { previewUrl } : {}),
  };
}

function normalizeDraftConversationDrawing(value: unknown): DraftConversationDrawingAttachment | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const drawing = value as Partial<DraftConversationDrawingAttachment>;
  if (
    typeof drawing.localId !== 'string'
    || typeof drawing.title !== 'string'
    || typeof drawing.sourceData !== 'string'
    || typeof drawing.sourceMimeType !== 'string'
    || typeof drawing.sourceName !== 'string'
    || typeof drawing.previewData !== 'string'
    || typeof drawing.previewMimeType !== 'string'
    || typeof drawing.previewName !== 'string'
    || typeof drawing.previewUrl !== 'string'
    || typeof drawing.dirty !== 'boolean'
    || !drawing.scene
    || typeof drawing.scene !== 'object'
  ) {
    return null;
  }

  return {
    localId: drawing.localId,
    title: drawing.title,
    ...(typeof drawing.attachmentId === 'string' && drawing.attachmentId.trim().length > 0
      ? { attachmentId: drawing.attachmentId.trim() }
      : {}),
    ...(Number.isInteger(drawing.revision) && Number(drawing.revision) > 0
      ? { revision: Number(drawing.revision) }
      : {}),
    sourceData: drawing.sourceData,
    sourceMimeType: drawing.sourceMimeType,
    sourceName: drawing.sourceName,
    previewData: drawing.previewData,
    previewMimeType: drawing.previewMimeType,
    previewName: drawing.previewName,
    previewUrl: drawing.previewUrl,
    scene: drawing.scene,
    dirty: drawing.dirty,
  };
}

function normalizeDraftConversationAttachments(value: unknown): DraftConversationAttachments {
  if (!value || typeof value !== 'object') {
    return { images: [], drawings: [] };
  }

  const attachments = value as Partial<DraftConversationAttachments>;
  const images = Array.isArray(attachments.images)
    ? attachments.images
      .map((image) => normalizeDraftConversationImage(image))
      .filter((image): image is PromptImageInput => image !== null)
    : [];
  const drawings = Array.isArray(attachments.drawings)
    ? attachments.drawings
      .map((drawing) => normalizeDraftConversationDrawing(drawing))
      .filter((drawing): drawing is DraftConversationDrawingAttachment => drawing !== null)
    : [];

  return { images, drawings };
}

function normalizeDraftConversationContextDoc(value: unknown): ConversationContextDocRef | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const doc = value as Partial<ConversationContextDocRef>;
  if (typeof doc.path !== 'string' || typeof doc.title !== 'string') {
    return null;
  }

  const path = doc.path.trim();
  const title = doc.title.trim();
  if (!path || !title) {
    return null;
  }

  const kind: ConversationContextDocRef['kind'] = doc.kind === 'doc' || doc.kind === 'file'
    ? doc.kind
    : 'file';
  const mentionId = typeof doc.mentionId === 'string' && doc.mentionId.trim().length > 0
    ? doc.mentionId.trim()
    : undefined;
  const summary = typeof doc.summary === 'string' && doc.summary.trim().length > 0
    ? doc.summary.trim()
    : undefined;

  return {
    path,
    title,
    kind,
    ...(mentionId ? { mentionId } : {}),
    ...(summary ? { summary } : {}),
  };
}

function normalizeDraftConversationContextDocs(value: unknown): ConversationContextDocRef[] {
  const docs = Array.isArray(value)
    ? value
      .map((doc) => normalizeDraftConversationContextDoc(doc))
      .filter((doc): doc is ConversationContextDocRef => doc !== null)
    : [];

  const deduped: ConversationContextDocRef[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    if (seen.has(doc.path)) {
      continue;
    }

    seen.add(doc.path);
    deduped.push(doc);
  }

  return deduped;
}

function emitDraftConversationStateChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(DRAFT_CONVERSATION_STATE_CHANGED_EVENT));
}

export function readDraftConversationComposer(
  storage: StorageLike | null = getSessionStorage(),
): string {
  return readStoredState<string>({
    key: buildDraftConversationComposerStorageKey(),
    fallback: '',
    storage,
    deserialize: (raw) => normalizeDraftConversationComposer(JSON.parse(raw) as unknown),
  });
}

export function persistDraftConversationComposer(
  text: string,
  storage: StorageLike | null = getSessionStorage(),
): void {
  persistStoredState({
    key: buildDraftConversationComposerStorageKey(),
    value: text,
    storage,
    shouldPersist: (value) => value.length > 0,
  });
  emitDraftConversationStateChanged();
}

export function clearDraftConversationComposer(
  storage: StorageLike | null = getSessionStorage(),
): void {
  clearStoredState(storage, buildDraftConversationComposerStorageKey());
  emitDraftConversationStateChanged();
}

export function readDraftConversationCwd(
  storage: StorageLike | null = getSessionStorage(),
): string {
  return readStoredState<string>({
    key: buildDraftConversationCwdStorageKey(),
    fallback: '',
    storage,
    deserialize: (raw) => normalizeDraftConversationCwd(JSON.parse(raw) as unknown),
  });
}

export function persistDraftConversationCwd(
  cwd: string,
  storage: StorageLike | null = getSessionStorage(),
): void {
  persistStoredState({
    key: buildDraftConversationCwdStorageKey(),
    value: cwd,
    storage,
    shouldPersist: (value) => value.trim().length > 0,
  });
  emitDraftConversationStateChanged();
}

export function clearDraftConversationCwd(
  storage: StorageLike | null = getSessionStorage(),
): void {
  clearStoredState(storage, buildDraftConversationCwdStorageKey());
  emitDraftConversationStateChanged();
}

export function readDraftConversationModel(
  storage: StorageLike | null = getSessionStorage(),
): string {
  return readStoredState<string>({
    key: buildDraftConversationModelStorageKey(),
    fallback: '',
    storage,
    deserialize: (raw) => normalizeDraftConversationModel(JSON.parse(raw) as unknown),
  });
}

export function persistDraftConversationModel(
  model: string,
  storage: StorageLike | null = getSessionStorage(),
): void {
  persistStoredState({
    key: buildDraftConversationModelStorageKey(),
    value: model,
    storage,
    shouldPersist: (value) => value.trim().length > 0,
  });
  emitDraftConversationStateChanged();
}

export function clearDraftConversationModel(
  storage: StorageLike | null = getSessionStorage(),
): void {
  clearStoredState(storage, buildDraftConversationModelStorageKey());
  emitDraftConversationStateChanged();
}

export function readDraftConversationThinkingLevel(
  storage: StorageLike | null = getSessionStorage(),
): string {
  return readStoredState<string>({
    key: buildDraftConversationThinkingLevelStorageKey(),
    fallback: '',
    storage,
    deserialize: (raw) => normalizeDraftConversationThinkingLevel(JSON.parse(raw) as unknown),
  });
}

export function persistDraftConversationThinkingLevel(
  thinkingLevel: string,
  storage: StorageLike | null = getSessionStorage(),
): void {
  persistStoredState({
    key: buildDraftConversationThinkingLevelStorageKey(),
    value: thinkingLevel,
    storage,
    shouldPersist: (value) => value.trim().length > 0,
  });
  emitDraftConversationStateChanged();
}

export function clearDraftConversationThinkingLevel(
  storage: StorageLike | null = getSessionStorage(),
): void {
  clearStoredState(storage, buildDraftConversationThinkingLevelStorageKey());
  emitDraftConversationStateChanged();
}

export function readDraftConversationServiceTier(
  storage: StorageLike | null = getSessionStorage(),
): string {
  return readStoredState<string>({
    key: buildDraftConversationServiceTierStorageKey(),
    fallback: '',
    storage,
    deserialize: (raw) => normalizeDraftConversationServiceTier(JSON.parse(raw) as unknown),
  });
}

export function persistDraftConversationServiceTier(
  serviceTier: string,
  storage: StorageLike | null = getSessionStorage(),
): void {
  persistStoredState({
    key: buildDraftConversationServiceTierStorageKey(),
    value: serviceTier,
    storage,
    shouldPersist: (value) => value.trim().length > 0,
  });
  emitDraftConversationStateChanged();
}

export function clearDraftConversationServiceTier(
  storage: StorageLike | null = getSessionStorage(),
): void {
  clearStoredState(storage, buildDraftConversationServiceTierStorageKey());
  emitDraftConversationStateChanged();
}

export function clearDraftConversationModelPreferences(
  storage: StorageLike | null = getSessionStorage(),
): void {
  clearStoredState(storage, buildDraftConversationModelStorageKey());
  clearStoredState(storage, buildDraftConversationThinkingLevelStorageKey());
  clearStoredState(storage, buildDraftConversationServiceTierStorageKey());
  emitDraftConversationStateChanged();
}

export function readDraftConversationAttachments(
  storage: StorageLike | null = getSessionStorage(),
): DraftConversationAttachments {
  return readStoredState<DraftConversationAttachments>({
    key: buildDraftConversationAttachmentsStorageKey(),
    fallback: { images: [], drawings: [] },
    storage,
    deserialize: (raw) => normalizeDraftConversationAttachments(JSON.parse(raw) as unknown),
  });
}

export function readConversationAttachments(
  sessionId: string,
  storage: StorageLike | null = getSessionStorage(),
): DraftConversationAttachments {
  if (!sessionId.trim()) {
    return { images: [], drawings: [] };
  }

  return readStoredState<DraftConversationAttachments>({
    key: buildConversationAttachmentsStorageKey(sessionId),
    fallback: { images: [], drawings: [] },
    storage,
    deserialize: (raw) => normalizeDraftConversationAttachments(JSON.parse(raw) as unknown),
  });
}

export function persistDraftConversationAttachments(
  attachments: DraftConversationAttachments,
  storage: StorageLike | null = getSessionStorage(),
): void {
  persistStoredState({
    key: buildDraftConversationAttachmentsStorageKey(),
    value: attachments,
    storage,
    shouldPersist: (value) => value.images.length > 0 || value.drawings.length > 0,
  });
  emitDraftConversationStateChanged();
}

export function persistConversationAttachments(
  sessionId: string,
  attachments: DraftConversationAttachments,
  storage: StorageLike | null = getSessionStorage(),
): void {
  if (!sessionId.trim()) {
    return;
  }

  persistStoredState({
    key: buildConversationAttachmentsStorageKey(sessionId),
    value: attachments,
    storage,
    shouldPersist: (value) => value.images.length > 0 || value.drawings.length > 0,
  });
}

export function beginDraftConversationAttachmentsMutation(): number {
  draftConversationAttachmentsMutationVersion += 1;
  return draftConversationAttachmentsMutationVersion;
}

export function isDraftConversationAttachmentsMutationCurrent(version: number): boolean {
  return version === draftConversationAttachmentsMutationVersion;
}

export function clearDraftConversationAttachments(
  storage: StorageLike | null = getSessionStorage(),
): void {
  beginDraftConversationAttachmentsMutation();
  clearStoredState(storage, buildDraftConversationAttachmentsStorageKey());
  emitDraftConversationStateChanged();
}

export function clearConversationAttachments(
  sessionId: string,
  storage: StorageLike | null = getSessionStorage(),
): void {
  if (!sessionId.trim()) {
    return;
  }

  beginDraftConversationAttachmentsMutation();
  clearStoredState(storage, buildConversationAttachmentsStorageKey(sessionId));
}

export function hasDraftConversationAttachments(
  storage: StorageLike | null = getSessionStorage(),
): boolean {
  const attachments = readDraftConversationAttachments(storage);
  return attachments.images.length > 0 || attachments.drawings.length > 0;
}

export function hasConversationAttachments(
  sessionId: string,
  storage: StorageLike | null = getSessionStorage(),
): boolean {
  const attachments = readConversationAttachments(sessionId, storage);
  return attachments.images.length > 0 || attachments.drawings.length > 0;
}

export function readDraftConversationContextDocs(
  storage: StorageLike | null = getSessionStorage(),
): ConversationContextDocRef[] {
  return readStoredState<ConversationContextDocRef[]>({
    key: buildDraftConversationContextDocsStorageKey(),
    fallback: [],
    storage,
    deserialize: (raw) => normalizeDraftConversationContextDocs(JSON.parse(raw) as unknown),
  });
}

export function persistDraftConversationContextDocs(
  docs: ConversationContextDocRef[],
  storage: StorageLike | null = getSessionStorage(),
): void {
  persistStoredState({
    key: buildDraftConversationContextDocsStorageKey(),
    value: normalizeDraftConversationContextDocs(docs),
    storage,
    shouldPersist: (value) => value.length > 0,
  });
  emitDraftConversationStateChanged();
}

export function clearDraftConversationContextDocs(
  storage: StorageLike | null = getSessionStorage(),
): void {
  clearStoredState(storage, buildDraftConversationContextDocsStorageKey());
  emitDraftConversationStateChanged();
}

export function hasDraftConversationContextDocs(
  storage: StorageLike | null = getSessionStorage(),
): boolean {
  return readDraftConversationContextDocs(storage).length > 0;
}


