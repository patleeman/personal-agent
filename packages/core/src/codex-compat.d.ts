export interface CompatDisplayImage {
  alt: string;
  src?: string;
  mimeType?: string;
  caption?: string;
}
export type CompatDisplayBlock =
  | {
      type: 'user';
      id: string;
      ts: string;
      text: string;
      images?: CompatDisplayImage[];
    }
  | {
      type: 'text';
      id: string;
      ts: string;
      text: string;
    }
  | {
      type: 'context';
      id: string;
      ts: string;
      text: string;
      customType?: string;
    }
  | {
      type: 'summary';
      id: string;
      ts: string;
      kind: 'compaction' | 'branch';
      title: string;
      text: string;
      detail?: string;
    }
  | {
      type: 'thinking';
      id: string;
      ts: string;
      text: string;
    }
  | {
      type: 'tool_use';
      id: string;
      ts: string;
      tool: string;
      input: Record<string, unknown>;
      output: string;
      durationMs?: number;
      toolCallId: string;
      details?: unknown;
      outputDeferred?: boolean;
    }
  | {
      type: 'image';
      id: string;
      ts: string;
      alt: string;
      src?: string;
      mimeType?: string;
      width?: number;
      height?: number;
      caption?: string;
      deferred?: boolean;
    }
  | {
      type: 'error';
      id: string;
      ts: string;
      tool?: string;
      message: string;
    };
export interface CompatSessionMeta {
  id: string;
  file: string;
  timestamp: string;
  cwd: string;
  cwdSlug: string;
  model: string;
  title: string;
  messageCount: number;
  isRunning?: boolean;
  isLive?: boolean;
  lastActivityAt?: string;
  parentSessionFile?: string;
  parentSessionId?: string;
  sourceRunId?: string;
}
export interface CompatSessionDetail {
  meta: CompatSessionMeta;
  blocks: CompatDisplayBlock[];
  blockOffset: number;
  totalBlocks: number;
  contextUsage: unknown;
  signature?: string;
}
export type CodexThreadStatus =
  | {
      type: 'notLoaded';
    }
  | {
      type: 'idle';
    }
  | {
      type: 'systemError';
    }
  | {
      type: 'active';
      activeFlags: string[];
    };
export type CodexUserInput =
  | {
      type: 'text';
      text: string;
      textElements: Array<{
        start: number;
        end: number;
        kind?: string;
      }>;
    }
  | {
      type: 'image';
      url: string;
    }
  | {
      type: 'localImage';
      path: string;
    }
  | {
      type: 'skill';
      name: string;
      path: string;
    }
  | {
      type: 'mention';
      name: string;
      path: string;
    };
export type CodexThreadItem =
  | {
      type: 'userMessage';
      id: string;
      content: CodexUserInput[];
    }
  | {
      type: 'agentMessage';
      id: string;
      text: string;
      phase: string | null;
      memoryCitation: unknown;
    }
  | {
      type: 'reasoning';
      id: string;
      summary: string[];
      content: string[];
    }
  | {
      type: 'dynamicToolCall';
      id: string;
      tool: string;
      arguments: unknown;
      status: 'inProgress' | 'completed' | 'failed';
      contentItems: Array<
        | {
            type: 'inputText';
            text: string;
          }
        | {
            type: 'inputImage';
            imageUrl: string;
          }
      > | null;
      success: boolean | null;
      durationMs: number | null;
    };
export interface CodexTurnError {
  message: string;
  codexErrorInfo: unknown;
  additionalDetails: string | null;
}
export interface CodexTurn {
  id: string;
  items: CodexThreadItem[];
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: CodexTurnError | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}
export interface CodexThread {
  id: string;
  forkedFromId: string | null;
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  status: CodexThreadStatus;
  path: string | null;
  cwd: string;
  cliVersion: string;
  source: string;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: unknown;
  name: string | null;
  turns: CodexTurn[];
}
export declare function buildCodexThreadFromSessionDetail(input: {
  detail: CompatSessionDetail;
  modelProvider: string;
  cliVersion: string;
}): CodexThread;
export declare function buildSessionMetaFromCodexThread(input: { thread: CodexThread; model: string }): CompatSessionMeta;
export declare function buildSessionDetailFromCodexThread(input: { thread: CodexThread; model: string }): CompatSessionDetail;
