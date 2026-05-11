import { type BackgroundRunAgentSpec } from '../background-run-agent.js';
import { type DurableRunPaths } from './store.js';
/**
 * Immediate background-run request.
 *
 * This remains the daemon-facing API for “start now” runs even though it now
 * compiles down to the lower-level scheduleRun() implementation internally.
 */
export interface StartBackgroundRunInput {
  taskSlug: string;
  cwd: string;
  argv?: string[];
  shellCommand?: string;
  agent?: BackgroundRunAgentSpec;
  source?: {
    type: string;
    id?: string;
    filePath?: string;
  };
  callbackConversation?: {
    conversationId: string;
    sessionFile: string;
    profile: string;
    repoRoot?: string;
  };
  manifestMetadata?: Record<string, unknown>;
  checkpointPayload?: Record<string, unknown>;
  createdAt?: string;
  continueSession?: boolean;
  bootstrapSessionDir?: string;
  /** Override default callback behavior */
  callback?: {
    alertLevel?: 'none' | 'passive' | 'disruptive';
    autoResumeIfOpen?: boolean;
    requireAck?: boolean;
  };
}
export interface StartBackgroundRunRecord {
  runId: string;
  paths: DurableRunPaths;
  argv?: string[];
  shellCommand?: string;
}
export interface FinalizeBackgroundRunInput {
  runId: string;
  runPaths: DurableRunPaths;
  taskSlug: string;
  cwd: string;
  startedAt: string;
  endedAt: string;
  exitCode: number;
  signal: NodeJS.Signals | null;
  cancelled: boolean;
  error?: string;
  summary?: string;
}
export declare function createBackgroundRunId(taskSlug: string, createdAt: string): string;
export declare function createBackgroundRunRecord(runsRoot: string, input: StartBackgroundRunInput): Promise<StartBackgroundRunRecord>;
export declare function markBackgroundRunStarted(input: {
  runId: string;
  runPaths: DurableRunPaths;
  startedAt: string;
  pid: number;
  taskSlug: string;
  cwd: string;
}): Promise<void>;
export declare function finalizeBackgroundRun(input: FinalizeBackgroundRunInput): Promise<void>;
export declare function markBackgroundRunCancelling(input: {
  runId: string;
  runPaths: DurableRunPaths;
  reason: string;
  cancelledAt?: string;
}): Promise<boolean>;
export declare function markBackgroundRunInterrupted(input: {
  runId: string;
  runPaths: DurableRunPaths;
  reason: string;
  interruptedAt?: string;
}): Promise<boolean>;
