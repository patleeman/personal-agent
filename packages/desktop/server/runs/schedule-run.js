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
} from './store.js';
// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------
/**
 * Derive run kind from target type.
 */
function deriveRunKind(target) {
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
function deriveResumePolicy(trigger, target, loop) {
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
const DEFAULT_CALLBACK = {
  alertLevel: 'passive',
  autoResumeIfOpen: true,
  requireAck: false,
};
/**
 * Merge user-provided callback with defaults.
 */
function resolveCallback(input) {
  return {
    ...DEFAULT_CALLBACK,
    ...input,
  };
}
// ---------------------------------------------------------------------------
// Default loop retry
// ---------------------------------------------------------------------------
const DEFAULT_LOOP_RETRY = {
  attempts: 3,
  backoff: 'exponential',
  maxDelay: '10m',
};
const MAX_LOOP_ITERATIONS = 1_000;
const MAX_LOOP_RETRY_ATTEMPTS = 100;
/**
 * Merge user-provided loop options with defaults.
 */
function resolveLoopOptions(input) {
  if (!input || !input.enabled) {
    return undefined;
  }
  const maxIterations =
    Number.isSafeInteger(input.maxIterations) && input.maxIterations > 0 ? Math.min(MAX_LOOP_ITERATIONS, input.maxIterations) : undefined;
  const retryAttempts =
    Number.isSafeInteger(input.retry?.attempts) && input.retry?.attempts > 0
      ? Math.min(MAX_LOOP_RETRY_ATTEMPTS, input.retry?.attempts)
      : DEFAULT_LOOP_RETRY.attempts;
  return {
    enabled: true,
    delay: input.delay ?? '1h',
    ...(maxIterations !== undefined ? { maxIterations } : {}),
    retry: {
      ...DEFAULT_LOOP_RETRY,
      ...input.retry,
      attempts: retryAttempts,
    },
  };
}
// ---------------------------------------------------------------------------
// Spec normalization
// ---------------------------------------------------------------------------
/**
 * Build the spec object stored in the manifest.
 */
function buildRunSpec(input) {
  const spec = {
    target: {
      type: input.target.type,
      ...('conversationId' in input.target ? { conversationId: input.target.conversationId } : {}),
      ...('prompt' in input.target ? { prompt: input.target.prompt } : {}),
      ...('command' in input.target ? { command: input.target.command } : {}),
      ...('cwd' in input.target ? { cwd: input.target.cwd } : {}),
      ...('argv' in input.target ? { argv: input.target.argv } : {}),
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
// ---------------------------------------------------------------------------
// Delay parsing
// ---------------------------------------------------------------------------
const DELAY_REGEX = /^(\d+(?:\.\d+)?)([smhd])$/i;
const DELAY_MULTIPLIERS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};
/**
 * Parse a delay string like "30s", "10m", "2h", "1d" to milliseconds.
 */
function parseDelayToMs(delay) {
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
  const delayMs = Math.round(value * multiplier);
  return Number.isSafeInteger(delayMs) && delayMs > 0 ? delayMs : undefined;
}
/**
 * Validate a ScheduleRunInput.
 */
function validateScheduleRunInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    errors.push({ field: 'root', message: 'Input must be an object' });
    return errors;
  }
  const obj = input;
  // Validate trigger
  if (!obj.trigger || typeof obj.trigger !== 'object') {
    errors.push({ field: 'trigger', message: 'Trigger is required' });
  } else {
    const trigger = obj.trigger;
    const triggerType = trigger.type;
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
    } else if (triggerType === 'defer' && parseDelayToMs(trigger.delay) === undefined) {
      errors.push({ field: 'trigger.delay', message: 'Invalid delay format. Use: 30s, 10m, 2h, 1d' });
    }
  }
  // Validate target
  if (!obj.target || typeof obj.target !== 'object') {
    errors.push({ field: 'target', message: 'Target is required' });
  } else {
    const target = obj.target;
    const targetType = target.type;
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
    const loop = obj.loop;
    if (loop.delay !== undefined && typeof loop.delay === 'string' && parseDelayToMs(loop.delay) === undefined) {
      errors.push({ field: 'loop.delay', message: 'Invalid loop.delay format' });
    }
    if (
      loop.maxIterations !== undefined &&
      (typeof loop.maxIterations !== 'number' || !Number.isSafeInteger(loop.maxIterations) || loop.maxIterations < 1)
    ) {
      errors.push({ field: 'loop.maxIterations', message: 'loop.maxIterations must be a positive integer' });
    }
    if (loop.retry && typeof loop.retry === 'object') {
      const retry = loop.retry;
      if (
        retry.attempts !== undefined &&
        (typeof retry.attempts !== 'number' || !Number.isSafeInteger(retry.attempts) || retry.attempts < 1)
      ) {
        errors.push({ field: 'loop.retry.attempts', message: 'loop.retry.attempts must be a positive integer' });
      }
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
function sanitizeIdSegment(value, fallback) {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 48);
  return sanitized.length > 0 ? sanitized : fallback;
}
function toTimestampKey(value) {
  return value.replace(/[:.]/g, '-');
}
/**
 * Create a run ID from a task slug and timestamp.
 */
function createRunId(taskSlug) {
  const now = new Date().toISOString();
  const nonce = Math.random().toString(16).slice(2, 10);
  return ['run', sanitizeIdSegment(taskSlug, 'task'), toTimestampKey(now), nonce].join('-');
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
export async function scheduleRun(daemonRoot, input) {
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
  saveDurableRunManifest(
    paths.manifestPath,
    createDurableRunManifest({
      id: runId,
      kind,
      resumePolicy,
      createdAt,
      spec,
      parentId,
      rootId,
      source: input.source,
    }),
  );
  // Determine initial status based on trigger
  const initialStatus = input.trigger.type === 'now' ? 'queued' : 'waiting';
  // Save initial status
  saveDurableRunStatus(
    paths.statusPath,
    createInitialDurableRunStatus({
      runId,
      status: initialStatus,
      createdAt,
      updatedAt: createdAt,
      activeAttempt: 0,
      checkpointKey: initialStatus,
    }),
  );
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
