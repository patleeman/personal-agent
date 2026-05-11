declare const CHECKPOINT_FILE_STATUS_VALUES: readonly [
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'typechange',
  'unmerged',
  'unknown',
];
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
export interface ConversationCommitCheckpointComment {
  id: string;
  authorName: string;
  authorProfile?: string;
  body: string;
  filePath?: string;
  createdAt: string;
  updatedAt: string;
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
  commentCount: number;
}
export interface ConversationCommitCheckpointRecord extends ConversationCommitCheckpointSummary {
  files: ConversationCommitCheckpointFile[];
  comments: ConversationCommitCheckpointComment[];
}
export declare function validateConversationCommitCheckpointId(checkpointId: string): void;
export declare function resolveProfileConversationCommitCheckpointsDir(options: { profile: string; stateRoot?: string }): string;
export declare function resolveConversationCommitCheckpointsDir(options: ResolveConversationCommitCheckpointOptions): string;
export declare function resolveConversationCommitCheckpointPath(options: ResolveConversationCommitCheckpointPathOptions): string;
export declare function getConversationCommitCheckpoint(
  options: ResolveConversationCommitCheckpointPathOptions,
): ConversationCommitCheckpointRecord | null;
export declare function listConversationCommitCheckpoints(
  options: ResolveConversationCommitCheckpointOptions,
): ConversationCommitCheckpointSummary[];
export declare function saveConversationCommitCheckpoint(options: {
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
  comments?: ConversationCommitCheckpointComment[];
  files: ConversationCommitCheckpointFile[];
  linesAdded: number;
  linesDeleted: number;
  stateRoot?: string;
}): ConversationCommitCheckpointRecord;
export declare function addConversationCommitCheckpointComment(options: {
  profile: string;
  conversationId: string;
  checkpointId: string;
  body: string;
  authorName: string;
  authorProfile?: string;
  filePath?: string;
  createdAt?: string;
  updatedAt?: string;
  stateRoot?: string;
}): ConversationCommitCheckpointRecord | null;
export {};
