/**
 * Unified run scheduling primitive.
 *
 * Single entry point for all run types: immediate, deferred, cron, or at.
 */
import { type DurableRunKind, type DurableRunPaths, type DurableRunResumePolicy } from './store.js';
export interface TriggerNow {
  type: 'now';
}
interface TriggerAt {
  type: 'at';
  at: Date;
}
interface TriggerCron {
  type: 'cron';
  expression: string;
}
interface TriggerDefer {
  type: 'defer';
  delay: string;
}
type Trigger = TriggerNow | TriggerAt | TriggerCron | TriggerDefer;
interface TargetConversation {
  type: 'conversation';
  conversationId: string;
  prompt: string;
}
export interface TargetAgent {
  type: 'agent';
  prompt: string;
  /** @deprecated Ignored; agent runs always use the shared runtime scope. */
  profile?: string;
  model?: string;
  noSession?: boolean;
}
export interface TargetShell {
  type: 'shell';
  command: string;
  cwd?: string;
  argv?: string[];
}
type Target = TargetConversation | TargetAgent | TargetShell;
interface CallbackOptions {
  alertLevel?: 'none' | 'passive' | 'disruptive';
  autoResumeIfOpen?: boolean;
  requireAck?: boolean;
}
interface LoopOptions {
  enabled: boolean;
  delay?: string;
  maxIterations?: number;
  retry?: {
    attempts?: number;
    backoff?: 'linear' | 'exponential';
    maxDelay?: string;
  };
}
export interface ScheduleRunInput {
  conversation?: {
    id: string;
    state: 'open' | 'dormant';
  };
  trigger: Trigger;
  target: Target;
  callback?: CallbackOptions;
  loop?: LoopOptions;
  source?: {
    type: string;
    id?: string;
    filePath?: string;
  };
  metadata?: Record<string, unknown>;
}
export interface ScheduleRunResult {
  runId: string;
  paths: DurableRunPaths;
  kind: DurableRunKind;
  resumePolicy: DurableRunResumePolicy;
}
/**
 * Schedule a run using the unified ScheduleRunInput interface.
 *
 * This is the canonical entry point for all run scheduling.
 *
 * @param daemonRoot - The daemon's root directory (contains 'runs' subdirectory)
 * @param input - The unified schedule input
 * @returns The created run record
 */
export declare function scheduleRun(daemonRoot: string, input: ScheduleRunInput): Promise<ScheduleRunResult>;
export {};
