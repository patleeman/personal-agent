/**
 * Unified run scheduling primitive.
 *
 * Single entry point for all run types: immediate, deferred, cron, or at.
 */

import { mkdirSync } from 'fs';
import {
  appendDurableRunEvent,
  createDurableRunManifest,
  createInitialDurableRunStatus,
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
  saveDurableRunCheckpoint,
  saveDurableRunManifest,
  saveDurableRunStatus,
  type DurableRunKind,
  type DurableRunPaths,
  type DurableRunResumePolicy,
} from './store.js';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type TriggerType = 'now' | 'at' | 'cron' | 'defer';

export interface TriggerNow {
  type: 'now';
}

export interface TriggerAt {
  type: 'at';
  at: Date;
}

export interface TriggerCron {
  type: 'cron';
  expression: string;
}

export interface TriggerDefer {
  type: 'defer';
  delay: string; // e.g. "30s", "10m", "2h", "1d"
}

export type Trigger = TriggerNow | TriggerAt | TriggerCron | TriggerDefer;

export type TargetType = 'conversation' | 'agent' | 'shell';

export interface TargetConversation {
  type: 'conversation';
  conversationId: string;
  prompt: string;
}

export interface TargetAgent {
  type: 'agent';
  prompt: string;
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

export type Target = TargetConversation | TargetAgent | TargetShell;

export interface CallbackOptions {
  alertLevel?: 'none' | 'passive' | 'disruptive';
  autoResumeIfOpen?: boolean;
  requireAck?: boolean;
}

export interface LoopOptions {
  enabled: boolean;
  delay?: string; // default inter-loop delay
  maxIterations?: number;
  retry?: {
    attempts?: number; // default 3
    backoff?: 'linear' | 'exponential';
    maxDelay?: string;
  };
}

export interface ScheduleRunInput {
  // Optional parent conversation
  conversation?: {
    id: string;
    state: 'open' | 'dormant';
  };

  // When to fire
  trigger: Trigger;

  // What to run
  target: Target;

  // How to report back (default: alertLevel='passive', autoResumeIfOpen=true)
  callback?: CallbackOptions;

  // Loop behavior
  loop?: LoopOptions;

  // Source attribution
  source?: {
    type: string;
    id?: string;
    filePath?: string;
  };

  // Arbitrary metadata
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

/**
 * Derive run kind from target type.
 */
export function deriveRunKind(target: Target): DurableRunKind {
  switch (target.type) {
    case 'conversation':
      return 'conversation';
    case 'shell':
      return 'raw-shell';
    case 'agent':
      return 'background-run';
  }
}

/**
 * Derive resume policy from trigger, target, and loop options.
 */
export function deriveResumePolicy(
  trigger: Trigger,
  target: Target,
  loop?: LoopOptions,
): DurableRunResumePolicy {
  // Conversation runs always continue (resume)
  if (target.type === 'conversation' || loop?.enabled) {
    return 'continue';
  }

  // Scheduled runs (cron/at) always rerun
  if (trigger.type === 'cron' || trigger.type === 'at') {
    return 'rerun';
  }

  // Immediate runs are manual by default
  return 'manual';
}

/**
 * Default callback options.
 */
export const DEFAULT_CALLBACK: Required<CallbackOptions> = {
  alertLevel: 'passive',
  autoResumeIfOpen: true,
  requireAck: false,
};

/**
 * Merge user-provided callback with defaults.
 */
export function resolveCallback(input?: CallbackOptions): Required<CallbackOptions> {
  return {
    ...DEFAULT_CALLBACK,
    ...input,
  };
}

// ---------------------------------------------------------------------------
// Default loop retry
// ---------------------------------------------------------------------------

export const DEFAULT_LOOP_RETRY = {
  attempts: 3,
  backoff: 'exponential' as const,
  maxDelay: '10m',
};

/**
 * Merge user-provided loop options with defaults.
 */
export function resolveLoopOptions(input?: LoopOptions): LoopOptions | undefined {
  if (!input || !input.enabled) {
    return undefined;
  }

  return {
    enabled: true,
    delay: input.delay ?? '1h',
    maxIterations: input.maxIterations,
    retry: {
      ...DEFAULT_LOOP_RETRY,
      ...input.retry,
    },
  };
}

// ---------------------------------------------------------------------------
// Spec normalization
// ---------------------------------------------------------------------------

/**
 * Build the spec object stored in the manifest.
 */
export function buildRunSpec(input: ScheduleRunInput): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    target: {
      type: input.target.type,
      ...('conversationId' in input.target ? { conversationId: input.target.conversationId } : {}),
      ...('prompt' in input.target ? { prompt: input.target.prompt } : {}),
      ...('command' in input.target ? { command: input.target.command } : {}),
      ...('cwd' in input.target ? { cwd: input.target.cwd } : {}),
      ...('argv' in input.target ? { argv: input.target.argv } : {}),
      ...('profile' in input.target ? { profile: input.target.profile } : {}),
      ...('model' in input.target ? { model: input.target.model } : {}),
      ...('noSession' in input.target ? { noSession: input.target.noSession } : {}),
    },
    callback: resolveCallback(input.callback),
  };

  if (input.loop) {
    spec.loop = resolveLoopOptions(input.loop);
  }

  if (input.metadata) {
    spec.metadata = input.metadata;
  }

  // Trigger-specific spec
  switch (input.trigger.type) {
    case 'now':
      break;
    case 'at':
      spec.dueAt = input.trigger.at.toISOString();
      break;
    case 'cron':
      spec.cronExpression = input.trigger.expression;
      break;
    case 'defer':
      spec.delay = input.trigger.delay;
      break;
  }

  return spec;
}

/**
 * Compute when this run should fire (for scheduling).
 * Returns undefined for 'now' triggers (fire immediately).
 */
export function computeDueAt(trigger: Trigger): Date | undefined {
  switch (trigger.type) {
    case 'now':
      return undefined;
    case 'at':
      return trigger.at;
    case 'defer': {
      const delayMs = parseDelayToMs(trigger.delay);
      return delayMs !== undefined ? new Date(Date.now() + delayMs) : undefined;
    }
    case 'cron':
      // Cron scheduling requires external cron library; return undefined
      // and let the scheduler handle cron expression matching
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Delay parsing
// ---------------------------------------------------------------------------

const DELAY_REGEX = /^(\d+(?:\.\d+)?)([smhd])$/i;

const DELAY_MULTIPLIERS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * Parse a delay string like "30s", "10m", "2h", "1d" to milliseconds.
 */
export function parseDelayToMs(delay: string): number | undefined {
  const match = delay.match(DELAY_REGEX);
  if (!match) {
    return undefined;
  }

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = DELAY_MULTIPLIERS[unit];

  if (!Number.isFinite(value) || !multiplier) {
    return undefined;
  }

  return Math.round(value * multiplier);
}

/**
 * Format milliseconds to a human-readable delay string.
 */
export function formatDelay(ms: number): string {
  if (ms < 60 * 1000) {
    return `${ms / 1000}s`;
  }

  if (ms < 60 * 60 * 1000) {
    return `${ms / (60 * 1000)}m`;
  }

  if (ms < 24 * 60 * 60 * 1000) {
    return `${ms / (60 * 60 * 1000)}h`;
  }

  return `${ms / (24 * 60 * 60 * 1000)}d`;
}

// ---------------------------------------------------------------------------
// Run hierarchy helpers
// ---------------------------------------------------------------------------

/**
 * Check if a run status is terminal (no further action possible).
 */
export function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Check if a run status indicates it's waiting to fire.
 */
export function isWaitingStatus(status: string): boolean {
  return status === 'queued' || status === 'waiting';
}

/**
 * Check if a run is currently active (executing).
 */
export function isActiveStatus(status: string): boolean {
  return status === 'running' || status === 'recovering';
}



// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate a ScheduleRunInput.
 */
export function validateScheduleRunInput(input: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== 'object') {
    errors.push({ field: 'root', message: 'Input must be an object' });
    return errors;
  }

  const obj = input as Record<string, unknown>;

  // Validate trigger
  if (!obj.trigger || typeof obj.trigger !== 'object') {
    errors.push({ field: 'trigger', message: 'Trigger is required' });
  } else {
    const trigger = obj.trigger as Record<string, unknown>;
    const triggerType = trigger.type as string;

    if (!['now', 'at', 'cron', 'defer'].includes(triggerType)) {
      errors.push({ field: 'trigger.type', message: `Invalid trigger type: ${triggerType}` });
    }

    if (triggerType === 'at' && !(trigger.at instanceof Date || typeof trigger.at === 'string')) {
      errors.push({ field: 'trigger.at', message: 'trigger.at must be a Date or ISO string' });
    }

    if (triggerType === 'cron' && typeof trigger.expression !== 'string') {
      errors.push({ field: 'trigger.expression', message: 'trigger.expression is required for cron' });
    }

    if (triggerType === 'defer' && typeof trigger.delay !== 'string') {
      errors.push({ field: 'trigger.delay', message: 'trigger.delay is required for defer' });
    } else if (triggerType === 'defer' && parseDelayToMs(trigger.delay as string) === undefined) {
      errors.push({ field: 'trigger.delay', message: 'Invalid delay format. Use: 30s, 10m, 2h, 1d' });
    }
  }

  // Validate target
  if (!obj.target || typeof obj.target !== 'object') {
    errors.push({ field: 'target', message: 'Target is required' });
  } else {
    const target = obj.target as Record<string, unknown>;
    const targetType = target.type as string;

    if (!['conversation', 'agent', 'shell'].includes(targetType)) {
      errors.push({ field: 'target.type', message: `Invalid target type: ${targetType}` });
    }

    if (targetType === 'conversation') {
      if (typeof target.conversationId !== 'string' || !target.conversationId.trim()) {
        errors.push({ field: 'target.conversationId', message: 'target.conversationId is required' });
      }
      if (typeof target.prompt !== 'string' || !target.prompt.trim()) {
        errors.push({ field: 'target.prompt', message: 'target.prompt is required' });
      }
    }

    if (targetType === 'agent') {
      if (typeof target.prompt !== 'string' || !target.prompt.trim()) {
        errors.push({ field: 'target.prompt', message: 'target.prompt is required' });
      }
    }

    if (targetType === 'shell') {
      if (typeof target.command !== 'string' || !target.command.trim()) {
        errors.push({ field: 'target.command', message: 'target.command is required' });
      }
    }
  }

  // Validate loop options
  if (obj.loop && typeof obj.loop === 'object') {
    const loop = obj.loop as Record<string, unknown>;

    if (loop.delay !== undefined && typeof loop.delay === 'string' && parseDelayToMs(loop.delay) === undefined) {
      errors.push({ field: 'loop.delay', message: 'Invalid loop.delay format' });
    }

    if (loop.maxIterations !== undefined && (typeof loop.maxIterations !== 'number' || loop.maxIterations < 1)) {
      errors.push({ field: 'loop.maxIterations', message: 'loop.maxIterations must be a positive number' });
    }

    if (loop.retry && typeof loop.retry === 'object') {
      const retry = loop.retry as Record<string, unknown>;
      if (retry.maxDelay !== undefined && typeof retry.maxDelay === 'string' && parseDelayToMs(retry.maxDelay) === undefined) {
        errors.push({ field: 'loop.retry.maxDelay', message: 'Invalid loop.retry.maxDelay format' });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// scheduleRun() implementation
// ---------------------------------------------------------------------------

function sanitizeIdSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 48);

  return sanitized.length > 0 ? sanitized : fallback;
}

function toTimestampKey(value: string): string {
  return value.replace(/[:.]/g, '-');
}

/**
 * Create a run ID from a task slug and timestamp.
 */
export function createRunId(taskSlug: string): string {
  const now = new Date().toISOString();
  const nonce = Math.random().toString(16).slice(2, 10);

  return [
    'run',
    sanitizeIdSegment(taskSlug, 'task'),
    toTimestampKey(now),
    nonce,
  ].join('-');
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
export async function scheduleRun(
  daemonRoot: string,
  input: ScheduleRunInput,
): Promise<ScheduleRunResult> {
  const errors = validateScheduleRunInput(input);
  if (errors.length > 0) {
    throw new Error(`Invalid ScheduleRunInput: ${errors.map((e) => `${e.field}: ${e.message}`).join(', ')}`);
  }

  const createdAt = new Date().toISOString();
  const runId = createRunId(input.conversation?.id ?? input.source?.id ?? 'run');
  const runsRoot = resolveDurableRunsRoot(daemonRoot);
  const paths = resolveDurableRunPaths(runsRoot, runId);

  const kind = deriveRunKind(input.target);
  const resumePolicy = deriveResumePolicy(input.trigger, input.target, input.loop);
  const spec = buildRunSpec(input);

  mkdirSync(paths.root, { recursive: true, mode: 0o700 });

  // Determine parent/root hierarchy
  const parentId = input.conversation ? undefined : undefined; // Root runs have no parent
  const rootId = input.conversation?.id ?? runId; // Use conversation as root, or self if no conversation

  // Save manifest
  saveDurableRunManifest(paths.manifestPath, createDurableRunManifest({
    id: runId,
    kind,
    resumePolicy,
    createdAt,
    spec,
    parentId,
    rootId,
    source: input.source,
  }));

  // Determine initial status based on trigger
  const initialStatus: 'queued' | 'waiting' = 
    input.trigger.type === 'now' ? 'queued' : 'waiting';

  // Save initial status
  saveDurableRunStatus(paths.statusPath, createInitialDurableRunStatus({
    runId,
    status: initialStatus,
    createdAt,
    updatedAt: createdAt,
    activeAttempt: 0,
    checkpointKey: initialStatus,
  }));

  // Save initial checkpoint with full spec
  saveDurableRunCheckpoint(paths.checkpointPath, {
    version: 1,
    runId,
    updatedAt: createdAt,
    step: initialStatus,
    payload: spec,
  });

  // Append creation event
  await appendDurableRunEvent(paths.eventsPath, {
    version: 1,
    runId,
    timestamp: createdAt,
    type: 'run.created',
    payload: {
      kind,
      resumePolicy,
      targetType: input.target.type,
      triggerType: input.trigger.type,
      ...(input.conversation ? { conversationId: input.conversation.id } : {}),
      ...(input.loop?.enabled ? { loop: true } : {}),
    },
  });

  return {
    runId,
    paths,
    kind,
    resumePolicy,
  };
}

/**
 * Cancel a run by ID.
 * Uses cascade cancel to ensure all descendants are also cancelled.
 */
export async function cancelRun(
  daemonRoot: string,
  runId: string,
): Promise<string[]> {
  const runsRoot = resolveDurableRunsRoot(daemonRoot);
  const { cascadeCancelRun } = await import('./store.js');

  return cascadeCancelRun(runsRoot, runId);
}

/**
 * Get run info by ID.
 */
export function getRun(
  daemonRoot: string,
  runId: string,
): { runId: string; paths: DurableRunPaths } | undefined {
  const runsRoot = resolveDurableRunsRoot(daemonRoot);
  const paths = resolveDurableRunPaths(runsRoot, runId);

  if (!resolveDurableRunPaths(runsRoot, runId).manifestPath) {
    return undefined;
  }

  return { runId, paths };
}
