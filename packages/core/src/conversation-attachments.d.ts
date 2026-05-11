declare const ATTACHMENT_KIND_VALUES: readonly ['excalidraw'];
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
export declare function validateConversationAttachmentId(attachmentId: string): void;
export declare function validateConversationAttachmentKind(kind: string): asserts kind is ConversationAttachmentKind;
export declare function resolveProfileConversationAttachmentsDir(options: { profile: string; stateRoot?: string }): string;
export declare function resolveConversationAttachmentsDir(options: ResolveConversationAttachmentOptions): string;
export declare function resolveConversationAttachmentDir(options: ResolveConversationAttachmentPathOptions): string;
export declare function resolveConversationAttachmentRevisionDir(
  options: ResolveConversationAttachmentPathOptions & {
    revision: number;
  },
): string;
export declare function listConversationAttachments(options: ResolveConversationAttachmentOptions): ConversationAttachmentSummary[];
export declare function getConversationAttachment(options: ResolveConversationAttachmentPathOptions): ConversationAttachmentRecord | null;
export declare function saveConversationAttachment(
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
): ConversationAttachmentRecord;
export declare function deleteConversationAttachment(options: ResolveConversationAttachmentPathOptions): boolean;
export declare function readConversationAttachmentDownload(
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
};
export declare function resolveConversationAttachmentPromptFiles(
  options: ResolveConversationAttachmentOptions & {
    refs: ConversationAttachmentPromptRef[];
  },
): ConversationAttachmentPromptFile[];
export {};
