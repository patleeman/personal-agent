export interface StoredSessionMeta {
  id: string;
  file: string;
  timestamp: string;
  cwd: string;
  workspaceCwd?: string | null;
  cwdSlug: string;
  model: string;
  title: string;
  messageCount: number;
  lastActivityAt: string;
}
export declare function listStoredSessions(options?: { sessionsDir?: string }): StoredSessionMeta[];
