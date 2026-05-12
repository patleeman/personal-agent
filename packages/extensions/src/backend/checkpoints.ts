export interface ConversationCommitCheckpointFile {
  path: string;
  previousPath?: string;
  status: ConversationCommitCheckpointFileStatus;
  additions: number;
  deletions: number;
  patch: string;
}

export type ConversationCommitCheckpointFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export interface ConversationCommitCheckpointRecord {
  id: string;
  title: string;
  cwd: string;
  commitSha: string;
  shortSha: string;
  subject: string;
  body?: string;
  authorName: string;
  authorEmail?: string;
  committedAt: string;
  files: ConversationCommitCheckpointFile[];
  fileCount: number;
  linesAdded: number;
  linesDeleted: number;
  updatedAt: string;
}

export interface ConversationCommitCheckpointSummary {
  id: string;
  title: string;
  commitSha: string;
  shortSha: string;
  subject: string;
  fileCount: number;
  linesAdded: number;
  linesDeleted: number;
  updatedAt: string;
}

export interface ConversationCommitCheckpointSelector {
  profile: string;
  conversationId: string;
}

export interface SaveConversationCommitCheckpointInput extends ConversationCommitCheckpointSelector {
  checkpointId: string;
  title: string;
  cwd: string;
  commitSha: string;
  shortSha: string;
  subject: string;
  body?: string;
  authorName: string;
  authorEmail?: string;
  committedAt: string;
  files: ConversationCommitCheckpointFile[];
  linesAdded: number;
  linesDeleted: number;
}

/**
 * Backend imports are resolved by the Personal Agent host when building trusted
 * local extensions. This package subpath exists so tooling has a real public
 * contract; runtime implementations are provided by the desktop host alias.
 */
function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/checkpoints must be resolved by the Personal Agent host runtime.');
}

export function listConversationCommitCheckpoints(_input: ConversationCommitCheckpointSelector): ConversationCommitCheckpointSummary[] {
  return hostResolved();
}

export function getConversationCommitCheckpoint(
  _input: ConversationCommitCheckpointSelector & { checkpointId: string },
): ConversationCommitCheckpointRecord | null {
  return hostResolved();
}

export function saveConversationCommitCheckpoint(_input: SaveConversationCommitCheckpointInput): ConversationCommitCheckpointRecord {
  return hostResolved();
}
