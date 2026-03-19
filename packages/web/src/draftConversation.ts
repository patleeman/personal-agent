import type { ExcalidrawSceneData } from './excalidrawUtils';
import { NEW_CONVERSATION_TITLE } from './conversationTitle';
import { clearStoredState, getSessionStorage, persistStoredState, readStoredState, type StorageLike } from './reloadState';
import type { PromptImageInput, SessionMeta } from './types';

export const DRAFT_CONVERSATION_ID = 'new';
export const DRAFT_CONVERSATION_ROUTE = '/conversations/new';
export const DRAFT_CONVERSATION_STATE_CHANGED_EVENT = 'pa:draft-conversation-state-changed';

const DRAFT_CONVERSATION_COMPOSER_STORAGE_KEY = 'pa:reload:conversation:draft:composer';
const DRAFT_CONVERSATION_CWD_STORAGE_KEY = 'pa:reload:conversation:draft:cwd';
const DRAFT_CONVERSATION_ATTACHMENTS_STORAGE_KEY = 'pa:reload:conversation:draft:attachments';
const DRAFT_CONVERSATION_EXECUTION_TARGET_STORAGE_KEY = 'pa:reload:conversation:draft:execution-target';

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

export interface DraftConversationAttachments {
  images: PromptImageInput[];
  drawings: DraftConversationDrawingAttachment[];
}

export function buildDraftConversationComposerStorageKey(): string {
  return DRAFT_CONVERSATION_COMPOSER_STORAGE_KEY;
}

export function buildDraftConversationCwdStorageKey(): string {
  return DRAFT_CONVERSATION_CWD_STORAGE_KEY;
}

export function buildDraftConversationAttachmentsStorageKey(): string {
  return DRAFT_CONVERSATION_ATTACHMENTS_STORAGE_KEY;
}

export function buildDraftConversationExecutionTargetStorageKey(): string {
  return DRAFT_CONVERSATION_EXECUTION_TARGET_STORAGE_KEY;
}

function normalizeDraftConversationComposer(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeDraftConversationCwd(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeDraftConversationExecutionTarget(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDraftConversationImage(value: unknown): PromptImageInput | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const image = value as Partial<PromptImageInput>;
  if (typeof image.mimeType !== 'string' || typeof image.data !== 'string') {
    return null;
  }

  return {
    mimeType: image.mimeType,
    data: image.data,
    ...(typeof image.name === 'string' ? { name: image.name } : {}),
    ...(typeof image.previewUrl === 'string' ? { previewUrl: image.previewUrl } : {}),
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

export function readDraftConversationExecutionTarget(
  storage: StorageLike | null = getSessionStorage(),
): string | null {
  return readStoredState<string | null>({
    key: buildDraftConversationExecutionTargetStorageKey(),
    fallback: null,
    storage,
    deserialize: (raw) => normalizeDraftConversationExecutionTarget(JSON.parse(raw) as unknown),
  });
}

export function persistDraftConversationExecutionTarget(
  targetId: string | null,
  storage: StorageLike | null = getSessionStorage(),
): void {
  persistStoredState({
    key: buildDraftConversationExecutionTargetStorageKey(),
    value: targetId,
    storage,
    shouldPersist: (value) => typeof value === 'string' && value.trim().length > 0,
  });
  emitDraftConversationStateChanged();
}

export function clearDraftConversationExecutionTarget(
  storage: StorageLike | null = getSessionStorage(),
): void {
  clearStoredState(storage, buildDraftConversationExecutionTargetStorageKey());
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

export function hasDraftConversationAttachments(
  storage: StorageLike | null = getSessionStorage(),
): boolean {
  const attachments = readDraftConversationAttachments(storage);
  return attachments.images.length > 0 || attachments.drawings.length > 0;
}

export function isDraftConversationPath(pathname: string): boolean {
  return pathname === DRAFT_CONVERSATION_ROUTE;
}

export function shouldShowDraftConversationTab(
  pathname: string,
  composerText: string,
  cwd = '',
  hasAttachments = false,
): boolean {
  return isDraftConversationPath(pathname)
    || composerText.trim().length > 0
    || cwd.trim().length > 0
    || hasAttachments;
}

export function buildDraftConversationSessionMeta(timestamp = new Date().toISOString(), cwd = ''): SessionMeta {
  return {
    id: DRAFT_CONVERSATION_ID,
    file: '',
    timestamp,
    cwd: cwd.trim() || 'Draft',
    cwdSlug: 'draft',
    model: '',
    title: NEW_CONVERSATION_TITLE,
    messageCount: 0,
  };
}
