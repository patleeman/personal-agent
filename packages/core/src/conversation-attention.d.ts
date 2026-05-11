export interface ConversationAttentionStateOptions {
  profile: string;
  stateRoot?: string;
}
export interface ConversationAttentionRecord {
  conversationId: string;
  acknowledgedMessageCount: number;
  readAt: string;
  updatedAt: string;
  forcedUnread?: boolean;
}
export interface ConversationAttentionStateDocument {
  version: 1;
  profile: string;
  conversations: Record<string, ConversationAttentionRecord>;
}
export interface ConversationAttentionConversationInput {
  conversationId: string;
  messageCount: number;
  lastActivityAt?: string;
}
export interface ConversationAttentionUnreadActivityInput {
  id: string;
  createdAt: string;
  relatedConversationIds: string[];
}
export interface ConversationAttentionSummary {
  conversationId: string;
  acknowledgedMessageCount: number;
  readAt: string;
  updatedAt: string;
  forcedUnread: boolean;
  unreadMessageCount: number;
  unreadActivityCount: number;
  unreadActivityIds: string[];
  needsAttention: boolean;
  attentionUpdatedAt: string;
}
export declare function resolveConversationAttentionStatePath(options: ConversationAttentionStateOptions): string;
export declare function loadConversationAttentionState(options: ConversationAttentionStateOptions): ConversationAttentionStateDocument;
export declare function saveConversationAttentionState(options: {
  profile: string;
  stateRoot?: string;
  document: ConversationAttentionStateDocument;
}): string;
export declare function mergeConversationAttentionStateDocuments(options: {
  profile?: string;
  documents: unknown[];
}): ConversationAttentionStateDocument;
export declare function ensureConversationAttentionBaselines(options: {
  profile: string;
  stateRoot?: string;
  conversations: ConversationAttentionConversationInput[];
  updatedAt?: string;
}): ConversationAttentionStateDocument;
export declare function markConversationAttentionRead(options: {
  profile: string;
  stateRoot?: string;
  conversationId: string;
  messageCount: number;
  updatedAt?: string;
}): ConversationAttentionStateDocument;
export declare function markConversationAttentionUnread(options: {
  profile: string;
  stateRoot?: string;
  conversationId: string;
  messageCount?: number;
  updatedAt?: string;
}): ConversationAttentionStateDocument;
export declare function summarizeConversationAttention(options: {
  profile: string;
  stateRoot?: string;
  conversations: ConversationAttentionConversationInput[];
  unreadActivityEntries?: ConversationAttentionUnreadActivityInput[];
  updatedAt?: string;
}): ConversationAttentionSummary[];
