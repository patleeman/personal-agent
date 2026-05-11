export type WebLiveConversationRunState = 'waiting' | 'running' | 'interrupted' | 'failed';
export interface WebLiveConversationPreludeMessage {
  customType: string;
  content: string;
}
export interface WebLiveConversationPromptImage {
  type: 'image';
  data: string;
  mimeType: string;
  name?: string;
}
export interface WebLiveConversationPendingOperation {
  type: 'prompt';
  text: string;
  behavior?: 'steer' | 'followUp';
  images?: WebLiveConversationPromptImage[];
  contextMessages?: WebLiveConversationPreludeMessage[];
  enqueuedAt: string;
}
export interface RecoverableWebLiveConversationRun {
  runId: string;
  conversationId: string;
  sessionFile: string;
  cwd: string;
  title?: string;
  profile?: string;
  state: WebLiveConversationRunState;
  pendingOperation?: WebLiveConversationPendingOperation;
}
export declare function parsePendingOperation(value: unknown): WebLiveConversationPendingOperation | undefined;
export declare function createWebLiveConversationRunId(conversationId: string): string;
export declare function saveWebLiveConversationRunState(input: {
  conversationId: string;
  sessionFile: string;
  cwd: string;
  title?: string;
  profile?: string;
  state: WebLiveConversationRunState;
  updatedAt?: string | Date;
  lastError?: string;
  pendingOperation?: WebLiveConversationPendingOperation | null;
}): Promise<{
  runId: string;
}>;
export declare function listRecoverableWebLiveConversationRuns(): RecoverableWebLiveConversationRun[];
