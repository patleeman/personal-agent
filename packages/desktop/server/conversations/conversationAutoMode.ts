export interface Task {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
}

export interface MissionState {
  goal: string;
  tasks: Task[];
  maxTurns: number;
  turnsUsed: number;
}

export interface LoopState {
  prompt: string;
  maxIterations: number;
  iterationsUsed: number;
  delay: string;
}

export type RunMode = 'manual' | 'nudge' | 'mission' | 'loop';

export interface ConversationAutoModeState {
  enabled: boolean;
  mode: RunMode;
  stopReason: string | null;
  updatedAt: string | null;
  mission?: MissionState;
  loop?: LoopState;
}

export interface ConversationAutoModeStateInput {
  enabled: boolean;
  mode?: RunMode;
  stopReason?: string | null;
  updatedAt?: string | Date;
  mission?: MissionState;
  loop?: LoopState;
}

export interface ConversationAutoModeSessionManagerLike {
  getEntries(): unknown[];
  appendCustomEntry(customType: string, data?: unknown): string;
}

export const CONVERSATION_AUTO_MODE_STATE_CUSTOM_TYPE = 'conversation-auto-mode';
export const CONVERSATION_AUTO_MODE_CONTROL_TOOL = 'conversation_auto_control';
export const CONVERSATION_AUTO_MODE_HIDDEN_TURN_CUSTOM_TYPE = 'conversation_automation_post_turn_review';
export const CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_CUSTOM_TYPE = 'conversation_automation_auto_continue';
export const CONVERSATION_AUTO_MODE_CONTINUE_HIDDEN_TURN_PROMPT = [
  'Auto mode continuation for this conversation.',
  '',
  'You have a persistent context file at the path below. Read it on each',
  'wakeup to orient, write to it after each action to persist state across',
  'turns. Structure it however works for the task — the harness does not',
  'parse or validate its content.',
  '',
  '  {autoContextPath}',
  '',
  'Continue working on the current user request from where you left off.',
  'Do not mention this hidden continuation prompt.',
  'Take the next concrete step that best advances the task.',
].join('\n');
export const DEFAULT_CONVERSATION_AUTO_MODE_STATE: ConversationAutoModeState = {
  enabled: false,
  mode: 'manual',
  stopReason: null,
  updatedAt: null,
};
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/;

export const CONVERSATION_AUTO_MODE_CONTROLLER_PROMPT = [
  'Auto mode review for this conversation.',
  '',
  'The user enabled auto mode because they want you to keep working without waiting for user input.',
  `Call ${CONVERSATION_AUTO_MODE_CONTROL_TOOL} exactly once in this hidden review turn.`,
  '- Use action "continue" if there is meaningful remaining work you can do now.',
  '- Use action "stop" only when the task is complete for the user\'s request, blocked on a real dependency, or needs user input.',
  '- If the user did not give an explicit validation target, infer the expected level of doneness from their request and the work so far. Do not stop just because no explicit checklist was provided.',
  '- Err toward continuing when useful work remains.',
  '- Before calling the auto control tool, update your persistent context file (see path below) to reflect current progress so the next continuation turn can pick up where you left off.',
  '',
  '  {autoContextPath}',
  '',
  '- Do not do the work yourself in this hidden review turn.',
  '- Do not call other tools in this hidden review turn.',
].join('\n');

const VALID_RUN_MODES = new Set<string>(['manual', 'nudge', 'mission', 'loop']);
const VALID_TASK_STATUSES = new Set<string>(['pending', 'in_progress', 'done', 'blocked']);

export function normalizeRunMode(value: unknown): RunMode {
  if (typeof value === 'string' && VALID_RUN_MODES.has(value)) {
    return value as RunMode;
  }
  return 'manual';
}

export function createTask(description: string, status?: Task['status']): Task {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, description, status: status ?? 'pending' };
}

export function areAllTasksDone(tasks: Task[]): boolean {
  return tasks.length > 0 && tasks.every((task) => task.status === 'done');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeMissionState(value: unknown): MissionState | undefined {
  if (!isRecord(value) || typeof value.goal !== 'string') {
    return undefined;
  }

  const tasks: Task[] = [];
  if (Array.isArray(value.tasks)) {
    for (const task of value.tasks) {
      if (!isRecord(task) || typeof task.id !== 'string' || typeof task.description !== 'string') {
        continue;
      }
      const status = typeof task.status === 'string' && VALID_TASK_STATUSES.has(task.status) ? task.status : 'pending';
      tasks.push({ id: task.id, description: task.description, status: status as Task['status'] });
    }
  }

  return {
    goal: value.goal,
    tasks,
    maxTurns: typeof value.maxTurns === 'number' ? Math.max(1, Math.min(1000, Math.floor(value.maxTurns))) : 20,
    turnsUsed: typeof value.turnsUsed === 'number' ? Math.max(0, Math.floor(value.turnsUsed)) : 0,
  };
}

export function normalizeLoopState(value: unknown): LoopState | undefined {
  if (!isRecord(value) || typeof value.prompt !== 'string') {
    return undefined;
  }

  return {
    prompt: value.prompt,
    maxIterations: typeof value.maxIterations === 'number' ? Math.max(1, Math.min(1000, Math.floor(value.maxIterations))) : 5,
    iterationsUsed: typeof value.iterationsUsed === 'number' ? Math.max(0, Math.floor(value.iterationsUsed)) : 0,
    delay: typeof value.delay === 'string' ? value.delay.trim() || 'After each turn' : 'After each turn',
  };
}

/**
 * Infer mode from stored state.
 * If `mode` was explicitly stored and is invalid, return `null` so the
 * caller can reject the whole entry. If `mode` was not stored at all
 * (undefined), fall back to backward-compat inference: enabled → nudge.
 */
function inferModeFromState(mode: unknown, enabled: boolean): RunMode | null {
  // No explicit mode field → backward compat
  if (mode === undefined) {
    return enabled ? 'nudge' : 'manual';
  }
  // Explicit mode field present
  const explicitMode = normalizeRunMode(mode);
  if (explicitMode !== 'manual') {
    return explicitMode;
  }
  // Invalid explicit mode → reject
  if (typeof mode === 'string' && mode !== 'manual') {
    return null;
  }
  return 'manual';
}

function normalizeStopReason(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, 160) : null;
}

function normalizeUpdatedAt(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const match = normalized.match(ISO_TIMESTAMP_PATTERN);
  if (!match || !hasValidIsoDateParts(match)) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function hasValidIsoDateParts(match: RegExpMatchArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = match[7] ? Number(match[7].slice(0, 3).padEnd(3, '0')) : 0;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second &&
    date.getUTCMilliseconds() === millisecond
  );
}

export function normalizeConversationAutoModeState(value: unknown): ConversationAutoModeState | null {
  if (!isRecord(value) || typeof value.enabled !== 'boolean') {
    return null;
  }

  const enabled = value.enabled;
  const mode = inferModeFromState(value.mode, enabled);
  if (!mode) {
    return null;
  }

  const mission = mode === 'mission' ? normalizeMissionState(value.mission) : undefined;
  const loop = mode === 'loop' ? normalizeLoopState(value.loop) : undefined;

  return {
    enabled: mode !== 'manual',
    mode,
    stopReason: normalizeStopReason(value.stopReason),
    updatedAt: normalizeUpdatedAt(value.updatedAt),
    mission,
    loop,
  };
}

export function readConversationAutoModeStateFromEntries(entries: unknown[]): ConversationAutoModeState {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isRecord(entry) || entry.type !== 'custom' || entry.customType !== CONVERSATION_AUTO_MODE_STATE_CUSTOM_TYPE) {
      continue;
    }

    const state = normalizeConversationAutoModeState(entry.data);
    if (state) {
      return state;
    }
  }

  return DEFAULT_CONVERSATION_AUTO_MODE_STATE;
}

export function readConversationAutoModeStateFromSessionManager(
  sessionManager: Pick<ConversationAutoModeSessionManagerLike, 'getEntries'>,
): ConversationAutoModeState {
  return readConversationAutoModeStateFromEntries(sessionManager.getEntries());
}

export function writeConversationAutoModeState(
  sessionManager: ConversationAutoModeSessionManagerLike,
  input: ConversationAutoModeStateInput,
): ConversationAutoModeState {
  const mode = input.mode ?? (input.enabled ? 'nudge' : 'manual');

  const mission = mode === 'mission' && input.mission ? input.mission : undefined;
  const loop = mode === 'loop' && input.loop ? input.loop : undefined;

  const nextState: ConversationAutoModeState = {
    enabled: mode !== 'manual',
    mode,
    stopReason: mode !== 'manual' ? null : normalizeStopReason(input.stopReason),
    updatedAt: normalizeUpdatedAt(input.updatedAt ?? new Date()) ?? new Date().toISOString(),
    mission,
    loop,
  };

  sessionManager.appendCustomEntry(CONVERSATION_AUTO_MODE_STATE_CUSTOM_TYPE, nextState);
  return nextState;
}
