import type { ParsedTaskDefinition } from './tasks-parser.js';
interface TaskRunThreadBinding {
  threadMode?: 'dedicated' | 'existing' | 'none';
  threadSessionFile?: string;
  threadConversationId?: string;
}
export type RunnableTaskDefinition = ParsedTaskDefinition &
  TaskRunThreadBinding & {
    targetType?: 'background-agent' | 'conversation';
    conversationBehavior?: 'steer' | 'followUp';
  };
export interface TaskRunRequest {
  task: RunnableTaskDefinition;
  attempt: number;
  runsRoot: string;
  signal?: AbortSignal;
}
export interface TaskRunResult {
  success: boolean;
  startedAt: string;
  endedAt: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  logPath: string;
  error?: string;
  outputText?: string;
}
export declare function runTaskInIsolatedPi(request: TaskRunRequest): Promise<TaskRunResult>;
export {};
